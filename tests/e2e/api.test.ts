/**
 * The whole host half, against a real repository.
 *
 * Nothing here is stubbed except the facts this plugin does not own — which Session maps to
 * which workspace, and where a stored header is read from. The filesystem and subprocess seams
 * are the real local providers, so every git invocation, every parse, and every read below is the
 * code that runs in a deployment.
 *
 * @module dsh-git/tests/e2e/api
 */

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { after, before, test } from 'node:test'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import type { GitApiConfig, GitApiDeps, GitApiResponse } from '../../src/api/routes.ts'
import { handleGitApi } from '../../src/api/routes.ts'
import type { ChangeEntry, DiffPayload, StatusPayload } from '../../src/api/wire.ts'

const run = promisify(execFile)

/** The Session identity every request below names. */
const SESSION = 'session-1'

/** The deployment's caps for this suite. */
const CONFIG: GitApiConfig = {
  maxBytes: 2 * 1024 * 1024,
  historyLimit: 50,
  maxEntries: 2000,
}

/** The repository this suite builds and reads. */
let root = ''
/** The host context carrying the real providers. */
let ctx: Context
/** The handler's dependencies. */
let deps: GitApiDeps

/**
 * Run one git command against the fixture repository.
 * @param argv - arguments after the identity flags.
 * @returns the command's standard output.
 */
async function git(argv: readonly string[]): Promise<string> {
  const { stdout } = await run('git', [
    '-c', 'user.name=DSH Git Test',
    '-c', 'user.email=dsh-git@example.com',
    ...argv,
  ], { cwd: root })
  return stdout
}

/**
 * A host bench over the real local providers.
 *
 * The plugins register asynchronously, so the wait is what makes the context usable. What is
 * stubbed on top of it are the two facts this plugin does not own: which Session maps to which
 * workspace, and the deployment's fallback root.
 * @param cwd - the workspace this bench answers for.
 * @param provides - the seams to stub, by service name.
 * @returns the context, to be disposed when the test is done.
 */
async function bench(cwd: string, provides: Record<string, unknown> = {}): Promise<Context> {
  const context = new Context()
  context.plugin(LocalFileSystem, { cwd })
  context.plugin(LocalSubprocessRuntime)
  await new Promise(resolve => { setTimeout(resolve, 200) })
  for (const [name, value] of Object.entries(provides)) context.provide(name, value as never)
  return context
}

/**
 * Call one endpoint.
 * @param target - path and query, e.g. `/status?sessionId=x`.
 * @returns the handler's status and body.
 */
async function api(target: string): Promise<GitApiResponse> {
  const url = new URL(target, 'http://localhost')
  return await handleGitApi({ method: 'GET', path: url.pathname, query: url.searchParams }, deps)
}

/** Read one endpoint's body, failing the test on a non-200 answer. */
async function body<T>(target: string): Promise<T> {
  const answer = await api(target)
  assert.equal(answer.status, 200, `${target} answered ${String(answer.status)}`)
  return answer.body as T
}

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-git-e2e-'))
  await git(['init', '-q', '-b', 'main'])
  await writeFile(join(root, 'modified.txt'), 'one\ntwo\nthree\n')
  await writeFile(join(root, 'staged.txt'), 'alpha\nbeta\n')
  await writeFile(join(root, 'deleted.txt'), 'gone\n')
  await writeFile(join(root, 'renamed-old.txt'), 'moved content\n')
  await git(['add', '-A'])
  await git(['commit', '-q', '-m', 'initial commit'])
  // A second commit, so the history page has something to page.
  await writeFile(join(root, 'second.txt'), 'second\n')
  await git(['add', 'second.txt'])
  await git(['commit', '-q', '-m', 'add second'])
  // A commit whose tree equals its parent's, for the empty-file-list case.
  // Made here so no later test has to move HEAD over a staged change set.
  await git(['commit', '-q', '--allow-empty', '-m', 'empty commit'])

  // Staged: a modification, a rename, and an added binary.
  await writeFile(join(root, 'staged.txt'), 'alpha\ngamma\n')
  await rename(join(root, 'renamed-old.txt'), join(root, 'renamed-new.txt'))
  await git(['add', '-A'])
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2, 3, 0, 4]))
  await git(['add', 'binary.bin'])

  // Working tree only: a modification, a new file, and a deletion. Created
  // after every `git add` above, so none of it is staged.
  await writeFile(join(root, 'modified.txt'), 'one\nTWO\nthree\nfour\n')
  await writeFile(join(root, 'untracked.txt'), 'brand new\n')
  await unlink(join(root, 'deleted.txt'))

  ctx = await bench(root, {
    sessions: { get: () => ({ header: { cwd: root } }) },
    sandboxPolicy: { workspaceRoot: root },
  })
  deps = { ctx, config: CONFIG }
})

after(async () => {
  await ctx.fiber.dispose()
  await rm(root, { recursive: true, force: true })
})

/** Find the entry for one path at one stage. */
function find(status: StatusPayload, stage: ChangeEntry['stage'], path: string): ChangeEntry {
  const match = status.entries.find(entry => entry.stage === stage && entry.path === path)
  assert.ok(match !== undefined, `no ${stage} entry for ${path}`)
  return match
}

test('status reports the repository, its branch, and every change', async () => {
  const status = await body<StatusPayload>(`/status?sessionId=${SESSION}`)
  assert.equal(status.repo?.name, basename(root))
  assert.equal(status.repo?.branch.branch, 'main')
  assert.equal(status.repo?.branch.detached, false)
  assert.equal(status.truncated, false)

  assert.equal(find(status, 'unstaged', 'modified.txt').kind, 'modified')
  assert.equal(find(status, 'staged', 'staged.txt').kind, 'modified')
  assert.equal(find(status, 'untracked', 'untracked.txt').kind, 'untracked')
  assert.equal(find(status, 'unstaged', 'deleted.txt').kind, 'deleted')
  assert.equal(find(status, 'staged', 'binary.bin').kind, 'added')

  const renamed = find(status, 'staged', 'renamed-new.txt')
  assert.equal(renamed.kind, 'renamed')
  assert.equal(renamed.origPath, 'renamed-old.txt')
})

test('status answers a workspace that is not a repository without failing', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'dsh-git-plain-'))
  const plainCtx = await bench(outside, {
    sessions: { get: () => ({ header: { cwd: outside } }) },
    sandboxPolicy: { workspaceRoot: outside },
  })
  const answer = await handleGitApi(
    { method: 'GET', path: '/status', query: new URLSearchParams({ sessionId: SESSION }) },
    { ctx: plainCtx, config: CONFIG },
  )
  await plainCtx.fiber.dispose()
  await rm(outside, { recursive: true, force: true })
  assert.equal(answer.status, 200)
  assert.deepEqual(answer.body, { repo: null, entries: [], truncated: false })
})

test('history returns the newest commit first and pages', async () => {
  const all = await body<{ commits: readonly { subject: string }[]; hasMore: boolean }>(
    `/history?sessionId=${SESSION}`,
  )
  assert.deepEqual(
    all.commits.map(commit => commit.subject),
    ['empty commit', 'add second', 'initial commit'],
  )
  assert.equal(all.hasMore, false)

  const page = await body<{ commits: readonly { subject: string }[]; hasMore: boolean }>(
    `/history?sessionId=${SESSION}&limit=1`,
  )
  assert.deepEqual(page.commits.map(commit => commit.subject), ['empty commit'])
  assert.equal(page.hasMore, true)
})

test('history refuses a malformed page parameter', async () => {
  const answer = await api(`/history?sessionId=${SESSION}&limit=-1`)
  assert.equal(answer.status, 400)
  assert.equal((answer.body as { code: string }).code, 'git/bad-request')
})

test('commit lists the files one commit changed', async () => {
  const history = await body<{ commits: readonly { sha: string; subject: string }[] }>(
    `/history?sessionId=${SESSION}`,
  )
  const first = history.commits.find(commit => commit.subject === 'initial commit')
  assert.ok(first !== undefined)

  const payload = await body<{ commit: { subject: string }; files: readonly { path: string; kind: string }[] }>(
    `/commit?sessionId=${SESSION}&rev=${first.sha}`,
  )
  assert.equal(payload.commit.subject, 'initial commit')
  assert.deepEqual(
    payload.files.map(file => `${file.kind}:${file.path}`).sort(),
    ['added:deleted.txt', 'added:modified.txt', 'added:renamed-old.txt', 'added:staged.txt'],
  )
})

test('a commit with no changes lists no files', async () => {
  const history = await body<{ commits: readonly { sha: string; subject: string }[] }>(
    `/history?sessionId=${SESSION}`,
  )
  const empty = history.commits.find(commit => commit.subject === 'empty commit')
  assert.ok(empty !== undefined)
  const payload = await body<{ files: readonly unknown[] }>(`/commit?sessionId=${SESSION}&rev=${empty.sha}`)
  assert.deepEqual(payload.files, [])
})

test('an unknown revision is refused as not found', async () => {
  const answer = await api(`/commit?sessionId=${SESSION}&rev=0000000000000000000000000000000000000000`)
  assert.equal(answer.status, 404)
  assert.equal((answer.body as { code: string }).code, 'git/unknown-revision')
})

test('an unstaged diff reads the index against the working tree', async () => {
  const diff = await body<DiffPayload>(`/diff?sessionId=${SESSION}&path=modified.txt&source=worktree`)
  assert.equal(diff.oldLabel, 'index')
  assert.equal(diff.newLabel, 'working tree')
  assert.equal(diff.binary, false)
  assert.equal(diff.truncated, false)
  assert.equal(diff.oldText, 'one\ntwo\nthree\n')
  assert.equal(diff.newText, 'one\nTWO\nthree\nfour\n')
})

test('a staged diff reads HEAD against the index', async () => {
  const diff = await body<DiffPayload>(`/diff?sessionId=${SESSION}&path=staged.txt&source=index`)
  assert.equal(diff.oldLabel, 'HEAD')
  assert.equal(diff.newLabel, 'index')
  assert.equal(diff.oldText, 'alpha\nbeta\n')
  assert.equal(diff.newText, 'alpha\ngamma\n')
})

test('a staged rename diffs the old path against the new one', async () => {
  const diff = await body<DiffPayload>(
    `/diff?sessionId=${SESSION}&path=renamed-new.txt&origPath=renamed-old.txt&source=index`,
  )
  assert.equal(diff.origPath, 'renamed-old.txt')
  assert.equal(diff.binary, false)
  // Identical content: a rename with no edit is not a change of text.
  assert.equal(diff.oldText, diff.newText)
  assert.equal(diff.oldText, 'moved content\n')
})

test('a deleted file diffs against an empty new side', async () => {
  const diff = await body<DiffPayload>(`/diff?sessionId=${SESSION}&path=deleted.txt&source=worktree`)
  assert.equal(diff.oldText, 'gone\n')
  assert.equal(diff.newText, '')
})

test('an untracked file diffs against an empty old side', async () => {
  const diff = await body<DiffPayload>(`/diff?sessionId=${SESSION}&path=untracked.txt&source=worktree`)
  assert.equal(diff.oldText, '')
  assert.equal(diff.newText, 'brand new\n')
})

test('a commit diff reads the commit against its first parent', async () => {
  const history = await body<{ commits: readonly { sha: string; subject: string }[] }>(
    `/history?sessionId=${SESSION}`,
  )
  const first = history.commits.find(commit => commit.subject === 'initial commit')
  assert.ok(first !== undefined)
  const diff = await body<DiffPayload>(
    `/diff?sessionId=${SESSION}&path=second.txt&source=commit&rev=${first.sha}`,
  )
  // That commit predates the file, so neither side of the change exists.
  assert.equal(diff.oldText, '')
  assert.equal(diff.newText, '')
})

test('a binary file is reported instead of diffed', async () => {
  const diff = await body<DiffPayload>(`/diff?sessionId=${SESSION}&path=binary.bin&source=index`)
  assert.equal(diff.binary, true)
  assert.equal(diff.oldText, '')
})

test('a path outside the repository is refused', async () => {
  for (const path of ['/etc/passwd', '../secrets', 'src/../..']) {
    const answer = await api(`/diff?sessionId=${SESSION}&path=${encodeURIComponent(path)}&source=worktree`)
    assert.equal(answer.status, 400, `expected ${path} to be refused`)
    assert.equal((answer.body as { code: string }).code, 'git/path-outside-repo')
  }
})

test('an unknown source is refused', async () => {
  const answer = await api(`/diff?sessionId=${SESSION}&path=modified.txt&source=sideways`)
  assert.equal(answer.status, 400)
})

test('a missing session identity is refused', async () => {
  const answer = await api('/status')
  assert.equal(answer.status, 400)
  assert.equal((answer.body as { code: string }).code, 'session/unknown')
})

test('refuses an identity nobody knows instead of guessing a repository', async () => {
  // Neither a live header nor a persisted one: refusing is the only honest
  // answer, because the alternative is showing some other repository.
  const blindCtx = await bench(root, { sessions: { get: () => undefined } })
  const answer = await handleGitApi(
    { method: 'GET', path: '/status', query: new URLSearchParams({ sessionId: SESSION }) },
    { ctx: blindCtx, config: CONFIG },
  )
  await blindCtx.fiber.dispose()
  assert.equal(answer.status, 400)
  assert.equal((answer.body as { code: string }).code, 'session/unknown')
})

test('resolves a Session the host is not running from its persisted header', async () => {
  // A browser can name any Session it is showing, including one no fiber has
  // entered. The workspace must still be that Session's, never the deployment's.
  const storedCtx = await bench(root, {
    sessions: { get: () => undefined },
    sessionPersistence: { stat: async () => ({ header: { cwd: root }, revision: 'r1' }) },
  })
  const answer = await handleGitApi(
    { method: 'GET', path: '/status', query: new URLSearchParams({ sessionId: SESSION }) },
    { ctx: storedCtx, config: CONFIG },
  )
  await storedCtx.fiber.dispose()
  assert.equal(answer.status, 200)
  assert.equal((answer.body as StatusPayload).repo?.root, await realpath(root))
})

test('an unknown endpoint is not found and a write method is not allowed', async () => {
  assert.equal((await api('/nope')).status, 404)
  const url = new URL(`/status?sessionId=${SESSION}`, 'http://localhost')
  const posted = await handleGitApi({ method: 'POST', path: url.pathname, query: url.searchParams }, deps)
  assert.equal(posted.status, 405)
})
