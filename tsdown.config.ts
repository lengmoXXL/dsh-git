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
 * A dynamic bundle has no stylesheet channel, so `*.module.css` is compiled
 * here instead of being emitted as a file: Lightning CSS hashes every local
 * name, and the plugin emits a module that attaches one tagged `<style>` to the
 * document the first time the factory runs and hands the component the class
 * map. That keeps the component on the same CSS Modules contract the in-repo
 * client packages use — local names, semantic `--dsw-*` tokens, no global
 * leakage.
 */

import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
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

/** Emit one plugin-owned style injector plus the compiled class map. */
function styleInjectionModule(
  fileId: string,
  css: string,
  classMap: Readonly<Record<string, string>>,
): string {
  const tagId = `${ID}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    'if (typeof document !== \'undefined\' && document.querySelector(\'style[data-plugin-css=\' + JSON.stringify(tagId) + \']\') === null) {',
    '  const tag = document.createElement(\'style\');',
    `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
    '  tag.dataset.pluginCss = tagId;',
    '  tag.textContent = css;',
    '  document.head.appendChild(tag);',
    '}',
    `export default ${JSON.stringify(classMap)};`,
  ].join('\n')
}

/** Compile every `*.module.css` import into an injecting module. */
function cssModulesInline() {
  return {
    name: 'dsh-git-css-modules-inline',
    resolveId(source: string, importer: string | undefined): string | null {
      if (!source.endsWith('.module.css')) return null
      const absolute = importer === undefined ? source : resolvePath(dirname(importer), source)
      return CSS_VIRTUAL_PREFIX + absolute + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string): Promise<string | null> {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      // A virtual id otherwise hides the physical stylesheet from the watcher.
      this.addWatchFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: fileId,
        code: await readFile(fileId),
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })
      const classMap: Record<string, string> = {}
      for (const [local, exported] of Object.entries(cssExports ?? {})) {
        classMap[local] = exported.name
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
  plugins: [cssModulesInline()],
  outputOptions: {
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
    footer: 'return module.exports; } });',
  },
})

export default [host, client]
