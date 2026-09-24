import type { AudioClip, Corpus } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { webEnv } from '../env'
import { AUDIO_CACHE, AudioStore, type AudioStoreOptions, type PlayerLike } from './audio'
import type { Fetch } from './packs'

const env = webEnv()
const MANIFEST = 'https://cdn.wordado.test/v1/manifest.json'

async function clip(id: string, body: string, over: Partial<AudioClip> = {}): Promise<AudioClip> {
  const bytes = new TextEncoder().encode(body)
  return { clipId: id, url: `audio/${id}.m4a`, sha256: await env.sha256(bytes), bytes: bytes.byteLength, mime: 'audio/mp4', ...over }
}

const corpusOf = (clips: readonly AudioClip[]): Corpus => ({
  l1: 'bg',
  entries: new Map(),
  units: [],
  themes: [],
  clips: new Map(clips.map((c) => [c.clipId, c])),
  retired: new Set(),
})

/** Serves each clip's body from a fixed table. */
function server(bodies: Record<string, string>): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (input: string) => {
    calls.push(input)
    const id = /audio\/(.+)\.m4a$/.exec(input)?.[1]
    const body = id === undefined ? undefined : bodies[id]
    return body === undefined ? new Response('', { status: 404 }) : new Response(body)
  }) as Fetch & { calls: string[] }
  fetchFn.calls = calls
  return fetchFn
}

const store = (over: Partial<AudioStoreOptions> = {}) =>
  new AudioStore({ manifestUrl: MANIFEST, sha256: env.sha256, canPlay: () => true, online: () => true, fetch: server({}), ...over })

afterEach(async () => {
  await caches.delete(AUDIO_CACHE)
})

describe('AudioStore', () => {
  it('prefetches verified clips into the cache, once, and a new store finds them', async () => {
    const a = await clip('a', 'aaa')
    const b = await clip('b', 'bbb')
    const fetchFn = server({ a: 'aaa', b: 'bbb' })
    const first = store({ fetch: fetchFn })
    expect(await first.prefetch([a, b])).toBe(2)
    expect(await first.prefetch([a, b])).toBe(0)
    expect(fetchFn.calls).toHaveLength(2)
    expect(first.cachedClips()).toEqual(new Set(['a', 'b']))
    const second = store()
    await second.refresh(corpusOf([a, b]))
    expect(second.cachedClips()).toEqual(new Set(['a', 'b']))
  })

  it('refuses a clip whose bytes do not match the pack’s checksum', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'tampered' }) })
    expect(await s.prefetch([a])).toBe(0)
    expect(s.cachedClips().size).toBe(0)
  })

  it('reports nothing playable when the browser cannot play the format (spec §7.5)', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'aaa' }), canPlay: () => false })
    await s.prefetch([a])
    await s.refresh(corpusOf([a]))
    expect(s.cachedClips().size).toBe(0)
    expect(s.streamable()).toBe(false)
  })

  it('streams only when online and the format plays', async () => {
    const a = await clip('a', 'aaa')
    let online = true
    const s = store({ online: () => online })
    await s.refresh(corpusOf([a]))
    expect(s.streamable()).toBe(true)
    online = false
    expect(s.streamable()).toBe(false)
  })

  it('plays from the cache without the network, resolving when the clip ends', async () => {
    const a = await clip('a', 'aaa')
    const fetchFn = server({ a: 'aaa' })
    const player = fakePlayer('ends')
    const s = store({ fetch: fetchFn, player: () => player })
    await s.prefetch([a])
    fetchFn.calls.length = 0
    await s.play(a)
    expect(fetchFn.calls).toEqual([])
    expect(player.played).toBe(1)
  })

  it('rejects when the clip cannot play, so the view can say so', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'aaa' }), player: () => fakePlayer('fails') })
    await expect(s.play(a)).rejects.toThrow()
  })
})

function fakePlayer(outcome: 'ends' | 'fails'): PlayerLike & { played: number } {
  const target = new EventTarget()
  const player = {
    src: '',
    played: 0,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    pause: () => undefined,
    play: async () => {
      player.played += 1
      if (outcome === 'fails') throw new DOMException('no decoder', 'NotSupportedError')
      setTimeout(() => target.dispatchEvent(new Event('ended')), 5)
    },
  }
  return player
}
