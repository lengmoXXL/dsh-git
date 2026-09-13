/**
 * dsh-git — a git browser for the DeepSeek Harness Web GUI.
 *
 * The host half answers four read-only questions about the current Session's
 * workspace over `/dsh-git/*`: the working tree's state, a page of history, one
 * commit's files, and the aligned text of one change. Everything it reads goes
 * through `ctx.fs` and `ctx.subprocess`, so a deployment that routed those
 * seams to a remote machine answers for that machine without this package
 * knowing anything about the wire.
 *
 * Nothing here mutates a repository. `GIT_OPTIONAL_LOCKS=0` is exported to
 * every child so even `git status` cannot opportunistically rewrite the index.
 *
 * @module dsh-git
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerGitApi } from './api/serve.ts'

/** Plugin name used by the Loader and by diagnostics. */
export const name = 'dsh-git'

/**
 * Services this plugin needs before it activates: the filesystem and subprocess
 * seams it reads through, and the Session store it resolves the workspace from.
 */
export const inject = ['fs', 'subprocess', 'sessions']

/** Deployment-varying caps. Every field has a default in {@link apply}. */
export interface Config {
  /** Old- and new-side line cap for one diff. Defaults to 4000. */
  maxLines?: number
  /** Old- and new-side byte cap for one diff. Defaults to 2 MiB. */
  maxBytes?: number
  /** Commits one history page may return. Defaults to 50. */
  historyLimit?: number
  /** Changed paths one status answer may return. Defaults to 2000. */
  maxEntries?: number
  /** Files one commit's assembled diff may contain. Defaults to 100. */
  maxCommitFiles?: number
  /** Time the diff computer may spend before its answer becomes approximate. Defaults to 2000. */
  maxDiffMs?: number
}

/** Validated plugin config. The defaults live in {@link apply}. */
export const Config: z<Config> = z.object({
  maxLines: z.number().step(1).min(1).max(200_000),
  maxBytes: z.number().step(1).min(1).max(64 * 1024 * 1024),
  historyLimit: z.number().step(1).min(1).max(500),
  maxEntries: z.number().step(1).min(1).max(20_000),
  maxCommitFiles: z.number().step(1).min(1).max(2000),
  maxDiffMs: z.number().step(1).min(1).max(60_000),
})

/**
 * Mount the plugin.
 * @param ctx - the host context this plugin was mounted on.
 * @param config - the validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  registerGitApi(ctx, {
    maxLines: config.maxLines ?? 4000,
    maxBytes: config.maxBytes ?? 2 * 1024 * 1024,
    historyLimit: config.historyLimit ?? 50,
    maxEntries: config.maxEntries ?? 2000,
    maxCommitFiles: config.maxCommitFiles ?? 100,
    maxDiffMs: config.maxDiffMs ?? 2000,
  })
}
