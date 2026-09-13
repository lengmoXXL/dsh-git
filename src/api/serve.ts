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

import type { IncomingMessage, ServerResponse } from 'node:http'
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
