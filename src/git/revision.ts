/**
 * Acquiring both sides of a diff.
 *
 * Three comparison pairs are supported, and each names its sides the way a
 * reader thinks about them:
 *
 * - `worktree` — the index against the working tree (an unstaged change),
 * - `index` — HEAD against the index (a staged change),
 * - `commit` — a commit against its first parent.
 *
 * Blobs come from git (`git show <rev>:<path>`) while the working-tree side
 * comes from `ctx.fs`, so both halves of a working change are read through the
 * composed execution world and a routed (remote) deployment needs no special
 * case here.
 *
 * A side that does not exist is empty text, not an error: that is what an added
 * or deleted file looks like, and it is also what a root commit's parent looks
 * like. Binary and over-cap sides are reported as flags so the panel can say so
 * instead of drawing nonsense.
 *
 * @module dsh-git/git/revision
 */

import type { Context } from '@deepseek-ai/cordis'
import { FsError } from '@deepseek-ai/dsh-fs'
import type { DiffSource } from '../shared/wire.ts'
import { runGit } from './run.ts'

/** One side of a comparison, before labels are attached. */
interface SideText {
  /** The side's whole text; empty when it does not exist or is binary. */
  readonly text: string
  /** Whether the side exists at all. */
  readonly present: boolean
  /** The side was cut at its cap. */
  readonly truncated: boolean
  /** The side is not text. */
  readonly binary: boolean
}

/** An absent side. */
const ABSENT: SideText = { text: '', present: false, truncated: false, binary: false }

/** A side that exists but cannot be shown. */
function unusable(reason: 'binary' | 'truncated'): SideText {
  return reason === 'binary'
    ? { text: '', present: true, truncated: false, binary: true }
    : { text: '', present: true, truncated: true, binary: false }
}

/** One diff acquisition. */
export interface RevisionRequest {
  /** Absolute path of the working-tree root; the cwd of every git call here. */
  readonly repoRoot: string
  /** Repository-relative path of the new side. */
  readonly path: string
  /** Repository-relative path of the old side, when the change is a rename. */
  readonly origPath?: string | undefined
  /** Which comparison pair to read. */
  readonly source: DiffSource
  /** The commit to read, required when `source` is `commit`. */
  readonly rev?: string | undefined
  readonly signal?: AbortSignal | undefined
  /** Per-side cap on the text a blob read may collect. */
  readonly maxBytes: number
}

/** Both sides of one comparison, ready to align. */
export interface RevisionTexts {
  readonly oldText: string
  readonly newText: string
  readonly oldLabel: string
  readonly newLabel: string
  readonly oldPresent: boolean
  readonly newPresent: boolean
  readonly binary: boolean
  readonly truncated: boolean
}

/**
 * Read one blob out of a revision or the index.
 *
 * A spec such as `HEAD:src/a.ts` or `:src/a.ts` names a path inside a tree, so
 * a non-zero exit is the ordinary "that path is not there" answer rather than a
 * failure worth raising.
 *
 * @param ctx - the host context carrying `ctx.subprocess`.
 * @param repoRoot - absolute working-tree root, used as cwd.
 * @param spec - the revision-and-path spec to show.
 * @param signal - caller cancellation.
 * @param maxBytes - collected-output cap for this read.
 * @returns the blob as text, or an absent side.
 */
async function showBlob(
  ctx: Context,
  repoRoot: string,
  spec: string,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<SideText> {
  const result = await runGit(ctx, {
    cwd: repoRoot,
    argv: ['show', spec],
    maxBytes,
    ...signal === undefined ? {} : { signal },
  })
  if (result.exitCode !== 0) return ABSENT
  if (result.stdoutTruncated) return unusable('truncated')
  if (result.stdout.includes('\0')) return unusable('binary')
  return { text: result.stdout, present: true, truncated: false, binary: false }
}

/**
 * Read the working-tree side of a change through `ctx.fs`.
 *
 * The size is checked before the read so an enormous file is never pulled into
 * memory, and the filesystem's own typed errors are what classify the rest: a
 * binary file and an over-cap file are both "present but not comparable", while
 * a missing path is an absent side.
 *
 * @param ctx - the host context carrying `ctx.fs`.
 * @param repoRoot - absolute working-tree root, used as the resolution base.
 * @param path - repository-relative path to read.
 * @param signal - caller cancellation.
 * @param maxBytes - cap on a readable file's size.
 * @returns the file as text, or a side that exists but cannot be shown.
 */
async function readWorktreeFile(
  ctx: Context,
  repoRoot: string,
  path: string,
  signal: AbortSignal | undefined,
  maxBytes: number,
): Promise<SideText> {
  const info = await ctx.fs.lstat(path, { cwd: repoRoot }, signal)
  if (info === undefined || info.type !== 'file') return ABSENT
  if (info.size !== undefined && info.size > maxBytes) return unusable('truncated')
  const target = await ctx.fs.resolve(path, { cwd: repoRoot, ...signal === undefined ? {} : { signal } })
  try {
    const text = await ctx.fs.readText(target, signal)
    return text.includes('\0')
      ? unusable('binary')
      : { text, present: true, truncated: false, binary: false }
  } catch (error: unknown) {
    if (error instanceof FsError) {
      if (error.code === 'FS_NOT_TEXT') return unusable('binary')
      if (error.code === 'FS_TOO_LARGE') return unusable('truncated')
      if (error.code === 'FS_NOT_FOUND' || error.code === 'FS_NOT_REGULAR_FILE') return ABSENT
    }
    throw error
  }
}

/**
 * Read both sides of one change.
 * @param ctx - the host context carrying `ctx.fs` and `ctx.subprocess`.
 * @param request - the comparison to read.
 * @returns both sides' text, their labels, and their comparability flags.
 */
export async function readRevisionTexts(
  ctx: Context,
  request: RevisionRequest,
): Promise<RevisionTexts> {
  const { repoRoot, path, origPath, source, rev, signal, maxBytes } = request
  const oldPath = origPath ?? path

  let oldSide: SideText
  let newSide: SideText
  let oldLabel: string
  let newLabel: string

  if (source === 'worktree') {
    oldSide = await showBlob(ctx, repoRoot, `:${oldPath}`, signal, maxBytes)
    // A conflicted path has no stage-0 entry; the "ours" stage is the closest
    // thing to an old side and keeps the diff meaningful.
    if (!oldSide.present) {
      oldSide = await showBlob(ctx, repoRoot, `:2:${oldPath}`, signal, maxBytes)
    }
    newSide = await readWorktreeFile(ctx, repoRoot, path, signal, maxBytes)
    oldLabel = 'index'
    newLabel = 'working tree'
  } else if (source === 'index') {
    oldSide = await showBlob(ctx, repoRoot, `HEAD:${oldPath}`, signal, maxBytes)
    newSide = await showBlob(ctx, repoRoot, `:${path}`, signal, maxBytes)
    oldLabel = 'HEAD'
    newLabel = 'index'
  } else {
    const revision = rev ?? 'HEAD'
    oldSide = await showBlob(ctx, repoRoot, `${revision}^:${oldPath}`, signal, maxBytes)
    newSide = await showBlob(ctx, repoRoot, `${revision}:${path}`, signal, maxBytes)
    oldLabel = `${revision}^`
    newLabel = revision
  }

  const binary = oldSide.binary || newSide.binary
  return {
    oldText: binary ? '' : oldSide.text,
    newText: binary ? '' : newSide.text,
    oldLabel,
    newLabel,
    oldPresent: oldSide.present,
    newPresent: newSide.present,
    binary,
    truncated: oldSide.truncated || newSide.truncated,
  }
}
