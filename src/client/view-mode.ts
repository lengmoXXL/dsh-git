/**
 * Which way a diff is drawn, and the one place that remembers it.
 *
 * The editor this panel borrows its diff from keeps the same choice: two
 * aligned columns, or one column in reading order. It is a property of the
 * reader, not of the change, so every diff tab follows the same answer and the
 * answer outlives the tab — a preference the browser holds, since the host has
 * no business knowing how a viewer likes its diffs.
 *
 * @module dsh-git/client/view-mode
 */

/** How the diff is laid out. */
export type DiffViewMode =
  /** Two aligned columns: old beside new. */
  | 'split'
  /** One column in reading order: each change as its removal then its insertion. */
  | 'inline'

/** Where the choice is kept between page loads. */
const STORAGE_KEY = 'dsh-git:diff-view-mode'

/** The mode last resolved, so a render reads a stable value. */
let current: DiffViewMode | undefined

/** Who to tell when the mode changes. */
const listeners = new Set<() => void>()

/**
 * The remembered mode, or the default.
 * @returns the mode to draw.
 */
export function diffViewMode(): DiffViewMode {
  if (current !== undefined) return current
  current = stored()
  return current
}

/**
 * Read the mode the browser kept.
 *
 * Storage can be denied outright (a hardened browser, a partitioned context) and
 * this runs server-side in the bundle's own tests, so the default is the split
 * view rather than an error.
 * @returns the stored mode, or `split`.
 */
function stored(): DiffViewMode {
  if (typeof window === 'undefined') return 'split'
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'inline' ? 'inline' : 'split'
  } catch {
    return 'split'
  }
}

/**
 * Choose how diffs are drawn from now on.
 * @param next - the mode to draw.
 */
export function setDiffViewMode(next: DiffViewMode): void {
  if (next === diffViewMode()) return
  current = next
  try {
    window.localStorage.setItem(STORAGE_KEY, next)
  } catch {
    // The choice still holds for this page; it just will not be remembered.
  }
  for (const listener of listeners) listener()
}

/**
 * Watch the mode, for `useSyncExternalStore`.
 * @param listener - called after every change.
 * @returns the unsubscribe.
 */
export function subscribeDiffViewMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
