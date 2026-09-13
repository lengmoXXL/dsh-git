/**
 * Presentation helpers: the copy that turns wire values into localized text,
 * and the class-name join the components build their rows with.
 *
 * Relative-time bucketing is the primitive's, so this panel and the workspace
 * list name the same distance the same way; the words are this namespace's.
 *
 * @module dsh-git/client/format
 */

import { relativeTime, type RelativeTimeUnit } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChangeKind } from '../shared/wire.ts'
import type { GitKey } from './locales.ts'

/** The dictionary key each relative-time bucket is spelled with. */
const TIME_KEY: Record<RelativeTimeUnit, GitKey> = {
  now: 'time.now',
  minutes: 'time.minutes',
  hours: 'time.hours',
  days: 'time.days',
  months: 'time.months',
  years: 'time.years',
}

/** The dictionary key each change kind is named with. */
const KIND_KEY: Record<ChangeKind, GitKey> = {
  modified: 'kind.modified',
  added: 'kind.added',
  deleted: 'kind.deleted',
  renamed: 'kind.renamed',
  copied: 'kind.copied',
  typechange: 'kind.typechange',
  untracked: 'kind.untracked',
  conflicted: 'kind.conflicted',
  unknown: 'kind.unknown',
}

/**
 * A commit's authored time, relative to now.
 * @param authoredAt - author timestamp in whole seconds since the epoch.
 * @param now - current epoch milliseconds, injected so rendering stays pure.
 * @param t - the panel's translator.
 * @returns the localized distance.
 */
export function timeLabel(
  authoredAt: number,
  now: number,
  t: Translate<GitKey>,
): string {
  const bucket = relativeTime(authoredAt * 1000, now)
  return t(TIME_KEY[bucket.unit], { n: bucket.n })
}

/**
 * Name one change kind.
 * @param kind - the kind a status letter described.
 * @param t - the panel's translator.
 * @returns the localized name.
 */
export function kindLabel(kind: ChangeKind, t: Translate<GitKey>): string {
  return t(KIND_KEY[kind])
}

/**
 * Split a path so the directory can be drawn dimmer than the name.
 * @param path - a repository-relative path.
 * @returns the directory (trailing separator kept) and the entry name.
 */
export function pathParts(path: string): { dir: string; base: string } {
  const at = path.lastIndexOf('/')
  return at < 0 ? { dir: '', base: path } : { dir: path.slice(0, at + 1), base: path.slice(at + 1) }
}

/**
 * Join the class names that apply, dropping the ones that do not.
 * @param parts - class names, or falsy values to skip.
 * @returns the joined class attribute value.
 */
export function cx(...parts: readonly (string | false | null | undefined)[]): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}
