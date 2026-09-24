import type { AudioClip, Corpus } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { webEnv } from '../env'
import { AUDIO_CACHE, AudioStore, ClipSuperseded, type AudioStoreOptions, type PlayerLike } from './audio'
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

/** A promise this test can resolve from outside, for deterministic synchronization without timers. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
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

  it('refuses to stream an uncached clip whose bytes fail verification, and caches nothing', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'tampered' }) })
    await expect(s.play(a)).rejects.toThrow()
    expect(s.cachedClips().size).toBe(0)
  })

  it('verifies a matching uncached clip before streaming it, and caches it once verified', async () => {
    const a = await clip('a', 'aaa')
    const player = fakePlayer('ends')
    const s = store({ fetch: server({ a: 'aaa' }), player: () => player })
    await s.play(a)
    expect(player.played).toBe(1)
    expect(s.cachedClips()).toEqual(new Set(['a']))
  })

  it('rejects a play that is already waiting for "ended" when a new one starts', async () => {
    const a = await clip('a', 'aaa')
    const b = await clip('b', 'bbb')
    const started = deferred<void>()
    const never = fakePlayer('never', () => started.resolve())
    const ends = fakePlayer('ends')
    let calls = 0
    const s = store({ fetch: server({ a: 'aaa', b: 'bbb' }), player: () => (calls++ === 0 ? never : ends) })
    await s.prefetch([a, b])
    const firstPlay = s.play(a)
    // Waits for the first play() to actually reach the 'waiting for ended' stage — deterministic,
    // no real-timer race — before starting the second, which must supersede it.
    await started.promise
    const secondPlay = s.play(b)
    await expect(firstPlay).rejects.toBeInstanceOf(ClipSuperseded)
    await expect(secondPlay).resolves.toBeUndefined()
    expect(never.played).toBe(1)
    expect(ends.played).toBe(1)
  })

  it('the newest play wins even when an older, slower setup finishes last', async () => {
    const a = await clip('a', 'aaa')
    const b = await clip('b', 'bbb')
    const fetchAStarted = deferred<void>()
    const releaseA = deferred<void>()
    const base = server({ a: 'aaa', b: 'bbb' })
    const slow: Fetch = async (input) => {
      if (input.includes('audio/a.m4a')) {
        fetchAStarted.resolve()
        await releaseA.promise
      }
      return base(input)
    }
    const player = fakePlayer('ends')
    let playerCalls = 0
    const s = store({
      fetch: slow,
      player: () => {
        playerCalls += 1
        return player
      },
    })
    await s.prefetch([b]) // only b is cached; a stays uncached, and its fetch is gated
    const firstPlay = s.play(a) // uncached and slow: blocks inside fetchVerifyAndCache
    await fetchAStarted.promise // a's fetch has genuinely started before b's play() begins
    const secondPlay = s.play(b) // cached: finishes its setup and starts playing well before a's fetch returns
    await expect(secondPlay).resolves.toBeUndefined()
    expect(player.played).toBe(1)
    releaseA.resolve() // only now does a's slow fetch — and so its stale check — complete
    await expect(firstPlay).rejects.toBeInstanceOf(ClipSuperseded)
    expect(playerCalls).toBe(1) // a's setup finished last, but it never touched a player at all
  })
})

function fakePlayer(outcome: 'ends' | 'fails' | 'never', onPlay?: () => void): PlayerLike & { played: number } {
  const target = new EventTarget()
  const player = {
    src: '',
    played: 0,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    pause: () => undefined,
    play: async () => {
      player.played += 1
      onPlay?.()
      if (outcome === 'fails') throw new DOMException('no decoder', 'NotSupportedError')
      if (outcome === 'ends') setTimeout(() => target.dispatchEvent(new Event('ended')), 5)
      // 'never': resolves but never dispatches 'ended' or 'error' — the play stays pending until superseded.
    },
  }
  return player
}
