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
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  applied,
  bundlePath,
  loadBundle,
  PLATFORM_MODULES,
  primitivesStub,
  readArtifact,
  render,
  tabInfo,
} from './harness.ts'

test('the built bundle registers itself under the plugin id', async () => {
  assert.equal((await loadBundle()).id, 'dsh-git')
})

test('declares a log page with a guide entry, so the add control can reach it', async () => {
  const { definitions } = await applied()
  const log = definitions.find(definition => definition.kind === 'git-log')
  assert.notEqual(log, undefined, 'no git-log page type was registered')
  assert.equal(log?.id, 'dsh-git/log')
  // A page type recognizes no address: it is opened by kind.
  assert.equal(log?.patterns, undefined)
  assert.equal(log?.title('sidebar://git-log'), 'dsh-git.log.title')

  const entry = log?.guide?.[0]
  assert.notEqual(entry, undefined, 'the page contributed no guide entry')
  assert.equal(entry?.title(), 'dsh-git.log.title')
  assert.equal(entry?.description?.(), 'dsh-git.log.guide')
  assert.equal(typeof entry?.icon, 'function')
  assert.ok(typeof entry?.order === 'number')
})

test('registers one body per declared type, under the definition id', async () => {
  const { registrations, definitions } = await applied()
  assert.equal(registrations.length, 1)
  for (const registration of registrations) {
    assert.equal(registration.definition['name'], 'sidebar.right.pane.tab')
    assert.equal(registration.definition['locale'], 'dsh-git')
    assert.equal(typeof registration.component, 'function')
  }
  assert.deepEqual(
    registrations.map(entry => entry.definition['key']).sort(),
    definitions.map(definition => definition.id).sort(),
  )
})

test('registers both dictionaries under one namespace, with the same keys', async () => {
  const { locales } = await applied()
  assert.equal(locales.length, 1)
  assert.equal(locales[0]?.ns, 'dsh-git')
  const dictionaries = locales[0]?.dictionaries ?? {}
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])
  assert.deepEqual(
    Object.keys(dictionaries['en'] as object).sort(),
    Object.keys(dictionaries['zh'] as object).sort(),
  )
  // And every key is asked for somewhere: copy that no component reads is copy that
  // rots, and the dictionaries are the one place a dead string can hide.
  const clientDir = join(dirname(fileURLToPath(import.meta.url)), '../../src/client')
  const asked = (await readdir(clientDir))
    .filter(name => name.endsWith('.ts') || name.endsWith('.tsx'))
    .filter(name => name !== 'locales.ts')
  const sources = (await Promise.all(asked.map(async name => readFile(join(clientDir, name), 'utf8')))).join('\n')
  for (const key of Object.keys(dictionaries['zh'] as object)) {
    assert.ok(sources.includes(`'${key}'`), `"${key}" is not asked for by any component`)
  }
})

test('the log body renders its frame while the reads are still in flight', async () => {
  const { registrations } = await applied()
  const log = registrations.find(entry => entry.definition['key'] === 'dsh-git/log')
  // Effects do not run under server rendering, so the tab is still loading.
  const markup = await render(log?.component, {
    useTabInfo: tabInfo('sidebar://git-log'),
    sessionId: 'session-1',
    openResource: () => {},
  })
  assert.match(markup, /loading/)
})

test('the page header carries the controls, and only what it can act on', async () => {
  const { registrations } = await applied()
  const log = registrations.find(entry => entry.definition['key'] === 'dsh-git/log')
  const markup = await render(log?.component, {
    useTabInfo: tabInfo('sidebar://git-log'),
    sessionId: 'session-1',
    openResource: () => {},
  })
  // The list's own controls, then the actions on the pane the reader is in. With
  // no diff open yet there is nothing to open a file from or copy, so those two
  // say so rather than doing nothing when clicked.
  assert.match(markup, /panel\.railHide/)
  assert.match(markup, /panel\.railRight/)
  assert.match(markup, /diff\.openFile/)
  // No copy button: copying is what a selection does, and that keeps to the half it
  // started in without a control of its own.
  assert.doesNotMatch(markup, /diff\.copy/)
  assert.match(markup, /diff\.inlineView/)
  assert.match(markup, /diff\.clipView/)
  assert.match(markup, /disabled/)
})

test('shows the newest twelve commits and one control for the rest', async () => {
  const { exports } = await loadBundle()
  const commits = Array.from({ length: 20 }, (_unused, at) => ({
    sha: `${String(at)}`.padStart(40, 'a'),
    short: `c${String(at)}`,
    subject: `commit ${String(at)}`,
    author: 'someone',
    at: Date.UTC(2024, 0, 1 + at),
    refs: [],
    parents: ['a'.repeat(40)],
  }))
  const markup = await render(exports['HistoryList'], {
    commits,
    hasMore: true,
    sessionId: 's',
    now: Date.UTC(2024, 1, 1),
    onSelectFile: () => {},
  })
  // A page is a page, not the whole log: the newest twelve, and one control saying
  // there are older ones — without a number, which no side can know.
  assert.match(markup, /commit 11/)
  assert.doesNotMatch(markup, /commit 12/)
  assert.match(markup, /list\.moreCommits/)
  assert.doesNotMatch(markup, /list\.moreCommits[^<]*\d/)
  // A commit row is a commit: the node, its subject, when and by whom. Nothing
  // per-row says "expandable" — the whole row is the target.
  assert.doesNotMatch(markup, /_disclosure/)
  // The newest commit is open before anyone asks: a page about a repository should
  // show what it just did, not a column of subjects. Exactly one commit row says so
  // — the section above it is a collapsible of its own, which is a different thing.
  assert.equal((markup.match(/_row [^>]*aria-expanded="true"/g) ?? []).length, 1)
})

test('shows eight changes per group and one control for the rest', async () => {
  const { exports } = await loadBundle()
  const entries = Array.from({ length: 11 }, (_unused, at) => ({
    path: `src/file${String(at)}.ts`,
    stage: 'unstaged' as const,
    kind: 'modified' as const,
    origPath: undefined,
  }))
  const markup = await render(exports['ChangeList'], {
    grouped: { conflicted: [], staged: [], unstaged: entries, untracked: [] },
    truncated: false,
    onSelect: () => {},
    onOpenFile: () => {},
  })
  assert.match(markup, /src\/file7\.ts/)
  assert.doesNotMatch(markup, /src\/file8\.ts/)
  // The control is a control: three dots, a count, and it says what it stands for.
  assert.match(markup, /⋯/)
  assert.match(markup, /list\.moreFiles/)
  // And a row offers the file as well as its diff, in a span because a button
  // inside a button is not a thing a browser will draw.
  assert.match(markup, /_rowFile/)
})

test('the bundle carries its stylesheets inlined under hashed local names', async () => {
  const source = await readArtifact(bundlePath)
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

test('replaces a stylesheet the document already carries, rather than skipping it', async () => {
  const source = await readArtifact(bundlePath)
  const nodeRequire = createRequire(import.meta.url)
  const library = primitivesStub()
  void library
  const require = (name: string): unknown =>
    name === '@deepseek-ai/dsh-client-ui-primitives' ? library : nodeRequire(name)

  // The document a hot-swapped bundle runs in: the tag an earlier build
  // injected is still there, under the same module-keyed id.
  const carried: { textContent: string }[] = []
  const created = 0
  const globalDocument = {
    querySelector: () => (carried.length === 0 ? null : carried[0]),
    createElement: () => {
      const tag = { dataset: {} as Record<string, string>, textContent: '' }
      carried.push(tag)
      return tag
    },
    head: { appendChild: () => {} },
  }
  const previous = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = globalDocument
  try {
    // First evaluation stands in for the load that put the tag there. The
    // factory is what injects, so the stub loader has to run it.
    const run = (): void => {
      new Function('window', 'require', source)(
        { __ModuleLoader__: { load: (entry: { factory: (req: unknown) => unknown }) => { entry.factory(require) } } },
        require,
      )
    }
    run()
    const injected = carried.length
    assert.ok(injected > 0, 'the first evaluation injected its stylesheets')
    const before = carried.map(tag => tag.textContent)
    for (const tag of carried) tag.textContent = 'stale'
    // Second evaluation is the hot swap: same document, same tag ids.
    run()
    assert.equal(carried.length, injected, 'no second tag for a stylesheet already present')
    assert.deepEqual(
      carried.map(tag => tag.textContent),
      before,
      'every stylesheet was rewritten with the current build\'s CSS',
    )
    assert.equal(created, 0)
  } finally {
    if (previous === undefined) delete (globalThis as { document?: unknown }).document
    else (globalThis as { document?: unknown }).document = previous
  }
})

test('keeps the scrollbars thin without restyling the shell', async () => {
  const source = await readArtifact(bundlePath)
  const css = source.replace(/\s+/g, '')
  assert.match(css, /--dsh-scrollbar-width:4px/)
  // On the panel's own rule, not on the document's.
  assert.doesNotMatch(css, /:root\{[^}]*--dsh-scrollbar-width/)
})

test('carries the build it came from', async () => {
  const source = await readArtifact(bundlePath)
  // Substituted at build time, so a page can be asked which build it is
  // running: the diff's content comes from the host and is always current,
  // while the layout comes from whatever bundle the page loaded.
  assert.doesNotMatch(source, /__DSH_GIT_BUILD__/, 'the token was substituted')
  const stamp = /(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d+Z)/.exec(source)
  assert.notEqual(stamp, null, 'the bundle names the moment it was built')
})

test('the bundle requests only modules the shell already holds', async () => {
  const source = await readArtifact(bundlePath)
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
  const source = await readArtifact(bundlePath)
  const here = dirname(fileURLToPath(import.meta.url))
  const clientDir = join(here, '../..', 'src', 'client')
  const files = await readdir(clientDir)

  // A class the component names but the stylesheet does not define arrives as
  // `undefined`; `cx` then drops it and the element simply has no rule — a
  // missing indent or a missing highlight, with nothing failing anywhere. The
  // class map the build emits is the only place that can be asked.
  const sheets = new Map<string, string>()
  for (const name of files.filter(file => file.endsWith('.module.css'))) {
    const tag = new RegExp(`tagId(?:\\$\\d+)? = "dsh-git/${name.replace('.', '\\.')}"`).exec(source)
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
