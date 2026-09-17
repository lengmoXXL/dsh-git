/**
 * The git page: the Session's changes and history on the left, the diffs they open
 * on the right.
 *
 * It is a page type, so it takes no address and holds no selection of its own. The
 * list is a way in, not a thing that gets replaced: clicking a change or a file
 * loads that comparison into a pane beside it, which is why a reader can leave the
 * list where it is and stack two diffs to compare.
 *
 * The workspace is resolved on the host from the Session identity this seat
 * supplies; nothing here sends a path the host did not already report.
 *
 * The list is a snapshot, not a subscription: a repository that changes underneath
 * it is re-read by the refresh control, or by mounting the tab again. Watching the
 * filesystem is the host's to offer, and this plugin does not ask.
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
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import {
  Button,
  IconBranchOutline16,
  IconRefreshOutline16,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  BranchStatus,
  ChangeEntry,
  CommitFile,
  CommitSummary,
  DiffPayload,
  HistoryPayload,
  StatusPayload,
} from '../shared/wire.ts'
import { ChangeList } from './ChangeList.tsx'
import { FailureBlock, Note } from './Feedback.tsx'
import { GitBoard } from './GitBoard.tsx'
import { gitFace, type DiffRequest } from './face.ts'
import {
  ClipLinesGlyph,
  InlineLayoutGlyph,
  OpenFileGlyph,
  SplitLayoutGlyph,
  WrapLinesGlyph,
} from './glyphs.tsx'
import { HistoryList } from './HistoryList.tsx'
import { logCache } from './log-cache.ts'
import type { GitKey, GitNamespace } from './locales.ts'
import {
  clampRailWidth,
  diffViewSettings,
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
  diffKey,
  diffText,
  failureInfoOf,
  groupChanges,
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
 * so the shape is written out here, and the kind is named rather than left to the
 * registry's claim ranking.
 * @param sessionId - the Session whose workspace resolves the path.
 * @param path - a repository-relative path, as git reported it.
 * @returns the address the file view opens.
 */
export function fileAddress(sessionId: string, path: string): string {
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
  // Mount starts from what was read last time, so a tab that was unmounted for
  // another one comes back drawn rather than blank.
  const [status, setStatus] = useState<Load<StatusPayload>>(
    () => cached(logCache(sessionId).status),
  )
  const [history, setHistory] = useState<Load<HistoryPayload>>(
    () => cached(logCache(sessionId).history),
  )
  // The panes live as long as the page does: switching to another tab and back
  // finds the comparison the reader had set up.
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

  /** Show one comparison, replacing the focused pane or opening the first one. */
  const openDiff = useCallback((request: DiffRequest) => {
    const key = diffKey(request)
    const cache = logCache(sessionId)
    setPanes((current) => {
      if (current.some(pane => pane.key === key)) return current
      const at = current.findIndex(pane => pane.key === cache.focused)
      const next = at < 0
        ? [...current, { key, request }]
        : current.map((pane, index) => (index === at ? { key, request } : pane))
      cache.panes = next
      return next
    })
    setFocused(key)
    cache.focused = key
  }, [sessionId])

  const closeFocused = useCallback(() => {
    const cache = logCache(sessionId)
    setPanes((current) => {
      const next = current.filter(pane => pane.key !== cache.focused)
      cache.panes = next
      return next
    })
    setFocused(null)
    cache.focused = null
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
  const openChange = useCallback((entry: ChangeEntry) => {
    // An unstaged change compares the index against the working tree; a staged one
    // compares HEAD against the index.
    openDiff({
      sessionId,
      source: entry.stage === 'staged' ? 'index' : 'worktree',
      path: entry.path,
      origPath: entry.origPath,
    })
  }, [openDiff, sessionId])
  const openCommitFile = useCallback((rev: string, file: CommitFile) => {
    openDiff({
      sessionId,
      source: 'commit',
      rev,
      path: file.path,
      origPath: file.origPath,
    })
  }, [openDiff, sessionId])

  const focusedPane = panes.find(pane => pane.key === focused)

  // The page's controls act on the pane the reader is in, and the page cannot see
  // into a pane's read: each pane reports its diff as it arrives.
  const [diffs, setDiffs] = useState<ReadonlyMap<string, DiffPayload>>(() => new Map())
  const onLoaded = useCallback((key: string, diff: DiffPayload) => {
    setDiffs(current => new Map(current).set(key, diff))
  }, [])
  const focusedDiff = focused === null ? undefined : diffs.get(focused)
  const settings = useSyncExternalStore(
    subscribeDiffViewSettings,
    diffViewSettings,
    diffViewSettings,
  )
  const rail = useSyncExternalStore(subscribeRailSettings, railSettings, railSettings)
  // While the grip is held the width follows the pointer locally, and one write
  // goes to storage when it is let go: a drag is not a reason to touch storage
  // sixty times a second.
  const [dragging, setDragging] = useState<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    if (focusedDiff === undefined) return
    void writeClipboard(diffText(focusedDiff)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [focusedDiff])

  // Escape closes the pane the reader is in, which is the only way a pane goes
  // away: a pane is replaced by the next diff, not dismissed from over the code.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // A page that eats keystrokes while someone is typing is a page that cannot
      // be typed in; the composer may be elsewhere, but the rule costs nothing.
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.key === 'Escape' && focusedPane !== undefined) closeFocused()
      if (event.key === 'b') setRailOpen(!railSettings().open)
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey) }
  }, [closeFocused, focusedPane])

  // Which way the drawer's arrow points: at the edge the list is nearest, so the
  // same control means "put it away" wherever the list has been moved to.
  const listOnRight = rail.side === 'right'
  const drawerGlyph = rail.open === listOnRight ? '›' : '‹'

  /** Follow the pointer while the grip is held, clamped to what a diff can spare. */
  const dragWidth = (event: ReactPointerEvent<HTMLDivElement>): void => {
    setDragging(clampRailWidth(
      listOnRight ? window.innerWidth - event.clientX : event.clientX,
      window.innerWidth,
    ))
  }
  const railWidth = dragging ?? rail.width

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
        <button
          type="button"
          className={css.control}
          title={t('diff.copy')}
          aria-label={t('diff.copy')}
          disabled={focusedDiff === undefined}
          onClick={copy}
        >
          {copied ? t('diff.copied') : t('diff.copy')}
        </button>
        {/* The switches are the reader's, not a pane's: two panes showing two sets
            of them is the same question asked twice. */}
        <button
          type="button"
          className={css.control}
          title={settings.mode === 'inline' ? t('diff.splitView') : t('diff.inlineView')}
          aria-label={settings.mode === 'inline' ? t('diff.splitView') : t('diff.inlineView')}
          onClick={() => { setDiffViewMode(settings.mode === 'inline' ? 'split' : 'inline') }}
        >
          {settings.mode === 'inline' ? <SplitLayoutGlyph /> : <InlineLayoutGlyph />}
        </button>
        <button
          type="button"
          className={css.control}
          title={settings.wrap ? t('diff.clipView') : t('diff.wrapView')}
          aria-label={settings.wrap ? t('diff.clipView') : t('diff.wrapView')}
          onClick={() => { setDiffWrap(!settings.wrap) }}
        >
          {settings.wrap ? <ClipLinesGlyph /> : <WrapLinesGlyph />}
        </button>
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
            onDoubleClick={() => { setRailWidth(336) }}
          />
        )}
        <GitBoard
          panes={panes}
          focused={focused}
          t={t}
          onFocus={focusPane}
          onLoaded={onLoaded}
        />
      </div>
    </div>
  )
}
