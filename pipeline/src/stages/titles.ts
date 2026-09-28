import type { CefrLevel, LocalizedText } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { StageRun } from './lemmas'

export const TITLES_VERSION = 1

export interface TitleUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly words: readonly string[]
}

const SYSTEM = (l1s: readonly string[]) => `You name the units of an English vocabulary course for adult learners.
For each unit, in the order given, write a title of two to four words that says what its words have in common ("Food and drink", "At home"), in English ("en", title words in sentence case) and in each of these languages, as a native speaker would title a textbook unit: ${l1s.join(', ')}.
Return one item per unit with "unit" exactly as given.`

function schema(l1s: readonly string[]) {
  const props: Record<string, unknown> = { unit: { type: 'string' }, en: { type: 'string' } }
  for (const l1 of l1s) props[l1] = { type: 'string' }
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

type Titles = Readonly<Record<string, LocalizedText>>

function parse(asked: readonly string[], l1s: readonly string[]) {
  return (value: unknown): Titles[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError('answers other items than it was asked')
    return items.map((raw, i) => {
      const item = raw as Record<string, unknown>
      if (item['unit'] !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item['unit'])}`)
      const en = String(item['en'] ?? '').trim()
      if (en === '') throw new ParseError(`${asked[i]}: empty en title`)
      const out: Record<string, LocalizedText> = {}
      for (const l1 of l1s) {
        const text = String(item[l1] ?? '').trim()
        if (text === '') throw new ParseError(`${asked[i]}: empty ${l1} title`)
        out[l1] = { en, l1: text }
      }
      return out
    })
  }
}

/** A title per unit, per L1. A unit whose words change is named again, and its title goes back to review. */
export async function titleUnits(units: readonly TitleUnit[], l1s: readonly string[], run: StageRun): Promise<Map<string, Titles>> {
  const titles = await cachedBatch({
    cache: run.cache,
    stage: 'titles',
    version: TITLES_VERSION,
    items: units,
    keyInput: (u) => ({ level: u.level, words: [...u.words].sort(), l1s }),
    batchSize: 10,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) =>
      run.llm.json({
        name: 'titles',
        system: SYSTEM(l1s),
        input: { units: batch.map((u) => ({ unit: u.unit_id, level: u.level, words: u.words })) },
        schema: schema(l1s),
        parse: parse(
          batch.map((u) => u.unit_id),
          l1s,
        ),
      }),
  })
  return new Map(units.map((u, i) => [u.unit_id, titles[i]!]))
}
