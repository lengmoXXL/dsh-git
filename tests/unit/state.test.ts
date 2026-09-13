/**
 * The list's derived state: how changed paths group, how a change is marked,
 * what a commit's refs become, how a diff copies as text, how a long unchanged
 * run folds, and how a rejected request is described.
 *
 * @module dsh-git/tests/unit/state
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChangeEntry, ChangeKind, DiffPayload, DiffRow } from '../../src/shared/wire.ts'
import { GitRequestError } from '../../src/client/face.ts'
import {
  collapseRows,
  diffText,
  failureInfoOf,
  groupChanges,
  inlineDisplayLines,
  inlineLines,
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

test('copies a change as unified text, old side first', () => {
  const diff: DiffPayload = {
    path: 'src/a.ts',
    source: 'worktree',
    oldLabel: 'index',
    newLabel: 'working tree',
    binary: false,
    truncated: false,
    removed: 2,
    added: 2,
    rows: [
      { kind: 'context', left: { no: 1, text: 'keep' }, right: { no: 1, text: 'keep' } },
      { kind: 'replace', left: { no: 2, text: 'old' }, right: { no: 2, text: 'new' } },
      { kind: 'delete', left: { no: 3, text: 'gone' }, right: null },
      { kind: 'insert', left: null, right: { no: 3, text: 'added' } },
    ],
  }
  assert.equal(diffText(diff), [
    'src/a.ts',
    ' keep',
    '-old',
    '+new',
    '-gone',
    '+added',
    '',
  ].join('\n'))
})

test('names the old path and the rows the host left out in a copy', () => {
  const diff: DiffPayload = {
    path: 'src/new.ts',
    origPath: 'src/old.ts',
    source: 'commit',
    oldLabel: 'abc^',
    newLabel: 'abc',
    binary: false,
    truncated: true,
    removed: 0,
    added: 0,
    rows: [
      { kind: 'gap', left: null, right: null, skippedLeft: 900, skippedRight: 901 },
      { kind: 'insert', left: null, right: { no: 901, text: 'line' } },
    ],
  }
  assert.equal(diffText(diff), ['src/new.ts', '← src/old.ts', '⋯ 900 / 901', '+line', ''].join('\n'))
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
