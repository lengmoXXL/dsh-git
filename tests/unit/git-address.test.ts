/**
 * The resource-address contract.
 *
 * Addresses carry the whole choice of what a tab shows, because a tab's
 * identity is `(kind, contentId)` — so a round trip has to be exact and a
 * foreign address has to be refused rather than half-parsed.
 *
 * @module dsh-git/tests/unit/git-address
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  commitAddress,
  diffAddress,
  gitAddressTitle,
  parseGitAddress,
} from '../../src/client/git-address.ts'

test('round-trips one change', () => {
  const address = diffAddress({ sessionId: 's-1', source: 'worktree', path: 'src/a b.ts' })
  assert.deepEqual(parseGitAddress(address), {
    kind: 'diff',
    sessionId: 's-1',
    source: 'worktree',
    path: 'src/a b.ts',
  })
})

test('round-trips a staged rename with its old path', () => {
  const address = diffAddress({
    sessionId: 's-1',
    source: 'index',
    path: 'src/new.ts',
    origPath: 'src/old.ts',
  })
  const parsed = parseGitAddress(address)
  assert.equal(parsed?.kind, 'diff')
  assert.equal(parsed.kind === 'diff' ? parsed.origPath : undefined, 'src/old.ts')
})

test('round-trips a commit file with the revision to compare against', () => {
  const address = diffAddress({
    sessionId: 's-1',
    source: 'commit',
    path: 'src/a.ts',
    rev: 'deadbeef',
  })
  const parsed = parseGitAddress(address)
  assert.equal(parsed?.kind, 'diff')
  assert.equal(parsed.kind === 'diff' ? parsed.rev : undefined, 'deadbeef')
})

test('round-trips one commit', () => {
  const address = commitAddress('s-1', 'deadbeef')
  assert.deepEqual(parseGitAddress(address), { kind: 'commit', sessionId: 's-1', rev: 'deadbeef' })
})

test('two different changes are two different addresses', () => {
  const first = diffAddress({ sessionId: 's-1', source: 'worktree', path: 'a.ts' })
  const second = diffAddress({ sessionId: 's-1', source: 'worktree', path: 'b.ts' })
  const staged = diffAddress({ sessionId: 's-1', source: 'index', path: 'a.ts' })
  assert.notEqual(first, second)
  // A path changed on both halves is two entries, so its two diffs are two tabs.
  assert.notEqual(first, staged)
})

test('refuses an address that is not ours', () => {
  for (const address of [
    'dsh-resource://file/session/s1/home/me/a.md',
    'https://example.com/diff?session=s1&path=a.ts',
    'not an address at all',
    'dsh-resource://git/diff',
    'dsh-resource://git/diff?session=s1',
    'dsh-resource://git/diff?session=s1&path=a.ts',
    'dsh-resource://git/diff?session=s1&path=a.ts&source=sideways',
    'dsh-resource://git/commit?session=s1',
    'dsh-resource://git/commit?rev=abc',
    'dsh-resource://git/unknown?session=s1',
  ]) {
    assert.equal(parseGitAddress(address), undefined, `expected ${address} to be refused`)
  }
})

test('names a tab by its file, and a commit tab by its abbreviated id', () => {
  assert.equal(gitAddressTitle(diffAddress({ sessionId: 's', source: 'worktree', path: 'src/deep/a.ts' })), 'a.ts')
  assert.equal(gitAddressTitle(commitAddress('s', 'deadbeefcafe')), 'deadbee')
  assert.equal(gitAddressTitle('nonsense'), 'git')
})
