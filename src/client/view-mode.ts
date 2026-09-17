/**
 * How the page is arranged, and the one place that remembers it.
 *
 * Two kinds of choice live here, and both are the reader's rather than the
 * change's. They are kept in two stores rather than one because
 * `useSyncExternalStore` compares snapshots by identity: a snapshot that carried both
 * groups would be a new object whenever either changed, and would redraw every diff
 * when the list was dragged a pixel. How a diff is drawn — two aligned columns or one in reading order,
 * whole lines or wrapped ones — so every diff follows the same answer. And where
 * the list sits — which side, how wide, whether it is put away — so the page opens
 * the way it was left. None of it is the host's business, so the browser holds it.
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

/** Which side of the page the list is on. */
export type RailSide = 'left' | 'right'

/** Everything the reader chose about the list's place on the page. */
export interface RailSettings {
  /** The edge the list sits against. */
  readonly side: RailSide
  /** How wide it is, in pixels. */
  readonly width: number
  /** Whether it is showing at all. */
  readonly open: boolean
}

/** The width the list falls back to, and what double-clicking its grip restores. */
export const RAIL_DEFAULT_WIDTH = 336

/** What a reader who has said nothing gets: a comfortable list on the left. */
const RAIL_DEFAULTS: RailSettings = { side: 'left', width: RAIL_DEFAULT_WIDTH, open: true }

/** Where each choice is kept between page loads. */
const SIDE_KEY = 'dsh-git:rail-side'
const WIDTH_KEY = 'dsh-git:rail-width'
const OPEN_KEY = 'dsh-git:rail-open'

/** The settings last resolved, so a render reads a stable value. */
let currentRail: RailSettings | undefined

/** Who to tell when the list's place changes. */
const railListeners = new Set<() => void>()

/**
 * The remembered place of the list, or the defaults.
 * @returns the settings to lay the page out with.
 */
export function railSettings(): RailSettings {
  currentRail ??= storedRail()
  return currentRail
}

/**
 * Read the list's place from the browser.
 * @returns the stored settings, defaulted field by field.
 */
function storedRail(): RailSettings {
  if (typeof window === 'undefined') return RAIL_DEFAULTS
  try {
    const width = Number(window.localStorage.getItem(WIDTH_KEY))
    return {
      side: window.localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : RAIL_DEFAULTS.side,
      width: Number.isFinite(width) && width > 0 ? width : RAIL_DEFAULTS.width,
      // Only an explicit "shut" puts the list away, so a value this plugin never
      // wrote cannot hide the list on someone.
      open: window.localStorage.getItem(OPEN_KEY) !== '0',
    }
  } catch {
    return RAIL_DEFAULTS
  }
}

/**
 * Put the list on one side or the other.
 * @param side - the edge to sit against.
 */
export function setRailSide(side: RailSide): void {
  applyRail({ ...railSettings(), side })
}

/**
 * Set how wide the list is.
 * @param width - the width to use; clamped by the caller's window.
 */
export function setRailWidth(width: number): void {
  applyRail({ ...railSettings(), width })
}

/**
 * Show the list or put it away.
 * @param open - whether it is showing.
 */
export function setRailOpen(open: boolean): void {
  applyRail({ ...railSettings(), open })
}

/**
 * Remember a choice and tell the page about it.
 * @param next - the settings to lay out with.
 */
function applyRail(next: RailSettings): void {
  const previous = railSettings()
  if (
    next.side === previous.side
    && next.width === previous.width
    && next.open === previous.open
  ) return
  currentRail = next
  try {
    window.localStorage.setItem(SIDE_KEY, next.side)
    window.localStorage.setItem(WIDTH_KEY, String(next.width))
    window.localStorage.setItem(OPEN_KEY, next.open ? '1' : '0')
  } catch {
    // The choice still holds for this page; it just will not be remembered.
  }
  for (const listener of railListeners) listener()
}

/**
 * Watch the list's place, for `useSyncExternalStore`.
 * @param listener - called after every change.
 * @returns the unsubscribe.
 */
export function subscribeRailSettings(listener: () => void): () => void {
  railListeners.add(listener)
  return () => { railListeners.delete(listener) }
}
