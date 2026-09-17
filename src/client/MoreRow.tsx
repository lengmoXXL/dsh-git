/**
 * The control that stands in for the rows a list is not showing.
 *
 * A list long enough to hide everything below it is not a list any more: past a
 * handful of entries the rail shows the first few and one row saying how many are
 * behind them. The row is deliberately smaller than an entry and led by its glyph,
 * because a word in a commit row's clothing reads as a commit.
 *
 * @module dsh-git/client/MoreRow
 */

import type { ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitKey } from './locales.ts'
import css from './List.module.css'

/** How many entries a list shows before it says there are more. */
export const LIST_PREVIEW = 8

/** How many commits the rail shows before it says there are older ones. */
export const HISTORY_PREVIEW = 12

/** Props of the control. */
export interface MoreRowProps {
  /** What is behind it, already spelled: `8 个文件`, `更早的提交`. */
  readonly label: string
  /** Whether the rows behind it are shown. */
  readonly open: boolean
  /** The page's translator. */
  readonly t: Translate<GitKey>
  /** Toggle. */
  readonly onToggle: () => void
  /** What hovering it says, when that is more than the label. */
  readonly title?: string | undefined
}

/**
 * Draw the control.
 * @param props - see {@link MoreRowProps}.
 * @returns the row.
 */
export function MoreRow({ label, open, t, onToggle, title }: MoreRowProps): ReactNode {
  return (
    <button
      type="button"
      className={css.more}
      aria-expanded={open}
      title={open ? t('section.collapse') : title ?? label}
      onClick={onToggle}
    >
      <span className={css.moreGlyph}>{open ? '' : '⋯'}</span>
      <span className={css.moreLabel}>{open ? t('section.collapse') : label}</span>
    </button>
  )
}
