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
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createElement, type ReactNode } from 'react'

const here = dirname(fileURLToPath(import.meta.url))
const bundlePath = join(here, '../..', 'lib', 'client.js')

/** The specifiers the shell's frozen module table seeds. */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
] as const

/**
 * Read a build output, naming the command that produces it.
 * @param path - absolute path of the artifact.
 * @returns the artifact's text.
 * @throws when the artifact is absent, with the command that creates it.
 */
async function readArtifact(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    throw new Error(`${path} is a build output and is absent; run \`npm run build\` first`)
  }
}

/** A stand-in for the shared component library. */
function primitivesStub(): Record<string, unknown> {
  const icon = () => createElement('svg', null)
  return {
    Button: (props: { children?: ReactNode }) => createElement('button', null, props.children),
    Tag: (props: { children?: ReactNode }) => createElement('span', null, props.children),
    IconBranchOutline16: icon,
    IconChevronDownOutline14: icon,
    IconChevronRightOutline14: icon,
    IconRefreshOutline16: icon,
    FileTypeIcon: icon,
    relativeTime: (at: number, now: number) => ({ unit: 'minutes', n: Math.floor((now - at) / 60_000) }),
  }
}

/** One loader entry the shell hands back. */
interface LoadedEntry {
  readonly id: string
  readonly exports: Record<string, unknown>
}

/**
 * Evaluate the built bundle against a stub loader.
 * @returns the id it registered under and the module it produced.
 */
async function loadBundle(): Promise<LoadedEntry> {
  const source = await readArtifact(bundlePath)
  const nodeRequire = createRequire(import.meta.url)
  const library = primitivesStub()
  const require = (name: string): unknown =>
    name === '@deepseek-ai/dsh-client-ui-primitives' ? library : nodeRequire(name)
  let loaded: LoadedEntry | undefined
  const window = {
    __ModuleLoader__: {
      load(entry: { id: string; factory: (require: (name: string) => unknown) => Record<string, unknown> }) {
        loaded = { id: entry.id, exports: entry.factory(require) }
      },
    },
  }
  // The bundle is not a module: it is a script that registers itself.
  new Function('window', 'require', source)(window, require)
  assert.notEqual(loaded, undefined, 'the bundle never called window.__ModuleLoader__.load')
  return loaded!
}

/** A registered tab type, as the bundle declared it. */
interface TabDefinition {
  readonly id: string
  readonly kind: string
  readonly patterns?: readonly string[]
  readonly priority?: string
  readonly title: (address: string) => string
  readonly guide?: readonly {
    readonly order: number
    readonly title: () => string
    readonly description?: () => string
    readonly icon?: unknown
  }[]
}

/** One slot registration the stub context captured. */
interface Registration {
  readonly definition: Record<string, unknown>
  readonly component: unknown
}

/** The stub context `apply` is driven with, and what it captured. */
interface Bench {
  readonly ctx: unknown
  readonly definitions: TabDefinition[]
  readonly providers: { readonly protocol: string }[]
  readonly registrations: Registration[]
  readonly locales: { ns: string; dictionaries: Record<string, unknown> }[]
}

/** Build the stub context `apply` is driven with. */
function stubContext(): Bench {
  const definitions: TabDefinition[] = []
  const providers: { readonly protocol: string }[] = []
  const registrations: Registration[] = []
  const locales: { ns: string; dictionaries: Record<string, unknown> }[] = []
  const ctx = {
    effect: (factory: () => unknown) => factory(),
    locale: {
      register: (ns: string, dictionaries: Record<string, unknown>) => {
        locales.push({ ns, dictionaries })
        return () => {}
      },
      bind: (ns: string) => (key: string) => `${ns}.${key}`,
    },
    sidebarRightTabs: {
      register: (definition: TabDefinition) => {
        definitions.push(definition)
        return () => {}
      },
    },
    resources: {
      register: (provider: { readonly protocol: string }) => {
        providers.push(provider)
        return () => {}
      },
    },
    slots: {
      // The real inject waits for the seat's declaration; the stub runs it now.
      inject: (_slot: string, callback: () => void) => callback(),
      register: (definition: Record<string, unknown>, component: unknown) => {
        registrations.push({ definition, component })
        return () => {}
      },
    },
  }
  return { ctx, definitions, providers, registrations, locales }
}

/** Run the bundle's `apply` against a fresh stub context. */
async function applied(): Promise<Bench> {
  const { exports } = await loadBundle()
  const bench = stubContext()
  ;(exports['apply'] as (ctx: unknown) => void)(bench.ctx)
  return bench
}

/** The `useTabInfo` share one body needs, with the seat values it reads. */
function tabInfo(contentId: string): () => unknown {
  return () => ({
    sidebar: { expanded: true, fullscreen: false },
    panel: { id: 'pane1' },
    tab: {
      id: 'tab1',
      kind: 'git',
      contentId,
      title: 'a.ts',
      visible: true,
      navigation: { address: contentId, params: undefined, revision: 1 },
      signal: new AbortController().signal,
      actions: { openResource: () => {}, openTab: () => {}, close: () => {} },
    },
  })
}

/** Render one registered body with the shares it asks for. */
async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(createElement(component as never, { t: (key: string) => key, ...props }))
}

test('the built bundle registers itself under the plugin id', async () => {
  assert.equal((await loadBundle()).id, 'dsh-git')
})

test('the loaded module exposes exactly the plugin surface', async () => {
  const { exports } = await loadBundle()
  assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject', 'name'])
  assert.equal(exports['name'], 'dsh-git-ui')
  assert.deepEqual(exports['inject'], ['slots', 'locale', 'sidebarRightTabs', 'resources', 'sidebarRight'])
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

test('declares a diff viewer claiming this plugin’s whole protocol', async () => {
  const { definitions } = await applied()
  const diff = definitions.find(definition => definition.kind === 'git')
  assert.notEqual(diff, undefined, 'no git resource type was registered')
  assert.equal(diff?.id, 'dsh-git/diff')
  assert.deepEqual(diff?.patterns, ['dsh-resource://git/**'])
  // The chip reads well without the content: a change is named by its file.
  assert.equal(diff?.title('dsh-resource://git/diff?session=s&source=worktree&path=src/a.ts'), 'a.ts')
  assert.equal(diff?.title('dsh-resource://git/commit?session=s&rev=deadbeefcafe'), 'deadbee')
})

test('registers one body per declared type, under the definition id', async () => {
  const { registrations, definitions } = await applied()
  assert.equal(registrations.length, 2)
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

test('registers the git resource provider', async () => {
  const { providers } = await applied()
  assert.deepEqual(providers.map(provider => provider.protocol), ['git'])
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

test('the diff body draws the reason when its resource is unavailable', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/diff?session=s&source=worktree&path=a.ts'),
    useResource: () => ({ status: 'none', value: undefined, failure: undefined }),
  })
  assert.match(markup, /loading/)
})

test('the diff body draws a host failure rather than an empty frame', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/diff?session=s&source=worktree&path=a.ts'),
    useResource: () => ({
      status: 'live',
      value: { kind: 'error', code: 'git/not-a-repository', message: 'nope' },
      failure: undefined,
    }),
  })
  assert.match(markup, /error\.title/)
  assert.match(markup, /git\/not-a-repository/)
})

test('the diff body draws a single change as a side-by-side grid', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const payload = {
    path: 'src/a.ts',
    source: 'worktree',
    oldLabel: 'index',
    newLabel: 'working tree',
    binary: false,
    truncated: false,
    removed: 1,
    added: 1,
    rows: [{ kind: 'replace', left: { no: 1, text: 'old' }, right: { no: 1, text: 'new' } }],
  }
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/diff?session=s&source=worktree&path=src/a.ts'),
    useResource: () => ({ status: 'live', value: { kind: 'diff', diff: payload }, failure: undefined }),
  })
  assert.match(markup, /data-dsh-git-diff/)
  assert.match(markup, /old/)
  assert.match(markup, /new/)
})

test('the diff body stacks every file of a commit inside one scroll region', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const file = (path: string) => ({
    path,
    source: 'commit',
    oldLabel: 'abc^',
    newLabel: 'abc',
    binary: false,
    truncated: false,
    removed: 0,
    added: 1,
    rows: [{ kind: 'insert', left: null, right: { no: 1, text: `line of ${path}` } }],
  })
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/commit?session=s&rev=deadbeefcafe'),
    useResource: () => ({
      status: 'live',
      value: {
        kind: 'commit',
        commit: {
          sha: 'deadbeefcafe',
          shortSha: 'deadbee',
          parents: [],
          authorName: 'Ada',
          authorEmail: 'ada@example.com',
          authoredAt: 1_700_000_000,
          refs: [],
          subject: 'a commit subject',
        },
        files: [file('src/a.ts'), file('src/b.ts')],
        truncated: false,
      },
      failure: undefined,
    }),
  })
  assert.match(markup, /a commit subject/)
  assert.match(markup, /src\/a\.ts/)
  assert.match(markup, /src\/b\.ts/)
  // Two embedded diffs, so the grid is drawn twice.
  assert.equal(markup.match(/data-dsh-git-diff/g)?.length, 2)
})

test('the diff body states the rows the host left out', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const payload = {
    path: 'src/a.ts',
    source: 'commit',
    oldLabel: 'abc^',
    newLabel: 'abc',
    binary: false,
    truncated: true,
    removed: 1,
    added: 1,
    rows: [
      { kind: 'gap', left: null, right: null, skippedLeft: 900, skippedRight: 900 },
      { kind: 'replace', left: { no: 901, text: 'old' }, right: { no: 901, text: 'new' } },
      { kind: 'gap', left: null, right: null, skippedLeft: 1200, skippedRight: 1200 },
    ],
  }
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/diff?session=s&source=commit&path=src/a.ts&rev=abc'),
    useResource: () => ({ status: 'live', value: { kind: 'diff', diff: payload }, failure: undefined }),
  })
  // A view that is not contiguous has to say so, with the counts it skipped.
  assert.match(markup, /diff\.omitted/)
  assert.match(markup, /900/)
  assert.match(markup, /1200/)
  assert.match(markup, /diff\.truncated/)
})

test('the bundle carries its stylesheets inlined under hashed local names', async () => {
  const source = await readArtifact(bundlePath)
  // A dynamic bundle has no stylesheet channel, so the build compiles each CSS
  // Module into the artifact and attaches one tagged <style> at factory time.
  assert.match(source, /data-plugin-css/)
  const css = source.replace(/\s+/g, '')
  for (const local of ['panel', 'grid', 'row', 'sectionHeader', 'rowLetter', 'nodeCurrent', 'ref', 'view']) {
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
