/**
 * The diff board: one pane per open diff, side by side.
 *
 * A pane owns its read — its request, its cancellation, its failure — so two panes
 * for two revisions of one file cannot show each other's answer, and the board
 * itself knows nothing about git.
 *
 * @module dsh-git/client/GitBoard
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from '../shared/wire.ts'
import { BUILD_STAMP } from './build.ts'
import { FailureBlock, Note } from './Feedback.tsx'
import { gitFace } from './face.ts'
import type { GitKey } from './locales.ts'
import { SideBySide } from './SideBySide.tsx'
import { failureInfoOf, type BoardPane, type Load } from './state.ts'
import css from './GitBoard.module.css'

/** Props of the board. */
export interface GitBoardProps {
  /** The panes, in order, left to right. */
  readonly panes: readonly BoardPane[]
  /** The pane the reader is working in, or null when the board is empty. */
  readonly focused: string | null
  /** The page's translator. */
  readonly t: Translate<GitKey>
  /** Called when a pane is clicked, so the next diff knows where to land. */
  readonly onFocus: (key: string) => void
}

/**
 * One pane: its diff, and its own read of it.
 * @param props - the pane, whether it is focused, and the page's translator.
 * @returns the pane.
 */
function DiffPane({ pane, focused, t, onFocus }: {
  readonly pane: BoardPane
  readonly focused: boolean
  readonly t: Translate<GitKey>
  readonly onFocus: (key: string) => void
}): ReactNode {
  const [load, setLoad] = useState<Load<DiffPayload>>({ phase: 'loading' })

  // Keyed by the comparison, not by the pane: a pane already showing what it was
  // asked for is not asked again.
  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    void gitFace.diff(pane.request, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        setLoad({ phase: 'ready', value })
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setLoad({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    return () => { controller.abort() }
  }, [pane.key])

  // With no title bar over the code, the tooltip is where "which file, at which
  // revisions, how much changed" can be read — and which build is drawing it, since a
  // page can be running an older bundle while the diff's content is current.
  const ready = load.phase === 'ready' ? load.value : undefined
  const title = ready === undefined
    ? pane.request.path
    : `${ready.path} · ${ready.oldLabel} → ${ready.newLabel} · +${String(ready.added)} −${String(ready.removed)} · ${BUILD_STAMP}`
  return (
    <section
      className={css.pane}
      data-pane={pane.key}
      data-focused={focused ? '' : undefined}
      title={title}
      onMouseDown={() => { onFocus(pane.key) }}
    >
      {load.phase === 'loading' && <Note>{t('loading')}</Note>}
      {load.phase === 'failed' && (
        <FailureBlock code={load.code} message={load.message} t={t} onRetry={undefined} />
      )}
      {load.phase === 'ready' && <SideBySide diff={load.value} t={t} embedded />}
    </section>
  )
}

/**
 * Draw the board.
 * @param props - see {@link GitBoardProps}.
 * @returns the panes, or what stands in for them.
 */
export function GitBoard({ panes, focused, t, onFocus }: GitBoardProps): ReactNode {
  if (panes.length === 0) {
    return (
      <div className={css.board}>
        <p className={css.emptyText}>{t('board.empty')}</p>
      </div>
    )
  }
  return (
    <div className={css.board}>
      {panes.map((pane) => (
        <DiffPane
          key={pane.key}
          pane={pane}
          focused={pane.key === focused}
          t={t}
          onFocus={onFocus}
        />
      ))}
    </div>
  )
}
