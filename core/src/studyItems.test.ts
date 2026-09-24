import { describe, expect, it } from 'vitest'
import type { Corpus } from './corpus'
import { isValidDistractor } from './distractors'
import { seededRng } from './rng'
import type { ReviewState } from './scheduler'
import { buildItem, CHOICE_OPTIONS, matchingCandidates, practiceWords, type ItemContext } from './studyItems'
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
    const words = practiceWords({ states, flags, exclude: new Set([id(cheese)]), count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(milk), id(water)]))
    expect(practiceWords({ states, flags: new Map(), exclude: new Set(), count: 2, rng: seededRng(1) })).toHaveLength(2)
  })

  it('is empty before any word is introduced', () => {
    expect(practiceWords({ states: new Map(), flags: new Map(), exclude: new Set(), count: 10, rng: seededRng(1) })).toEqual([])
  })
})

describe('matchingCandidates', () => {
  it('offers introduced, live corpus words only', () => {
    const states = new Map([apple, bread, old, cheese].map((e) => [id(e), state(id(e), 1)]))
    const flags = new Map<WordId, WordFlag>([[id(cheese), 'suspended']])
    expect(matchingCandidates(corpus(), states, flags)).toEqual([apple, bread])
  })
})
