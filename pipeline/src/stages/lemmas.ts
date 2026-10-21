import { norm } from '@wordado/core'
import { cachedBatch, type StageCache } from '../cache'
import type { RankedForm } from '../frequency'
import { ParseError, type Llm } from '../llm'
import type { LanguageProfile } from '../profiles'

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
  readonly profile: LanguageProfile
}

export const lemmaSystem = (p: LanguageProfile) => `You prepare ${p.course} for adult learners.
For each ${p.name} word form you are given, in the order given, return:
- "form": the form exactly as given.
${p.lemmaKindLine}
${p.lemmaLemmasLine}
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
    run: (batch) => run.llm.json({ name: 'lemmas', system: lemmaSystem(run.profile), input: { forms: batch }, schema: SCHEMA, parse: parse(batch) }),
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

/**
 * The stage sometimes answers "a word, an inflection of nothing" with an empty list. In the first real run that
 * took 91 of the 100 most frequent forms out of the corpus (level check, 2026-10-06). Such a form is its own
 * headword. A contraction piece ("they're") is not: the stage should have called it a fragment.
 */
const ownLemma = (form: string): readonly string[] => (/['’]/.test(form) ? [] : [norm(form)].filter((l) => l !== ''))

/** Lemmas by summed rate: the top `max`, plus every pinned headword wherever it ranks. */
export function rankLemmas(forms: readonly RankedForm[], results: readonly LemmaResult[], pinned: readonly string[], max: number): RankedLemma[] {
  const rates = new Map<string, number>()
  results.forEach((r, i) => {
    if (r.kind !== 'word') return
    const lemmas = r.lemmas.length > 0 ? r.lemmas : ownLemma(forms[i]!.form)
    if (lemmas.length === 0) return
    const share = forms[i]!.perMillion / lemmas.length
    for (const l of lemmas) rates.set(l, (rates.get(l) ?? 0) + share)
  })
  const pins = new Set(pinned.map(norm))
  for (const p of pins) if (!rates.has(p)) rates.set(p, 0)
  return [...rates]
    .map(([lemma, perMillion]) => ({ lemma, perMillion: Math.round(perMillion) }))
    .sort((a, b) => b.perMillion - a.perMillion || (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0))
    .map((l, i) => ({ ...l, rank: i + 1, pinned: pins.has(l.lemma) }))
    .filter((l) => l.rank <= max || l.pinned)
}
