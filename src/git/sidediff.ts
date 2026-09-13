/**
 * Turning two whole files into aligned side-by-side rows.
 *
 * The panel compares whole files rather than parsing a unified patch: a patch
 * is a lossy projection of the two sides (context is elided, and recovering the
 * unchanged middle means re-reading the file anyway), while a side-by-side view
 * wants every line of both. So the host reads both sides and aligns them here,
 * and the browser only draws.
 *
 * The alignment itself is VS Code's. `vscode-diff` is the diff computer the
 * editor ships, extracted as a package: the same Myers-plus-dynamic-programming
 * core with the same line-trimming, which is what makes a diff read the way a
 * reader expects rather than the way a naive LCS reads. Two properties of this
 * plugin sit around it:
 *
 * 1. The common head and tail are trimmed before the computer is asked. Almost
 *    every real edit leaves most of a file alone, so this bounds the work for
 *    the common case and guarantees the unchanged head and tail are context
 *    even when the computer gives up.
 * 2. The computer's own `hitTimeout` is surfaced as `coarse`. It means the
 *    pairing is an approximation, and the tab says so instead of pretending.
 *
 * One invariant the adapter must hold, whatever the computer returns: a line
 * that is equal on both sides is never reported as changed. That is the bug a
 * positional fallback introduces, and it is what turned a one-line edit in a
 * 1500-line file into a wall of red and green.
 *
 * @module dsh-git/git/sidediff
 */

import { DefaultLinesDiffComputer } from 'vscode-diff'
import type { DiffRow, DiffSide } from '../shared/wire.ts'

/** How long the diff computer may spend before its answer becomes approximate. */
const DEFAULT_MAX_MS = 2000

/** Context lines kept around each change when a diff has to be cut down. */
const HUNK_CONTEXT = 4

/** VS Code's line-diff computer; stateless, so one instance serves every diff. */
const COMPUTER = new DefaultLinesDiffComputer()

/** What one alignment produced. */
export interface SideBySide {
  /** Aligned rows, in file order. */
  readonly rows: readonly DiffRow[]
  /** New-side lines the change adds. */
  readonly added: number
  /** Old-side lines the change removes. */
  readonly removed: number
  /** The computer hit its time budget, so the pairing is only approximate. */
  readonly coarse: boolean
}

/** One step of an alignment, addressed by each side's own line index. */
type Op =
  | { readonly kind: 'equal'; readonly oldIndex: number; readonly newIndex: number }
  | { readonly kind: 'delete'; readonly oldIndex: number }
  | { readonly kind: 'insert'; readonly newIndex: number }

/** What one alignment run accumulates besides its steps. */
interface Alignment {
  /** Records that the computer reported an approximate answer. */
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
 * Pair one region by position.
 *
 * This is the last resort, reached only when the diff computer refuses an input
 * it considers impossible. It stays honest about the one thing that matters: a
 * position whose two lines are equal is reported as unchanged, so even a
 * fallback never paints an unchanged line as changed.
 *
 * @param oldLines - the old region.
 * @param newLines - the new region.
 * @param oldBase - line offset of the old region in the whole file.
 * @param newBase - line offset of the new region in the whole file.
 * @param state - records that the pairing is approximate.
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

/**
 * Ask VS Code's diff computer to align one region.
 *
 * The computer reports changed regions as pairs of 1-based, end-exclusive line
 * ranges; everything between two regions is unchanged and is paired one-to-one
 * here. A region contributes its old lines as deletions and its new lines as
 * insertions, which the row builder then pairs into replacements.
 *
 * @param oldLines - the old region.
 * @param newLines - the new region.
 * @param oldBase - line offset of the old region in the whole file.
 * @param newBase - line offset of the new region in the whole file.
 * @param maxMs - the computer's time budget.
 * @param state - records an approximate answer.
 * @returns the alignment steps.
 */
function computerOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  oldBase: number,
  newBase: number,
  maxMs: number,
  state: Alignment,
): Op[] {
  // A region one side of which is empty is a whole-file creation or deletion
  // after trimming. The computer's own range bookkeeping cannot represent it
  // (its toRangeMapping2 asserts against exactly this shape), and it needs no
  // alignment anyway: every line is on one side only.
  if (oldLines.length === 0) {
    return newLines.map((_unused, j) => ({ kind: 'insert', newIndex: newBase + j }) satisfies Op)
  }
  if (newLines.length === 0) {
    return oldLines.map((_unused, i) => ({ kind: 'delete', oldIndex: oldBase + i }) satisfies Op)
  }

  let diff
  try {
    diff = COMPUTER.computeDiff([...oldLines], [...newLines], {
      ignoreTrimWhitespace: false,
      maxComputationTimeMs: maxMs,
      // Moves are an annotation over changes the computer already reports; this
      // view draws a moved block as a deletion plus an insertion, which is what
      // a reader of a two-column diff expects, so paying for the detection is
      // waste.
      computeMoves: false,
    })
  } catch {
    // The computer's internals assert against shapes it believes impossible.
    // Rather than fail the whole diff, fall back to the honest pairing.
    return positionalOps(oldLines, newLines, oldBase, newBase, state)
  }
  if (diff.hitTimeout) state.coarse = true

  const ops: Op[] = []
  let oldAt = 0
  let newAt = 0
  for (const change of diff.changes) {
    const oldStart = change.original.startLineNumber - 1
    const oldEnd = change.original.endLineNumberExclusive - 1
    const newStart = change.modified.startLineNumber - 1
    const newEnd = change.modified.endLineNumberExclusive - 1
    // Between two changed regions both sides advance by the same count; the min
    // is a guard against a computer answer this adapter would misread.
    const context = Math.min(oldStart - oldAt, newStart - newAt)
    for (let i = 0; i < context; i += 1) {
      ops.push({ kind: 'equal', oldIndex: oldBase + oldAt + i, newIndex: newBase + newAt + i })
    }
    for (let i = oldAt + context; i < oldStart; i += 1) {
      ops.push({ kind: 'delete', oldIndex: oldBase + i })
    }
    for (let i = newAt + context; i < newStart; i += 1) {
      ops.push({ kind: 'insert', newIndex: newBase + i })
    }
    for (let i = oldStart; i < oldEnd; i += 1) ops.push({ kind: 'delete', oldIndex: oldBase + i })
    for (let i = newStart; i < newEnd; i += 1) ops.push({ kind: 'insert', newIndex: newBase + i })
    oldAt = oldEnd
    newAt = newEnd
  }
  const tail = Math.min(oldLines.length - oldAt, newLines.length - newAt)
  for (let i = 0; i < tail; i += 1) {
    ops.push({ kind: 'equal', oldIndex: oldBase + oldAt + i, newIndex: newBase + newAt + i })
  }
  for (let i = oldAt + tail; i < oldLines.length; i += 1) {
    ops.push({ kind: 'delete', oldIndex: oldBase + i })
  }
  for (let i = newAt + tail; i < newLines.length; i += 1) {
    ops.push({ kind: 'insert', newIndex: newBase + i })
  }
  return ops
}

/**
 * Align two whole sides.
 *
 * The common head and tail are emitted as unchanged without asking the computer
 * anything: that is both the cheapest and the most accurate thing to do, and it
 * is what keeps a one-line edit in a huge file from looking like a rewrite.
 *
 * @param oldLines - every line of the old side.
 * @param newLines - every line of the new side.
 * @param maxMs - the computer's time budget.
 * @param state - records an approximate answer.
 * @returns the alignment steps.
 */
function alignOps(
  oldLines: readonly string[],
  newLines: readonly string[],
  maxMs: number,
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
  ops.push(...computerOps(
    oldLines.slice(prefix, oldLines.length - suffix),
    newLines.slice(prefix, newLines.length - suffix),
    prefix,
    prefix,
    maxMs,
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
    // Both runs are walked together: a position they share is a replacement,
    // and a position only one of them reaches is that side's own row.
    for (let k = 0; k < Math.max(deletes.length, inserts.length); k += 1) {
      const oldIndex = deletes[k]
      const newIndex = inserts[k]
      if (oldIndex !== undefined && newIndex !== undefined) {
        rows.push({ kind: 'replace', left: sideOf(oldLines, oldIndex), right: sideOf(newLines, newIndex) })
      } else if (oldIndex !== undefined) {
        rows.push({ kind: 'delete', left: sideOf(oldLines, oldIndex), right: null })
      } else if (newIndex !== undefined) {
        rows.push({ kind: 'insert', left: null, right: sideOf(newLines, newIndex) })
      }
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
 * @param maxMs - the diff computer's time budget; defaults to the built-in one.
 * @returns the rows and the two line counts.
 */
export function buildSideBySide(oldText: string, newText: string, maxMs?: number): SideBySide {
  const oldLines = splitLines(oldText)
  const newLines = splitLines(newText)
  const state: Alignment = { coarse: false }
  const ops = alignOps(oldLines, newLines, maxMs ?? DEFAULT_MAX_MS, state)
  const { rows, added, removed } = rowsOf(ops, oldLines, newLines)
  return { rows, added, removed, coarse: state.coarse }
}

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
  for (const row of rows.slice(from, to)) {
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
    for (const row of rows.slice(start, to + 1)) out.push(row)
    covered = to
  }

  if (out.length === 0) return rows.slice(0, maxLines)
  if (covered < rows.length - 1 && out.length < maxLines) out.push(gap(covered + 1, rows.length))
  return out
}
