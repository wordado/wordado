import { norm } from '@wordado/core'
import { cachedBatch, type StageCache } from '../cache'
import type { RankedForm } from '../frequency'
import { ParseError, type Llm } from '../llm'

/** Bump when the prompt or schema changes: every form is asked again, and proposals built on it are re-reviewed. */
export const LEMMAS_VERSION = 1

export type FormKind = 'word' | 'name' | 'abbreviation' | 'foreign' | 'offensive' | 'fragment'
const KINDS: readonly FormKind[] = ['word', 'name', 'abbreviation', 'foreign', 'offensive', 'fragment']

export interface LemmaResult {
  readonly form: string
  readonly kind: FormKind
  /** Empty unless `kind` is `word`. */
  readonly lemmas: readonly string[]
}

/** What every LLM stage needs to run. */
export interface StageRun {
  readonly llm: Llm
  readonly cache: StageCache
  readonly concurrency: number
  readonly offline: boolean
}

const SYSTEM = `You prepare an English vocabulary course for adult learners.
For each English word form you are given, in the order given, return:
- "form": the form exactly as given.
- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").
- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.
Return one item per form, in the same order, and nothing else.`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          form: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          lemmas: { type: 'array', items: { type: 'string' } },
        },
        required: ['form', 'kind', 'lemmas'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const BATCH = 100

function parse(asked: readonly string[]) {
  return (value: unknown): LemmaResult[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError(`answers other items than it was asked (${Array.isArray(items) ? items.length : 0} for ${asked.length})`)
    return items.map((raw, i) => {
      const item = raw as { form?: unknown; kind?: unknown; lemmas?: unknown }
      if (item.form !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item.form)}, not ${JSON.stringify(asked[i])}`)
      if (!KINDS.includes(item.kind as FormKind)) throw new ParseError(`item ${i}: unknown kind`)
      const kind = item.kind as FormKind
      const lemmas = kind === 'word' && Array.isArray(item.lemmas) ? [...new Set(item.lemmas.map((l) => norm(String(l))).filter((l) => l !== ''))] : []
      return { form: asked[i]!, kind, lemmas }
    })
  }
}

export function lemmatise(forms: readonly RankedForm[], run: StageRun): Promise<LemmaResult[]> {
  return cachedBatch({
    cache: run.cache,
    stage: 'lemmas',
    version: LEMMAS_VERSION,
    items: forms.map((f) => f.form),
    keyInput: (form) => form,
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    model: run.llm.model,
    run: (batch) => run.llm.json({ name: 'lemmas', system: SYSTEM, input: { forms: batch }, schema: SCHEMA, parse: parse(batch) }),
  })
}

export interface RankedLemma {
  readonly lemma: string
  readonly perMillion: number
  /** 1-based, over every lemma before the cut; a pinned lemma the lists lack comes last. */
  readonly rank: number
  /** A sample headword (Decision 9): described whatever its rank. */
  readonly pinned: boolean
}

/** Lemmas by summed rate: the top `max`, plus every pinned headword wherever it ranks. */
export function rankLemmas(forms: readonly RankedForm[], results: readonly LemmaResult[], pinned: readonly string[], max: number): RankedLemma[] {
  const rates = new Map<string, number>()
  results.forEach((r, i) => {
    if (r.kind !== 'word' || r.lemmas.length === 0) return
    const share = forms[i]!.perMillion / r.lemmas.length
    for (const l of r.lemmas) rates.set(l, (rates.get(l) ?? 0) + share)
  })
  const pins = new Set(pinned.map(norm))
  for (const p of pins) if (!rates.has(p)) rates.set(p, 0)
  return [...rates]
    .map(([lemma, perMillion]) => ({ lemma, perMillion: Math.round(perMillion) }))
    .sort((a, b) => b.perMillion - a.perMillion || (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0))
    .map((l, i) => ({ ...l, rank: i + 1, pinned: pins.has(l.lemma) }))
    .filter((l) => l.rank <= max || l.pinned)
}
