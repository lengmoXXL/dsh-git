/**
 * The list's derived state: how changed paths group, how a change is marked,
 * what a commit's refs become, how a diff copies as text, how a long unchanged
 * run folds, and how a rejected request is described.
 *
 * @module dsh-git/tests/unit/state
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeEntry, ChangeKind, DiffRow } from '../../src/shared/wire.ts'
import { GitRequestError } from '../../src/client/face.ts'
import {
  collapseRows,
  clampRailWidth,
  DIFF_MIN_WIDTH,
  failureInfoOf,
  fileAddress,
  placePane,
  RAIL_MIN_WIDTH,
  groupChanges,
  inlineDisplayLines,
  inlineLines,
  parseRefs,
  statusLetter,
} from '../../src/client/state.ts'

/** One status entry. */
function entry(stage: ChangeEntry['stage'], path: string, kind: ChangeEntry['kind'] = 'modified'): ChangeEntry {
  return { path, index: 'M', kind, stage }
}

/** One context row pair. */
function contextRow(no: number): DiffRow {
  return { kind: 'context', left: { no, text: `line ${String(no)}` }, right: { no, text: `line ${String(no)}` } }
}

test('groups entries by the stage they were reported for', () => {
  const grouped = groupChanges([
    entry('unstaged', 'a'),
    entry('staged', 'b'),
    entry('untracked', 'c', 'untracked'),
    entry('conflicted', 'd', 'conflicted'),
    entry('unstaged', 'e'),
  ])
  assert.deepEqual(grouped.conflicted.map(item => item.path), ['d'])
  assert.deepEqual(grouped.staged.map(item => item.path), ['b'])
  assert.deepEqual(grouped.unstaged.map(item => item.path), ['a', 'e'])
  assert.deepEqual(grouped.untracked.map(item => item.path), ['c'])
})

test('reports no entry in a group nothing belongs to', () => {
  const grouped = groupChanges([entry('unstaged', 'a')])
  assert.deepEqual(grouped.conflicted, [])
  assert.deepEqual(grouped.staged, [])
  assert.deepEqual(grouped.untracked, [])
})

test('leaves a short unchanged run alone', () => {
  const rows = [contextRow(1), contextRow(2), contextRow(3)]
  const display = collapseRows(rows, 6)
  assert.deepEqual(display.map(item => item.kind), ['diff', 'diff', 'diff'])
})

test('folds a long unchanged run, and opens it a step at a time', () => {
  const rows = Array.from({ length: 100 }, (_unused, index) => contextRow(index + 1))
  const folded = collapseRows(rows, 6)
  const fold = folded.find(item => item.kind === 'fold')
  const hiddenOf = (list: ReturnType<typeof collapseRows>): number => {
    const found = list.find(item => item.kind === 'fold')
    return found?.kind === 'fold' ? found.hidden : 0
  }
  // Six survive, three at each end, and the row states what is behind them.
  assert.equal(hiddenOf(folded), 94)
  assert.deepEqual(folded.map(item => item.kind), ['diff', 'diff', 'diff', 'fold', 'diff', 'diff', 'diff'])

  const key = fold?.key ?? ''
  // A step up reveals fifteen more lines at the top, a step down the same at the
  // bottom, and each is stated until nothing is behind the row.
  assert.equal(hiddenOf(collapseRows(rows, 6, new Map([[key, { up: 15, down: 0 }]]))), 79)
  assert.equal(hiddenOf(collapseRows(rows, 6, new Map([[key, { up: 0, down: 15 }]]))), 79)

  // All of it: nothing is hidden, so there is no row left to draw.
  const all = collapseRows(rows, 6, new Map([[key, { up: 94, down: 94 }]]))
  assert.equal(all.every(item => item.kind === 'diff'), true)
  assert.equal(all.length, 100)
})

test('does not fold when a run is exactly at the limit', () => {
  const rows = Array.from({ length: 6 }, (_unused, index) => contextRow(index + 1))
  assert.equal(collapseRows(rows, 6).every(item => item.kind === 'diff'), true)
})

test('keeps both blocks at their floor and neither at a ceiling', () => {
  assert.equal(clampRailWidth(336, 1440), 336)
  // Nothing narrower than the list's floor, however hard the pointer is pulled.
  assert.equal(clampRailWidth(40, 1440), RAIL_MIN_WIDTH)
  // No ceiling: the list may have all of the pane but the diff's floor.
  assert.equal(clampRailWidth(2000, 1440), 1440 - DIFF_MIN_WIDTH)
  assert.equal(clampRailWidth(2000, 800), 800 - DIFF_MIN_WIDTH)
})

test('gives the diff floor up rather than the list floor on a narrow pane', () => {
  assert.equal(clampRailWidth(500, 500), RAIL_MIN_WIDTH)
  assert.equal(clampRailWidth(500, 300), RAIL_MIN_WIDTH)
})

test('rounds to whole pixels, so a drag cannot leave fractional widths behind', () => {
  assert.equal(clampRailWidth(336.4, 1440), 336)
  assert.equal(clampRailWidth(336.6, 1440), 337)
})

test('addresses a file the way the shell file view declares it', () => {
  // The shape is the shell's document preview's, which this plugin cannot import: the
  // client module table seeds package names, not subpaths. Asserted here because a
  // wrong shape is a file that never opens, and nothing else would notice.
  assert.equal(
    fileAddress('session-1', 'src/client/a b#c.ts'),
    'dsh-resource://file/session/session-1/src/client/a%20b%23c.ts',
  )
  // The session is one segment too, so an id carrying a slash cannot escape its scope.
  assert.equal(fileAddress('s/1', 'README.md'), 'dsh-resource://file/session/s%2F1/README.md')
})

test('leaves the upstream out of a commit chips list', () => {
  const refs = ['HEAD -> refs/heads/main', 'refs/remotes/origin/main', 'refs/remotes/origin/other']
  // The header names the upstream; a second capsule beside `main` says it twice.
  assert.deepEqual(parseRefs(refs, 'origin/main').map(chip => chip.name), ['main', 'origin/other'])
  // Without an upstream to leave out, every name is drawn.
  assert.deepEqual(parseRefs(refs).map(chip => chip.name), ['main', 'origin/main', 'origin/other'])
})

test('lands a diff in the focused pane, or beside it when asked', () => {
  const first = { key: 'a' }
  const second = { key: 'b' }
  const third = { key: 'c' }
  const panes = [first, second]

  // The first diff on an empty board has nowhere to replace, so it opens.
  assert.deepEqual(placePane([], first, false, null), [first])
  // Without the modifier the diff takes the focused pane's place…
  assert.deepEqual(placePane(panes, third, false, 'a'), [third, second])
  // …and with it, it opens beside the others.
  assert.deepEqual(placePane(panes, third, true, 'a'), [first, second, third])
  // A comparison already on the board is only focused: opening the same thing
  // again would compare it with itself.
  assert.equal(placePane(panes, second, false, 'a'), panes)
  assert.equal(placePane(panes, second, true, 'a'), panes)
})

test('names a host failure by its code and a transport failure by its marker', () => {
  assert.deepEqual(
    failureInfoOf(new GitRequestError('git/not-a-repository', 'not a repo')),
    { code: 'git/not-a-repository', message: 'not a repo' },
  )
  assert.deepEqual(failureInfoOf(new Error('socket closed')), {
    code: 'git/transport',
    message: 'socket closed',
  })
  assert.deepEqual(failureInfoOf('nope'), { code: 'git/transport', message: 'nope' })
})

test('marks every change kind with one letter, and a conflict with a bang', () => {
  const letters: Record<ChangeKind, string> = {
    modified: 'M',
    added: 'A',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    typechange: 'T',
    untracked: 'U',
    conflicted: '!',
    unknown: '?',
  }
  for (const [kind, letter] of Object.entries(letters)) {
    assert.equal(statusLetter(kind as ChangeKind), letter)
  }
})

test('draws the checked-out branch as one chip instead of a HEAD plus a branch', () => {
  assert.deepEqual(parseRefs(['HEAD -> refs/heads/main', 'refs/remotes/origin/main']), [
    { kind: 'head', name: 'main' },
    { kind: 'remote', name: 'origin/main' },
  ])
})

test('tells a local branch from a remote one by prefix, not by slashes in the name', () => {
  assert.deepEqual(parseRefs(['refs/heads/feature/x']), [{ kind: 'branch', name: 'feature/x' }])
  assert.deepEqual(parseRefs(['refs/remotes/origin/feature/x']), [
    { kind: 'remote', name: 'origin/feature/x' },
  ])
})

test('drops the remote’s symbolic HEAD and keeps the tags beside it', () => {
  assert.deepEqual(parseRefs(['refs/remotes/origin/HEAD', 'tag: refs/tags/v1.0']), [
    { kind: 'tag', name: 'v1.0' },
  ])
})

test('reads a detached HEAD, skips blanks, and falls back to the raw ref name', () => {
  assert.deepEqual(parseRefs(['HEAD']), [{ kind: 'head', name: 'HEAD' }])
  assert.deepEqual(parseRefs(['', '  ']), [])
  assert.deepEqual(parseRefs(['refs/stash']), [{ kind: 'branch', name: 'refs/stash' }])
})



test('reads a change in one column, where a replacement becomes its two lines', () => {
  const rows: DiffRow[] = [
    { kind: 'context', left: { no: 1, text: 'keep' }, right: { no: 1, text: 'keep' } },
    { kind: 'replace', left: { no: 2, text: 'old' }, right: { no: 2, text: 'new' } },
    { kind: 'delete', left: { no: 3, text: 'gone' }, right: null },
    { kind: 'insert', left: null, right: { no: 3, text: 'added' } },
    { kind: 'gap', left: null, right: null, skippedLeft: 900, skippedRight: 901 },
  ]
  assert.deepEqual(inlineLines(rows), [
    { kind: 'context', key: 'i0l', oldNo: 1, newNo: 1, text: 'keep' },
    { kind: 'delete', key: 'i1l', oldNo: 2, text: 'old' },
    { kind: 'insert', key: 'i1r', newNo: 2, text: 'new' },
    { kind: 'delete', key: 'i2l', oldNo: 3, text: 'gone' },
    { kind: 'insert', key: 'i3r', newNo: 3, text: 'added' },
    { kind: 'gap', key: 'i4', skippedLeft: 900, skippedRight: 901 },
  ])
})

test('keeps a fold where the reader closed it', () => {
  const rows = Array.from({ length: 20 }, (_unused, index) => contextRow(index + 1))
  const lines = inlineDisplayLines(collapseRows(rows, 6))
  assert.deepEqual(lines.map(line => line.kind), [
    'context', 'context', 'context', 'fold', 'context', 'context', 'context',
  ])
  assert.equal(lines[3]?.hidden, 14)
})
