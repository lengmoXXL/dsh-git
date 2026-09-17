/**
 * What the diff draws, row by row, in every layout the reader can choose.
 *
 * The two layout switches are cosmetic: wrapping decides whether a long line
 * wraps inside its half or scrolls there, and the view switch decides whether
 * the two sides sit in two columns or in one. Neither may change WHICH line is
 * drawn against which — that comes from the host's alignment, and it is the
 * same fact whatever the pane looks like.
 *
 * The rendered markup is the only place that claim can be checked, because the
 * pairing the reader sees is the pairing the DOM holds. These tests render one
 * payload through the built bundle in each combination and compare the rows the
 * markup came out with, so a layout that drops a row, adds one, or shifts a
 * side by a row fails here rather than in a screenshot.
 *
 * The payload's path names no grammar, so its cells carry plain text and the
 * markup can be read without a DOM: a highlighted cell nests spans inside the
 * cell, and this file is about rows, not tokens.
 *
 * Reading markup with regexes makes every match group `| undefined` to the type
 * checker, so the defaults below are what a test does with a group that is not
 * there — not guards against a state this suite can reach.
 *
 * @module dsh-git/tests/e2e/diff-rows
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { DiffPayload, DiffRow } from '../../src/shared/wire.ts'
import { loadBundle, render } from './harness.ts'

/**
 * One cell or held band, as a token walk finds it. The class prefix is what the
 * two layouts are allowed to differ in: the wrapped body names cells `.num` and
 * `.text`, a lane names them `.laneNum` and `.laneText`.
 */
const TOKEN = /<span class="[^"]*_(?:lane)?(num|text)[^"]*"[^>]*>([^<]*)<\/span>|<div class="[^"]*_held[^"]*"[^>]*>([\s\S]*?)<\/div>/gi

/** One thing a drawn row is built from. */
interface Token {
  readonly kind: 'num' | 'text' | 'held'
  readonly value: string
}

/** One context row pair. */
function context(no: number, text: string): DiffRow {
  return { kind: 'context', left: { no, text }, right: { no, text } }
}

/**
 * A change with a row of every kind, with runs long enough between the changes
 * that the unchanged middles fold — a fold is a row of its own, and the layouts
 * have to agree about where it lands.
 */
function payload(): DiffPayload {
  const head = Array.from({ length: 9 }, (_unused, index) => context(index + 1, `head ${String(index + 1)}`))
  const tail = Array.from({ length: 9 }, (_unused, index) => context(index + 40, `tail ${String(index + 40)}`))
  return {
    path: 'src/a.txt',
    source: 'commit',
    oldLabel: 'abc^',
    newLabel: 'abc',
    binary: false,
    truncated: false,
    removed: 2,
    added: 2,
    rows: [
      ...head,
      { kind: 'replace', left: { no: 10, text: 'old ten' }, right: { no: 10, text: 'new ten' } },
      { kind: 'delete', left: { no: 11, text: 'gone' }, right: null },
      { kind: 'insert', left: null, right: { no: 11, text: 'added' } },
      { kind: 'gap', left: null, right: null, skippedLeft: 1200, skippedRight: 1203 },
      ...tail,
    ],
  }
}

/** Every cell and band one fragment holds, in document order. */
function tokens(fragment: string): Token[] {
  const out: Token[] = []
  for (const match of fragment.matchAll(TOKEN)) {
    if (match[3] !== undefined) {
      out.push({ kind: 'held', value: match[3].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim() })
      continue
    }
    out.push({ kind: (match[1] ?? '').toLowerCase() as 'num' | 'text', value: match[2] ?? '' })
  }
  return out
}

/**
 * Cut a token walk into rows: `width` cells each, with a held band a row of its
 * own.
 * @param walk - the tokens, in document order.
 * @param width - how many cells one row of this layout occupies.
 * @returns one entry per drawn row.
 */
function rowsOfTokens(walk: readonly Token[], width: number): Token[][] {
  const rows: Token[][] = []
  let current: Token[] = []
  for (const token of walk) {
    if (token.kind === 'held') {
      if (current.length > 0) rows.push(current)
      current = []
      rows.push([token])
      continue
    }
    current.push(token)
    if (current.length === width) {
      rows.push(current)
      current = []
    }
  }
  if (current.length > 0) rows.push(current)
  return rows
}

/** How one cell reads: a number bare, a line quoted. */
function cell(token: Token | undefined): string {
  if (token === undefined || token.kind === 'held') return ''
  return token.kind === 'num' ? token.value : `"${token.value}"`
}

/**
 * The rows one rendered diff drew, in order.
 *
 * A row reads `10 "old ten" | 10 "new ten"`, and a fold or a host gap reads as
 * the band it is. Two layouts that drew the same thing produce the same list,
 * whatever containers they used.
 * @param markup - the rendered diff body.
 * @param inline - whether the body was drawn as one column.
 * @returns one string per drawn row.
 */
function drawnRows(markup: string, inline: boolean): string[] {
  const lanes = [...markup.matchAll(/<div class="[^"]*_lane"[^>]*>/g)].map(match => match.index ?? 0)
  if (lanes.length > 0) {
    // One lane per half, each holding its own rows; a one-column body is a
    // single lane whose rows carry both numbers.
    const halves = lanes.map((at, index) => markup.slice(at, lanes[index + 1] ?? markup.length))
    const groups = halves.map(half => rowsOfTokens(tokens(half), 2))
    return (groups[0] ?? []).map((row, index) => {
      if (row[0]?.kind === 'held') return row[0].value
      const other = groups[1]?.[index] ?? []
      return inline
        ? `${cell(row[0])} ${cell(row[1])}`
        : `${cell(row[0])} ${cell(row[1])} | ${cell(other[0])} ${cell(other[1])}`
    })
  }
  // The wrapped body: one grid, whose cells arrive in a fixed run per row.
  return rowsOfTokens(tokens(markup), inline ? 2 : 4).map((row) => {
    if (row[0]?.kind === 'held') return row[0].value
    return inline
      ? `${cell(row[0])} ${cell(row[1])}`
      : `${cell(row[0])} ${cell(row[1])} | ${cell(row[2])} ${cell(row[3])}`
  })
}

/** Render the payload in one layout combination, as markup. */
async function markupOf(view: 'split' | 'inline', wrap: boolean): Promise<string> {
  // The view reads its own settings from storage once per bundle evaluation, so
  // each combination gets the bundle it was configured with.
  const store = new Map([
    ['dsh-git:diff-view-mode', view],
    ['dsh-git:diff-view-wrap', wrap ? 'wrap' : 'clip'],
  ])
  const { exports } = await loadBundle(store)
  return await render(exports['SideBySide'], { diff: payload() })
}

/** Render the payload in one layout combination and read back its rows. */
async function draw(view: 'split' | 'inline', wrap: boolean): Promise<string[]> {
  return drawnRows(await markupOf(view, wrap), view === 'inline')
}

test('leaves an unwrapped body one lane per side, with both halves in step', async () => {
  // The structure is the point: two halves that keep the pane's width and scroll
  // their own long lines, rather than one body as wide as both sides' contents.
  // Equal row counts are what keeps them against each other, since a lane is
  // its own horizontal scroller and only the shared sequence holds the sides.
  const markup = await markupOf('split', false)
  const lanes = [...markup.matchAll(/<div class="[^"]*_lane"[^>]*>/g)].map(match => match.index ?? 0)
  assert.equal(lanes.length, 2, 'one lane per half')
  const halves = lanes.map((at, index) => markup.slice(at, lanes[index + 1] ?? markup.length))
  // Every row of a half lives in one scrolling content box, which is what
  // carries the width: a band is only as wide as its row, so the width has to
  // exist outside the rows or scrolling takes the band off the half.
  const wrappers = markup.match(/class="[^"]*_laneRows[^"]*"/g) ?? []
  assert.equal(wrappers.length, 2, 'each half has one scrolling content box')
  const rows = (fragment: string): number =>
    (fragment.match(/class="[^"]*_laneRow(?!s)[^"]*"|class="[^"]*_held(?!Spacer)[^"]*"/g) ?? []).length
  assert.equal(rows(halves[0] ?? ''), rows(halves[1] ?? ''), 'both halves draw the same number of rows')
  assert.equal(rows(halves[0] ?? ''), drawnRows(markup, false).length)

  // The wrapped body is one grid instead, with no lanes at all.
  const wrapped = await markupOf('split', true)
  assert.equal(wrapped.match(/class="[^"]*_lane"/g), null, 'the wrapped body has no lanes')
  assert.notEqual(wrapped.match(/class="[^"]*_grid"/), null, 'the wrapped body is a grid')
})

test('draws the same rows wrapped and unwrapped', async () => {
  const wrapped = await draw('split', true)
  const unwrapped = await draw('split', false)
  assert.deepEqual(unwrapped, wrapped)
  // One row per aligned row, in the host's order, each line on its own side,
  // and a band wherever lines were left out or folded.
  assert.deepEqual(wrapped, [
    '1 "head 1" | 1 "head 1"',
    '2 "head 2" | 2 "head 2"',
    '3 "head 3" | 3 "head 3"',
    '⋯ 3 diff.unchanged',
    '7 "head 7" | 7 "head 7"',
    '8 "head 8" | 8 "head 8"',
    '9 "head 9" | 9 "head 9"',
    '10 "old ten" | 10 "new ten"',
    '11 "gone" |  ""',
    ' "" | 11 "added"',
    '⋯ 1200 / 1203 diff.omitted',
    '40 "tail 40" | 40 "tail 40"',
    '41 "tail 41" | 41 "tail 41"',
    '42 "tail 42" | 42 "tail 42"',
    '⋯ 3 diff.unchanged',
    '46 "tail 46" | 46 "tail 46"',
    '47 "tail 47" | 47 "tail 47"',
    '48 "tail 48" | 48 "tail 48"',
  ])
})

test('draws the same rows in one column, wrapped and unwrapped', async () => {
  const wrapped = await draw('inline', true)
  const unwrapped = await draw('inline', false)
  assert.deepEqual(unwrapped, wrapped)
  // A replaced line is two lines here — its removal, then its insertion — and a
  // context line carries both numbers.
  assert.deepEqual(wrapped.slice(0, 6), [
    '1 "head 1"',
    '2 "head 2"',
    '3 "head 3"',
    '⋯ 3 diff.unchanged',
    '7 "head 7"',
    '8 "head 8"',
  ])
  // One number per line, and it is the line's own: a removal keeps the old one, an
  // addition takes the new one.
  assert.deepEqual(wrapped.slice(6, 15), [
    '9 "head 9"',
    '10 "old ten"',
    '10 "new ten"',
    '11 "gone"',
    '11 "added"',
    '⋯ 1200 / 1203 diff.omitted',
    '40 "tail 40"',
    '41 "tail 41"',
    '42 "tail 42"',
  ])
})
