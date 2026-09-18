/**
 * The diff, drawn by a code editor rather than by this plugin.
 *
 * Both sides of the change arrive as text and the editor does the rest: its diff view aligns
 * them, gives the two columns, the inline reading, the folded unchanged regions, the marks
 * for what was added, removed and changed, and the syntax colouring. None of that is this
 * plugin's to keep a second copy of, the diff included.
 *
 * The editor is built in an effect because it needs a real document: the page is also
 * rendered on the server, where the host element exists and nothing may touch it. That
 * is why this component draws an empty box first and fills it after mount.
 *
 * @module dsh-git/client/DiffView
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from '../shared/wire.ts'
import { monaco } from './editor.ts'
import type { GitKey } from './locales.ts'
import { installSyntax, languageOf } from './syntax.ts'
import css from './DiffView.module.css'

/** How many lines the editor found on each side of the change. */
export interface DiffCounts {
  /** Lines the new side has and the old one does not. */
  readonly added: number
  /** Lines the old side has and the new one does not. */
  readonly removed: number
}

/** How the reader is reading diffs, which decides what the editor is told. */
export interface DiffViewProps {
  /** The change: both sides, whole. */
  readonly diff: DiffPayload
  /** Two columns, or one. */
  readonly split: boolean
  /** Long lines wrap inside their half, or run on. */
  readonly wrap: boolean
  /** The page's translator, for what the host said about this diff. */
  readonly t: Translate<GitKey>
  /** Told how much changed, once the editor has read the two sides. */
  readonly onCounts?: ((counts: DiffCounts) => void) | undefined
}

/**
 * How much of a change the editor found, from its own account of the lines.
 *
 * A change the editor reports as an insertion has no old-side lines and one that it reports
 * as a deletion has no new-side lines, so each range is counted on the side that has one.
 * @param changes - the editor's line changes, or null before it has computed any.
 * @returns the two line counts.
 */
function counted(changes: readonly monaco.editor.ILineChange[] | null): DiffCounts {
  let added = 0
  let removed = 0
  for (const change of changes ?? []) {
    if (change.modifiedEndLineNumber > 0) {
      added += change.modifiedEndLineNumber - change.modifiedStartLineNumber + 1
    }
    if (change.originalEndLineNumber > 0) {
      removed += change.originalEndLineNumber - change.originalStartLineNumber + 1
    }
  }
  return { added, removed }
}

/**
 * Draw one change in the editor's own diff view.
 * @param props - see {@link DiffViewProps}.
 * @returns the editor's host element, or the notice that stands in for it.
 */
export function DiffView({ diff, split, wrap, t, onCounts }: DiffViewProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const editor = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  // The pane is told through the latest callback without the editor being built again when
  // a caller passes a new one.
  const report = useRef(onCounts)
  report.current = onCounts
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const language = languageOf(diff.path)

  useEffect(() => {
    const element = host.current
    if (element === null) return
    let created: monaco.editor.IStandaloneDiffEditor | undefined
    let updated: monaco.IDisposable | undefined
    let laid: monaco.IDisposable | undefined
    // The editor centres the band's unfold control over the whole left margin and draws the
    // fold control in the glyph margin, so the two do not share a column until the band's
    // slot is told how wide that margin is. The margin's own width is read off the document,
    // because it is no part of the editor's own layout figures until it has been drawn.
    const measure = (): void => {
      const margin = element.querySelector('.monaco-editor .glyph-margin')
      if (margin === null) return
      element.style.setProperty('--dsh-git-glyph-margin', `${String(margin.clientWidth)}px`)
    }
    try {
      installSyntax()
      const built = monaco.editor.createDiffEditor(element, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: split,
        // The reader's switch decides, not the width. Left to itself the editor answers a
        // request for two columns with one wherever the pane is narrower than its own
        // breakpoint — nine hundred pixels, which a sidebar is — so the switch would look
        // like it did nothing.
        useInlineViewWhenSpaceIsLimited: false,
        wordWrap: wrap ? 'on' : 'off',
        hideUnchangedRegions: { enabled: true },
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
      })
      created = built
      built.setModel({
        original: monaco.editor.createModel(diff.oldText, language),
        modified: monaco.editor.createModel(diff.newText, language),
      })
      updated = built.onDidUpdateDiff(() => { report.current?.(counted(built.getLineChanges())) })
      requestAnimationFrame(measure)
      laid = built.getModifiedEditor().onDidLayoutChange(measure)
      editor.current = built
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
    return () => {
      laid?.dispose()
      updated?.dispose()
      const models = created?.getModel()
      created?.dispose()
      models?.original.dispose()
      models?.modified.dispose()
      editor.current = null
    }
  }, [diff, language])

  // The reader's two switches are options of the editor that is already up: rebuilding it
  // for a toggle threw away where the reader had scrolled, and a fresh editor measures its
  // box before the browser has laid it out, which is a jump.
  useEffect(() => {
    editor.current?.updateOptions({ renderSideBySide: split, wordWrap: wrap ? 'on' : 'off' })
  }, [split, wrap])

  // Two independent things the host can say about what it sent, and a reader shown one of
  // them still needs the other: no text, a side that stops short.
  const notices = [
    diff.binary ? t('diff.binary') : undefined,
    diff.truncated ? t('diff.truncated') : undefined,
  ].filter((notice): notice is string => notice !== undefined)

  return (
    // The component says which reading it asked the editor for: the editor's own class
    // for it is Monaco's business, and a test of this plugin should not depend on it.
    <div className={css.stack} data-reading={split ? 'split' : 'inline'}>
      {failure === undefined
        ? <div className={css.host} ref={host} />
        : <p className={css.failure}>{failure}</p>}
      {notices.length > 0 && <p className={css.notice}>{notices.join(' · ')}</p>}
    </div>
  )
}
