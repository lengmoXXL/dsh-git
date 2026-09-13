/**
 * The git log tab: the current Session's changes and history, as one list.
 *
 * It is a page type, so it takes no address and holds no selection. Every row
 * is a navigation: clicking a change or a commit opens that content in its own
 * resource tab beside this one, which is what keeps a log entry and the diff of
 * a log entry separable — you can leave the log where it is and stack diffs.
 *
 * The workspace is resolved on the host from the Session identity this seat
 * supplies; nothing here sends a path the host did not already report.
 *
 * @module dsh-git/client/LogBody
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { gitFace } from './face.ts'
import { diffAddress } from './git-address.ts'
import { HistoryList } from './HistoryList.tsx'
import type { GitKey, GitNamespace } from './locales.ts'
import { failureInfoOf, groupChanges, type Load } from './state.ts'
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

/** The log tab's composed props: the tab seat, the Session identity, and its dictionary. */
export type LogBodyProps =
  & PropsRuntime<'sidebar.right.pane.tab'>
  & PropsLocale<GitNamespace>
  & { readonly openResource: (address: string) => void }

/**
 * Draw the log.
 * @param props - see {@link LogBodyProps}.
 * @returns the tab's body.
 */
export function LogBody({ useTabInfo, sessionId, t, openResource }: LogBodyProps): ReactNode {
  useTabInfo()
  const [epoch, setEpoch] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [status, setStatus] = useState<Load<StatusPayload>>({ phase: 'loading' })
  const [history, setHistory] = useState<Load<HistoryPayload>>({ phase: 'loading' })

  // One page of the repository's state, both halves at once.
  useEffect(() => {
    const controller = new AbortController()
    setStatus({ phase: 'loading' })
    setHistory({ phase: 'loading' })
    void gitFace.status(sessionId, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setStatus({ phase: 'ready', value }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setStatus({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    void gitFace.history(sessionId, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setHistory({ phase: 'ready', value }) },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setHistory({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    return () => { controller.abort() }
  }, [sessionId, epoch])

  const refresh = useCallback(() => {
    setNow(Date.now())
    setEpoch(value => value + 1)
  }, [])
  // A click that fails must say so: a dead click reads as a broken plugin,
  // while a named failure reads as a repository problem.
  const [openFailure, setOpenFailure] = useState<string | undefined>(undefined)
  const open = useCallback((address: string) => {
    try {
      openResource(address)
      setOpenFailure(undefined)
    } catch (error: unknown) {
      setOpenFailure(failureInfoOf(error).message)
    }
  }, [openResource])
  const openChange = useCallback((entry: ChangeEntry) => {
    // An unstaged change compares the index against the working tree; a staged
    // one compares HEAD against the index.
    open(diffAddress({
      sessionId,
      source: entry.stage === 'staged' ? 'index' : 'worktree',
      path: entry.path,
      ...entry.origPath === undefined ? {} : { origPath: entry.origPath },
    }))
  }, [open, sessionId])
  // A commit's own tab is no longer offered: the log expands a commit into its
  // files, and a click opens one of them. The address still resolves, so a tab
  // restored from an older session keeps drawing.
  const openCommitFile = useCallback((rev: string, file: CommitFile) => {
    open(diffAddress({
      sessionId,
      source: 'commit',
      rev,
      path: file.path,
      ...file.origPath === undefined ? {} : { origPath: file.origPath },
    }))
  }, [open, sessionId])

  const ready = status.phase === 'ready' ? status.value : undefined
  const repo = ready?.repo ?? null
  const grouped = groupChanges(ready?.entries ?? NO_ENTRIES)
  const tracking = repo === null ? undefined : trackingLabel(repo.branch, t)

  return (
    <div className={css.panel}>
      <header className={css.header}>
        <span className={css.repoName} title={repo?.root ?? ''}>{repo?.name ?? ''}</span>
        {repo !== null && (
          <span className={css.branch}>
            <IconBranchOutline16 size={12} className={css.branchIcon} />
            <span className={css.branchName}>{branchLabel(repo.branch, t)}</span>
          </span>
        )}
        {tracking !== undefined && <span className={css.tracking}>{tracking}</span>}
        <span className={css.spacer} />
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
      <div className={css.scroll}>
        {status.phase === 'failed' && (
          <FailureBlock code={status.code} message={status.message} t={t} onRetry={refresh} />
        )}
        {openFailure !== undefined && <FailureBlock code="git/bad-request" message={openFailure} t={t} onRetry={undefined} />}
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
    </div>
  )
}
