/**
 * The `git` resource provider: one address in, one value out.
 *
 * A provider owns a protocol, and this one owns `git`. It parses the address
 * the tab carries, asks the host for exactly that content, and yields one
 * frame. There is no second frame because nothing here observes a repository
 * live — a diff of a commit cannot change — so the stream ends as soon as the
 * value is known.
 *
 * A failure is delivered as a value of kind `error` rather than as a broken
 * stream. The resource carrier has its own failure vocabulary, and keeping this
 * one inside the value lets the tab draw the host's reason without this plugin
 * having to manufacture the carrier's error type.
 *
 * @module dsh-git/client/provider
 */

import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { GitResource } from '../shared/wire.ts'
import type { GitFace } from './face.ts'
import { GIT_PROTOCOL, parseGitAddress } from './git-address.ts'
import { failureInfoOf } from './state.ts'

/**
 * Load one address into the value its tab renders.
 * @param face - the bound host reads.
 * @param address - the resource address.
 * @param signal - the resource's lifetime.
 * @returns the value to publish.
 */
async function load(face: GitFace, address: string, signal: AbortSignal): Promise<GitResource> {
  const parsed = parseGitAddress(address)
  if (parsed === undefined) {
    return { kind: 'error', code: 'git/bad-request', message: `unrecognized git address: ${address}` }
  }
  try {
    if (parsed.kind === 'commit') {
      const payload = await face.commitDiff(parsed.sessionId, parsed.rev, signal)
      return {
        kind: 'commit',
        commit: payload.commit,
        files: payload.files,
        truncated: payload.truncated,
      }
    }
    const diff = await face.diff({
      sessionId: parsed.sessionId,
      path: parsed.path,
      source: parsed.source,
      ...parsed.origPath === undefined ? {} : { origPath: parsed.origPath },
      ...parsed.rev === undefined ? {} : { rev: parsed.rev },
    }, signal)
    return { kind: 'diff', diff }
  } catch (error: unknown) {
    const failure = failureInfoOf(error)
    return { kind: 'error', code: failure.code, message: failure.message }
  }
}

/**
 * Build the provider the plugin registers.
 * @param face - the bound host reads.
 * @returns the provider for the `git` protocol.
 */
export function gitResourceProvider(face: GitFace): ResourceProvider<'git'> {
  return {
    protocol: GIT_PROTOCOL,
    async *open(address, { signal }) {
      const value = await load(face, address, signal)
      // The last subscriber may have left while the host was answering.
      if (signal.aborted) return
      yield { ok: true, value }
    },
  }
}
