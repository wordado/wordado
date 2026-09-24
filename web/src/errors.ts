import { ClientClosed } from '@wordado/client-data'
import { ApiError, OfflineError } from './account/api'
import { NotReady, SignOutOffline } from './account/controller'
import { SyncHttpError } from './account/transport'
import type { MessageKey } from './i18n/i18n'

/**
 * What the interface says about a failure (spec §11.2: every string is
 * translated). An error's own message is English and meant for developers,
 * so the learner sees one of these keys instead, never `err.message`.
 */
export function errorMessageKey(err: unknown): MessageKey {
  if (err instanceof SignOutOffline) return 'settings.signOutOffline'
  if (err instanceof NotReady || err instanceof ClientClosed) return 'error.notReady'
  if (err instanceof OfflineError) return 'error.offline'
  if (err instanceof ApiError || err instanceof SyncHttpError) {
    if (err.status === 401 || err.status === 403 || err.status === 409) return 'error.signIn'
    if (err.status === 429) return 'error.tooMany'
    if (err.status >= 500) return 'error.server'
  }
  return 'error.unknown'
}
