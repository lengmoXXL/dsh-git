/**
 * Build configuration for both halves of the package.
 *
 * The host half is one Node program the Harness Loader mounts by package name,
 * so every Harness package stays external — the profile already has exactly one
 * copy of each, and a second would break service identity. The client half is
 * the bundle below. They are one tsdown invocation because they write the same
 * output directory, and only the host half cleans it.
 *
 * The web shell loads a plugin's client bundle through a module loader it
 * installs on `window`, so the artifact must be one CommonJS factory call
 * rather than an ES module: `react` and every `@deepseek-ai/*` package are
 * resolved through the `require` the loader hands the factory, and everything
 * else is inlined.
 *
 * A dynamic bundle has no stylesheet channel, so every stylesheet is compiled
 * here instead of being emitted as a file: Lightning CSS hashes every local
 * name, and the plugin emits a module that attaches one tagged `<style>` to the
 * document the first time the factory runs and hands the component the class
 * map. That keeps the component on the same CSS Modules contract the in-repo
 * client packages use — local names, semantic `--dsw-*` tokens, no global
 * leakage.
 *
 * `npm run watch` is usually enough while working on the client half: a running
 * server polls the artifact and re-evaluates the bundle in the page it is
 * serving, styles included, so no reload is needed. The host half is a module
 * the Loader mounted at boot, so a change there is only picked up by restarting
 * the server.
 *
 * The build stamps itself (`__DSH_GIT_BUILD__`), because a page's layout comes
 * from whichever bundle it loaded while the content it draws is read fresh:
 * without a stamp, an out-of-date page looks like a layout bug.
 */

import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve as resolvePath } from 'node:path'
import { defineConfig } from 'tsdown'
import { transform } from 'lightningcss'

/** The plugin id the loader keys this bundle by; it must match `dsh.client`. */
const ID = 'dsh-git'

/**
 * Virtual-id wrapper keeping module CSS away from tsdown's own css pipeline.
 * The suffix matters: tsdown's guard matches ids ending in `.css`, so the
 * virtual id must not.
 */
const CSS_VIRTUAL_PREFIX = '\0dsh-git-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

/**
 * Emit one plugin-owned style injector plus the compiled class map.
 *
 * The tag is keyed by the stylesheet's path within this checkout rather than by its file
 * name: the editor alone carries half a dozen files called `style.css`, and one tag per
 * name would have each of them overwrite the last — which is how the diff view lost the
 * rules that paint an added or a removed line. The path is relative so that the key is the
 * same on every machine, which the replacement below depends on.
 */
function styleInjectionModule(
  fileId: string,
  css: string,
  classMap: Readonly<Record<string, string>>,
): string {
  const tagId = `${ID}/${relative(import.meta.dirname, fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\') {',
    '  const selector = \'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\';',
    '  const existing = document.querySelector(selector);',
    '  if (existing === null) {',
    '    const tag = document.createElement(\'style\');',
    `    tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '    tag.dataset.pluginCss = tagId;',
    '    tag.textContent = css;',
    '    document.head.appendChild(tag);',
    '  } else {',
    // A hot-swapped bundle runs in a document that still holds the tag an
    // earlier build injected. Keyed by module name alone, that tag would leave
    // the page styled by the build it was loaded with while running the newest
    // code — so the stylesheet is replaced in place.
    '    existing.textContent = css;',
    '  }',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** The moment this build started, substituted into the client bundle. */
const BUILD_STAMP = new Date().toISOString()

/**
 * Substitute the build stamp into the client sources.
 *
 * A page can be running an older bundle while the diff's content — which the
 * host reads fresh — is current, and then new content is drawn by old layout.
 * The stamp is what lets a reader (and a bug report) say which build a page is
 * on, so it is baked in rather than guessed at.
 */
function buildStamp() {
  return {
    name: 'dsh-git-build-stamp',
    transform(code: string, id: string): { code: string } | null {
      if (!id.includes('/src/client/') || !code.includes('__DSH_GIT_BUILD__')) return null
      return { code: code.replaceAll('__DSH_GIT_BUILD__', JSON.stringify(BUILD_STAMP)) }
    },
  }
}

/** Compile every stylesheet import into an injecting module. */
function cssModulesInline() {
  return {
    name: 'dsh-git-css-modules-inline',
    resolveId(source: string, importer: string | undefined): string | null {
      if (!source.endsWith('.module.css') && !source.endsWith('.css')) return null
      const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string): Promise<string | null> {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      // A virtual id otherwise hides the physical stylesheet from the watcher.
      this.addWatchFile(fileId)
      // A CSS Module's locals are hashed and its map is handed to the component that
      // imported it; a plain stylesheet — a vendored library's, like a code editor's —
      // has no locals and needs nothing beyond being inlined, since a dynamic bundle
      // has no stylesheet channel and a file beside it would never be loaded.
      const isModule = fileId.endsWith('.module.css')
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: await readFile(fileId),
        ...isModule ? { cssModules: { pattern: '[hash]_[local]' } } : {},
        minify: true,
      })
      const classMap: Record<string, string> = {}
      if (isModule) {
        for (const [local, exported] of Object.entries(cssExports ?? {})) {
          classMap[local] = exported.name
        }
      }
      return styleInjectionModule(fileId, code.toString(), classMap)
    },
  }
}

const host = defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // `package.json` names `lib/index.d.ts`, so the declaration must exist.
  dts: true,
  sourcemap: true,
  // The host half owns `clean` for the shared output directory; the client
  // half below must not wipe what this one wrote.
  clean: true,
  // `package.json` names `lib/index.js`, which is the convention a profile
  // install expects; the package is `type: module`, so `.js` is already ESM.
  outExtensions: () => ({ js: '.js' }),
  external: [/^@deepseek-ai\//],
  outputOptions: {
    banner: '// dsh-git host half',
  },
})

const client = defineConfig({
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  dts: false,
  sourcemap: true,
  clean: false,
  // The web shell fetches this artifact by the `exports["./client"]` path, so
  // it keeps the `.js` spelling the profile manifest names.
  outExtensions: () => ({ js: '.js' }),
  // React and the client stack are the shell's, not ours: a second copy would
  // break hooks and duplicate the renderer.
  external: [/^react($|\/)/, /^@deepseek-ai\//],
  // A dependency is not bundled by default, and the editor and its grammars must be: the
  // shell's module table has no entry for either, so a `require` left in the artifact is a
  // page that cannot load. The editor's own modules import each other by subpath, so the
  // whole prefix has to match: one entry for the exact id leaves `monaco-editor/editor/...`
  // outside the bundle.
  deps: { alwaysBundle: [/^monaco-editor/] },
  plugins: [cssModulesInline(), buildStamp()],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
})

export default [host, client]
