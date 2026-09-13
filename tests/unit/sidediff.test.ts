/**
 * The side-by-side alignment, including its terminators, its line numbering,
 * and the budget that turns a pathological pair into one coarse block.
 *
 * @module dsh-git/tests/unit/sidediff
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildSideBySide, hunkRows, splitLines } from '../../src/git/sidediff.ts'

test('treats a single trailing newline as a terminator, not a line', () => {
  assert.deepEqual(splitLines(''), [])
  assert.deepEqual(splitLines('a'), ['a'])
  assert.deepEqual(splitLines('a\n'), ['a'])
  assert.deepEqual(splitLines('a\n\n'), ['a', ''])
  assert.deepEqual(splitLines('a\nb'), ['a', 'b'])
})

test('normalizes Windows line endings so a CRLF twin is not wholly changed', () => {
  const result = buildSideBySide('a\r\nb\r\n', 'a\nb\n')
  assert.equal(result.added, 0)
  assert.equal(result.removed, 0)
  assert.equal(result.rows.every(row => row.kind === 'context'), true)
})

test('reports an unchanged file as contexts only', () => {
  const result = buildSideBySide('a\nb\nc\n', 'a\nb\nc\n')
  assert.equal(result.added, 0)
  assert.equal(result.removed, 0)
  assert.deepEqual(result.rows.map(row => row.kind), ['context', 'context', 'context'])
  assert.deepEqual(result.rows[0]?.left, { no: 1, text: 'a' })
  assert.deepEqual(result.rows[0]?.right, { no: 1, text: 'a' })
})

test('pairs a rewritten line as one replacement row', () => {
  const result = buildSideBySide('a\nold\nc\n', 'a\nnew\nc\n')
  assert.equal(result.added, 1)
  assert.equal(result.removed, 1)
  assert.deepEqual(result.rows.map(row => row.kind), ['context', 'replace', 'context'])
  assert.deepEqual(result.rows[1], {
    kind: 'replace',
    left: { no: 2, text: 'old' },
    right: { no: 2, text: 'new' },
  })
})

test('leaves a line blank on the side that has none', () => {
  const inserted = buildSideBySide('a\nc\n', 'a\nb\nc\n')
  assert.equal(inserted.added, 1)
  assert.equal(inserted.removed, 0)
  const insertRow = inserted.rows.find(row => row.kind === 'insert')
  assert.equal(insertRow?.left, null)
  assert.deepEqual(insertRow?.right, { no: 2, text: 'b' })

  const deleted = buildSideBySide('a\nb\nc\n', 'a\nc\n')
  assert.equal(deleted.added, 0)
  assert.equal(deleted.removed, 1)
  const deleteRow = deleted.rows.find(row => row.kind === 'delete')
  assert.equal(deleteRow?.right, null)
  assert.deepEqual(deleteRow?.left, { no: 2, text: 'b' })
})

test('reports a created file as insertions and a deleted file as deletions', () => {
  const created = buildSideBySide('', 'x\ny\n')
  assert.equal(created.added, 2)
  assert.equal(created.removed, 0)
  assert.equal(created.rows.every(row => row.kind === 'insert'), true)

  const deleted = buildSideBySide('x\ny\n', '')
  assert.equal(deleted.added, 0)
  assert.equal(deleted.removed, 2)
  assert.equal(deleted.rows.every(row => row.kind === 'delete'), true)
})

test('keeps every line number correct across a mixed change', () => {
  const result = buildSideBySide('a\nb\nc\n', 'a\nc\nd\n')
  const left = result.rows.flatMap(row => (row.left === null ? [] : [row.left.no]))
  const right = result.rows.flatMap(row => (row.right === null ? [] : [row.right.no]))
  assert.deepEqual(left, [1, 2, 3])
  assert.deepEqual(right, [1, 2, 3])
  assert.deepEqual(result.rows.map(row => row.kind), ['context', 'delete', 'context', 'insert'])
})

test('falls back to one coarse block past the alignment budget', () => {
  const result = buildSideBySide('a\nb\nc\n', 'x\ny\nz\n', 1)
  assert.equal(result.coarse, true)
  assert.equal(result.added, 3)
  assert.equal(result.removed, 3)
  assert.equal(result.rows.every(row => row.kind === 'replace'), true)
})

test('shows an empty pair as no rows', () => {
  const result = buildSideBySide('', '')
  assert.deepEqual(result.rows, [])
  assert.equal(result.added, 0)
  assert.equal(result.removed, 0)
})

/** Build one side of a file whose every line is distinct. */
function fileOf(count: number, mutate: (line: string, index: number) => string = line => line): string {
  const lines: string[] = []
  for (let index = 0; index < count; index += 1) lines.push(mutate(`line ${String(index)}`, index))
  return `${lines.join('\n')}\n`
}

test('aligns a one-line edit in a large file without going coarse', () => {
  // The regression this guards: a 1500-line file used to exceed the alignment
  // budget and be paired by position, painting every unchanged line red/green.
  const before = fileOf(1500)
  const after = fileOf(1500, (line, index) => (index === 750 ? 'CHANGED' : line))

  const result = buildSideBySide(before, after)
  assert.equal(result.coarse, false)
  assert.equal(result.added, 1)
  assert.equal(result.removed, 1)
  assert.equal(result.rows.filter(row => row.kind === 'context').length, 1499)
  assert.deepEqual(
    result.rows.filter(row => row.kind !== 'context'),
    [{ kind: 'replace', left: { no: 751, text: 'line 750' }, right: { no: 751, text: 'CHANGED' } }],
  )
})

test('aligns a large file whose first and last lines both changed', () => {
  // No common head or tail to trim, and the region is far past the exact
  // budget — the unique-line anchors are what keep this exact.
  const before = fileOf(2500)
  const after = fileOf(2500, (line, index) => {
    if (index === 0) return 'FIRST'
    if (index === 2499) return 'LAST'
    return line
  })

  const result = buildSideBySide(before, after)
  assert.equal(result.coarse, false)
  assert.equal(result.added, 2)
  assert.equal(result.removed, 2)
  assert.equal(result.rows.filter(row => row.kind === 'context').length, 2498)
})

test('never paints an unchanged line as changed, even when pairing by position', () => {
  // Repeated lines leave no usable anchor, so this region is paired by
  // position. The lines that match at their position must still read as
  // unchanged; only the genuinely different positions are a change.
  const result = buildSideBySide('A\nE\nB\nE\nC\n', 'X\nE\nY\nE\nZ\n', 1)
  assert.equal(result.coarse, true)
  assert.deepEqual(
    result.rows.map(row => row.kind),
    ['replace', 'context', 'replace', 'context', 'replace'],
  )
  assert.equal(result.added, 3)
  assert.equal(result.removed, 3)
})

test('keeps a big insertion from making the rest of the file look changed', () => {
  const before = fileOf(1200)
  const inserted = `${fileOf(400, line => `inserted ${line}`)}`
  const after = `${before.split('\n').slice(0, 600).join('\n')}\n${inserted}${before.split('\n').slice(600).join('\n')}`

  const result = buildSideBySide(before, after)
  assert.equal(result.added, 400)
  assert.equal(result.removed, 0)
  assert.equal(result.coarse, false)
  // Everything outside the insertion is still a context row on both sides.
  assert.equal(result.rows.filter(row => row.kind === 'insert').length, 400)
  assert.equal(result.rows.filter(row => row.kind === 'context').length, 1200)
})

test('returns a diff that fits unchanged', () => {
  const rows = buildSideBySide('a\nb\n', 'a\nB\n').rows
  assert.deepEqual(hunkRows(rows, 10), rows)
})

test('cuts a large diff around its change and states what it left out', () => {
  const before = fileOf(200)
  const after = fileOf(200, (line, index) => (index === 149 ? 'CHANGED' : line))
  const rows = buildSideBySide(before, after).rows

  const cut = hunkRows(rows, 20, 4)
  assert.ok(cut.length < rows.length)
  // The change is present, with its context, and both omissions are stated.
  assert.equal(cut.filter(row => row.kind === 'replace').length, 1)
  assert.equal(cut[0]?.kind, 'gap')
  assert.equal(cut[0]?.skippedLeft, 145)
  assert.equal(cut[0]?.skippedRight, 145)
  const tail = cut[cut.length - 1]
  assert.equal(tail?.kind, 'gap')
  assert.equal(tail?.skippedLeft, 46)

  // Nothing is invented and nothing is silently dropped: kept lines plus
  // skipped lines are exactly the alignment.
  const kept = cut.filter(row => row.kind !== 'gap').length
  const skipped = cut.reduce((sum, row) => sum + (row.skippedLeft ?? 0), 0)
  assert.equal(kept + skipped, rows.length)
})

test('keeps every change when they are scattered far apart', () => {
  const before = fileOf(400)
  const after = fileOf(400, (line, index) => (index === 50 || index === 350 ? `CHANGED ${String(index)}` : line))
  const rows = buildSideBySide(before, after).rows

  const cut = hunkRows(rows, 40, 2)
  assert.equal(cut.filter(row => row.kind === 'replace').length, 2)
  // One gap between the two hunks, and one at each end.
  assert.equal(cut.filter(row => row.kind === 'gap').length, 3)
})

test('never exceeds the row cap', () => {
  const before = fileOf(600)
  const after = fileOf(600, (line, index) => (index % 3 === 0 ? 'x' : line))
  const rows = buildSideBySide(before, after).rows
  assert.ok(hunkRows(rows, 30).length <= 30)
})
