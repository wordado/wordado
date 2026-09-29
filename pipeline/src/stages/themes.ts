import type { PartOfSpeech } from '@wordado/core'
import { cachedBatch } from '../cache'
import type { CuratedTheme } from '../config'
import { ParseError } from '../llm'
import type { StageRun } from './lemmas'

export const THEMES_VERSION = 1

export interface ThemeSense {
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly gloss: string
  /** The proposed first example, which shows the sense; a reviewer's edit does not ask again. */
  readonly example: string
}

const SYSTEM = `You sort the words of an English vocabulary course for adult learners into themes.
For each item, in the order given, choose up to three theme ids from the list given whose description the word, in the sense its gloss and example show, clearly fits; most relevant first; empty if none fits.
Choose a topic theme only when the word is mainly used when talking about that topic. A general word that is used in every topic (make, case, increase, therefore) goes to the theme for what it does, such as thinking, comparing, changing or linking ideas, when the list has one.
Return one item per input item, with "key" exactly as given, and nothing else.`

function schema(themeIds: readonly string[]) {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { key: { type: 'string' }, themes: { type: 'array', items: { type: 'string', enum: themeIds } } },
          required: ['key', 'themes'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

function parse(count: number, themeIds: ReadonlySet<string>) {
  return (value: unknown): string[][] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== count) throw new ParseError('answers other items than it was asked')
    return items.map((raw, i) => {
      const item = raw as { key?: unknown; themes?: unknown }
      if (item.key !== String(i)) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item.key)}`)
      const themes = Array.isArray(item.themes) ? item.themes.map(String) : []
      return [...new Set(themes)].filter((t) => themeIds.has(t)).slice(0, 3)
    })
  }
}

/**
 * Up to three curated themes per sense, most relevant first (spec §8.9). Its own question, apart from the senses
 * stage's: the curated list, with its English descriptions, is part of the question, so changing a theme asks
 * every sense again here, and only here.
 */
export async function themeSenses(senses: readonly ThemeSense[], themes: readonly CuratedTheme[], run: StageRun): Promise<string[][]> {
  const list = [...themes]
    .sort((a, b) => (a.theme_id < b.theme_id ? -1 : 1))
    .map((t) => ({ id: t.theme_id, name: t.name['en']!, description: t.description['en']! }))
  const ids = list.map((t) => t.id)
  const known = new Set(ids)
  return cachedBatch({
    cache: run.cache,
    stage: 'themes',
    version: THEMES_VERSION,
    items: senses,
    keyInput: (s) => ({ headword: s.headword, pos: s.pos, gloss: s.gloss, example: s.example, themes: list }),
    batchSize: 25,
    concurrency: run.concurrency,
    offline: run.offline,
    model: run.llm.model,
    run: (batch) =>
      run.llm.json({
        name: 'themes',
        system: SYSTEM,
        input: { themes: list, items: batch.map((s, i) => ({ key: String(i), ...s })) },
        schema: schema(ids),
        parse: parse(batch.length, known),
      }),
  })
}
