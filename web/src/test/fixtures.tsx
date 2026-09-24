import { render, type RenderResult } from '@testing-library/react'
import { ClientProvider, type Client } from '@wordado/client-data'
import { openSampleClient } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { Grade, type AudioClip } from '@wordado/core'
import type { ReactElement } from 'react'
import { AppProvider } from '../app/context'
import type { AudioPort } from '../content/audio'
import { I18nProvider, type Locale } from '../i18n/i18n'
import type { Backend } from '../storage/protocol'

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
}

/** Renders inside every provider the app has, in English unless told otherwise. */
export function renderWith(ui: ReactElement, ctx: RenderContext): RenderResult {
  const storage = { getItem: () => ctx.locale ?? 'en', setItem: () => undefined }
  return render(
    <I18nProvider storage={storage}>
      <ClientProvider client={ctx.client}>
        <AppProvider value={{ env: ctx.env, audio: ctx.audio, backend: ctx.backend ?? 'opfs', afterRun: ctx.afterRun ?? (() => undefined) }}>{ui}</AppProvider>
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
