import { render, type RenderResult } from '@testing-library/react'
import { ClientProvider, createStore, type Client } from '@wordado/client-data'
import { openSampleClient } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { Grade, type AudioClip } from '@wordado/core'
import type { ReactElement } from 'react'
import type { Api } from '../account/api'
import type { AccountActions, AccountState } from '../account/controller'
import type { AccountRecord } from '../account/storage'
import { AppProvider } from '../app/context'
import type { CreditsPort, CreditsView } from '../app/credits'
import type { FixNotice, FixNoticesPort } from '../app/fixNotices'
import { type LifecycleState, type LifecyclePort } from '../app/lifecycle'
import { PackSwitcher } from '../app/packSwitch'
import type { AudioPort } from '../content/audio'
import { I18nProvider, type Locale } from '../i18n/i18n'
import type { ReminderActions, ReminderPrefs } from '../reminders/reminders'
import type { Backend } from '../storage/protocol'
import { fakeApi } from './fakeApi'

/** Audio that is never available unless a test says so, and records what it was asked to play or fetch. */
export function fakeAudio(over: Partial<AudioPort> = {}): AudioPort & { played: AudioClip[]; fetched: AudioClip[] } {
  const played: AudioClip[] = []
  const fetched: AudioClip[] = []
  return {
    played,
    fetched,
    cachedClips: () => new Set(),
    streamable: () => false,
    play: async (clip) => {
      played.push(clip)
    },
    prefetch: async (clips) => {
      fetched.push(...clips)
      return clips.length
    },
    ...over,
  }
}

/** A demo client over the sample, with a deterministic clock (plan 4's test env). */
export async function setup(options: { readonly env?: TestEnv; readonly audio?: AudioPort } = {}) {
  const env = options.env ?? testEnv()
  const client = await openSampleClient(env)
  return { env, client, audio: options.audio ?? fakeAudio() }
}

export interface RenderContext {
  readonly client: Client
  readonly env: TestEnv
  readonly audio: AudioPort
  readonly backend?: Backend
  readonly locale?: Locale
  readonly afterRun?: () => void
  readonly api?: Api
  readonly accounts?: AccountActions
  readonly account?: AccountRecord | null
  readonly reminders?: ReminderActions
  readonly lifecycle?: LifecyclePort
  readonly credits?: CreditsPort
  readonly fixNotices?: FixNoticesPort
  readonly packs?: PackSwitcher
}

/** A real `PackSwitcher` with stub deps: no screen under test installs a pack unless it says so. */
export function fakePacks(): PackSwitcher {
  return new PackSwitcher({
    fetchManifest: () => Promise.reject(new Error('fakePacks: no manifest configured')),
    fetcher: () => async () => new Uint8Array(),
  })
}

/** Installation and updates as the banners and settings see them; every call is logged. */
export function fakeLifecycle(state: Partial<LifecycleState> = {}): LifecyclePort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    store: createStore<LifecycleState>({ updateReady: false, appTooOld: false, installable: null, installOffer: null, ...state }),
    applyUpdate: () => void calls.push('applyUpdate'),
    install: async () => void calls.push('install'),
    dismissInstall: () => void calls.push('dismissInstall'),
  }
}

/** The account controller as the screens see it: every call is logged, and each can be overridden. */
export function fakeAccounts(over: Partial<AccountActions> = {}): AccountActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    store: createStore<AccountState>({ expired: false, notice: null }),
    completeSignIn: async (country, l1) => {
      calls.push(`completeSignIn ${country} ${l1}`)
      return 'signed-in'
    },
    resumeGoogle: async () => null,
    signOut: async (options) => {
      calls.push(`signOut${options?.force ? ' force' : ''}`)
      return 'signed-out'
    },
    deleteAccount: async () => {
      calls.push('deleteAccount')
    },
    leaveDemo: async () => {
      calls.push('leaveDemo')
    },
    dismissNotice: () => {
      calls.push('dismissNotice')
    },
    ...over,
  }
}

/** Reminders as settings sees them; `support` and the answer to `enable` are the test's to choose. */
export function fakeReminders(over: Partial<ReminderActions> = {}): ReminderActions & { calls: string[] } {
  const calls: string[] = []
  let prefs: ReminderPrefs | null = null
  return {
    calls,
    prefs: () => prefs,
    support: () => 'supported',
    enable: async (p) => {
      calls.push(`enable ${p.minute} ${p.streakNudge}`)
      prefs = p
      return 'on'
    },
    disable: async () => {
      calls.push('disable')
      prefs = null
    },
    ...over,
  }
}

/** Credits as Settings › About sees them: none yet, unless a test says so. */
export function fakeCredits(view: Partial<CreditsView> = {}): CreditsPort {
  return { store: createStore<CreditsView>({ manifestUrl: null, credits: null, ...view }) }
}

/** Fix notices as the banner sees them; counts dismissals. */
export function fakeFixNotices(notices: readonly FixNotice[] = []): FixNoticesPort & { dismissed: number } {
  const store = createStore<readonly FixNotice[]>(notices)
  const port = {
    store,
    dismissed: 0,
    dismiss() {
      port.dismissed += 1
      store.set([])
    },
  }
  return port
}

/** Renders inside every provider the app has, in English unless told otherwise. */
export function renderWith(ui: ReactElement, ctx: RenderContext): RenderResult {
  const storage = { getItem: () => ctx.locale ?? 'en', setItem: () => undefined }
  return render(
    <I18nProvider storage={storage}>
      <ClientProvider client={ctx.client}>
        <AppProvider
          value={{
            env: ctx.env,
            audio: ctx.audio,
            backend: ctx.backend ?? 'opfs',
            afterRun: ctx.afterRun ?? (() => undefined),
            api: ctx.api ?? fakeApi(),
            accounts: ctx.accounts ?? fakeAccounts(),
            account: ctx.account ?? null,
            reminders: ctx.reminders ?? fakeReminders(),
            lifecycle: ctx.lifecycle ?? fakeLifecycle(),
            credits: ctx.credits ?? fakeCredits(),
            fixNotices: ctx.fixNotices ?? fakeFixNotices(),
            packs: ctx.packs ?? fakePacks(),
          }}
        >
          {ui}
        </AppProvider>
      </ClientProvider>
    </I18nProvider>,
  )
}

/** Introduces the next `count` new words of the plan, a few seconds apart. */
export async function answerNew(client: Client, env: TestEnv, count: number, grade: Grade = Grade.Good): Promise<void> {
  for (const wordId of client.snapshot.plan!.newWords.slice(0, count)) {
    await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade, latencyMs: 2_000, practice: false })
    env.advance(3_000)
  }
}
