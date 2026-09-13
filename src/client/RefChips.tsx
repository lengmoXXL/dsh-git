/**
 * The refs a commit carries, drawn as chips.
 *
 * Both lists that name a commit — the log's history rows and a commit tab's
 * heading — show the same chips, so the tone that marks the checked-out branch
 * means the same thing in both places.
 *
 * @module dsh-git/client/RefChips
 */

import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  Tag,
  type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RefChip, RefKind } from './state.ts'
import css from './List.module.css'

/** The chip palette each kind of ref is drawn in. */
const REF_TONE: Record<RefKind, TagTone> = {
  head: 'solid',
  branch: 'info',
  remote: 'neutral',
  tag: 'outline',
}

/** How many chips are drawn before the rest collapse into a count. */
export const MAX_REF_CHIPS = 2

/** Props of the ref chips. */
export interface RefChipsProps {
  /** The commit's refs, already parsed. */
  readonly chips: readonly RefChip[]
  /** How many to draw; the rest become a count. Defaults to {@link MAX_REF_CHIPS}. */
  readonly max?: number
}

/**
 * Draw a commit's refs.
 * @param props - see {@link RefChipsProps}.
 * @returns one chip per drawn ref, then a count for the ones left out.
 */
export function RefChips({ chips, max = MAX_REF_CHIPS }: RefChipsProps): ReactNode {
  const shown = chips.slice(0, max)
  const hidden = chips.slice(max)
  return (
    <>
      {shown.map(chip => (
        <Tag key={chip.name} tone={REF_TONE[chip.kind]} className={css.ref}>
          {chip.kind !== 'tag' && <IconBranchOutline16 size={12} className={css.refIcon} />}
          {chip.name}
        </Tag>
      ))}
      {hidden.length > 0 && (
        // The names the row could not fit stay reachable, as the chip's tooltip.
        <span className={css.refMore} title={hidden.map(chip => chip.name).join(', ')}>
          <Tag tone="neutral">{`+${String(hidden.length)}`}</Tag>
        </span>
      )}
    </>
  )
}
