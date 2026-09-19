/**
 * The four read-only endpoints of the git API, as a function of a normalized
 * request.
 *
 * Each function validates its own parameters, resolves the repository, calls the
 * git readers, and returns a payload — all without opening a socket. The route
 * table that reaches them and the mapping from a failure to an HTTP status live
 * in routes.ts.
 *
 * @module dsh-git/api/endpoints
 */

import type { CommitPayload, DiffPayload, DiffSource, HistoryPayload, RepoIdentity, StatusPayload } from './wire.ts'
import type { GitApiDeps } from './routes.ts'
import { readCommit } from '../git/commit.ts'
import { GitFailure } from '../git/failure.ts'
import { readHistory } from '../git/history.ts'
import { confineToRepo, discoverRepo, resolveWorkspaceRoot } from '../git/repo.ts'
import { readRevisionTexts } from '../git/revision.ts'
import { readStatus } from '../git/status.ts'

/** The comparison pairs a diff request may name. */
const SOURCES: readonly DiffSource[] = ['worktree', 'index', 'commit']

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
async function requireRepo(deps: GitApiDeps, query: URLSearchParams, signal?: AbortSignal): Promise<RepoIdentity> {
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
export async function handleStatus(
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
export async function handleHistory(
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
export async function handleCommit(
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
export async function handleDiff(
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
  const texts = await readRevisionTexts(deps.ctx, {
    repoRoot: repo.root,
    path,
    ...origPath === undefined ? {} : { origPath },
    ...source === 'commit' ? { source, rev: readRequired(query, 'rev') } : { source },
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
