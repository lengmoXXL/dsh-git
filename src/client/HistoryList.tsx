/**
 * The history half of the log tab: one row per commit, each opening that
 * commit's whole change set in its own tab.
 *
 * A row is one line, the way a source-control list draws a commit: the subject
 * takes the width it needs, the author and age trail it in a dimmer tone, and
 * the refs it carries are drawn as chips at the end — the branch the working
 * tree is on leading, in the one solid chip of the row.
 *
 * @module dsh-git/client/HistoryList
 */

import { useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitSummary } from '../shared/wire.ts'
import { cx, timeLabel } from './format.ts'
import type { GitKey } from './locales.ts'
import { RefChips } from './RefChips.tsx'
import { Section } from './Section.tsx'
import { parseRefs } from './state.ts'
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

/** One commit's row. */
function CommitRow({ commit, now, t, onSelect }: {
  readonly commit: CommitSummary
  readonly now: number
  readonly t: Translate<GitKey>
  readonly onSelect: (sha: string) => void
}): ReactNode {
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
    <button
      type="button"
      className={css.row}
      title={title}
      onClick={() => { onSelect(commit.sha) }}
    >
      <span className={cx(css.subject, current && css.subjectCurrent)}>{commit.subject}</span>
      {/* The author gives way before the age does: a shortened name still says
          who, while half of "2d ago" says nothing. */}
      <span className={css.subjectMeta}>
        <span className={css.author}>{commit.authorName} ·</span>
        <span className={css.age}>{age}</span>
      </span>
      <RefChips chips={chips} />
    </button>
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
  now,
  t,
  onSelectCommit,
}: HistoryListProps): ReactNode {
  const [open, setOpen] = useState(true)
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
          now={now}
          t={t}
          onSelect={onSelectCommit}
        />
      ))}
      {hasMore && <p className={cx(css.note, css.noteMore)}>{t('history.more')}</p>}
    </Section>
  )
}
