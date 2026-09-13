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

test('the diff body highlights a line through the sheet the file view uses', async () => {
  const { registrations } = await applied()
  const diff = registrations.find(entry => entry.definition['key'] === 'dsh-git/diff')
  const payload = {
    path: 'src/a.ts',
    source: 'worktree',
    oldLabel: 'index',
    newLabel: 'working tree',
    binary: false,
    truncated: false,
    removed: 0,
    added: 1,
    rows: [{ kind: 'insert', left: null, right: { no: 1, text: 'const answer: number = 42' } }],
  }
  const markup = await render(diff?.component, {
    useTabInfo: tabInfo('dsh-resource://git/diff?session=s&source=worktree&path=src/a.ts'),
    useResource: () => ({ status: 'live', value: { kind: 'diff', diff: payload }, failure: undefined }),
  })
  // The path names a grammar, so the runs arrive colored through the shiki
  // token sheet — the same one the file view's code blocks read.
  assert.match(markup, /--shiki-token-keyword/)
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

test('declares the diff geometry for the embedded card as well as the tab', async () => {
  const source = await readArtifact(bundlePath)
  const grid = /"grid":\s*"([^"]+)"/.exec(source)?.[1]
  assert.notEqual(grid, undefined, 'the class map carries "grid"')
  const prefix = String(grid).slice(0, String(grid).indexOf('_grid'))
  const sheets = [...source.matchAll(/const css(?:\$\d+)? = "((?:[^"\\]|\\.)*)";/g)]
    .map(match => JSON.parse(`"${match[1]}"`))
  const sheet = sheets.find(text => text.includes(`.${prefix}_grid{`))
  assert.notEqual(sheet, undefined, 'the diff stylesheet was inlined')

  // A grid whose gutter length is missing computes no columns at all: every cell
  // becomes its own full-width row, so the numbers land on the right and the two
  // sides stack. The geometry therefore has to be declared on BOTH roots — a
  // commit's tab draws `.diffEmbedded` and never `.diff`.
  const declared = /([^{}]+)\{[^{}]*--dsh-git-diff-gutter:48px/.exec(String(sheet))
  assert.notEqual(declared, null, 'the gutter length is declared')
  const selector = String(declared?.[1])
  assert.match(selector, /_diff(?![\w-])/, 'the tab root carries the geometry')
  assert.match(selector, /_diffEmbedded(?![\w-])/, 'the embedded card carries it too')
})

test('sizes an unwrapped lane\'s rows and its track itself', async () => {
  const source = await readArtifact(bundlePath)
  const laneRow = /"laneRow":\s*"([^"]+)"/.exec(source)?.[1]
  assert.notEqual(laneRow, undefined, 'the class map carries "laneRow"')
  const prefix = String(laneRow).slice(0, String(laneRow).indexOf('_laneRow'))
  const sheets = [...source.matchAll(/const css(?:\$\d+)? = "((?:[^"\\]|\\.)*)";/g)]
    .map(match => JSON.parse(`"${match[1]}"`))
  const sheet = String(sheets.find(text => text.includes(`.${prefix}_lane{`)) ?? '')
  const lane = new RegExp(`\\.${prefix}_lane\\{([^{}]*)\\}`).exec(sheet)
  assert.notEqual(lane, null, 'the lane has a rule of its own')
  const body = String(lane?.[1])

  // A lane is a stack of its own, not a grid row shared with the other half, so
  // its geometry cannot come from the row's contents:
  //
  // - A row whose OWN side has no line — the blank half of an insertion or a
  //   deletion — draws nothing, and a row sized by its content collapses while
  //   the other half keeps its height. The halves then drift a row apart for
  //   every blank row between them.
  // - A row's band is only as wide as the track it sits in. Sized to the
  //   longest line, the band of a changed block stops short of the half's edge
  //   and the half reads as if it were narrower than it is.
  //
  // Both are why the lane sizes its rows and its track itself.
  assert.match(
    body,
    /grid-auto-rows:[^;}]*var\(--dsh-git-diff-row\)|min-height:[^;}]*var\(--dsh-git-diff-row\)/,
    'every lane row is a row high whether or not it has anything in it',
  )
  assert.match(
    body,
    /grid-template-columns:[^;}]*minmax\(100%/,
    'a lane\'s track is at least the half it draws in',
  )
})

test('masks the line that scrolls under a pinned number', async () => {
  const source = await readArtifact(bundlePath)
  const laneRow = /"laneRow":\s*"([^"]+)"/.exec(source)?.[1]
  assert.notEqual(laneRow, undefined, 'the class map carries "laneRow"')
  const prefix = String(laneRow).slice(0, String(laneRow).indexOf('_laneRow'))
  const sheets = [...source.matchAll(/const css(?:\$\d+)? = "((?:[^"\\]|\\.)*)";/g)]
    .map(match => JSON.parse(`"${match[1]}"`))
  const sheet = String(sheets.find(text => text.includes(`.${prefix}_lane{`)) ?? '')

  // The lane scrolls sideways and the number stays, so the line passes under the
  // number. A number whose background is inherited from a row that has none is
  // transparent, and the line then scrolls straight through it — which reads as
  // two lines of text tangled in the gutter rather than one line beside a
  // number. The number therefore paints a band of its own, and every row defines
  // one, the card's own surface being the default.
  const num = new RegExp(`\\.${prefix}_laneNum\\{([^{}]*)\\}`).exec(sheet)
  assert.notEqual(num, null, 'the lane number has a rule of its own')
  assert.match(
    String(num?.[1]),
    /background:var\(--dsh-git-diff-band\)/,
    'the number paints a band rather than inheriting whatever its row has',
  )

  // The band is the tone's colour when the row has one, and the card's surface
  // otherwise. That fallback is a value for the BAND, not another value for the
  // tone: the two rules land on the same element, so a second declaration of the
  // tone's own property would be settled by stylesheet order — which is how a
  // default on the row once turned every changed row colourless.
  const row = new RegExp(`\\.${prefix}_laneRow\\{([^{}]*)\\}`).exec(sheet)
  assert.match(
    String(row?.[1]),
    /--dsh-git-diff-band:var\(--dsh-git-diff-tone,var\(--dsw-alias-markdown-code-block\)\)/,
    'a row with no tone still names a band, without restating the tone',
  )
  for (const tone of ['del', 'add', 'blank']) {
    const rule = new RegExp(`\\.${prefix}_${tone}\\{([^{}]*)\\}`).exec(sheet)
    assert.notEqual(rule, null, `the ${tone} tone has a rule`)
    assert.match(String(rule?.[1]), /--dsh-git-diff-tone:/, `the ${tone} tone names its colour`)
    assert.doesNotMatch(
      String(rule?.[1]),
      /--dsh-git-diff-band:/,
      `the ${tone} tone does not restate the band it stands on`,
    )
  }
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
