/**
 * The `/dsh-git` request handler, as a function of a normalized request.
 *
 * Rules and transport are separate halves of this package's HTTP surface, in
 * that order: this module validates parameters, resolves the repository,
 * calls the git readers, and returns a status plus a JSON body — all without
 * opening a socket. `serve.ts` owns only reading the URL and writing the
 * response, which is what makes every branch below reachable from a test.
 *
 * The workspace is resolved from the Session identity on the host, never from a
 * path the browser supplies, and every path that does arrive from the browser
 * is confined to the repository root before it reaches a git command.
 *
 * @module dsh-git/api/handler
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  CommitPayload,
  DiffPayload,
  DiffSource,
  ErrorPayload,
  HistoryPayload,
  StatusPayload,
} from '../shared/wire.ts'
import { readCommit } from '../git/commit.ts'
import { GitFailure } from '../git/failure.ts'
import { readHistory } from '../git/history.ts'
import { confineToRepo, discoverRepo, resolveWorkspaceRoot } from '../git/repo.ts'
import { readRevisionTexts } from '../git/revision.ts'
import { readStatus } from '../git/status.ts'

/** Deployment-varying caps on one answer. */
export interface GitApiConfig {
  /** Old- and new-side byte cap for one diff. */
  readonly maxBytes: number
  /** Commits one history page may return. */
  readonly historyLimit: number
  /** Changed paths one status answer may return. */
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

/** The comparison pairs a diff request may name. */
const SOURCES: readonly DiffSource[] = ['worktree', 'index', 'commit']

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
 * Read a non-negative integer parameter.
 * @param query - the request's query string.
 * @param name - the parameter to read.
 * @param fallback - the value to use when the parameter is absent.
 * @returns the parsed value.
 * @throws GitFailure `git/bad-request` when the parameter is present but malformed.
 */
function readCount(query: URLSearchParams, name: string, fallback: number): number {
  const raw = query.get(name)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new GitFailure('git/bad-request', `"${name}" must be a non-negative integer`)
  }
  return value
}

/**
 * Read a required string parameter.
 * @param query - the request's query string.
 * @param name - the parameter to read.
 * @returns the value.
 * @throws GitFailure `git/bad-request` when it is absent or blank.
 */
function readRequired(query: URLSearchParams, name: string): string {
  const value = query.get(name)
  if (value === null || value.trim() === '') {
    throw new GitFailure('git/bad-request', `"${name}" is required`)
  }
  return value
}

/**
 * Resolve the repository for one request.
 * @param deps - the handler's context and caps.
 * @param query - the request's query string.
 * @param signal - caller cancellation.
 * @returns the repository identity.
 * @throws GitFailure `session/unknown` when no identity was supplied, or
 * `git/not-a-repository` when the workspace is not a working tree.
 */
async function requireRepo(deps: GitApiDeps, query: URLSearchParams, signal?: AbortSignal) {
  const workspaceRoot = await resolveWorkspaceRoot(deps.ctx, query.get('sessionId'))
  const repo = await discoverRepo(deps.ctx, workspaceRoot, signal)
  if (repo === null) {
    throw new GitFailure('git/not-a-repository', `"${workspaceRoot}" is not inside a git repository`)
  }
  return repo
}

/**
 * Answer `GET /status`.
 *
 * A workspace that is not a repository is an ordinary answer here — the panel
 * draws its empty state — so this endpoint never raises
 * `git/not-a-repository`.
 * @param deps - the handler's context and caps.
 * @param query - the request's query string.
 * @param signal - caller cancellation.
 * @returns the status payload.
 */
async function handleStatus(
  deps: GitApiDeps,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<StatusPayload> {
  const workspaceRoot = await resolveWorkspaceRoot(deps.ctx, query.get('sessionId'))
  const repo = await discoverRepo(deps.ctx, workspaceRoot, signal)
  if (repo === null) return { repo: null, entries: [], truncated: false }
  // Options are conditionally spread throughout this file rather than passed as
  // `undefined`: `exactOptionalPropertyTypes` tells an absent field from an
  // undefined one, and widening the readers' types to accept both would soften
  // the contract this module is the boundary of.
  return await readStatus(deps.ctx, {
    repo,
    limit: deps.config.maxEntries,
    ...signal === undefined ? {} : { signal },
  })
}

/**
 * Answer `GET /history`.
 * @param deps - the handler's context and caps.
 * @param query - the request's query string.
 * @param signal - caller cancellation.
 * @returns the history page.
 */
async function handleHistory(
  deps: GitApiDeps,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<HistoryPayload> {
  const repo = await requireRepo(deps, query, signal)
  const requested = readCount(query, 'limit', deps.config.historyLimit)
  return await readHistory(deps.ctx, {
    repo,
    limit: Math.min(requested, deps.config.historyLimit),
    skip: readCount(query, 'skip', 0),
    ...signal === undefined ? {} : { signal },
  })
}

/**
 * Answer `GET /commit`.
 * @param deps - the handler's context and caps.
 * @param query - the request's query string.
 * @param signal - caller cancellation.
 * @returns the commit and its files.
 */
async function handleCommit(
  deps: GitApiDeps,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<CommitPayload> {
  const repo = await requireRepo(deps, query, signal)
  return await readCommit(deps.ctx, {
    repo,
    rev: readRequired(query, 'rev'),
    ...signal === undefined ? {} : { signal },
  })
}

/**
 * Answer `GET /diff`.
 * @param deps - the handler's context and caps.
 * @param query - the request's query string.
 * @param signal - caller cancellation.
 * @returns the change's two sides.
 */
async function handleDiff(
  deps: GitApiDeps,
  query: URLSearchParams,
  signal?: AbortSignal,
): Promise<DiffPayload> {
  const repo = await requireRepo(deps, query, signal)
  const path = confineToRepo(query.get('path'))
  const rawOrig = query.get('origPath')
  const origPath = rawOrig === null ? undefined : confineToRepo(rawOrig)
  const rawSource = query.get('source') ?? 'worktree'
  const source = SOURCES.find(candidate => candidate === rawSource)
  if (source === undefined) {
    throw new GitFailure('git/bad-request', `"source" must be one of ${SOURCES.join(', ')}`)
  }
  const rev = source === 'commit' ? readRequired(query, 'rev') : query.get('rev') ?? undefined
  const texts = await readRevisionTexts(deps.ctx, {
    repoRoot: repo.root,
    path,
    ...origPath === undefined ? {} : { origPath },
    source,
    ...rev === undefined ? {} : { rev },
    maxBytes: deps.config.maxBytes,
    ...signal === undefined ? {} : { signal },
  })
  return {
    path,
    ...origPath === undefined ? {} : { origPath },
    source,
    oldLabel: texts.oldLabel,
    newLabel: texts.newLabel,
    binary: texts.binary,
    truncated: texts.truncated,
    oldText: texts.oldText,
    newText: texts.newText,
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
