/**
 * Running one git command through the execution-world seam.
 *
 * Every repository read in this package goes through here, which is what makes
 * the panel remote-correct: `ctx.subprocess` belongs to whichever execution
 * world the deployment composed, so a routed (remote) provider answers for a
 * cwd its own store owns, and this module never assumes a local filesystem.
 *
 * Three deliberate properties:
 *
 * - The executable is RESOLVED, not assumed. A remote world has its own PATH,
 *   so the absolute path to `git` is a fact that world must supply.
 * - `GIT_OPTIONAL_LOCKS=0` is exported to every child. Browsing is read-only
 *   work, and this keeps `git status` from opportunistically rewriting the
 *   index — a viewer must not move the user's repository state.
 * - Output is collected, never streamed. `readFrom(0)` after `done` is the
 *   documented read point for every batch consumer, and a truncated collection
 *   is reported as such rather than silently shortened.
 *
 * @module dsh-git/git/run
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { GitFailure } from './failure.ts'

/** Grace the provider's termination procedure gets when a read is cancelled. */
const GIT_GRACE_MS = 5_000

/** Default in-memory cap on one command's standard output. */
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024

/** One git invocation. */
export interface GitRunRequest {
  /** Working directory for the child; always a repository root in this package. */
  readonly cwd: string
  /** Arguments after the package's fixed global flags; `argv[0]` is the subcommand. */
  readonly argv: readonly string[]
  /** Caller cancellation, which starts the provider's termination procedure. */
  readonly signal?: AbortSignal | undefined
  /** In-memory cap on collected stdout; defaults to {@link DEFAULT_MAX_BYTES}. */
  readonly maxBytes?: number | undefined
}

/** What one finished git invocation produced. */
export interface GitRunResult {
  /** Exit code, or null when the child died from a signal. */
  readonly exitCode: number | null
  /** Collected standard output. */
  readonly stdout: string
  /** The stdout cap dropped the head of the stream, so `stdout` is a tail. */
  readonly stdoutTruncated: boolean
}

/** Describe an unknown thrown value: an Error's message, or its string form. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Run one git command to completion and collect its output.
 *
 * Only transport failures throw: a non-zero exit is returned as an outcome,
 * because callers here routinely ask questions whose answer is "no" (`git show`
 * of a path that does not exist in a revision, `rev-parse` outside a
 * repository).
 *
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param request - the invocation to run.
 * @returns the exit facts and both collected streams.
 * @throws GitFailure `git/unavailable` when git cannot be resolved or started.
 */
export async function runGit(ctx: Context, request: GitRunRequest): Promise<GitRunResult> {
  const { cwd, argv, signal, maxBytes = DEFAULT_MAX_BYTES } = request

  let executable: string
  try {
    executable = await ctx.subprocess.resolveExecutable('git', undefined, signal)
  } catch (error: unknown) {
    throw new GitFailure(
      'git/unavailable',
      `git is not available in this execution world: ${messageOf(error)}`,
      { cause: error },
    )
  }

  let handle: SubprocessHandle
  try {
    handle = ctx.subprocess.spawn({
      argv: [
        executable,
        '--no-pager',
        '-c', 'core.quotepath=false',
        '-c', 'color.ui=false',
        ...argv,
      ],
      cwd,
      // A viewer must not refresh or rewrite the repository's index.
      env: { GIT_OPTIONAL_LOCKS: '0' },
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes },
        // Kept to one byte: nothing reads a git diagnostic, but a pipe nobody drains
        // is a child that can block writing to a full one.
        stderr: { maxBytes: 1 },
      },
      graceMs: GIT_GRACE_MS,
      ...signal === undefined ? {} : { signal },
    } satisfies SubprocessSpawnSpec)
  } catch (error: unknown) {
    throw new GitFailure('git/unavailable', `git could not be started: ${messageOf(error)}`, { cause: error })
  }

  let exitCode: number | null
  try {
    exitCode = (await handle.done).exitCode
  } catch (error: unknown) {
    throw new GitFailure('git/command-failed', `git reported no outcome: ${messageOf(error)}`, { cause: error })
  }

  const stdout = handle.collected.stdout?.readFrom(0)
  return {
    exitCode,
    stdout: stdout?.text ?? '',
    stdoutTruncated: stdout?.lossy ?? false,
  }
}
