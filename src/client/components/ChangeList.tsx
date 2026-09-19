/**
 * The working-tree half of the log tab: the changed paths, grouped the way a
 * reader looks for them, each row opening that change in the pane beside them.
 *
 * A row is the shape a source-control list uses: the file's type glyph, its
 * name with the directory trailing it in a dimmer tone, and the status letter
 * at the far right, where the eye lands after reading the name.
 *
 * @module dsh-git/client/components/ChangeList
 */

import { Fragment, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeEntry, ChangeStage } from '../../api/wire.ts'
import { FileRow } from './FileRow.tsx'
import { LIST_PREVIEW, LIST_STEP, MoreRow } from './MoreRow.tsx'
import { cx } from '../i18n/format.ts'
import type { GitKey } from '../i18n/locales.ts'
import { Section } from './Section.tsx'
import type { GroupedChanges } from '../data/state.ts'
import { nonEmptyGroups } from '../data/state.ts'
import css from '../styles/List.module.css'

/** The group heading each stage is drawn under. */
const GROUP_KEY: Record<ChangeStage, GitKey> = {
  conflicted: 'group.conflicted',
  staged: 'group.staged',
  unstaged: 'group.unstaged',
  untracked: 'group.untracked',
}

/** Props of the working-tree list. */
export interface ChangeListProps {
  /** The changed paths, already grouped. */
  readonly grouped: GroupedChanges
  /** The status read hit its entry cap. */
  readonly truncated: boolean
  /** The tab's translator. */
  readonly t: Translate<GitKey>
  /** Open one changed path's diff; `beside` asks for a second pane. */
  readonly onSelect: (entry: ChangeEntry, beside: boolean) => void
  /** Hand one changed path to the shell's own file view. */
  readonly onOpenFile?: ((path: string) => void) | undefined
}

/**
 * Draw the changed paths.
 * @param props - see {@link ChangeListProps}.
 * @returns the changes section.
 */
export function ChangeList({ grouped, truncated, t, onSelect, onOpenFile }: ChangeListProps): ReactNode {
  const [open, setOpen] = useState(true)
  // How many of each group's rows are drawn. One press reveals the next step.
  const [revealed, setRevealed] = useState<ReadonlyMap<ChangeStage, number>>(() => new Map())
  const groups = nonEmptyGroups(grouped)
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0)
  const shownOf = (stage: ChangeStage, count: number): number => Math.min(revealed.get(stage) ?? LIST_PREVIEW, count)
  const toggle = (stage: ChangeStage, count: number): void => {
    setRevealed((current) => {
      const next = new Map(current)
      const shown = current.get(stage) ?? LIST_PREVIEW
      next.set(stage, shown >= count ? LIST_PREVIEW : shown + LIST_STEP)
      return next
    })
  }
  return (
    <Section
      title={t('changes.title')}
      count={total === 0 ? undefined : total}
      open={open}
      onToggle={() => { setOpen(value => !value) }}
      t={t}
    >
      {total === 0 && <p className={css.note}>{t('changes.empty')}</p>}
      {groups.map(({ stage, entries }) => {
        const shown = shownOf(stage, entries.length)
        return (
          <Fragment key={stage}>
            <h4 className={css.group}>
              {t(GROUP_KEY[stage])}
              <span className={css.groupCount}>{entries.length}</span>
            </h4>
            {entries.slice(0, shown).map(entry => (
              <FileRow
                key={`${entry.stage}:${entry.path}`}
                path={entry.path}
                origPath={entry.origPath}
                kind={entry.kind}
                t={t}
                onSelect={(beside) => { onSelect(entry, beside) }}
                onOpenFile={onOpenFile === undefined ? undefined : () => { onOpenFile(entry.path) }}
              />
            ))}
            {entries.length > LIST_PREVIEW && (
              <MoreRow
                label={t('list.moreFiles', { n: entries.length - shown })}
                open={shown >= entries.length}
                t={t}
                onToggle={() => { toggle(stage, entries.length) }}
              />
            )}
          </Fragment>
        )
      })}
      {truncated && <p className={cx(css.note, css.noteMore)}>{t('changes.truncated', { n: total })}</p>}
    </Section>
  )
}
