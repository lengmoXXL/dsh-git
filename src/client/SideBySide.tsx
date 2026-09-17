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

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { DiffPayload, DiffRow } from '../shared/wire.ts'
import { cx } from './format.ts'
import { highlightLines, langFromPath, type HighlightSpan } from './highlight.ts'
import type { GitKey } from './locales.ts'
import {
  collapseRows,
  inlineDisplayLines,
  lineNumber,
  oneSided,
  type DisplayRow,
  type InlineLine,
} from './state.ts'
import {
  diffViewSettings,
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
  return rows.map(row => (row.kind === 'diff' ? pick(row.row) ?? '' : '')).join('\n')
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
      <span className={cx(css.text, leftTone)} data-half="left">
        <LineText line={left} text={row.left?.text ?? ''} />
      </span>
      <span className={cx(css.num, rightTone)}>{row.right?.no ?? ''}</span>
      <span className={cx(css.text, rightTone)} data-half="right">
        <LineText line={right} text={row.right?.text ?? ''} />
      </span>
    </>
  )
}

/**
 * Which half a node belongs to, if any.
 * @param node - a node inside the diff, or null.
 * @returns the half it sits in, or null when it sits in none.
 */
function halfAt(node: Node | null): string | null {
  const element = node === null ? null : node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return element?.closest('[data-half]')?.getAttribute('data-half') ?? null
}

/**
 * The two cells one line of a one-column reading occupies: the number it has on
 * its own side, and the text. Two numbers belong to the two-column reading, where
 * there really are two sides to line up.
 */
function InlineCells({ line, highlighted }: {
  readonly line: InlineLine
  readonly highlighted: HighlightedLine
}): ReactNode {
  const tone = toneOf(line.kind)
  return (
    <>
      <span className={cx(css.num, tone)}>{lineNumber(line) ?? ''}</span>
      <span className={cx(css.text, tone)} data-half="inline">
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
function LaneRow({ numbers, text, highlighted, tone, half }: {
  readonly numbers: readonly (number | undefined)[]
  readonly text: string
  readonly highlighted: HighlightedLine
  readonly tone: string | undefined
  readonly half: Side | 'inline'
}): ReactNode {
  return (
    <div className={cx(css.laneRow, tone)} data-numbers={numbers.length} data-half={half}>
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
  // A wholly new or wholly gone file has one side to show: two columns would be a
  // column of code beside a column of blanks, and the blanks are not information.
  const inline = settings.mode === 'inline' || oneSided(diff)
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
  const root = embedded ? css.diffEmbedded : css.diff
  const scrollRef = useRef<HTMLDivElement>(null)

  // A drag belongs to the half it began in: while it lasts the other half is not
  // selectable, so a copied hunk is one side's text and never both interleaved.
  useEffect(() => {
    const element = scrollRef.current
    if (element === null) return
    const down = (event: PointerEvent): void => {
      const target = event.target
      const half = target instanceof Element ? target.closest('[data-half]')?.getAttribute('data-half') : null
      if (half !== null && half !== undefined) element.setAttribute('data-selecting', half)
    }
    const up = (): void => { element.removeAttribute('data-selecting') }
    element.addEventListener('pointerdown', down)
    element.addEventListener('pointerup', up)
    element.addEventListener('pointercancel', up)
    return () => {
      element.removeEventListener('pointerdown', down)
      element.removeEventListener('pointerup', up)
      element.removeEventListener('pointercancel', up)
    }
  }, [])

  // The keyboard, and any selection that outran the pointer, is settled at copy
  // time: the text written is the half the selection started in.
  useEffect(() => {
    const onCopy = (event: ClipboardEvent): void => {
      const selection = window.getSelection()
      if (selection === null || selection.isCollapsed || event.clipboardData === null) return
      const range = selection.getRangeAt(0)
      // A copy handler that throws is worse than one that steps aside: whatever
      // cannot answer "did the selection touch this" leaves the copy to the browser.
      if (typeof range.intersectsNode !== 'function') return
      const covered = [...document.querySelectorAll('[data-half]')]
        .filter(node => range.intersectsNode(node))
      if (covered.length === 0) return
      const from = halfAt(selection.anchorNode) ?? covered[0]?.getAttribute('data-half') ?? null
      const lines = covered
        .filter(node => node.getAttribute('data-half') === from)
        .map(node => node.textContent ?? '')
      if (lines.length === 0) return
      event.clipboardData.setData('text/plain', `${lines.join('\n')}\n`)
      event.preventDefault()
    }
    document.addEventListener('copy', onCopy)
    return () => { document.removeEventListener('copy', onCopy) }
  }, [])
  const notice = diff.binary ? t('diff.binary') : diff.truncated ? t('diff.truncated') : undefined
  const toggleFold = useCallback((key: string) => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])
  /**
   * The control for a run of unchanged lines: three dots and how many are behind
   * them, centred, opening the run. Opened, the run is headed by the band that
   * folds it back — the shape the editor's own diff uses.
   */
  const foldControl = (key: string, hidden: number | undefined): ReactNode => (
    <button type="button" className={css.fold} onClick={() => { toggleFold(key) }}>
      <span className={css.foldGlyph}>{'⋯ '}</span>
      {hidden} {t('diff.unchanged')}
    </button>
  )
  /** The band that folds an opened run back, at the top of the run. */
  const foldBackControl = (key: string): ReactNode => (
    <button
      type="button"
      className={css.fold}
      title={t('section.collapse')}
      aria-label={t('section.collapse')}
      onClick={() => { toggleFold(key) }}
    >
      <span className={css.foldGlyph}>↑</span>
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
  const heldControl = (row: DisplayRow): ReactNode => {
    if (row.kind === 'fold') return foldControl(row.key, row.hidden)
    if (row.kind === 'collapse') return foldBackControl(row.key)
    return gapControl(row.row)
  }

  // The wrapped body: one grid, so both halves share each row's height.
  const grid = (
    <div className={css.grid} data-view={inline ? 'inline' : 'split'}>
      {inline
        ? lines.map((line, at) => (line.kind === 'fold' || line.kind === 'collapse' || line.kind === 'gap'
          ? (
            <div key={line.key} className={cx(css.held, line.kind === 'collapse' && css.heldBack)}>
              {line.kind === 'fold'
                ? foldControl(line.key, line.hidden)
                : line.kind === 'collapse' ? foldBackControl(line.key) : gapControl(line)}
            </div>
          )
          : <InlineCells key={line.key} line={line} highlighted={unified?.[at]} />))
        : rows.map((row, at) => (row.kind !== 'diff' || row.row.kind === 'gap'
          ? (
            <div key={row.key} className={cx(css.held, row.kind === 'collapse' && css.heldBack)}>
              {heldControl(row)}
            </div>
          )
          : <Cells key={row.key} row={row.row} left={left?.[at]} right={right?.[at]} />))}
    </div>
  )

  // The unwrapped body: one lane per half, each scrolling its own long lines. A
  // fold or a gap is stated once, in the half a reader starts at, and the other
  // half keeps step with a band of the same height.
  const laneSide = (side: Side): ReactNode =>
    rows.map((row, at) => {
      // A band is a run the reader folded or opened, or a run the host left out —
      // which arrives as a diff row, because the host sent it as a row.
      if (row.kind !== 'diff' || row.row.kind === 'gap') {
        // Stated once, in the half a reader starts at; the other half draws its
        // row empty, which the lane's fixed-height tracks keep in step.
        return (
          <div key={row.key} className={cx(css.held, row.kind === 'collapse' && css.heldBack)}>
            {side === 'left' && heldControl(row)}
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
          half={side}
          numbers={[cell?.no]}
          text={cell?.text ?? ''}
          highlighted={(side === 'left' ? left : right)?.[at]}
          tone={cell === null ? css.blank : changed ? toneOf(side === 'left' ? 'delete' : 'insert') : undefined}
        />
      )
    })
  const laneInline: ReactNode = lines.map((line, at) => (line.kind === 'fold' || line.kind === 'collapse' || line.kind === 'gap'
    ? (
      <div key={line.key} className={cx(css.held, line.kind === 'collapse' && css.heldBack)}>
        {line.kind === 'fold'
          ? foldControl(line.key, line.hidden)
          : line.kind === 'collapse' ? foldBackControl(line.key) : gapControl(line)}
      </div>
    )
    : (
      <LaneRow
        key={line.key}
        half="inline"
        numbers={[lineNumber(line)]}
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
      {notice !== undefined && <p className={css.notice}>{notice}</p>}
      {embedded
        ? <div className={css.gridScroll} data-dsh-git-diff="" ref={scrollRef}>{body}</div>
        : <div className={css.scroll} data-dsh-git-diff="" ref={scrollRef}>{body}</div>}
    </div>
  )
}
