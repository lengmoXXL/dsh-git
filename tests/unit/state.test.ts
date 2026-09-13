/**
 * The list's derived state: how changed paths group, how a change is marked,
 * what a commit's refs become, how a long unchanged run folds, and how a
 * rejected request is described.
 *
 * @module dsh-git/tests/unit/state
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeEntry, ChangeKind, DiffRow } from '../../src/shared/wire.ts'
import { GitRequestError } from '../../src/client/face.ts'
import {
  collapseRows,
  failureInfoOf,
  groupChanges,
  parseRefs,
  statusLetter,
} from '../../src/client/state.ts'

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
