import {
  appendAnswer,
  Database,
  ensureDevice,
  loadLearner,
  migrate as migrateClient,
  patchSettings,
  readPulledXp,
  readSettings,
  SyncEngine,
  type AnswerInput,
  type SyncTransport,
} from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { Grade, replay, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Session } from '../../test/harness'
import { loadEvents, toStampedEvent } from './events'

/** What plan 6's web transport will be: two JSON posts that throw on anything but 200. */
function transportFor(session: Session): SyncTransport {
  const call = async (path: string, body: unknown) => {
    const reply = await session.post(path, body)
    if (reply.status !== 200) throw new Error(`${path}: ${reply.status}`)
    return reply.body
  }
  return { push: (page) => call('/v1/sync/push', page), pull: (request) => call('/v1/sync/pull', request) }
}

async function device(session: Session, env: TestEnv) {
  const db = new Database(nodeSqliteDriver())
  await migrateClient(db)
  const learner = await loadLearner(db, await ensureDevice(db, env))
  return { db, learner, engine: new SyncEngine({ db, env, learner, transport: transportFor(session) }) }
}

const answer = (wordId: string, grade: Grade = Grade.Good): AnswerInput => ({
  wordId: wordId as WordId,
  mode: 'multiple_choice',
  direction: 'en_to_l1',
  grade,
  latencyMs: 1500,
  practice: false,
})

describe('client-data against the real server', () => {
  it('carries answers, settings and XP from one device to another, and keeps offline answers across a pull', async () => {
    const env = testEnv(Date.now())
    const h = harness({ now: () => env.now() })
    const session = await h.signIn()
    const a = await device(session, env)
    for (const word of ['c:hello-1', 'c:water-1', 'c:bread-1']) {
      await appendAnswer(a.db, env, a.learner, answer(word))
      env.advance(5_000)
    }
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 5 }))
    expect(await a.engine.sync()).toBe('synced')

    const b = await device(session, env)
    expect(await b.engine.sync()).toBe('synced')
    expect(b.learner.states).toEqual(a.learner.states)
    expect((await readSettings(b.db.driver)).newWordLimit).toBe(5)

    // Both answer while apart; a's answer must survive b's push and a's own pull.
    env.advance(60_000)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1', Grade.Again))
    env.advance(5_000)
    await appendAnswer(b.db, env, b.learner, answer('c:milk-1'))
    expect(await b.engine.sync()).toBe('synced')
    expect(await a.engine.sync()).toBe('synced')
    expect(await b.engine.sync()).toBe('synced')

    const log = (await loadEvents(h.deps.db, session.userId)).map(toStampedEvent)
    expect(log).toHaveLength(5)
    const server = replay(log)
    expect(a.learner.states).toEqual(server)
    expect(b.learner.states).toEqual(server)
    expect(await readPulledXp(a.db.driver)).toEqual(await readPulledXp(b.db.driver))
    expect((await readPulledXp(a.db.driver))?.total).toBe(40)
  })
})
