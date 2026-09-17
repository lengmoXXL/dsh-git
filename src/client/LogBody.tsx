/**
 * The git page: the Session's changes and history beside the diffs they open.
 *
 * It is a page type, so it takes no address and holds no selection of its own, and
 * it holds the reader's own arrangements — which diffs are open, where the list
 * sits, how the diffs are drawn — because none of that is the host's business.
 *
 * @module dsh-git/client/LogBody
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Button,
  IconBranchOutline16,
  IconRefreshOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BranchStatus,
  ChangeEntry,
  CommitFile,
  CommitSummary,
  HistoryPayload,
  StatusPayload,
} from '../shared/wire.ts'
import { ChangeList } from './ChangeList.tsx'
import { FailureBlock, Note } from './Feedback.tsx'
import { GitBoard } from './GitBoard.tsx'
import { gitFace, type DiffRequest } from './face.ts'
import { OpenFileGlyph } from './glyphs.tsx'
import { HistoryList } from './HistoryList.tsx'
import { logCache } from './log-cache.ts'
import { cx } from './format.ts'
import type { GitKey, GitNamespace } from './locales.ts'
import {
  diffViewSettings,
  RAIL_DEFAULT_WIDTH,
  railSettings,
  setDiffViewMode,
  setDiffWrap,
  setRailOpen,
  setRailSide,
  setRailWidth,
  subscribeDiffViewSettings,
  subscribeRailSettings,
} from './view-mode.ts'
import {
  cached,
  clampRailWidth,
  diffKey,
  failureInfoOf,
  groupChanges,
  placePane,
  type BoardPane,
  type FailureInfo,
  type Load,
} from './state.ts'
import css from './LogBody.module.css'

/** Stable empties, so a not-yet-loaded read does not mint a new array on every render. */
const NO_ENTRIES: readonly ChangeEntry[] = []
const NO_COMMITS: readonly CommitSummary[] = []

/** What the header calls the branch. */
function branchLabel(branch: BranchStatus, t: Translate<GitKey>): string {
  if (branch.detached || branch.branch === null) return t('history.detached')
  return branch.branch
}

/** What the header says about the upstream, or undefined when there is nothing to say. */
function trackingLabel(branch: BranchStatus, t: Translate<GitKey>): string | undefined {
  const parts: string[] = []
  if (branch.ahead > 0) parts.push(t('history.ahead', { n: branch.ahead }))
  if (branch.behind > 0) parts.push(t('history.behind', { n: branch.behind }))
  if (branch.upstream !== null) parts.push(branch.upstream)
  return parts.length === 0 ? undefined : parts.join(' · ')
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
function fileAddress(sessionId: string, path: string): string {
  const encoded = path.split('/').map(segment => encodeURIComponent(segment)).join('/')
  return `dsh-resource://file/session/${encodeURIComponent(sessionId)}/${encoded}`
}

/** The page's composed props: the tab seat, the Session identity, and its dictionary. */
export type LogBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<GitNamespace>
  & { readonly openResource: (address: string, kind: string) => void }

/**
 * Draw the page.
 * @param props - see {@link LogBodyProps}.
 * @returns the tab's body.
 */
export function LogBody({ useTabInfo, sessionId, t, openResource }: LogBodyProps): ReactNode {
  useTabInfo()
  const [epoch, setEpoch] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  // Mount starts from what was read last time — the page, the diffs, and the reader's
  // place in the list — so a tab unmounted for another one comes back as it was.
  const [status, setStatus] = useState<Load<StatusPayload>>(
    () => cached(logCache(sessionId).status),
  )
  const [history, setHistory] = useState<Load<HistoryPayload>>(
    () => cached(logCache(sessionId).history),
  )
  const [panes, setPanes] = useState<readonly BoardPane[]>(() => logCache(sessionId).panes)
  const [focused, setFocused] = useState<string | null>(() => logCache(sessionId).focused)
  const scroller = useRef<HTMLDivElement>(null)

  // One page of the repository's state, both halves at once. A page already in
  // hand keeps drawing while this runs: only a read with nothing to show asks
  // for a spinner.
  useEffect(() => {
    const controller = new AbortController()
    const cache = logCache(sessionId)
    setStatus(current => (current.phase === 'ready' ? current : { phase: 'loading' }))
    setHistory(current => (current.phase === 'ready' ? current : { phase: 'loading' }))
    void gitFace.status(sessionId, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        cache.status = value
        setStatus({ phase: 'ready', value })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setStatus({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    void gitFace.history(sessionId, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        cache.history = value
        setHistory({ phase: 'ready', value })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setHistory({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    return () => { controller.abort() }
  }, [sessionId, epoch])

  // The reader's place in the list, put back after a round trip through another
  // tab. A layout effect so it lands before the frame is painted, and the height it
  // needs is already there because the cached page drew on mount.
  useLayoutEffect(() => {
    const element = scroller.current
    if (element === null) return
    element.scrollTop = logCache(sessionId).scrollTop
  }, [sessionId])

  const refresh = useCallback(() => {
    setNow(Date.now())
    setEpoch(value => value + 1)
  }, [])

  /** Show one comparison, replacing or joining the panes as {@link placePane} decides. */
  const openDiff = useCallback((request: DiffRequest, beside: boolean) => {
    const key = diffKey(request)
    const cache = logCache(sessionId)
    // The board is computed from the cache rather than inside a state updater: an
    // updater runs when React renders, by which time the focus has already moved on,
    // and a pane that cannot find the one it replaces adds itself instead.
    const next = placePane(cache.panes, { key, request }, beside, cache.focused)
    cache.panes = next
    cache.focused = key
    setPanes(next)
    setFocused(key)
  }, [sessionId])

  /**
   * Close the pane the reader is in, and move to the one before it.
   *
   * With nothing focused — after a close — the last pane goes, so pressing Escape
   * walks the board down one diff at a time instead of stopping at the first.
   */
  const closeFocused = useCallback(() => {
    const cache = logCache(sessionId)
    const current = cache.panes
    const at = current.findIndex(pane => pane.key === cache.focused)
    const target = at < 0 ? current.length - 1 : at
    if (target < 0) return
    const next = current.filter((_pane, index) => index !== target)
    const nextFocused = next[Math.min(target, next.length - 1)]?.key ?? null
    cache.panes = next
    cache.focused = nextFocused
    setPanes(next)
    setFocused(nextFocused)
  }, [sessionId])

  const focusPane = useCallback((key: string) => {
    setFocused(key)
    logCache(sessionId).focused = key
  }, [sessionId])

  // A click that fails must say so: a dead click reads as a broken plugin, while a
  // named failure reads as a repository problem.
  const [openFailure, setOpenFailure] = useState<FailureInfo | undefined>(undefined)
  /** Hand one workspace path to the shell's own file view. */
  const openFile = useCallback((path: string) => {
    try {
      openResource(fileAddress(sessionId, path), 'text')
      setOpenFailure(undefined)
    } catch (error: unknown) {
      setOpenFailure(failureInfoOf(error))
    }
  }, [openResource, sessionId])
  const openChange = useCallback((entry: ChangeEntry, beside: boolean) => {
    // An unstaged change compares the index against the working tree; a staged one
    // compares HEAD against the index.
    openDiff({
      sessionId,
      source: entry.stage === 'staged' ? 'index' : 'worktree',
      path: entry.path,
      origPath: entry.origPath,
    }, beside)
  }, [openDiff, sessionId])
  const openCommitFile = useCallback((rev: string, file: CommitFile, beside: boolean) => {
    openDiff({
      sessionId,
      source: 'commit',
      rev,
      path: file.path,
      origPath: file.origPath,
    }, beside)
  }, [openDiff, sessionId])

  const focusedPane = panes.find(pane => pane.key === focused)

  const settings = useSyncExternalStore(
    subscribeDiffViewSettings,
    diffViewSettings,
    diffViewSettings,
  )
  const rail = useSyncExternalStore(subscribeRailSettings, railSettings, railSettings)
  // While the grip is held the width follows the pointer locally, and one write goes
  // to storage when it is let go: a drag is not a reason to touch storage sixty times
  // a second. The list can sit against either edge, so the pointer's distance from
  // that edge is the width.
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const listOnRight = rail.side === 'right'
  // The drawer's arrow points at the edge the list is nearest, so the control means
  // "put it away" wherever the list has been moved to.
  const drawerGlyph = rail.open === listOnRight ? '›' : '‹'
  const dragWidth = (event: ReactPointerEvent<HTMLDivElement>): void => {
    setDragging(clampRailWidth(
      listOnRight ? window.innerWidth - event.clientX : event.clientX,
      window.innerWidth,
    ))
  }
  const railWidth = dragging ?? rail.width

  // Keys for what a reader does all day: a pane goes away with Escape, the list with
  // `b`, and the two switches with `w` and `i`.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Asked by shape rather than by `instanceof`: an environment without that
      // constructor would otherwise throw on every key pressed.
      const target = event.target as { tagName?: string; isContentEditable?: boolean } | null
      if (target?.isContentEditable === true || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      if (event.key === 'Escape' && focusedPane !== undefined) closeFocused()
      if (event.key === 'b') setRailOpen(!railSettings().open)
      if (event.key === 'w') setDiffWrap(!diffViewSettings().wrap)
      if (event.key === 'i') setDiffViewMode(diffViewSettings().mode === 'inline' ? 'split' : 'inline')
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closeFocused, focusedPane])


  /** Move down the list with the arrows: a rail of twenty rows is twenty tabs. */
  const onRailKey = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const rows = [...event.currentTarget.querySelectorAll<HTMLElement>('button')]
    const at = rows.indexOf(document.activeElement as HTMLElement)
    if (at < 0) return
    event.preventDefault()
    const next = rows[at + (event.key === 'ArrowDown' ? 1 : -1)]
    next?.focus()
    next?.scrollIntoView({ block: 'nearest' })
  }

  const ready = status.phase === 'ready' ? status.value : undefined
  const repo = ready?.repo ?? null
  const grouped = groupChanges(ready?.entries ?? NO_ENTRIES)
  const tracking = repo === null ? undefined : trackingLabel(repo.branch, t)
  // The header names the branch and nothing else; which repository it is lives in
  // this tooltip, where it can be read without holding a slot on every screen.
  const branchTitle = repo === null
    ? ''
    : [repo.root, branchLabel(repo.branch, t), tracking ?? ''].filter(part => part !== '').join(' · ')

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <button
          type="button"
          className={css.control}
          title={rail.open ? t('panel.railHide') : t('panel.railShow')}
          aria-label={rail.open ? t('panel.railHide') : t('panel.railShow')}
          aria-expanded={rail.open}
          onClick={() => { setRailOpen(!rail.open) }}
        >
          {drawerGlyph}
        </button>
        <button
          type="button"
          className={css.control}
          title={listOnRight ? t('panel.railLeft') : t('panel.railRight')}
          aria-label={listOnRight ? t('panel.railLeft') : t('panel.railRight')}
          onClick={() => { setRailSide(listOnRight ? 'left' : 'right') }}
        >
          {listOnRight ? '◨' : '◧'}
        </button>
        {repo !== null && (
          <span className={css.branch} title={branchTitle}>
            <IconBranchOutline16 size={12} className={css.branchIcon} />
            <span className={css.branchName}>{branchLabel(repo.branch, t)}</span>
          </span>
        )}
        <span className={css.spacer} />
        <button
          type="button"
          className={css.control}
          title={t('diff.openFile')}
          aria-label={t('diff.openFile')}
          disabled={focusedPane === undefined}
          onClick={() => {
            if (focusedPane !== undefined) openFile(focusedPane.request.path)
          }}
        >
          <OpenFileGlyph />
        </button>
        {/* The switches are the reader's, not a pane's: two panes showing two sets
            of them is the same question asked twice. Each pair names both of its
            answers, so which one is in force is read rather than guessed at. */}
        <span className={css.switch}>
          <button
            type="button"
            className={cx(css.option, settings.mode === 'split' && css.optionOn)}
            aria-pressed={settings.mode === 'split'}
            aria-label={t('diff.splitView')}
            onClick={() => { setDiffViewMode('split') }}
          >
            {t('diff.split')}
          </button>
          <button
            type="button"
            className={cx(css.option, settings.mode === 'inline' && css.optionOn)}
            aria-pressed={settings.mode === 'inline'}
            aria-label={t('diff.inlineView')}
            onClick={() => { setDiffViewMode('inline') }}
          >
            {t('diff.inline')}
          </button>
        </span>
        <span className={css.switch}>
          <button
            type="button"
            className={cx(css.option, settings.wrap && css.optionOn)}
            aria-pressed={settings.wrap}
            aria-label={t('diff.wrapView')}
            onClick={() => { setDiffWrap(true) }}
          >
            {t('diff.wrap')}
          </button>
          <button
            type="button"
            className={cx(css.option, !settings.wrap && css.optionOn)}
            aria-pressed={!settings.wrap}
            aria-label={t('diff.clipView')}
            onClick={() => { setDiffWrap(false) }}
          >
            {t('diff.clip')}
          </button>
        </span>
        <Button
          className={css.refresh}
          variant="ghost"
          size="sm"
          icon={<IconRefreshOutline16 />}
          onClick={refresh}
        >
          {t('panel.refresh')}
        </Button>
      </header>
      <div className={css.body} data-side={rail.side}>
        {/* The list stays mounted when it is put away, so the reader's place in it
            is still there when it comes back. */}
        <div
          className={css.list}
          style={{ width: rail.open ? `${String(railWidth)}px` : '0px' }}
          aria-hidden={!rail.open}
          ref={scroller}
          onKeyDown={onRailKey}
          onScroll={(event) => { logCache(sessionId).scrollTop = event.currentTarget.scrollTop }}
        >
          {status.phase === 'failed' && (
            <FailureBlock code={status.code} message={status.message} t={t} onRetry={refresh} />
          )}
          {openFailure !== undefined && (
            <FailureBlock code={openFailure.code} message={openFailure.message} t={t} onRetry={undefined} />
          )}
          {status.phase === 'loading' && <Note>{t('loading')}</Note>}
          {status.phase === 'ready' && repo === null && <Note>{t('panel.noRepo')}</Note>}
          {repo !== null && (
            <>
              <ChangeList
                grouped={grouped}
                truncated={ready?.truncated ?? false}
                t={t}
                onSelect={openChange}
                onOpenFile={openFile}
              />
              {history.phase === 'failed'
                ? <FailureBlock code={history.code} message={history.message} t={t} onRetry={refresh} />
                : (
                  <HistoryList
                    commits={history.phase === 'ready' ? history.value.commits : NO_COMMITS}
                    hasMore={history.phase === 'ready' && history.value.hasMore}
                    sessionId={sessionId}
                    now={now}
                    t={t}
                    onSelectFile={openCommitFile}
                    onOpenFile={openFile}
                    upstream={ready?.repo?.branch.upstream ?? undefined}
                  />
                )}
            </>
          )}
        </div>
        {rail.open && (
          <div
            className={css.grip}
            role="separator"
            aria-orientation="vertical"
            aria-label={t('panel.resize')}
            title={t('panel.resize')}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId)
              setDragging(rail.width)
            }}
            onPointerMove={(event) => { dragWidth(event) }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId)
              if (dragging !== undefined) setRailWidth(dragging)
              setDragging(undefined)
            }}
            onPointerCancel={() => { setDragging(undefined) }}
            onDoubleClick={() => { setRailWidth(RAIL_DEFAULT_WIDTH) }}
          />
        )}
        <GitBoard panes={panes} focused={focused} t={t} onFocus={focusPane} />
      </div>
    </div>
  )
}
