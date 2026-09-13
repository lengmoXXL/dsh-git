/**
 * The diff view: one aligned row per line pair, old on the left and new on the
 * right, with the unchanged middles of long files folded away.
 *
 * The component draws only what the host already aligned, so there is no diff
 * algorithm in the browser and the two columns can never disagree about which
 * lines correspond.
 *
 * @module dsh-git/client/SideBySide
 */

import { useMemo, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload, DiffRow } from '../shared/wire.ts'
import { cx, pathParts } from './format.ts'
import type { GitKey } from './locales.ts'
import { collapseRows } from './state.ts'
import css from './SideBySide.module.css'

/** The four cells one aligned row occupies. */
function Cells({ row }: { readonly row: DiffRow }): ReactNode {
  const removed = row.kind === 'delete' || row.kind === 'replace'
  const added = row.kind === 'insert' || row.kind === 'replace'
  const leftTone = row.left === null ? css.blank : removed ? css.del : undefined
  const rightTone = row.right === null ? css.blank : added ? css.add : undefined
  return (
    <>
      <span className={cx(css.num, leftTone)}>{row.left?.no ?? ''}</span>
      <span className={cx(css.text, leftTone)}>{row.left?.text ?? ''}</span>
      <span className={cx(css.num, rightTone)}>{row.right?.no ?? ''}</span>
      <span className={cx(css.text, rightTone)}>{row.right?.text ?? ''}</span>
    </>
  )
}

/** Props of the diff view. */
export interface SideBySideProps {
  /** The diff to draw. Its tab owns loading and failure; this only draws rows. */
  readonly diff: DiffPayload
  /** The tab's translator. */
  readonly t: Translate<GitKey>
  /**
   * Draw without owning the scroll region, so several diffs can be stacked
   * inside one. A commit's tab sets this; a single change's tab does not.
   */
  readonly embedded?: boolean | undefined
}

/**
 * Draw one change.
 * @param props - see {@link SideBySideProps}.
 * @returns the diff, or the state that stands in for it.
 */
export function SideBySide({ diff, t, embedded = false }: SideBySideProps): ReactNode {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const rows = useMemo(
    () => (diff === undefined ? [] : collapseRows(diff.rows, undefined, expanded)),
    [diff, expanded],
  )

  const root = embedded ? css.diffEmbedded : css.diff
  const parts = pathParts(diff.path)
  const notice = diff.binary ? t('diff.binary') : diff.truncated ? t('diff.truncated') : undefined
  const grid = (
    <div className={css.grid}>
      {rows.map((row) => {
        if (row.kind === 'fold') {
          return (
            <button
              key={row.key}
              type="button"
              className={css.fold}
              onClick={() => {
                setExpanded(current => new Set(current).add(row.key))
              }}
            >
              ⋯ {row.hidden} {t('diff.unchanged')}
            </button>
          )
        }
        if (row.row.kind === 'gap') {
          // Rows the host left out to keep a huge diff readable. The counts are
          // stated because a view that is not contiguous must say so.
          const left = row.row.skippedLeft ?? 0
          const right = row.row.skippedRight ?? 0
          const count = left === right ? String(left) : `${String(left)} / ${String(right)}`
          return <span key={row.key} className={css.gap}>⋯ {count} {t('diff.omitted')}</span>
        }
        return <Cells key={row.key} row={row.row} />
      })}
    </div>
  )

  return (
    <div className={root}>
      <header className={css.header}>
        <span className={css.path} title={diff.path}>
          {parts.dir !== '' && <span className={css.orig}>{parts.dir}/</span>}
          {parts.base}
          {diff.origPath !== undefined && <span className={css.orig}> ← {diff.origPath}</span>}
        </span>
        <span className={css.revs}>{diff.oldLabel} → {diff.newLabel}</span>
        <span className={css.stat}>
          <span className={css.added}>+{diff.added}</span>
          <span className={css.removed}>−{diff.removed}</span>
        </span>
      </header>
      {notice !== undefined && <p className={css.notice}>{notice}</p>}
      {embedded
        ? <div className={css.gridScroll} data-dsh-git-diff="">{grid}</div>
        : <div className={css.scroll} data-dsh-git-diff="">{grid}</div>}
    </div>
  )
}
