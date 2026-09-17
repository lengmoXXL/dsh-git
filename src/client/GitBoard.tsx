/**
 * The diff board: one pane per open diff, side by side.
 *
 * The page used to open each diff as its own tab, which meant the list it came
 * from was unmounted and every click minted a tab. Here the board sits beside the
 * list instead: a pane is a diff, two of them are a comparison, and the list is
 * still there when the reader looks back.
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
  /**
   * Called once a pane has its diff. The page's own controls — copying, above all
   * — act on the focused pane, and the page cannot reach into a pane's read.
   */
  readonly onLoaded?: ((key: string, diff: DiffPayload) => void) | undefined
}

/**
 * One pane: its diff, and its own read of it.
 * @param props - the pane, whether it is focused, and the page's translator.
 * @returns the pane.
 */
function DiffPane({ pane, focused, t, onFocus, onLoaded }: {
  readonly pane: BoardPane
  readonly focused: boolean
  readonly t: Translate<GitKey>
  readonly onFocus: (key: string) => void
  readonly onLoaded?: ((key: string, diff: DiffPayload) => void) | undefined
}): ReactNode {
  const [load, setLoad] = useState<Load<DiffPayload>>({ phase: 'loading' })

  // One read per comparison: a pane that is already showing the thing it was
  // asked for is not asked again, and a pane that is replaced reads the new one.
  useEffect(() => {
    const controller = new AbortController()
    setLoad({ phase: 'loading' })
    void gitFace.diff(pane.request, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) return
        setLoad({ phase: 'ready', value })
        onLoaded?.(pane.key, value)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        const failure = failureInfoOf(error)
        setLoad({ phase: 'failed', code: failure.code, message: failure.message })
      },
    )
    return () => { controller.abort() }
  }, [pane.key])

  // What the pane compares lives in its tooltip: with no title bar over the code,
  // this is where "which file, at which revisions, how much changed" can be read.
  const ready = load.phase === 'ready' ? load.value : undefined
  // The tooltip also names the bundle drawing this: a page can be running an older
  // one while the diff's content is current.
  const title = ready === undefined
    ? pane.request.path
    : `${ready.path} · ${ready.oldLabel} → ${ready.newLabel} · +${String(ready.added)} −${String(ready.removed)} · ${BUILD_STAMP}`
  return (
    <section
      className={focused ? `${css.pane} ${css.focused}` : css.pane}
      data-pane={pane.key}
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
export function GitBoard({ panes, focused, t, onFocus, onLoaded }: GitBoardProps): ReactNode {
  if (panes.length === 0) {
    return (
      <div className={css.board}>
        <div className={css.empty}>
          <h2 className={css.emptyTitle}>{t('board.emptyTitle')}</h2>
          <p className={css.emptyText}>{t('board.empty')}</p>
        </div>
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
          onLoaded={onLoaded}
        />
      ))}
    </div>
  )
}
