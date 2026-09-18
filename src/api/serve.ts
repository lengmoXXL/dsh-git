/**
 * Mounting the git API on the host's Web server.
 *
 * The route is registered through `ctx.get('webServer')` rather than an
 * injected dependency, because a profile that serves no browser (headless, SDK)
 * has no HTTP server and this plugin must still load there. A missing server is
 * therefore not a failure: it means nobody can open the panel, not that the
 * plugin is misconfigured.
 *
 * The response's own lifetime is the request's: when the browser navigates away
 * or aborts, the accompanying git read is terminated with it rather than left
 * running to completion for nobody.
 *
 * @module dsh-git/api/serve
 */

import { readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { GitApiConfig } from './handler.ts'
import { handleGitApi } from './handler.ts'

/** The path prefix this plugin owns. */
export const API_PREFIX = '/dsh-git'

/**
 * Write one JSON response, unless the socket is already gone.
 * @param response - the response to write.
 * @param status - the HTTP status code.
 * @param body - the JSON-serializable body.
 */
function writeJson(response: ServerResponse, status: number, body: unknown): void {
  if (response.writableEnded || response.destroyed) return
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

/** The editor's files, and what each is served as. */
const VENDOR_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ttf': 'font/ttf',
  '.svg': 'image/svg+xml',
}

/** Where this package keeps the editor it serves. */
const VENDOR_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'vendor')

/**
 * Serve one file of the editor's own build.
 *
 * These are the page's own requests, made by the editor's loader for its own modules,
 * so a miss is a miss and not a git failure. The path is resolved against the vendor
 * directory and refused if it climbs out of it: nothing here is allowed to name a file
 * outside the editor this package ships.
 *
 * @param response - the response to write.
 * @param below - the request path below the plugin's prefix.
 */
async function writeVendor(response: ServerResponse, below: string): Promise<void> {
  const wanted = resolve(VENDOR_ROOT, below.slice('/vendor/'.length))
  const type = VENDOR_TYPES[extname(wanted)]
  if (!wanted.startsWith(VENDOR_ROOT + sep) || type === undefined) {
    writeJson(response, 404, { code: 'git/bad-request', message: 'no such file' })
    return
  }
  try {
    const body = await readFile(wanted)
    response.writeHead(200, {
      'content-type': type,
      'content-length': String(body.byteLength),
      // The editor is fetched once per page and asked for by revision-less paths, so a
      // cached copy would outlive the build that made it.
      'cache-control': 'no-cache',
    })
    response.end(body)
  } catch {
    writeJson(response, 404, { code: 'git/bad-request', message: 'no such file' })
  }
}

/**
 * Register the git routes on the host's Web server.
 * @param ctx - the host context.
 * @param config - the deployment's caps.
 */
export function registerGitApi(ctx: Context, config: GitApiConfig): void {
  const webServer = ctx.get('webServer')
  if (webServer === undefined) return

  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      const url = new URL(request.url ?? '/', 'http://localhost')
      const controller = new AbortController()
      // The browser aborting the fetch closes the response; the git read it
      // started has no reader left, so it ends here too.
      response.on('close', () => {
        if (!response.writableEnded) controller.abort()
      })
      const below = url.pathname.slice(API_PREFIX.length)
      // The editor's files share this prefix but are not git: they are read from this
      // package and answered as they are.
      if (below.startsWith('/vendor/')) {
        await writeVendor(response, below)
        return
      }
      const result = await handleGitApi(
        {
          method: (request.method ?? 'GET').toUpperCase(),
          path: below === '' ? '/' : below,
          query: url.searchParams,
        },
        { ctx, config },
        controller.signal,
      )
      writeJson(response, result.status, result.body)
    },
  }), 'dsh-git: web routes')
}
