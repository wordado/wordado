import type { Corpus, CorpusEntry, FixesFile, ReportRecord } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { FIXES_SEEN_KEY, FixNotices, type FixSource } from './fixNotices'

const URL_ = 'https://content.wordado.com/manifest.json'
const fixes: FixesFile = { schema_version: 1, corpus_version: 2, fixes: [{ word_id: 'c:bank-1', field: 'translation', fixed_in: 2 }, { word_id: 'c:gone-1', field: 'audio', fixed_in: 2 }] }
const bank = { entryId: 'bank-1', headword: 'bank' } as CorpusEntry
const corpus = { entries: new Map([['bank-1', bank]]) } as unknown as Corpus
const source = (reports: ReportRecord[], packVersion: number | null = 2): FixSource => ({ reports: async () => reports, snapshot: { packVersion, corpus } })
const r = (key: string, wordId: string, field: ReportRecord['field']): ReportRecord => ({ key, wordId, field, packVersion: 1 })

describe('FixNotices', () => {
  it('lists each fixed report with its word, or no word when the corpus no longer has it', async () => {
    const notices = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation'), r('k2', 'c:gone-1', 'audio'), r('k3', 'c:bank-1', 'other')]), URL_)
    expect(notices.store.get()).toEqual([
      { reportKey: 'k1', field: 'translation', headword: 'bank' },
      { reportKey: 'k2', field: 'audio', headword: null },
    ])
  })

  it('once dismissed, never tells the same report again, even after a reload; a new fix still shows', async () => {
    const storage = memoryStorage()
    const first = new FixNotices({ storage, fetchFixes: async () => fixes })
    await first.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    first.dismiss()
    expect(first.store.get()).toEqual([])
    expect(JSON.parse(storage.getItem(FIXES_SEEN_KEY)!)).toEqual(['k1'])
    const reloaded = new FixNotices({ storage, fetchFixes: async () => fixes })
    await reloaded.check(source([r('k1', 'c:bank-1', 'translation'), r('k2', 'c:gone-1', 'audio')]), URL_)
    expect(reloaded.store.get().map((n) => n.reportKey)).toEqual(['k2'])
  })

  it('keeps what it shows when fixes.json cannot be fetched, and shows nothing before a pack is active', async () => {
    const notices = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    const offline = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => null })
    await offline.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(offline.store.get()).toEqual([])
    const early = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await early.check(source([r('k1', 'c:bank-1', 'translation')], null), URL_)
    expect(early.store.get()).toEqual([])
  })

  it('remembers at most the newest 500 told reports', async () => {
    const storage = memoryStorage()
    storage.setItem(FIXES_SEEN_KEY, JSON.stringify(Array.from({ length: 500 }, (_, i) => `old${i}`)))
    const notices = new FixNotices({ storage, fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    notices.dismiss()
    const seen = JSON.parse(storage.getItem(FIXES_SEEN_KEY)!) as string[]
    expect(seen).toHaveLength(500)
    expect(seen.at(-1)).toBe('k1')
    expect(seen[0]).toBe('old1')
  })

  it('keeps its notices when a later fetch fails', async () => {
    const storage = memoryStorage()
    let call = 0
    const notices = new FixNotices({
      storage,
      fetchFixes: async () => {
        call += 1
        return call === 1 ? fixes : null
      },
    })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(notices.store.get()).toEqual([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(notices.store.get()).toEqual([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])
  })

  it('discards a check that resolves after a newer one has already updated the store', async () => {
    const storage = memoryStorage()
    let releaseFirst!: (file: FixesFile | null) => void
    const firstFetch = new Promise<FixesFile | null>((resolve) => {
      releaseFirst = resolve
    })
    let call = 0
    const notices = new FixNotices({
      storage,
      fetchFixes: async () => (++call === 1 ? firstFetch : fixes),
    })
    const firstCheck = notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    await notices.check(source([r('k2', 'c:gone-1', 'audio')]), URL_)
    expect(notices.store.get()).toEqual([{ reportKey: 'k2', field: 'audio', headword: null }])
    releaseFirst(fixes)
    await firstCheck
    expect(notices.store.get()).toEqual([{ reportKey: 'k2', field: 'audio', headword: null }])
  })

  it('reset() empties the store at once, and a check already in flight does not bring the notice back', async () => {
    const storage = memoryStorage()
    let releaseInFlight!: (file: FixesFile | null) => void
    const inFlightFetch = new Promise<FixesFile | null>((resolve) => {
      releaseInFlight = resolve
    })
    let call = 0
    const notices = new FixNotices({
      storage,
      fetchFixes: async () => (++call === 1 ? fixes : inFlightFetch),
    })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(notices.store.get()).toEqual([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])
    const inFlight = notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    notices.reset()
    expect(notices.store.get()).toEqual([])
    releaseInFlight(fixes)
    await inFlight
    expect(notices.store.get()).toEqual([])
  })

  it('dismiss() bumps the generation, so a check already past the fixes fetch cannot re-show the report dismiss() just marked told', async () => {
    const storage = memoryStorage()
    const notices = new FixNotices({ storage, fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(notices.store.get()).toEqual([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])

    // This check's fixes fetch resolves at once, so it reaches `reports()` and suspends there, on the promise below.
    let releaseReports!: (reports: ReportRecord[]) => void
    const reportsPromise = new Promise<ReportRecord[]>((resolve) => {
      releaseReports = resolve
    })
    const slowSource: FixSource = { reports: () => reportsPromise, snapshot: { packVersion: 2, corpus } }
    const inFlight = notices.check(slowSource, URL_)
    await Promise.resolve() // let it compute `told` (not yet marking k1 told) and suspend on reports()
    notices.dismiss()
    expect(notices.store.get()).toEqual([])
    releaseReports([r('k1', 'c:bank-1', 'translation')])
    await inFlight
    expect(notices.store.get()).toEqual([])
  })
})
