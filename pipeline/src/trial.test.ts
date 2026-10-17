import { loadCorpus, validatePack, type CefrLevel, type Pack, type PackEntry } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './checksum'
import { buildTrial, planTrial, trialProblems } from './trial'

type Shape = Partial<Record<CefrLevel, number[]>>

/** A course pack built in code: `{ A1: [30, 30] }` is two A1 units of 30 words. Words are `w-<level>-<n>`. */
function coursePack(shape: Shape, version = 7, retiredUnits: string[] = []): Pack {
  const entries: PackEntry[] = []
  const units: Pack['units'][number][] = []
  const audio: Pack['audio'][number][] = []
  let order = 1
  for (const [level, sizes] of Object.entries(shape) as [CefrLevel, number[]][]) {
    let n = 0
    sizes.forEach((size, u) => {
      const unit_id = `${level.toLowerCase()}-${u + 1}`
      const ids: string[] = []
      for (let i = 0; i < size; i++) {
        n++
        const entry_id = `w-${level}-${String(n).padStart(3, '0')}`
        ids.push(entry_id)
        const clip = `${entry_id}-uk`
        audio.push({ clip_id: clip, url: `audio/${clip}.m4a`, sha256: sha256Hex(new TextEncoder().encode(clip)), bytes: 4, mime: 'audio/mp4' })
        entries.push({
          entry_id,
          headword: `w-${level}-${n}`,
          variants: [],
          pos: 'noun',
          sense: '',
          ipa: 'x',
          level,
          unit_id,
          themes: [u === 0 ? 'food' : 'home'],
          translation: `t${n}`,
          alternates: [],
          examples: ['An example.'],
          audio: { uk: clip },
          retired: retiredUnits.includes(unit_id),
        })
      }
      units.push({ unit_id, level, order: order++, title: { en: unit_id, l1: unit_id }, entry_ids: ids })
    })
  }
  return {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: version,
    l1: 'bg',
    target: 'en',
    entries,
    units,
    themes: [
      { theme_id: 'food', name: { en: 'Food', l1: 'Храна' }, description: { en: 'Food.', l1: 'Храна.' } },
      { theme_id: 'home', name: { en: 'Home', l1: 'Дом' }, description: { en: 'Home.', l1: 'Дом.' } },
    ],
    audio,
  }
}

const shape: Shape = { A1: [30, 30, 30], A2: [30, 30], B1: [5] }
const course = coursePack(shape)

describe('buildTrial', () => {
  it('holds exactly the first unit of every level, entries equal to the course', () => {
    const { pack } = buildTrial(course, 40)
    expect(pack.units.map((u) => u.unit_id)).toEqual(['a1-1', 'a2-1', 'b1-1'])
    const first = new Set(pack.units.flatMap((u) => u.entry_ids))
    expect(pack.entries).toEqual(course.entries.filter((e) => first.has(e.entry_id)))
    expect(pack.themes.map((t) => t.theme_id)).toEqual(['food', 'home'])
    expect(pack.audio.map((c) => c.clip_id)).toEqual(pack.entries.map((e) => `${e.entry_id}-uk`))
  })

  it('gives the same bytes whatever the order of the course pack\'s arrays', () => {
    const shuffled = { ...course, entries: [...course.entries].reverse(), units: [...course.units].reverse(), themes: [...course.themes].reverse(), audio: [...course.audio].reverse() }
    expect(buildTrial(shuffled, 40).packBytes).toEqual(buildTrial(course, 40).packBytes)
  })

  it('takes the second unit of a level whose first is all retired', () => {
    const { pack } = buildTrial(coursePack(shape, 7, ['a1-1']), 40)
    expect(pack.units.map((u) => u.unit_id)).toEqual(['a1-2', 'a2-1', 'b1-1'])
  })

  it('takes the second unit of a level whose first is all known from the start, and never asks or counts such a word', () => {
    const quiet = { ...course, entries: course.entries.map((e) => (e.unit_id === 'a1-1' ? { ...e, taught: false } : e)) }
    const { pack } = buildTrial(quiet, 40)
    expect(pack.units.map((u) => u.unit_id)).toEqual(['a1-2', 'a2-1', 'b1-1'])
    const first = new Set(course.entries.filter((e) => e.unit_id === 'a1-1').map((e) => e.entry_id))
    expect(pack.trial!.probes.some((p) => first.has(p.entry_id))).toBe(false)
    expect(pack.trial!.course['A1']).toEqual({ units: 2, words: 60 })
  })

  it('draws 40 live probes of the right level, or all there are', () => {
    const { pack } = buildTrial(coursePack(shape, 7, ['a1-1']), 40)
    const by = (l: string) => pack.trial!.probes.filter((p) => p.level === l)
    expect(by('A1')).toHaveLength(40)
    expect(by('A2')).toHaveLength(40)
    expect(by('B1')).toHaveLength(5)
    const retired = new Set(course.entries.filter((e) => e.unit_id === 'a1-1').map((e) => e.entry_id))
    expect(pack.trial!.probes.some((p) => retired.has(p.entry_id))).toBe(false)
    const ids = pack.trial!.probes.map((p) => p.entry_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('draws from the whole level, not the first unit', () => {
    const { pack } = buildTrial(course, 40)
    const a1 = pack.trial!.probes.filter((p) => p.level === 'A1')
    expect(a1.some((p) => Number(p.entry_id.slice(5)) > 30)).toBe(true)
  })

  it('draws every word of a level about equally often over many versions', () => {
    const counts = new Map<string, number>()
    for (let v = 1; v <= 300; v++) {
      for (const p of buildTrial(coursePack({ A1: [30, 30, 30] }, v), 40).pack.trial!.probes) counts.set(p.entry_id, (counts.get(p.entry_id) ?? 0) + 1)
    }
    expect(counts.size).toBe(90)
    for (const n of counts.values()) {
      expect(n).toBeGreaterThanOrEqual(90)
      expect(n).toBeLessThanOrEqual(180)
    }
  })

  it('is deterministic and changes with the version', () => {
    expect(buildTrial(course, 40).packBytes).toEqual(buildTrial(coursePack(shape), 40).packBytes)
    const a1 = (v: number) => buildTrial(coursePack(shape, v), 40).pack.trial!.probes.filter((p) => p.level === 'A1').map((p) => p.entry_id)
    expect(a1(8)).not.toEqual(a1(7))
  })

  it('names the themes the course offers with their sizes there, and defines each; a theme too small is not named (#244)', () => {
    // food: the first unit of every level (30 + 30 + 5); home: the other units (60 + 30).
    const { pack } = buildTrial(course, 40)
    expect(pack.trial!.themes).toEqual({ food: 65, home: 90 })
    expect(pack.themes.map((t) => t.theme_id)).toEqual(['food', 'home'])
    // A course of five words: its one theme is defined, since the unit's entries name it, and is not on offer.
    const small = buildTrial(coursePack({ B1: [5] }), 40).pack
    expect(small.trial!.themes).toEqual({})
    expect(small.themes.map((t) => t.theme_id)).toEqual(['food'])
    // Retired words do not count.
    expect(buildTrial(coursePack(shape, 7, ['a1-2']), 40).pack.trial!.themes).toEqual({ food: 65, home: 60 })
  })

  it('counts the course per level', () => {
    expect(buildTrial(course, 40).pack.trial!.course).toEqual({ A1: { units: 3, words: 90 }, A2: { units: 2, words: 60 }, B1: { units: 1, words: 5 } })
  })

  it('is a valid pack that core loads with its probes', () => {
    const out = buildTrial(course, 40)
    const parsed = JSON.parse(new TextDecoder().decode(out.packBytes))
    expect(validatePack(parsed).status).toBe('ok')
    const corpus = loadCorpus([out.pack])
    expect(corpus.trial!.probes.map((p) => p.entryId)).toEqual(out.pack.trial!.probes.map((p) => p.entry_id))
  })

  it('names its file and describes it for the trial manifest', () => {
    const out = buildTrial(course, 40)
    expect(out.packFile).toBe('trial-v7-bg.trial')
    expect(out.descriptor).toEqual({
      pack_id: 'corpus-bg',
      l1: 'bg',
      corpus_version: 7,
      schema_version: 1,
      url: 'trial-v7-bg.trial',
      sha256: sha256Hex(out.packBytes),
      bytes: out.packBytes.byteLength,
    })
  })
})

describe('trialProblems', () => {
  it('finds none in a built trial', () => {
    expect(trialProblems(course, buildTrial(course, 40).pack)).toEqual([])
  })

  it('names an entry that differs from the course', () => {
    const t = buildTrial(course, 40).pack
    const edited = { ...t, entries: t.entries.map((e, i) => (i === 0 ? { ...e, translation: 'other' } : e)) }
    expect(trialProblems(course, edited)).toEqual([`${t.entries[0]!.entry_id}: differs from the course's entry`])
  })

  it('names a level with a unit and no probes', () => {
    const t = buildTrial(course, 40).pack
    const edited = { ...t, trial: { ...t.trial!, probes: t.trial!.probes.filter((p) => p.level !== 'B1') } }
    expect(trialProblems(course, edited)).toEqual(['B1: the trial has a unit and no probes'])
  })

  it('names a clip whose checksum differs', () => {
    const t = buildTrial(course, 40).pack
    const edited = { ...t, audio: t.audio.map((c, i) => (i === 0 ? { ...c, sha256: 'f'.repeat(64) } : c)) }
    expect(trialProblems(course, edited)).toEqual([`${t.audio[0]!.clip_id}: differs from the course's clip`])
  })
})

describe('planTrial', () => {
  it('builds the trial and reports no problem for a sound course', () => {
    const { trial, problems } = planTrial(course, 40)
    expect(problems).toEqual([])
    expect(trial?.packFile).toBe('trial-v7-bg.trial')
  })

  it('returns the trialProblems lines: with no probes drawn, every level that has a unit is named', () => {
    // probesPerLevel 0 leaves every level with a unit and no probes.
    expect(planTrial(course, 0).problems).toEqual(['A1: the trial has a unit and no probes', 'A2: the trial has a unit and no probes', 'B1: the trial has a unit and no probes'])
  })

  it('reports a trial that cannot be built as problems of the trial, by path, and gives no trial', () => {
    // A doctored course pack: a word of the first unit lost its headword, which the trial pack's own validation refuses.
    const first = course.units.find((u) => u.order === Math.min(...course.units.map((x) => x.order)))!.entry_ids[0]!
    const broken: Pack = { ...course, entries: course.entries.map((e) => (e.entry_id === first ? { ...e, headword: '' } : e)) }
    const { trial, problems } = planTrial(broken, 40)
    expect(trial).toBeNull()
    expect(problems.length).toBeGreaterThan(0)
    for (const line of problems) expect(line).toMatch(/^entries\[\d+\]\.headword: \S/)
  })
})
