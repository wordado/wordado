import type { ChoiceItem, CorpusEntry, FlashcardItem } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { keyAction } from './keys'

const entry = { entryId: 'a-1', headword: 'a' } as CorpusEntry
const flashcard: FlashcardItem = { mode: 'flashcard', wordId: 'c:a-1', entry, direction: 'en_to_l1' }
const choice: ChoiceItem = { mode: 'multiple_choice', wordId: 'c:a-1', entry, direction: 'en_to_l1', options: [entry, entry, entry], answerIndex: 0 }

describe('keyAction', () => {
  it('answers a choice with digits, within its options', () => {
    expect(keyAction('1', 'prompt', choice)).toEqual({ kind: 'choose', index: 0 })
    expect(keyAction('3', 'prompt', choice)).toEqual({ kind: 'choose', index: 2 })
    expect(keyAction('4', 'prompt', choice)).toBeNull()
  })

  it('reveals a flashcard with Space or Enter, then rates it 1–4', () => {
    expect(keyAction(' ', 'prompt', flashcard)).toEqual({ kind: 'reveal' })
    expect(keyAction('Enter', 'prompt', flashcard)).toEqual({ kind: 'reveal' })
    expect(keyAction('1', 'prompt', flashcard)).toBeNull()
    expect(keyAction('1', 'revealed', flashcard)).toEqual({ kind: 'rate', grade: 1 })
    expect(keyAction('4', 'revealed', flashcard)).toEqual({ kind: 'rate', grade: 4 })
  })

  it('continues from feedback with Space or Enter, and ignores digits there', () => {
    expect(keyAction('Enter', 'feedback', choice)).toEqual({ kind: 'next' })
    expect(keyAction(' ', 'feedback', choice)).toEqual({ kind: 'next' })
    expect(keyAction('2', 'feedback', choice)).toBeNull()
  })

  it('does nothing when the run is done or for other keys', () => {
    expect(keyAction('1', 'done', null)).toBeNull()
    expect(keyAction('a', 'prompt', choice)).toBeNull()
    expect(keyAction('Enter', 'prompt', choice)).toBeNull()
  })
})
