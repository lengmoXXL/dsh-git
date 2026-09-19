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
  CommitPayload,
  DiffPayload,
  DiffSource,
  ErrorPayload,
  HistoryPayload,
  StatusPayload,
} from '../shared/wire.ts'

/** The path prefix the host half answers on. */
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
  readonly path: string
  readonly origPath?: string | undefined
  readonly source: DiffSource
  /** The commit to read, required when `source` is `commit`. */
  readonly rev?: string | undefined
}

/** The panel's reads. */
export interface GitFace {
  /** Read the working tree's state. */
  status(sessionId: string, signal: AbortSignal): Promise<StatusPayload>
  /** Read one page of history. */
  history(sessionId: string, signal: AbortSignal | null, skip?: number): Promise<HistoryPayload>
  /** Read one commit and its files. */
  commit(sessionId: string, rev: string, signal: AbortSignal): Promise<CommitPayload>
  /** Read one change's two sides. */
  diff(request: DiffRequest, signal: AbortSignal): Promise<DiffPayload>
}

/**
 * Start one request and parse its answer.
 * @param fetchImpl - the fetch implementation to call.
 * @param path - the endpoint below {@link API_PREFIX}.
 * @param params - the query string to send.
 * @param signal - the request's lifetime, or null for one that cannot be called off.
 * @returns the parsed body.
 * @throws GitRequestError when the host answered with a failure body.
 */
async function call<T>(
  fetchImpl: FetchLike,
  path: string,
  params: URLSearchParams,
  signal: AbortSignal | null,
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
    async history(sessionId, signal, skip = 0) {
      // The page in hand is what a first read asks for; older ones are asked for by
      // how many are already in hand, which is what `skip` counts. A first read names
      // no skip at all, so the request stays what it was.
      const params = new URLSearchParams({ sessionId })
      if (skip > 0) params.set('skip', String(skip))
      return await call<HistoryPayload>(fetchImpl, '/history', params, signal)
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
