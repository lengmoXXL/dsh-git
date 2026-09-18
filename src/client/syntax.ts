/**
 * What a diff is coloured by: the grammars the editor tokenizes a file with, and the
 * theme their tokens are painted in.
 *
 * The editor is bundled without its language entry point, which registers every grammar
 * in its package through an import that a dynamic bundle has no channel for — so the
 * grammars this page can draw are the ones imported here, one at a time, and all of them
 * Monarch rules that run in the page. Nothing is fetched and nothing is deferred: a diff
 * is tokenized on the frame that draws it, and the bundle stays one file.
 *
 * The colours are the shell's. Its theme package names one custom property per token
 * kind — the ones its file view highlights with — so a diff of a file and a read of the
 * same file are coloured from one palette. A page that names none, like the browser
 * test's, keeps the editor's own theme.
 *
 * @module dsh-git/client/syntax
 */

import * as monaco from 'monaco-editor-core/esm/vs/editor/editor.api.js'
import * as typescript from 'monaco-editor/languages/definitions/typescript/typescript.js'
import * as javascript from 'monaco-editor/languages/definitions/javascript/javascript.js'
import * as shell from 'monaco-editor/languages/definitions/shell/shell.js'
import * as python from 'monaco-editor/languages/definitions/python/python.js'
import * as ruby from 'monaco-editor/languages/definitions/ruby/ruby.js'
import * as go from 'monaco-editor/languages/definitions/go/go.js'
import * as rust from 'monaco-editor/languages/definitions/rust/rust.js'
import * as java from 'monaco-editor/languages/definitions/java/java.js'
import * as cpp from 'monaco-editor/languages/definitions/cpp/cpp.js'
import * as csharp from 'monaco-editor/languages/definitions/csharp/csharp.js'
import * as kotlin from 'monaco-editor/languages/definitions/kotlin/kotlin.js'
import * as swift from 'monaco-editor/languages/definitions/swift/swift.js'
import * as php from 'monaco-editor/languages/definitions/php/php.js'
import * as yaml from 'monaco-editor/languages/definitions/yaml/yaml.js'
import * as ini from 'monaco-editor/languages/definitions/ini/ini.js'
import * as markdown from 'monaco-editor/languages/definitions/markdown/markdown.js'
import * as mdx from 'monaco-editor/languages/definitions/mdx/mdx.js'
import * as html from 'monaco-editor/languages/definitions/html/html.js'
import * as css from 'monaco-editor/languages/definitions/css/css.js'
import * as scss from 'monaco-editor/languages/definitions/scss/scss.js'
import * as less from 'monaco-editor/languages/definitions/less/less.js'
import * as sql from 'monaco-editor/languages/definitions/sql/sql.js'
import * as xml from 'monaco-editor/languages/definitions/xml/xml.js'
import * as lua from 'monaco-editor/languages/definitions/lua/lua.js'

/**
 * JSON's grammar, which this module states because the editor's own JSON support is a
 * language worker — a second script the page cannot reach — and a diff of a repository's
 * one universal file would otherwise be the plain one. Comments are in: JSON with them
 * is what a settings file is.
 */
const json: Grammar['rules'] = {
  conf: {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [['{', '}'], ['[', ']']],
  },
  language: {
    defaultToken: '',
    tokenPostfix: '.json',
    brackets: [
      { open: '{', close: '}', token: 'delimiter.curly' },
      { open: '[', close: ']', token: 'delimiter.square' },
    ],
    tokenizer: {
      root: [
        [/[ \t\r\n]+/, ''],
        [/\/\*/, 'comment', '@comment'],
        [/\/\/.*$/, 'comment'],
        [/"(?:[^"\\]|\\.)*"\s*(?=:)/, 'string.key.json'],
        [/"(?:[^"\\]|\\.)*"/, 'string.value.json'],
        [/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/, 'number'],
        [/true|false|null/, 'keyword.json'],
        [/[{}[\],:]/, 'delimiter'],
      ],
      comment: [
        [/[^*/]+/, 'comment'],
        [/\*\//, 'comment', '@pop'],
        [/[*/]/, 'comment'],
      ],
    },
  },
}

/** One language: the id a model names it by, the suffixes that ask for it, its rules. */
interface Grammar {
  readonly id: string
  readonly extensions: readonly string[]
  readonly rules: {
    readonly conf: monaco.languages.LanguageConfiguration
    readonly language: monaco.languages.IMonarchLanguage
  }
}

/**
 * The languages a repository file is read as. The suffixes are the file view's list, so
 * a diff and a read of the same path are tokenized by the same kind of grammar; a suffix
 * that is not here gets no grammar, and its diff is drawn plain.
 */
const GRAMMARS: readonly Grammar[] = [
  { id: 'typescript', extensions: ['ts', 'tsx', 'mts', 'cts'], rules: typescript },
  { id: 'javascript', extensions: ['js', 'jsx', 'mjs', 'cjs'], rules: javascript },
  { id: 'shell', extensions: ['sh', 'bash', 'zsh'], rules: shell },
  { id: 'json', extensions: ['json', 'jsonc'], rules: json },
  { id: 'python', extensions: ['py'], rules: python },
  { id: 'ruby', extensions: ['rb'], rules: ruby },
  { id: 'go', extensions: ['go'], rules: go },
  { id: 'rust', extensions: ['rs'], rules: rust },
  { id: 'java', extensions: ['java'], rules: java },
  // C is read by the C++ grammar: one definition covers the family.
  { id: 'cpp', extensions: ['c', 'h', 'cc', 'cpp', 'hpp', 'cxx'], rules: cpp },
  { id: 'csharp', extensions: ['cs'], rules: csharp },
  { id: 'kotlin', extensions: ['kt', 'kts'], rules: kotlin },
  { id: 'swift', extensions: ['swift'], rules: swift },
  { id: 'php', extensions: ['php'], rules: php },
  { id: 'yaml', extensions: ['yaml', 'yml'], rules: yaml },
  // TOML goes to the INI grammar: `key = value`, `[section]` and `#` are what the two
  // have in common, and the editor ships no TOML of its own.
  { id: 'ini', extensions: ['ini', 'toml'], rules: ini },
  { id: 'markdown', extensions: ['md', 'markdown'], rules: markdown },
  { id: 'mdx', extensions: ['mdx'], rules: mdx },
  { id: 'html', extensions: ['html', 'htm'], rules: html },
  { id: 'css', extensions: ['css'], rules: css },
  { id: 'scss', extensions: ['scss'], rules: scss },
  { id: 'less', extensions: ['less'], rules: less },
  { id: 'sql', extensions: ['sql'], rules: sql },
  { id: 'xml', extensions: ['xml', 'svg', 'plist'], rules: xml },
  { id: 'lua', extensions: ['lua'], rules: lua },
]

/** The one suffix map, built from the same list the registrations come from. */
const BY_EXTENSION = new Map<string, string>(
  GRAMMARS.flatMap(grammar => grammar.extensions.map(extension => [extension, grammar.id])),
)

/**
 * Which language a repository path is drawn as.
 *
 * Only the base name is read: a directory called `src.ts` says nothing about the file in
 * it. A dotfile with no extension and an unknown extension both answer `undefined`, and
 * the caller draws plain text.
 * @param path - a repository-relative path with `/` separators.
 * @returns the language id, or `undefined` when no grammar claims the suffix.
 */
export function languageOf(path: string): string | undefined {
  const base = path.slice(path.lastIndexOf('/') + 1)
  const dot = base.lastIndexOf('.')
  // A leading dot is a dotfile, not an empty extension.
  if (dot <= 0) return undefined
  return BY_EXTENSION.get(base.slice(dot + 1).toLowerCase())
}

/** The name the defined theme is set under; the editor keys themes by name. */
const THEME = 'dsh-git'

/**
 * Which of the shell's token colours each kind of token takes.
 *
 * The names on the left are the editor's own token classes — the vocabulary its built-in
 * themes are written in — and those on the right are the shell's custom properties. A
 * class the list does not name keeps the base theme's colour, and the nine the shell has
 * are stretched as far as they go: a type borrows the function colour and a tag the
 * keyword one.
 */
const TOKEN_COLOURS: readonly (readonly [string, string])[] = [
  ['comment', 'comment'],
  ['keyword', 'keyword'],
  ['tag', 'keyword'],
  ['metatag', 'keyword'],
  ['string.key.json', 'constant'],
  ['string.value.json', 'string'],
  ['string', 'string'],
  ['attribute.value', 'string'],
  ['number', 'constant'],
  ['constant', 'constant'],
  ['key', 'constant'],
  ['attribute.name', 'constant'],
  ['regexp', 'string-expression'],
  ['type', 'function'],
  ['annotation', 'function'],
  ['variable.parameter', 'parameter'],
  ['delimiter', 'punctuation'],
]

/** Read one of the shell's token colours, as a theme wants it: hex, without the `#`. */
function colour(style: CSSStyleDeclaration, name: string): string | undefined {
  const value = style.getPropertyValue(`--shiki-token-${name}`).trim()
  return value.startsWith('#') ? value.slice(1) : undefined
}

/**
 * Paint the tokens with the shell's palette, or leave the editor's own theme alone.
 *
 * The two are told apart by the palette itself: a page that names no token colours has
 * none to paint with, and the editor's dark or light theme is the honest answer there.
 */
function installTheme(): void {
  const body = document.body
  const style = getComputedStyle(body)
  const rules = TOKEN_COLOURS.flatMap(([token, name]) => {
    const foreground = colour(style, name)
    return foreground === undefined ? [] : [{ token, foreground }]
  })
  const dark = body.hasAttribute('data-ds-dark-theme')
  if (rules.length === 0) {
    monaco.editor.setTheme(dark ? 'vs-dark' : 'vs')
    return
  }
  // The editor's background is the surface the page behind it is painted with, so a
  // notice above the editor and the editor itself stay one block.
  const background = style.getPropertyValue('--dsw-alias-markdown-code-block').trim()
  monaco.editor.defineTheme(THEME, {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules,
    colors: background.startsWith('#') ? { 'editor.background': background } : {},
  })
  monaco.editor.setTheme(THEME)
}

/**
 * Give the editor every grammar this page can draw, then hand it the theme.
 *
 * Run as a diff is mounted rather than once at import, because the theme is read from the
 * page as it is then: a reader who switches the shell's theme and opens the next diff gets
 * the palette in force rather than the one that was there at boot. Registering a language
 * the editor already knows is how its tokenizer is set, so the second diff costs a lookup.
 */
export function installSyntax(): void {
  for (const grammar of GRAMMARS) {
    monaco.languages.register({ id: grammar.id })
    monaco.languages.setLanguageConfiguration(grammar.id, grammar.rules.conf)
    monaco.languages.setMonarchTokensProvider(grammar.id, grammar.rules.language)
  }
  installTheme()
}
