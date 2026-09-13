/**
 * The diff tab: one change, or one commit's whole change set.
 *
 * Its content is a resource value addressed by the tab's own `contentId`, so
 * this body never chooses what to show — the address already did, and two open
 * diff tabs differ only in that string. That is what makes a diff a thing you
 * can keep open beside the log and beside another diff.
 *
 * @module dsh-git/client/DiffBody
 */

import { useState, type ReactNode } from 'react'
import type { PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { CommitSummary } from '../shared/wire.ts'
import { FailureBlock, Note } from './Feedback.tsx'
import { timeLabel } from './format.ts'
import type { GitKey, GitNamespace } from './locales.ts'
import { RefChips } from './RefChips.tsx'
import { SideBySide } from './SideBySide.tsx'
import { parseRefs } from './state.ts'
import css from './DiffBody.module.css'

/** One commit's heading: what it was, who wrote it, and when. */
function CommitHeader({ commit, now, t }: {
  readonly commit: CommitSummary
  readonly now: number
  readonly t: Translate<GitKey>
}): ReactNode {
  return (
    <div className={css.commitHeader}>
      <span className={css.subject}>{commit.subject}</span>
      <span className={css.meta}>
        <span className={css.sha}>{commit.shortSha}</span>
        <span>{commit.authorName}</span>
        <span>{timeLabel(commit.authoredAt, now, t)}</span>
        <RefChips chips={parseRefs(commit.refs)} />
      </span>
    </div>
  )
}

/** The diff tab's composed props: the tab seat, the resource hook, and its dictionary. */
export type DiffBodyProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<GitNamespace>

/**
 * Draw whatever this tab's address resolved to.
 * @param props - see {@link DiffBodyProps}.
 * @returns the tab's body.
 */
export function DiffBody({ useTabInfo, useResource, t }: DiffBodyProps): ReactNode {
  const { tab } = useTabInfo()
  const resource = useResource<'git'>(tab.contentId)
  // Read once per mount: a relative time that ticked mid-read would be noise.
  const [now] = useState(() => Date.now())

  if (resource.status === 'failed') {
    return (
      <div className={css.panel}>
        {/* The shell types a failure as `RemoteFailure | undefined` and keeps it
            present only while the status is `failed`, so these fallbacks cover
            the type rather than a state a reader can reach. */}
        <FailureBlock
          code={resource.failure?.code ?? 'git/command-failed'}
          message={resource.failure?.message ?? ''}
          t={t}
          onRetry={undefined}
        />
      </div>
    )
  }
  const value = resource.value
  if (value === undefined) {
    return <div className={css.panel}><Note>{t('loading')}</Note></div>
  }
  if (value.kind === 'error') {
    return (
      <div className={css.panel}>
        <FailureBlock code={value.code} message={value.message} t={t} onRetry={undefined} />
      </div>
    )
  }
  if (value.kind === 'diff') {
    return (
      <div className={css.panel}>
        {value.diff.approximate === true && <p className={css.summary}>{t('diff.approximate')}</p>}
        <SideBySide diff={value.diff} t={t} />
      </div>
    )
  }

  return (
    <div className={css.panel}>
      <CommitHeader commit={value.commit} now={now} t={t} />
      <div className={css.scroll}>
        {value.files.length === 0 && <p className={css.summary}>{t('commit.empty')}</p>}
        {value.files.map(file => (
          <div key={file.path}>
            {file.approximate === true && <p className={css.summary}>{t('diff.approximate')}</p>}
            <SideBySide diff={file} t={t} embedded />
          </div>
        ))}
        {value.truncated && <p className={css.summary}>{t('diff.truncated')}</p>}
      </div>
    </div>
  )
}
