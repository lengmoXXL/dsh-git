/**
 * The working-tree half of the log tab: the changed paths, grouped the way a
 * reader looks for them, each row opening that change in its own tab.
 *
 * A row is the shape a source-control list uses: the file's type glyph, its
 * name with the directory trailing it in a dimmer tone, and the status letter
 * at the far right, where the eye lands after reading the name.
 *
 * @module dsh-git/client/ChangeList
 */

import { Fragment, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeEntry, ChangeStage } from '../shared/wire.ts'
import { FileRow } from './FileRow.tsx'
import { cx } from './format.ts'
import type { GitKey } from './locales.ts'
import { Section } from './Section.tsx'
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

/** One changed path's row, opening that change in its own tab. */
function ChangeRow({ entry, t, onSelect }: {
  readonly entry: ChangeEntry
  readonly t: Translate<GitKey>
  readonly onSelect: (entry: ChangeEntry) => void
}): ReactNode {
  return (
    <FileRow
      path={entry.path}
      origPath={entry.origPath}
      kind={entry.kind}
      t={t}
      onSelect={() => { onSelect(entry) }}
    />
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
  const [open, setOpen] = useState(true)
  const groups = nonEmptyGroups(grouped)
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  return (
    <Section
      title={t('changes.title')}
      count={total}
      open={open}
      onToggle={() => { setOpen(value => !value) }}
      t={t}
    >
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
    </Section>
  )
}
