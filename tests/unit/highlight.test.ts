/**
 * Syntax highlighting, exercised through the real highlighter.
 *
 * These run in Node, which is the point: the plugin's copy of the client setup
 * has to build a shiki core instance, load the pinned grammars, and answer with
 * runs whose colors are the theme's custom properties — the same path the
 * browser takes, without a DOM in the way.
 *
 * @module dsh-git/tests/unit/highlight
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { highlightLines, langFromPath } from '../../src/client/highlight.ts'

test('derives a grammar from a path the way the file view does', () => {
  assert.equal(langFromPath('src/client/highlight.ts'), 'ts')
  assert.equal(langFromPath('db/db_impl/db_impl.cc'), 'cpp')
  assert.equal(langFromPath('a/b/C.PY'), 'py')
  assert.equal(langFromPath('notes.md'), 'md')
  // A dotfile has no extension, and an unknown one names no grammar.
  assert.equal(langFromPath('.gitignore'), undefined)
  assert.equal(langFromPath('Makefile'), undefined)
  assert.equal(langFromPath('src/a.unknown'), undefined)
  // An extension that is an Object.prototype key must miss, not resolve.
  assert.equal(langFromPath('a.constructor'), undefined)
})

test('tokenizes a line into runs colored by the shared sheet', () => {
  const lines = highlightLines('const answer: number = 42', 'ts')
  assert.notEqual(lines, undefined)
  assert.equal(lines?.length, 1)
  const keyword = lines?.[0]?.find(span => span.text === 'const')
  assert.equal(keyword?.style.color, 'var(--shiki-token-keyword)')
  const constant = lines?.[0]?.find(span => span.text === '42')
  assert.equal(constant?.style.color, 'var(--shiki-token-constant)')
})

test('reads a construct that spans lines in context', () => {
  const lines = highlightLines('/* one\n   two */\nconst a = 1', 'ts')
  assert.equal(lines?.length, 3)
  // Both lines of the block comment carry the comment color: the text was
  // tokenized as a whole before it was split back into lines.
  assert.equal(lines?.[0]?.[0]?.style.color, 'var(--shiki-token-comment)')
  assert.equal(lines?.[1]?.[0]?.style.color, 'var(--shiki-token-comment)')
})

test('drops the empty line a trailing newline adds', () => {
  assert.equal(highlightLines('a\nb\n', 'ts')?.length, 2)
  assert.equal(highlightLines('a\nb', 'ts')?.length, 2)
  assert.equal(highlightLines('', 'ts')?.length, 1)
})

test('draws plain text rather than failing for a hint no grammar answers', () => {
  assert.equal(highlightLines('x = 1', 'notalanguage'), undefined)
  assert.equal(highlightLines('x = 1', undefined), undefined)
})
