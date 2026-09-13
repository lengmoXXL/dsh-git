/**
 * The address contract for this plugin's resource tabs.
 *
 * A tab's identity in the right Sidebar is `(kind, contentId)`, and a resource
 * tab's content id is its address verbatim — so the address is the only place a
 * "which commit, which file" choice can live. Encoding it here, in a query
 * string, is what lets two diff tabs coexist: the identity differs, so the
 * surface opens a second tab instead of focusing the first.
 *
 * Addresses look like
 * `dsh-resource://git/diff?session=…&source=worktree&path=src/a.ts` and
 * `dsh-resource://git/commit?session=…&rev=…`, and the declared glob
 * `dsh-resource://git/**` claims exactly these.
 *
 * @module dsh-git/client/git-address
 */

import type { DiffSource } from '../shared/wire.ts'

/** The resource protocol this plugin owns. */
export const GIT_PROTOCOL = 'git'

/** The page kind the guide opens, and the id its body registers under. */
export const GIT_LOG_KIND = 'git-log'
export const GIT_LOG_ID = 'dsh-git/log'

/** The resource kind that renders a change, and the id its body registers under. */
export const GIT_DIFF_KIND = 'git'
export const GIT_DIFF_ID = 'dsh-git/diff'

/** One change, addressed for its own tab. */
export interface DiffAddress {
  readonly kind: 'diff'
  readonly sessionId: string
  readonly source: DiffSource
  readonly path: string
  readonly origPath?: string | undefined
  readonly rev?: string | undefined
}

/** One commit's whole change set, addressed for its own tab. */
export interface CommitAddress {
  readonly kind: 'commit'
  readonly sessionId: string
  readonly rev: string
}

/**
 * Every address this plugin knows how to render.
 *
 * A commit address is built by nothing on screen — each file of a commit gets
 * its own diff tab — but the parser must keep accepting one, because a tab
 * restored from an earlier session carries it. `commitAddress` stays the single
 * description of that shape so the two halves cannot drift.
 */
export type GitAddress = DiffAddress | CommitAddress

/**
 * Address one change.
 * @param parts - the session, the comparison pair, and the path to compare.
 * @returns the resource address.
 */
export function diffAddress(parts: {
  readonly sessionId: string
  readonly source: DiffSource
  readonly path: string
  readonly origPath?: string | undefined
  readonly rev?: string | undefined
}): string {
  const params = new URLSearchParams({
    session: parts.sessionId,
    source: parts.source,
    path: parts.path,
  })
  if (parts.origPath !== undefined) params.set('orig', parts.origPath)
  if (parts.rev !== undefined) params.set('rev', parts.rev)
  return `dsh-resource://${GIT_PROTOCOL}/diff?${params.toString()}`
}

/**
 * Address one commit's whole change set.
 * @param sessionId - the session whose workspace holds the repository.
 * @param rev - the commit to show.
 * @returns the resource address.
 */
export function commitAddress(sessionId: string, rev: string): string {
  const params = new URLSearchParams({ session: sessionId, rev })
  return `dsh-resource://${GIT_PROTOCOL}/commit?${params.toString()}`
}

/**
 * Read an address this plugin built.
 * @param address - the address to parse.
 * @returns the parsed address, or undefined when it is not one of ours.
 */
export function parseGitAddress(address: string): GitAddress | undefined {
  let url: URL
  try {
    url = new URL(address)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== GIT_PROTOCOL) return undefined
  const sessionId = url.searchParams.get('session')
  if (sessionId === null || sessionId === '') return undefined

  if (url.pathname === '/commit') {
    const rev = url.searchParams.get('rev')
    if (rev === null || rev === '') return undefined
    return { kind: 'commit', sessionId, rev }
  }
  if (url.pathname === '/diff') {
    const path = url.searchParams.get('path')
    const source = url.searchParams.get('source')
    if (path === null || path === '') return undefined
    // Spelled out rather than shared with the host's list: `wire.ts` is types
    // only, so the one value list cannot live in the module both halves share.
    if (source !== 'worktree' && source !== 'index' && source !== 'commit') return undefined
    const orig = url.searchParams.get('orig')
    const rev = url.searchParams.get('rev')
    return {
      kind: 'diff',
      sessionId,
      source,
      path,
      ...orig === null ? {} : { origPath: orig },
      ...rev === null ? {} : { rev },
    }
  }
  return undefined
}

/**
 * The label a tab chip carries for one address.
 *
 * The chip is captured when the tab opens, so this has to read well without the
 * content: a change is named by its file, and a commit by its abbreviated id.
 * @param address - the address being opened.
 * @returns the chip's text.
 */
export function gitAddressTitle(address: string): string {
  const parsed = parseGitAddress(address)
  if (parsed === undefined) return GIT_DIFF_KIND
  // Shortened to a fixed seven characters, NOT through `revLabel`: a chip is a
  // name the reader picks a tab by, and the label shortener keeps the `^`/`~2`
  // suffix a comparison needs. A chip has no suffix to keep.
  if (parsed.kind === 'commit') return parsed.rev.slice(0, 7)
  const at = parsed.path.lastIndexOf('/')
  return at < 0 ? parsed.path : parsed.path.slice(at + 1)
}
