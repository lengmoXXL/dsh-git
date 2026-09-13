/**
 * Syntax highlighting for the diff, set up the way the rest of the client sets
 * it up: shiki's fine-grained core with the JavaScript regex engine and the
 * same grammar allowlist as the file view, so a line an editor tokenizes one
 * way is tokenized the same way here.
 *
 * Colors never live in this module. The highlighter resolves every token
 * through shiki's css-variables theme, so a run carries
 * `color: var(--shiki-token-keyword)` and the theme package's sheets decide what
 * that is — the highlighted diff and the file view cannot drift apart without
 * the token sheets changing under both.
 *
 * The harness keeps its own copy of this in `ui-primitives`, reachable only
 * from inside that package: the client module table seeds package names, not
 * subpaths, so a plugin cannot borrow it. This is that setup, cut down to what
 * a diff needs — no streaming session, no lazy grammars (a plugin bundle has no
 * chunk channel, so every grammar it can offer is inlined), and no viewport
 * gating.
 *
 * @module dsh-git/client/highlight
 */

import { createHighlighterCoreSync, createCssVariablesTheme, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine, defaultJavaScriptRegexConstructor } from 'shiki/engine/javascript'
import type { CSSProperties } from 'react'
import langTs from '@shikijs/langs/typescript'
import langBash from '@shikijs/langs/shellscript'
import langJson from '@shikijs/langs/json'
import langPython from '@shikijs/langs/python'
import langRuby from '@shikijs/langs/ruby'
import langGo from '@shikijs/langs/go'
import langRust from '@shikijs/langs/rust'
import langJava from '@shikijs/langs/java'
import langC from '@shikijs/langs/c'
import langCpp from '@shikijs/langs/cpp'
import langCsharp from '@shikijs/langs/csharp'
import langKotlin from '@shikijs/langs/kotlin'
import langSwift from '@shikijs/langs/swift'
import langPhp from '@shikijs/langs/php'
import langYaml from '@shikijs/langs/yaml'
import langToml from '@shikijs/langs/toml'
import langIni from '@shikijs/langs/ini'
import langMarkdown from '@shikijs/langs/markdown'
import langMdx from '@shikijs/langs/mdx'
import langHtml from '@shikijs/langs/html'
import langCss from '@shikijs/langs/css'
import langScss from '@shikijs/langs/scss'
import langLess from '@shikijs/langs/less'
import langSql from '@shikijs/langs/sql'
import langXml from '@shikijs/langs/xml'
import langLua from '@shikijs/langs/lua'

/**
 * Grammars this highlighter holds. The list is the file view's: the three it
 * loads at boot, then every grammar its read card can reach for. The JS family
 * resolves to the TypeScript grammar, which tokenizes plain TS/JS exactly and
 * JSX/TSX approximately — the same trade the file view makes.
 */
const LANGS = [
  langTs, langBash, langJson,
  langPython, langRuby, langGo, langRust, langJava, langC, langCpp,
  langCsharp, langKotlin, langSwift, langPhp,
  langYaml, langToml, langIni,
  langMarkdown, langMdx, langHtml, langCss, langScss, langLess, langSql, langXml, langLua,
]

/**
 * Language ids (and aliases) the highlighter accepts; anything else renders
 * plain. A Map, not an object: a path suffix is a filename's business, so a
 * label like `constructor` must miss rather than resolve an inherited member.
 * The keys are the markdown aliases and the file-extension hints the read tool
 * emits, so a diff and a read of the same file ask for the same grammar.
 */
const LANG_ALIASES = new Map<string, string>([
  ['typescript', 'typescript'],
  ['ts', 'typescript'],
  ['tsx', 'typescript'],
  ['javascript', 'typescript'],
  ['js', 'typescript'],
  ['jsx', 'typescript'],
  ['shellscript', 'shellscript'],
  ['bash', 'shellscript'],
  ['sh', 'shellscript'],
  ['shell', 'shellscript'],
  ['zsh', 'shellscript'],
  ['json', 'json'],
  ['jsonc', 'json'],
  ['py', 'python'],
  ['python', 'python'],
  ['rb', 'ruby'],
  ['ruby', 'ruby'],
  ['go', 'go'],
  ['rs', 'rust'],
  ['rust', 'rust'],
  ['java', 'java'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['csharp', 'csharp'],
  ['kotlin', 'kotlin'],
  ['swift', 'swift'],
  ['php', 'php'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
  ['toml', 'toml'],
  ['ini', 'ini'],
  ['md', 'markdown'],
  ['markdown', 'markdown'],
  ['mdx', 'mdx'],
  ['html', 'html'],
  ['css', 'css'],
  ['scss', 'scss'],
  ['less', 'less'],
  ['sql', 'sql'],
  ['xml', 'xml'],
  ['lua', 'lua'],
])

/**
 * The extension hints the read tool derives, mirrored so a diff highlights the
 * file the file view would highlight, with the same grammar.
 */
const LANG_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: 'ts', tsx: 'tsx', mts: 'ts', cts: 'ts',
  js: 'js', jsx: 'jsx', mjs: 'js', cjs: 'js',
  json: 'json', jsonc: 'json',
  py: 'py', rb: 'rb', go: 'go', rs: 'rs', java: 'java',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', hpp: 'cpp', cxx: 'cpp',
  cs: 'cs', kt: 'kotlin', swift: 'swift', php: 'php',
  sh: 'sh', bash: 'sh', zsh: 'sh',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', ini: 'ini',
  md: 'md', markdown: 'md', mdx: 'mdx',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
  sql: 'sql', xml: 'xml', lua: 'lua',
}

/** All token colors resolve through `--shiki-*` custom properties (theme package sheets). */
const cssVariablesTheme = createCssVariablesTheme({
  name: 'css-variables',
  variablePrefix: '--shiki-',
  fontStyle: true,
})

/**
 * The client regex engine compiles each TextMate pattern when its scanner is
 * created. Shiki otherwise defers patterns longer than 3,000 characters until
 * their first match, and that compilation counts against Shiki's per-line time
 * budget — on a large diff it is the difference between tokenizing a line and
 * giving up on it, so the patterns are compiled eagerly.
 */
const regexEngine = createJavaScriptRegexEngine({
  forgiving: true,
  regexConstructor: pattern => defaultJavaScriptRegexConstructor(pattern, {
    lazyCompileLength: Number.POSITIVE_INFINITY,
  }),
})

/** The one highlighter per document, built on first use so an unhighlighted page pays nothing. */
let singleton: HighlighterCore | undefined

/** Build the highlighter, or return the one already built. */
function highlighter(): HighlighterCore {
  singleton ??= createHighlighterCoreSync({
    themes: [cssVariablesTheme],
    langs: LANGS,
    engine: regexEngine,
  })
  return singleton
}

/**
 * Derive a language hint from a repository path's extension.
 *
 * Only the base name is read: a directory called `src.ts` says nothing about
 * the file inside it. A dotfile with no extension and an unknown extension both
 * yield `undefined` — the caller then draws plain monospace.
 * @param path - a repository-relative path with `/` separators.
 * @returns the grammar hint, or `undefined` for an unknown extension.
 */
export function langFromPath(path: string): string | undefined {
  const base = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = base.lastIndexOf('.')
  // A leading dot is a dotfile (no extension), not an empty extension.
  if (dot <= 0) return undefined
  const ext = base.slice(dot + 1).toLowerCase()
  // Own-property check only: `foo.constructor` must map to no language rather
  // than to an inherited member.
  return Object.hasOwn(LANG_BY_EXTENSION, ext) ? LANG_BY_EXTENSION[ext] : undefined
}

/**
 * One highlighted run of a line: the text and the style shiki assigned it. The
 * css-variables theme colors every run through a `--shiki-*` custom property,
 * so `color` is always present.
 */
export interface HighlightSpan {
  /** The run's source text, verbatim. */
  readonly text: string
  /** The run's inline style: its token color, and any font style the grammar gave it. */
  readonly style: CSSProperties
}

/**
 * Tokenize source into per-line highlighted runs.
 *
 * The whole text is tokenized at once so a construct that spans lines — a block
 * comment, a template literal — is read in context, then the runs are handed
 * back split by line, one entry per source line, which is what a row-per-line
 * view needs. The empty line shiki appends for a trailing newline is dropped,
 * so the result lines up with the caller's own lines.
 *
 * @param code - the source text.
 * @param lang - the grammar hint.
 * @returns one entry per line (each a list of runs), or `undefined` when the hint names no grammar.
 */
export function highlightLines(code: string, lang: string | undefined): HighlightSpan[][] | undefined {
  const resolved = lang === undefined ? undefined : LANG_ALIASES.get(lang.toLowerCase())
  if (resolved === undefined) return undefined
  const { tokens } = highlighter().codeToTokens(code, { lang: resolved, theme: 'css-variables' })
  // shiki tokenizes `a\nb` into two lines; a trailing newline (`a\n`) adds a
  // third, empty line the caller's own lines do not carry.
  const last = tokens[tokens.length - 1]
  const lines = tokens.length > 1 && last !== undefined && last.length === 0
    ? tokens.slice(0, -1)
    : tokens
  return lines.map(line => line.map(token => ({ text: token.content, style: { color: token.color } })))
}
