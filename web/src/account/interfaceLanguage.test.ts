import { describe, expect, it } from 'vitest'
import type { Locale } from '../i18n/i18n'
import { fakeApi } from '../test/fakeApi'
import { OfflineError } from './api'
import { InterfaceLanguageReport, LANGUAGE_SAID_KEY } from './interfaceLanguage'
import { memoryStorage, type KeyValue } from './storage'

/** A device: who is signed in, the interface language, and whether the server can be reached. */
function device(start: { userId?: string | null; language?: Locale | null; storage?: KeyValue } = {}) {
  const state = {
    userId: start.userId === undefined ? 'u1' : start.userId,
    language: start.language === undefined ? ('bg' as Locale | null) : start.language,
    online: true,
    /** Runs while a send is out. */
    during: null as (() => void) | null,
  }
  const storage = start.storage ?? memoryStorage()
  const api = fakeApi()
  const said: string[] = []
  const report = new InterfaceLanguageReport({
    api: {
      setInterfaceLanguage: async (language) => {
        if (!state.online) throw new OfflineError(new TypeError('Failed to fetch'))
        said.push(`${state.userId} ${language}`)
        state.during?.()
        return api.setInterfaceLanguage(language)
      },
    },
    storage,
    account: () => state.userId,
    language: () => state.language,
  })
  return { state, storage, said, report }
}

describe('telling the server the interface language (#199)', () => {
  it('says it once for an account that is signed in, and not again while nothing changes', async () => {
    const d = device()
    await d.report.check()
    await d.report.check()
    expect(d.said).toEqual(['u1 bg'])
    // Nor at the next start of the app: the device remembers what it said.
    const next = device({ storage: d.storage })
    await next.report.check()
    expect(next.said).toEqual([])
  })

  it('says a change of language', async () => {
    const d = device()
    await d.report.check()
    d.state.language = 'en'
    await d.report.check()
    expect(d.said).toEqual(['u1 bg', 'u1 en'])
  })

  it('says a change made offline once the server answers again', async () => {
    const d = device()
    await d.report.check()
    d.state.online = false
    d.state.language = 'en'
    await d.report.check()
    await d.report.check()
    expect(d.said).toEqual(['u1 bg'])
    d.state.online = true
    await d.report.check()
    expect(d.said).toEqual(['u1 bg', 'u1 en'])
  })

  it('says nothing in the demo, and says it at each sign-in: signing out forgets what was said', async () => {
    const d = device({ userId: null })
    await d.report.check()
    expect(d.said).toEqual([])
    d.state.userId = 'u1'
    await d.report.check()
    d.state.userId = null
    await d.report.check()
    expect(d.storage.getItem(LANGUAGE_SAID_KEY)).toBeNull()
    d.state.userId = 'u1'
    await d.report.check()
    d.state.userId = 'u2'
    await d.report.check()
    expect(d.said).toEqual(['u1 bg', 'u1 bg', 'u2 bg'])
  })

  it('waits for the interface to have a language', async () => {
    const d = device({ language: null })
    await d.report.check()
    expect(d.said).toEqual([])
    d.state.language = 'de'
    await d.report.check()
    expect(d.said).toEqual(['u1 de'])
  })

  it('sends one at a time, and the language of the moment: checks that come together say it once', async () => {
    const d = device()
    const checks = [d.report.check(), d.report.check()]
    d.state.language = 'es'
    checks.push(d.report.check())
    await Promise.all(checks)
    expect(d.said).toEqual(['u1 es'])
  })

  it('does not take a send as said when the account changed while it was out', async () => {
    const d = device()
    d.state.during = () => {
      d.state.userId = 'u2'
      d.state.during = null
    }
    await d.report.check()
    expect(d.storage.getItem(LANGUAGE_SAID_KEY)).toBeNull()
    await d.report.check()
    expect(d.said).toEqual(['u1 bg', 'u2 bg'])
    expect(JSON.parse(d.storage.getItem(LANGUAGE_SAID_KEY)!)).toEqual({ userId: 'u2', language: 'bg' })
  })

  it('reads a damaged record as nothing said, and says it once a visit where storage is refused', async () => {
    const damaged = memoryStorage()
    damaged.setItem(LANGUAGE_SAID_KEY, '{"userId":"u1","language":"fr"}')
    const d = device({ storage: damaged })
    await d.report.check()
    expect(d.said).toEqual(['u1 bg'])
    const refusing: KeyValue = {
      getItem: () => null,
      setItem: () => {
        throw new Error('refused')
      },
      removeItem: () => undefined,
    }
    const r = device({ storage: refusing })
    await r.report.check()
    await r.report.check()
    expect(r.said).toEqual(['u1 bg'])
  })
})
