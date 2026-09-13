/**
 * Turning two whole files into aligned side-by-side rows.
 *
 * The panel compares whole files rather than parsing a unified patch: a patch
 * is a lossy projection of the two sides (context is elided, and recovering the
 * unchanged middle means re-reading the file anyway), while a side-by-side view
 * wants every line of both. So the host reads both sides and aligns them here,
 * and the browser only draws.
 *
 * Alignment is exact where it can afford to be, and anchored where it cannot:
 *
 * 1. The common head and tail are trimmed first. Almost every real edit leaves
 *    most of a file alone, so this alone reduces a 5000-line file with one
 *    changed function to a handful of lines of work.
 * 2. What remains is aligned by exact longest common subsequence while its
 *    product fits the cell budget.
 * 3. A region too large for that is aligned on its unique common lines
 *    (patience-style anchors) and the gaps between them.
 * 4. A region with no usable anchor is paired by position — and even then a
 *    position whose two lines are equal is reported as unchanged.
 *
 * The last rule is the one that matters most. A coarse alignment may pair lines
 * imprecisely, but it must never claim an unchanged line was replaced, because
 * that turns a one-line edit into a wall of red and green. Anything the
 * alignment could not resolve exactly is reported through `coarse`.
 *
 * @module dsh-git/git/sidediff
 */

import type { DiffRow, DiffSide } from '../shared/wire.ts'

/** Cell budget for an exact LCS table; 4M cells is a 16 MiB `Uint32Array`. */
const ALIGNMENT_CELL_BUDGET = 4_000_000

/** How many anchor levels one alignment may descend before pairing by position. */
const MAX_ANCHOR_DEPTH = 2

/** What one alignment produced. */
export interface SideBySide {
  /** Aligned rows, in file order. */
  readonly rows: readonly DiffRow[]
  /** New-side lines the change adds. */
  readonly added: number
  /** Old-side lines the change removes. */
  readonly removed: number
  /** Some region was aligned coarsely, so the pairing is only approximate. */
  readonly coarse: boolean
}

/** One step of an alignment, addressed by each side's own line index. */
type Op =
  | { readonly kind: 'equal'; readonly oldIndex: number; readonly newIndex: number }
  | { readonly kind: 'delete'; readonly oldIndex: number }
  | { readonly kind: 'insert'; readonly newIndex: number }

/** What one alignment run accumulates besides its steps. */
interface Alignment {
  /** Records that some region was paired by position rather than matched. */
  coarse: boolean
}

/**
 * Split one side's text into content lines.
 *
 * A single trailing newline is a line terminator rather than a final empty
 * line, and empty text is zero lines — the same rule the harness's diff card
 * applies to tool output, so both surfaces agree on their counts. Windows line
 * endings are normalized so a CRLF file does not read as wholly changed against
 * its LF twin.
 *
 * @param text - the side's text.
 * @returns the content lines, without terminators.
 */
export function splitLines(text: string): string[] {
  if (text === '') return []
  const normalized = text.replace(/\r\n/g, '\n')
  const body = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized
  return body.split('\n')
}

/**
 * Read one line, proving the index is in range to the type system.
 * @param lines - the side's lines.
 * @param index - the line to read.
 * @returns the line's text.
 */
function lineAt(lines: readonly string[], index: number): string {
  const line = lines[index]
  if (line === undefined) throw new Error(`dsh-git: line ${String(index)} is out of range`)
  return line
}

/** Build a `DiffSide`, or null when this row has no line on that side. */
function sideOf(lines: readonly string[] | null, index: number): DiffSide | null {
  return lines === null ? null : { no: index + 1, text: lineAt(lines, index) }
}

/**
 * Align two regions by exact longest common subsequence.
 * @param oldLines - the old region.
 * @param newLines - the new region.
 * @param oldBase - line offset of the old region in the whole file.
 * @param newBase - line offset of the new region in the whole file.
 * @returns the alignment steps.
 */
function lcsOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldBase: number,
  newBase: number,
): Op[] {
  const width = newLines.length + 1
  // `table[i][j]` is the LCS length of `oldLines[i..]` and `newLines[j..]`,
  // filled bottom-up so the forward walk below can always read its successor.
  const table = new Uint32Array((oldLines.length + 1) * width)
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i * width + j] = lineAt(oldLines, i) === lineAt(newLines, j)
        ? (table[(i + 1) * width + (j + 1)] ?? 0) + 1
        : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + (j + 1)] ?? 0)
    }
  }

  const ops: Op[] = []
  let i = 0
  let j = 0
  while (i < oldLines.length && j < newLines.length) {
    if (lineAt(oldLines, i) === lineAt(newLines, j)) {
      ops.push({ kind: 'equal', oldIndex: oldBase + i, newIndex: newBase + j })
      i += 1
      j += 1
      continue
    }
    // Prefer the deletion on a tie so a rewritten line reads as a replacement
    // rather than as an insertion above it.
    if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + (j + 1)] ?? 0)) {
      ops.push({ kind: 'delete', oldIndex: oldBase + i })
      i += 1
    } else {
      ops.push({ kind: 'insert', newIndex: newBase + j })
      j += 1
    }
  }
  while (i < oldLines.length) {
    ops.push({ kind: 'delete', oldIndex: oldBase + i })
    i += 1
  }
  while (j < newLines.length) {
    ops.push({ kind: 'insert', newIndex: newBase + j })
    j += 1
  }
  return ops
}

/**
 * Pair two regions by position.
 *
 * This is the last resort, and it stays honest: a position whose two lines are
 * equal is reported as unchanged, so a coarse alignment never paints a line
 * that did not change. Only genuinely differing positions become a delete plus
 * an insert, which the row builder pairs into one replacement.
 *
 * @param oldLines - the old region.
 * @param newLines - the new region.
 * @param oldBase - line offset of the old region in the whole file.
 * @param newBase - line offset of the new region in the whole file.
 * @param state - records that a coarse pairing happened.
 * @returns the alignment steps.
 */
function positionalOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldBase: number,
  newBase: number,
  state: Alignment,
): Op[] {
  state.coarse = true
  const ops: Op[] = []
  const shared = Math.min(oldLines.length, newLines.length)
  for (let i = 0; i < shared; i += 1) {
    if (lineAt(oldLines, i) === lineAt(newLines, i)) {
      ops.push({ kind: 'equal', oldIndex: oldBase + i, newIndex: newBase + i })
      continue
    }
    ops.push({ kind: 'delete', oldIndex: oldBase + i })
    ops.push({ kind: 'insert', newIndex: newBase + i })
  }
  for (let i = shared; i < oldLines.length; i += 1) ops.push({ kind: 'delete', oldIndex: oldBase + i })
  for (let i = shared; i < newLines.length; i += 1) ops.push({ kind: 'insert', newIndex: newBase + i })
  return ops
}

/** One matched position on both sides. */
interface Anchor {
  readonly old: number
  readonly next: number
}

/**
 * Keep the anchors whose new-side positions increase.
 *
 * The candidates arrive in old-side order, so this is the longest increasing
 * subsequence over their new-side positions, in `O(k log k)`.
 * @param pairs - matched positions, ascending on the old side.
 * @returns a longest chain ascending on both sides.
 */
function increasingChain(pairs: readonly Anchor[]): Anchor[] {
  const chosen: number[] = []
  const previous: number[] = new Array<number>(pairs.length).fill(-1)
  const tailValue: number[] = []
  for (let index = 0; index < pairs.length; index += 1) {
    const value = pairs[index]?.next ?? 0
    let low = 0
    let high = chosen.length
    while (low < high) {
      const mid = (low + high) >> 1
      if ((tailValue[mid] ?? Number.NEGATIVE_INFINITY) < value) low = mid + 1
      else high = mid
    }
    previous[index] = low > 0 ? (chosen[low - 1] ?? -1) : -1
    chosen[low] = index
    tailValue[low] = value
  }
  const chain: Anchor[] = []
  let at = chosen.length === 0 ? -1 : (chosen[chosen.length - 1] ?? -1)
  while (at >= 0) {
    const pair = pairs[at]
    if (pair !== undefined) chain.push(pair)
    at = previous[at] ?? -1
  }
  return chain.reverse()
}

/**
 * Find the unique-in-both lines two regions have in common, as a chain.
 * @param oldLines - the old region.
 * @param newLines - the new region.
 * @returns the anchors, ascending on both sides.
 */
function anchorsOf(oldLines: readonly string[], newLines: readonly string[]): Anchor[] {
  const oldCounts = new Map<string, number>()
  const newCounts = new Map<string, number>()
  for (const line of oldLines) oldCounts.set(line, (oldCounts.get(line) ?? 0) + 1)
  for (const line of newLines) newCounts.set(line, (newCounts.get(line) ?? 0) + 1)
  const newPosition = new Map<string, number>()
  for (let j = 0; j < newLines.length; j += 1) {
    const line = lineAt(newLines, j)
    if (oldCounts.get(line) === 1 && newCounts.get(line) === 1) newPosition.set(line, j)
  }
  const candidates: Anchor[] = []
  for (let i = 0; i < oldLines.length; i += 1) {
    const next = newPosition.get(lineAt(oldLines, i))
    if (next !== undefined) candidates.push({ old: i, next })
  }
  return increasingChain(candidates)
}

/**
 * Align one region with the cheapest method that fits its size.
 * @param oldLines - the old region, already trimmed.
 * @param newLines - the new region, already trimmed.
 * @param oldBase - line offset of the old region in the whole file.
 * @param newBase - line offset of the new region in the whole file.
 * @param budget - exact-alignment cell budget.
 * @param depth - remaining anchor levels.
 * @param state - records that a coarse pairing happened.
 * @returns the alignment steps.
 */
function alignRegion(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldBase: number,
  newBase: number,
  budget: number,
  depth: number,
  state: Alignment,
): Op[] {
  if (oldLines.length === 0) {
    return newLines.map((_unused, j) => ({ kind: 'insert', newIndex: newBase + j }) satisfies Op)
  }
  if (newLines.length === 0) {
    return oldLines.map((_unused, i) => ({ kind: 'delete', oldIndex: oldBase + i }) satisfies Op)
  }
  if (oldLines.length * newLines.length <= budget) {
    return lcsOps(oldLines, newLines, oldBase, newBase)
  }
  if (depth <= 0) return positionalOps(oldLines, newLines, oldBase, newBase, state)

  // A line occurring exactly once on each side can only correspond to itself,
  // so it is a reliable anchor. Chaining the anchors leaves small gaps, which
  // the exact aligner handles even when the region as a whole does not fit.
  const anchors = anchorsOf(oldLines, newLines)
  if (anchors.length === 0) return positionalOps(oldLines, newLines, oldBase, newBase, state)

  const ops: Op[] = []
  let oldAt = 0
  let newAt = 0
  for (const anchor of anchors) {
    ops.push(...alignRegion(
      oldLines.slice(oldAt, anchor.old),
      newLines.slice(newAt, anchor.next),
      oldBase + oldAt,
      newBase + newAt,
      budget,
      depth - 1,
      state,
    ))
    ops.push({ kind: 'equal', oldIndex: oldBase + anchor.old, newIndex: newBase + anchor.next })
    oldAt = anchor.old + 1
    newAt = anchor.next + 1
  }
  ops.push(...alignRegion(
    oldLines.slice(oldAt),
    newLines.slice(newAt),
    oldBase + oldAt,
    newBase + newAt,
    budget,
    depth - 1,
    state,
  ))
  return ops
}

/**
 * Align two whole sides.
 *
 * The common head and tail are emitted as unchanged without consulting any
 * table: that is both the cheapest and the most accurate thing to do, and it is
 * what keeps a one-line edit in a huge file from looking like a rewrite.
 *
 * @param oldLines - every line of the old side.
 * @param newLines - every line of the new side.
 * @param budget - exact-alignment cell budget.
 * @param state - records that a coarse pairing happened.
 * @returns the alignment steps.
 */
function alignOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  budget: number,
  state: Alignment,
): Op[] {
  let prefix = 0
  while (
    prefix < oldLines.length
    && prefix < newLines.length
    && lineAt(oldLines, prefix) === lineAt(newLines, prefix)
  ) {
    prefix += 1
  }
  let suffix = 0
  while (
    suffix < oldLines.length - prefix
    && suffix < newLines.length - prefix
    && lineAt(oldLines, oldLines.length - 1 - suffix) === lineAt(newLines, newLines.length - 1 - suffix)
  ) {
    suffix += 1
  }

  const ops: Op[] = []
  for (let i = 0; i < prefix; i += 1) {
    ops.push({ kind: 'equal', oldIndex: i, newIndex: i })
  }
  ops.push(...alignRegion(
    oldLines.slice(prefix, oldLines.length - suffix),
    newLines.slice(prefix, newLines.length - suffix),
    prefix,
    prefix,
    budget,
    MAX_ANCHOR_DEPTH,
    state,
  ))
  for (let i = 0; i < suffix; i += 1) {
    ops.push({
      kind: 'equal',
      oldIndex: oldLines.length - suffix + i,
      newIndex: newLines.length - suffix + i,
    })
  }
  return ops
}

/**
 * Turn one alignment into the rows the panel draws.
 *
 * A run of deletions followed by a run of insertions is one replacement: the
 * runs are paired by position, and whichever is longer contributes the
 * remaining one-sided rows. The two counts come from the steps, so they
 * describe the change itself rather than the rows that happen to be visible.
 *
 * @param ops - the alignment steps.
 * @param oldLines - every line of the old side.
 * @param newLines - every line of the new side.
 * @returns the rows and the two line counts.
 */
function rowsOf(
  ops: readonly Op[],
  oldLines: readonly string[],
  newLines: readonly string[],
): { rows: DiffRow[]; added: number; removed: number } {
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  let deletes: number[] = []
  let inserts: number[] = []

  const flush = (): void => {
    const pairs = Math.min(deletes.length, inserts.length)
    for (let k = 0; k < pairs; k += 1) {
      rows.push({
        kind: 'replace',
        left: sideOf(oldLines, deletes[k] ?? 0),
        right: sideOf(newLines, inserts[k] ?? 0),
      })
    }
    for (let k = pairs; k < deletes.length; k += 1) {
      rows.push({ kind: 'delete', left: sideOf(oldLines, deletes[k] ?? 0), right: null })
    }
    for (let k = pairs; k < inserts.length; k += 1) {
      rows.push({ kind: 'insert', left: null, right: sideOf(newLines, inserts[k] ?? 0) })
    }
    deletes = []
    inserts = []
  }

  for (const op of ops) {
    if (op.kind === 'equal') {
      flush()
      rows.push({
        kind: 'context',
        left: sideOf(oldLines, op.oldIndex),
        right: sideOf(newLines, op.newIndex),
      })
      continue
    }
    if (op.kind === 'delete') {
      deletes.push(op.oldIndex)
      removed += 1
      continue
    }
    inserts.push(op.newIndex)
    added += 1
  }
  flush()
  return { rows, added, removed }
}

/**
 * Align two whole files into side-by-side rows.
 * @param oldText - the old side's text.
 * @param newText - the new side's text.
 * @param cellBudget - exact-alignment budget; defaults to the built-in one and exists for tests.
 * @returns the rows and the two line counts.
 */
export function buildSideBySide(oldText: string, newText: string, cellBudget?: number): SideBySide {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const state: Alignment = { coarse: false }
  const ops = alignOps(oldLines, newLines, cellBudget ?? ALIGNMENT_CELL_BUDGET, state)
  const { rows, added, removed } = rowsOf(ops, oldLines, newLines)
  return { rows, added, removed, coarse: state.coarse }
}

/** Context lines kept around each change when a diff has to be cut down. */
const HUNK_CONTEXT = 4

/**
 * Count the lines one row range advances on each side.
 * @param rows - every aligned row.
 * @param from - first index of the range.
 * @param to - one past the last index of the range.
 * @returns how many old-side and new-side lines the range spans.
 */
function spanOf(rows: readonly DiffRow[], from: number, to: number): { left: number; right: number } {
  let left = 0
  let right = 0
  for (let index = from; index < to; index += 1) {
    const row = rows[index]
    if (row === undefined) continue
    if (row.left !== null) left += 1
    if (row.right !== null) right += 1
  }
  return { left, right }
}

/**
 * Cut a diff down to its changes, keeping a little context and saying what was
 * left out.
 *
 * Taking the first N rows instead would be simpler and useless: on a file of a
 * few thousand lines the changes are scattered, and a head slice shows a wall of
 * unchanged lines with the actual change below the cut. So the rows kept are the
 * ones near a change, and every omission is stated as a `gap` carrying its own
 * counts — the numbers a reader needs to know the view is not contiguous.
 *
 * A gap costs a row like any other, so the budget is spent on hunk by hunk and
 * the result never exceeds `maxLines`. One row is held back while there is still
 * unvisited content, so the trailing omission can always be stated rather than
 * silently ending the view.
 *
 * @param rows - every aligned row.
 * @param maxLines - most rows the result may hold.
 * @param context - unchanged rows kept on each side of a change.
 * @returns the rows to send, with gaps where rows were omitted.
 */
export function hunkRows(
  rows: readonly DiffRow[],
  maxLines: number,
  context: number = HUNK_CONTEXT,
): DiffRow[] {
  if (rows.length <= maxLines) return [...rows]

  const gap = (from: number, to: number): DiffRow => {
    const span = spanOf(rows, from, to)
    return { kind: 'gap', left: null, right: null, skippedLeft: span.left, skippedRight: span.right }
  }

  const out: DiffRow[] = []
  let covered = -1
  for (let index = 0; index < rows.length; index += 1) {
    if (rows[index]?.kind === 'context') continue
    const from = Math.max(0, index - context)
    const to = Math.min(rows.length - 1, index + context)
    if (to <= covered) continue
    const start = Math.max(from, covered + 1)
    const withGap = start > covered + 1 ? 1 : 0
    // Hold one row back while content remains, for the trailing gap.
    const budget = to < rows.length - 1 ? maxLines - 1 : maxLines
    if (out.length + withGap + (to - start + 1) > budget) break
    if (withGap === 1) out.push(gap(covered + 1, start))
    for (let at = start; at <= to; at += 1) {
      const row = rows[at]
      if (row !== undefined) out.push(row)
    }
    covered = to
  }

  if (out.length === 0) return rows.slice(0, maxLines)
  if (covered < rows.length - 1 && out.length < maxLines) out.push(gap(covered + 1, rows.length))
  return out
}
