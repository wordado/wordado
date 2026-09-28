import type { TtsVoice } from './config'

/** The TTS port (spec §17). Returns MP3 bytes; the encoder makes the app's clip from them. */
export interface Tts {
  speak(text: string, voice: TtsVoice): Promise<Uint8Array>
}

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
const ATTEMPTS = 4

/**
 * OpenRouter's speech endpoint (Decision 11). The body follows OpenAI's
 * audio-speech shape. Provider-specific settings travel in
 * `provider.options`; by default that is OpenAI's `instructions`.
 */
export function openRouterTts(opts: { apiKey: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Tts {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  return {
    async speak(text, voice) {
      const body = JSON.stringify({
        model: opts.model,
        input: text,
        voice: voice.voice,
        response_format: 'mp3',
        provider: { options: voice.provider_options ?? { openai: { instructions: voice.instructions } } },
      })
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        if (i > 0) await sleep(1000 * 2 ** (i - 1))
        let res: Response
        try {
          res = await doFetch(ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' }, body })
        } catch (err) {
          last = `network: ${err instanceof Error ? err.message : String(err)}`
          continue
        }
        if (res.status === 429 || res.status >= 500) {
          last = `HTTP ${res.status}`
          continue
        }
        if (!res.ok) throw new Error(`TTS "${text}": HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length === 0 || !(res.headers.get('content-type') ?? '').startsWith('audio/')) throw new Error(`TTS "${text}": no audio in the response`)
        return bytes
      }
      throw new Error(`TTS "${text}": gave up after ${ATTEMPTS} attempts: ${last}`)
    },
  }
}
