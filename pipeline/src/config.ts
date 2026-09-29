import { CEFR_LEVELS, type Accent, type CefrLevel } from '@wordado/core'
import { readJson } from './files'
import { contentPaths } from './content'
import { QUEUES } from './decisions'

export interface TtsVoice {
  readonly voice: string
  /** How to say it: accent and pace. OpenAI-style models take it as `instructions`. */
  readonly instructions: string
  /** Passed through as the request's `provider.options` (OpenRouter's per-provider settings). */
  readonly provider_options?: Readonly<Record<string, unknown>>
  /** What the endpoint returns: MP3 (the default), or raw 16-bit PCM for models that only speak PCM, such as Gemini TTS. */
  readonly response_format?: 'mp3' | 'pcm'
}

/** `pipeline.json`: everything a run may tune without a code change. */
export interface PipelineConfig {
  readonly l1s: readonly string[]
  /** The levels this corpus ships (spec §14: A1–B1 for Phase 1a). */
  readonly levels: readonly CefrLevel[]
  /** Entries per level (spec §5.3); every level has one, for the frequency bands (Decision 7). */
  readonly targets: Readonly<Record<CefrLevel, number>>
  readonly max_forms: number
  readonly max_lemmas: number
  /** About 20 words per unit (spec §7.2). */
  readonly unit_size: number
  /** Independent reports that send a field to review (spec §8.10, §15). */
  readonly report_threshold: number
  /**
   * Review queues whose open items do not block a release: an MVP ships their proposals as they are. The items
   * stay open for review (nothing is recorded as reviewed), and release.json counts them. Remove a queue to gate
   * it again.
   */
  readonly accept_unreviewed?: readonly string[]
  readonly llm: { readonly model: string; readonly concurrency: number; readonly max_usd_per_run: number }
  readonly tts: {
    readonly model: string
    readonly accents: Readonly<Partial<Record<Accent, TtsVoice>>>
    readonly max_clips_per_run: number
  }
}

/** A curated theme (spec §8.9) as the content repository keeps it: named in English and in every L1. */
export interface CuratedTheme {
  readonly theme_id: string
  readonly name: Readonly<Record<string, string>>
  readonly description: Readonly<Record<string, string>>
}

export class ConfigError extends Error {
  readonly problems: readonly string[]
  constructor(file: string, problems: readonly string[]) {
    super(`${file}:\n${problems.join('\n')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

/** Every review queue a content directory with these L1s has. */
export const reviewQueues = (l1s: readonly string[]): string[] => [
  QUEUES.english,
  QUEUES.level,
  QUEUES.audio,
  ...l1s.flatMap((l1) => [QUEUES.translation(l1), QUEUES.title(l1)]),
]

const isRecord =(v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const LANG = /^[a-z]{2}$/
const THEME_ID = /^[a-z0-9][a-z0-9-]*$/

export function configProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!isRecord(raw)) return ['must be an object']
  const posInt = (v: unknown, path: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) p.push(`${path}: must be a positive integer`)
  }
  const str = (v: unknown, path: string) => {
    if (typeof v !== 'string' || v.trim() === '') p.push(`${path}: must be a non-empty string`)
  }
  const l1s = raw['l1s']
  if (!Array.isArray(l1s) || l1s.length === 0) p.push('l1s: must list at least one L1')
  else
    l1s.forEach((l, i) => {
      if (typeof l !== 'string' || !LANG.test(l)) p.push(`l1s[${i}]: must be a two-letter lowercase language code`)
    })
  const levels = raw['levels']
  if (!Array.isArray(levels) || levels.length === 0) p.push('levels: must list at least one level')
  else {
    const bad = levels.map((l, i) => ((CEFR_LEVELS as readonly unknown[]).includes(l) ? null : i)).filter((i) => i !== null)
    bad.forEach((i) => p.push(`levels[${i}]: must be one of ${CEFR_LEVELS.join(', ')}`))
    if (bad.length === 0) {
      const idx = levels.map((l) => CEFR_LEVELS.indexOf(l as CefrLevel))
      if (idx.some((v, i) => i > 0 && v <= idx[i - 1]!)) p.push('levels: must be in CEFR order without repeats')
    }
  }
  const targets = raw['targets']
  if (!isRecord(targets)) p.push('targets: must be an object')
  else for (const level of CEFR_LEVELS) posInt(targets[level], `targets.${level}`)
  posInt(raw['max_forms'], 'max_forms')
  posInt(raw['max_lemmas'], 'max_lemmas')
  posInt(raw['unit_size'], 'unit_size')
  posInt(raw['report_threshold'], 'report_threshold')
  const accept = raw['accept_unreviewed']
  if (accept !== undefined) {
    const queues = reviewQueues(Array.isArray(l1s) ? l1s.filter((l): l is string => typeof l === 'string') : [])
    if (!Array.isArray(accept)) p.push('accept_unreviewed: must be a list of review queues')
    else
      accept.forEach((q, i) => {
        if (typeof q !== 'string' || !queues.includes(q)) p.push(`accept_unreviewed[${i}]: must be one of ${queues.join(', ')}`)
        else if (accept.indexOf(q) !== i) p.push(`accept_unreviewed[${i}]: ${q} appears twice`)
      })
  }
  const llm = raw['llm']
  if (!isRecord(llm)) p.push('llm: must be an object')
  else {
    str(llm['model'], 'llm.model')
    posInt(llm['concurrency'], 'llm.concurrency')
    if (typeof llm['max_usd_per_run'] !== 'number' || !(llm['max_usd_per_run'] > 0)) p.push('llm.max_usd_per_run: must be a positive number')
  }
  const tts = raw['tts']
  if (!isRecord(tts)) p.push('tts: must be an object')
  else {
    str(tts['model'], 'tts.model')
    posInt(tts['max_clips_per_run'], 'tts.max_clips_per_run')
    const accents = tts['accents']
    if (!isRecord(accents)) p.push('tts.accents: must be an object')
    else {
      if (accents['uk'] === undefined) p.push('tts.accents.uk: required')
      for (const [accent, voice] of Object.entries(accents)) {
        const path = `tts.accents.${accent}`
        if (accent !== 'uk' && accent !== 'us') p.push(`${path}: accent must be uk or us`)
        else if (!isRecord(voice)) p.push(`${path}: must be an object`)
        else {
          str(voice['voice'], `${path}.voice`)
          str(voice['instructions'], `${path}.instructions`)
          if (voice['provider_options'] !== undefined && !isRecord(voice['provider_options'])) p.push(`${path}.provider_options: must be an object`)
          if (voice['response_format'] !== undefined && voice['response_format'] !== 'mp3' && voice['response_format'] !== 'pcm') {
            p.push(`${path}.response_format: must be mp3 or pcm`)
          }
        }
      }
    }
  }
  return p
}

export function readConfig(dir: string): PipelineConfig {
  const file = contentPaths(dir).config
  const raw = readJson<unknown>(file)
  const problems = configProblems(raw)
  if (problems.length > 0) throw new ConfigError(file, problems)
  return raw as PipelineConfig
}

export function themeProblems(raw: unknown, l1s: readonly string[]): string[] {
  if (!Array.isArray(raw)) return ['themes: must be a list']
  const p: string[] = []
  const seen = new Set<string>()
  raw.forEach((t, i) => {
    const path = `themes[${i}]`
    if (!isRecord(t)) return void p.push(`${path}: must be an object`)
    const id = t['theme_id']
    if (typeof id !== 'string' || !THEME_ID.test(id)) p.push(`${path}.theme_id: must be lowercase letters, digits and hyphens`)
    else if (seen.has(id)) p.push(`${path}.theme_id: ${id} appears twice`)
    else seen.add(id)
    for (const field of ['name', 'description'] as const) {
      const text = t[field]
      for (const lang of ['en', ...l1s]) {
        if (!isRecord(text) || typeof text[lang] !== 'string' || (text[lang] as string).trim() === '') p.push(`${path}.${field}.${lang}: required`)
      }
    }
  })
  return p
}

export function readThemes(dir: string, l1s: readonly string[]): CuratedTheme[] {
  const file = contentPaths(dir).themes
  const raw = readJson<unknown>(file)
  const problems = themeProblems(raw, l1s)
  if (problems.length > 0) throw new ConfigError(file, problems)
  return raw as CuratedTheme[]
}
