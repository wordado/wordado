import { levelIndex, type CefrLevel } from '@wordado/core'
import type { RegistryUnit } from './registry'

export interface UnitCandidate {
  readonly entry_id: string
  readonly level: CefrLevel
  /** The entry's first (most relevant) theme, or '' for none. */
  readonly theme: string
  readonly rank: number
  readonly order: number
}

const unitNumber = (unitId: string) => Number(/-(\d+)$/.exec(unitId)?.[1] ?? 0)

/**
 * The units after this draft (spec §7.2, Decision 9). A live entry stays in
 * its unit while its level matches. A published entry that is no longer live
 * stays too, retired. An entry that was never published and is no longer
 * live leaves. New live entries are grouped by theme, with themes ordered by
 * their most frequent new word, then cut into units of `unitSize`. A last
 * unit at most half that size joins the one before it. New unit IDs continue
 * each level's numbering, so none is ever reused.
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
  const levels = [...new Set(live.map((c) => c.level))].sort((a, b) => levelIndex(a) - levelIndex(b))
  for (const level of levels) {
    const fresh = live.filter((c) => c.level === level && !placed.has(c.entry_id))
    if (fresh.length === 0) continue
    const themeRank = new Map<string, number>()
    for (const c of fresh) themeRank.set(c.theme, Math.min(themeRank.get(c.theme) ?? Infinity, c.rank))
    fresh.sort(
      (a, b) =>
        themeRank.get(a.theme)! - themeRank.get(b.theme)! ||
        (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : 0) ||
        a.rank - b.rank ||
        a.order - b.order ||
        (a.entry_id < b.entry_id ? -1 : 1),
    )
    const chunks: string[][] = []
    for (let i = 0; i < fresh.length; i += unitSize) chunks.push(fresh.slice(i, i + unitSize).map((c) => c.entry_id))
    const last = chunks.at(-1)!
    if (chunks.length > 1 && last.length <= Math.ceil(unitSize / 2)) {
      chunks.pop()
      chunks[chunks.length - 1]!.push(...last)
    }
    const prefix = level.toLowerCase()
    let n = Math.max(0, ...out.filter((u) => u.unit_id.startsWith(`${prefix}-`)).map((u) => unitNumber(u.unit_id)))
    for (const entry_ids of chunks) {
      n += 1
      out.push({ unit_id: `${prefix}-${String(n).padStart(2, '0')}`, level, entry_ids })
    }
  }
  return out
}

/** The path: levels in CEFR order, units by number within a level (spec §7.2). */
export function inPathOrder(units: readonly RegistryUnit[]): RegistryUnit[] {
  return [...units].sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || unitNumber(a.unit_id) - unitNumber(b.unit_id) || (a.unit_id < b.unit_id ? -1 : 1))
}
