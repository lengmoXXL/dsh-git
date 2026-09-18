/**
 * The shape of one grammar module.
 *
 * The editor package declares its API and none of the grammars beside it, and every
 * grammar it publishes is this same pair of objects — so `tsconfig.client.json` maps the
 * directory onto this file instead of the pair being stated once per language.
 */

import type * as monaco from 'monaco-editor/editor/editor.api.js'

/** The language's configuration: comments, brackets, the pairs that surround a word. */
export const conf: monaco.languages.LanguageConfiguration

/** The language's Monarch rules, the tokenizer the editor reads a file with. */
export const language: monaco.languages.IMonarchLanguage
