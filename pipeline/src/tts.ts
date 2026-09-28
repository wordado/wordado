import type { TtsVoice } from './config'

/** The TTS port (spec §17). Returns MP3, or WAV for a PCM voice; the encoder makes the app's clip from either. */
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
        response_format: voice.response_format ?? 'mp3',
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
        const type = res.headers.get('content-type') ?? ''
        if (bytes.length === 0 || !type.startsWith('audio/')) throw new Error(`TTS "${text}": no audio in the response`)
        return type.startsWith('audio/pcm') ? pcmAsWav(bytes, type) : bytes
      }
      throw new Error(`TTS "${text}": gave up after ${ATTEMPTS} attempts: ${last}`)
    },
  }
}

/**
 * Raw PCM has no header, so ffmpeg cannot tell its rate. Gemini TTS names it in the content type
 * (`audio/pcm;rate=24000;channels=1`); a 44-byte WAV header carries it to the encoder, 16-bit little-endian.
 */
export function pcmAsWav(pcm: Uint8Array, contentType: string): Uint8Array {
  const param = (name: string, fallback: number) => {
    const m = new RegExp(`${name}=(\\d+)`).exec(contentType)
    return m ? Number(m[1]) : fallback
  }
  const rate = param('rate', 24000)
  const channels = param('channels', 1)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * channels * 2, 28)
  header.writeUInt16LE(channels * 2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return new Uint8Array(Buffer.concat([header, pcm]))
}
