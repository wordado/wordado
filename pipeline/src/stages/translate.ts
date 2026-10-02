import { norm, type PartOfSpeech } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { StageRun } from './lemmas'

export const TRANSLATE_VERSION = 1

/** An entry's L1 side (spec §5.2): one primary translation, accepted alternates, and a sense gloss. */
export interface TranslationFields {
  readonly translation: string
  readonly alternates: readonly string[]
  /** A few L1 words telling this sense apart; shipped only when the headword and POS have several live entries (Decision 8). */
  readonly sense: string
}

export interface TranslateItem {
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly gloss: string
  readonly example: string
}

/**
 * How to translate into each L1. A new L1 (spec §14, Phase 1b) adds its guide
 * here and its code to `pipeline.json`; nothing else changes.
 */
export const L1_GUIDES: Readonly<Record<string, string>> = {
  bg: `Translate into Bulgarian, in Cyrillic, as a bilingual dictionary would.
- Nouns: the indefinite singular (вода, not водата).
- Verbs: the first person singular present, the Bulgarian dictionary form (пиша). When both aspects are common, give the imperfective as the translation and the perfective among the alternates (пиша; напиша).
- Adjectives: the masculine singular (голям).
- Interjections and phrases: what a Bulgarian speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four Bulgarian words that tell this sense apart from the headword's other senses (for bank: "за пари", "на река"). Empty when the gloss is empty.
Use standard literary Bulgarian. No transliteration, no English words, no explanations in brackets.`,
  de: `Translate into German, as a bilingual dictionary would.
- Nouns: the singular, capitalised, without the article (Wasser, not das Wasser): the learners are German speakers and know the gender.
- Verbs: the infinitive (schreiben). Separable and reflexive verbs as a dictionary gives them (anrufen; sich freuen).
- Adjectives: the uninflected form (groß).
- Interjections and phrases: what a German speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four German words that tell this sense apart from the headword's other senses (for bank: "Geldinstitut", "Flussufer"). Empty when the gloss is empty.
Use standard German as written in Germany, in the current spelling, with ß and umlauts. No English words, no explanations in brackets.`,
  es: `Translate into Spanish, as a bilingual dictionary would.
- Nouns: the singular, without the article (agua, not el agua): the learners are Spanish speakers and know the gender.
- Verbs: the infinitive (escribir). Pronominal verbs as a dictionary gives them (llamarse; acordarse).
- Adjectives: the masculine singular (grande, rojo).
- Interjections and phrases: what a Spanish speaker in Spain would actually say, with ¿ and ¡ where the phrase is a question or an exclamation.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four Spanish words that tell this sense apart from the headword's other senses (for bank: "entidad financiera", "orilla del río"). Empty when the gloss is empty.
Use the standard Spanish of Spain (ordenador, coche, móvil, zumo, patata), with accents and ñ. No English words, no explanations in brackets.`,
}

const SYSTEM = (guide: string) => `You translate an English vocabulary course for adult learners.
For each item, in the order given, translate the English headword in the sense its gloss and example show.
${guide}
Return one item per input item, with "key" exactly as given, and nothing else.`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          translation: { type: 'string' },
          alternates: { type: 'array', items: { type: 'string' } },
          sense: { type: 'string' },
        },
        required: ['key', 'translation', 'alternates', 'sense'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const BATCH = 20
const MAX_ALTERNATES = 4
const clean = (s: unknown) => String(s ?? '').replaceAll('|', '/').replace(/\s+/g, ' ').trim()

function parse(count: number) {
  return (value: unknown): TranslationFields[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== count) throw new ParseError('answers other items than it was asked')
    return items.map((raw, i) => {
      const item = raw as Record<string, unknown>
      if (item['key'] !== String(i)) throw new ParseError(`answers other items than it was asked: item ${i} has key ${JSON.stringify(item['key'])}`)
      const translation = clean(item['translation'])
      if (translation === '') throw new ParseError(`item ${i}: empty translation`)
      const seen = new Set([norm(translation)])
      const alternates: string[] = []
      for (const a of Array.isArray(item['alternates']) ? item['alternates'] : []) {
        const alt = clean(a)
        if (alt === '' || seen.has(norm(alt))) continue
        seen.add(norm(alt))
        alternates.push(alt)
      }
      return { translation, alternates: alternates.slice(0, MAX_ALTERNATES), sense: clean(item['sense']) }
    })
  }
}

export async function translateSenses(l1: string, items: readonly TranslateItem[], run: StageRun): Promise<TranslationFields[]> {
  const guide = L1_GUIDES[l1]
  if (guide === undefined) throw new Error(`no translation guide for ${l1}; add one to L1_GUIDES`)
  return cachedBatch({
    cache: run.cache,
    stage: `translate-${l1}`,
    version: TRANSLATE_VERSION,
    items,
    keyInput: (item) => item,
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    model: run.llm.model,
    run: (batch) =>
      run.llm.json({
        name: 'translate',
        system: SYSTEM(guide),
        input: { l1, items: batch.map((item, i) => ({ key: String(i), ...item })) },
        schema: SCHEMA,
        parse: parse(batch.length),
      }),
  })
}

/**
 * Senses of one headword and POS merge when the lead L1's primary translations agree (spec §5.2; plan 9,
 * Decision 1). The lead is the first L1 in `pipeline.json`, the one the published corpus was built on, so adding
 * an L1 never splits a published entry. Where another L1 translates merged senses differently, it keeps the
 * first sense's translation and gains the other's words as alternates, so either answer is right.
 */
export function mergeSenses<T extends { readonly headword: string; readonly pos: string; readonly l1: Readonly<Record<string, TranslationFields>> }>(
  senses: readonly T[],
  l1s: readonly string[],
): T[] {
  const lead = l1s[0]
  if (lead === undefined) return [...senses]
  const kept: T[] = []
  const at = new Map<string, number>()
  for (const s of senses) {
    const signature = [norm(s.headword), s.pos, norm(s.l1[lead]?.translation ?? '')].join('|')
    const index = at.get(signature)
    if (index === undefined) {
      at.set(signature, kept.length)
      kept.push(s)
      continue
    }
    const first = kept[index]!
    const l1: Record<string, TranslationFields> = { ...first.l1 }
    for (const other of l1s.slice(1)) {
      const mine = first.l1[other]
      const theirs = s.l1[other]
      if (!mine || !theirs) continue
      const known = new Set([mine.translation, ...mine.alternates].map(norm))
      const alternates = [...mine.alternates]
      for (const word of [theirs.translation, ...theirs.alternates]) {
        if (known.has(norm(word))) continue
        known.add(norm(word))
        alternates.push(word)
      }
      l1[other] = { ...mine, alternates: alternates.slice(0, MAX_ALTERNATES) }
    }
    kept[index] = { ...first, l1 }
  }
  return kept
}
