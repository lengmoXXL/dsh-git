/**
 * The browser half of dsh-git.
 *
 * It contributes one page type to the right Sidebar, reached from the strip's add
 * control: pressing `+` opens the guide, and this type's entry is one of its
 * capsules. Diffs are not tabs at all — one opens in a pane inside that page, beside
 * the list it came from, so reading one never takes the list away.
 *
 * The page asks the host directly, on the same routes the rest of the plugin uses,
 * and hands a file to the shell's own file view when the reader asks for the file
 * rather than the diff.
 *
 * Every Harness import here is `import type` except the primitives package: the
 * browser bundle shares exactly that one runtime module with the shell, and a value
 * import from anything else would need a module it cannot reach.
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
import { IconBranchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { LogBody } from './LogBody.tsx'
import { en, NS, zh, type GitKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Git log and diff copy. */
    'dsh-git': GitKey
  }

}

/** The page kind the guide opens, and the id its body registers under. */
const GIT_LOG_KIND = 'git-log'
const GIT_LOG_ID = 'dsh-git/log'

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
      icon: IconBranchOutline16,
    }],
  }
}

/** Client plugin name used by the loader and by diagnostics. */
export const name = 'dsh-git-ui'

/** Client services this plugin needs before it activates. */
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'resources', 'sidebarRight']

// Exported for the suite: how the diff draws and what the lists show are the two
// things worth asserting against the built bundle, and a page body rendered on the
// server never reaches its effects. The shell reads `name`, `inject` and `apply`.
export { SideBySide } from './SideBySide.tsx'
export type { SideBySideProps } from './SideBySide.tsx'
export { ChangeList } from './ChangeList.tsx'
export { HistoryList } from './HistoryList.tsx'

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

  // A file belongs to the shell's own file view, whose type claims
  // `dsh-resource://file/**`. That call goes through the controller rather than a
  // per-tab action, because the per-tab path silently does nothing for a session
  // whose surface store is not adopted, and it names the kind rather than leaving it
  // to the registry's claim ranking, so a wrong claim is a named failure.
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: GIT_LOG_ID,
      locale: NS,
      inject: () => ({
        openResource: (address: string, kind: string) => { ctx.sidebarRight.openResource(address, { kind }) },
      }),
    },
    LogBody,
  )), 'dsh-git: log body')
}
