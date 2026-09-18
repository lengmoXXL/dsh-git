/**
 * The editor's contributions are reached by their own path, so the package entry — which
 * pulls every language through a lazy import a bundle has no channel for — stays out. That
 * path ships no declaration, while the API path beside it does: the API is typed by the
 * package, and this is all that is left to state.
 */
declare module 'monaco-editor-core/esm/vs/editor/editor.all.js'
