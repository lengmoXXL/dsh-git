/**
 * Reading the working tree's state, and the parser that turns git's own
 * `--porcelain=v2` output into it.
 *
 * `--porcelain=v2` is chosen over v1 because it reports the branch facts in the
 * same call and states the index and working-tree status as separate letters,
 * which is exactly the split the panel groups by. `-z` is chosen because it is
 * the only spelling that survives a path containing a newline or a quote, and
 * because it makes a rename's two paths two whole fields instead of one
 * unparseable `old -> new` string.
 *
 * A file changed in both halves appears twice — once per stage — because the
 * two changes are separately diffable, which is what the reader wants to click.
 *
 * @module dsh-git/git/status
 */

import type { Context } from '@deepseek-ai/cordis'
import type {
  BranchStatus,
  ChangeEntry,
  ChangeKind,
  StatusPayload,
} from '../shared/wire.ts'
import type { RepoIdentity } from './repo.ts'
import { runGit } from './run.ts'

/** One parsed `git status` read. */
export interface ParsedStatus {
  /** Branch facts from the `# branch.*` header records. */
  readonly branch: BranchStatus
  /** Every changed path, in git's own order. */
  readonly entries: readonly ChangeEntry[]
}

/**
 * A branch status while it is being built. The wire type is readonly, so the
 * parser accumulates here and the header records fill it in place.
 */
interface MutableBranchStatus {
  branch: string | null
  detached: boolean
  oid: string | null
  upstream: string | null
  ahead: number
  behind: number
}

/** A branch status before any header record was read. */
function emptyBranch(): MutableBranchStatus {
  return { branch: null, detached: false, oid: null, upstream: null, ahead: 0, behind: 0 }
}

/**
 * What one status letter means. Shared with the commit file list, which uses
 * the same `A`/`M`/`D`/`R`/`C`/`T` alphabet.
 * @param code - a status letter from an XY field or a name-status record.
 * @returns the change kind, `unknown` for a letter git has not taught us.
 */
export function kindOfLetter(code: string): ChangeKind {
  switch (code) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'copied'
    case 'T': return 'typechange'
    default: return 'unknown'
  }
}

/**
 * Append the entries one XY pair describes.
 *
 * A `.` on a side is "unchanged on that side" and contributes nothing; both
 * sides contribute when both changed.
 * @param entries - the accumulator.
 * @param path - the new-side path.
 * @param xy - the two status letters.
 * @param origPath - the old-side path of a rename or copy, when there is one.
 */
function appendEntries(
  entries: ChangeEntry[],
  path: string,
  xy: string,
  origPath: string | undefined,
): void {
  const index = xy[0] ?? '.'
  const worktree = xy[1] ?? '.'
  const base = origPath === undefined ? { path } : { path, origPath }
  if (index !== '.') {
    entries.push({ ...base, index, worktree, kind: kindOfLetter(index), stage: 'staged' })
  }
  if (worktree !== '.') {
    entries.push({ ...base, index, worktree, kind: kindOfLetter(worktree), stage: 'unstaged' })
  }
}

/**
 * Fold one `# branch.*` header record into the branch status.
 * @param field - the header record without its `# ` prefix.
 * @param branch - the accumulator, mutated in place.
 */
function applyBranchHeader(field: string, branch: MutableBranchStatus): void {
  const separator = field.indexOf(' ')
  const key = separator < 0 ? field : field.slice(0, separator)
  const value = separator < 0 ? '' : field.slice(separator + 1)
  switch (key) {
    case 'branch.oid':
      if (value !== '(initial)') branch.oid = value
      break
    case 'branch.head':
      if (value === '(detached)') branch.detached = true
      else branch.branch = value
      break
    case 'branch.upstream':
      branch.upstream = value
      break
    case 'branch.ab': {
      const match = /^\+(\d+)\s+-(\d+)$/.exec(value)
      if (match !== null) {
        branch.ahead = Number(match[1])
        branch.behind = Number(match[2])
      }
      break
    }
    default:
      break
  }
}

/**
 * Parse one `git status --porcelain=v2 --branch -z` run.
 *
 * Records are NUL-terminated, so the output is split on NUL and walked with an
 * index rather than mapped: a rename record's old path is the field AFTER it,
 * which is what makes this a loop instead of a map.
 *
 * @param output - the raw standard output of the status command.
 * @returns the branch facts and every changed path.
 */
export function parsePorcelainV2(output: string): ParsedStatus {
  const branch = emptyBranch()
  const entries: ChangeEntry[] = []

  const fields = output.split('\0')
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i]
    if (field === undefined || field === '') continue
    const kind = field[0]
    if (kind === '#') {
      applyBranchHeader(field.slice(2), branch)
      continue
    }
    if (kind === '1') {
      const parts = field.split(' ')
      if (parts.length < 9) continue
      appendEntries(entries, parts.slice(8).join(' '), parts[1] ?? '..', undefined)
      continue
    }
    if (kind === '2') {
      const parts = field.split(' ')
      const origPath = fields[i + 1]
      i += 1
      if (parts.length < 10 || origPath === undefined) continue
      appendEntries(entries, parts.slice(9).join(' '), parts[1] ?? '..', origPath)
      continue
    }
    if (kind === 'u') {
      const parts = field.split(' ')
      if (parts.length < 11) continue
      const path = parts.slice(10).join(' ')
      const xy = parts[1] ?? 'UU'
      entries.push({
        path,
        index: xy[0] ?? 'U',
        worktree: xy[1] ?? 'U',
        kind: 'conflicted',
        stage: 'conflicted',
      })
      continue
    }
    if (kind === '?') {
      entries.push({
        path: field.slice(2),
        index: '?',
        worktree: '?',
        kind: 'untracked',
        stage: 'untracked',
      })
    }
    // `!` records only appear with --ignored, which this reader never asks for.
  }

  return { branch, entries }
}

/** One working-tree read. */
export interface StatusQuery {
  readonly repo: RepoIdentity
  /** Cap on returned entries; the rest are dropped and the payload says so. */
  readonly limit: number
  readonly signal?: AbortSignal | undefined
}

/**
 * Read the working tree's state.
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param query - the repository, the entry cap, and cancellation.
 * @returns the repository, its branch facts, and its changed paths.
 */
export async function readStatus(ctx: Context, query: StatusQuery): Promise<StatusPayload> {
  const result = await runGit(ctx, {
    cwd: query.repo.root,
    argv: ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all'],
    ...query.signal === undefined ? {} : { signal: query.signal },
  })
  const parsed = parsePorcelainV2(result.stdout)
  return {
    repo: { root: query.repo.root, name: query.repo.name, branch: parsed.branch },
    entries: parsed.entries.slice(0, query.limit),
    truncated: parsed.entries.length > query.limit,
  }
}
