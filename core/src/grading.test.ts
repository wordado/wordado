import { describe, expect, it } from 'vitest'
import { gradeAnswer, SLOW_THRESHOLD_MS } from './grading'
import { Grade } from './types'

const on = { latencyGrading: true }
const off = { latencyGrading: false }

describe('gradeAnswer', () => {
  it('passes a flashcard self-rating straight through', () => {
    for (const rating of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
      expect(gradeAnswer('flashcard', { kind: 'self_rated', rating }, on)).toBe(rating)
    }
  })

  it('grades an incorrect answer Again, however fast', () => {
    expect(gradeAnswer('multiple_choice', { kind: 'binary', correct: false, latencyMs: 900 }, on)).toBe(
      Grade.Again,
    )
  })

  it('grades a correct answer Good at the threshold and Hard above it', () => {
    const limit = SLOW_THRESHOLD_MS.multiple_choice
    expect(gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: limit }, on)).toBe(
      Grade.Good,
    )
    expect(
      gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: limit + 1 }, on),
    ).toBe(Grade.Hard)
  })

  it('ignores latency when latency grading is switched off', () => {
    expect(
      gradeAnswer('listening_select', { kind: 'binary', correct: true, latencyMs: 60_000 }, off),
    ).toBe(Grade.Good)
  })

  it('grades a typo-accepted answer Hard even when fast', () => {
    expect(
      gradeAnswer('multiple_choice', { kind: 'binary', correct: true, latencyMs: 500, typo: true }, off),
    ).toBe(Grade.Hard)
  })

  it('never produces Easy from a binary mode', () => {
    for (const mode of ['multiple_choice', 'listening_select', 'matching'] as const) {
      for (const latencyMs of [1, 500, 5_000, 50_000]) {
        for (const correct of [true, false]) {
          expect(gradeAnswer(mode, { kind: 'binary', correct, latencyMs }, on)).not.toBe(Grade.Easy)
        }
      }
    }
  })

  it('never grades matching Hard for slowness', () => {
    expect(gradeAnswer('matching', { kind: 'binary', correct: true, latencyMs: 120_000 }, on)).toBe(
      Grade.Good,
    )
  })

  it('rejects a self-rating from a binary mode and a binary outcome from a flashcard', () => {
    expect(() => gradeAnswer('multiple_choice', { kind: 'self_rated', rating: Grade.Easy }, on)).toThrow()
    expect(() => gradeAnswer('flashcard', { kind: 'binary', correct: true, latencyMs: 1 }, on)).toThrow()
  })
})
