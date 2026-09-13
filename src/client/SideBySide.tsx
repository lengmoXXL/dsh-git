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

import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload, DiffRow } from '../shared/wire.ts'
import { cx, pathParts } from './format.ts'
import {
  ClipLinesGlyph,
  InlineLayoutGlyph,
  SplitLayoutGlyph,
  WrapLinesGlyph,
} from './glyphs.tsx'
import { highlightLines, langFromPath, type HighlightSpan } from './highlight.ts'
import type { GitKey } from './locales.ts'
import { collapseRows, diffText, inlineDisplayLines, type InlineLine } from './state.ts'
import {
  diffViewSettings,
  setDiffViewMode,
  setDiffWrap,
  subscribeDiffViewSettings,
} from './view-mode.ts'
import css from './SideBySide.module.css'

/** One line's highlighted runs, as the view draws them. */
type HighlightedLine = readonly HighlightSpan[] | undefined

/**
 * Draw one line's text: its highlighted runs when the grammar had an answer,
 * the plain text when it did not.
 * @param props.line - the runs for this line, or undefined for plain text.
 * @param props.text - the line's own text, drawn when there are no runs.
 * @returns the line's content.
 */
function LineText({ line, text }: {
  readonly line: HighlightedLine
  readonly text: string
}): ReactNode {
  if (line === undefined || line.length === 0) return text
  return line.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)
}

/** The four cells one aligned row occupies. */
function Cells({ row, left, right }: {
  readonly row: DiffRow
  readonly left: HighlightedLine
  readonly right: HighlightedLine
}): ReactNode {
  const removed = row.kind === 'delete' || row.kind === 'replace'
  const added = row.kind === 'insert' || row.kind === 'replace'
  const leftTone = row.left === null ? css.blank : removed ? css.del : undefined
  const rightTone = row.right === null ? css.blank : added ? css.add : undefined
  return (
    <>
      <span className={cx(css.num, leftTone)}>{row.left?.no ?? ''}</span>
      <span className={cx(css.text, leftTone)}>
        <LineText line={left} text={row.left?.text ?? ''} />
      </span>
      <span className={cx(css.num, rightTone)}>{row.right?.no ?? ''}</span>
      <span className={cx(css.text, rightTone)}>
        <LineText line={right} text={row.right?.text ?? ''} />
      </span>
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
 * The three cells one line of a one-column reading occupies: the old number,
 * the new one, and the text. A blank cell keeps the columns in step, the way a
 * missing side does in the two-column layout.
 */
function InlineCells({ line, highlighted }: {
  readonly line: InlineLine
  readonly highlighted: HighlightedLine
}): ReactNode {
  const tone = line.kind === 'delete' ? css.del : line.kind === 'insert' ? css.add : undefined
  const text = line.text ?? ''
  return (
    <>
      <span className={cx(css.num, tone)}>{line.oldNo ?? ''}</span>
      <span className={cx(css.num, tone)}>{line.newNo ?? ''}</span>
      <span className={cx(css.text, tone)}>
        <LineText line={highlighted} text={text} />
      </span>
    </>
  )
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
  // Every diff follows the same answers, so the choices are a store rather than
  // this tab's state: they are how the reader reads diffs, not what this one
  // holds. The same reader serves both sides of a render, hence the snapshot.
  const settings = useSyncExternalStore(
    subscribeDiffViewSettings,
    diffViewSettings,
    diffViewSettings,
  )
  const inline = settings.mode === 'inline'
  const lines = useMemo(() => (inline ? inlineDisplayLines(rows) : []), [inline, rows])

  // Highlighting runs over the whole side at once, so a construct that spans
  // lines is read in context, and the runs are then taken one line at a time.
  // The line arrays line up with the rows because a row that draws no line
  // contributes an empty one.
  const lang = langFromPath(diff.path)
  const column = (pick: (row: DiffRow) => string | undefined): string =>
    rows.map(row => (row.kind === 'fold' ? '' : pick(row.row) ?? '')).join('\n')
  const leftText = column(row => row.left?.text)
  const rightText = column(row => row.right?.text)
  const inlineText = useMemo(
    () => lines.map(line => line.text ?? '').join('\n'),
    [lines],
  )
  const left = useMemo(() => highlightLines(leftText, lang), [leftText, lang])
  const right = useMemo(() => highlightLines(rightText, lang), [rightText, lang])
  const unified = useMemo(
    () => (inline ? highlightLines(inlineText, lang) : undefined),
    [inline, inlineText, lang],
  )
  // The copy control's label flips for a moment after a copy, the way the
  // transcript's diff card confirms one.
  const [copied, setCopied] = useState(false)
  const copy = useCallback(() => {
    void writeClipboard(diffText(diff)).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 1000)
    })
  }, [diff])

  const root = embedded ? css.diffEmbedded : css.diff
  const parts = pathParts(diff.path)
  const notice = diff.binary ? t('diff.binary') : diff.truncated ? t('diff.truncated') : undefined
  // A fold and a host gap are the same control in either layout, so both are
  // drawn from the one description.
  const drawer = (line: InlineLine, at: number): ReactNode => {
    if (line.kind === 'fold') {
      return (
        <button
          key={line.key}
          type="button"
          className={css.fold}
          onClick={() => {
            setExpanded(current => new Set(current).add(line.key))
          }}
        >
          ⋯ {line.hidden} {t('diff.unchanged')}
        </button>
      )
    }
    if (line.kind === 'gap') {
      // Rows the host left out to keep a huge diff readable. The counts are
      // stated because a view that is not contiguous must say so.
      const left = line.skippedLeft ?? 0
      const right = line.skippedRight ?? 0
      const count = left === right ? String(left) : `${String(left)} / ${String(right)}`
      return <span key={line.key} className={css.gap}>⋯ {count} {t('diff.omitted')}</span>
    }
    return <InlineCells key={line.key} line={line} highlighted={unified?.[at]} />
  }
  const grid = (
    <div
      className={css.grid}
      data-view={inline ? 'inline' : 'split'}
      data-wrap={settings.wrap ? 'wrap' : 'clip'}
    >
      {inline
        ? lines.map((line, at) => drawer(line, at))
        : rows.map((row, at) => {
          if (row.kind === 'fold') {
            return drawer({ kind: 'fold', key: row.key, hidden: row.hidden }, at)
          }
          if (row.row.kind === 'gap') {
            return drawer({
              kind: 'gap',
              key: row.key,
              ...row.row.skippedLeft === undefined ? {} : { skippedLeft: row.row.skippedLeft },
              ...row.row.skippedRight === undefined ? {} : { skippedRight: row.row.skippedRight },
            }, at)
          }
          return <Cells key={row.key} row={row.row} left={left?.[at]} right={right?.[at]} />
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
        <span className={css.actions}>
          <span className={css.revs}>{diff.oldLabel} → {diff.newLabel}</span>
          <span className={css.stat}>
            <span className={css.added}>+{diff.added}</span>
            <span className={css.removed}>−{diff.removed}</span>
          </span>
          <button
            type="button"
            className={css.view}
            title={inline ? t('diff.splitView') : t('diff.inlineView')}
            aria-label={inline ? t('diff.splitView') : t('diff.inlineView')}
            onClick={() => { setDiffViewMode(inline ? 'split' : 'inline') }}
          >
            {inline ? <SplitLayoutGlyph /> : <InlineLayoutGlyph />}
          </button>
          <button
            type="button"
            className={css.view}
            title={settings.wrap ? t('diff.clipView') : t('diff.wrapView')}
            aria-label={settings.wrap ? t('diff.clipView') : t('diff.wrapView')}
            onClick={() => { setDiffWrap(!settings.wrap) }}
          >
            {settings.wrap ? <ClipLinesGlyph /> : <WrapLinesGlyph />}
          </button>
          <button type="button" className={css.copy} onClick={copy}>
            {copied ? t('diff.copied') : t('diff.copy')}
          </button>
        </span>
      </header>
      {notice !== undefined && <p className={css.notice}>{notice}</p>}
      {embedded
        ? <div className={css.gridScroll} data-dsh-git-diff="">{grid}</div>
        : <div className={css.scroll} data-dsh-git-diff="">{grid}</div>}
    </div>
  )
}
