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
import { OpenFileGlyph } from './glyphs.tsx'
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
  /** Open this path's diff. `beside` asks for a second pane rather than the first. */
  readonly onSelect: (beside: boolean) => void
  /**
   * Hand this path to the shell's own file view, when the row offers it. The row
   * itself opens a diff; reading the file is the other thing a path can mean.
   */
  readonly onOpenFile?: (() => void) | undefined
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
  onOpenFile,
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
      onClick={(event) => { onSelect(event.altKey) }}
      onKeyDown={(event) => {
        // A row opens a diff; holding the modifier asks for the second pane.
        if (event.key === 'Enter' && event.altKey) {
          event.preventDefault()
          onSelect(true)
        }
      }}
    >
      <FileTypeIcon path={path} size={16} className={css.rowIcon} />
      <span className={cx(css.rowName, kind === 'deleted' && css.rowGone)}>{parts.base}</span>
      {parts.dir !== '' && <span className={css.rowDir}>{parts.dir}</span>}
      <span className={css.rowSpacer} />
      {/* A span, not a button: the row is already a button, and a button inside one
          is not a thing a browser will draw. */}
      {onOpenFile !== undefined && (
        <span
          role="presentation"
          className={css.rowFile}
          title={t('diff.openFile')}
          onClick={(event) => { event.stopPropagation(); onOpenFile() }}
        >
          <OpenFileGlyph />
        </span>
      )}
      <span className={css.rowLetter} data-kind={kind} title={kindLabel(kind, t)}>
        {statusLetter(kind)}
      </span>
    </button>
  )
}
