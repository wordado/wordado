import { offeredThemes, themeEntries, type Corpus, type Theme } from './corpus'
import { levelIndex, type CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'

/** A query shorter than this, folded and without spaces, is no query. */
export const MIN_QUERY_LENGTH = 2

/**
 * Text as the search compares it: lower case, without accents or other combining marks. For search only: it is
 * more forgiving than `norm`, which answer checking uses (й and и are one letter here).
 */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** The words of a text, folded. */
const tokens = (text: string): string[] => foldText(text).split(/[^\p{L}\p{N}]+/u).filter((token) => token !== '')

/** What a word is found by: its headword and variants, its translations and its sense note. */
const entryTokens = (entry: CorpusEntry): string[] => [entry.headword, ...entry.variants, ...entry.translations, entry.sense].flatMap(tokens)

interface IndexedEntry {
  readonly entry: CorpusEntry
  readonly tokens: readonly string[]
}

interface IndexedTheme {
  readonly theme: Theme
  readonly tokens: readonly string[]
  /** In the theme's own order: level, then path. */
  readonly entries: readonly IndexedEntry[]
}

/** What a corpus offers to search, folded once: the offered themes with their words, and the words in none of them. */
export interface SearchIndex {
  readonly themes: readonly IndexedTheme[]
  readonly unthemed: readonly IndexedEntry[]
}

export function searchIndex(corpus: Corpus): SearchIndex {
  const indexed = new Map<string, IndexedEntry>()
  const index = (entry: CorpusEntry): IndexedEntry => {
    let known = indexed.get(entry.entryId)
    if (!known) {
      known = { entry, tokens: entryTokens(entry) }
      indexed.set(entry.entryId, known)
    }
    return known
  }
  const themes = offeredThemes(corpus).map((theme) => ({
    theme,
    tokens: [theme.name.en, theme.name.l1, theme.description.en, theme.description.l1].flatMap(tokens),
    entries: themeEntries(corpus, theme.themeId).map(index),
  }))
  // A word of a theme too small to be offered is, for the learner, in no theme.
  const position = new Map<WordId, number>(corpus.units.flatMap((unit) => unit.wordIds).map((wordId, i) => [wordId, i]))
  const at = (e: CorpusEntry) => position.get(corpusWordId(e.entryId)) ?? Number.MAX_SAFE_INTEGER
  const unthemed = [...corpus.entries.values()]
    .filter((e) => !e.retired && !indexed.has(e.entryId))
    .sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || at(a) - at(b))
    .map(index)
  return { themes, unthemed }
}

/** A theme the query found: by its own name or description, by its words, or both. */
export interface ThemeMatch {
  readonly theme: Theme
  readonly nameMatch: boolean
  readonly entries: readonly CorpusEntry[]
}

export interface ThemeSearch {
  /** Best match first: a matching name or description, then the most matching words; ties keep the pack's order. */
  readonly themes: readonly ThemeMatch[]
  /** Matching words that are in the course but in no offered theme. */
  readonly unthemed: readonly CorpusEntry[]
}

/** The query's words, or null when it is too short to search with. */
export function searchWords(query: string): readonly string[] | null {
  const words = tokens(query)
  return words.join('').length < MIN_QUERY_LENGTH ? null : words
}

/** Every word of the query begins a word of the text: "bank" finds "banking", not "embankment". */
const matches = (words: readonly string[], text: readonly string[]): boolean => words.every((word) => text.some((token) => token.startsWith(word)))

/** The themes a query keeps (null: no query, so every theme stays). */
export function searchThemes(index: SearchIndex, query: string): ThemeSearch | null {
  const words = searchWords(query)
  if (!words) return null
  const themes = index.themes
    .map(({ theme, tokens: name, entries }) => ({
      theme,
      nameMatch: matches(words, name),
      entries: entries.filter((e) => matches(words, e.tokens)).map((e) => e.entry),
    }))
    .filter((m) => m.nameMatch || m.entries.length > 0)
  // Array.prototype.sort is stable, so equal themes keep the pack's order.
  themes.sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || b.entries.length - a.entries.length)
  return { themes, unthemed: index.unthemed.filter((e) => matches(words, e.tokens)).map((e) => e.entry) }
}

/** The words of a list a query keeps, in the list's order (null: no query, so every word stays). */
export function searchEntries(entries: readonly CorpusEntry[], query: string): CorpusEntry[] | null {
  const words = searchWords(query)
  return words && entries.filter((entry) => matches(words, entryTokens(entry)))
}
