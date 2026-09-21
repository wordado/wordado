import { levelIndex, type CefrLevel, type Unit, type WordFlag } from './types'
import type { WordId } from './wordId'

/** Everything the level-path rules read (spec §7.2). */
export interface PathContext {
  /** Every unit in the loaded packs, in any order. */
  readonly units: readonly Unit[]
  readonly retired: ReadonlySet<WordId>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Words with at least one non-practice review, wherever they came from. */
  readonly introduced: ReadonlySet<WordId>
  readonly declaredLevel: CefrLevel
  /** The learner's grow-only unit_unlock set. */
  readonly unlocked: ReadonlySet<string>
}

/** Retired, known and suspended words are invisible to every progress rule. */
export function isLive(wordId: WordId, ctx: Pick<PathContext, 'retired' | 'flags'>): boolean {
  return !ctx.retired.has(wordId) && !ctx.flags.has(wordId)
}

function inPathOrder(units: readonly Unit[]): Unit[] {
  return [...units].sort((a, b) => a.order - b.order)
}

function isBelow(unit: Unit, level: CefrLevel): boolean {
  return levelIndex(unit.level) < levelIndex(level)
}

function pendingWords(unit: Unit, ctx: PathContext): WordId[] {
  return unit.wordIds.filter((id) => isLive(id, ctx) && !ctx.introduced.has(id))
}

/**
 * Never-introduced live words in units below the declared level. Not stored:
 * it follows the level when the learner changes it.
 */
export function assumedKnownWords(ctx: PathContext): Set<WordId> {
  const out = new Set<WordId>()
  for (const unit of ctx.units) {
    if (isBelow(unit, ctx.declaredLevel)) for (const id of pendingWords(unit, ctx)) out.add(id)
  }
  return out
}

/**
 * Unit IDs to add to the unlock set, in path order. Units below the declared
 * level are unlocked outright; from there on, a unit unlocks its successor
 * once every live word in it has been introduced. Never returns a removal.
 */
export function computeUnlocks(ctx: PathContext): string[] {
  const all = new Set(ctx.unlocked)
  const path: Unit[] = []
  for (const unit of inPathOrder(ctx.units)) {
    if (isBelow(unit, ctx.declaredLevel)) all.add(unit.unitId)
    else path.push(unit)
  }
  const first = path[0]
  if (first) all.add(first.unitId)
  path.forEach((unit, i) => {
    const successor = path[i + 1]
    if (successor && all.has(unit.unitId) && pendingWords(unit, ctx).length === 0) all.add(successor.unitId)
  })
  return inPathOrder(ctx.units)
    .map((u) => u.unitId)
    .filter((id) => all.has(id) && !ctx.unlocked.has(id))
}

/** The earliest unlocked unit, at or above the declared level, with a live never-introduced word. */
export function currentUnit(ctx: PathContext): Unit | null {
  for (const unit of inPathOrder(ctx.units)) {
    if (isBelow(unit, ctx.declaredLevel) || !ctx.unlocked.has(unit.unitId)) continue
    if (pendingWords(unit, ctx).length > 0) return unit
  }
  return null
}

/**
 * The path's new-word queue: up to `limit` words, in path order, starting at
 * the current unit. It runs on into the following units, because introducing
 * the last word of a unit is exactly what unlocks the next one.
 */
export function pathNewWords(ctx: PathContext, limit: number): WordId[] {
  const out: WordId[] = []
  const start = currentUnit(ctx)
  if (!start) return out
  for (const unit of inPathOrder(ctx.units)) {
    if (unit.order < start.order || isBelow(unit, ctx.declaredLevel)) continue
    for (const id of pendingWords(unit, ctx)) {
      if (out.length >= limit) return out
      out.push(id)
    }
  }
  return out
}
