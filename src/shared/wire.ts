/**
 * The wire contract both halves of dsh-git compile against.
 *
 * This module is types only — it emits nothing and imports nothing — so the
 * host program and the browser bundle share one description of what
 * `/dsh-git/*` answers without either pulling in the other's code.
 *
 * @module dsh-git/shared/wire
 */

/** Which revision pair a diff compares. */
export type DiffSource = 'worktree' | 'index' | 'commit'

/** The change a single status code letter describes. */
export type ChangeKind =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'untracked'
  | 'conflicted'
  | 'unknown'

/**
 * Which half of the index a status entry belongs to. A file changed both in
 * the index and in the working tree appears once per stage, which is the
 * grouping the panel draws.
 */
export type ChangeStage = 'staged' | 'unstaged' | 'untracked' | 'conflicted'

/** One changed path, as `git status --porcelain=v2` reports it. */
export interface ChangeEntry {
  /** Repository-relative path with `/` separators. */
  readonly path: string
  /** Previous path of a rename or copy; absent otherwise. */
  readonly origPath?: string
  /** Index-side status letter, `.` when unchanged. */
  readonly index: string
  /** Working-tree-side status letter, `.` when unchanged. */
  readonly worktree: string
  /** What the stage's status letter means. */
  readonly kind: ChangeKind
  /** Which half this entry is reported for. */
  readonly stage: ChangeStage
}

/** The branch facts `git status --branch` reports. */
export interface BranchStatus {
  /** Branch name, or null on a detached HEAD. */
  readonly branch: string | null
  /** Whether HEAD is detached. */
  readonly detached: boolean
  /** Full commit id of HEAD, or null before the first commit. */
  readonly oid: string | null
  /** Upstream ref name, or null when the branch tracks nothing. */
  readonly upstream: string | null
  /** Commits ahead of the upstream. */
  readonly ahead: number
  /** Commits behind the upstream. */
  readonly behind: number
}

/** The repository the panel is showing, or the reason there is none. */
export interface RepoIdentity {
  /** Absolute path of the working tree root. */
  readonly root: string
  /** Basename of that root, for the panel header. */
  readonly name: string
}

/** `GET /dsh-git/status` */
export interface StatusPayload {
  /** Null when the workspace is not inside a git repository. */
  readonly repo: (RepoIdentity & { readonly branch: BranchStatus }) | null
  /** Every changed path, in git's own order. */
  readonly entries: readonly ChangeEntry[]
  /** The entry cap was reached, so entries are missing. */
  readonly truncated: boolean
}

/** One commit row of the history list. */
export interface CommitSummary {
  /** Full commit id. */
  readonly sha: string
  /** Abbreviated commit id, as git renders it. */
  readonly shortSha: string
  /** Parent commit ids; empty for a root commit. */
  readonly parents: readonly string[]
  /** Author name. */
  readonly authorName: string
  /** Author email. */
  readonly authorEmail: string
  /** Author timestamp in whole seconds since the epoch. */
  readonly authoredAt: number
  /** Ref names pointing at this commit, as `%D` renders them. */
  readonly refs: readonly string[]
  /** First line of the commit message. */
  readonly subject: string
}

/** `GET /dsh-git/history` */
export interface HistoryPayload {
  /** Newest first. */
  readonly commits: readonly CommitSummary[]
  /** More commits exist below the returned page. */
  readonly hasMore: boolean
}

/** One file changed by a commit. */
export interface CommitFile {
  /** Repository-relative path with `/` separators. */
  readonly path: string
  /** Previous path of a rename or copy; absent otherwise. */
  readonly origPath?: string
  /** What the change-status letter means. */
  readonly kind: ChangeKind
}

/** `GET /dsh-git/commit` */
export interface CommitPayload {
  /** The commit itself. */
  readonly commit: CommitSummary
  /** Every file the commit touches, or an empty list for an unreadable commit. */
  readonly files: readonly CommitFile[]
}

/** One side of one rendered diff row: its 1-based line number and its text. */
export interface DiffSide {
  readonly no: number
  readonly text: string
}

/**
 * How one aligned row relates the two sides. `gap` is not a pair of lines at
 * all: it stands where rows were left out, and carries how many.
 */
export type DiffRowKind = 'context' | 'delete' | 'insert' | 'replace' | 'gap'

/**
 * One aligned row of a side-by-side diff. `left` is the old side and `right`
 * the new; a null side is drawn as empty space so the two columns stay in
 * step.
 */
export interface DiffRow {
  readonly kind: DiffRowKind
  readonly left: DiffSide | null
  readonly right: DiffSide | null
  /** For a `gap`: how many old-side lines were left out here. */
  readonly skippedLeft?: number
  /** For a `gap`: how many new-side lines were left out here. */
  readonly skippedRight?: number
}

/** `GET /dsh-git/diff` */
export interface DiffPayload {
  /** The new-side path. */
  readonly path: string
  /** The old-side path, when the change is a rename or copy. */
  readonly origPath?: string
  /** Which revision pair this is. */
  readonly source: DiffSource
  /** Human-readable name of the old side, e.g. `HEAD` or `index`. */
  readonly oldLabel: string
  /** Human-readable name of the new side, e.g. `working tree`. */
  readonly newLabel: string
  /** A side is binary, so no rows are returned. */
  readonly binary: boolean
  /** A side was cut at its byte or line cap, so rows are incomplete. */
  readonly truncated: boolean
  /** Old-side lines the change removes. */
  readonly removed: number
  /** New-side lines the change adds. */
  readonly added: number
  /** Aligned rows, in file order. */
  readonly rows: readonly DiffRow[]
  /**
   * The diff computer hit its time budget, so the pairing is an approximation.
   * Absent means the alignment is exact.
   */
  readonly approximate?: boolean
}

/** Every failure body this API answers with. */
export interface ErrorPayload {
  /** Stable failure code the panel switches on. */
  readonly code: string
  /** Operator-readable description, already localized by the host. */
  readonly message: string
}

/** `GET /dsh-git/commit-diff` — every file of one commit, already aligned. */
export interface CommitDiffPayload {
  /** The commit these diffs belong to. */
  readonly commit: CommitSummary
  /** One aligned diff per changed file, in git's own order. */
  readonly files: readonly DiffPayload[]
  /** The file or row cap stopped the walk, so files are missing. */
  readonly truncated: boolean
}

/**
 * The value a `dsh-resource://git/...` tab renders: one change, one commit's
 * worth of changes, or the failure that stopped it.
 *
 * A failure is a value rather than a broken stream on purpose: the resource
 * carrier delivers failures as frames in its own vocabulary, and keeping this
 * one inside the value lets the tab draw the reason the host gave without this
 * plugin depending on that vocabulary.
 */
export type GitResource =
  | { readonly kind: 'diff'; readonly diff: DiffPayload }
  | {
    readonly kind: 'commit'
    readonly commit: CommitSummary
    readonly files: readonly DiffPayload[]
    readonly truncated: boolean
  }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }
