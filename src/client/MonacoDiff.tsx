/**
 * The diff, drawn by a code editor rather than by this plugin.
 *
 * The editor is fetched at the moment a diff is first shown, from the copy this plugin
 * serves beside its own bundle, and it is fetched as its own files rather than bundled
 * in: an editor is tens of megabytes and a page that never opens a diff should not pay
 * for one, while the plugin's own bundle stays a module that can be loaded and read
 * outside a browser.
 *
 * The host already aligns the two sides, with the same algorithm the editor's own diff
 * view uses; this component hands them over as text and lets the editor draw them.
 * Nothing here builds an editor during render: the page is rendered on the server too,
 * where there is no document to build one in.
 *
 * @module dsh-git/client/MonacoDiff
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type * as Monaco from 'monaco-editor'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload } from '../shared/wire.ts'
import type { GitKey } from './locales.ts'
import css from './MonacoDiff.module.css'

/** Where this plugin serves its copy of the editor. */
const VENDOR = '/dsh-git/vendor/vs'

/** The loader the editor ships: an AMD `require` with a `config` of its own. */
interface EditorLoader {
  (ids: readonly string[], ready: () => void): void
  config?: (options: unknown) => void
}

declare global {
  interface Window {
    require?: EditorLoader
    monaco?: typeof Monaco
  }
}

/** The one load per page, so two diffs do not fetch the editor twice. */
let loading: Promise<typeof Monaco> | undefined

/**
 * Fetch the editor and wait until it has defined itself.
 * @returns the editor's namespace.
 */
function loadEditor(): Promise<typeof Monaco> {
  loading ??= new Promise<typeof Monaco>((resolve, reject) => {
    const start = (): void => {
      const loader = window.require
      if (loader === undefined) {
        reject(new Error('the editor loader did not arrive'))
        return
      }
      loader.config?.({ paths: { vs: VENDOR } })
      loader(['vs/editor/editor.main'], () => {
        const editor = window.monaco
        if (editor === undefined) reject(new Error('the editor did not define itself'))
        else resolve(editor)
      })
    }
    if (document.querySelector('script[data-dsh-git-editor]') !== null) {
      start()
      return
    }
    const script = document.createElement('script')
    script.src = `${VENDOR}/loader.js`
    script.dataset.dshGitEditor = ''
    script.addEventListener('load', start)
    script.addEventListener('error', () => { reject(new Error('the editor could not be fetched')) })
    document.head.appendChild(script)
  })
  return loading
}

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
  const text = (pick: (row: DiffPayload['rows'][number]) => { readonly text: string } | null): string =>
    diff.rows.map(row => pick(row)?.text ?? '').join('\n')
  return { original: text(row => row.left), modified: text(row => row.right) }
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
    let editor: Monaco.editor.IStandaloneDiffEditor | undefined
    let disposed = false
    void loadEditor().then(
      (monaco) => {
        if (disposed) return
        editor = monaco.editor.createDiffEditor(element, {
          readOnly: true,
          originalEditable: false,
          renderSideBySide: split,
          wordWrap: wrap ? 'on' : 'off',
          hideUnchangedRegions: { enabled: true },
          automaticLayout: true,
          minimap: { enabled: false },
          renderOverviewRuler: false,
          scrollBeyondLastLine: false,
          theme: 'vs-dark',
        })
        editor.setModel({
          original: monaco.editor.createModel(text.original, 'plaintext'),
          modified: monaco.editor.createModel(text.modified, 'plaintext'),
        })
      },
      (error: unknown) => {
        if (!disposed) setFailure(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      disposed = true
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
    <>
      {notices.map(notice => <p key={notice} className={css.notice}>{notice}</p>)}
      {failure !== undefined
        ? <p className={css.failure}>{failure}</p>
        : <div className={css.host} ref={host} />}
    </>
  )
}
