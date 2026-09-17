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
import { HISTORY_PREVIEW, LIST_PREVIEW, MoreRow } from './MoreRow.tsx'
import { cx, timeLabel } from './format.ts'
import { logCache } from './log-cache.ts'
import type { GitKey } from './locales.ts'
import { RefChips } from './RefChips.tsx'
import { Section } from './Section.tsx'
import { cached, failureInfoOf, parseRefs, type Load } from './state.ts'
import css from './List.module.css'

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
  /** Open one file of one commit; `beside` asks for a second pane. */
  readonly onSelectFile: (rev: string, file: CommitFile, beside: boolean) => void
  /** Hand one file of a commit to the shell's own file view. */
  readonly onOpenFile?: ((path: string) => void) | undefined
}

/** One commit's row, and the files it changed while it is open. */
function CommitRow({ commit, sessionId, now, t, selected, onToggle, onSelectFile, onOpenFile }: {
  readonly commit: CommitSummary
  readonly sessionId: string
  readonly now: number
  readonly t: Translate<GitKey>
  readonly selected: boolean
  readonly onToggle: (sha: string) => void
  readonly onSelectFile: (rev: string, file: CommitFile, beside: boolean) => void
  readonly onOpenFile?: ((path: string) => void) | undefined
}): ReactNode {
  // A commit's file list never changes, so a list already read is kept and
  // shown again as it was: reopening a row after a diff is not a new question.
  const [files, setFiles] = useState<Load<readonly CommitFile[]>>(
    () => cached(logCache(sessionId).commitFiles.get(commit.sha)),
  )
  const [openFiles, setOpenFiles] = useState(false)

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
              {(openFiles ? files.value : files.value.slice(0, LIST_PREVIEW)).map(file => (
                <FileRow
                  key={`${file.path}:${file.origPath ?? ''}`}
                  path={file.path}
                  origPath={file.origPath}
                  kind={file.kind}
                  t={t}
                  nested
                  onSelect={(beside) => { onSelectFile(commit.sha, file, beside) }}
                  onOpenFile={onOpenFile === undefined ? undefined : () => { onOpenFile(file.path) }}
                />
              ))}
              {files.value.length > LIST_PREVIEW && (
                <MoreRow
                  label={t('list.moreFiles', { n: files.value.length - LIST_PREVIEW })}
                  open={openFiles}
                  t={t}
                  onToggle={() => { setOpenFiles(value => !value) }}
                />
              )}
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
  onOpenFile,
}: HistoryListProps): ReactNode {
  const [open, setOpen] = useState(true)
  // A page of history is a page, not the whole log: the rail shows the newest
  // few and one control for the rest, and the same holds for one commit's files.
  const [openCommits, setOpenCommits] = useState(false)
  // One commit at a time: the files of the commit being read are what the
  // reader is looking at, and a page of fifty open file lists is a page of
  // fifty commits nobody can find again. Which one that is outlives this mount:
  // opening a diff and coming back finds the same list open.
  const [opened, setOpened] = useState<string | null>(() => {
    const remembered = logCache(sessionId).openCommit
    // Nothing said yet: the newest commit's files are open, so the page shows what
    // the repository just did rather than a column of subjects. A reader who closes
    // it has said something, and that is remembered as `null`.
    if (remembered === undefined) return commits[0]?.sha ?? null
    return remembered
  })
  const toggle = useCallback((sha: string) => {
    setOpened((current) => {
      const next = current === sha ? null : sha
      logCache(sessionId).openCommit = next
      return next
    })
  }, [sessionId])
  return (
    <Section
      title={t('history.title')}
      // No count: how many commits a repository holds is not known to either side,
      // and a number that only counts the page in hand would read as the total.
      open={open}
      onToggle={() => { setOpen(value => !value) }}
      t={t}
    >
      {commits.length === 0 && <p className={css.note}>{t('history.empty')}</p>}
      {(openCommits ? commits : commits.slice(0, HISTORY_PREVIEW)).map(commit => (
        <CommitRow
          key={commit.sha}
          commit={commit}
          sessionId={sessionId}
          now={now}
          t={t}
          selected={opened === commit.sha}
          onToggle={toggle}
          onSelectFile={onSelectFile}
          onOpenFile={onOpenFile}
        />
      ))}
      {commits.length > HISTORY_PREVIEW && (
        <MoreRow
          label={t('list.moreCommits')}
          open={openCommits}
          t={t}
          onToggle={() => { setOpenCommits(value => !value) }}
          // The row says there are older commits; whether the host has still more
          // beyond the page in hand is a smaller fact, and it belongs in the
          // tooltip rather than in a second line under the row.
          title={hasMore ? t('history.more') : undefined}
        />
      )}
    </Section>
  )
}
