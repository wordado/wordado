import { describe, expect, it } from 'vitest'
import type { Corpus } from './corpus'
import { isValidDistractor } from './distractors'
import { seededRng } from './rng'
import type { ReviewState } from './scheduler'
import { buildItem, CHOICE_OPTIONS, matchingCandidates, practiceCandidates, practicePool, practisable, practiceWords, scopePool, type ItemContext } from './studyItems'
import { Grade, type CorpusEntry, type Mode, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

let n = 0
function entry(headword: string, translation: string, over: Partial<CorpusEntry> = {}): CorpusEntry {
  n += 1
  return {
    entryId: `${headword}-${n}`,
    headword,
    variants: [],
    pos: 'noun',
    sense: '',
    level: 'A1',
    ipa: `/${headword}/`,
    unitId: 'a1-01',
    themes: [],
    translations: [translation],
    examples: [],
    audio: {},
    retired: false,
    ...over,
  }
}

const apple = entry('apple', 'ябълка')
const bread = entry('bread', 'хляб')
const cheese = entry('cheese', 'сирене')
const milk = entry('milk', 'мляко')
const water = entry('water', 'вода')
const their = entry('their', 'техен', { pos: 'det', ipa: '/ðeə/' })
const there = entry('there', 'там', { pos: 'adv', ipa: '/ðeə/' })
const old = entry('old', 'стар', { retired: true })
const ENTRIES = [apple, bread, cheese, milk, water, their, there, old]

const corpus = (entries: readonly CorpusEntry[] = ENTRIES): Corpus => ({
  l1: 'bg',
  entries: new Map(entries.map((e) => [e.entryId, e])),
  units: [],
  themes: [],
  clips: new Map(),
  retired: new Set(entries.filter((e) => e.retired).map((e) => corpusWordId(e.entryId))),
})

const id = (e: CorpusEntry): WordId => corpusWordId(e.entryId)

function state(wordId: WordId, stability: number): ReviewState {
  return {
    wordId,
    stability,
    difficulty: 5,
    introducedTs: 0,
    introducedDay: 0,
    lastReviewTs: 0,
    lastReviewDay: 0,
    lastGrade: Grade.Good,
    reps: 1,
    lapses: 0,
    passedOnLaterDay: false,
  }
}

const BOTH: ReadonlySet<Mode> = new Set<Mode>(['flashcard', 'multiple_choice'])

const ctx = (over: Partial<ItemContext> = {}): ItemContext => ({
  corpus: corpus(),
  states: new Map(),
  available: BOTH,
  preferred: null,
  rng: seededRng(1),
  ...over,
})

describe('buildItem', () => {
  it('asks a new word by recognition, with four unambiguous options and the answer among them', () => {
    const item = buildItem(id(apple), ctx())
    expect(item?.mode).toBe('multiple_choice')
    if (!item || item.mode === 'flashcard') throw new Error('expected a choice item')
    expect(item.options).toHaveLength(CHOICE_OPTIONS)
    expect(item.options[item.answerIndex]).toBe(apple)
    expect(new Set(item.options.map((o) => o.entryId)).size).toBe(CHOICE_OPTIONS)
    for (const option of item.options) if (option !== apple) expect(isValidDistractor(apple, option, false)).toBe(true)
  })

  it('asks a young or mature word by recall (spec §7.5)', () => {
    const item = buildItem(id(apple), ctx({ states: new Map([[id(apple), state(id(apple), 30)]]) }))
    expect(item).toEqual({ mode: 'flashcard', wordId: id(apple), entry: apple, direction: 'en_to_l1' })
  })

  it('honours a single-mode session when the mode can run, and ignores it when it cannot', () => {
    expect(buildItem(id(apple), ctx({ preferred: 'flashcard' }))?.mode).toBe('flashcard')
    expect(buildItem(id(apple), ctx({ preferred: 'listening_select' }))?.mode).toBe('multiple_choice')
  })

  it('never picks matching, which is a practice game', () => {
    const item = buildItem(id(apple), ctx({ available: new Set<Mode>(['matching', 'flashcard']), preferred: 'matching' }))
    expect(item?.mode).toBe('flashcard')
  })

  it('asks listening in English, with homophones left out of the options', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const item = buildItem(id(their), ctx({ available: new Set<Mode>(['listening_select']), preferred: 'listening_select', rng: seededRng(seed) }))
      if (!item || item.mode !== 'listening_select') throw new Error('expected a listening item')
      expect(item.direction).toBe('en_to_l1')
      expect(item.options.map((o) => o.headword)).not.toContain('there')
    }
  })

  it('uses both directions for multiple choice', () => {
    const directions = new Set<string>()
    for (let seed = 1; seed <= 20; seed += 1) directions.add(buildItem(id(apple), ctx({ rng: seededRng(seed) }))!.direction)
    expect(directions).toEqual(new Set(['en_to_l1', 'l1_to_en']))
  })

  it('falls back to a flashcard when the corpus cannot supply three distractors', () => {
    const item = buildItem(id(apple), ctx({ corpus: corpus([apple, bread, old]) }))
    expect(item?.mode).toBe('flashcard')
  })

  it('returns null for a word the corpus does not hold', () => {
    expect(buildItem('c:missing-1', ctx())).toBeNull()
    expect(buildItem('u:0f0f0f0f-0000-4000-8000-000000000000', ctx())).toBeNull()
  })
})

describe('practiceWords', () => {
  const states = new Map(ENTRIES.slice(0, 5).map((e) => [id(e), state(id(e), 10)]))

  it('draws introduced words that are neither flagged nor excluded, at most `count`', () => {
    const flags = new Map<WordId, WordFlag>([[id(bread), 'known']])
    const words = practiceWords({ states, flags, retired: new Set(), exclude: new Set([id(cheese)]), count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(milk), id(water)]))
    expect(practiceWords({ states, flags: new Map(), retired: new Set(), exclude: new Set(), count: 2, rng: seededRng(1) })).toHaveLength(2)
  })

  it('is empty before any word is introduced', () => {
    expect(practiceWords({ states: new Map(), flags: new Map(), retired: new Set(), exclude: new Set(), count: 10, rng: seededRng(1) })).toEqual([])
  })

  it('uses the words today’s session serves when leaving them out would leave nothing: a repeat beats a dead end', () => {
    const flags = new Map<WordId, WordFlag>([[id(bread), 'known']])
    const all = new Set(states.keys())
    const words = practiceWords({ states, flags, retired: new Set(), exclude: all, count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(cheese), id(milk), id(water)]))
    // One word outside the session is enough for the usual rule.
    const butMilk = new Set([...all].filter((w) => w !== id(milk)))
    expect(practiceWords({ states, flags, retired: new Set(), exclude: butMilk, count: 10, rng: seededRng(1) })).toEqual([id(milk)])
    // The same within a unit or a theme: its own words only, never a flagged one.
    const within = new Set([id(apple), id(bread)])
    expect(practiceWords({ states, flags, retired: new Set(), exclude: all, within, count: 10, rng: seededRng(1) })).toEqual([id(apple)])
  })

  it('leans towards weaker words without shutting the strong ones out, never repeats a word, and differs between rounds', () => {
    // One word forgotten twice and last rated again, nine mature ones never forgotten.
    const weak: ReviewState = { ...state(id(apple), 1), lapses: 2, lastGrade: Grade.Again }
    const strong = [bread, cheese, milk, water, their, there, ...Array.from({ length: 3 }, (_, i) => entry(`extra${i}`, `допълнителна${i}`))]
    const pool = new Map<WordId, ReviewState>([[id(apple), weak], ...strong.map((e) => [id(e), state(id(e), 60)] as const)])
    const rng = seededRng(11)
    const picked = new Map<WordId, number>()
    const rounds = new Set<string>()
    const ROUNDS = 4_000
    for (let i = 0; i < ROUNDS; i += 1) {
      const words = practiceWords({ states: pool, flags: new Map(), retired: new Set(), exclude: new Set(), count: 3, rng })
      expect(words).toHaveLength(3)
      expect(new Set(words).size).toBe(3)
      rounds.add(words.join())
      for (const w of words) picked.set(w, (picked.get(w) ?? 0) + 1)
    }
    const weakShare = picked.get(id(apple))! / ROUNDS
    const strongShares = strong.map((e) => picked.get(id(e))! / ROUNDS)
    // Measured with this seed: the weak word is in 76% of the runs of three, each strong one in 24% to 27%.
    expect(weakShare).toBeGreaterThan(0.7)
    expect(Math.max(...strongShares)).toBeLessThan(0.3)
    expect(Math.min(...strongShares)).toBeGreaterThan(0.2)
    expect(rounds.size).toBeGreaterThan(100)
  })

  it('never draws a retired word, even when it is the only started one', () => {
    const retired = new Set([id(apple)])
    const words = practiceWords({ states, flags: new Map(), retired, exclude: new Set(), count: 10, rng: seededRng(1) })
    expect(words).toHaveLength(4)
    expect(words).not.toContain(id(apple))
    const within = new Set([id(apple)])
    expect(practiceWords({ states, flags: new Map(), retired, exclude: new Set(), within, count: 10, rng: seededRng(1) })).toEqual([])
    // Not through the empty-pool rule either.
    expect(practiceWords({ states, flags: new Map(), retired, exclude: new Set(states.keys()), within, count: 10, rng: seededRng(1) })).toEqual([])
  })

  it('keeps to the given words when practising one unit, under the same rules', () => {
    const flags = new Map<WordId, WordFlag>([[id(bread), 'known']])
    const within = new Set([id(apple), id(bread), id(cheese), id(milk)])
    const words = practiceWords({ states, flags, retired: new Set(), exclude: new Set([id(cheese)]), within, count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(milk)]))
  })
})

describe('practice of a unit of a skipped level (spec §7.2, §7.4)', () => {
  // Two of the unit's four live words are started; bread is set aside, old is retired.
  const states = new Map([apple, bread].map((e) => [id(e), state(id(e), 10)]))
  const flags = new Map<WordId, WordFlag>([[id(bread), 'known']])
  const retired = new Set([id(old)])
  const within = new Set([apple, bread, cheese, milk, old].map(id))

  it('admits a word that was never started only when the scope takes unstarted words, and never a flagged or retired one', () => {
    expect(practisable(id(cheese), { states, flags, retired })).toBe(false)
    expect(practisable(id(cheese), { states, flags, retired, unstarted: true })).toBe(true)
    expect(practisable(id(apple), { states, flags, retired, unstarted: true })).toBe(true)
    expect(practisable(id(bread), { states, flags, retired, unstarted: true })).toBe(false)
    expect(practisable(id(old), { states, flags, retired, unstarted: true })).toBe(false)
  })

  it('draws from all the unit’s live words, started or not, and only from the unit', () => {
    const words = practiceWords({ states, flags, retired, exclude: new Set(), within, unstarted: true, count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(cheese), id(milk)]))
    expect(new Set(words).size).toBe(words.length)
    // Any other unit keeps to its started words.
    expect(practiceWords({ states, flags, retired, exclude: new Set(), within, count: 10, rng: seededRng(1) })).toEqual([id(apple)])
    // Without a unit there is nothing to take unstarted words from.
    expect(practiceWords({ states, flags, retired, exclude: new Set(), unstarted: true, count: 10, rng: seededRng(1) })).toEqual([id(apple)])
  })

  it('gives a word with no review state the base weight: drawn as readily as a strong word, less than a weak one', () => {
    const weak: ReviewState = { ...state(id(apple), 1), lapses: 2, lastGrade: Grade.Again }
    const pool = new Map<WordId, ReviewState>([[id(apple), weak], [id(water), state(id(water), 60)]])
    const unit = new Set([apple, water, cheese, milk].map(id))
    const rng = seededRng(5)
    const first = new Map<WordId, number>()
    for (let i = 0; i < 4_000; i += 1) {
      const [word] = practiceWords({ states: pool, flags: new Map(), retired: new Set(), exclude: new Set(), within: unit, unstarted: true, count: 1, rng })
      first.set(word!, (first.get(word!) ?? 0) + 1)
    }
    // Weights 5, 1, 1, 1: the weak word leads five times in eight, each of the others one time in eight.
    expect(first.get(id(apple))! / 4_000).toBeGreaterThan(0.55)
    for (const e of [water, cheese, milk]) {
      expect(first.get(id(e))! / 4_000).toBeGreaterThan(0.09)
      expect(first.get(id(e))! / 4_000).toBeLessThan(0.16)
    }
  })

  it('offers matching all the unit’s live words too, and other units their started ones', () => {
    expect(matchingCandidates(corpus(), states, flags, within, true)).toEqual([apple, cheese, milk])
    expect(matchingCandidates(corpus(), states, flags, within)).toEqual([apple])
  })
})

describe('scopePool: which practice takes its scope whole (spec §7.4)', () => {
  const travel = [apple, cheese, old].map((e) => ({ ...e, themes: ['travel'] }))
  const scoped: Corpus = {
    ...corpus([...travel, bread, milk]),
    units: [
      { unitId: 'a1-01', level: 'A1', order: 1, title: { en: 'One', l1: 'Едно' }, wordIds: [id(apple), id(bread)] },
      { unitId: 'a2-01', level: 'A2', order: 2, title: { en: 'Two', l1: 'Две' }, wordIds: [id(cheese), id(milk)] },
    ],
    themes: [{ themeId: 'travel', name: { en: 'Travel', l1: 'Пътуване' }, description: { en: '', l1: '' } }],
  }

  it('takes a theme whole, whatever the learner’s level: every live word of the theme, started or not', () => {
    for (const declared of ['A1', 'A2', 'B1'] as const) {
      expect(scopePool(scoped, declared, { kind: 'theme', id: 'travel' })).toEqual({ within: new Set([apple, cheese].map(id)), unstarted: true })
    }
  })

  it('takes a unit whole only when its level was skipped', () => {
    expect(scopePool(scoped, 'A1', { kind: 'unit', id: 'a1-01' })).toEqual({ within: new Set([id(apple), id(bread)]), unstarted: false })
    expect(scopePool(scoped, 'A2', { kind: 'unit', id: 'a1-01' })).toEqual({ within: new Set([id(apple), id(bread)]), unstarted: true })
    expect(scopePool(scoped, 'A2', { kind: 'unit', id: 'a2-01' })).toMatchObject({ unstarted: false })
    expect(scopePool(scoped, 'A1', { kind: 'unit', id: 'a2-01' })).toMatchObject({ unstarted: false })
  })

  it('is nothing for practice over everything, without a corpus, and for a unit or theme the corpus does not hold', () => {
    expect(scopePool(scoped, 'A1', undefined)).toBeUndefined()
    expect(scopePool(null, 'A1', { kind: 'theme', id: 'travel' })).toBeUndefined()
    expect(scopePool(scoped, 'A1', { kind: 'theme', id: 'nowhere' })).toBeUndefined()
    expect(scopePool(scoped, 'A1', { kind: 'unit', id: 'nowhere' })).toBeUndefined()
  })

  it('gives a theme’s practice its live, unflagged words, started or not, and practice over everything the started ones', () => {
    const states = new Map([apple, bread].map((e) => [id(e), state(id(e), 10)]))
    const flags = new Map<WordId, WordFlag>([[id(milk), 'known']])
    const ctx = { states, flags, retired: scoped.retired, exclude: new Set<WordId>() }
    const theme = scopePool(scoped, 'A1', { kind: 'theme', id: 'travel' })
    // Cheese was never started and is practised all the same; the theme's retired word is not.
    expect(new Set(practiceCandidates({ ...ctx, ...theme }))).toEqual(new Set([id(apple), id(cheese)]))
    expect(matchingCandidates(scoped, states, flags, theme?.within, theme?.unstarted).map(id)).toEqual([id(apple), id(cheese)])
    expect(new Set(practiceCandidates(ctx))).toEqual(new Set([id(apple), id(bread)]))
    expect(new Set(practiceCandidates({ ...ctx, ...scopePool(scoped, 'A1', { kind: 'unit', id: 'a2-01' }) }))).toEqual(new Set())
  })
})

describe('practiceWords within a visit (spec §7.4)', () => {
  const states = new Map([apple, bread, cheese, milk, water].map((e) => [id(e), state(id(e), 10)]))
  const base = { states, flags: new Map<WordId, WordFlag>(), retired: new Set<WordId>(), exclude: new Set<WordId>() }

  it('draws the words the visit has not shown first, and fills a round up with shown ones', () => {
    const shown = new Set([id(apple), id(bread), id(cheese)])
    for (let seed = 1; seed <= 20; seed += 1) {
      expect(new Set(practiceWords({ ...base, shown, count: 2, rng: seededRng(seed) }))).toEqual(new Set([id(milk), id(water)]))
      const round = practiceWords({ ...base, shown, count: 4, rng: seededRng(seed) })
      expect(new Set(round.slice(0, 2))).toEqual(new Set([id(milk), id(water)]))
      expect(shown.has(round[2]!) && shown.has(round[3]!) && round[2] !== round[3]).toBe(true)
    }
  })

  it('keeps today’s session out of the candidates as before: a shown word outside it comes before an unseen one inside it never', () => {
    const exclude = new Set([id(water)])
    const shown = new Set([id(apple), id(bread), id(cheese), id(milk)])
    expect(practiceCandidates({ ...base, exclude })).not.toContain(id(water))
    expect(practiceWords({ ...base, exclude, shown, count: 10, rng: seededRng(1) })).not.toContain(id(water))
  })

  it('tells the words left to today’s session apart from the candidates, and holds none back when they are all there is', () => {
    const exclude = new Set([id(water), id(milk), id(old)])
    const pool = practicePool({ ...base, exclude })
    expect(new Set(pool.candidates)).toEqual(new Set([id(apple), id(bread), id(cheese)]))
    expect(new Set(pool.heldBack)).toEqual(new Set([id(water), id(milk)]))
    // A session word practice could not use anyway (set aside) is not counted as held back.
    expect(practicePool({ ...base, flags: new Map<WordId, WordFlag>([[id(milk), 'known']]), exclude }).heldBack).toEqual([id(water)])
    // Every usable word is in the session: practice draws them after all, and none is held back.
    const all = practicePool({ ...base, exclude: new Set(states.keys()) })
    expect(all.candidates).toHaveLength(5)
    expect(all.heldBack).toEqual([])
    expect(practicePool({ ...base, exclude: new Set() }).heldBack).toEqual([])
  })

  it('draws as it always did when nothing has been shown', () => {
    expect(practiceWords({ ...base, shown: new Set(), count: 3, rng: seededRng(8) })).toEqual(practiceWords({ ...base, count: 3, rng: seededRng(8) }))
  })
})

describe('matchingCandidates', () => {
  it('offers introduced, live corpus words only', () => {
    const states = new Map([apple, bread, old, cheese].map((e) => [id(e), state(id(e), 1)]))
    const flags = new Map<WordId, WordFlag>([[id(cheese), 'suspended']])
    expect(matchingCandidates(corpus(), states, flags)).toEqual([apple, bread])
  })

  it('keeps to the given words when practising one unit', () => {
    const states = new Map([apple, bread, old, cheese].map((e) => [id(e), state(id(e), 1)]))
    expect(matchingCandidates(corpus(), states, new Map(), new Set([id(bread), id(old), id(milk)]))).toEqual([bread])
  })
})
