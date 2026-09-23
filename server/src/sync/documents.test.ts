import { SYNC_PROTOCOL_VERSION, type DocumentWrite } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { pushPage, rawEvent } from '../../test/events'
import { STALE } from './derive'

const write = (type: string, key: string, fields: Record<string, unknown>, baseVersion = 0, deleted?: boolean): DocumentWrite => ({
  type,
  key,
  patch: deleted === undefined ? { baseVersion, fields } : { baseVersion, fields, deleted },
})

async function push(h: Harness, s: Session, documents: DocumentWrite[], deviceId = 'dev-a') {
  const reply = await s.post('/v1/sync/push', pushPage(deviceId, h.clock.now, [], { documents }))
  expect(reply.status).toBe(200)
  return reply.body
}

async function counter(h: Harness, s: Session): Promise<number> {
  const [row] = await h.deps.db.query<{ document_version: number }>('select document_version from learner where user_id = $1', [s.userId])
  return row?.document_version ?? 0
}

describe('document writes (spec §9.2)', () => {
  it('numbers accepted writes from one per-learner counter, after the entitlement', async () => {
    const h = harness()
    const s = await h.signIn()
    const first = await push(h, s, [write('settings', '', { newWordLimit: 5 })])
    expect(first.documents).toEqual([
      {
        type: 'settings',
        key: '',
        class: 'versioned',
        version: 2,
        fields: { newWordLimit: 5 },
        fieldVersions: { newWordLimit: 2 },
        deleted: false,
        staleAfter: null,
      },
    ])
    const second = await push(h, s, [write('word_flag', 'c:hello-1', { flag: 'known' })])
    expect(second.documents[0].version).toBe(3)
    expect(await counter(h, s)).toBe(3)
  })

  it('merges a stale write field by field; the later arrival wins a field changed on both (spec §9.2)', async () => {
    const h = harness()
    const s = await h.signIn()
    await push(h, s, [write('settings', '', { newWordLimit: 5, reviewCap: 80 })], 'dev-a')
    const merged = await push(h, s, [write('settings', '', { retention: 'relaxed', reviewCap: 50 })], 'dev-b')
    expect(merged.documents[0]).toMatchObject({
      version: 3,
      fields: { newWordLimit: 5, retention: 'relaxed', reviewCap: 50 },
      fieldVersions: { newWordLimit: 2, retention: 3, reviewCap: 3 },
    })
  })

  it('unions unit unlocks, so a stale write never re-locks a unit', async () => {
    const h = harness()
    const s = await h.signIn()
    await push(h, s, [write('unit_unlock', '', { units: ['a1-01', 'a1-02'] })], 'dev-a')
    const later = await push(h, s, [write('unit_unlock', '', { units: ['a1-03'] })], 'dev-b')
    expect(later.documents[0].fields).toEqual({ units: ['a1-01', 'a1-02', 'a1-03'] })
  })

  it('refuses a server-owned type whether or not it exists, and spends no version (spec §8.8)', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await push(h, s, [write('entitlement', '', { tier: 'plus' }), write('entitlement', 'other', { tier: 'plus' })])
    expect(reply.rejected).toEqual([
      { type: 'entitlement', key: '', reason: 'server_owned' },
      { type: 'entitlement', key: 'other', reason: 'server_owned' },
    ])
    expect(await counter(h, s)).toBe(1)
    const [doc] = await h.deps.db.query<{ fields: { tier: string } }>(`select fields from document where user_id = $1 and type = 'entitlement'`, [s.userId])
    expect(doc?.fields.tier).toBe('free')
  })

  it('refuses a base ahead of the server', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await push(h, s, [write('settings', '', { newWordLimit: 5 }, 99)])
    expect(reply.rejected).toEqual([{ type: 'settings', key: '', reason: 'base_ahead_of_server' }])
  })

  it('stores the answers and rejects only the malformed document beside them (Review Focus)', async () => {
    const h = harness()
    const s = await h.signIn()
    const events = [1, 2, 3].map((n) => rawEvent('dev-a', n, h.clock.now - n * 60_000, { wordId: `c:w-${n}` }))
    const reply = await s.post(
      '/v1/sync/push',
      pushPage('dev-a', h.clock.now, events, {
        documents: [write('settings', '', { newWordLimit: 99 }), write('word_flag', 'c:w-1', { flag: 'suspended' })],
      }),
    )
    expect(reply.body.rejected).toEqual([{ type: 'settings', key: '', reason: 'invalid' }])
    expect(reply.body.documents.map((d: { type: string; version: number }) => [d.type, d.version])).toEqual([['word_flag', 2]])
    expect(await h.deps.db.query('select review_id from review_event where user_id = $1', [s.userId])).toHaveLength(3)
    expect(await h.deps.db.query('select word_id from review_state where user_id = $1', [s.userId])).toHaveLength(3)
    expect(await counter(h, s)).toBe(2)
  })

  it('tombstones a flag and restores it on undelete (spec §7.4)', async () => {
    const h = harness()
    const s = await h.signIn()
    await push(h, s, [write('word_flag', 'c:hello-1', { flag: 'known' })])
    const gone = await push(h, s, [write('word_flag', 'c:hello-1', {}, 2, true)])
    expect(gone.documents[0]).toMatchObject({ version: 3, deleted: true, fields: { flag: 'known' } })
    const back = await push(h, s, [write('word_flag', 'c:hello-1', {}, 3, false)])
    expect(back.documents[0]).toMatchObject({ version: 4, deleted: false, fields: { flag: 'known' } })
  })

  it('keeps a content report in its own table, with its reporter (spec §8.10)', async () => {
    const h = harness()
    const s = await h.signIn()
    const report = { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0, createdAt: h.clock.now }
    await push(h, s, [write('content_report', 'rep-1', report)])
    const rows = await h.deps.db.query('select reporter_id, report_key, word_id, field, note, pack_version from content_report')
    expect(rows).toEqual([{ reporter_id: s.userId, report_key: 'rep-1', word_id: 'c:hello-1', field: 'audio', note: 'robotic', pack_version: 0 }])
  })

  it('marks the learner for a full re-derivation when an alias changes, and asks the queue (spec §6.1)', async () => {
    const h = harness()
    const s = await h.signIn()
    const bad = await push(h, s, [write('word_alias', 'c:bank-1', { target: 'c:bank-2' })])
    expect(bad.rejected).toEqual([{ type: 'word_alias', key: 'c:bank-1', reason: 'invalid' }])
    expect(h.jobs).toEqual([])
    await push(h, s, [write('word_alias', 'u:bank-mine', { target: 'c:bank-1' })])
    expect(h.jobs).toEqual([{ kind: 'rederive', userId: s.userId }])
    const [learner] = await h.deps.db.query<{ derived_scheduler_version: string }>('select derived_scheduler_version from learner where user_id = $1', [s.userId])
    expect(learner?.derived_scheduler_version).toBe(STALE)
  })

  it('gives two sessions writing at the same moment distinct versions (Review Focus)', async () => {
    const h = harness()
    const a = await h.signIn('same@example.com')
    const b = await h.signIn('same@example.com')
    const [one, two] = await Promise.all([
      push(h, a, [write('word_flag', 'c:w-1', { flag: 'known' })], 'dev-a'),
      push(h, b, [write('word_flag', 'c:w-2', { flag: 'known' })], 'dev-b'),
    ])
    expect([one.documents[0].version, two.documents[0].version].sort()).toEqual([2, 3])
    expect(await counter(h, a)).toBe(3)
  })

  it('refuses a malformed write list whole, as any malformed page', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await s.post('/v1/sync/push', {
      ...pushPage('dev-a', h.clock.now, []),
      protocolVersion: SYNC_PROTOCOL_VERSION,
      documents: [{ type: 'settings', key: '', patch: { baseVersion: 'zero', fields: {} } }],
    })
    expect(reply.status).toBe(400)
  })
})
