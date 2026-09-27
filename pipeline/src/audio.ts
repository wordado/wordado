import { writeFileSync, mkdirSync } from 'node:fs'
import { canonicalJson, type Accent } from '@wordado/core'
import { sha256Hex } from './checksum'
import type { PipelineConfig, TtsVoice } from './config'
import { contentPaths } from './content'
import { QUEUES, type Decisions } from './decisions'
import type { Encoder } from './encoder'
import { appendJsonl, readJsonl } from './files'
import { mapLimit } from './mapLimit'
import type { QueueItem } from './queues'
import type { Tts } from './tts'

export const MIN_SECONDS = 0.15
export const MAX_SECONDS = 3
const TRIES = 3

/** One clip ever made. A clip's bytes never change: a new take is a new generation and a new ID (Decision 10). */
export interface AudioRecord {
  readonly clip_id: string
  readonly entry_id: string
  readonly accent: Accent
  readonly text: string
  readonly voice_key: string
  readonly generation: number
  /** The `corpus audio` run that made it: the unit of the spot-listen (§5.4). */
  readonly batch: string
  /** new: first clip; voice: the voice settings changed; redo: a reviewer or a report asked for it. */
  readonly reason: 'new' | 'voice' | 'redo'
  readonly created_at: string
  readonly seconds: number
}

export interface ClipNeed {
  readonly entry_id: string
  readonly accent: Accent
  readonly text: string
  readonly generation: number
  readonly reason: AudioRecord['reason']
}

const sha = (s: string) => sha256Hex(new TextEncoder().encode(s))

/** Changing the model, voice, instructions or options of an accent changes its key, and so remakes its clips. */
export function voiceKey(model: string, voice: TtsVoice): string {
  return sha(canonicalJson([model, voice])).slice(0, 16)
}

export function readAudioRecords(dir: string): AudioRecord[] {
  return readJsonl<AudioRecord>(contentPaths(dir).audioRecords)
}

/** The latest generation per entry and accent. */
export function currentClips(records: readonly AudioRecord[]): Map<string, AudioRecord> {
  const out = new Map<string, AudioRecord>()
  for (const r of records) {
    const key = `${r.entry_id}|${r.accent}`
    const have = out.get(key)
    if (!have || r.generation > have.generation) out.set(key, r)
  }
  return out
}

const isRedone = (decisions: Decisions, clipId: string) => decisions.for(QUEUES.audio, clipId).some((e) => e.verdict === 'redo')

export function clipsNeeded(
  live: readonly { entry_id: string; headword: string }[],
  records: readonly AudioRecord[],
  config: PipelineConfig,
  decisions: Decisions,
): ClipNeed[] {
  const current = currentClips(records)
  const needs: ClipNeed[] = []
  for (const e of live) {
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = current.get(`${e.entry_id}|${accent}`)
      const need = (reason: AudioRecord['reason']) => needs.push({ entry_id: e.entry_id, accent, text: e.headword, generation: (cur?.generation ?? 0) + 1, reason })
      if (!cur) need('new')
      else if (cur.voice_key !== voiceKey(config.tts.model, voice) || cur.text !== e.headword) need('voice')
      else if (isRedone(decisions, cur.clip_id)) need('redo')
    }
  }
  return needs
}

/**
 * Makes each needed clip: speak, encode, check its length, and try again up to
 * three times. Each clip is written and recorded the moment it is made, so a
 * failure or a stop keeps everything before it (Review Focus 2).
 */
export async function generateClips(
  dir: string,
  needs: readonly ClipNeed[],
  deps: { tts: Tts; encoder: Encoder; config: PipelineConfig; batch: string; now: () => string; concurrency?: number },
): Promise<{ made: AudioRecord[]; failed: string[]; skipped: number }> {
  const paths = contentPaths(dir)
  mkdirSync(paths.audioDir, { recursive: true })
  const todo = needs.slice(0, deps.config.tts.max_clips_per_run)
  const made: AudioRecord[] = []
  const failed: string[] = []
  await mapLimit(todo, deps.concurrency ?? 4, async (need) => {
    const clipId = `${need.entry_id}-${need.accent}-${need.generation}`
    const voice = deps.config.tts.accents[need.accent]!
    try {
      let last = 0
      for (let i = 0; i < TRIES; i += 1) {
        const clip = await deps.encoder.toM4a(await deps.tts.speak(need.text, voice))
        last = clip.seconds
        if (clip.seconds < MIN_SECONDS || clip.seconds > MAX_SECONDS) continue
        writeFileSync(paths.clip(clipId), clip.bytes)
        const record: AudioRecord = {
          clip_id: clipId,
          entry_id: need.entry_id,
          accent: need.accent,
          text: need.text,
          voice_key: voiceKey(deps.config.tts.model, voice),
          generation: need.generation,
          batch: deps.batch,
          reason: need.reason,
          created_at: deps.now(),
          seconds: Math.round(clip.seconds * 100) / 100,
        }
        appendJsonl(paths.audioRecords, [record])
        made.push(record)
        return
      }
      failed.push(`${clipId}: ${TRIES} tries, the last ${last} s long (${MIN_SECONDS}–${MAX_SECONDS} s)`)
    } catch (err) {
      failed.push(`${clipId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
  return { made, failed: failed.sort(), skipped: needs.length - todo.length }
}

/** A batch's spot-listen: max(5, ⌈10%⌉) clips chosen by a hash of batch and clip, so reruns choose the same. */
export function audioSample(clipIds: readonly string[], batch: string): Set<string> {
  const size = Math.min(clipIds.length, Math.max(5, Math.ceil(clipIds.length / 10)))
  return new Set([...clipIds].sort((a, b) => (sha(`${batch}|${a}`) < sha(`${batch}|${b}`) ? -1 : 1)).slice(0, size))
}

/** Per batch, the clips a reviewer must listen to: the sample, and every clip made again (Decision 12). */
export function listenedTo(records: readonly AudioRecord[]): Map<string, Set<string>> {
  const byBatch = new Map<string, AudioRecord[]>()
  for (const r of records) byBatch.set(r.batch, [...(byBatch.get(r.batch) ?? []), r])
  const out = new Map<string, Set<string>>()
  for (const [batch, rs] of byBatch) {
    const chosen = audioSample(rs.map((r) => r.clip_id), batch)
    for (const r of rs) if (r.reason === 'redo') chosen.add(r.clip_id)
    out.set(batch, chosen)
  }
  return out
}

const heard = (decisions: Decisions, clipId: string) => decisions.for(QUEUES.audio, clipId).some((e) => e.verdict === 'ok' || e.verdict === 'redo')

export function audioQueueItems(records: readonly AudioRecord[], decisions: Decisions): QueueItem[] {
  const byId = new Map(records.map((r) => [r.clip_id, r]))
  const current = new Set([...currentClips(records).values()].map((r) => r.clip_id))
  return [...listenedTo(records).values()]
    .flatMap((set) => [...set])
    .filter((id) => current.has(id) && !heard(decisions, id))
    .map((id) => {
      const r = byId.get(id)!
      return { key: id, proposed: id, context: { headword: r.text, accent: r.accent, listen: `../../audio/${id}.m4a`, reason: r.reason } }
    })
}

/** What stops a release on audio: a live entry without a current clip, a clip marked redo, a batch not yet heard. */
export function audioProblems(live: readonly { entry_id: string }[], records: readonly AudioRecord[], config: PipelineConfig, decisions: Decisions): string[] {
  const problems: string[] = []
  const current = currentClips(records)
  const batches = new Set<string>()
  for (const e of live) {
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = current.get(`${e.entry_id}|${accent}`)
      if (!cur || cur.voice_key !== voiceKey(config.tts.model, voice)) problems.push(`${e.entry_id}: no current ${accent} clip; run corpus audio`)
      else if (isRedone(decisions, cur.clip_id)) problems.push(`${e.entry_id}: ${accent} clip ${cur.clip_id} is marked redo; run corpus audio`)
      else batches.add(cur.batch)
    }
  }
  const chosen = listenedTo(records)
  for (const batch of [...batches].sort()) {
    const waiting = [...(chosen.get(batch) ?? [])].filter((id) => !heard(decisions, id)).length
    if (waiting > 0) problems.push(`audio batch ${batch}: ${waiting} clips not yet listened to`)
  }
  return problems
}
