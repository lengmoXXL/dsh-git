/**
 * The bench the bundle's end-to-end tests share: a stub window, a stub component
 * library, and the two ways of driving what the bundle registered.
 *
 * The bundle is a build artifact the shell loads through a module loader, so it
 * is exercised as one — evaluated with `window.__ModuleLoader__` in place, and
 * rendered through `react-dom/server` — because the wrapper and the CSS-module
 * injection are part of what ships and nothing else in the suite would notice
 * them changing.
 *
 * @module dsh-git/tests/e2e/harness
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, type ReactNode } from 'react'

/** Absolute path of the client bundle this suite drives. */
export const bundlePath = join(dirname(fileURLToPath(import.meta.url)), '../..', 'lib', 'client.js')

/** The specifiers the shell's frozen module table seeds. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit', 'url'] as const

/**
 * Read a build output, naming the command that produces it.
 * @param path - absolute path of the artifact.
 * @returns the artifact's text.
 * @throws when the artifact is absent, with the command that creates it.
 */
export async function readArtifact(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    throw new Error(`${path} is a build output and is absent; run \`npm run build\` first`)
  }
}

/**
 * A stand-in for the shared component library.
 *
 * Every icon carries a size: a bare `<svg>` defaults to 300x150 and would wreck
 * the layout a render is being read for.
 */
export function primitivesStub(): Record<string, unknown> {
  const icon = () => createElement('svg', { width: 16, height: 16 })
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
export interface LoadedEntry {
  readonly id: string
  readonly exports: Record<string, unknown>
}

/** The window value a bundle evaluation sees, and what it captured. */
interface BenchWindow {
  readonly window: Record<string, unknown>
  readonly loaded: () => LoadedEntry | undefined
}

/** Build the window a bundle evaluation registers itself against. */
function benchWindow(store?: ReadonlyMap<string, string>): BenchWindow {
  let loaded: LoadedEntry | undefined
  const window: Record<string, unknown> = {
    __ModuleLoader__: {
      load(entry: { id: string; factory: (require: (name: string) => unknown) => Record<string, unknown> }) {
        const nodeRequire = createRequire(import.meta.url)
        const library = primitivesStub()
        const require = (name: string): unknown =>
          name === '@deepseek-ai/dsh-client-ui-primitives' ? library : nodeRequire(name)
        loaded = { id: entry.id, exports: entry.factory(require) }
      },
    },
  }
  if (store !== undefined) {
    // The view settings live in the browser's storage, so a test that needs a
    // particular layout has to hand the bundle a document that has one.
    window['localStorage'] = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: () => {},
    }
  }
  return { window, loaded: () => loaded }
}

/**
 * Evaluate the built bundle against a stub loader.
 * @param store - the browser storage the bundle should see, when a test needs a
 *   view setting other than the default.
 * @returns the id it registered under and the module it produced.
 */
export async function loadBundle(store?: ReadonlyMap<string, string>): Promise<LoadedEntry> {
  const source = await readArtifact(bundlePath)
  const bench = benchWindow(store)
  // The bundle is not a module: it is a script that registers itself, and its top level does
  // nothing but call the loader, whose factory is handed the `require` that resolves modules.
  new Function('window', source)(bench.window)
  const loaded = bench.loaded()
  assert.notEqual(loaded, undefined, 'the bundle never called window.__ModuleLoader__.load')
  return loaded!
}

/** A registered tab type, as the bundle declared it. */
export interface TabDefinition {
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
export interface Registration {
  readonly definition: Record<string, unknown>
  readonly component: unknown
}

/** The stub context `apply` is driven with, and what it captured. */
export interface Bench {
  readonly ctx: unknown
  readonly definitions: TabDefinition[]
  readonly providers: { readonly protocol: string }[]
  readonly registrations: Registration[]
  readonly locales: { ns: string; dictionaries: Record<string, unknown> }[]
}

/**
 * Run the bundle's `apply` against a fresh stub context.
 * @param store - the browser storage the bundle should see.
 * @returns what the stub captured.
 */
export async function applied(store?: ReadonlyMap<string, string>): Promise<Bench> {
  const { exports } = await loadBundle(store)
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
  const apply = exports['apply'] as (ctx: unknown) => void
  apply(ctx)
  return { ctx, definitions, providers, registrations, locales }
}

/** The `useTabInfo` share one body needs, with the seat values it reads. */
export function tabInfo(contentId: string): () => unknown {
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
export async function render(component: unknown, props: Record<string, unknown>): Promise<string> {
  const { renderToStaticMarkup } = await import('react-dom/server')
  return renderToStaticMarkup(createElement(component as never, { t: (key: string) => key, ...props }))
}
