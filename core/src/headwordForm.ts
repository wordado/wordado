import type { CorpusEntry } from './types'

const GERMAN_ARTICLE: ReadonlyMap<string, string> = new Map([
  ['m', 'der'],
  ['f', 'die'],
  ['n', 'das'],
  // A plural-only noun (#316) takes the plural article.
  ['pl', 'die'],
])

/** How a headword is shown with its grammar (spec §5.2): German nouns with article and plural, `sein` verbs marked. */
export function headwordForm(target: string, entry: Pick<CorpusEntry, 'headword' | 'pos' | 'grammar'>): { readonly lead: string; readonly after: string } {
  const g = entry.grammar
  if (target !== 'de' || g === null) return { lead: entry.headword, after: '' }
  if (entry.pos === 'noun') {
    const article = typeof g['gender'] === 'string' ? GERMAN_ARTICLE.get(g['gender']) : undefined
    const plural = typeof g['plural'] === 'string' && g['plural'] !== '' ? `die ${g['plural']}` : ''
    return { lead: article ? `${article} ${entry.headword}` : entry.headword, after: plural }
  }
  if (entry.pos === 'verb' && g['auxiliary'] === 'sein') return { lead: entry.headword, after: '(+ sein)' }
  return { lead: entry.headword, after: '' }
}
