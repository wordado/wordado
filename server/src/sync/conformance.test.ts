import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import {
  dayToIsoDate,
  DOCUMENT_TYPES,
  Grade,
  localDay,
  SYNC_PROTOCOL_VERSION,
  type DocumentWrite,
  type PullResponse,
  type PushPage,
  type WireDocument,
} from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness } from '../../test/harness'
import { pushPage, rawEvent, TZ } from '../../test/events'
import { defaultEntitlementFields } from '../learner'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

const write = (type: string, key: string, fields: Record<string, unknown>, baseVersion = 0): DocumentWrite => ({ type, key, patch: { baseVersion, fields } })

/** Order-free and without the one field the two may legitimately differ in: a server-owned copy's refresh time. */
function normalise(response: PullResponse) {
  if (response.status !== 'ok') return response
  const withoutStale = (d: WireDocument) => ({ ...d, staleAfter: d.class === 'server_owned' ? 'fresh' : d.staleAfter })
  return {
    ...response,
    reviewStates: [...response.reviewStates].sort((a, b) => (a.wordId < b.wordId ? -1 : 1)),
    summaries: [...response.summaries].sort((a, b) => a.day - b.day),
    documents: response.documents.map(withoutStale).sort((a, b) => a.version - b.version),
  }
}

describe('the server and the fake server (plan 4 contract)', () => {
  it('answer every push and the pull the same way', async () => {
    const h = harness()
    const s = await h.signIn()
    const [user] = await h.deps.db.query<{ created_at: Date }>('select "createdAt" as created_at from "user" where id = $1', [s.userId])
    const fake = new FakeServer({ now: () => h.clock.now, accountCreatedAt: user!.created_at.getTime() })
    // The server creates the entitlement with the learner, as version 1.
    fake.setServerOwned(DOCUMENT_TYPES.entitlement, '', defaultEntitlementFields(), 0)

    const t0 = h.clock.now
    const a = (seq: number, minutesAgo: number, over = {}) => rawEvent('dev-a', seq, t0 - minutesAgo * MINUTE, over)
    const fast = t0 + 2 * HOUR // dev-b's clock is two hours fast
    const b = (seq: number, minutesAgo: number, over = {}) => rawEvent('dev-b', seq, fast - minutesAgo * MINUTE, over)
    const today = dayToIsoDate(localDay(t0 - 30 * MINUTE, TZ))
    const lastOfFirstPush = pushPage('dev-a', t0, [a(4, 27, { wordId: 'c:w-3' }), a(5, 26, { wordId: 'c:w-2', grade: Grade.Hard })], {
      pushId: 'p1',
      page: 1,
      lastPage: true,
      dayComplete: [{ localDate: today, ruleVersion: 'r1' }],
    })
    const pages: PushPage[] = [
      pushPage('dev-a', t0, [a(1, 30, { wordId: 'c:w-1' }), a(2, 29, { wordId: 'c:w-2' }), a(3, 28, { wordId: 'c:w-1', grade: Grade.Again })], {
        pushId: 'p1',
        page: 0,
        lastPage: false,
        documents: [write('settings', '', { newWordLimit: 5 }), write('unit_unlock', '', { units: ['a1-01'] })],
      }),
      lastOfFirstPush,
      pushPage('dev-b', fast, [b(1, 20, { wordId: 'c:w-1' }), b(2, 19, { wordId: 'c:w-4' })], {
        pushId: 'p2',
        documents: [
          write('settings', '', { retention: 'relaxed' }),
          write('unit_unlock', '', { units: ['a1-02'] }),
          write('entitlement', '', { tier: 'plus' }),
          write('settings', '', { newWordLimit: 99 }),
          write('word_flag', 'c:w-4', { flag: 'known' }),
        ],
      }),
      // The first push's last page again, as after a lost response.
      lastOfFirstPush,
      pushPage('dev-a', t0, [a(6, 5, { wordId: 'c:w-5', practice: true }), a(7, 4, { wordId: 'c:w-1', mode: 'matching' }), a(8, 3, { wordId: 'c:w-6', latencyMs: 100 })], {
        pushId: 'p3',
      }),
    ]
    for (const page of pages) {
      const real = await s.post('/v1/sync/push', page)
      expect(real.status).toBe(200)
      expect(real.body).toEqual(await fake.push(page))
      h.clock.advance(1_000)
    }
    for (const deviceId of ['dev-a', 'dev-b']) {
      const pull = { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId, documentsSince: 0 }
      const real = (await s.post('/v1/sync/pull', pull)).body as PullResponse
      expect(normalise(real)).toEqual(normalise(await fake.pull(pull)))
    }
  })
})
