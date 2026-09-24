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
import type { AudioPort } from '../content/audio'
import { I18nProvider, type Locale } from '../i18n/i18n'
import type { Backend } from '../storage/protocol'
import { fakeApi } from './fakeApi'

/** Audio that is never available unless a test says so, and records what it was asked to play. */
export function fakeAudio(over: Partial<AudioPort> = {}): AudioPort & { played: AudioClip[] } {
  const played: AudioClip[] = []
  return {
    played,
    cachedClips: () => new Set(),
    streamable: () => false,
    play: async (clip) => {
      played.push(clip)
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
}

/** The account controller as the screens see it: every call is logged, and each can be overridden. */
export function fakeAccounts(over: Partial<AccountActions> = {}): AccountActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    store: createStore<AccountState>({ expired: false, notice: null }),
    completeSignIn: async (country) => {
      calls.push(`completeSignIn ${country}`)
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
