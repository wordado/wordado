import { createStore, type Store } from '@wordado/client-data'
import type { KeyValue } from '../account/storage'
import type { Locale } from '../i18n/i18n'
import { LEGAL_DATES_URL, LEGAL_DOCS, siteLocale, type LegalDoc } from './site'

/** What this device knows of the legal pages' dates: the last look, what it found, and the dates the learner has seen. */
export const LEGAL_KEY = 'wordado.legal'
/** The app looks at the dates at most this often (#184). */
export const LEGAL_CHECK_GAP_MS = 24 * 60 * 60_000
/** After a look that got no answer, the next one waits this long, however often the app comes to the foreground. */
export const LEGAL_RETRY_GAP_MS = 5 * 60_000

/** Per document, the date (`YYYY-MM-DD`) its page was last changed in each of the website's languages. */
export type LegalDates = Readonly<Record<LegalDoc, Readonly<Record<string, string>>>>
/** Per document, the date the learner has seen; null before the first look. */
export type LegalSeen = Readonly<Record<LegalDoc, string | null>>

export interface LegalState {
  /** The dates as the website last gave them; null until it has answered once. */
  readonly published: LegalDates | null
  readonly seen: LegalSeen
}

/** A document whose page is newer than the learner has seen, with the page's date. */
export interface LegalChange {
  readonly doc: LegalDoc
  readonly date: string
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
// Such dates compare as text.
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

function datesOf(value: Record<string, unknown>): LegalDates | null {
  const out: Partial<Record<LegalDoc, Record<string, string>>> = {}
  for (const doc of LEGAL_DOCS) {
    const dates = value[doc]
    if (!isRecord(dates) || Object.keys(dates).length === 0 || !Object.values(dates).every(isDate)) return null
    out[doc] = dates as Record<string, string>
  }
  return out as LegalDates
}

/** The website's `legal.json` of schema 1, or null for anything else: a file this build cannot read says nothing. */
export function validateLegalDates(value: unknown): LegalDates | null {
  return isRecord(value) && value['schema_version'] === 1 ? datesOf(value) : null
}

/**
 * The file from the website, or null: offline, missing, not JSON, another schema. Never throws. The website is
 * another origin, which the service worker never answers for (sw.ts), and `no-cache` has the browser ask the
 * website each time, so a new date is never hidden by a kept copy.
 */
export async function fetchLegalDates(fetchFn: (input: string, init?: RequestInit) => Promise<Response> = (input, init) => fetch(input, init)): Promise<LegalDates | null> {
  try {
    const response = await fetchFn(LEGAL_DATES_URL, { cache: 'no-cache' })
    if (!response.ok) return null
    return validateLegalDates(await response.json())
  } catch {
    return null
  }
}

export interface LegalNoticeDeps {
  readonly storage: KeyValue
  /** The website's dates, or null when it cannot be reached or says something this build cannot read. */
  fetch(): Promise<LegalDates | null>
  now(): number
  online(): boolean
}

const NOTHING: LegalState = { published: null, seen: { terms: null, privacy: null } }

/**
 * "The terms have changed" (#184): a notice shown once when the website's terms or privacy policy are newer than
 * the learner has seen. The first look tells nothing: the dates it finds are the ones the learner started with.
 */
export class LegalNotice {
  readonly store: Store<LegalState>
  /** When the website last answered; null before it ever did. */
  private checkedAt: number | null = null
  /** The last look that got no answer, in this page's life only. */
  private failedAt: number | null = null
  private looking = false

  constructor(private readonly deps: LegalNoticeDeps) {
    const saved = this.saved()
    this.checkedAt = saved?.checkedAt ?? null
    this.store = createStore<LegalState>(saved ? { published: saved.published, seen: saved.seen } : NOTHING)
  }

  /** What an earlier visit left; damaged or refused storage reads as a first visit. */
  private saved(): (LegalState & { readonly checkedAt: number }) | null {
    try {
      const raw = this.deps.storage.getItem(LEGAL_KEY)
      const value: unknown = raw === null ? null : JSON.parse(raw)
      if (!isRecord(value) || typeof value['checkedAt'] !== 'number' || !isRecord(value['published']) || !isRecord(value['seen'])) return null
      const published = datesOf(value['published'])
      const { terms, privacy } = value['seen']
      if (published === null || !isDate(terms) || !isDate(privacy)) return null
      return { checkedAt: value['checkedAt'], published, seen: { terms, privacy } }
    } catch {
      return null
    }
  }

  private save(state: LegalState): void {
    this.store.set(state)
    try {
      this.deps.storage.setItem(LEGAL_KEY, JSON.stringify({ checkedAt: this.checkedAt, ...state }))
    } catch {
      // A private window may refuse storage: every visit is then a first one, and tells nothing.
    }
  }

  /**
   * Looks at the website's dates: when online, at most once a day, one look at a time. A look that gets no answer
   * changes nothing, shows nothing and is tried again a little later. A clock set back reads as time gone by.
   * Never throws: the app starts and works without it.
   */
  async check(): Promise<void> {
    const now = this.deps.now()
    const within = (since: number | null, gap: number) => since !== null && now - since >= 0 && now - since < gap
    if (this.looking || !this.deps.online() || within(this.checkedAt, LEGAL_CHECK_GAP_MS) || within(this.failedAt, LEGAL_RETRY_GAP_MS)) return
    this.looking = true
    let published: LegalDates | null = null
    try {
      published = await this.deps.fetch()
    } catch {
      // As no answer.
    }
    this.looking = false
    if (published === null) {
      this.failedAt = now
      return
    }
    this.checkedAt = now
    this.failedAt = null
    const { seen } = this.store.get()
    // A document never seen starts at its newest date in any language: nothing is told of what was there from the start.
    const first = (doc: LegalDoc) => seen[doc] ?? Object.values(published[doc]).reduce((a, b) => (a > b ? a : b))
    this.save({ published, seen: { terms: first('terms'), privacy: first('privacy') } })
  }

  /** The learner saw the notice of `doc` as of `date`: never tell of that date again on this device. */
  dismiss(doc: LegalDoc, date: string): void {
    const state = this.store.get()
    const before = state.seen[doc]
    if (before !== null && before >= date) return
    this.save({ ...state, seen: { ...state.seen, [doc]: date } })
  }
}

export type LegalNoticePort = Pick<LegalNotice, 'store' | 'dismiss'>

/**
 * The documents to tell the learner of: those whose page in the interface language is newer than the date seen on
 * this device and than the one in the account's settings (`account`), where a dismissal on another device arrives.
 */
export function changedLegalDocs(state: LegalState, locale: Locale, account: LegalSeen): LegalChange[] {
  const { published, seen } = state
  if (published === null) return []
  return LEGAL_DOCS.flatMap((doc) => {
    const date = published[doc][siteLocale(locale)] ?? published[doc]['en']
    const here = seen[doc]
    const there = account[doc]
    if (date === undefined || here === null) return []
    return date > here && (there === null || date > there) ? [{ doc, date }] : []
  })
}
