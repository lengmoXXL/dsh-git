/**
 * Reading the commit history.
 *
 * One `git log` run answers a page, and the format is delimiter-based rather
 * than line-based: `%x1f` between fields and `%x1e` between records. A commit
 * subject may contain any character a person can type — tabs, `|`, ` - `, an
 * arrow — so a line-oriented parse would eventually mis-split one, while unit
 * and record separators are control characters git never emits inside a field.
 *
 * @module dsh-git/git/history
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CommitSummary, HistoryPayload } from '../shared/wire.ts'
import type { RepoIdentity } from './repo.ts'
import { GitFailure } from './failure.ts'
import { runGit } from './run.ts'

/**
 * `sha`, `shortSha`, parents, author name, author email, author timestamp,
 * ref names, subject — then a record separator.
 */
const LOG_FORMAT = '%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%at%x1f%D%x1f%s%x1e'

/** Field separator used by {@link LOG_FORMAT}. */
const FIELD = '\x1f'

/** Record separator used by {@link LOG_FORMAT}. */
const RECORD = '\x1e'

/** How many fields {@link LOG_FORMAT} emits per commit. */
const FIELD_COUNT = 8

/**
 * Parse one run of the history command.
 * @param output - the raw standard output.
 * @returns every complete record, newest first.
 */
export function parseLog(output: string): CommitSummary[] {
  const commits: CommitSummary[] = []
  for (const raw of output.split(RECORD)) {
    // `git log` writes a newline after each formatted record, so every record
    // but the first carries it as a prefix.
    const record = raw.replace(/^\n+/, '')
    if (record === '') continue
    const parts = record.split(FIELD)
    if (parts.length < FIELD_COUNT) continue
    const [sha, shortSha, parents, authorName, authorEmail, authoredAt, refs, subject] = parts
    if (sha === undefined || shortSha === undefined || subject === undefined) continue
    commits.push({
      sha,
      shortSha,
      parents: (parents ?? '').split(' ').filter(part => part !== ''),
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      authoredAt: Number(authoredAt ?? '0'),
      refs: (refs ?? '').split(', ').filter(part => part !== ''),
      subject,
    })
  }
  return commits
}

/** One history read. */
export interface HistoryQuery {
  /** The repository to read. */
  readonly repo: RepoIdentity
  /** Commits to return. */
  readonly limit: number
  /** Commits to skip, for paging. */
  readonly skip: number
  /** Caller cancellation. */
  readonly signal?: AbortSignal | undefined
}

/**
 * Read one page of the commit history.
 *
 * An unborn HEAD (a repository with no commits yet) is an empty history rather
 * than a failure, which is the state a freshly `git init`-ed workspace is in.
 *
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param query - the repository, the page window, and cancellation.
 * @returns the page and whether more commits exist below it.
 */
export async function readHistory(ctx: Context, query: HistoryQuery): Promise<HistoryPayload> {
  const result = await runGit(ctx, {
    cwd: query.repo.root,
    argv: [
      'log',
      `--format=${LOG_FORMAT}`,
      // Fully qualified refs, so the panel tells a local branch from a remote
      // one by its prefix rather than by counting slashes in its name.
      '--decorate=full',
      '-n', String(query.limit + 1),
      `--skip=${String(query.skip)}`,
    ],
    ...query.signal === undefined ? {} : { signal: query.signal },
  })
  // No commits yet: git exits non-zero and prints nothing.
  if (result.exitCode !== 0 && result.stdout.trim() === '') return { commits: [], hasMore: false }
  const commits = parseLog(result.stdout)
  const hasMore = commits.length > query.limit
  return { commits: hasMore ? commits.slice(0, query.limit) : commits, hasMore }
}

/**
 * Read exactly one commit's metadata.
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param repo - the repository to read.
 * @param rev - the revision to describe.
 * @param signal - caller cancellation.
 * @returns the commit.
 * @throws GitFailure `git/unknown-revision` when the revision cannot be read.
 */
export async function readCommitSummary(
  ctx: Context,
  repo: RepoIdentity,
  rev: string,
  signal?: AbortSignal,
): Promise<CommitSummary> {
  const result = await runGit(ctx, {
    cwd: repo.root,
    argv: ['log', '-n', '1', `--format=${LOG_FORMAT}`, rev, '--'],
    ...signal === undefined ? {} : { signal },
  })
  const commits = parseLog(result.stdout)
  const commit = commits[0]
  if (commit === undefined) {
    throw new GitFailure('git/unknown-revision', `no commit matches "${rev}"`)
  }
  return commit
}
