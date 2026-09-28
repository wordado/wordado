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

  it('asks for PCM when the voice says so, and wraps it as WAV at the rate and channels the response names', async () => {
    const pcm = new Response(new Uint8Array([1, 0, 2, 0]), { headers: { 'content-type': 'audio/pcm;rate=24000;channels=1' } })
    const { t, bodies } = tts([pcm])
    const wav = Buffer.from(await t.speak('hi', { ...voice, response_format: 'pcm' }))
    expect(bodies[0]!['response_format']).toBe('pcm')
    expect([wav.toString('ascii', 0, 4), wav.toString('ascii', 8, 12), wav.toString('ascii', 36, 40)]).toEqual(['RIFF', 'WAVE', 'data'])
    expect([wav.readUInt16LE(20), wav.readUInt16LE(22), wav.readUInt32LE(24), wav.readUInt32LE(28), wav.readUInt16LE(34)]).toEqual([1, 1, 24000, 48000, 16])
    expect([wav.readUInt32LE(4), wav.readUInt32LE(40)]).toEqual([40, 4])
    expect([...wav.subarray(44)]).toEqual([1, 0, 2, 0])
  })

  it('reads another rate and channel count, and assumes 24 kHz mono when the content type names none', async () => {
    const stereo = new Response(new Uint8Array([0, 0, 0, 0]), { headers: { 'content-type': 'audio/pcm; rate=16000; channels=2' } })
    const bare = new Response(new Uint8Array([0, 0]), { headers: { 'content-type': 'audio/pcm' } })
    const { t } = tts([stereo, bare])
    const a = Buffer.from(await t.speak('a', { ...voice, response_format: 'pcm' }))
    const b = Buffer.from(await t.speak('b', { ...voice, response_format: 'pcm' }))
    expect([a.readUInt16LE(22), a.readUInt32LE(24), a.readUInt32LE(28)]).toEqual([2, 16000, 64000])
    expect([b.readUInt16LE(22), b.readUInt32LE(24)]).toEqual([1, 24000])
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
