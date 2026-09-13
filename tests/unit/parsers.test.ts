/**
 * The history and commit-file parsers, against record separators rather than
 * line breaks so a subject containing punctuation survives.
 *
 * @module dsh-git/tests/unit/parsers
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNameStatus } from '../../src/git/commit.ts'
import { parseLog } from '../../src/git/history.ts'

/** One `git log` record, shaped the way {@link LOG_FORMAT} writes it. */
function record(fields: readonly string[], trailingNewline = true): string {
  return `${fields.join('\x1f')}\x1e${trailingNewline ? '\n' : ''}`
}

test('reads several log records', () => {
  const output = record([
    'aaa111', 'aaa', 'bbb222', 'Ada', 'ada@example.com', '1700000000', 'HEAD -> main, tag: v1', 'first',
  ]) + record([
    'bbb222', 'bbb', '', 'Grace', 'grace@example.com', '1690000000', '', 'second',
  ], false)

  const commits = parseLog(output)
  assert.equal(commits.length, 2)
  assert.deepEqual(commits[0], {
    sha: 'aaa111',
    shortSha: 'aaa',
    parents: ['bbb222'],
    authorName: 'Ada',
    authorEmail: 'ada@example.com',
    authoredAt: 1_700_000_000,
    refs: ['HEAD -> main', 'tag: v1'],
    subject: 'first',
  })
  assert.deepEqual(commits[1]?.parents, [])
  assert.deepEqual(commits[1]?.refs, [])
})

test('keeps a subject the line-oriented parsers would have mis-split', () => {
  const subject = 'fix: a - b | c\td -> e'
  const commits = parseLog(record([
    'a', 'a', '', 'X', 'x@e.com', '1', '', subject,
  ], false))
  assert.equal(commits[0]?.subject, subject)
})

test('ignores an incomplete trailing record', () => {
  assert.deepEqual(parseLog('aaa\x1faaa\x1ea'), [])
  assert.deepEqual(parseLog(''), [])
})

test('reads a name-status list with an ordinary change and a rename', () => {
  const files = parseNameStatus('M\0src/a.ts\0R100\0src/old.ts\0src/new.ts\0D\0src/gone.ts\0')
  assert.deepEqual(files, [
    { path: 'src/a.ts', kind: 'modified' },
    { path: 'src/new.ts', origPath: 'src/old.ts', kind: 'renamed' },
    { path: 'src/gone.ts', kind: 'deleted' },
  ])
})

test('reads a copy and an added file', () => {
  const files = parseNameStatus('C75\0src/a.ts\0src/b.ts\0A\0src/c.ts\0')
  assert.deepEqual(files, [
    { path: 'src/b.ts', origPath: 'src/a.ts', kind: 'copied' },
    { path: 'src/c.ts', kind: 'added' },
  ])
})

test('skips a stray whitespace token instead of treating it as a status', () => {
  const files = parseNameStatus('\nM\0src/a.ts\0')
  assert.deepEqual(files, [{ path: 'src/a.ts', kind: 'modified' }])
})

test('reads an empty name-status list as no files', () => {
  assert.deepEqual(parseNameStatus(''), [])
})
