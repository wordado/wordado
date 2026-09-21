import { shuffle, type Rng } from './rng'
import type { CorpusEntry } from './types'

export interface DistractorContext {
  /** Candidate entries: normally the whole loaded corpus. */
  readonly pool: readonly CorpusEntry[]
  /** entryIds the learner has already met; these are preferred. */
  readonly encountered: ReadonlySet<string>
  /** True for listening modes, where homophones are excluded too. */
  readonly listening: boolean
}

const norm = (s: string) => s.trim().toLocaleLowerCase()

function sharesTranslation(a: CorpusEntry, b: CorpusEntry): boolean {
  const mine = new Set(a.translations.map(norm))
  return b.translations.some((t) => mine.has(norm(t)))
}

/** Two entries that could not both appear on screen without ambiguity. */
function clash(a: CorpusEntry, b: CorpusEntry, listening: boolean): boolean {
  return (
    norm(a.headword) === norm(b.headword) ||
    sharesTranslation(a, b) ||
    (listening && a.ipa !== '' && a.ipa === b.ipa)
  )
}

/** A distractor must be unambiguously wrong (spec §8.1). */
export function isValidDistractor(target: CorpusEntry, candidate: CorpusEntry, listening: boolean): boolean {
  return candidate.entryId !== target.entryId && !candidate.retired && !clash(target, candidate, listening)
}

function score(target: CorpusEntry, c: CorpusEntry, ctx: DistractorContext, rng: Rng): number {
  const a = norm(target.headword)
  const b = norm(c.headword)
  const lookalike = (a[0] === b[0] ? 1 : 0) + (Math.abs(a.length - b.length) <= 1 ? 1 : 0)
  return (
    (c.level === target.level ? 8 : 0) +
    (c.pos === target.pos ? 4 : 0) +
    (ctx.encountered.has(c.entryId) ? 3 : 0) +
    lookalike * (ctx.listening ? 2 : 1) +
    rng() * 1.5 // so the same word does not always meet the same distractors
  )
}

/**
 * Picks up to `count` wrong options for `target`: same band and part of speech
 * where possible, never ambiguous with the target or with each other. Returns
 * fewer than `count` only when the pool cannot supply them.
 */
export function pickDistractors(
  target: CorpusEntry,
  ctx: DistractorContext,
  count: number,
  rng: Rng,
): CorpusEntry[] {
  const ranked = shuffle(ctx.pool, rng)
    .filter((c) => isValidDistractor(target, c, ctx.listening))
    .map((entry) => ({ entry, score: score(target, entry, ctx, rng) }))
    .sort((x, y) => y.score - x.score)
  const chosen: CorpusEntry[] = []
  for (const { entry } of ranked) {
    if (chosen.length >= count) break
    if (!chosen.some((other) => clash(entry, other, ctx.listening))) chosen.push(entry)
  }
  return chosen
}

/**
 * Chooses `size` entries for a matching board on which no two pairs share a
 * headword or a translation. Null when the candidates cannot fill a board.
 */
export function buildMatchingBoard(
  candidates: readonly CorpusEntry[],
  size: number,
  rng: Rng,
): CorpusEntry[] | null {
  const board: CorpusEntry[] = []
  for (const entry of shuffle(candidates, rng)) {
    if (board.length >= size) break
    if (!entry.retired && !board.some((other) => clash(entry, other, false))) board.push(entry)
  }
  return board.length === size ? board : null
}
