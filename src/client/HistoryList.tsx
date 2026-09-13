/**
 * The history half of the log tab: one row per commit, each opening that
 * commit's whole change set in its own tab.
 *
 * @module dsh-git/client/HistoryList
 */

import { Fragment, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitSummary } from '../shared/wire.ts'
import { cx, timeLabel } from './format.ts'
import type { GitKey } from './locales.ts'
import css from './List.module.css'

/** Props of the history list. */
export interface HistoryListProps {
  /** The commits of the current page, newest first. */
  readonly commits: readonly CommitSummary[]
  /** More commits exist below the page. */
  readonly hasMore: boolean
  /** Current epoch milliseconds, injected so the rows render purely. */
  readonly now: number
  /** The tab's translator. */
  readonly t: Translate<GitKey>
  /** Open one commit in its own tab. */
  readonly onSelectCommit: (sha: string) => void
}

/**
 * Draw the history.
 * @param props - see {@link HistoryListProps}.
 * @returns the history section.
 */
export function HistoryList({
  commits,
  hasMore,
  now,
  t,
  onSelectCommit,
}: HistoryListProps): ReactNode {
  return (
    <section>
      <h3 className={css.group}>
        {t('history.title')}
        <span className={css.groupCount}>{commits.length}</span>
      </h3>
      {commits.length === 0 && <p className={css.note}>{t('history.empty')}</p>}
      {commits.map(commit => (
        <Fragment key={commit.sha}>
          <button
            type="button"
            className={css.row}
            title={commit.subject}
            onClick={() => { onSelectCommit(commit.sha) }}
          >
            <span className={css.commitSubject}>{commit.subject}</span>
          </button>
          <div className={css.commitMeta}>
            <span className={css.commitSha}>{commit.shortSha}</span>
            <span className={css.commitMetaText}>
              {commit.authorName} · {timeLabel(commit.authoredAt, now, t)}
            </span>
            {commit.refs.length > 0 && <span className={css.ref}>{commit.refs.join(' ')}</span>}
          </div>
        </Fragment>
      ))}
      {hasMore && <p className={cx(css.note, css.noteMore)}>{t('history.more')}</p>}
    </section>
  )
}
