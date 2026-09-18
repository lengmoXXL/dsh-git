/**
 * The editor's API is reached by its own path, so that the package entry — which pulls
 * every language through a lazy import a bundle has no channel for — stays out. That
 * path exports the API the package's own types describe.
 */
declare module 'monaco-editor-core/esm/vs/editor/editor.api.js' {
  export * from 'monaco-editor-core'
}

/** The editor's own contributions, imported for their side effects. */
declare module 'monaco-editor-core/esm/vs/editor/editor.all.js'
