import { describe, expect, it } from 'vitest'
import { checkDocumentWrite, DOCUMENT_TYPES, MAX_DOCUMENT_BYTES, MAX_PACK_VERSION, MAX_REPORT_NOTE_LENGTH, MAX_REPORT_SUGGESTION_LENGTH, SERVER_OWNED_DOCUMENT_TYPES } from './documentRules'
import type { DocumentWrite } from './syncProtocol'

const write = (type: string, key: string, fields: Record<string, unknown>, deleted?: boolean): DocumentWrite => ({
  type,
  key,
  patch: deleted === undefined ? { baseVersion: 0, fields } : { baseVersion: 0, fields, deleted },
})

const report = { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0, createdAt: 1_790_000_000_000 }

const reportWrite = (fields: Record<string, unknown>): DocumentWrite => write('content_report', 'rep-l1', { ...report, ...fields })

describe('checkDocumentWrite', () => {
  it('accepts every write client-data makes', () => {
    for (const w of [
      write('settings', '', { newWordLimit: 5, retention: 'relaxed' }),
      write('word_flag', 'c:hello-1', { flag: 'known' }),
      write('word_flag', 'c:hello-1', {}, true),
      write('word_learn', 'c:hello-1', { at: 1_790_000_000_000 }),
      write('word_learn', 'c:hello-1', {}, true),
      write('word_learn', 'c:hello-1', { at: 1_790_000_000_001 }, false),
      write('unit_unlock', '', { units: ['a1-01', 'a1-02'] }),
      write('word_alias', 'u:0b6f', { target: 'c:hello-1' }),
      write('word_alias', 'u:0b6f', {}, true),
      write('content_report', '7d9b1c2e-4f5a-4b6c-9d8e-0f1a2b3c4d5e', report),
      write('content_report', 'rep-2', { ...report, packVersion: MAX_PACK_VERSION }),
      write('content_report', 'rep-3', { ...report, field: 'translation', suggestion: 'x'.repeat(MAX_REPORT_SUGGESTION_LENGTH) }),
    ]) {
      expect(checkDocumentWrite(w)).toEqual({ ok: true })
    }
  })

  it('rejects every write to a server-owned type, whatever it carries', () => {
    expect(SERVER_OWNED_DOCUMENT_TYPES.has(DOCUMENT_TYPES.entitlement)).toBe(true)
    expect(checkDocumentWrite(write('entitlement', '', { tier: 'plus' }))).toMatchObject({ ok: false, reason: 'server_owned' })
    expect(checkDocumentWrite(write('entitlement', '', {}))).toMatchObject({ ok: false, reason: 'server_owned' })
  })

  const { wordId: _dropped, ...reportWithoutWord } = report
  it.each([
    ['an unknown type', write('league', '', {})],
    ['settings under a key', write('settings', 'x', { newWordLimit: 5 })],
    ['an out-of-range setting', write('settings', '', { newWordLimit: 99 })],
    ['an unknown setting', write('settings', '', { theme: 'dark' })],
    ['a flag on something that is not a word', write('word_flag', 'hello', { flag: 'known' })],
    ['an unknown flag', write('word_flag', 'c:hello-1', { flag: 'easy' })],
    ['an unknown flag field', write('word_flag', 'c:hello-1', { flag: 'known', note: 'x' })],
    ['a word to learn that is not a word', write('word_learn', 'hello', { at: 1 })],
    ['a word to learn chosen at no time', write('word_learn', 'c:hello-1', { at: 'now' })],
    ['a word to learn with no time of choosing', write('word_learn', 'c:hello-1', {})],
    ['a mark restored with no time of choosing', write('word_learn', 'c:hello-1', {}, false)],
    ['a word to learn chosen at an unsafe time', write('word_learn', 'c:hello-1', { at: 2 ** 53 })],
    ['an unknown field on a word to learn', write('word_learn', 'c:hello-1', { at: 1, flag: 'known' })],
    ['unlocks under a key', write('unit_unlock', 'x', { units: ['a1-01'] })],
    ['a unit that is not an ID', write('unit_unlock', '', { units: ['../a1'] })],
    ['units that are not a list', write('unit_unlock', '', { units: 'a1-01' })],
    ['an alias from a corpus word', write('word_alias', 'c:hello-1', { target: 'c:hello-2' })],
    ['an alias to a user word', write('word_alias', 'u:0b6f', { target: 'u:1c2d' })],
    ['a report without its word', write('content_report', 'rep-1', reportWithoutWord)],
    ['a report on an unknown field', write('content_report', 'rep-1', { ...report, field: 'spelling' })],
    ['a report with a long note', write('content_report', 'rep-1', { ...report, note: 'x'.repeat(MAX_REPORT_NOTE_LENGTH + 1) })],
    ['a report with a long suggestion', write('content_report', 'rep-1', { ...report, suggestion: 'x'.repeat(MAX_REPORT_SUGGESTION_LENGTH + 1) })],
    ['a report whose suggestion is not text', write('content_report', 'rep-1', { ...report, suggestion: 7 })],
    ['a report with a negative pack version', write('content_report', 'rep-1', { ...report, packVersion: -1 })],
    ['a report created at an unsafe time', write('content_report', 'rep-1', { ...report, createdAt: 2 ** 53 })],
    ['a report with a pack version past a 32-bit integer', write('content_report', 'rep-1', { ...report, packVersion: 2_147_483_648 })],
    ['a report under a key that is not an ID', write('content_report', 'a b', report)],
    ['an oversized patch', write('settings', '', { activeTheme: 'x'.repeat(MAX_DOCUMENT_BYTES) })],
  ])('rejects %s as invalid', (_, w) => {
    expect(checkDocumentWrite(w)).toMatchObject({ ok: false, reason: 'invalid' })
  })

  it('accepts a report with no suggestion: a client older than the suggestion sends none', () => {
    expect('suggestion' in report).toBe(false)
    expect(checkDocumentWrite(reportWrite({}))).toEqual({ ok: true })
    expect(checkDocumentWrite(reportWrite({ suggestion: '' }))).toEqual({ ok: true })
  })

  it('accepts a report’s L1 when it is a supported language, and still accepts a report without one', () => {
    expect(checkDocumentWrite(reportWrite({ l1: 'de' })).ok).toBe(true)
    expect(checkDocumentWrite(reportWrite({ l1: 'es' })).ok).toBe(true)
    expect(checkDocumentWrite(reportWrite({})).ok).toBe(true)
    expect(checkDocumentWrite(reportWrite({ l1: 'xx' })).ok).toBe(false)
  })
})
