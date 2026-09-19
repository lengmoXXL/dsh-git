/**
 * The git API's route table, its parameter validation, and its failure mapping.
 *
 * Rules and transport are separate halves of this package's HTTP surface, in
 * that order: this module turns a normalized request into a status and a JSON
 * body without opening a socket, so every branch below is reachable from a test.
 * What each endpoint does is endpoints.ts; reading the URL and writing the
 * response is serve.ts.
 *
 * The workspace is resolved from the Session identity on the host, never from a
 * path the browser supplies, and every path that does arrive from the browser
 * is confined to the repository root before it reaches a git command.
 *
 * @module dsh-git/api/routes
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ErrorPayload } from './wire.ts'
import { GitFailure } from '../git/failure.ts'
import { handleCommit, handleDiff, handleHistory, handleStatus } from './endpoints.ts'

/** The caps this deployment was configured with. */
export interface GitApiConfig {
  readonly maxBytes: number
  readonly historyLimit: number
  readonly maxEntries: number
}

/** One normalized request, already routed to this API's prefix. */
export interface GitApiRequest {
  /** Upper-case HTTP method. */
  readonly method: string
  /** Path below the API prefix; always starts with `/`. */
  readonly path: string
  /** Parsed query string. */
  readonly query: URLSearchParams
}

/** One normalized response. */
export interface GitApiResponse {
  /** HTTP status code. */
  readonly status: number
  /** JSON-serializable body. */
  readonly body: unknown
}

/** What the handler needs from the plugin. */
export interface GitApiDeps {
  /** The host context carrying `ctx.fs`, `ctx.subprocess`, and `ctx.sessions`. */
  readonly ctx: Context
  /** The deployment's caps. */
  readonly config: GitApiConfig
}

/**
 * The HTTP status one failure code answers with.
 *
 * A missing repository and an unknown revision are both "not here" (404), a
 * malformed or unconfined request is the caller's fault (400), an unavailable
 * git is transient and belongs to the deployment (503), and a failed git
 * command is an unexpected host condition (500).
 * @param code - the failure code.
 * @returns the status to answer with.
 */
function statusFor(code: string): number {
  switch (code) {
    case 'session/unknown':
    case 'git/bad-request':
    case 'git/path-outside-repo':
      return 400
    case 'git/not-a-repository':
    case 'git/unknown-revision':
      return 404
    case 'git/unavailable':
      return 503
    default:
      return 500
  }
}

/**
 * Handle one request against this API's prefix.
 * @param request - the normalized request.
 * @param deps - the handler's context and caps.
 * @param signal - caller cancellation, tied to the response's lifetime.
 * @returns the status and body to write.
 */
export async function handleGitApi(
  request: GitApiRequest,
  deps: GitApiDeps,
  signal?: AbortSignal,
): Promise<GitApiResponse> {
  try {
    if (request.method !== 'GET') {
      return { status: 405, body: { code: 'git/bad-request', message: 'only GET is supported' } }
    }
    switch (request.path) {
      case '/status':
        return { status: 200, body: await handleStatus(deps, request.query, signal) }
      case '/history':
        return { status: 200, body: await handleHistory(deps, request.query, signal) }
      case '/commit':
        return { status: 200, body: await handleCommit(deps, request.query, signal) }
      case '/diff':
        return { status: 200, body: await handleDiff(deps, request.query, signal) }
      default:
        return {
          status: 404,
          body: { code: 'git/bad-request', message: `no such endpoint: ${request.path}` },
        }
    }
  } catch (error: unknown) {
    if (error instanceof GitFailure) {
      const body: ErrorPayload = { code: error.code, message: error.message }
      return { status: statusFor(error.code), body }
    }
    const body: ErrorPayload = {
      code: 'git/command-failed',
      message: error instanceof Error ? error.message : String(error),
    }
    return { status: 500, body }
  }
}
