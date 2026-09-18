import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

/**
 * The page asks for the icon font its own stylesheet names and the page serves no
 * fonts, so that one request is expected to fail. Everything else the page says or
 * does is a failure.
 */
const EXPECTED = [/\.ttf$/]

/** Everything the page did that no test should tolerate. */
function watch(page: Page): string[] {
  const errors: string[] = []
  const allowed = (text: string): boolean => EXPECTED.some(pattern => pattern.test(text))
  page.on('response', (response) => {
    if (response.status() >= 400 && !allowed(response.url())) {
      errors.push(`${String(response.status())} ${response.url()}`)
    }
  })
  const keep = (text: string): void => {
    // The console says only "404" for the same request; the response above names it.
    if (text.startsWith('Failed to load resource')) return
    if (!allowed(text)) errors.push(text)
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
  readonly width: number
  readonly overflow: number
}

/** The colours the editor painted a line's tokens with. */
interface Colours {
  readonly keyword: string | undefined
  readonly identifier: string | undefined
  readonly distinct: number
}

/** Forty frames of the editor's box, and the pane's own width and overflow. */
function settle(page: Page): Promise<Settled> {
  return page.evaluate(
    () => (globalThis as unknown as { __probe: { settle: () => Promise<Settled> } }).__probe.settle(),
  )
}

/** The colours the editor painted the fixture's own line with. */
function colours(page: Page): Promise<Colours> {
  return page.evaluate(
    () => (globalThis as unknown as { __probe: { colours: () => Colours } }).__probe.colours(),
  )
}

/** Remember the editor that is on screen now. */
function markEditor(page: Page): Promise<void> {
  return page.evaluate(
    () => { (globalThis as unknown as { __probe: { markEditor: () => void } }).__probe.markEditor() },
  )
}

/** Whether the editor on screen is the one the last mark saw. */
function editorIsMarked(page: Page): Promise<string> {
  return page.evaluate(
    () => (globalThis as unknown as { __probe: { editorIsMarked: () => string } }).__probe.editorIsMarked(),
  )
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
  await markEditor(page)
  await render(page, { split: false })
  await expect(page.locator('[data-reading="inline"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  expect(await editorIsMarked(page), 'the switch did not build a new editor').toBe('same')

  expect(errors, 'the page logged errors').toEqual([])
})

test('paints the tokens in the palette the page named', async ({ page }) => {
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // The lines are drawn a frame after the box they sit in, so the colour is polled until
  // it is there: the assertion is about the palette, not about which frame it was read on.
  await expect.poll(async () => (await colours(page)).keyword).toBe('rgb(250, 162, 193)')
  const painted = await colours(page)
  // An identifier is not a token any palette names, so it keeps the theme's default.
  expect(painted.identifier, 'an identifier keeps the default colour').toBe('rgb(212, 212, 212)')
  expect(painted.distinct, 'the line is more than one colour').toBeGreaterThan(1)
})

test('holds its box while it settles, however narrow the pane', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // Narrower than the floor the list's drag is held to: the pane the diff is given is the
  // width the page has left, not a width of its own that overflows the page holding it.
  await render(page, { width: 360 })
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()
  const settled = await settle(page)
  // An editor that sizes itself to a scroller trades the scrollbar's few pixels with the
  // box it is given for as long as it is open, which is what the reader sees as a shake.
  expect(settled.sizes, 'the editor was laid out once').toHaveLength(1)
  expect(settled.width, 'the pane is the width the page gave it').toBeLessThanOrEqual(360)
  // Width only: the editor's own widgets reach a few pixels below its box, which is the
  // editor's business and stays inside the pane.
  expect(settled.overflow, 'the editor fits the pane across').toBe(0)
  expect(errors, 'the page logged errors').toEqual([])
})
