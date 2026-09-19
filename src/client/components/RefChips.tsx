/**
 * The refs a commit carries, drawn as chips.
 *
 * The tone is what says which chip is the branch the reader is on, and which are
 * merely names for the same commit.
 *
 * @module dsh-git/client/components/RefChips
 */

import type { ReactNode } from 'react'
import {
  IconBranchOutline16,
  Tag,
  type TagTone,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { RefChip, RefKind } from '../data/state.ts'
import css from '../styles/List.module.css'

/** The chip palette each kind of ref is drawn in. */
const REF_TONE: Record<RefKind, TagTone> = {
  head: 'solid',
  branch: 'info',
  remote: 'neutral',
  tag: 'outline',
}

/** Props of the ref chips. */
export interface RefChipsProps {
  /** The commit's refs, already parsed. */
  readonly chips: readonly RefChip[]
}

const MAX_CHIPS = 2

/**
 * Draw a commit's refs.
 * @param props - see {@link RefChipsProps}.
 * @returns one chip per drawn ref, then a count for the ones left out.
 */
export function RefChips({ chips }: RefChipsProps): ReactNode {
  const shown = chips.slice(0, MAX_CHIPS)
  const hidden = chips.slice(MAX_CHIPS)
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
