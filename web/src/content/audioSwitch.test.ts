import type { AudioClip, Corpus } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import type { AudioStore } from './audio'
import { AudioSwitch } from './audioSwitch'

/** A store that says which manifest it serves in every answer. */
function store(manifestUrl: string, log: string[]): AudioStore {
  return {
    cachedClips: () => new Set([manifestUrl]),
    streamable: () => manifestUrl.startsWith('https:'),
    play: async (clip: AudioClip) => void log.push(`play ${clip.clipId} from ${manifestUrl}`),
    prefetch: async (clips: readonly AudioClip[]) => clips.length,
    refresh: async () => void log.push(`refresh ${manifestUrl}`),
  } as unknown as AudioStore
}

const clip = { clipId: 'hello-1-uk', url: 'audio/hello-1-uk.m4a', sha256: 'x', bytes: 1, mime: 'audio/mp4' }

describe('AudioSwitch: one AudioStore per manifest (plan 7)', () => {
  it('answers from the manifest in use, and keeps one store per manifest', async () => {
    const log: string[] = []
    const made: string[] = []
    const audio = new AudioSwitch((url) => {
      made.push(url)
      return store(url, log)
    }, '/content/sample/manifest.json')
    expect([...audio.cachedClips()]).toEqual(['/content/sample/manifest.json'])
    expect(audio.streamable()).toBe(false)

    audio.use('https://content.wordado.com/manifest.json')
    expect(audio.manifestUrl).toBe('https://content.wordado.com/manifest.json')
    expect(audio.streamable()).toBe(true)
    await audio.play(clip)
    await audio.refresh({} as Corpus)
    expect(await audio.prefetch([clip, clip])).toBe(2)

    audio.use('/content/sample/manifest.json')
    audio.use('https://content.wordado.com/manifest.json')
    expect(made).toEqual(['/content/sample/manifest.json', 'https://content.wordado.com/manifest.json'])
    expect(log).toEqual(['play hello-1-uk from https://content.wordado.com/manifest.json', 'refresh https://content.wordado.com/manifest.json'])
  })
})
