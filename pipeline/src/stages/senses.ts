import { CEFR_LEVELS, levelIndex, norm, PARTS_OF_SPEECH, type CefrLevel, type PartOfSpeech } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { RankedLemma, StageRun } from './lemmas'

export const SENSES_VERSION = 1

/**
 * The theme ids the senses question has always been asked with: the 24 curated themes of 2026-09. Themes are now
 * decided by their own stage (`themeSenses`), so the senses' own themes are not used; the question keeps this list
 * so that extending the curated themes does not ask every headword again.
 */
export const SENSES_THEME_IDS: readonly string[] = [
  'actions', 'animals', 'body', 'city', 'clothes', 'colours', 'daily-life', 'directions', 'doctor', 'feelings', 'food', 'greetings',
  'hobbies', 'home', 'numbers', 'people', 'restaurant', 'school', 'shopping', 'technology', 'time', 'travel', 'weather', 'work',
]

export type LlmLevel = CefrLevel | 'C2'
const LLM_LEVELS: readonly LlmLevel[] = [...CEFR_LEVELS, 'C2']

/** One proposed sense of a headword, English side (spec §5.2). */
export interface SenseProposal {
  readonly headword: string
  readonly pos: PartOfSpeech
  /** A few English words that tell this sense apart; empty when it is the headword's only sense for this part of speech. */
  readonly gloss: string
  readonly level: LlmLevel
  /** UK IPA, without slashes. */
  readonly ipa: string
  readonly variants: readonly string[]
  readonly themes: readonly string[]
  readonly examples: readonly string[]
}

/**
 * The prompt judges level from the CEFR descriptors alone. It never names or
 * asks for a published list's levels, which must not be copied (spec §5.4, R1).
 */
const SYSTEM = `You prepare an English vocabulary course for adult learners.
For each headword you are given, in the order given, list the senses a learner up to CEFR C1 would need, most common first, at most four. For each sense:
- "pos": one of ${PARTS_OF_SPEECH.join(', ')} ("det" is a determiner, "intj" an interjection, "phrase" a fixed multi-word expression).
- "gloss": two to four plain English words that tell this sense apart from the headword's other senses with the same part of speech ("money" and "river" for bank). Empty only when the headword has a single sense for that part of speech.
- "level": the CEFR level at which a typical learner first needs this sense, judged from the CEFR descriptors (A1: basic personal and everyday needs; A2: routine tasks and familiar topics; B1: work, school, leisure and travel; B2: abstract and technical topics in one's field; C1: flexible use for social, academic and professional purposes). Use C2 for a sense beyond that.
- "ipa": the standard British pronunciation in IPA, without slashes.
- "variants": other accepted spellings (colour → color); usually empty.
- "themes": up to three theme ids from the list given, most relevant first; empty if none fits.
- "examples": three short, natural English sentences using the headword in this sense, suitable for adults, at or below the sense's level. No names of real people or brands.
Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: with its capital letters where it has them (I, Monday, English, TV), otherwise the same as "lemma".`

function schema(themeIds: readonly string[]) {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lemma: { type: 'string' },
            headword: { type: 'string' },
            senses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pos: { type: 'string', enum: PARTS_OF_SPEECH },
                  gloss: { type: 'string' },
                  level: { type: 'string', enum: LLM_LEVELS },
                  ipa: { type: 'string' },
                  variants: { type: 'array', items: { type: 'string' } },
                  themes: { type: 'array', items: themeIds.length > 0 ? { type: 'string', enum: themeIds } : { type: 'string' } },
                  examples: { type: 'array', items: { type: 'string' } },
                },
                required: ['pos', 'gloss', 'level', 'ipa', 'variants', 'themes', 'examples'],
                additionalProperties: false,
              },
            },
          },
          required: ['lemma', 'headword', 'senses'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

const BATCH = 10
/** The review sheet separates list cells with " | " (Task 12); a sentence must not contain one. */
const cell = (s: string) => s.replaceAll('|', '/').replace(/\s+/g, ' ').trim()

function parseSense(headword: string, themeIds: ReadonlySet<string>, raw: Record<string, unknown>, where: string): SenseProposal {
  const pos = raw['pos'] as PartOfSpeech
  if (!PARTS_OF_SPEECH.includes(pos)) throw new ParseError(`${where}: unknown part of speech`)
  const level = raw['level'] as LlmLevel
  if (!LLM_LEVELS.includes(level)) throw new ParseError(`${where}: unknown level`)
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => cell(String(s))).filter((s) => s !== '') : [])
  const examples = strings(raw['examples']).slice(0, 5)
  if (examples.length === 0) throw new ParseError(`${where}: needs at least one example sentence`)
  const ipa = cell(String(raw['ipa'] ?? '')).replace(/^\/|\/$/g, '')
  if (ipa === '') throw new ParseError(`${where}: needs IPA`)
  return {
    headword,
    pos,
    gloss: cell(String(raw['gloss'] ?? '')),
    level,
    ipa,
    variants: [...new Set(strings(raw['variants']).map(norm))].filter((v) => v !== norm(headword)),
    themes: [...new Set(strings(raw['themes']))].filter((t) => themeIds.has(t)).slice(0, 3),
    examples,
  }
}

function parse(asked: readonly string[], themeIds: ReadonlySet<string>) {
  return (value: unknown): SenseProposal[][] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError(`answers other items than it was asked`)
    return items.map((raw, i) => {
      const item = raw as { lemma?: unknown; headword?: unknown; senses?: unknown }
      if (item.lemma !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item.lemma)}`)
      // Frequency lists are lowercased; the headword keeps its capitals (I, Monday) when it is the same word.
      const display = String(item.headword ?? '').trim()
      const headword = display !== '' && norm(display) === asked[i] ? display : asked[i]!
      const senses = (Array.isArray(item.senses) ? item.senses : []).slice(0, 4).map((s, j) => parseSense(headword, themeIds, s as Record<string, unknown>, `${asked[i]} sense ${j}`))
      const byPos = new Map<string, SenseProposal[]>()
      for (const s of senses) byPos.set(s.pos, [...(byPos.get(s.pos) ?? []), s])
      for (const [pos, group] of byPos) {
        if (group.length > 1 && group.some((s) => s.gloss === '')) throw new ParseError(`${asked[i]} (${pos}): every sense needs a gloss when there are several`)
        if (new Set(group.map((s) => norm(s.gloss))).size !== group.length) throw new ParseError(`${asked[i]} (${pos}): two senses share a gloss`)
      }
      return senses
    })
  }
}

export function describeLemmas(lemmas: readonly RankedLemma[], themeIds: readonly string[], run: StageRun): Promise<SenseProposal[][]> {
  const known = new Set(themeIds)
  const sortedThemes = [...themeIds].sort()
  return cachedBatch({
    cache: run.cache,
    stage: 'senses',
    version: SENSES_VERSION,
    items: lemmas.map((l) => l.lemma),
    // The theme list is part of the question: adding a theme asks every headword again.
    keyInput: (lemma) => ({ lemma, themes: sortedThemes }),
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) =>
      run.llm.json({ name: 'senses', system: SYSTEM, input: { themes: sortedThemes, headwords: batch }, schema: schema(sortedThemes), parse: parse(batch, known) }),
  })
}

/** A lemma's level by frequency alone: its rank against the cumulative targets (Decision 7). Past C1's total it is C1. */
export function frequencyBand(rank: number, targets: Readonly<Record<CefrLevel, number>>): CefrLevel {
  let upTo = 0
  for (const level of CEFR_LEVELS) {
    upTo += targets[level]
    if (rank <= upTo) return level
  }
  return 'C1'
}

/** The LLM's judgement, kept within one band of frequency; clamping flags the sense for banding review. */
export function bandLevel(llm: LlmLevel, band: CefrLevel): { readonly level: CefrLevel | null; readonly flagged: boolean } {
  if (llm === 'C2') return { level: null, flagged: false }
  const b = levelIndex(band)
  const l = levelIndex(llm)
  const clamped = Math.min(Math.max(l, b - 1), b + 1)
  return { level: CEFR_LEVELS[clamped]!, flagged: clamped !== l }
}
