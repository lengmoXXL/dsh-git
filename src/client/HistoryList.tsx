/**
 * The history half of the log tab: one row per commit. Clicking a row opens the
 * files that commit changed, right under it; clicking one of those files opens
 * that file's diff in its own tab.
 *
 * A row is one line, the way a source-control list draws a commit: the subject
 * takes the width it needs, the author and age trail it in a dimmer tone, and
 * the refs it carries are drawn as chips at the end — the branch the working
 * tree is on leading, in the one solid chip of the row.
 *
 * The file list is read when a row is opened, not with the page: a page of
 * history is fifty commits, and reading fifty change sets to draw one of them
 * would be fifty reads for nothing. Closing and reopening a row reads it again,
 * which is also how a reader retries a read that failed.
 *
 * @module dsh-git/client/HistoryList
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitFile, CommitSummary } from '../shared/wire.ts'
import { gitFace } from './face.ts'
import { FileRow } from './FileRow.tsx'
import { cx, timeLabel } from './format.ts'
import { logCache } from './log-cache.ts'
import type { GitKey } from './locales.ts'
import { RefChips } from './RefChips.tsx'
import { Section } from './Section.tsx'
import { failureInfoOf, parseRefs, type Load } from './state.ts'
import css from './List.module.css'

/**
 * A cached list as a drawn read: nothing cached is still a read in flight.
 * @param value - the cached files, if they were read.
 * @returns the read to draw.
 */
function cached(value: readonly CommitFile[] | undefined): Load<readonly CommitFile[]> {
  return value === undefined ? { phase: 'loading' } : { phase: 'ready', value }
}

/** Props of the history list. */
export interface HistoryListProps {
  /** The commits of the current page, newest first. */
  readonly commits: readonly CommitSummary[]
  /** More commits exist below the page. */
  readonly hasMore: boolean
  /** The Session whose workspace the repository belongs to. */
  readonly sessionId: string
  /** Current epoch milliseconds, injected so the rows render purely. */
  readonly now: number
  /** The tab's translator. */
  readonly t: Translate<GitKey>
  /** Open one file of one commit in its own tab. */
  readonly onSelectFile: (rev: string, file: CommitFile) => void
}

/** One commit's row, and the files it changed while it is open. */
function CommitRow({ commit, sessionId, now, t, selected, onToggle, onSelectFile }: {
  readonly commit: CommitSummary
  readonly sessionId: string
  readonly now: number
  readonly t: Translate<GitKey>
  readonly selected: boolean
  readonly onToggle: (sha: string) => void
  readonly onSelectFile: (rev: string, file: CommitFile) => void
}): ReactNode {
  // A commit's file list never changes, so a list already read is kept and
  // shown again as it was: reopening a row after a diff is not a new question.
  const [files, setFiles] = useState<Load<readonly CommitFile[]>>(
    () => cached(logCache(sessionId).commitFiles.get(commit.sha)),
  )

  // One read per opening: `selected` is this row's own switch, so a commit that
  // is not open never asks the host for anything.
  useEffect(() => {
    if (!selected) return
    if (logCache(sessionId).commitFiles.has(commit.sha)) return
    const controller = new AbortController()
    setFiles({ phase: 'loading' })
    void gitFace.commit(sessionId, commit.sha, controller.signal).then(
      (payload) => {
        if (controller.signal.aborted) return
        logCache(sessionId).commitFiles.set(commit.sha, payload.files)
        setFiles({ phase: 'ready', value: payload.files })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setFiles({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    return () => { controller.abort() }
  }, [selected, sessionId, commit.sha])

  const toggle = useCallback(() => { onToggle(commit.sha) }, [onToggle, commit.sha])
  const chips = parseRefs(commit.refs)
  const current = chips.some(chip => chip.kind === 'head')
  const age = timeLabel(commit.authoredAt, now, t)
  // A row in a narrow pane can be cut before its last chip, so the tooltip
  // repeats every field the row draws.
  const title = [
    commit.subject,
    `${commit.authorName} · ${age} · ${commit.shortSha}`,
    ...chips.length === 0 ? [] : [chips.map(chip => chip.name).join(', ')],
  ].join('\n')

  return (
    <>
      <button
        type="button"
        className={cx(css.row, selected && css.rowOpen)}
        title={title}
        aria-expanded={selected}
        onClick={toggle}
      >
        {/* The node a graph would draw at the left of this row, minus the lanes:
            a filled dot, hollow for a merge, hollow and accented for the commit
            the working tree is on. */}
        <span
          className={cx(css.node, current && css.nodeCurrent, commit.parents.length > 1 && css.nodeMerge)}
          aria-hidden="true"
        />
        <span className={cx(css.subject, current && css.subjectCurrent)}>{commit.subject}</span>
        {/* The author gives way before the age does: a shortened name still says
            who, while half of "2d ago" says nothing. */}
        <span className={css.subjectMeta}>
          <span className={css.author}>{commit.authorName} ·</span>
          <span className={css.age}>{age}</span>
        </span>
        <RefChips chips={chips} />
      </button>
      {selected && (
        <div className={css.files}>
          {files.phase === 'loading' && <p className={css.note}>{t('loading')}</p>}
          {files.phase === 'failed' && <p className={css.fileFailed}>{files.message}</p>}
          {files.phase === 'ready' && files.value.length === 0 && (
            <p className={css.note}>{t('commit.empty')}</p>
          )}
          {files.phase === 'ready' && files.value.length > 0 && (
            <>
              <h4 className={css.group}>
                {t('commit.files')}
                <span className={css.groupCount}>{files.value.length}</span>
              </h4>
              {files.value.map(file => (
                <FileRow
                  key={`${file.path}:${file.origPath ?? ''}`}
                  path={file.path}
                  origPath={file.origPath}
                  kind={file.kind}
                  t={t}
                  nested
                  onSelect={() => { onSelectFile(commit.sha, file) }}
                />
              ))}
            </>
          )}
        </div>
      )}
    </>
  )
}

/**
 * Draw the history.
 * @param props - see {@link HistoryListProps}.
 * @returns the history section.
 */
export function HistoryList({
  commits,
  hasMore,
  sessionId,
  now,
  t,
  onSelectFile,
}: HistoryListProps): ReactNode {
  const [open, setOpen] = useState(true)
  // One commit at a time: the files of the commit being read are what the
  // reader is looking at, and a page of fifty open file lists is a page of
  // fifty commits nobody can find again. Which one that is outlives this mount:
  // opening a diff and coming back finds the same list open.
  const [opened, setOpened] = useState<string | undefined>(
    () => logCache(sessionId).openCommit,
  )
  const toggle = useCallback((sha: string) => {
    setOpened((current) => {
      const next = current === sha ? undefined : sha
      logCache(sessionId).openCommit = next
      return next
    })
  }, [sessionId])
  return (
    <Section
      title={t('history.title')}
      count={commits.length}
      open={open}
      onToggle={() => { setOpen(value => !value) }}
      t={t}
    >
      {commits.length === 0 && <p className={css.note}>{t('history.empty')}</p>}
      {commits.map(commit => (
        <CommitRow
          key={commit.sha}
          commit={commit}
          sessionId={sessionId}
          now={now}
          t={t}
          selected={opened === commit.sha}
          onToggle={toggle}
          onSelectFile={onSelectFile}
        />
      ))}
      {hasMore && <p className={cx(css.note, css.noteMore)}>{t('history.more')}</p>}
    </Section>
  )
}
