import { DOCUMENT_TYPES, SCHEDULER_VERSION } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { createTestUser, testDb } from '../test/db'
import { defaultEntitlementFields, lockLearner } from './learner'

describe('lockLearner', () => {
  it('creates the learner and the default entitlement once', async () => {
    const db = testDb()
    const userId = await createTestUser(db)
    expect(await db.transaction((tx) => lockLearner(tx, userId))).toEqual({ documentVersion: 1, derivedSchedulerVersion: SCHEDULER_VERSION })
    expect(await db.transaction((tx) => lockLearner(tx, userId))).toEqual({ documentVersion: 1, derivedSchedulerVersion: SCHEDULER_VERSION })
    const docs = await db.query('select type, key, class, version, fields, deleted from document where user_id = $1', [userId])
    expect(docs).toEqual([
      { type: DOCUMENT_TYPES.entitlement, key: '', class: 'server_owned', version: 1, fields: defaultEntitlementFields(), deleted: false },
    ])
  })

  it('makes a second transaction on the same learner wait for the first', async () => {
    const db = testDb()
    const userId = await createTestUser(db)
    await db.transaction((tx) => lockLearner(tx, userId))
    const order: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const first = db.transaction(async (tx) => {
      await lockLearner(tx, userId)
      order.push('first locked')
      await held
      order.push('first done')
    })
    // Give the first transaction time to take the lock.
    await new Promise((resolve) => setTimeout(resolve, 100))
    const second = db.transaction(async (tx) => {
      await lockLearner(tx, userId)
      order.push('second locked')
    })
    await new Promise((resolve) => setTimeout(resolve, 100))
    release()
    await Promise.all([first, second])
    expect(order).toEqual(['first locked', 'first done', 'second locked'])
  })
})
