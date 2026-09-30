import { levelIndex, type CefrLevel, type LocalizedText, type PartOfSpeech } from '@wordado/core'
import type { RegistryUnit } from './registry'

export interface UnitCandidate {
  readonly entry_id: string
  readonly level: CefrLevel
  /** The entry's first (most relevant) theme, or '' for none. */
  readonly theme: string
  readonly pos: PartOfSpeech
  readonly rank: number
  readonly order: number
}

const unitNumber = (unitId: string) => Number(/-(\d+)$/.exec(unitId)?.[1] ?? 0)

/** A new unit's group: a theme, a part of speech (`pos:verb`), or `mixed`. */
function groupOf(c: UnitCandidate, themeSize: ReadonlyMap<string, number>, posSize: ReadonlyMap<string, number>, min: number): string {
  if (c.theme !== '' && (themeSize.get(c.theme) ?? 0) >= min) return c.theme
  if ((posSize.get(c.pos) ?? 0) >= min) return `pos:${c.pos}`
  return 'mixed'
}

/**
 * The units after this draft (spec §7.2, Decision 9). A live entry stays in
 * its unit while its level matches. A published entry that is no longer live
 * stays too, retired. An entry that was never published and is no longer
 * live leaves.
 *
 * New live entries are grouped: by theme where a theme has at least half a
 * unit of new words, else by part of speech where that has half a unit, else
 * together as `mixed`. Words no theme fits are the rule at B1, and grouping
 * them by theme alone made units of unrelated words under invented titles.
 * Groups come in order of their most frequent word, and each is cut into
 * units of `unitSize` on its own; a last unit of at most half that size joins
 * the one before it in its group. A part-of-speech or mixed unit records its
 * group, and gets a plain title (`groupTitles`). New unit IDs continue each
 * level's numbering, so none is ever reused.
 */
export function assignUnits(units: readonly RegistryUnit[], live: readonly UnitCandidate[], published: ReadonlySet<string>, unitSize: number): RegistryUnit[] {
  const liveById = new Map(live.map((c) => [c.entry_id, c]))
  const kept = units.map((u) => ({
    ...u,
    entry_ids: u.entry_ids.filter((id) => {
      const c = liveById.get(id)
      return c ? c.level === u.level : published.has(id)
    }),
  }))
  const placed = new Set(kept.flatMap((u) => u.entry_ids))
  const out: RegistryUnit[] = [...kept]
  const min = Math.ceil(unitSize / 2)
  const levels = [...new Set(live.map((c) => c.level))].sort((a, b) => levelIndex(a) - levelIndex(b))
  for (const level of levels) {
    const fresh = live.filter((c) => c.level === level && !placed.has(c.entry_id))
    if (fresh.length === 0) continue
    const themeSize = new Map<string, number>()
    for (const c of fresh) if (c.theme !== '') themeSize.set(c.theme, (themeSize.get(c.theme) ?? 0) + 1)
    // Part-of-speech groups count only the words no big-enough theme takes.
    const posSize = new Map<string, number>()
    for (const c of fresh) if (c.theme === '' || (themeSize.get(c.theme) ?? 0) < min) posSize.set(c.pos, (posSize.get(c.pos) ?? 0) + 1)
    const groups = new Map<string, UnitCandidate[]>()
    for (const c of fresh) {
      const g = groupOf(c, themeSize, posSize, min)
      groups.set(g, [...(groups.get(g) ?? []), c])
    }
    const byRank = (a: UnitCandidate, b: UnitCandidate) => a.rank - b.rank || a.order - b.order || (a.entry_id < b.entry_id ? -1 : 1)
    const ordered = [...groups].map(([g, cs]) => [g, cs.sort(byRank)] as const)
    ordered.sort(([ga, a], [gb, b]) => a[0]!.rank - b[0]!.rank || (ga < gb ? -1 : 1))
    const prefix = level.toLowerCase()
    let n = Math.max(0, ...out.filter((u) => u.unit_id.startsWith(`${prefix}-`)).map((u) => unitNumber(u.unit_id)))
    for (const [group, cs] of ordered) {
      const chunks: string[][] = []
      for (let i = 0; i < cs.length; i += unitSize) chunks.push(cs.slice(i, i + unitSize).map((c) => c.entry_id))
      const last = chunks.at(-1)!
      if (chunks.length > 1 && last.length <= min) {
        chunks.pop()
        chunks[chunks.length - 1]!.push(...last)
      }
      const labelled = group.startsWith('pos:') || group === 'mixed'
      for (const entry_ids of chunks) {
        n += 1
        out.push({ unit_id: `${prefix}-${String(n).padStart(2, '0')}`, level, entry_ids, ...(labelled ? { group } : {}) })
      }
    }
  }
  return out
}

/** The path: levels in CEFR order, units by number within a level (spec §7.2). */
export function inPathOrder(units: readonly RegistryUnit[]): RegistryUnit[] {
  return [...units].sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || unitNumber(a.unit_id) - unitNumber(b.unit_id) || (a.unit_id < b.unit_id ? -1 : 1))
}

/**
 * Names for part-of-speech and mixed units, in English and each L1. A new L1 adds its names here, beside its
 * translation guide (`L1_GUIDES`).
 */
export const GROUP_NAMES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  en: {
    noun: 'Nouns', verb: 'Verbs', adj: 'Adjectives', adv: 'Adverbs', pron: 'Pronouns', prep: 'Prepositions',
    det: 'Determiners', num: 'Numbers', conj: 'Conjunctions', intj: 'Exclamations', phrase: 'Phrases', mixed: 'More words',
  },
  bg: {
    noun: 'Съществителни', verb: 'Глаголи', adj: 'Прилагателни', adv: 'Наречия', pron: 'Местоимения', prep: 'Предлози',
    det: 'Определители', num: 'Числителни', conj: 'Съюзи', intj: 'Междуметия', phrase: 'Изрази', mixed: 'Още думи',
  },
  de: {
    noun: 'Nomen', verb: 'Verben', adj: 'Adjektive', adv: 'Adverbien', pron: 'Pronomen', prep: 'Präpositionen',
    det: 'Begleiter', num: 'Zahlwörter', conj: 'Konjunktionen', intj: 'Ausrufe', phrase: 'Wendungen', mixed: 'Weitere Wörter',
  },
}

/**
 * Plain titles for part-of-speech and mixed units ("Verbs 3 / Глаголи 3"), numbered within their level and
 * group in path order. Nothing is invented for words that share no theme; reviewers may still retitle a unit.
 */
export function groupTitles(units: readonly RegistryUnit[], l1s: readonly string[]): Map<string, Readonly<Record<string, LocalizedText>>> {
  for (const lang of ['en', ...l1s]) if (!GROUP_NAMES[lang]) throw new Error(`no unit group names for ${lang}; add them to GROUP_NAMES`)
  const out = new Map<string, Readonly<Record<string, LocalizedText>>>()
  const seen = new Map<string, number>()
  for (const u of inPathOrder(units)) {
    if (!u.group) continue
    const key = u.group === 'mixed' ? 'mixed' : u.group.slice('pos:'.length)
    const n = (seen.get(`${u.level}|${key}`) ?? 0) + 1
    seen.set(`${u.level}|${key}`, n)
    const title = (lang: string) => `${GROUP_NAMES[lang]![key] ?? GROUP_NAMES[lang]!['mixed']} ${n}`
    out.set(u.unit_id, Object.fromEntries(l1s.map((l1) => [l1, { en: title('en'), l1: title(l1) }])))
  }
  return out
}
