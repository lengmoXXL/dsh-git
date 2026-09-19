/**
 * The log tab's memory between mounts.
 *
 * The interesting property is not that it stores things but that it stores them
 * under a key that outlives a mount: a cache keyed by anything a render mints
 * afresh would look right and remember nothing.
 *
 * @module dsh-git/tests/unit/log-cache
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { logCache } from '../../src/client/data/log-cache.ts'

test('hands one Session the same cache every time', () => {
  const first = logCache('session-a')
  first.openCommit = 'abc'
  first.scrollTop = 240
  assert.equal(logCache('session-a'), first)
  assert.equal(logCache('session-a').openCommit, 'abc')
  assert.equal(logCache('session-a').scrollTop, 240)
})

test('keeps Sessions apart, and starts each one empty', () => {
  const other = logCache('session-b')
  assert.notEqual(other, logCache('session-c'))
  assert.equal(other.status, undefined)
  assert.equal(other.history, undefined)
  assert.equal(other.openCommit, undefined)
  assert.equal(other.scrollTop, 0)
  assert.equal(other.commitFiles.size, 0)
})
