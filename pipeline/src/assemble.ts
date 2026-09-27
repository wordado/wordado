import { norm, type Accent, type Pack, type PackEntry } from '@wordado/core'
import { currentClips, voiceKey, type AudioRecord } from './audio'
import type { CuratedTheme, PipelineConfig, TtsVoice } from './config'
import { foldField, QUEUES, type Decisions } from './decisions'
import type { Draft } from './draft'
import { levelSampled } from './queues'
import { inPathOrder } from './units'

export interface AssembleInput {
  readonly l1: string
  readonly corpusVersion: number
  readonly draft: Draft
  readonly decisions: Decisions
  readonly themes: readonly CuratedTheme[]
  readonly records: readonly AudioRecord[]
  readonly config: PipelineConfig
  /** This L1's last published pack, or null for an L1 never published. */
  readonly previous: Pack | null
  readonly hasClip: (clipId: string) => boolean
}

export interface Assembled {
  /** A pack source for `buildPack`: the pack without schema_version and audio. */
  readonly source: Record<string, unknown>
  readonly clipIds: readonly string[]
  /** Blocks any release, draft or not. */
  readonly problems: readonly string[]
  /** Awaits a reviewer; blocks all but a draft. */
  readonly pending: readonly string[]
}

/**
 * One L1's pack at the next version (Decision 14). A live entry takes each
 * field's folded value. An entry the previous pack carried and this draft
 * does not make live stays, retired, exactly as published (spec §5.1). Its
 * clips are kept when their files are still here.
 */
export function assemble(input: AssembleInput): Assembled {
  const { l1, draft, decisions, config } = input
  const problems: string[] = []
  const pending: string[] = []
  const live = new Set(draft.live)
  const liveEntries = draft.entries.filter((e) => live.has(e.entry_id))
  const clips = currentClips(input.records)

  const perHead = new Map<string, number>()
  for (const e of liveEntries) perHead.set(`${norm(e.headword)}|${e.pos}`, (perHead.get(`${norm(e.headword)}|${e.pos}`) ?? 0) + 1)

  const unitOf = new Map<string, string>()
  for (const u of draft.units) for (const id of u.entry_ids) unitOf.set(id, u.unit_id)

  const entries: PackEntry[] = []
  for (const e of liveEntries) {
    const english = foldField(e.english, decisions.for(QUEUES.english, e.entry_id))
    const translation = foldField(e.l1[l1]!, decisions.for(QUEUES.translation(l1), e.entry_id))
    if (!english.reviewed) pending.push(`${e.entry_id}: english not reviewed`)
    if (!translation.reviewed) pending.push(`${e.entry_id}: translation (${l1}) not reviewed`)
    if ((e.level_flagged || levelSampled(e.entry_id)) && !foldField(e.level_proposal, decisions.for(QUEUES.level, e.entry_id)).reviewed) {
      pending.push(`${e.entry_id}: level not reviewed`)
    }
    const senses = perHead.get(`${norm(e.headword)}|${e.pos}`) ?? 1
    if (senses > 1 && translation.value.sense.trim() === '') problems.push(`${e.entry_id}: ${e.headword} (${e.pos}) has ${senses} live entries, so it needs a ${l1} sense gloss`)
    const audio: Partial<Record<Accent, string>> = {}
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = clips.get(`${e.entry_id}|${accent}`)
      if (cur && cur.voice_key === voiceKey(config.tts.model, voice) && input.hasClip(cur.clip_id)) audio[accent] = cur.clip_id
    }
    const unitId = unitOf.get(e.entry_id)
    if (!unitId) {
      problems.push(`${e.entry_id}: live but in no unit`)
      continue
    }
    entries.push({
      entry_id: e.entry_id,
      headword: e.headword,
      variants: english.value.variants,
      pos: e.pos,
      sense: senses > 1 ? translation.value.sense : '',
      ipa: english.value.ipa,
      level: e.level,
      unit_id: unitId,
      themes: e.themes,
      translation: translation.value.translation,
      alternates: translation.value.alternates,
      examples: english.value.examples,
      audio,
      retired: false,
    })
  }

  for (const old of input.previous?.entries ?? []) {
    if (live.has(old.entry_id)) continue
    const audio = Object.fromEntries(Object.entries(old.audio).filter(([, clip]) => input.hasClip(clip)))
    entries.push({ ...old, audio, retired: true })
  }

  const present = new Set(entries.map((e) => e.entry_id))
  const byUnit = new Map<string, string[]>()
  for (const e of entries) byUnit.set(e.unit_id, [...(byUnit.get(e.unit_id) ?? []), e.entry_id])
  const previousUnits = new Map((input.previous?.units ?? []).map((u) => [u.unit_id, u]))
  const draftUnits = new Map(draft.units.map((u) => [u.unit_id, u]))
  const unitIds = new Set(byUnit.keys())
  const ordered = inPathOrder(
    [...unitIds].map((id) => ({ unit_id: id, level: (draftUnits.get(id) ?? previousUnits.get(id))!.level, entry_ids: [] as string[] })),
  )
  const units = ordered.map((u, i) => {
    const members = draftUnits.get(u.unit_id)?.entry_ids.filter((id) => present.has(id)) ?? []
    const listed = new Set(members)
    const entry_ids = [...members, ...byUnit.get(u.unit_id)!.filter((id) => !listed.has(id))]
    const hasLive = entry_ids.some((id) => live.has(id))
    let title = previousUnits.get(u.unit_id)?.title
    const proposed = draftUnits.get(u.unit_id)?.titles[l1]
    if (hasLive && proposed) {
      const state = foldField(proposed, decisions.for(QUEUES.title(l1), u.unit_id))
      if (!state.reviewed) pending.push(`unit ${u.unit_id}: title (${l1}) not reviewed`)
      title = state.value
    }
    if (!title) {
      problems.push(`unit ${u.unit_id}: has no ${l1} title`)
      title = { en: u.unit_id, l1: u.unit_id }
    }
    return { unit_id: u.unit_id, level: u.level, order: i + 1, title, entry_ids }
  })

  const themes = input.themes.map((t) => ({
    theme_id: t.theme_id,
    name: { en: t.name['en']!, l1: t.name[l1]! },
    description: { en: t.description['en']!, l1: t.description[l1]! },
  }))
  const clipIds = entries.flatMap((e) => Object.values(e.audio)).sort()
  return {
    source: { pack_id: `corpus-${l1}`, corpus_version: input.corpusVersion, l1, target: 'en', units, themes, entries },
    clipIds,
    problems,
    pending,
  }
}
