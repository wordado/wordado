import type { SyncStatus } from '@wordado/client-data'
import { httpStatusOf } from '../account/transport'
import type { MessageKey, Vars } from '../i18n/i18n'

export interface SyncMessage {
  readonly key: MessageKey
  readonly vars?: Vars
  /** A warning is shown so it is noticed; a quiet line is there when looked for. */
  readonly tone: 'quiet' | 'warning'
}

export interface SyncContext {
  readonly online: boolean
  readonly expired: boolean
  readonly signedIn: boolean
}

/**
 * What the masthead says about sync (spec §9.2). The first matching state
 * wins, most urgent first. A 400 is a page the server refused as malformed:
 * a fault in the app, not the network, and retrying cannot fix it (plan 5).
 */
export function syncMessage(status: SyncStatus, ctx: SyncContext): SyncMessage | null {
  if (!ctx.signedIn) return null
  const count = status.pendingEvents
  if (ctx.expired) return { key: 'sync.expired', tone: 'warning' }
  if (status.upgradeRequired) return { key: 'sync.upgrade', tone: 'warning' }
  if (status.phase !== 'idle') return { key: 'sync.syncing', tone: 'quiet' }
  if (status.failures > 0 && httpStatusOf(status.lastError) === 400) return { key: 'sync.rejected', tone: 'warning' }
  if (!ctx.online) return count > 0 ? { key: 'sync.offlinePending', vars: { count }, tone: 'quiet' } : { key: 'sync.offline', tone: 'quiet' }
  if (status.failures > 0) return { key: 'sync.failed', tone: 'warning' }
  if (count > 0) return { key: 'sync.pending', vars: { count }, tone: 'quiet' }
  if (status.lastSyncAt !== null) return { key: 'sync.synced', tone: 'quiet' }
  return null
}
