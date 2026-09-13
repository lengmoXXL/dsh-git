/**
 * The working-tree half of the log tab: the changed paths, grouped the way a
 * reader looks for them, each row opening that change in its own tab.
 *
 * @module dsh-git/client/ChangeList
 */

import { Fragment, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeEntry, ChangeStage } from '../shared/wire.ts'
import { cx, kindLabel, pathParts } from './format.ts'
import type { GitKey } from './locales.ts'
import type { GroupedChanges } from './state.ts'
import { nonEmptyGroups } from './state.ts'
import css from './List.module.css'

/** The group heading each stage is drawn under. */
const GROUP_KEY: Record<ChangeStage, GitKey> = {
  conflicted: 'group.conflicted',
  staged: 'group.staged',
  unstaged: 'group.unstaged',
  untracked: 'group.untracked',
}

/** One changed path's row. */
function ChangeRow({ entry, t, onSelect }: {
  readonly entry: ChangeEntry
  readonly t: Translate<GitKey>
  readonly onSelect: (entry: ChangeEntry) => void
}): ReactNode {
  const parts = pathParts(entry.path)
  return (
    <button
      type="button"
      className={css.row}
      title={entry.path}
      onClick={() => { onSelect(entry) }}
    >
      <span className={css.rowPath}>
        {parts.dir !== '' && <span className={css.rowDir}>{parts.dir}</span>}
        {parts.base}
      </span>
      <span className={css.rowKind}>{kindLabel(entry.kind, t)}</span>
    </button>
  )
}

/** Props of the working-tree list. */
export interface ChangeListProps {
  /** The changed paths, already grouped. */
  readonly grouped: GroupedChanges
  /** The status read hit its entry cap. */
  readonly truncated: boolean
  /** The tab's translator. */
  readonly t: Translate<GitKey>
  /** Open one changed path in its own tab. */
  readonly onSelect: (entry: ChangeEntry) => void
}

/**
 * Draw the changed paths.
 * @param props - see {@link ChangeListProps}.
 * @returns the changes section.
 */
export function ChangeList({ grouped, truncated, t, onSelect }: ChangeListProps): ReactNode {
  const groups = nonEmptyGroups(grouped)
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  return (
    <section>
      <h3 className={css.group}>
        {t('changes.title')}
        <span className={css.groupCount}>{total}</span>
      </h3>
      {total === 0 && <p className={css.note}>{t('changes.empty')}</p>}
      {groups.map(({ stage, entries }) => (
        <Fragment key={stage}>
          <h4 className={css.group}>
            {t(GROUP_KEY[stage])}
            <span className={css.groupCount}>{entries.length}</span>
          </h4>
          {entries.map(entry => (
            <ChangeRow
              key={`${entry.stage}:${entry.path}`}
              entry={entry}
              t={t}
              onSelect={onSelect}
            />
          ))}
        </Fragment>
      ))}
      {truncated && <p className={cx(css.note, css.noteMore)}>{t('changes.truncated', { n: total })}</p>}
    </section>
  )
}
