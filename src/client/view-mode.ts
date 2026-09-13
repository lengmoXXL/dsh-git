/**
 * How diffs are drawn, and the one place that remembers it.
 *
 * The editor this panel borrows its diff from keeps the same two choices: two
 * aligned columns or one column in reading order, and whole lines or wrapped
 * ones. Both are properties of the reader, not of the change, so every diff tab
 * follows the same answer and the answer outlives the tab — a preference the
 * browser holds, since the host has no business knowing how a viewer likes its
 * diffs.
 *
 * @module dsh-git/client/view-mode
 */

/** How the diff is laid out. */
export type DiffViewMode =
  /** Two aligned columns: old beside new. */
  | 'split'
  /** One column in reading order: each change as its removal then its insertion. */
  | 'inline'

/** Everything the reader chose about how a diff is drawn. */
export interface DiffViewSettings {
  /** Two columns, or one. */
  readonly mode: DiffViewMode
  /** Whether a line too long for its column wraps instead of scrolling. */
  readonly wrap: boolean
}

/** What a reader who has said nothing gets: the columns, wrapped to fit. */
const DEFAULTS: DiffViewSettings = { mode: 'split', wrap: true }

/** Where each choice is kept between page loads. */
const MODE_KEY = 'dsh-git:diff-view-mode'
const WRAP_KEY = 'dsh-git:diff-view-wrap'

/** The settings last resolved, so a render reads a stable value. */
let current: DiffViewSettings | undefined

/** Who to tell when the settings change. */
const listeners = new Set<() => void>()

/**
 * The remembered settings, or the defaults.
 * @returns the settings to draw with.
 */
export function diffViewSettings(): DiffViewSettings {
  current ??= stored()
  return current
}

/**
 * Read the settings the browser kept.
 *
 * Storage can be denied outright (a hardened browser, a partitioned context) and
 * this runs server-side in the bundle's own tests, so the defaults stand in
 * rather than an error.
 * @returns the stored settings, defaulted field by field.
 */
function stored(): DiffViewSettings {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    return {
      mode: window.localStorage.getItem(MODE_KEY) === 'inline' ? 'inline' : DEFAULTS.mode,
      // Only an explicit "off" turns wrapping off, so a value this plugin never
      // wrote cannot silently change how a diff reads.
      wrap: window.localStorage.getItem(WRAP_KEY) !== 'clip',
    }
  } catch {
    return DEFAULTS
  }
}

/**
 * Choose how the two sides are laid out.
 * @param mode - the layout to draw.
 */
export function setDiffViewMode(mode: DiffViewMode): void {
  apply({ ...diffViewSettings(), mode })
}

/**
 * Choose whether a long line wraps or scrolls.
 * @param wrap - whether to wrap.
 */
export function setDiffWrap(wrap: boolean): void {
  apply({ ...diffViewSettings(), wrap })
}

/**
 * Remember a choice and tell every diff about it.
 * @param next - the settings to draw with.
 */
function apply(next: DiffViewSettings): void {
  const previous = diffViewSettings()
  if (next.mode === previous.mode && next.wrap === previous.wrap) return
  current = next
  try {
    window.localStorage.setItem(MODE_KEY, next.mode)
    window.localStorage.setItem(WRAP_KEY, next.wrap ? 'wrap' : 'clip')
  } catch {
    // The choice still holds for this page; it just will not be remembered.
  }
  for (const listener of listeners) listener()
}

/**
 * Watch the settings, for `useSyncExternalStore`.
 * @param listener - called after every change.
 * @returns the unsubscribe.
 */
export function subscribeDiffViewSettings(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
