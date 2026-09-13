/**
 * The panel's data face: the four `/dsh-git` reads, as typed calls.
 *
 * `fetch` is a parameter rather than a module-level global so a test can drive
 * every branch — success, a coded failure, a transport failure — without a
 * server.
 *
 * A failure the host described arrives as {@link GitRequestError}, carrying the
 * host's stable code; anything else (the browser refusing the request, a
 * non-JSON body) reaches the caller as the raw rejection, because those are not
 * the host's answers to classify.
 *
 * @module dsh-git/client/face
 */

import type {
  CommitDiffPayload,
  CommitPayload,
  DiffPayload,
  DiffSource,
  ErrorPayload,
  HistoryPayload,
  StatusPayload,
} from '../shared/wire.ts'

/** The path prefix this plugin's host half owns. */
const API_PREFIX = '/dsh-git'

/** A failure the host reported, with its stable code. */
export class GitRequestError extends Error {
  override readonly name = 'GitRequestError'

  /** The host's failure code. */
  readonly code: string

  /**
   * @param code - the host's failure code.
   * @param message - the host's operator-readable description.
   */
  constructor(
    code: string,
    message: string,
  ) {
    super(message)
    this.code = code
  }
}

/** The slice of `fetch` this face uses; narrowed so a test can stand in for it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** One diff request. */
export interface DiffRequest {
  /** The Session whose workspace the repository belongs to. */
  readonly sessionId: string
  /** Repository-relative path of the new side. */
  readonly path: string
  /** Repository-relative path of the old side, for a rename. */
  readonly origPath?: string | undefined
  /** Which comparison pair to read. */
  readonly source: DiffSource
  /** The commit to read, required when `source` is `commit`. */
  readonly rev?: string | undefined
}

/** The panel's reads. */
export interface GitFace {
  /** Read the working tree's state. */
  status(sessionId: string, signal: AbortSignal): Promise<StatusPayload>
  /** Read one page of history. */
  history(sessionId: string, signal: AbortSignal): Promise<HistoryPayload>
  /** Read one commit and its files. */
  commit(sessionId: string, rev: string, signal: AbortSignal): Promise<CommitPayload>
  /** Read one change's aligned sides. */
  diff(request: DiffRequest, signal: AbortSignal): Promise<DiffPayload>
  /** Read one commit's whole change set, already aligned. */
  commitDiff(sessionId: string, rev: string, signal: AbortSignal): Promise<CommitDiffPayload>
}

/**
 * Start one request and parse its answer.
 * @param fetchImpl - the fetch implementation to call.
 * @param path - the endpoint below {@link API_PREFIX}.
 * @param params - the query string to send.
 * @param signal - the request's lifetime.
 * @returns the parsed body.
 * @throws GitRequestError when the host answered with a failure body.
 */
async function call<T>(
  fetchImpl: FetchLike,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetchImpl(`${API_PREFIX}${path}?${params.toString()}`, {
    method: 'GET',
    credentials: 'same-origin',
    signal,
  })
  // A proxy or an aborted request can answer with something that is not JSON;
  // the status is the fact that matters, so the parse failure is swallowed.
  const body: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const failure = body as Partial<ErrorPayload> | null | undefined
    throw new GitRequestError(
      failure?.code ?? 'git/command-failed',
      failure?.message ?? `the host answered with status ${String(response.status)}`,
    )
  }
  return body as T
}

/**
 * Build the face over the host's routes.
 * @param fetchImpl - the fetch implementation to use; defaults to the global.
 * @returns the face the panel drives.
 */
export function createGitFace(
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): GitFace {
  return {
    async status(sessionId, signal) {
      return await call<StatusPayload>(
        fetchImpl,
        '/status',
        new URLSearchParams({ sessionId }),
        signal,
      )
    },
    async history(sessionId, signal) {
      return await call<HistoryPayload>(
        fetchImpl,
        '/history',
        new URLSearchParams({ sessionId }),
        signal,
      )
    },
    async commit(sessionId, rev, signal) {
      return await call<CommitPayload>(
        fetchImpl,
        '/commit',
        new URLSearchParams({ sessionId, rev }),
        signal,
      )
    },
    async diff(request, signal) {
      const params = new URLSearchParams({
        sessionId: request.sessionId,
        path: request.path,
        source: request.source,
      })
      if (request.origPath !== undefined) params.set('origPath', request.origPath)
      if (request.rev !== undefined) params.set('rev', request.rev)
      return await call<DiffPayload>(fetchImpl, '/diff', params, signal)
    },
    async commitDiff(sessionId, rev, signal) {
      return await call<CommitDiffPayload>(
        fetchImpl,
        '/commit-diff',
        new URLSearchParams({ sessionId, rev }),
        signal,
      )
    },
  }
}

/**
 * The plugin's one face, bound to the shell's `fetch`.
 *
 * A singleton because every tab talks to the same origin with the same
 * credentials: there is nothing per-tab to bind, and a second face would only
 * be a second copy of the same four calls.
 */
export const gitFace: GitFace = createGitFace()
