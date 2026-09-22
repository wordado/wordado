import { createHash } from 'node:crypto'
import { seededRng } from '@wordado/core'
import type { ClientEnv } from '../env'

export interface TestClock {
  now: number
  tzOffsetMin: number
}

export interface TestEnv extends ClientEnv {
  readonly clock: TestClock
  advance(ms: number): void
}

/** A deterministic environment: a settable clock, counted UUIDs, a seeded rng, a real SHA-256. */
export function testEnv(start = Date.UTC(2026, 0, 5, 10), tzOffsetMin = 120, seed = 1): TestEnv {
  const clock: TestClock = { now: start, tzOffsetMin }
  let n = 0
  return {
    clock,
    advance: (ms) => {
      clock.now += ms
    },
    now: () => clock.now,
    tzOffsetMin: () => clock.tzOffsetMin,
    uuid: () => {
      n += 1
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    },
    rng: seededRng(seed),
    sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
  }
}
