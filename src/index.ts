/**
 * dsh-git — a git browser for the DeepSeek Harness Web GUI.
 *
 * The host half answers four read-only questions about the current Session's
 * workspace over `/dsh-git/*`: the working tree's state, a page of history, one
 * commit's files, and the two sides of one change. Everything it reads goes
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
export const inject = ['fs', 'subprocess', 'sessions', 'webServer']

/** Deployment-varying caps, each with a default in {@link apply}. */
export interface Config {
  /** Old- and new-side byte cap for one diff. */
  maxBytes?: number
  /** Commits one history page may return. */
  historyLimit?: number
  /** Changed paths one status answer may return. */
  maxEntries?: number
}

/** The plugin's config, validated before {@link apply} sees it. */
export const Config: z<Config> = z.object({
  maxBytes: z.number().step(1).min(1).max(64 * 1024 * 1024),
  historyLimit: z.number().step(1).min(1).max(500),
  maxEntries: z.number().step(1).min(1).max(20_000),
})

/**
 * Mount the plugin.
 * @param ctx - the host context this plugin was mounted on.
 * @param config - the validated plugin config.
 */
export function apply(ctx: Context, config: Config): void {
  registerGitApi(ctx, {
    maxBytes: config.maxBytes ?? 2 * 1024 * 1024,
    historyLimit: config.historyLimit ?? 50,
    maxEntries: config.maxEntries ?? 2000,
  })
}
