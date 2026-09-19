/**
 * The two states that stand in for content: a request in flight, and a failure
 * with the way to try it again.
 *
 * @module dsh-git/client/components/Feedback
 */

import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitKey } from '../i18n/locales.ts'
import css from '../styles/Feedback.module.css'

export function FailureBlock({ code, message, t, onRetry }: {
  readonly code: string
  readonly message: string
  readonly t: Translate<GitKey>
  readonly onRetry: (() => void) | undefined
}): ReactNode {
  return (
    <div className={css.failure} role="alert">
      <span className={css.failureTitle}>{t('error.title')}</span>
      <span className={css.failureBody}>{code}: {message}</span>
      {onRetry !== undefined && (
        <Button variant="outline" size="sm" onClick={onRetry}>{t('panel.retry')}</Button>
      )}
    </div>
  )
}

/** One line of chrome for a state that has nothing to draw yet. */
export function Note({ children }: { readonly children: ReactNode }): ReactNode {
  return <p className={css.note}>{children}</p>
}
