/**
 * The decisions the page makes about data it already has, as pure functions.
 *
 * Keeping them pure is what lets the browser half be tested without a DOM, a
 * server, or a React root.
 *
 * @module dsh-git/client/data/state
 */

import type { ChangeEntry, ChangeKind, ChangeStage, DiffSource } from '../../api/wire.ts'
import { GitRequestError, type DiffRequest } from './face.ts'

/**
 * One diff the board is showing: what it compares, and its identity.
 */
export interface BoardPane {
  /** The comparison's identity, from {@link diffKey}. */
  readonly key: string
  /** What to ask the host for. */
  readonly request: DiffRequest
}

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
export function parseRefs(refs: readonly string[], upstream?: string | undefined): RefChip[] {
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
      // The branch's own upstream is the header's business: a second capsule saying
      // `origin/main` beside `main` says the same thing twice.
      if (!remote.endsWith('/HEAD') && remote !== upstream) {
        chips.push({ kind: 'remote', name: remote })
      }
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
 * The least the list may be, and the least the diffs may be.
 *
 * There is no upper limit on the list: the reader may give it the whole pane if that
 * is how they read, and the only thing standing in the way is the room a diff needs
 * to be a diff. Both blocks have a floor, neither has a ceiling, and on a pane too
 * narrow for both floors the list's wins — a diff can scroll, a list cannot.
 */
export const RAIL_MIN_WIDTH = 220
export const DIFF_MIN_WIDTH = 420

/**
 * The width the list may take, given the pane it shares.
 * @param width - the width asked for, in pixels.
 * @param paneWidth - the width of the pane both blocks sit in, in pixels.
 * @returns the width to use, in whole pixels.
 */
export function clampRailWidth(width: number, paneWidth: number): number {
  const widest = Math.max(RAIL_MIN_WIDTH, paneWidth - DIFF_MIN_WIDTH)
  return Math.max(RAIL_MIN_WIDTH, Math.min(widest, Math.round(width)))
}

/**
 * Where a diff lands on the board.
 *
 * Reading one diff after another is the common case, so a new one takes the focused
 * pane's place; comparing two is the deliberate one, so the modifier opens beside.
 * Opening the same comparison twice would compare it with itself, which is why one
 * already on the board is only focused.
 *
 * @param panes - the panes now on the board, in order.
 * @param pane - the pane to place.
 * @param beside - whether the reader asked for a second pane.
 * @param focused - the focused pane's key, if any.
 * @returns the panes after the click, or the same array when nothing moved.
 */
export function placePane<Pane extends { readonly key: string }>(
  panes: readonly Pane[],
  pane: Pane,
  beside: boolean,
  focused: string | null,
): readonly Pane[] {
  if (panes.some(existing => existing.key === pane.key)) return panes
  const at = panes.findIndex(existing => existing.key === focused)
  if (beside || at < 0) return [...panes, pane]
  return panes.map((existing, index) => (index === at ? pane : existing))
}

/**
 * The shell's file address for one workspace path.
 *
 * The file view is the shell's, not this page's: opening a file means handing it
 * the address its own type claims (`dsh-resource://file/session/<sessionId>/<path>`),
 * with each path segment percent-encoded. The plugin cannot import that package to
 * borrow the builder — the client module table seeds package names, not subpaths —
 * so the shape is written out here.
 * @param sessionId - the Session whose workspace resolves the path.
 * @param path - a repository-relative path, as git reported it.
 * @returns the address the file view opens.
 */
export function fileAddress(sessionId: string, path: string): string {
  const encoded = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`
}

/**
 * The identity of one diff, as a pane key.
 *
 * A diff is what it compares: the same file at two revisions is a different diff from the
 * same file against the working tree, and each deserves its own pane — while opening the
 * same comparison twice should land on the pane already there.
 * @param request - the comparison one pane shows.
 * @returns a key that is equal for equal comparisons.
 */
export function diffKey(request: {
  readonly source: DiffSource
  readonly path: string
  readonly origPath?: string | undefined
  readonly rev?: string | undefined
}): string {
  return [request.source, request.rev ?? '', request.origPath ?? '', request.path].join('\u0000')
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
