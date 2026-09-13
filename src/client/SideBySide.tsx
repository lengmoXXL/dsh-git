/**
 * The diff view: one aligned row per line pair, old on the left and new on the
 * right, with the unchanged middles of long files folded away.
 *
 * The component draws only what the host already aligned, so there is no diff
 * algorithm in the browser and the two columns can never disagree about which
 * lines correspond.
 *
 * Two layouts, chosen by the reader's settings. Wrapped, the body is one grid:
 * the halves share the pane and a line too long for its half wraps inside it,
 * which is also what keeps the two sides' rows the same height and therefore in
 * step. Unwrapped, the halves still share the pane but each is its own
 * horizontal scroller, so a line wider than half the pane is read by scrolling
 * that half — widening the body instead would push the other half out of view,
 * and two columns that cannot both be seen at once are not a side-by-side diff.
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
import { BUILD_STAMP } from './build.ts'
import { highlightLines, langFromPath, type HighlightSpan } from './highlight.ts'
import type { GitKey } from './locales.ts'
import {
  collapseRows,
  diffText,
  inlineDisplayLines,
  revLabel,
  type DisplayRow,
  type InlineLine,
} from './state.ts'
import {
  diffViewSettings,
  setDiffViewMode,
  setDiffWrap,
  subscribeDiffViewSettings,
} from './view-mode.ts'
import css from './SideBySide.module.css'

/** One line's highlighted runs, as the view draws them. */
type HighlightedLine = readonly HighlightSpan[] | undefined

/** Which half of a two-column reading a row is drawn for. */
type Side = 'left' | 'right'

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

/** The wrapped body's cells stay in step because every row is a grid row. */
function toneOf(kind: InlineLine['kind'] | undefined): string | undefined {
  if (kind === 'delete') return css.del
  if (kind === 'insert') return css.add
  return undefined
}

/**
 * One side of the rows as the highlighter reads it: every line that side draws,
 * in order, with an empty line where it has none.
 * @param rows - the display rows.
 * @param pick - the side's text for one diff row.
 * @returns the side's text, one line per drawn row.
 */
function columnText(rows: readonly DisplayRow[], pick: (row: DiffRow) => string | undefined): string {
  return rows.map(row => (row.kind === 'fold' ? '' : pick(row.row) ?? '')).join('\n')
}

/** The four cells one aligned row occupies in the wrapped grid. */
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

/**
 * The three cells one line of a one-column reading occupies: the old number,
 * the new one, and the text. A blank cell keeps the columns in step, the way a
 * missing side does in the two-column layout.
 */
function InlineCells({ line, highlighted }: {
  readonly line: InlineLine
  readonly highlighted: HighlightedLine
}): ReactNode {
  const tone = toneOf(line.kind)
  return (
    <>
      <span className={cx(css.num, tone)}>{line.oldNo ?? ''}</span>
      <span className={cx(css.num, tone)}>{line.newNo ?? ''}</span>
      <span className={cx(css.text, tone)}>
        <LineText line={highlighted} text={line.text ?? ''} />
      </span>
    </>
  )
}

/**
 * One line of an unwrapped half: its number — or the pair a one-column reading
 * carries — pinned to the half's left edge, and the line itself, which scrolls
 * sideways under them.
 *
 * The band rides the row rather than the cells, so a pinned number can own an
 * opaque background: a number that let the line show through would be
 * unreadable the moment a reader scrolled.
 */
function LaneRow({ numbers, text, highlighted, tone }: {
  readonly numbers: readonly (number | undefined)[]
  readonly text: string
  readonly highlighted: HighlightedLine
  readonly tone: string | undefined
}): ReactNode {
  return (
    <div className={cx(css.laneRow, tone)} data-numbers={numbers.length}>
      {numbers.map((no, index) => (
        <span key={index} className={css.laneNum}>{no ?? ''}</span>
      ))}
      <span className={css.laneText}>
        <LineText line={highlighted} text={text} />
      </span>
    </div>
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
  const rows = useMemo(() => collapseRows(diff.rows, undefined, expanded), [diff, expanded])
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
  // contributes an empty one. Both texts are memoized because the highlighter
  // is: an unmemoized string would re-highlight the whole side every render.
  const lang = langFromPath(diff.path)
  const leftText = useMemo(() => columnText(rows, row => row.left?.text), [rows])
  const rightText = useMemo(() => columnText(rows, row => row.right?.text), [rows])
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
  const expand = useCallback((key: string) => {
    setExpanded(current => new Set(current).add(key))
  }, [])
  /** The control that reopens a run of lines the reader folded. */
  const foldControl = (key: string, hidden: number | undefined): ReactNode => (
    <button type="button" className={css.fold} onClick={() => { expand(key) }}>
      ⋯ {hidden} {t('diff.unchanged')}
    </button>
  )
  /** A run the host left out. Its counts are stated, because a view that is not
   *  contiguous must say so. */
  const gapControl = (line: Pick<InlineLine, 'skippedLeft' | 'skippedRight'>): ReactNode => {
    const before = line.skippedLeft ?? 0
    const after = line.skippedRight ?? 0
    const count = before === after ? String(before) : `${String(before)} / ${String(after)}`
    return <span className={css.gap}>⋯ {count} {t('diff.omitted')}</span>
  }
  /** The control one display row stands for, when it is not a line. */
  const heldControl = (row: DisplayRow): ReactNode => row.kind === 'fold'
    ? foldControl(row.key, row.hidden)
    : gapControl(row.row)

  // The wrapped body: one grid, so both halves share each row's height.
  const grid = (
    <div className={css.grid} data-view={inline ? 'inline' : 'split'}>
      {inline
        ? lines.map((line, at) => (line.kind === 'fold' || line.kind === 'gap'
          ? (
            <div key={line.key} className={css.held}>
              {line.kind === 'fold' ? foldControl(line.key, line.hidden) : gapControl(line)}
            </div>
          )
          : <InlineCells key={line.key} line={line} highlighted={unified?.[at]} />))
        : rows.map((row, at) => (row.kind === 'fold' || row.row.kind === 'gap'
          ? <div key={row.key} className={css.held}>{heldControl(row)}</div>
          : <Cells key={row.key} row={row.row} left={left?.[at]} right={right?.[at]} />))}
    </div>
  )

  // The unwrapped body: one lane per half, each scrolling its own long lines. A
  // fold or a gap is stated once, in the half a reader starts at, and the other
  // half keeps step with a band of the same height.
  const laneSide = (side: Side): ReactNode =>
    rows.map((row, at) => {
      if (row.kind === 'fold' || row.row.kind === 'gap') {
        return (
          <div key={row.key} className={css.held}>
            {side === 'right' ? <span className={css.heldSpacer} /> : heldControl(row)}
          </div>
        )
      }
      const cell = side === 'left' ? row.row.left : row.row.right
      const changed = side === 'left'
        ? row.row.kind === 'delete' || row.row.kind === 'replace'
        : row.row.kind === 'insert' || row.row.kind === 'replace'
      return (
        <LaneRow
          key={row.key}
          numbers={[cell?.no]}
          text={cell?.text ?? ''}
          highlighted={(side === 'left' ? left : right)?.[at]}
          tone={cell === null ? css.blank : changed ? toneOf(side === 'left' ? 'delete' : 'insert') : undefined}
        />
      )
    })
  const laneInline: ReactNode = lines.map((line, at) => (line.kind === 'fold' || line.kind === 'gap'
    ? (
      <div key={line.key} className={css.held}>
        {line.kind === 'fold' ? foldControl(line.key, line.hidden) : gapControl(line)}
      </div>
    )
    : (
      <LaneRow
        key={line.key}
        numbers={[line.oldNo, line.newNo]}
        text={line.text ?? ''}
        highlighted={unified?.[at]}
        tone={toneOf(line.kind)}
      />
    )))
  const lanes = (
    <div className={css.lanes} data-view={inline ? 'inline' : 'split'}>
      {inline
        ? <div className={css.lane}><div className={css.laneRows}>{laneInline}</div></div>
        : (
          <>
            <div className={css.lane}><div className={css.laneRows}>{laneSide('left')}</div></div>
            <div className={css.lane}><div className={css.laneRows}>{laneSide('right')}</div></div>
          </>
        )}
    </div>
  )
  const body = settings.wrap ? grid : lanes

  return (
    <div className={root}>
      <header className={css.header}>
        <span className={css.path} title={diff.path}>
          {parts.dir !== '' && <span className={css.orig}>{parts.dir}/</span>}
          {parts.base}
          {diff.origPath !== undefined && <span className={css.orig}> ← {diff.origPath}</span>}
        </span>
        <span className={css.actions}>
          {/* The tooltip names the bundle drawing this: a page can be running
              an older one while the diff's content is current. */}
          <span className={css.revs} title={`${diff.oldLabel} → ${diff.newLabel} · ${BUILD_STAMP}`}>
            {revLabel(diff.oldLabel)} → {revLabel(diff.newLabel)}
          </span>
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
        ? <div className={css.gridScroll} data-dsh-git-diff="">{body}</div>
        : <div className={css.scroll} data-dsh-git-diff="">{body}</div>}
    </div>
  )
}
