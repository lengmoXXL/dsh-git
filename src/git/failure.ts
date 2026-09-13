/**
 * The host half's failure vocabulary.
 *
 * One class with a stable code, rather than a family of error types: the code
 * is what the HTTP layer maps to a status and what the panel switches its copy
 * on, and the message is the operator-readable detail. Every code here is
 * produced by this package, and every one of them crosses the wire.
 *
 * @module dsh-git/git/failure
 */

/** Every failure this package reports. */
export type GitFailureCode =
  /** No usable Session identity was supplied, so the workspace is unknown. */
  | 'session/unknown'
  /** `git` is not resolvable or could not be started in this execution world. */
  | 'git/unavailable'
  /** A git command ran and failed. */
  | 'git/command-failed'
  /** The workspace is not inside a git repository. */
  | 'git/not-a-repository'
  /** A request parameter is missing or malformed. */
  | 'git/bad-request'
  /** A requested path escapes the repository root. */
  | 'git/path-outside-repo'
  /** The commit a request names does not exist. */
  | 'git/unknown-revision'

/** A failure of the git panel's host half. */
export class GitFailure extends Error {
  override readonly name = 'GitFailure'

  /** The stable code the panel switches on. */
  readonly code: GitFailureCode

  /**
   * @param code - the stable code the panel switches on.
   * @param message - operator-readable description.
   * @param options - carries the original exception, when there is one.
   */
  constructor(
    code: GitFailureCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.code = code
  }
}

/**
 * Describe an unknown thrown value.
 * @param error - the caught value.
 * @returns its message, or its string form when it is not an Error.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
