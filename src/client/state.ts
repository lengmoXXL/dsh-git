/**
 * The list's derived state, as pure functions.
 *
 * Everything here is a decision a tab makes about data it already has: which
 * groups the changed paths belong to, the letter a change is marked with, the
 * chips a commit's refs become, how a failure is described, and how a long
 * unchanged run folds. Keeping them pure is what lets the browser half be
 * tested without a DOM, a server, or a React root.
 *
 * Which change a click opens is NOT here: that is an address, owned by
 * `git-address.ts`, because a tab's identity is its address.
 *
 * @module dsh-git/client/state
 */

import type { ChangeEntry, ChangeKind, ChangeStage, DiffPayload, DiffRow } from '../shared/wire.ts'
import { GitRequestError } from './face.ts'

/**
 * One read, as a view draws it: still coming, arrived, or the reason it did not.
 *
 * The panel reads in three places (the log's two halves, a commit's file list),
 * and every one of them draws the same three states, so the shape lives here
 * rather than beside the first component that needed it.
 */
export type Load<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly value: T }
  | { readonly phase: 'failed'; readonly code: string; readonly message: string }

/**
 * A cached value as a drawn read: nothing cached is still a read in flight.
 * @param value - the cached payload, if there was one.
 * @returns the read to draw.
 */
export function cached<T>(value: T | undefined): Load<T> {
  return value === undefined ? { phase: 'loading' } : { phase: 'ready', value }
}

/** A failure, split so the panel can name the code and show the detail. */
export interface FailureInfo {
  /** The host's stable code, or a local marker for a transport failure. */
  readonly code: string
  /** The operator-readable detail. */
  readonly message: string
}

/**
 * Describe a rejected request.
 *
 * A failure the host described keeps its code; anything else — the browser
 * refusing the request, a body that was not JSON — is a transport failure with
 * the thrown message as its detail.
 * @param error - the caught value.
 * @returns the code and detail to draw.
 */
export function failureInfoOf(error: unknown): FailureInfo {
  if (error instanceof GitRequestError) return { code: error.code, message: error.message }
  return {
    code: 'git/transport',
    message: error instanceof Error ? error.message : String(error),
  }
}

/** The changed paths the panel draws, split the way a reader looks for them. */
export interface GroupedChanges {
  /** Paths git could not merge. */
  readonly conflicted: readonly ChangeEntry[]
  /** Paths whose index side changed. */
  readonly staged: readonly ChangeEntry[]
  /** Paths whose working-tree side changed. */
  readonly unstaged: readonly ChangeEntry[]
  /** Paths git does not track yet. */
  readonly untracked: readonly ChangeEntry[]
}

/** Which group a stage belongs to, and in what order the groups are drawn. */
const STAGE_ORDER: readonly ChangeStage[] = ['conflicted', 'staged', 'unstaged', 'untracked']

/**
 * The single letter a change is marked with.
 *
 * These are git's own letters as the editor's source-control list spells them,
 * including `!` for a file git could not merge — the one place this vocabulary
 * departs from `git status`, which reports a conflict twice instead.
 *
 * @param kind - the kind a status letter described.
 * @returns the letter to draw, one character wide.
 */
export function statusLetter(kind: ChangeKind): string {
  switch (kind) {
    case 'modified': return 'M'
    case 'added': return 'A'
    case 'deleted': return 'D'
    case 'renamed': return 'R'
    case 'copied': return 'C'
    case 'typechange': return 'T'
    case 'untracked': return 'U'
    case 'conflicted': return '!'
    case 'unknown': return '?'
  }
}

/** What a ref decoration says the ref it points at is. */
export type RefKind =
  /** The branch the working tree is on. */
  | 'head'
  /** A local branch. */
  | 'branch'
  /** A branch on a remote. */
  | 'remote'
  /** A tag. */
  | 'tag'

/** One ref a commit carries, named the way its row draws it. */
export interface RefChip {
  /** What kind of ref this is. */
  readonly kind: RefKind
  /** The name without its `refs/...` qualifier. */
  readonly name: string
}

/** The qualifiers `git log --decorate=full` puts in front of a ref's name. */
const HEADS = 'refs/heads/'
const REMOTES = 'refs/remotes/'
const TAGS = 'refs/tags/'
/** What `%D` puts in front of a tag, on top of the qualifier. */
const TAG_MARK = 'tag: '
/** What `%D` puts between `HEAD` and the branch it is on. */
const HEAD_MARK = ' -> '

/**
 * Read a commit's ref decoration into the chips its row draws.
 *
 * `%D` is read with `--decorate=full`, so each ref arrives fully qualified and
 * a local branch called `feature/x` is told from `origin/feature/x` by its
 * prefix rather than by counting slashes. `origin/HEAD` is dropped: it is a
 * symbolic alias of the remote's default branch, which is the branch already
 * named beside it. A ref under no known qualifier — a stash annotation, a note
 * git was told to decorate — is drawn under its own name rather than hidden.
 *
 * @param refs - the decoration field, split the way `%D` writes it.
 * @returns one chip per ref, in git's own order.
 */
export function parseRefs(refs: readonly string[]): RefChip[] {
  const chips: RefChip[] = []
  for (const raw of refs) {
    const ref = raw.trim()
    if (ref === '') continue
    const marked = ref.startsWith(TAG_MARK)
    const name = marked ? ref.slice(TAG_MARK.length) : ref
    const arrow = name.indexOf(HEAD_MARK)
    if (arrow >= 0) {
      // `HEAD -> refs/heads/main`: the branch is the fact, and being on it is
      // what the chip's solid tone says, so one chip carries both.
      chips.push({ kind: 'head', name: unqualified(name.slice(arrow + HEAD_MARK.length), HEADS) })
      continue
    }
    if (marked || name.startsWith(TAGS)) {
      chips.push({ kind: 'tag', name: unqualified(name, TAGS) })
      continue
    }
    if (name === 'HEAD') {
      chips.push({ kind: 'head', name: 'HEAD' })
      continue
    }
    if (name.startsWith(REMOTES)) {
      const remote = unqualified(name, REMOTES)
      if (!remote.endsWith('/HEAD')) chips.push({ kind: 'remote', name: remote })
      continue
    }
    chips.push({ kind: 'branch', name: unqualified(name, HEADS) })
  }
  return chips
}

/**
 * Drop a ref's qualifier, keeping anything that does not carry it.
 * @param name - a fully qualified ref name, or anything else git decorated.
 * @param prefix - the qualifier to drop.
 * @returns the name a reader recognizes.
 */
function unqualified(name: string, prefix: string): string {
  return name.startsWith(prefix) ? name.slice(prefix.length) : name
}

/**
 * The diff as text, for the copy control.
 *
 * A row whose old side was dropped copies as a `-` line and one whose new side
 * was dropped as a `+` line, so a re-substitution of the whole file reproduces
 * the change; a replaced row copies both, old first. Context copies once — the
 * two sides of an unchanged line are the same line. The host's own "rows left
 * out" markers stay, so a copy of a truncated diff is not read as complete.
 *
 * @param diff - one change, already aligned.
 * @returns the change as unified diff text.
 */
export function diffText(diff: DiffPayload): string {
  const lines = [diff.path]
  if (diff.origPath !== undefined) lines.push(`← ${diff.origPath}`)
  for (const line of inlineLines(diff.rows)) {
    switch (line.kind) {
      case 'context': lines.push(` ${line.text ?? ''}`); break
      case 'delete': lines.push(`-${line.text ?? ''}`); break
      case 'insert': lines.push(`+${line.text ?? ''}`); break
      case 'gap': lines.push(`⋯ ${String(line.skippedLeft ?? 0)} / ${String(line.skippedRight ?? 0)}`); break
      // A fold is the reader's own display state, so it is never part of a copy.
      case 'fold': break
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * A revision label as a reader writes it.
 *
 * A commit's own address is a full object id, and the host labels the two sides
 * of a commit's diff with it; forty hex characters are not a label. The suffix
 * git's revision syntax adds — `^`, `~2` — is kept, so the pair still says what
 * is being compared.
 *
 * @param label - a revision label from the host.
 * @returns the label with any full object id shortened to seven characters.
 */
export function revLabel(label: string): string {
  return label.replace(/[0-9a-f]{40}/gi, id => id.slice(0, 7))
}

/** One line of a diff read in one column instead of two. */
export interface InlineLine {
  /** What this line is. `fold` is a run the reader closed; `gap` is one the host left out. */
  readonly kind: 'context' | 'delete' | 'insert' | 'gap' | 'fold'
  /** Stable identity, for keys and for a fold's expansion set. */
  readonly key: string
  /** The old-side line number, when this line is on the old side. */
  readonly oldNo?: number
  /** The new-side line number, when this line is on the new side. */
  readonly newNo?: number
  /** The line's text; a `gap` and a `fold` carry counts instead. */
  readonly text?: string
  /** A fold's hidden line count. */
  readonly hidden?: number
  /** A gap's skipped old-side lines. */
  readonly skippedLeft?: number
  /** A gap's skipped new-side lines. */
  readonly skippedRight?: number
}

/**
 * The lines one aligned row becomes in one column.
 *
 * A replaced row becomes two lines — its removal, then its insertion — because
 * one column cannot show both at once; every other row becomes one. A context
 * line carries both numbers: it is the same line on either side.
 * @param row - one aligned row.
 * @returns the lines it draws, in order.
 */
function linesOfRow(row: DiffRow, at: number): InlineLine[] {
  const key = `i${String(at)}`
  if (row.kind === 'gap') {
    return [{
      kind: 'gap',
      key,
      ...row.skippedLeft === undefined ? {} : { skippedLeft: row.skippedLeft },
      ...row.skippedRight === undefined ? {} : { skippedRight: row.skippedRight },
    }]
  }
  const lines: InlineLine[] = []
  if (row.left !== null) {
    lines.push({
      kind: row.kind === 'context' ? 'context' : 'delete',
      key: `${key}l`,
      oldNo: row.left.no,
      ...row.kind === 'context' && row.right !== null ? { newNo: row.right.no } : {},
      text: row.left.text,
    })
  }
  if (row.right !== null && row.kind !== 'context') {
    lines.push({ kind: 'insert', key: `${key}r`, newNo: row.right.no, text: row.right.text })
  }
  return lines
}

/**
 * Flatten aligned rows into the lines a one-column reading draws.
 * @param rows - the aligned rows, as the host sent them.
 * @returns every line, in reading order.
 */
export function inlineLines(rows: readonly DiffRow[]): InlineLine[] {
  return rows.flatMap((row, at) => linesOfRow(row, at))
}

/**
 * Flatten rows the reader has been folding, keeping the folds.
 * @param rows - the display rows {@link collapseRows} produced.
 * @returns every line, in reading order, with each fold in place.
 */
export function inlineDisplayLines(rows: readonly DisplayRow[]): InlineLine[] {
  return rows.flatMap((row, at): InlineLine[] => row.kind === 'fold'
    ? [{ kind: 'fold', key: row.key, hidden: row.hidden }]
    : linesOfRow(row.row, at))
}

/**
 * Split the changed paths into the four groups the panel draws.
 * @param entries - every entry of one status read, in git's own order.
 * @returns the four groups, each empty when nothing belongs to it.
 */
export function groupChanges(entries: readonly ChangeEntry[]): GroupedChanges {
  return {
    conflicted: entries.filter(entry => entry.stage === 'conflicted'),
    staged: entries.filter(entry => entry.stage === 'staged'),
    unstaged: entries.filter(entry => entry.stage === 'unstaged'),
    untracked: entries.filter(entry => entry.stage === 'untracked'),
  }
}

/**
 * Every group that has entries, in drawing order.
 * @param grouped - the four groups.
 * @returns the non-empty groups with their stage and entries.
 */
export function nonEmptyGroups(
  grouped: GroupedChanges,
): readonly { readonly stage: ChangeStage; readonly entries: readonly ChangeEntry[] }[] {
  return STAGE_ORDER
    .map(stage => ({ stage, entries: grouped[stage] }))
    .filter(group => group.entries.length > 0)
}

/** How long an unchanged run may be before it folds. */
const CONTEXT_RUN_LIMIT = 6

/** One drawn line of the diff body. */
export type DisplayRow =
  | { readonly kind: 'diff'; readonly key: string; readonly row: DiffRow }
  | { readonly kind: 'fold'; readonly key: string; readonly hidden: number }

/**
 * Fold long unchanged runs so a small change in a large file reads at a glance.
 *
 * The surviving head and tail use the same split arithmetic as the harness's
 * diff card, so a folded run looks the same wherever it is drawn. A fold's key
 * identifies the run, which is what an expansion set is addressed by.
 *
 * @param rows - the aligned diff rows.
 * @param limit - unchanged lines a run may have before it folds.
 * @param expanded - keys of folds the reader has opened.
 * @returns the rows to draw, with unchanged middles replaced by folds.
 */
export function collapseRows(
  rows: readonly DiffRow[],
  limit: number = CONTEXT_RUN_LIMIT,
  expanded: ReadonlySet<string> = new Set(),
): DisplayRow[] {
  const out: DisplayRow[] = []
  let index = 0
  while (index < rows.length) {
    // `rows[index]` is `| undefined` to the type checker alone; the loop
    // condition is what guarantees a row here. Narrowing it is the check.
    const row = rows[index]
    if (row === undefined) break
    if (row.kind !== 'context') {
      out.push({ kind: 'diff', key: `r${String(index)}`, row })
      index += 1
      continue
    }
    let end = index
    while (end < rows.length && rows[end]?.kind === 'context') end += 1
    const run = end - index
    const head = Math.ceil(limit / 2)
    const tail = limit - head
    const push = (from: number, to: number): void => {
      for (const [offset, row] of rows.slice(from, to).entries()) {
        out.push({ kind: 'diff', key: `r${String(from + offset)}`, row })
      }
    }
    if (run <= limit) {
      push(index, end)
    } else {
      const foldKey = `f${String(index)}:${String(run)}`
      push(index, index + head)
      if (expanded.has(foldKey)) push(index + head, end - tail)
      else out.push({ kind: 'fold', key: foldKey, hidden: run - limit })
      push(end - tail, end)
    }
    index = end
  }
  return out
}
