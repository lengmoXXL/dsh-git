/**
 * The client face: the query it builds and how it classifies an answer.
 *
 * @module dsh-git/tests/unit/face
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createGitFace, GitRequestError, type FetchLike } from '../../src/client/face.ts'

/** A fetch that records the URL it was given and answers with one body. */
function recordingFetch(status: number, body: unknown): { readonly fetch: FetchLike; readonly urls: string[] } {
  const urls: string[] = []
  const fetchImpl: FetchLike = async (input) => {
    urls.push(input)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetch: fetchImpl, urls }
}

/** A signal that is never aborted. */
function live(): AbortSignal {
  return new AbortController().signal
}

test('asks for the status of a session', async () => {
  const recorder = recordingFetch(200, { repo: null, entries: [], truncated: false })
  const face = createGitFace(recorder.fetch)
  const payload = await face.status('s 1', live())
  assert.deepEqual(payload, { repo: null, entries: [], truncated: false })
  assert.equal(recorder.urls[0], '/dsh-git/status?sessionId=s+1')
})

test('asks for a page of history', async () => {
  const recorder = recordingFetch(200, { commits: [], hasMore: false })
  const face = createGitFace(recorder.fetch)
  await face.history('s1', live())
  assert.equal(recorder.urls[0], '/dsh-git/history?sessionId=s1')

  // The page in hand is what a first read asks for; older ones are asked for by how
  // many are already in hand, which is how the reader reaches the whole history.
  await face.history('s1', live(), 12)
  assert.equal(recorder.urls[1], '/dsh-git/history?sessionId=s1&skip=12')
})

test('sends only the diff parameters that apply', async () => {
  const recorder = recordingFetch(200, {
    path: 'a', source: 'worktree', oldLabel: 'index', newLabel: 'working tree',
    binary: false, truncated: false, oldText: '', newText: '',
  })
  const face = createGitFace(recorder.fetch)

  await face.diff({ sessionId: 's1', path: 'src/a b.ts', source: 'worktree' }, live())
  assert.equal(recorder.urls[0], '/dsh-git/diff?sessionId=s1&path=src%2Fa+b.ts&source=worktree')

  await face.diff({
    sessionId: 's1',
    path: 'src/new.ts',
    origPath: 'src/old.ts',
    source: 'commit',
    rev: 'abc123',
  }, live())
  assert.equal(
    recorder.urls[1],
    '/dsh-git/diff?sessionId=s1&path=src%2Fnew.ts&source=commit&origPath=src%2Fold.ts&rev=abc123',
  )
})

test('raises the host code on a described failure', async () => {
  const recorder = recordingFetch(404, { code: 'git/not-a-repository', message: 'not a repo' })
  const face = createGitFace(recorder.fetch)
  await assert.rejects(
    () => face.status('s1', live()),
    (error: unknown) => error instanceof GitRequestError
      && error.code === 'git/not-a-repository'
      && error.message === 'not a repo',
  )
})

test('raises a status-derived failure when the body is not a failure body', async () => {
  const notJson: FetchLike = async () => new Response('<html>nope</html>', { status: 502 })
  const face = createGitFace(notJson)
  await assert.rejects(
    () => face.history('s1', live()),
    (error: unknown) => error instanceof GitRequestError && error.code === 'git/command-failed',
  )
})

test('propagates an abort instead of classifying it', async () => {
  const controller = new AbortController()
  controller.abort()
  const fetchImpl: FetchLike = async (_input, init) => {
    if (init?.signal?.aborted === true) throw new Error('aborted')
    return new Response('{}')
  }
  const face = createGitFace(fetchImpl)
  await assert.rejects(() => face.status('s1', controller.signal), /aborted/)
})
