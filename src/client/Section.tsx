/**
 * The collapsible section both halves of the log tab are drawn in.
 *
 * The header is sticky inside the tab's one scroll region, so the section a
 * reader is looking at names itself while its rows pass underneath. Two
 * sections share the top edge, so the later one covers the earlier one as it
 * arrives: the heading always belongs to the rows below it.
 *
 * @module dsh-git/client/Section
 */

import type { ReactNode } from 'react'
import {
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  Tag,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitKey } from './locales.ts'
import css from './List.module.css'

/** Props of a section. */
export interface SectionProps {
  /** What the header names this section. */
  readonly title: string
  /** How many rows it holds, drawn as a count badge. */
  readonly count: number
  /** Whether the rows are drawn. */
  readonly open: boolean
  /** Flip {@link SectionProps.open}. */
  readonly onToggle: () => void
  /** The tab's translator, for the toggle's accessible name. */
  readonly t: Translate<GitKey>
  /** The rows, drawn only while open. */
  readonly children?: ReactNode
}

/**
 * Draw one collapsible section.
 * @param props - see {@link SectionProps}.
 * @returns the section header and, while open, its rows.
 */
export function Section({ title, count, open, onToggle, t, children }: SectionProps): ReactNode {
  return (
    <section>
      <h3 className={css.sectionHeader}>
        <button
          type="button"
          className={css.sectionToggle}
          aria-expanded={open}
          title={open ? t('section.collapse') : t('section.expand')}
          onClick={onToggle}
        >
          <span className={css.sectionChevron} aria-hidden="true">
            {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
          </span>
          <span className={css.sectionTitle}>{title}</span>
          <Tag tone="neutral" className={css.sectionCount}>{count}</Tag>
        </button>
      </h3>
      {open && children}
    </section>
  )
}
