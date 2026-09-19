/**
 * The client bundle is a build artifact the web shell loads through a module
 * loader, so its contracts are structural: the wrapper must call
 * `window.__ModuleLoader__.load` with this plugin's id, the loaded module must
 * expose exactly the plugin surface cordis needs, and the bundle must request
 * nothing the shell's frozen module table does not already hold.
 *
 * This exercises the real built file — not the source — because the wrapper is
 * what the shell sees, and nothing else in the suite would notice it changing.
 *
 * The shared component library is stubbed rather than imported: its published
 * artifact is browser-only, and what its components draw is not this file's
 * business.
 *
 * @module dsh-git/tests/e2e/client-bundle
 */

import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

/** Absolute path of the client bundle this suite reads. */
const bundlePath = join(dirname(fileURLToPath(import.meta.url)), '../..', 'lib', 'client.js')

/** The specifiers the shell's frozen module table seeds. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit', 'url'] as const

/**
 * Read the built bundle, naming the command that produces it.
 * @returns the artifact's text.
 * @throws when the artifact is absent, with the command that creates it.
 */
async function readArtifact(): Promise<string> {
  try {
    return await readFile(bundlePath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    throw new Error(`${bundlePath} is a build output and is absent; run \`npm run build\` first`)
  }
}

test('the bundle carries its stylesheets inlined under hashed local names', async () => {
  const source = await readArtifact()
  // A dynamic bundle has no stylesheet channel, so the build compiles each CSS
  // Module into the artifact and attaches one tagged <style> at factory time.
  assert.match(source, /data-plugin-css/)
  const css = source.replace(/\s+/g, '')
  for (const local of ['panel', 'control', 'grip', 'row', 'rowOpen', 'sectionHeader', 'rowLetter', 'nodeCurrent', 'ref']) {
    const mapped = new RegExp(`"${local}":\\s*"([^"]+)"`).exec(source)
    assert.notEqual(mapped, null, `the class map carries "${local}"`)
    const name = String(mapped?.[1])
    assert.match(name, new RegExp(`_${local}$`), `the local name survives only as a suffix for "${local}"`)
    // A rule selects the class: any combinator or pseudo-element may follow, but
    // the class name may not continue into a longer one.
    assert.ok(
      new RegExp(`\\.${name}(?![\\w-])`).test(css),
      `a stylesheet rule selects ${name}`,
    )
  }
  // The section header is what keeps the two halves of the tab apart while the
  // list scrolls, so the built stylesheet has to carry the rule that holds it.
  assert.ok(css.includes('position:sticky'), 'the section header sticks')
})

test('keeps the scrollbars thin without restyling the shell', async () => {
  const source = await readArtifact()
  const css = source.replace(/\s+/g, '')
  assert.match(css, /--dsh-scrollbar-width:4px/)
  // On the panel's own rule, not on the document's.
  assert.doesNotMatch(css, /:root\{[^}]*--dsh-scrollbar-width/)
})

test('gives every stylesheet its own tag', async () => {
  const source = await readArtifact()
  // A tag is keyed by the path the stylesheet came from, so that the tag a page already
  // holds is the one a newer build replaces in place. Keyed by file name it was not: the
  // editor alone ships several files called `style.css`, and each of them overwrote the
  // last — which is how the diff view lost the rules that paint an added or a removed line.
  const ids = [...source.matchAll(/tagId(?:\$\d+)? = "([^"]+)"/g)].map(match => String(match[1]))
  assert.ok(ids.length > 50, `the bundle injects stylesheets (${String(ids.length)})`)
  const shared = ids.filter((id, index) => ids.indexOf(id) !== index)
  assert.deepEqual([...new Set(shared)], [], 'no two stylesheets share a tag')
  assert.ok(
    ids.some(id => id.includes('diffEditor/style.css')),
    'the diff view stylesheet is one of them',
  )
})

test('carries the editor features and the font its icons are drawn with', async () => {
  const source = await readArtifact()
  // Both go missing silently when a bundler takes this package at its word that nothing here
  // has side effects: the editor's features are imported for their effects alone, and so is
  // the stylesheet that names the icon font. A diff without them loses its find widget, its
  // folding, and every icon the editor draws — a box in the icon's place.
  for (const marker of ['find-widget', 'fold-unchanged', 'anchorSelect']) {
    assert.ok(source.includes(marker), `the bundle carries ${marker}`)
  }
  assert.match(source, /@font-face\{font-family:codicon[^}]*data:font\/ttf;base64,/)
})

test('carries the build it came from', async () => {
  const source = await readArtifact()
  // Substituted at build time, so a page can be asked which build it is
  // running: the diff's content comes from the host and is always current,
  // while the layout comes from whatever bundle the page loaded.
  assert.doesNotMatch(source, /__DSH_GIT_BUILD__/, 'the token was substituted')
  const stamp = /(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z)/.exec(source)
  assert.notEqual(stamp, null, 'the bundle names the moment it was built')
})

test('the bundle requests only modules the shell already holds', async () => {
  const source = await readArtifact()
  const required = [...source.matchAll(/require\("([^"]+)"\)/g)].map(match => String(match[1]))
  assert.ok(required.length > 0, 'the bundle requested nothing at all')
  for (const name of required) {
    assert.ok(
      (PLATFORM_MODULES as readonly string[]).includes(name),
      `"${name}" is not in the shell's module table`,
    )
  }
})

test('defines every class the components reach for', async () => {
  const source = await readArtifact()
  const here = dirname(fileURLToPath(import.meta.url))
  const clientDir = join(here, '../..', 'src', 'client')
  const files = await readdir(clientDir)

  // A class the component names but the stylesheet does not define arrives as
  // `undefined`; `cx` then drops it and the element simply has no rule — a
  // missing indent or a missing highlight, with nothing failing anywhere. The
  // class map the build emits is the only place that can be asked.
  const sheets = new Map<string, string>()
  for (const name of files.filter(file => file.endsWith('.module.css'))) {
    const tag = new RegExp(`tagId(?:\\$\\d+)? = "([^"]*/${name.replace('.', '\\.')})"`).exec(source)
    assert.notEqual(tag, null, `the bundle carries the class map for ${name}`)
    const map = /var \w+_module_css_default = \{([^}]*)\};/.exec(source.slice(tag?.index ?? 0))
    assert.notEqual(map, null, `the class map for ${name} is readable`)
    sheets.set(name, String(map?.[1]))
  }

  const missing: string[] = []
  let checked = 0
  for (const file of files.filter(name => name.endsWith('.tsx') || name.endsWith('.ts'))) {
    const text = await readFile(join(clientDir, file), 'utf8')
    const imported = /import css from '\.\/([A-Za-z0-9_.-]+\.module\.css)'/.exec(text)?.[1]
    if (imported === undefined) continue
    const map = sheets.get(imported)
    assert.notEqual(map, undefined, `${file} imports a stylesheet the bundle lacks`)
    for (const [, local] of text.matchAll(/\bcss\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      checked += 1
      if (!new RegExp(`"${String(local)}":`).test(String(map))) missing.push(`${file}: css.${String(local)} (${imported})`)
    }
  }
  assert.ok(checked > 20, `the scan found class uses to check (${String(checked)})`)
  assert.deepEqual(missing, [], 'every referenced class is defined')
})
