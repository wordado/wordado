import { replay, SCHEDULER_VERSION, type ReviewState, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { pushPage, rawEvent } from '../../test/events'
import { loadEvents, toStampedEvent } from '../sync/events'
import { handleJob, REDERIVE_BATCH, REDERIVE_RETRY_MS, requestStaleRederivations } from './rederive'
import { cleanupPushWindows, PUSH_WINDOW_TTL_MS, runScheduled } from './scheduled'

const MINUTE = 60_000

async function answer(h: Harness, s: Session, words: readonly string[], deviceId = 'dev-a'): Promise<void> {
  const events = words.map((word, i) => rawEvent(deviceId, i + 1, h.clock.now - (words.length - i) * MINUTE, { wordId: word as WordId }))
  const reply = await s.post('/v1/sync/push', pushPage(deviceId, h.clock.now, events))
  expect(reply.body.status).toBe('ok')
}

async function setVersion(h: Harness, s: Session, version: string): Promise<void> {
  await h.deps.db.query('update learner set derived_scheduler_version = $2 where user_id = $1', [s.userId, version])
}

async function states(h: Harness, s: Session): Promise<Map<string, ReviewState>> {
  const rows = await h.deps.db.query<{ state: ReviewState }>('select state from review_state where user_id = $1', [s.userId])
  return new Map(rows.map((r) => [r.state.wordId, r.state]))
}

describe('re-derivation (spec §4.3)', () => {
  it('requests a job for each learner derived under another scheduler version, once an hour', async () => {
    const h = harness()
    const old = await h.signIn()
    const current = await h.signIn()
    await answer(h, old, ['c:w-1'])
    await answer(h, current, ['c:w-1'])
    await setVersion(h, old, 'fsrs5-old')
    expect(await requestStaleRederivations(h.deps)).toBe(1)
    expect(h.jobs).toEqual([{ kind: 'rederive', userId: old.userId }])
    expect(await requestStaleRederivations(h.deps)).toBe(0)
    h.clock.advance(REDERIVE_RETRY_MS + 1)
    expect(await requestStaleRederivations(h.deps)).toBe(1)
  })

  it(`asks for at most ${REDERIVE_BATCH} learners per run`, async () => {
    const h = harness()
    const s = await h.signIn()
    await answer(h, s, ['c:w-1'])
    const [row] = await h.deps.db.query<{ created_at: Date }>('select "createdAt" as created_at from "user" where id = $1', [s.userId])
    // Many stale learners, written directly: signing in 101 people would be slow and prove nothing more.
    await h.deps.db.query(
      `insert into "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       select 'bulk-' || n, '', 'bulk-' || n || '@example.com', true, $1, $1 from generate_series(1, $2) as n`,
      [row!.created_at, REDERIVE_BATCH + 5],
    )
    await h.deps.db.query(`insert into learner (user_id, derived_scheduler_version) select id, 'fsrs5-old' from "user" where id like 'bulk-%'`)
    expect(await requestStaleRederivations(h.deps)).toBe(REDERIVE_BATCH)
    expect(await requestStaleRederivations(h.deps)).toBe(5)
  })

  it("rebuilds a learner's state from the log and records the current version", async () => {
    const h = harness()
    const s = await h.signIn()
    await answer(h, s, ['c:w-1', 'c:w-2', 'c:w-1'])
    await h.deps.db.query(`update review_state set state = '{}'::jsonb where user_id = $1`, [s.userId])
    await setVersion(h, s, 'fsrs5-old')
    await handleJob(h.deps, { kind: 'rederive', userId: s.userId })
    const log = (await loadEvents(h.deps.db, s.userId)).map(toStampedEvent)
    expect(await states(h, s)).toEqual(replay(log))
    const [learner] = await h.deps.db.query<{ derived_scheduler_version: string }>('select derived_scheduler_version from learner where user_id = $1', [s.userId])
    expect(learner?.derived_scheduler_version).toBe(SCHEDULER_VERSION)
  })

  it('merges a user word into its entry once the queue runs after an alias (spec §6.1)', async () => {
    const h = harness()
    const s = await h.signIn()
    await answer(h, s, ['u:bank-mine', 'c:bank-1'])
    await s.post(
      '/v1/sync/push',
      pushPage('dev-a', h.clock.now, [], { documents: [{ type: 'word_alias', key: 'u:bank-mine', patch: { baseVersion: 0, fields: { target: 'c:bank-1' } } }] }),
    )
    for (const job of h.jobs.splice(0)) await handleJob(h.deps, job)
    const merged = await states(h, s)
    expect([...merged.keys()]).toEqual(['c:bank-1'])
    expect(merged.get('c:bank-1')?.reps).toBe(2)
  })

  it('does nothing for a learner deleted after the job was queued', async () => {
    const h = harness()
    await expect(handleJob(h.deps, { kind: 'rederive', userId: 'gone' })).resolves.toBeUndefined()
    expect(await h.deps.db.query('select user_id from learner')).toEqual([])
  })
})

describe('the cron', () => {
  it('drops push windows a day after they opened', async () => {
    const h = harness()
    const s = await h.signIn()
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [rawEvent('dev-a', 1, h.clock.now - MINUTE)], { pushId: 'abandoned', lastPage: false }))
    h.clock.advance(PUSH_WINDOW_TTL_MS - 1)
    expect(await cleanupPushWindows(h.deps)).toBe(0)
    h.clock.advance(2)
    expect(await cleanupPushWindows(h.deps)).toBe(1)
  })

  it('runs every step, and reports a failure only after all have run', async () => {
    const h = harness()
    const s = await h.signIn()
    await answer(h, s, ['c:w-1'])
    await setVersion(h, s, 'fsrs5-old')
    const failing = { ...h.deps, jobs: { ...h.deps.jobs, sendBatch: async () => Promise.reject(new Error('queue down')) } }
    await s.post('/v1/sync/push', pushPage('dev-a', h.clock.now, [], { pushId: 'old', lastPage: false }))
    h.clock.advance(PUSH_WINDOW_TTL_MS + 1)
    await expect(runScheduled(failing)).rejects.toThrow(AggregateError)
    expect(await h.deps.db.query('select push_id from push_window')).toEqual([])
  })
})
