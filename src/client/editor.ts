/**
 * The editor this page builds: one package's API, and the features its own package
 * aggregates for a page that has no language services.
 *
 * The package's entry is not imported — it also pulls an LSP client that is not published
 * with it and registers every language through imports a dynamic bundle has no channel for.
 * What is imported instead is what that entry imports for the editor itself: the API, the
 * feature aggregate, and the two features the aggregate leaves to the entry that a reader
 * moving through a diff uses. `features/register.all.js` is the package's own list of the
 * editor's features, complete down to the codicon styles the widgets are drawn with, so
 * nothing here is a hand-picked subset of it.
 *
 * One module holds the imports so the whole page shares one editor: two copies would mean
 * two registries, and a grammar registered on one would be unknown to the models of the
 * other.
 *
 * @module dsh-git/client/editor
 */

import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/features/register.all.js'
// The cursor commands and the word-wise caret moves: the aggregate leaves both to the
// package's entry, and a diff is read with the keyboard.
import 'monaco-editor/editor/browser/coreCommands.js'
import 'monaco-editor/editor/contrib/caretOperations/browser/caretOperations.js'

export { monaco }
