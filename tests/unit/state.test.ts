/**
 * The list's derived state: how changed paths group, how a long unchanged run
 * folds, and how a rejected request is described.
 *
 * @module dsh-git/tests/unit/state
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeEntry, DiffRow } from '../../src/shared/wire.ts'
import { GitRequestError } from '../../src/client/face.ts'
import { collapseRows, failureInfoOf, groupChanges } from '../../src/client/state.ts'

/** One status entry. */
function entry(stage: ChangeEntry['stage'], path: string, kind: ChangeEntry['kind'] = 'modified'): ChangeEntry {
  return { path, index: 'M', worktree: '.', kind, stage }
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

test('folds the middle of a long unchanged run and re-expands it on request', () => {
  const rows = Array.from({ length: 20 }, (_unused, index) => contextRow(index + 1))
  const folded = collapseRows(rows, 6)
  assert.deepEqual(folded.map(item => item.kind), ['diff', 'diff', 'diff', 'fold', 'diff', 'diff', 'diff'])
  const fold = folded.find(item => item.kind === 'fold')
  assert.equal(fold?.kind === 'fold' ? fold.hidden : 0, 14)

  const expanded = collapseRows(rows, 6, new Set(fold === undefined ? [] : [fold.key]))
  assert.equal(expanded.length, 20)
  assert.equal(expanded.every(item => item.kind === 'diff'), true)
})

test('does not fold when a run is exactly at the limit', () => {
  const rows = Array.from({ length: 6 }, (_unused, index) => contextRow(index + 1))
  assert.equal(collapseRows(rows, 6).every(item => item.kind === 'diff'), true)
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
