import { norm, type Accent, type Pack, type PackEntry, type PackUnit } from '@wordado/core'
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
  /** The lead L1's (config.l1s[0]) last published units, for a non-lead pack's title.en when the unit is not live (Decision: every L1's title shares the lead's English). Empty when the lead was never published. */
  readonly previousLeadUnits: readonly PackUnit[]
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
  /** Awaits a reviewer in a queue `accept_unreviewed` names: ships as proposed, and stays open for review. */
  readonly unreviewed: readonly Unreviewed[]
}

export interface Unreviewed {
  readonly queue: string
  readonly line: string
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
  const unreviewed: Unreviewed[] = []
  const accepted = new Set(config.accept_unreviewed ?? [])
  const awaiting = (queue: string, line: string) => void (accepted.has(queue) ? unreviewed.push({ queue, line }) : pending.push(line))
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
    const level = foldField(e.level_proposal, decisions.for(QUEUES.level, e.entry_id))
    if (!english.reviewed) awaiting(QUEUES.english, `${e.entry_id}: english not reviewed`)
    if (!translation.reviewed) awaiting(QUEUES.translation(l1), `${e.entry_id}: translation (${l1}) not reviewed`)
    if ((e.level_flagged || levelSampled(e.entry_id)) && !level.reviewed) {
      awaiting(QUEUES.level, `${e.entry_id}: level not reviewed`)
    }
    // A decision recorded after `corpus draft` last ran is not folded into e.live or e.level yet: ship nothing
    // stale (Review Focus 1). Rerunning the draft picks it up as a drop or a new level.
    if (english.dropped || translation.dropped || level.value !== e.level) {
      pending.push(`${e.entry_id}: decided since the draft; run corpus draft`)
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

  // A unit lists only the entries whose pack unit_id it is: a retired entry keeps its old unit, whatever the draft says.
  const unitIdOf = new Map(entries.map((e) => [e.entry_id, e.unit_id]))
  const byUnit = new Map<string, string[]>()
  for (const e of entries) byUnit.set(e.unit_id, [...(byUnit.get(e.unit_id) ?? []), e.entry_id])
  const previousUnits = new Map((input.previous?.units ?? []).map((u) => [u.unit_id, u]))
  const previousLeadUnits = new Map(input.previousLeadUnits.map((u) => [u.unit_id, u]))
  const draftUnits = new Map(draft.units.map((u) => [u.unit_id, u]))
  const lead = config.l1s[0]
  const unitIds = new Set(byUnit.keys())
  const ordered = inPathOrder(
    [...unitIds].map((id) => ({ unit_id: id, level: (draftUnits.get(id) ?? previousUnits.get(id))!.level, entry_ids: [] as string[] })),
  )
  const units = ordered.map((u, i) => {
    const members = draftUnits.get(u.unit_id)?.entry_ids.filter((id) => unitIdOf.get(id) === u.unit_id) ?? []
    const listed = new Set(members)
    const entry_ids = [...members, ...byUnit.get(u.unit_id)!.filter((id) => !listed.has(id))]
    const hasLive = entry_ids.some((id) => live.has(id))
    let title = previousUnits.get(u.unit_id)?.title
    const proposed = draftUnits.get(u.unit_id)?.titles[l1]
    if (hasLive && proposed) {
      const state = foldField(proposed, decisions.for(QUEUES.title(l1), u.unit_id))
      if (!state.reviewed) awaiting(QUEUES.title(l1), `unit ${u.unit_id}: title (${l1}) not reviewed`)
      title = state.value
    }
    if (!title) {
      problems.push(`unit ${u.unit_id}: has no ${l1} title`)
      title = { en: u.unit_id, l1: u.unit_id }
    } else if (lead !== undefined && l1 !== lead) {
      // Every L1's title shares the lead's English (titleUnits): a decision that changes the lead's own title
      // is folded only into the lead's pack, so a non-lead pack picks up the lead's current English here.
      const leadProposed = draftUnits.get(u.unit_id)?.titles[lead]
      const leadTitle = hasLive && leadProposed
        ? foldField(leadProposed, decisions.for(QUEUES.title(lead), u.unit_id)).value
        : previousLeadUnits.get(u.unit_id)?.title
      if (leadTitle) title = { en: leadTitle.en, l1: title.l1 }
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
    unreviewed,
  }
}
