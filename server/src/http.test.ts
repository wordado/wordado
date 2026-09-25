import { SYNC_PROTOCOL_VERSION } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness } from '../test/harness'
import { pushPage, rawEvent } from '../test/events'
import type { VapidKeys } from './deps'
import { generateVapidKeys } from './reminders/vapid'

const MINUTE = 60_000
const pull = { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'dev-a', documentsSince: 0 }

let vapid: VapidKeys | null = null
const subscription = (userId: string) => ({
  endpoint: `https://fcm.googleapis.com/fcm/send/${userId}`,
  keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA', auth: 'tBHItJI5svbpez7KI4CCXg' },
  reminderMinute: 540,
  tzOffsetMin: 0,
  language: 'en',
  streakNudge: false,
})

describe('x-wordado-user: the learner the client means to sync', () => {
  it('lets a push through when the header names the session user, or when there is none', async () => {
    const h = harness()
    const s = await h.signIn()
    const first = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]), { 'x-wordado-user': s.userId })
    expect(first.status).toBe(200)
    const second = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 2, h.clock.now - MINUTE)]))
    expect(second.status).toBe(200)
    const rows = await h.deps.db.query('select 1 from review_event where user_id = $1', [s.userId])
    expect(rows).toHaveLength(2)
  })

  it('refuses a push meant for another learner and stores nothing', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)]), {
      'x-wordado-user': 'someone-else',
    })
    expect(reply.status).toBe(409)
    expect(reply.body).toEqual({ error: 'wrong_user' })
    expect(await h.deps.db.query('select 1 from review_event where user_id = $1', [s.userId])).toEqual([])
    expect(await h.deps.db.query('select 1 from device where user_id = $1', [s.userId])).toEqual([])
  })

  it('refuses a pull meant for another learner and returns nothing of the session user', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.post('/v1/sync/pull', pull, { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.post('/v1/sync/pull', pull)).status).toBe(200)
    const reply = await s.post('/v1/sync/pull', pull, { 'x-wordado-user': 'someone-else' })
    expect(reply.status).toBe(409)
    expect(reply.body).toEqual({ error: 'wrong_user' })
  })

  it('refuses to move a push subscription to another learner', async () => {
    vapid ??= await generateVapidKeys('mailto:reminders@wordado.com')
    const h = harness({ config: { vapid } })
    const s = await h.signIn()
    const wrong = await s.put('/v1/push/subscription', subscription(s.userId), { 'x-wordado-user': 'someone-else' })
    expect(wrong.status).toBe(409)
    expect(await h.deps.db.query('select 1 from push_subscription')).toEqual([])
    expect((await s.put('/v1/push/subscription', subscription(s.userId), { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.del('/v1/push/subscription', { endpoint: subscription(s.userId).endpoint }, { 'x-wordado-user': 'someone-else' })).status).toBe(409)
    expect(await h.deps.db.query('select 1 from push_subscription')).toHaveLength(1)
    expect((await s.put('/v1/push/subscription', subscription(s.userId))).status).toBe(200)
  })

  it('refuses to delete another learner’s account, and deletes nothing', async () => {
    const h = harness()
    const s = await h.signIn()
    const wrong = await s.del('/v1/account', { confirm: true }, { 'x-wordado-user': 'someone-else' })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toEqual({ error: 'wrong_user' })
    expect((await s.get('/v1/me')).status).toBe(200)
    expect((await s.del('/v1/account', { confirm: true }, { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.get('/v1/me')).status).toBe(401)
  })

  it('refuses to export another learner’s data, and exports for the right one or an older client', async () => {
    const h = harness()
    const s = await h.signIn()
    const wrong = await s.get('/v1/export', { 'x-wordado-user': 'someone-else' })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toEqual({ error: 'wrong_user' })
    const right = await s.get('/v1/export', { 'x-wordado-user': s.userId })
    expect(right.status).toBe(200)
    expect(right.body.account.userId).toBe(s.userId)
    expect((await s.get('/v1/export')).status).toBe(200)
  })
})
