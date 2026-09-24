import { INITIAL_SYNC_STATUS, type SyncStatus } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { syncMessage } from './syncMessage'

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({ ...INITIAL_SYNC_STATUS, ...patch })
const ctx = { online: true, expired: false, signedIn: true }

describe('syncMessage (spec §9.2): every state has words', () => {
  it('says nothing in the demo, which does not sync', () => {
    expect(syncMessage(status({ pendingEvents: 3 }), { ...ctx, signedIn: false })).toBeNull()
  })

  it.each([
    ['an expired sign-in first', status({ failures: 2, lastError: 'HTTP 401' }), { ...ctx, expired: true }, 'sync.expired', 'warning'],
    ['an app too old to sync', status({ upgradeRequired: true }), ctx, 'sync.upgrade', 'warning'],
    ['a sync under way', status({ phase: 'pushing' }), ctx, 'sync.syncing', 'quiet'],
    ['a page the server refused as malformed', status({ failures: 1, lastError: 'HTTP 400', pendingEvents: 2 }), ctx, 'sync.rejected', 'warning'],
    ['offline with answers waiting', status({ pendingEvents: 2 }), { ...ctx, online: false }, 'sync.offlinePending', 'quiet'],
    ['offline with nothing waiting', status(), { ...ctx, online: false }, 'sync.offline', 'quiet'],
    ['a failure online', status({ failures: 1, lastError: 'Failed to fetch', pendingEvents: 2 }), ctx, 'sync.failed', 'warning'],
    ['answers not yet sent', status({ pendingEvents: 1, lastSyncAt: 5 }), ctx, 'sync.pending', 'quiet'],
    ['everything sent', status({ lastSyncAt: 5 }), ctx, 'sync.synced', 'quiet'],
  ] as const)('%s', (_, s, c, key, tone) => {
    expect(syncMessage(s, c)).toMatchObject({ key, tone })
  })

  it('counts what is waiting', () => {
    expect(syncMessage(status({ pendingEvents: 4 }), { ...ctx, online: false })?.vars).toEqual({ count: 4 })
  })

  it('says nothing before the first sync of a learner with nothing to send', () => {
    expect(syncMessage(status(), ctx)).toBeNull()
  })
})
