/**
 * The `--porcelain=v2 -z` parser, against records shaped the way git writes
 * them: NUL-separated fields, a two-field rename, and a path that contains a
 * space.
 *
 * @module dsh-git/tests/unit/porcelain
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePorcelainV2 } from '../../src/git/status.ts'

/** Join parts the way `-z` writes them: each one NUL-terminated, run together. */
function fields(...parts: readonly string[]): string {
  return parts.map(part => `${part}\0`).join('')
}

/** The ordinary header block of a tracking branch. */
const HEADER = fields(
  '# branch.oid 0123456789abcdef0123456789abcdef01234567',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +2 -1',
)

test('reads the branch header', () => {
  const parsed = parsePorcelainV2(HEADER)
  assert.deepEqual(parsed.branch, {
    branch: 'main',
    detached: false,
    upstream: 'origin/main',
    ahead: 2,
    behind: 1,
  })
  assert.deepEqual(parsed.entries, [])
})

test('reads a detached HEAD and an unborn branch', () => {
  const detached = parsePorcelainV2(fields('# branch.oid abc123', '# branch.head (detached)'))
  assert.equal(detached.branch.detached, true)
  assert.equal(detached.branch.branch, null)

  const unborn = parsePorcelainV2(fields('# branch.oid (initial)', '# branch.head main'))
  assert.equal(unborn.branch.branch, 'main')
})

test('splits a both-halves change into one entry per stage', () => {
  const parsed = parsePorcelainV2(fields(
    '1 MM N... 100644 100644 100644 aaa bbb src/both.ts',
  ))
  assert.equal(parsed.entries.length, 2)
  assert.deepEqual(parsed.entries[0], {
    path: 'src/both.ts',
    index: 'M',
    kind: 'modified',
    stage: 'staged',
  })
  assert.equal(parsed.entries[1]?.stage, 'unstaged')
})

test('reports only the half that changed', () => {
  const unstaged = parsePorcelainV2(fields('1 .M N... 100644 100644 100644 aaa bbb src/a.ts'))
  assert.equal(unstaged.entries.length, 1)
  assert.equal(unstaged.entries[0]?.stage, 'unstaged')

  const staged = parsePorcelainV2(fields('1 M. N... 100644 100644 100644 aaa bbb src/b.ts'))
  assert.equal(staged.entries.length, 1)
  assert.equal(staged.entries[0]?.stage, 'staged')
})

test('takes the old path of a rename from the field after the record', () => {
  const parsed = parsePorcelainV2(fields(
    '2 R. N... 100644 100644 100644 aaa bbb R100 src/new.ts',
    'src/old.ts',
    '1 .M N... 100644 100644 100644 aaa bbb src/after.ts',
  ))
  assert.equal(parsed.entries.length, 2)
  assert.deepEqual(parsed.entries[0], {
    path: 'src/new.ts',
    origPath: 'src/old.ts',
    index: 'R',
    kind: 'renamed',
    stage: 'staged',
  })
  // The rename's second field must not swallow the record after it.
  assert.equal(parsed.entries[1]?.path, 'src/after.ts')
})

test('keeps a path that contains a space whole', () => {
  const parsed = parsePorcelainV2(fields('1 .M N... 100644 100644 100644 aaa bbb src/a b c.ts'))
  assert.equal(parsed.entries[0]?.path, 'src/a b c.ts')
})

test('reports untracked and conflicted paths', () => {
  const parsed = parsePorcelainV2(fields(
    '? src/untracked.txt',
    'u UU N... 100644 100644 100644 100644 a b c src/conflict.ts',
  ))
  assert.deepEqual(parsed.entries[0], {
    path: 'src/untracked.txt',
    index: '?',
    kind: 'untracked',
    stage: 'untracked',
  })
  assert.equal(parsed.entries[1]?.kind, 'conflicted')
  assert.equal(parsed.entries[1]?.stage, 'conflicted')
})

test('ignores records it does not understand instead of mis-reading them', () => {
  const parsed = parsePorcelainV2(fields('1 .M N...', '! ignored.txt', ''))
  assert.deepEqual(parsed.entries, [])
})

test('reads an empty status as no changes', () => {
  assert.deepEqual(parsePorcelainV2(''), { branch: {
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  }, entries: [] })
})
