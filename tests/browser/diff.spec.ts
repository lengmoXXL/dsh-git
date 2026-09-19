import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * Everything the page did that no test should tolerate. The page fetches nothing but its
 * own files — the editor's font and its stylesheets travel inside the bundle — so a request
 * that fails is a request the bundle should not have made.
 */
function watch(page: Page): string[] {
  const errors: string[] = []
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${String(response.status())} ${response.url()}`)
  })
  const keep = (text: string): void => {
    // The console says only "404" for a response the listener above already named.
    if (text.startsWith('Failed to load resource')) return
    errors.push(text)
  }
  page.on('console', (message) => { if (message.type() === 'error') keep(message.text()) })
  page.on('pageerror', (error) => { keep(String(error)) })
  return errors
}

/*
 * The page's own probes, reached through `globalThis`: the host's tsconfig has no DOM
 * library, so a test cannot name `document` or `window` itself. Each is one question the
 * page can answer about what it drew.
 */

/** Ask the page to draw the diff again, optionally in a narrower board. */
function render(page: Page, props: object): Promise<void> {
  return page.evaluate(
    (next) => { (globalThis as unknown as { __render: (p: object) => void }).__render(next) },
    props,
  )
}

/** The box the editor settled in, and every size it took while settling. */
interface Settled {
  readonly sizes: readonly string[]
  readonly columns: readonly number[]
  readonly width: number
  readonly overflow: number
}

/** The colours the editor painted a line's tokens with. */
interface Colours {
  readonly keyword: string | undefined
  readonly identifier: string | undefined
  readonly distinct: number
}

/** How the editor painted what a file gained, lost, and changed. */
interface Marks {
  readonly addedLine: string | undefined
  readonly removedLine: string | undefined
  readonly addedText: string | undefined
  readonly removedText: string | undefined
}

/** What the page says about the editor's icon font and the glyph it draws with it. */
interface Icons {
  readonly font: boolean
  readonly content: string
}

/** The columns the band's unfold control and the glyph margin sit in. */
interface Columns {
  readonly unfold: number | null
  readonly glyph: number | null
}

/** The rail through an open commit's files, and the space the group is given. */
interface History {
  readonly paddingTop: number
  readonly paddingBottom: number
  readonly centre: number
  readonly top: number
  readonly bottom: number
  readonly width: number
  readonly above: { readonly x: number, readonly y: number } | null
  readonly below: { readonly x: number, readonly y: number } | null
}

/** Every question the page can answer, and what each answers with. */
interface Probes {
  /** The rail through an open commit's files, once one is open. */
  readonly history: () => History | null
  /** Whether the editor's icon font is loaded, and the glyph the band draws with it. */
  readonly icons: () => Promise<Icons>
  /** The columns the unfold control and the glyph margin sit in. */
  readonly columns: () => Columns
  /** Forty frames of the editor's box, and the pane's own width and overflow. */
  readonly settle: () => Promise<Settled>
  /** The colours the editor painted the fixture's own line with. */
  readonly colours: () => Colours
  /** The colours the editor marked the change with. */
  readonly marks: () => Marks
  /** Which number the gutter gave the changed line on each side, as text and number. */
  readonly numbering: () => readonly string[]
  /** Remember the editor that is on screen now. */
  readonly markEditor: () => void
  /** Whether the editor on screen is the one the last mark saw. */
  readonly editorIsMarked: () => 'same' | 'replaced' | 'no editor'
}

/** Ask the page one of its probes; a page can only be reached through `globalThis`. */
function probe<K extends keyof Probes>(page: Page, name: K): Promise<Awaited<ReturnType<Probes[K]>>> {
  return page.evaluate(
    (which: string) => (globalThis as unknown as { __probe: Record<string, () => unknown> }).__probe[which]!(),
    name,
  ) as Promise<Awaited<ReturnType<Probes[K]>>>
}

/** Whether a colour is one a reader would see: an overlay with no colour computes to none. */
function painted(colour: string | undefined): boolean {
  return colour !== undefined && colour !== 'rgba(0, 0, 0, 0)'
}

test('draws a diff in the editor, in either reading', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // Two columns, and the run the fixture left unchanged is stated rather than drawn.
  await expect(page.locator('[data-reading="split"]')).toBeVisible()
  await expect(page.getByText(/hidden lines/).first()).toBeVisible()
  await page.screenshot({ path: 'tests/browser/.page/diff-two-columns.png' })

  // The same diff in one column: the editor says which reading it is in, which is what
  // the page's switch asks it for — and it is the editor that is already up that is told
  // so, rather than a new one built in its place, which would lose the reading position.
  await probe(page, 'markEditor')
  await render(page, { split: false })
  await expect(page.locator('[data-reading="inline"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  expect(await probe(page, 'editorIsMarked'), 'the switch did not build a new editor').toBe('same')

  expect(errors, 'the page logged errors').toEqual([])
})

test('paints the tokens in the palette the page named', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // The lines are drawn a frame after the box they sit in, so the colour is polled until
  // it is there: the assertion is about the palette, not about which frame it was read on.
  await expect.poll(async () => (await probe(page, 'colours')).keyword).toBe('rgb(250, 162, 193)')
  const line = await probe(page, 'colours')
  // An identifier is not a token any palette names, so it keeps the theme's default.
  expect(line.identifier, 'an identifier keeps the default colour').toBe('rgb(212, 212, 212)')
  expect(line.distinct, 'the line is more than one colour').toBeGreaterThan(1)
})

test('marks the lines a file gained and lost', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // The overlays are drawn a frame after the box they sit in, so the colour is polled
  // until it is there: the assertion is about the paint, not about the frame.
  await expect.poll(async () => painted((await probe(page, 'marks')).addedLine)).toBe(true)
  const marked = await probe(page, 'marks')
  // The colours come from a stylesheet in the editor's own package — the one that says an
  // added line is green and a removed one is red, and that the text which changed inside a
  // line is marked too. Without it every overlay is in the document and none is painted,
  // which is a diff whose every line looks alike.
  for (const [what, colour] of Object.entries({
    'a removed line': marked.removedLine,
    'the text a line gained': marked.addedText,
    'the text a line lost': marked.removedText,
  })) {
    expect(painted(colour), `${what} is painted`).toBe(true)
  }
  expect(marked.addedLine, 'an added line is not painted like a removed one').not.toBe(marked.removedLine)
  await page.screenshot({ path: 'tests/browser/.page/diff-marks.png' })
})

test('numbers each side by the file it came from', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  await expect.poll(async () => (await probe(page, 'numbering')).length).toBe(2)
  // The fixture's third line is a change, and the line before it is an addition the old
  // side does not have: a side padded with the other's lines counts it, and the reader is
  // sent to the wrong line of the file.
  expect(await probe(page, 'numbering'), 'the line is numbered by its own file').toEqual([
    'const answer = 41@3',
    'const answer = 42@3',
  ])
})

test('draws the unfold control with the editor icon, in the glyph column', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  const icons = await probe(page, 'icons')
  // The editor draws its icons with a font it names as a file beside one of its own
  // stylesheets: a page that cannot reach that file draws a box in the icon's place.
  expect(icons.font, "the editor's icon font is in the bundle").toBe(true)
  expect(icons.content, 'the band draws an icon').not.toBe('none')
  // Expanding a run and folding it back are one control to a reader, and the editor draws
  // them in different places unless the band's slot takes the glyph margin's width.
  // The band is drawn once the editor has computed the diff, a frame or two after the box.
  await expect.poll(async () => (await probe(page, 'columns')).unfold).not.toBeNull()
  const columns = await probe(page, 'columns')
  expect(columns.unfold, 'the band has an unfold control').not.toBeNull()
  expect(columns.glyph, 'the editor has a glyph margin').not.toBeNull()
  expect(columns.unfold, 'the unfold control sits in the glyph column').toBe(columns.glyph)
  expect(errors, 'the page logged errors').toEqual([])
})

test('joins an open commit to the one below it, and spaces it evenly', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  // The newest commit's files are open on arrival: the list is the way into them.
  await page.evaluate(() => {
    (globalThis as unknown as { __renderHistory: () => void }).__renderHistory()
  })
  await expect.poll(async () => (await probe(page, 'history')) !== null).toBe(true)
  const history = await probe(page, 'history')
  if (history === null) throw new Error('the newest commit drew no files')
  expect(history.paddingTop, 'the files are spaced the same above and below').toBe(history.paddingBottom)
  expect(history.above, 'the open commit has a node').not.toBeNull()
  expect(history.below, 'the commit below it has one too').not.toBeNull()
  // A graph would draw this line; a list has to draw it, or the files look detached.
  expect(history.width, 'the rail is two pixels of the nodes colour').toBe(2)
  expect(history.centre, 'the rail runs through the nodes').toBe(history.above?.x)
  expect(history.top, 'it starts at the node above').toBe(history.above?.y)
  expect(history.bottom, 'and ends at the node below').toBe(history.below?.y)

  // Opening and closing is the reader's, and closing takes the rail with it.
  await page.locator('#historyHost [class*=_subject]').first().click()
  await expect.poll(async () => (await probe(page, 'history')) === null).toBe(true)
  expect(errors, 'the page logged errors').toEqual([])
})

test('holds its box while it settles, however narrow the pane', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // Narrower than the floor the list's drag is held to: the pane the diff is given is the
  // width the page has left, not a width of its own that overflows the page holding it.
  await render(page, { width: 360 })
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  const settled = await probe(page, 'settle')
  // An editor that sizes itself to a scroller trades the scrollbar's few pixels with the
  // box it is given for as long as it is open, which is what the reader sees as a shake.
  expect(settled.sizes, 'the editor was laid out once').toHaveLength(1)
  expect(settled.width, 'the pane is the width the page gave it').toBeLessThanOrEqual(360)
  // Width only: the editor's own widgets reach a few pixels below its box, which is the
  // editor's business and stays inside the pane.
  expect(settled.overflow, 'the editor fits the pane across').toBe(0)
  // The reader asked for two columns and the pane is narrow: the editor answers with two
  // anyway, rather than falling back to one below its own breakpoint and leaving the switch
  // looking like it did nothing.
  expect(settled.columns, 'the narrow pane is still drawn in two columns').toHaveLength(2)
  expect(errors, 'the page logged errors').toEqual([])
})
