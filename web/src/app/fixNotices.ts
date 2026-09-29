import { createStore, type Store } from '@wordado/client-data'
import { fixedReports, isWordId, parseWordId, type Corpus, type FixedField, type FixesFile, type ReportRecord } from '@wordado/core'
import type { KeyValue } from '../account/storage'

/** The reports this device has already told the learner are fixed (plan 8b, Decision 5). */
export const FIXES_SEEN_KEY = 'wordado.fixes-seen'
const MAX_SEEN = 500

export interface FixNotice {
  readonly reportKey: string
  readonly field: FixedField
  /** The word as the active corpus names it, or null when it no longer has it. */
  readonly headword: string | null
}

export interface FixSource {
  reports(): Promise<readonly ReportRecord[]>
  readonly snapshot: { readonly packVersion: number | null; readonly corpus: Corpus | null }
}

export interface FixNoticesDeps {
  readonly storage: KeyValue
  fetchFixes(manifestUrl: string): Promise<FixesFile | null>
}

/** "Something you reported has been fixed" (spec §8.10). */
export class FixNotices {
  readonly store: Store<readonly FixNotice[]> = createStore<readonly FixNotice[]>([])

  constructor(private readonly deps: FixNoticesDeps) {}

  private seen(): string[] {
    try {
      const raw = this.deps.storage.getItem(FIXES_SEEN_KEY)
      const value: unknown = raw === null ? [] : JSON.parse(raw)
      return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  /** Fetches fixes.json beside `manifestUrl` and lists the learner's fixed reports not yet told; keeps its state on a failed fetch. */
  async check(source: FixSource, manifestUrl: string): Promise<void> {
    const fixes = await this.deps.fetchFixes(manifestUrl)
    if (fixes === null) return
    const told = new Set(this.seen())
    const { packVersion, corpus } = source.snapshot
    const matched = fixedReports(await source.reports(), fixes, packVersion).filter((m) => !told.has(m.report.key))
    this.store.set(
      matched.map(({ report, fix }) => {
        // Corpus entries are keyed by entry ID, without the `c:` prefix (core/src/types.ts:49).
        const parsed = isWordId(report.wordId) ? parseWordId(report.wordId) : null
        const entry = parsed?.kind === 'corpus' ? corpus?.entries.get(parsed.key) : undefined
        return { reportKey: report.key, field: fix.field, headword: entry?.headword ?? null }
      }),
    )
  }

  /** The learner saw them: never tell these again on this device. */
  dismiss(): void {
    const shown = this.store.get().map((n) => n.reportKey)
    if (shown.length === 0) return
    const kept = [...this.seen().filter((k) => !shown.includes(k)), ...shown].slice(-MAX_SEEN)
    try {
      this.deps.storage.setItem(FIXES_SEEN_KEY, JSON.stringify(kept))
    } catch {
      // A private window may refuse storage: the notice may then come back next visit.
    }
    this.store.set([])
  }
}

export type FixNoticesPort = Pick<FixNotices, 'store' | 'dismiss'>
