import { describe, expect, it } from 'vitest'
import { memoryStorage, type KeyValue } from '../account/storage'
import { changedLegalDocs, LEGAL_CHECK_GAP_MS, LEGAL_KEY, LEGAL_RETRY_GAP_MS, LegalNotice, validateLegalDates, type LegalDates } from './legalNotice'

const every = (date: string) => ({ bg: date, de: date, en: date, es: date })
const OCTOBER: LegalDates = { terms: every('2026-10-11'), privacy: every('2026-10-11') }
const NOVEMBER: LegalDates = { terms: every('2026-11-01'), privacy: every('2026-10-11') }
const NO_ACCOUNT = { terms: null, privacy: null }

/** A notice over a website that answers `site.dates` (null: it cannot be reached), with a clock the test moves. */
function world(storage: KeyValue = memoryStorage()) {
  const site = { dates: OCTOBER as LegalDates | null, asked: 0, online: true }
  const clock = { now: 1_800_000_000_000 }
  const open = () =>
    new LegalNotice({
      storage,
      fetch: async () => {
        site.asked += 1
        return site.dates
      },
      now: () => clock.now,
      online: () => site.online,
    })
  return { site, clock, storage, open, notice: open() }
}

describe('LegalNotice', () => {
  it('tells a learner nothing at the first look: the dates then are the ones they started with', async () => {
    const { notice } = world()
    expect(notice.store.get()).toEqual({ published: null, seen: { terms: null, privacy: null } })
    await notice.check()
    expect(notice.store.get()).toEqual({ published: OCTOBER, seen: { terms: '2026-10-11', privacy: '2026-10-11' } })
    expect(changedLegalDocs(notice.store.get(), 'en', NO_ACCOUNT)).toEqual([])
  })

  it('starts from the newest date of any language, so changing the interface language tells of nothing', async () => {
    const { site, notice } = world()
    site.dates = { terms: { ...every('2026-10-11'), de: '2026-10-10' }, privacy: every('2026-10-11') }
    await notice.check()
    expect(notice.store.get().seen.terms).toBe('2026-10-11')
    for (const locale of ['bg', 'de', 'en', 'es'] as const) expect(changedLegalDocs(notice.store.get(), locale, NO_ACCOUNT)).toEqual([])
  })

  it('tells of a document whose date became newer than the one seen, and only of that one', async () => {
    const { site, clock, notice } = world()
    await notice.check()
    site.dates = NOVEMBER
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(changedLegalDocs(notice.store.get(), 'en', NO_ACCOUNT)).toEqual([{ doc: 'terms', date: '2026-11-01' }])
  })

  it('goes by the page in the interface language: a translation that follows later is told of when it arrives', async () => {
    const { site, clock, notice } = world()
    await notice.check()
    site.dates = { terms: { ...every('2026-11-01'), de: '2026-10-11' }, privacy: every('2026-10-11') }
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(changedLegalDocs(notice.store.get(), 'en', NO_ACCOUNT)).toEqual([{ doc: 'terms', date: '2026-11-01' }])
    expect(changedLegalDocs(notice.store.get(), 'de', NO_ACCOUNT)).toEqual([])
    site.dates = { terms: { ...every('2026-11-01'), de: '2026-11-03' }, privacy: every('2026-10-11') }
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(changedLegalDocs(notice.store.get(), 'de', NO_ACCOUNT)).toEqual([{ doc: 'terms', date: '2026-11-03' }])
  })

  it('looks at most once a day, however often it is asked; a clock set back reads as time gone by', async () => {
    const { site, clock, notice } = world()
    await notice.check()
    await notice.check()
    clock.now += LEGAL_CHECK_GAP_MS - 1
    await notice.check()
    expect(site.asked).toBe(1)
    clock.now += 1
    await notice.check()
    expect(site.asked).toBe(2)
    clock.now -= 7 * LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(site.asked).toBe(3)
  })

  it('keeps the day across a reload, and shows a waiting notice at once, without the network', async () => {
    const { site, clock, open, notice } = world()
    await notice.check()
    site.dates = NOVEMBER
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    site.online = false
    const reloaded = open()
    expect(changedLegalDocs(reloaded.store.get(), 'en', NO_ACCOUNT)).toEqual([{ doc: 'terms', date: '2026-11-01' }])
    site.online = true
    await reloaded.check()
    expect(site.asked).toBe(2)
  })

  it('does not ask while offline, and asks once the device is back', async () => {
    const { site, notice } = world()
    site.online = false
    await notice.check()
    expect(site.asked).toBe(0)
    expect(notice.store.get().published).toBeNull()
    site.online = true
    await notice.check()
    expect(site.asked).toBe(1)
    expect(notice.store.get().published).toEqual(OCTOBER)
  })

  it('keeps what it has when the website cannot be reached or answers something else, and asks again a little later', async () => {
    const { site, clock, notice } = world()
    await notice.check()
    const before = notice.store.get()
    site.dates = null
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(notice.store.get()).toEqual(before)
    await notice.check()
    clock.now += LEGAL_RETRY_GAP_MS - 1
    await notice.check()
    expect(site.asked).toBe(2)
    site.dates = NOVEMBER
    clock.now += 1
    await notice.check()
    expect(site.asked).toBe(3)
    expect(notice.store.get().published).toEqual(NOVEMBER)
  })

  it('never throws, whatever the fetch does', async () => {
    const notice = new LegalNotice({ storage: memoryStorage(), fetch: () => Promise.reject(new Error('down')), now: () => 0, online: () => true })
    await expect(notice.check()).resolves.toBeUndefined()
    expect(notice.store.get().published).toBeNull()
  })

  it('asks once at a time', async () => {
    let asked = 0
    let answer: (dates: LegalDates) => void = () => undefined
    const notice = new LegalNotice({
      storage: memoryStorage(),
      fetch: () => new Promise((resolve) => ((asked += 1), (answer = resolve))),
      now: () => 0,
      online: () => true,
    })
    const first = notice.check()
    await notice.check()
    expect(asked).toBe(1)
    answer(OCTOBER)
    await first
    expect(notice.store.get().published).toEqual(OCTOBER)
  })

  it('once dismissed, never tells of that date again, even after a reload; a later change is told of', async () => {
    const { site, clock, open, notice } = world()
    await notice.check()
    site.dates = NOVEMBER
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    notice.dismiss('terms', '2026-11-01')
    expect(changedLegalDocs(notice.store.get(), 'en', NO_ACCOUNT)).toEqual([])
    const reloaded = open()
    expect(reloaded.store.get().seen).toEqual({ terms: '2026-11-01', privacy: '2026-10-11' })
    expect(changedLegalDocs(reloaded.store.get(), 'en', NO_ACCOUNT)).toEqual([])
    site.dates = { terms: every('2026-11-01'), privacy: every('2026-12-05') }
    clock.now += LEGAL_CHECK_GAP_MS
    await reloaded.check()
    expect(changedLegalDocs(reloaded.store.get(), 'en', NO_ACCOUNT)).toEqual([{ doc: 'privacy', date: '2026-12-05' }])
  })

  it('never moves a seen date back', async () => {
    const { notice } = world()
    await notice.check()
    notice.dismiss('terms', '2026-01-01')
    expect(notice.store.get().seen.terms).toBe('2026-10-11')
  })

  it('takes a dismissal on the learner’s other device, from the account’s settings, as its own', async () => {
    const { site, clock, notice } = world()
    await notice.check()
    site.dates = { terms: every('2026-11-01'), privacy: every('2026-11-01') }
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(changedLegalDocs(notice.store.get(), 'bg', { terms: '2026-11-01', privacy: '2026-10-11' })).toEqual([{ doc: 'privacy', date: '2026-11-01' }])
    expect(changedLegalDocs(notice.store.get(), 'bg', { terms: '2026-11-01', privacy: '2026-11-01' })).toEqual([])
    // An account that saw an older date than this device covers nothing.
    expect(changedLegalDocs(notice.store.get(), 'bg', { terms: '2026-09-01', privacy: null }).map((c) => c.doc)).toEqual(['terms', 'privacy'])
  })

  it('reads a language the website has no page in as English', async () => {
    const { site, clock, notice } = world()
    site.dates = { terms: { en: '2026-10-11' }, privacy: { en: '2026-10-11' } }
    await notice.check()
    site.dates = { terms: { en: '2026-11-01' }, privacy: { en: '2026-10-11' } }
    clock.now += LEGAL_CHECK_GAP_MS
    await notice.check()
    expect(changedLegalDocs(notice.store.get(), 'de', NO_ACCOUNT)).toEqual([{ doc: 'terms', date: '2026-11-01' }])
  })

  it('tells of nothing in a browser that refuses storage, and reads damaged storage as a first visit', async () => {
    const refusing: KeyValue = {
      getItem: () => {
        throw new Error('refused')
      },
      setItem: () => {
        throw new Error('refused')
      },
      removeItem: () => undefined,
    }
    const { notice } = world(refusing)
    await notice.check()
    notice.dismiss('terms', '2026-10-11')
    expect(changedLegalDocs(notice.store.get(), 'en', NO_ACCOUNT)).toEqual([])
    const storage = memoryStorage()
    for (const damaged of ['{', '[]', '{"checkedAt":"today","published":{"terms":1},"seen":{"terms":7}}']) {
      storage.setItem(LEGAL_KEY, damaged)
      const fresh = world(storage)
      expect(fresh.notice.store.get()).toEqual({ published: null, seen: { terms: null, privacy: null } })
      await fresh.notice.check()
      expect(fresh.site.asked).toBe(1)
      expect(changedLegalDocs(fresh.notice.store.get(), 'en', NO_ACCOUNT)).toEqual([])
    }
  })
})

describe('validateLegalDates', () => {
  it('reads the website’s file of schema 1', () => {
    expect(validateLegalDates({ schema_version: 1, ...OCTOBER })).toEqual(OCTOBER)
  })

  it('refuses anything else: another schema, a missing document, a value that is no date', () => {
    expect(validateLegalDates({ schema_version: 2, ...OCTOBER })).toBeNull()
    expect(validateLegalDates({ schema_version: 1, terms: every('2026-10-11') })).toBeNull()
    expect(validateLegalDates({ schema_version: 1, terms: every('2026-10-11'), privacy: {} })).toBeNull()
    expect(validateLegalDates({ schema_version: 1, terms: every('2026-10-11'), privacy: { en: 'soon' } })).toBeNull()
    expect(validateLegalDates({ schema_version: 1, terms: every('2026-10-11'), privacy: ['2026-10-11'] })).toBeNull()
    for (const value of [null, 'legal', 7, []]) expect(validateLegalDates(value)).toBeNull()
  })
})
