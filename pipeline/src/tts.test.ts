import { describe, expect, it } from 'vitest'
import { openRouterTts } from './tts'

const voice = { voice: 'alloy', instructions: 'British.' }
function tts(responses: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = []
  const t = openRouterTts({
    apiKey: 'k',
    model: 'openai/gpt-4o-mini-tts-2025-12-15',
    sleep: async () => {},
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const next = responses.shift()!
      if (next instanceof Error) throw next
      return next
    },
  })
  return { t, bodies }
}
const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } })

describe('openRouterTts', () => {
  it('asks for MP3 with the voice and its instructions, and returns the bytes', async () => {
    const { t, bodies } = tts([mp3()])
    expect([...(await t.speak('thank you', voice))]).toEqual([0xff, 0xfb, 1, 2])
    expect(bodies[0]).toEqual({
      model: 'openai/gpt-4o-mini-tts-2025-12-15',
      input: 'thank you',
      voice: 'alloy',
      response_format: 'mp3',
      provider: { options: { openai: { instructions: 'British.' } } },
    })
  })

  it('passes a voice’s own provider options through instead', async () => {
    const { t, bodies } = tts([mp3()])
    await t.speak('hi', { ...voice, provider_options: { 'google-ai-studio': { speech_metadata: { style: 'calm' } } } })
    expect(bodies[0]!['provider']).toEqual({ options: { 'google-ai-studio': { speech_metadata: { style: 'calm' } } } })
  })

  it('retries rate limits and server errors; refuses a JSON error or an empty body', async () => {
    expect((await tts([new Response('', { status: 429 }), new Error('reset'), mp3()]).t.speak('a', voice)).length).toBe(4)
    await expect(tts([new Response('{"error":{}}', { status: 400, headers: { 'content-type': 'application/json' } })]).t.speak('a', voice)).rejects.toThrow(/HTTP 400/)
    await expect(tts([new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } })]).t.speak('a', voice)).rejects.toThrow(/no audio/)
  })
})
