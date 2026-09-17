/**
 * What the log tab remembers while the reader is somewhere else.
 *
 * A pane draws only its active tab, so opening a diff unmounts this tab and
 * everything it held: the page it had read, the commit it had expanded, the
 * files that commit's list had read, and where it was scrolled to. None of that
 * is the host's to remember, and coming back from a diff should not blank the
 * list to a spinner and fold the commit again — so it lives here, keyed by
 * Session, for as long as the page does.
 *
 * A commit's file list is immutable, so it is read once and kept; the status
 * and history are not, so they are cached to paint with and re-read anyway. The
 * board is kept too: which diffs the reader had open, and which one they were in,
 * is the same kind of fact as where they had scrolled to.
 *
 * @module dsh-git/client/log-cache
 */

import type { CommitFile, HistoryPayload, StatusPayload } from '../shared/wire.ts'
import type { BoardPane } from './state.ts'

/** One Session's remembered log. */
export interface LogCache {
  /** The last status read, kept to paint with while the next one arrives. */
  status?: StatusPayload | undefined
  /** The last history read, kept for the same reason. */
  history?: HistoryPayload | undefined
  /**
   * The commit whose file list is open. `undefined` is a reader who has not said;
   * `null` is one who closed the newest commit's list, which is a choice and not a
   * silence — the difference decides what the page opens with.
   */
  openCommit?: string | null | undefined
  /** File lists read so far, by commit id. */
  readonly commitFiles: Map<string, readonly CommitFile[]>
  /** Where the list was scrolled to, in pixels. */
  scrollTop: number
  /** The diffs the board is showing, in order. */
  panes: readonly BoardPane[]
  /** The pane the next diff will land in, if any. */
  focused: string | null
}

/** One cache per Session, for the life of the page. */
const caches = new Map<string, LogCache>()

/**
 * The cache for one Session, created empty on first use.
 * @param sessionId - the Session whose workspace the log is showing.
 * @returns its cache, to read from and write through.
 */
export function logCache(sessionId: string): LogCache {
  let cache = caches.get(sessionId)
  if (cache === undefined) {
    cache = { commitFiles: new Map(), scrollTop: 0, panes: [], focused: null }
    caches.set(sessionId, cache)
  }
  return cache
}
