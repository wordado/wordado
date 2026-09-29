import { createStore, type Store } from '@wordado/client-data'
import { validateCredits, type CreditsFile } from '@wordado/core'
import type { KeyValue } from '../account/storage'

/** The last credits this device saw, by manifest URL: the About section works offline (plan 8b, Decision 6). */
export const CREDITS_KEY = 'wordado.credits'

export interface CreditsView {
  readonly manifestUrl: string | null
  readonly credits: CreditsFile | null
}

export interface CreditsDeps {
  readonly storage: KeyValue
  fetch(manifestUrl: string): Promise<CreditsFile | null>
}

/** The word data's attributions (plan 8b, Decision 1), for Settings › About. */
export class Credits {
  readonly store: Store<CreditsView> = createStore<CreditsView>({ manifestUrl: null, credits: null })

  constructor(private readonly deps: CreditsDeps) {}

  private saved(): Record<string, CreditsFile> {
    try {
      const raw = this.deps.storage.getItem(CREDITS_KEY)
      const value: unknown = raw === null ? {} : JSON.parse(raw)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
      const out: Record<string, CreditsFile> = {}
      for (const [url, file] of Object.entries(value)) {
        const valid = validateCredits(file)
        if (valid) out[url] = valid
      }
      return out
    } catch {
      return {}
    }
  }

  /** Shows the stored copy for `manifestUrl` at once, then the CDN's when it answers. */
  async refresh(manifestUrl: string): Promise<void> {
    const saved = this.saved()
    this.store.set({ manifestUrl, credits: saved[manifestUrl] ?? null })
    const fetched = await this.deps.fetch(manifestUrl)
    if (fetched === null || this.store.get().manifestUrl !== manifestUrl) return
    this.store.set({ manifestUrl, credits: fetched })
    try {
      this.deps.storage.setItem(CREDITS_KEY, JSON.stringify({ ...saved, [manifestUrl]: fetched }))
    } catch {
      // A private window may refuse storage: the credits then show while online.
    }
  }
}

export type CreditsPort = Pick<Credits, 'store'>
