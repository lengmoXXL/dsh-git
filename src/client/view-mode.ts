/**
 * How the page is arranged, and the one place that remembers it.
 *
 * Two kinds of choice live here, and both are the reader's rather than the change's: how a diff
 * is drawn, so that every diff follows the same answer, and where the list sits, so that the page
 * opens the way it was left. They are two stores because `useSyncExternalStore` compares
 * snapshots by identity: one store holding both would be a new snapshot whenever either changed,
 * and dragging the list a pixel would redraw every diff. Neither choice is the host's business,
 * so the browser holds them.
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

/** How the diff is drawn for a reader who has said nothing: the columns, wrapped to fit. */
const DEFAULTS: DiffViewSettings = { mode: 'split', wrap: true }

/** Where each choice is kept between page loads. */
const MODE_KEY = 'dsh-git:diff-view-mode'
const WRAP_KEY = 'dsh-git:diff-view-wrap'

/** One remembered choice: what it is now, and how to change it. */
interface Store<T> {
  readonly get: () => T
  readonly set: (next: T) => void
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * Build one remembered choice.
 *
 * Reading is attempted once, and a browser that refuses storage — or a server rendering the page,
 * which has none — leaves the defaults standing. A write that fails still holds for the page it
 * was made on; it simply will not be remembered.
 *
 * @param defaults - what a reader who has said nothing gets.
 * @param read - read the stored value.
 * @param same - whether two values are the same choice, so an unchanged one redraws nothing.
 * @param write - store the value.
 * @returns the store the page reads and changes.
 */
function createStore<T>(
  defaults: T,
  read: () => T,
  same: (left: T, right: T) => boolean,
  write: (value: T) => void,
): Store<T> {
  let resolved: T | undefined
  const listeners = new Set<() => void>()
  const get = (): T => {
    if (resolved === undefined) {
      try {
        resolved = read()
      } catch {
        resolved = defaults
      }
    }
    return resolved
  }
  return {
    get,
    set: (next) => {
      if (same(next, get())) return
      resolved = next
      try {
        write(next)
      } catch {
        // The choice still holds for this page; it just will not be remembered.
      }
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

const diffStore = createStore<DiffViewSettings>(
  DEFAULTS,
  () => ({
    mode: window.localStorage.getItem(MODE_KEY) === 'inline' ? 'inline' : DEFAULTS.mode,
    // Only an explicit "off" turns wrapping off, so a value this plugin never wrote
    // cannot silently change how a diff reads.
    wrap: window.localStorage.getItem(WRAP_KEY) !== 'clip',
  }),
  (left, right) => left.mode === right.mode && left.wrap === right.wrap,
  (value) => {
    window.localStorage.setItem(MODE_KEY, value.mode)
    window.localStorage.setItem(WRAP_KEY, value.wrap ? 'wrap' : 'clip')
  },
)

/** The remembered way diffs are drawn, or the defaults. */
export const diffViewSettings = diffStore.get

/** Watch the way diffs are drawn, for `useSyncExternalStore`. */
export const subscribeDiffViewSettings = diffStore.subscribe

/**
 * Choose how the two sides are laid out.
 * @param mode - the layout to draw.
 */
export function setDiffViewMode(mode: DiffViewMode): void {
  diffStore.set({ ...diffStore.get(), mode })
}

/**
 * Choose whether a long line wraps or scrolls.
 * @param wrap - whether to wrap.
 */
export function setDiffWrap(wrap: boolean): void {
  diffStore.set({ ...diffStore.get(), wrap })
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

const railStore = createStore<RailSettings>(
  RAIL_DEFAULTS,
  () => {
    const width = Number(window.localStorage.getItem(WIDTH_KEY))
    return {
      side: window.localStorage.getItem(SIDE_KEY) === 'right' ? 'right' : RAIL_DEFAULTS.side,
      width: Number.isFinite(width) && width > 0 ? width : RAIL_DEFAULTS.width,
      // Only an explicit "shut" puts the list away, so a value this plugin never
      // wrote cannot hide the list on someone.
      open: window.localStorage.getItem(OPEN_KEY) !== '0',
    }
  },
  (left, right) => left.side === right.side && left.width === right.width && left.open === right.open,
  (value) => {
    window.localStorage.setItem(SIDE_KEY, value.side)
    window.localStorage.setItem(WIDTH_KEY, String(value.width))
    window.localStorage.setItem(OPEN_KEY, value.open ? '1' : '0')
  },
)

/** The remembered place of the list, or the defaults. */
export const railSettings = railStore.get

/** Watch the list's place, for `useSyncExternalStore`. */
export const subscribeRailSettings = railStore.subscribe

/**
 * Put the list on one side or the other.
 * @param side - the edge to sit against.
 */
export function setRailSide(side: RailSide): void {
  railStore.set({ ...railStore.get(), side })
}

/**
 * Set how wide the list is.
 * @param width - the width to use; clamped by the caller's window.
 */
export function setRailWidth(width: number): void {
  railStore.set({ ...railStore.get(), width })
}

/**
 * Show the list or put it away.
 * @param open - whether it is showing.
 */
export function setRailOpen(open: boolean): void {
  railStore.set({ ...railStore.get(), open })
}
