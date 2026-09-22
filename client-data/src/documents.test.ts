import type { WireDocument } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { applyServerDocument, confirmPushedDocument, getDocument, pendingDocumentWrites, writeLocalPatch } from './documents'
import { addContentReport, addUnlocks, patchSettings, readEntitlement, readFlags, readSettings, readUnlocks, setFlag } from './documentTypes'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { migrate } from './schema'
import { testEnv } from './testing/testEnv'

async function open() {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  return db
}

const wire = (over: Partial<WireDocument>): WireDocument => ({
  type: 'settings',
  key: '',
  class: 'versioned',
  version: 5,
  fields: { newWordLimit: 12, reviewCap: 80 },
  fieldVersions: { newWordLimit: 5, reviewCap: 3 },
  deleted: false,
  staleAfter: null,
  ...over,
})

describe('local patches', () => {
  it('creates a document locally at version 0 with the edit pending', async () => {
    const db = await open()
    const doc = await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 5 }))
    expect(doc).toMatchObject({ version: 0, fields: { newWordLimit: 5 }, patch: { baseVersion: 0, fields: { newWordLimit: 5 } } })
    expect(await pendingDocumentWrites(db.driver)).toEqual([{ type: 'settings', key: '', patch: { baseVersion: 0, fields: { newWordLimit: 5 } } }])
  })

  it('folds successive edits into one patch against the version the first edit saw', async () => {
    const db = await open()
    await db.transaction((tx) => applyServerDocument(tx, wire({})))
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    await db.transaction((tx) => applyServerDocument(tx, wire({ version: 6, fields: { newWordLimit: 12, reviewCap: 90 } })))
    const doc = await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { reviewCap: 50 }))
    expect(doc.version).toBe(6)
    expect(doc.fields).toEqual({ newWordLimit: 7, reviewCap: 50 })
    expect(doc.patch).toEqual({ baseVersion: 5, fields: { newWordLimit: 7, reviewCap: 50 } })
  })

  it('re-applies a pending edit on top of a pulled copy, and the pull otherwise wins', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    const doc = await db.transaction((tx) => applyServerDocument(tx, wire({})))
    expect(doc.fields).toEqual({ newWordLimit: 7, reviewCap: 80 })
    expect(doc.version).toBe(5)
    expect(doc.patch).toEqual({ baseVersion: 0, fields: { newWordLimit: 7 } })
  })

  it('clears the patch when the push confirms it, but keeps an edit made meanwhile', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    const sent = (await pendingDocumentWrites(db.driver))[0]!.patch
    const confirmed = await db.transaction((tx) => confirmPushedDocument(tx, wire({ version: 1, fields: { newWordLimit: 7 } }), sent))
    expect(confirmed.patch).toBeNull()
    expect(confirmed.version).toBe(1)
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 9 }))
    const sent2 = (await pendingDocumentWrites(db.driver))[0]!.patch
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { reviewCap: 40 }))
    const later = await db.transaction((tx) => confirmPushedDocument(tx, wire({ version: 2, fields: { newWordLimit: 9 } }), sent2))
    expect(later.version).toBe(2)
    expect(later.fields).toEqual({ newWordLimit: 9, reviewCap: 40 })
    expect(later.patch).toEqual({ baseVersion: 1, fields: { newWordLimit: 9, reviewCap: 40 } })
  })

  it('tombstones and undeletes through the patch', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', { flag: 'known' }))
    const gone = await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', {}, true))
    expect(gone.deleted).toBe(true)
    expect(gone.patch).toEqual({ baseVersion: 0, fields: { flag: 'known' }, deleted: true })
    const back = await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', { flag: 'suspended' }, false))
    expect(back.deleted).toBe(false)
    expect(back.patch?.deleted).toBe(false)
  })

  it('unions unit unlocks locally and against the server, and never re-locks', async () => {
    const db = await open()
    await db.transaction((tx) => addUnlocks(tx, ['a1-02', 'a1-01']))
    await db.transaction((tx) => addUnlocks(tx, ['a1-03']))
    expect([...(await readUnlocks(db.driver))]).toEqual(['a1-01', 'a1-02', 'a1-03'])
    const doc = await db.transaction((tx) =>
      applyServerDocument(tx, wire({ type: 'unit_unlock', version: 3, fields: { units: ['a1-01', 'a1-09'] }, fieldVersions: { units: 3 } })),
    )
    expect(doc.fields).toEqual({ units: ['a1-01', 'a1-02', 'a1-03', 'a1-09'] })
    expect(doc.patch).toEqual({ baseVersion: 0, fields: { units: ['a1-01', 'a1-02', 'a1-03'] } })
  })

  it('refuses a local write to a server-owned document', async () => {
    const db = await open()
    await db.transaction((tx) => applyServerDocument(tx, wire({ type: 'entitlement', class: 'server_owned', fields: { tier: 'free' }, staleAfter: 99 })))
    await expect(db.transaction((tx) => writeLocalPatch(tx, 'entitlement', '', { tier: 'plus' }))).rejects.toThrow(/server-owned/)
    expect((await getDocument(db.driver, 'entitlement', ''))?.fields).toEqual({ tier: 'free' })
  })
})

describe('typed documents', () => {
  it('reads settings with defaults and ignores an invalid stored field', async () => {
    const db = await open()
    expect((await readSettings(db.driver)).newWordLimit).toBe(10)
    await db.transaction((tx) => applyServerDocument(tx, wire({ fields: { newWordLimit: 99, retention: 'relaxed' } })))
    const settings = await readSettings(db.driver)
    expect(settings.newWordLimit).toBe(10)
    expect(settings.retention).toBe('relaxed')
  })

  it('validates a settings patch before storing it', async () => {
    const db = await open()
    await expect(db.transaction((tx) => patchSettings(tx, { newWordLimit: 31 }))).rejects.toThrow(/newWordLimit/)
    const settings = await db.transaction((tx) => patchSettings(tx, { newWordLimit: 3, dailyGoal: 20 }))
    expect(settings).toMatchObject({ newWordLimit: 3, dailyGoal: 20, reviewCap: 100 })
  })

  it('sets and clears word flags', async () => {
    const db = await open()
    await db.transaction((tx) => setFlag(tx, 'c:hello-1', 'known'))
    await db.transaction((tx) => setFlag(tx, 'c:water-1', 'suspended'))
    expect([...(await readFlags(db.driver))]).toEqual([
      ['c:hello-1', 'known'],
      ['c:water-1', 'suspended'],
    ])
    await db.transaction((tx) => setFlag(tx, 'c:hello-1', null))
    expect([...(await readFlags(db.driver))]).toEqual([['c:water-1', 'suspended']])
  })

  it('reads the entitlement with its version and staleness', async () => {
    const db = await open()
    expect(await readEntitlement(db.driver)).toBeNull()
    await db.transaction((tx) =>
      applyServerDocument(
        tx,
        wire({
          type: 'entitlement',
          class: 'server_owned',
          version: 4,
          fields: { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } },
          fieldVersions: {},
          staleAfter: 1_000,
        }),
      ),
    )
    expect(await readEntitlement(db.driver)).toEqual({ tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 }, version: 4, staleAfter: 1_000 })
  })

  it('files a content report as a pending document', async () => {
    const db = await open()
    const env = testEnv()
    const key = await db.transaction((tx) => addContentReport(tx, env, { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0 }))
    const writes = await pendingDocumentWrites(db.driver)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ type: 'content_report', key, patch: { baseVersion: 0, fields: { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0, createdAt: env.now() } } })
  })
})
