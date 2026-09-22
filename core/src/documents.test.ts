import { describe, expect, it } from 'vitest'
import { applyPatch, createDocument, mergeUnlockSets, type VersionedDocument } from './documents'

interface Settings {
  readonly newWordLimit: number
  readonly retention: 'relaxed' | 'standard' | 'intensive'
  readonly note: string
}

const initial: VersionedDocument<Settings> = createDocument({ newWordLimit: 10, retention: 'standard', note: '' }, 1)

describe('createDocument', () => {
  it('stamps every field with the creating version', () => {
    expect(initial).toEqual({
      version: 1,
      fields: { newWordLimit: 10, retention: 'standard', note: '' },
      fieldVersions: { newWordLimit: 1, retention: 1, note: 1 },
      deleted: false,
    })
  })
})

describe('applyPatch', () => {
  it('accepts a write against the current version and bumps the changed fields', () => {
    const result = applyPatch(initial, { baseVersion: 1, fields: { newWordLimit: 15 } }, 2)
    expect(result).toEqual({
      accepted: true,
      merged: false,
      document: {
        version: 2,
        fields: { newWordLimit: 15, retention: 'standard', note: '' },
        fieldVersions: { newWordLimit: 2, retention: 1, note: 1 },
        deleted: false,
      },
    })
  })

  it('merges a stale write field by field: unrelated server changes survive', () => {
    const serverSide = applyPatch(initial, { baseVersion: 1, fields: { retention: 'intensive' } }, 2)
    if (!serverSide.accepted) throw new Error('unreachable')
    // A second device, still on version 1, edits only the limit.
    const result = applyPatch(serverSide.document, { baseVersion: 1, fields: { newWordLimit: 20 } }, 3)
    expect(result).toMatchObject({
      accepted: true,
      merged: true,
      document: { version: 3, fields: { newWordLimit: 20, retention: 'intensive', note: '' } },
    })
  })

  it('lets the write that reaches the server later win a field changed on both sides', () => {
    const first = applyPatch(initial, { baseVersion: 1, fields: { note: 'from the phone' } }, 2)
    if (!first.accepted) throw new Error('unreachable')
    const second = applyPatch(first.document, { baseVersion: 1, fields: { note: 'from the laptop' } }, 3)
    expect(second).toMatchObject({ accepted: true, merged: true, document: { fields: { note: 'from the laptop' } } })
    if (!second.accepted) throw new Error('unreachable')
    expect(second.document.fieldVersions.note).toBe(3)
  })

  it('ignores undefined fields in a patch', () => {
    // The type forbids it; a JavaScript caller can still send one.
    const fields = { note: undefined } as unknown as Partial<Settings>
    const result = applyPatch(initial, { baseVersion: 1, fields }, 2)
    expect(result).toMatchObject({ accepted: true, document: { fields: initial.fields, fieldVersions: initial.fieldVersions } })
  })

  it('tombstones and undeletes, keeping the fields throughout', () => {
    const deleted = applyPatch(initial, { baseVersion: 1, fields: {}, deleted: true }, 2)
    expect(deleted).toMatchObject({ accepted: true, document: { deleted: true, fields: initial.fields } })
    if (!deleted.accepted) throw new Error('unreachable')
    const restored = applyPatch(deleted.document, { baseVersion: 2, fields: {}, deleted: false }, 3)
    expect(restored).toMatchObject({ accepted: true, document: { deleted: false, fields: initial.fields, version: 3 } })
  })

  it('rejects a client write to a server-owned document', () => {
    const result = applyPatch(initial, { baseVersion: 1, fields: { note: 'x' } }, 2, 'server_owned')
    expect(result).toEqual({ accepted: false, reason: 'server_owned' })
  })

  it('rejects a base version the server has never issued, and a version that does not move forward', () => {
    expect(applyPatch(initial, { baseVersion: 5, fields: {} }, 6)).toEqual({ accepted: false, reason: 'base_ahead_of_server' })
    expect(applyPatch(initial, { baseVersion: 1, fields: {} }, 1)).toEqual({ accepted: false, reason: 'version_not_newer' })
  })
})

describe('mergeUnlockSets', () => {
  it('is union: nothing re-locks a unit', () => {
    expect(mergeUnlockSets(new Set(['a1-u1', 'a1-u2']), ['a1-u1', 'a2-u1'], [])).toEqual(new Set(['a1-u1', 'a1-u2', 'a2-u1']))
  })
})
