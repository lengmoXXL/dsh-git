/**
 * Where the panel's repository is, and which paths it may name.
 *
 * The workspace root is derived exactly the way the platform's other
 * workspace-scoped readers derive it: from the selected Session's header, with
 * the deployment's sandbox-policy root as the no-cwd fallback. That keeps the
 * panel showing the same repository the file tools and the workspace file
 * reader are working in, including after a reload that rehydrated a stored
 * Session rather than a live one.
 *
 * Path confinement is the second half. The browser only ever sends back paths
 * git itself printed, so this is defence in depth rather than the primary
 * boundary — but a repository-relative path with a `..` segment or an absolute
 * spelling is refused rather than handed to a git command.
 *
 * @module dsh-git/git/repo
 */

import { basename } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the persistence plugin's Context merge (ctx.sessionPersistence),
// which is how a Session the host is not running still names its workspace.
import type {} from '@deepseek-ai/dsh-session-persistence'
import type { RepoIdentity } from '../shared/wire.ts'
import { GitFailure } from './failure.ts'
import { runGit } from './run.ts'

/** Standard error of a `rev-parse` inside a repository is never interesting. */
const REV_PARSE_MAX_BYTES = 64 * 1024

/**
 * The workspace root for one Session identity.
 *
 * A live Session answers from its own header. A Session the host is not
 * currently running does not: the browser can name any Session it is showing,
 * including one restored from disk that no fiber has entered, so the persisted
 * header is consulted next. Both routes lead to the same `cwd`, which is the
 * point — the answer must not depend on whether the Session happens to be live.
 *
 * Falling back to the deployment's workspace root is deliberately NOT done for
 * an unrecognized identity. That fallback belongs to a Session whose header has
 * no `cwd`; using it for an identity nobody knows would silently show a
 * different repository than the one the reader is looking at, and a wrong
 * repository is worse than a refusal.
 *
 * @param ctx - the host context carrying `ctx.sessions`.
 * @param sessionId - the identity the browser supplied.
 * @returns the absolute workspace root.
 * @throws GitFailure `session/unknown` when no identity was supplied, or when
 * neither a live nor a persisted header names a workspace.
 */
export async function resolveWorkspaceRoot(ctx: Context, sessionId: string | null): Promise<string> {
  if (sessionId === null || sessionId.trim() === '') {
    throw new GitFailure('session/unknown', 'no session identity was supplied, so the workspace is unknown')
  }
  const identity = sessionId as SessionId
  const live = ctx.sessions.get(identity)?.header
  const stored = live === undefined
    ? await ctx.get('sessionPersistence')?.stat(identity)
    : undefined
  const cwd = (live ?? stored?.header)?.cwd
  if (cwd === undefined || cwd === '') {
    throw new GitFailure('session/unknown', `session "${sessionId}" is unknown, so its workspace is too`)
  }
  return cwd
}

/**
 * Find the repository owning a directory.
 *
 * A directory outside any repository is a legitimate answer, not a failure:
 * the panel draws a "no repository" state for it.
 *
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param cwd - the directory to ask about.
 * @param signal - caller cancellation.
 * @returns the repository identity, or null when there is none.
 */
export async function discoverRepo(
  ctx: Context,
  cwd: string,
  signal?: AbortSignal,
): Promise<RepoIdentity | null> {
  const result = await runGit(ctx, {
    cwd,
    argv: ['rev-parse', '--show-toplevel'],
    maxBytes: REV_PARSE_MAX_BYTES,
    ...signal === undefined ? {} : { signal },
  })
  if (result.exitCode !== 0) return null
  const root = result.stdout.trim()
  if (root === '') return null
  return { root, name: basename(root) }
}

/**
 * Normalize a browser-supplied path to a repository-relative POSIX path.
 *
 * Refuses absolute spellings (POSIX and Windows), any `..` segment, and the
 * empty path. Redundant `.` segments and repeated separators are folded away.
 *
 * @param requested - the path as the browser sent it.
 * @returns the normalized repository-relative path.
 * @throws GitFailure `git/path-outside-repo` when the path is not confined.
 */
export function confineToRepo(requested: string | null): string {
  if (requested === null || requested === '' || requested.includes('\0')) {
    throw new GitFailure('git/path-outside-repo', 'a repository-relative path is required')
  }
  // Windows spellings arrive both ways; backslashes are separators here.
  const unified = requested.replace(/\\/g, '/')
  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) {
    throw new GitFailure('git/path-outside-repo', `"${requested}" is not a repository-relative path`)
  }
  const segments: string[] = []
  for (const segment of unified.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      throw new GitFailure('git/path-outside-repo', `"${requested}" escapes the repository root`)
    }
    segments.push(segment)
  }
  if (segments.length === 0) {
    throw new GitFailure('git/path-outside-repo', `"${requested}" is not a repository-relative path`)
  }
  return segments.join('/')
}
