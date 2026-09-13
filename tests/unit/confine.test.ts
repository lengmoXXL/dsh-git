/**
 * Path confinement: what a request may name, and what it may not.
 *
 * @module dsh-git/tests/unit/confine
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { confineToRepo } from '../../src/git/repo.ts'

test('accepts an ordinary repository-relative path', () => {
  assert.equal(confineToRepo('src/a.ts'), 'src/a.ts')
  assert.equal(confineToRepo('a/b/c/d.txt'), 'a/b/c/d.txt')
})

test('folds redundant separators and current-directory segments', () => {
  assert.equal(confineToRepo('./src//a.ts'), 'src/a.ts')
  assert.equal(confineToRepo('src/./a.ts'), 'src/a.ts')
})

test('treats a backslash as a separator, so a Windows client is not a way out', () => {
  assert.equal(confineToRepo('src\\a.ts'), 'src/a.ts')
})

test('refuses an absolute path', () => {
  assert.throws(() => confineToRepo('/etc/passwd'), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo('C:/Windows'), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo('c:\\Windows'), { code: 'git/path-outside-repo' })
})

test('refuses any parent segment', () => {
  assert.throws(() => confineToRepo('../a.ts'), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo('src/../../a.ts'), { code: 'git/path-outside-repo' })
  // Even when it would land back inside: a viewer never needs one.
  assert.throws(() => confineToRepo('src/../a.ts'), { code: 'git/path-outside-repo' })
})

test('refuses an absent or empty path', () => {
  assert.throws(() => confineToRepo(null), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo(''), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo('.'), { code: 'git/path-outside-repo' })
  assert.throws(() => confineToRepo('/'), { code: 'git/path-outside-repo' })
})

test('refuses a path carrying a NUL, which no filesystem name may contain', () => {
  assert.throws(() => confineToRepo('src/a\0b.ts'), { code: 'git/path-outside-repo' })
})
