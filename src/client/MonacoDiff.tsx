/**
 * The diff, drawn by a code editor rather than by this plugin.
 *
 * The host already aligns the two sides — with the same algorithm the editor's own
 * diff view uses — and hands them over as rows. What is left is drawing them, and
 * that is what an editor is for: its diff view gives the two columns, the inline
 * reading, the folded unchanged regions and the syntax colouring, none of which this
 * plugin should keep a second copy of.
 *
 * The editor is built in an effect because it needs a real document: the page is also
 * rendered on the server, where the host element exists and nothing may touch it. That
 * is why this component draws an empty box first and fills it after mount.
 *
 * @module dsh-git/client/MonacoDiff
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
// The editor's API and its own contributions, without the entry point that lazily pulls
// every language: a bundle has no channel for the chunks that entry would need, and this
// page highlights nothing the editor has to know a grammar for.
import * as monaco from 'monaco-editor-core/esm/vs/editor/editor.api.js'
import 'monaco-editor-core/esm/vs/editor/editor.all.js'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from '../shared/wire.ts'
import type { GitKey } from './locales.ts'
import css from './MonacoDiff.module.css'

/** How the reader is reading diffs, which decides what the editor is told. */
export interface MonacoDiffProps {
  /** The change, already aligned by the host. */
  readonly diff: DiffPayload
  /** Two columns, or one. */
  readonly split: boolean
  /** Long lines wrap inside their half, or run on. */
  readonly wrap: boolean
  /** The page's translator, for what the host said about this diff. */
  readonly t: Translate<GitKey>
}

/** The two sides of an aligned diff, as the text an editor wants. */
function sides(diff: DiffPayload): { original: string, modified: string } {
  const lines = (pick: (row: DiffPayload['rows'][number]) => { readonly text: string } | null): string =>
    diff.rows.map(row => pick(row)?.text ?? '').join('\n')
  return { original: lines(row => row.left), modified: lines(row => row.right) }
}

/**
 * Draw one aligned diff in the editor's own diff view.
 * @param props - see {@link MonacoDiffProps}.
 * @returns the editor's host element, or the notice that stands in for it.
 */
export function MonacoDiff({ diff, split, wrap, t }: MonacoDiffProps): ReactNode {
  const host = useRef<HTMLDivElement>(null)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const text = useMemo(() => sides(diff), [diff])

  useEffect(() => {
    const element = host.current
    if (element === null) return
    let editor: monaco.editor.IStandaloneDiffEditor | undefined
    try {
      editor = monaco.editor.createDiffEditor(element, {
        readOnly: true,
        originalEditable: false,
        renderSideBySide: split,
        wordWrap: wrap ? 'on' : 'off',
        hideUnchangedRegions: { enabled: true },
        automaticLayout: true,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderOverviewRuler: false,
        theme: 'vs-dark',
      })
      editor.setModel({
        original: monaco.editor.createModel(text.original, 'plaintext'),
        modified: monaco.editor.createModel(text.modified, 'plaintext'),
      })
    } catch (error: unknown) {
      setFailure(error instanceof Error ? error.message : String(error))
    }
    return () => {
      const models = editor?.getModel()
      editor?.dispose()
      models?.original.dispose()
      models?.modified.dispose()
    }
  }, [text, split, wrap])

  // Three independent things the host can say about what it sent, and a reader shown
  // one of them still needs the others: no text, an approximate pairing, a diff that
  // stops short.
  const notices = [
    diff.binary ? t('diff.binary') : undefined,
    diff.approximate === true ? t('diff.approximate') : undefined,
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
