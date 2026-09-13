/**
 * The browser half of dsh-git.
 *
 * It contributes two tab types to the right Sidebar, and one resource protocol
 * they share:
 *
 * - the LOG PAGE, a page type reached from the strip's add control: pressing
 *   `+` opens the guide, and this type's entry is one of its capsules. Picking
 *   it replaces the guide with the log.
 * - the DIFF VIEWER, a resource type that claims `dsh-resource://git/**`. The
 *   log opens one per change or per commit, and because a resource tab's
 *   identity is its address, two of them coexist — each log entry gets its own
 *   tab instead of taking over the previous one.
 *
 * The `git` resource provider is what turns an address into content: it asks
 * the host for exactly the change the address names.
 *
 * Every Harness import here is `import type` except the glyph: the browser
 * bundle shares exactly one runtime module with the shell (the primitives
 * package), and a value import from anything else would need a module it cannot
 * reach.
 *
 * @module dsh-git/client
 */

import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the resource service merge (ctx.resources) and the protocol map.
import type {} from '@deepseek-ai/dsh-client-resources/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard seat (sessionId) the tab bodies receive.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the tab registry merge (ctx.sidebarRightTabs) and its seats.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitResource } from '../shared/wire.ts'
import { DiffBody } from './DiffBody.tsx'
import { gitFace } from './face.ts'
import {
  GIT_DIFF_ID,
  GIT_DIFF_KIND,
  GIT_LOG_ID,
  GIT_LOG_KIND,
  GIT_PROTOCOL,
  gitAddressTitle,
} from './git-address.ts'
import { GitGlyph } from './glyphs.tsx'
import { LogBody } from './LogBody.tsx'
import { en, NS, zh, type GitKey } from './locales.ts'
import { gitResourceProvider } from './provider.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git log and diff copy. */
    'dsh-git': GitKey
  }

  interface ResourceProtocolMap {
    /** One change, one commit's change set, or the reason it could not be read. */
    git: GitResource
  }
}

/** The log page's static face, including the guide entry the add control lists. */
function logDefinition(t: Translate<GitKey>): SidebarRightTabDefinition {
  return {
    id: GIT_LOG_ID,
    kind: GIT_LOG_KIND,
    priority: 'builtin',
    title: () => t('log.title'),
    guide: [{
      order: 20,
      title: () => t('log.title'),
      description: () => t('log.guide'),
      icon: GitGlyph,
    }],
  }
}

/** The diff viewer's static face: it claims this plugin's whole protocol. */
function diffDefinition(): SidebarRightTabDefinition {
  return {
    id: GIT_DIFF_ID,
    kind: GIT_DIFF_KIND,
    patterns: [`dsh-resource://${GIT_PROTOCOL}/**`],
    priority: 'builtin',
    title: gitAddressTitle,
  }
}

/** Client plugin name used by the loader and by diagnostics. */
export const name = 'dsh-git-ui'

/** Client services this plugin needs before it activates. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'resources', 'sidebarRight']

/**
 * Mount the client half.
 * @param ctx - the client context this plugin was mounted on.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git: dictionaries')
  // Bound, not called: every label and every row is read through it at draw
  // time, so a language change needs no re-registration.
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.sidebarRightTabs.register(logDefinition(t)), 'dsh-git: log type')
  ctx.effect(() => ctx.sidebarRightTabs.register(diffDefinition()), 'dsh-git: diff type')
  ctx.effect(() => ctx.resources.register(gitResourceProvider(gitFace)), 'dsh-git: git resources')

  // Stage two of each type: the body registers under the definition's id.
  // The controller, not the per-tab action, opens resources: the per-tab path
  // silently does nothing for a session whose surface store is not adopted,
  // while the controller answers with a thrown error a reader can see. And the
  // kind is named rather than left to the registry's claim ranking: this plugin
  // knows exactly which type owns its addresses, and naming it turns a silent
  // mis-claim into a named failure.
  const openResource = (address: string): void => {
    ctx.sidebarRight.openResource(address, { kind: GIT_DIFF_KIND })
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: GIT_LOG_ID, locale: NS, inject: () => ({ openResource }) },
    LogBody,
  )), 'dsh-git: log body')
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: GIT_DIFF_ID, locale: NS },
    DiffBody,
  )), 'dsh-git: diff body')
}
