/**
 * The file list of one commit.
 *
 * `git diff-tree` is the plumbing command for exactly this question, and `-z`
 * makes a rename's two paths two whole fields. `-m --first-parent` is what
 * makes a merge commit show the change it brought to its first parent instead
 * of showing nothing, which is the answer a reader browsing history expects.
 *
 * @module dsh-git/git/commit
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommitFile, CommitPayload } from '../shared/wire.ts'
import type { RepoIdentity } from './repo.ts'
import { readCommitSummary } from './history.ts'
import { kindOfLetter } from './status.ts'
import { runGit } from './run.ts'

/** A status token is a letter, optionally followed by a score such as `R100`. */
const STATUS_TOKEN = /^[A-Z]/

/**
 * Parse one `--name-status -z` run.
 *
 * Each record opens with a status token; a rename or copy then carries TWO
 * paths (old, then new) and every other status carries one. Stray whitespace
 * tokens — a `-m` run can leave a newline where a per-commit header would have
 * been — are skipped rather than mistaken for a status.
 *
 * @param output - the raw standard output.
 * @returns every file the run reported.
 */
export function parseNameStatus(output: string): CommitFile[] {
  const files: CommitFile[] = []
  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const raw = fields[i]
    if (raw === undefined) continue
    const status = raw.trim()
    if (!STATUS_TOKEN.test(status)) continue
    const letter = status[0] ?? '?'
    if (letter === 'R' || letter === 'C') {
      const from = fields[i + 1]
      const to = fields[i + 2]
      i += 2
      if (from === undefined || to === undefined) continue
      files.push({ path: to, origPath: from, kind: kindOfLetter(letter) })
      continue
    }
    const path = fields[i + 1]
    i += 1
    if (path === undefined) continue
    files.push({ path, kind: kindOfLetter(letter) })
  }
  return files
}

/** One commit read. */
export interface CommitQuery {
  readonly repo: RepoIdentity
  /** The revision to describe. */
  readonly rev: string
  readonly signal?: AbortSignal | undefined
}

/**
 * Read one commit and the files it changes.
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param query - the repository, the revision, and cancellation.
 * @returns the commit and its file list.
 * @throws GitFailure `git/unknown-revision` when the revision cannot be read.
 */
export async function readCommit(ctx: Context, query: CommitQuery): Promise<CommitPayload> {
  const commit = await readCommitSummary(ctx, query.repo, query.rev, query.signal)
  const result = await runGit(ctx, {
    cwd: query.repo.root,
    argv: [
      'diff-tree',
      '--no-commit-id',
      '--name-status',
      '-r',
      '-z',
      '--root',
      '-m',
      '--first-parent',
      query.rev,
    ],
    ...query.signal === undefined ? {} : { signal: query.signal },
  })
  return { commit, files: result.exitCode === 0 ? parseNameStatus(result.stdout) : [] }
}
