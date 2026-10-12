import { LOCALES, type Locale } from '../i18n/i18n'
import type { Api } from './api'
import type { KeyValue } from './storage'

/** What this device last told the server: for which account, and which interface language. */
export const LANGUAGE_SAID_KEY = 'wordado.languageSaid'

interface Said {
  readonly userId: string
  readonly language: Locale
}

export interface InterfaceLanguageDeps {
  readonly api: Pick<Api, 'setInterfaceLanguage'>
  readonly storage: KeyValue
  /** The recorded learner, or null in the demo. */
  account(): string | null
  /** The interface language now, or null before the interface has one. */
  language(): Locale | null
}

/**
 * The server is told the interface language of the signed-in account (#199), so that what it writes to the
 * account is in it. The choice itself stays on the device (`wordado.locale`); this only says what it is.
 *
 * `check()` is called whenever something may have changed or may work now: as the app starts, when an account
 * is signed in or out, when the language changes, when the device is back online or the app back in front. It
 * sends only when what the server was last told from this device is not this account in this language. So a
 * change made offline is sent at the next of those moments, an account signed in before the app said its language
 * says it once at its next start, and a sign-in says it again, since signing out forgets what was said.
 * A send that fails changes nothing and says nothing: the next check tries again.
 */
export class InterfaceLanguageReport {
  /** What was said during this visit, where the browser refused to store it. */
  private unstored: Said | null = null
  /** One send at a time, in the order asked, each reading what is so when its turn comes. */
  private last: Promise<void> = Promise.resolve()

  constructor(private readonly deps: InterfaceLanguageDeps) {}

  check(): Promise<void> {
    this.last = this.last.then(() => this.send())
    return this.last
  }

  private read(): Said | null {
    try {
      const raw = this.deps.storage.getItem(LANGUAGE_SAID_KEY)
      if (raw === null) return this.unstored
      const value = JSON.parse(raw) as Partial<Said> | null
      const language = LOCALES.find((l) => l === value?.language)
      return typeof value?.userId === 'string' && language !== undefined ? { userId: value.userId, language } : null
    } catch {
      return this.unstored
    }
  }

  private write(said: Said | null): void {
    this.unstored = null
    try {
      if (said === null) this.deps.storage.removeItem(LANGUAGE_SAID_KEY)
      else this.deps.storage.setItem(LANGUAGE_SAID_KEY, JSON.stringify(said))
    } catch {
      // A private window may refuse storage: the language is then said once a visit.
      this.unstored = said
    }
  }

  private async send(): Promise<void> {
    const { api, account, language } = this.deps
    const userId = account()
    if (userId === null) {
      // Signed out, or the demo: the next sign-in says the language again, whoever signs in.
      if (this.read() !== null) this.write(null)
      return
    }
    const now = language()
    if (now === null) return
    const said = this.read()
    if (said?.userId === userId && said.language === now) return
    try {
      await api.setInterfaceLanguage(now)
    } catch {
      // Offline, or a sign-in that expired: the next check tries again.
      return
    }
    // An account that changed while the request was out was not told of: its own check says it.
    if (account() === userId) this.write({ userId, language: now })
  }
}
