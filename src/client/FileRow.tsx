/**
 * One changed path's row, drawn the same wherever a path is listed: the working
 * tree's changes and the files inside a commit are the same kind of row, so a
 * reader learns one shape.
 *
 * @module dsh-git/client/FileRow
 */

import type { ReactNode } from 'react'
import { FileTypeIcon } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeKind } from '../shared/wire.ts'
import { cx, kindLabel, pathParts } from './format.ts'
import type { GitKey } from './locales.ts'
import { statusLetter } from './state.ts'
import css from './List.module.css'

/** Props of one changed path's row. */
export interface FileRowProps {
  /** Repository-relative path of the new side. */
  readonly path: string
  /** Previous path of a rename or copy. */
  readonly origPath?: string | undefined
  /** What the change-status letter means. */
  readonly kind: ChangeKind
  /** The panel's translator, for the letter's accessible name. */
  readonly t: Translate<GitKey>
  /** Open this path. */
  readonly onSelect: () => void
  /** Draw the row under the commit it belongs to, indented. */
  readonly nested?: boolean | undefined
}

/**
 * Draw one changed path.
 * @param props - see {@link FileRowProps}.
 * @returns the row.
 */
export function FileRow({
  path,
  origPath,
  kind,
  t,
  onSelect,
  nested = false,
}: FileRowProps): ReactNode {
  const parts = pathParts(path)
  // A rename's two paths are the tooltip's business: the row names the file
  // where it is now, which is the path a click opens.
  const title = origPath === undefined ? path : `${origPath} → ${path}`
  return (
    <button
      type="button"
      className={cx(css.row, nested && css.rowNested)}
      title={title}
      onClick={onSelect}
    >
      <FileTypeIcon path={path} size={16} className={css.rowIcon} />
      <span className={cx(css.rowName, kind === 'deleted' && css.rowGone)}>{parts.base}</span>
      {parts.dir !== '' && <span className={css.rowDir}>{parts.dir}</span>}
      <span className={css.rowSpacer} />
      <span className={css.rowLetter} data-kind={kind} title={kindLabel(kind, t)}>
        {statusLetter(kind)}
      </span>
    </button>
  )
}
