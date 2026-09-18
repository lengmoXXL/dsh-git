import { defineConfig } from '@playwright/test'

/**
 * The browser tests: one page, built from the plugin's own artifact, served over HTTP
 * because a module loader fetches its files.
 */
export default defineConfig({
  testDir: 'tests/browser',
  // Three tests, one static server and one page: running them side by side only adds a
  // variable to the failures.
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:8410', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  webServer: {
    // The page is built from the artifact here, so a run always tests the build it just
    // made. A server left over from another run would serve the page that run left on
    // disk — a stale page reads like a bug in the plugin, which is a trap this suite has
    // already fallen into once.
    command: 'node tests/browser/page.mjs tests/browser/.page && python3 -m http.server 8410 --bind 127.0.0.1 --directory tests/browser/.page',
    url: 'http://127.0.0.1:8410/index.html',
    reuseExistingServer: false,
    stdout: 'ignore',
  },
})
