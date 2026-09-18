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

test('draws a diff in the editor, in either reading', async ({ page }) => {
  const errors = watch(page)
  await page.goto('/index.html')
  await expect(page.locator('.monaco-diff-editor')).toBeVisible({ timeout: 20_000 })
  // Two columns, and the run the fixture left unchanged is stated rather than drawn.
  await expect(page.locator('[data-reading="split"]')).toBeVisible()
  await expect(page.getByText(/hidden lines/).first()).toBeVisible()
  await page.screenshot({ path: 'tests/browser/.page/diff-two-columns.png' })

  // The same diff in one column: the editor says which reading it is in, which is what
  // the page's switch asks it for.
  // The code below runs in the browser; the host's tsconfig has no DOM library, so the
  // page's own helpers are reached through `globalThis` rather than `window`.
  await page.evaluate(() => {
    (globalThis as unknown as { __render: (props: object) => void }).__render({ split: false })
  })
  // The component states what it asked the editor for; the editor's own class for that
  // reading is Monaco's business, and asserting it would test the editor, not the plugin.
  await expect(page.locator('[data-reading="inline"]')).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.monaco-diff-editor')).toBeVisible()

  expect(errors, 'the page logged errors').toEqual([])
})
