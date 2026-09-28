import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioProblems, audioQueueItems, audioSample, clipsNeeded, generateClips, readAudioRecords, voiceKey, type AudioRecord } from './audio'
import { readConfig } from './config'
import { Decisions, QUEUES } from './decisions'
import type { Encoder } from './encoder'
import { makeContent } from './testing/fixture'
import type { Tts } from './tts'

const NOW = '2026-10-01T10:00:00Z'
const fakeTts = (): Tts & { said: string[] } => {
  const said: string[] = []
  return { said, speak: async (text) => (said.push(text), new TextEncoder().encode(`mp3:${text}`)) }
}
const encoder = (seconds: (text: string, attempt: number) => number): Encoder => {
  const attempts = new Map<string, number>()
  return {
    toM4a: async (mp3) => {
      const text = new TextDecoder().decode(mp3)
      const n = (attempts.get(text) ?? 0) + 1
      attempts.set(text, n)
      return { bytes: new TextEncoder().encode(`m4a:${text}:${n}`), seconds: seconds(text, n) }
    },
  }
}

describe('clipsNeeded', () => {
  const dir = makeContent()
  const config = readConfig(dir)
  const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
  const rec = (extra: Partial<AudioRecord> = {}): AudioRecord => ({
    clip_id: 'water-1-uk-1', entry_id: 'water-1', accent: 'uk', text: 'water', voice_key: vk, generation: 1, batch: 'b1', reason: 'new', created_at: NOW, seconds: 0.6, ...extra,
  })
  const live = [{ entry_id: 'water-1', headword: 'water' }]

  it('needs a first clip, then nothing while the voice and the word stay the same', () => {
    expect(clipsNeeded(live, [], config, Decisions.read(dir))).toEqual([{ entry_id: 'water-1', accent: 'uk', text: 'water', generation: 1, reason: 'new' }])
    expect(clipsNeeded(live, [rec()], config, Decisions.read(dir))).toEqual([])
  })

  it('makes a new generation when the voice changed, or the current clip was marked redo', () => {
    expect(clipsNeeded(live, [rec({ voice_key: 'old' })], config, Decisions.read(dir))).toMatchObject([{ generation: 2, reason: 'voice' }])
    const d = Decisions.read(dir)
    d.append(QUEUES.audio, [{ key: 'water-1-uk-1', at: NOW, verdict: 'redo', proposed: 'water-1-uk-1', by: 'reports' }])
    expect(clipsNeeded(live, [rec()], config, d)).toMatchObject([{ generation: 2, reason: 'redo' }])
    expect(clipsNeeded(live, [rec(), rec({ clip_id: 'water-1-uk-2', generation: 2, reason: 'redo' })], config, d)).toEqual([])
  })
})

describe('generateClips', () => {
  it('writes each clip under a new ID and records it as it goes', async () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const needs = [{ entry_id: 'water-1', accent: 'uk' as const, text: 'water', generation: 1, reason: 'new' as const }]
    const out = await generateClips(dir, needs, { tts: fakeTts(), encoder: encoder(() => 0.6), config, batch: '20261001T1000', now: () => NOW })
    expect(out.made.map((r) => r.clip_id)).toEqual(['water-1-uk-1'])
    expect(readFileSync(join(dir, 'audio', 'water-1-uk-1.m4a'), 'utf8')).toBe('m4a:mp3:water:1')
    expect(readAudioRecords(dir)).toEqual(out.made)
  })

  it('makes a clip again when it is too short or too long, up to three tries', async () => {
    const dir = makeContent()
    const tts = fakeTts()
    const needs = [
      { entry_id: 'a-1', accent: 'uk' as const, text: 'a', generation: 1, reason: 'new' as const },
      { entry_id: 'b-1', accent: 'uk' as const, text: 'b', generation: 1, reason: 'new' as const },
    ]
    const out = await generateClips(dir, needs, { tts, encoder: encoder((t, n) => (t.endsWith('a') ? (n < 3 ? 5 : 0.5) : 0.05)), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect(out.made.map((r) => r.clip_id)).toEqual(['a-1-uk-1'])
    expect(out.failed).toEqual(['b-1-uk-1: 3 tries, the last 0.05 s long (0.15–3 s)'])
    expect(tts.said.filter((w) => w === 'a')).toHaveLength(3)
    expect(tts.said.filter((w) => w === 'b')).toHaveLength(3)
  })

  it('a failed clip leaves the others written and recorded', async () => {
    const dir = makeContent()
    const tts: Tts = { speak: async (text) => { if (text === 'bad') throw new Error('HTTP 400'); return new TextEncoder().encode(text) } }
    const needs = ['good', 'bad'].map((w) => ({ entry_id: `${w}-1`, accent: 'uk' as const, text: w, generation: 1, reason: 'new' as const }))
    const out = await generateClips(dir, needs, { tts, encoder: encoder(() => 0.5), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect(out.failed).toEqual(['bad-1-uk-1: HTTP 400'])
    expect(readAudioRecords(dir).map((r) => r.clip_id)).toEqual(['good-1-uk-1'])
    expect(existsSync(join(dir, 'audio', 'bad-1-uk-1.m4a'))).toBe(false)
  })

  it('makes at most max_clips_per_run, and counts the rest as skipped', async () => {
    const dir = makeContent({ config: { tts: { ...readConfig(makeContent()).tts, max_clips_per_run: 1 } } })
    const needs = ['x', 'y'].map((w) => ({ entry_id: `${w}-1`, accent: 'uk' as const, text: w, generation: 1, reason: 'new' as const }))
    const out = await generateClips(dir, needs, { tts: fakeTts(), encoder: encoder(() => 0.5), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect([out.made.length, out.skipped]).toEqual([1, 1])
  })
})

describe('the spot-listen (Decision 12)', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `w${i}-1-uk-1`)

  it('samples max(5, 10%) of a batch, the same way every time', () => {
    expect(audioSample(ids, 'b1').size).toBe(12)
    expect(audioSample(ids.slice(0, 20), 'b1').size).toBe(5)
    expect(audioSample(ids.slice(0, 3), 'b1').size).toBe(3)
    expect([...audioSample(ids, 'b1')]).toEqual([...audioSample([...ids].reverse(), 'b1')])
  })

  it('queues the sample and every clip made again, until each has a verdict; the gate waits for them', () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
    const records: AudioRecord[] = ids.map((clip_id, i) => ({
      clip_id, entry_id: `w${i}-1`, accent: 'uk', text: `w${i}`, voice_key: vk, generation: 1, batch: 'b1', reason: 'new', created_at: NOW, seconds: 0.5,
    }))
    const d = Decisions.read(dir)
    const live = records.map((r) => ({ entry_id: r.entry_id }))
    const items = audioQueueItems(records, d)
    expect(items).toHaveLength(12)
    expect(items[0]!.context).toMatchObject({ listen: `../../audio/${items[0]!.key}.m4a`, reason: 'new' })
    expect(audioProblems(live, records, config, d)).toEqual(['audio batch b1: 12 clips not yet listened to'])
    d.append(QUEUES.audio, items.map((i) => ({ key: i.key, at: NOW, verdict: 'ok' as const, proposed: i.key, by: 'r' })))
    expect(audioQueueItems(records, d)).toEqual([])
    expect(audioProblems(live, records, config, d)).toEqual([])
  })

  it('names a live entry with no current clip, or whose clip was marked redo', () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const d = Decisions.read(dir)
    const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
    const r: AudioRecord = { clip_id: 'a-1-uk-1', entry_id: 'a-1', accent: 'uk', text: 'a', voice_key: vk, generation: 1, batch: 'b', reason: 'new', created_at: NOW, seconds: 0.5 }
    d.append(QUEUES.audio, [{ key: 'a-1-uk-1', at: NOW, verdict: 'redo', proposed: 'a-1-uk-1', by: 'r' }])
    expect(audioProblems([{ entry_id: 'a-1' }, { entry_id: 'b-1' }], [r], config, d)).toEqual([
      'a-1: uk clip a-1-uk-1 is marked redo; run corpus audio',
      'b-1: no current uk clip; run corpus audio',
    ])
  })
})
