import { monthOf } from './calendar'

/** Streak freezes a learner gets each calendar month (spec §8.4). */
export const STREAK_FREEZES_PER_MONTH = 2

/** Bumped when the day-complete condition changes; stored on every day_complete event. */
export const DAY_COMPLETE_RULE_VERSION = 'r1'

/** The immutable event a client emits once, when the condition is first met (spec §8.4). */
export interface DayCompleteEvent {
  /** The learner's local day number of the answer that completed the day. */
  readonly localDate: number
  readonly ruleVersion: string
}

export interface DayCompleteInput {
  /** `SessionPlan.backlogTotal` after the latest answer: scheduled reviews still due today. */
  readonly backlogTotal: number
  readonly reviewCap: number
  /** `DayCounts.reviewsDone` for today. */
  readonly reviewsDoneToday: number
  /** `DayCounts.answered` for today. */
  readonly answeredToday: number
  /** The learner's optional daily goal, in answers. */
  readonly dailyGoal: number | null
}

/**
 * Whether today counts: the capped due figure is finished, or the daily goal
 * is met, and at least one item was answered either way. With nothing due, a
 * single new word or practice answer completes the day (spec §8.4).
 */
export function isDayComplete(input: DayCompleteInput): boolean {
  if (input.answeredToday < 1) return false
  const capLeft = Math.max(0, input.reviewCap - input.reviewsDoneToday)
  const dueLeft = Math.min(input.backlogTotal, capLeft)
  if (dueLeft === 0) return true
  return input.dailyGoal !== null && input.answeredToday >= input.dailyGoal
}

export interface StreakStatus {
  /** Days in the current run, complete and frozen alike. */
  readonly length: number
  readonly todayComplete: boolean
  /** Freezes still available in today's calendar month. */
  readonly freezesLeft: number
}

/**
 * A pure function of the set of completed days (spec §8.4). The run ends
 * today if today is complete, else yesterday (a day is not missed until it is
 * over), and extends back while every calendar month in it has at most
 * STREAK_FREEZES_PER_MONTH missed days. Adding a date can only lengthen it.
 *
 * A run of misses since the last completed day is only "spent" — committed to
 * its month's count — once an earlier completed day is found, so the run
 * keeps extending through it. A miss that instead breaks the run (its month's
 * pending plus already-committed misses would exceed the allowance) is never
 * committed: it lies outside the run this function reports, so it costs
 * nothing against a later day's freezesLeft.
 */
export function streakStatus(completeDays: Iterable<number>, today: number): StreakStatus {
  const days = new Set(completeDays)
  const todayComplete = days.has(today)
  const committedByMonth = new Map<number, number>()
  const committedIn = (month: number) => committedByMonth.get(month) ?? 0
  let length = 0
  if (days.size > 0) {
    const earliest = Math.min(...days)
    const end = todayComplete ? today : today - 1
    let pendingByMonth = new Map<number, number>()
    for (let day = end; day >= earliest; day -= 1) {
      if (days.has(day)) {
        length = end - day + 1
        for (const [month, misses] of pendingByMonth) committedByMonth.set(month, committedIn(month) + misses)
        pendingByMonth = new Map()
        continue
      }
      const month = monthOf(day)
      const pending = (pendingByMonth.get(month) ?? 0) + 1
      if (pending + committedIn(month) > STREAK_FREEZES_PER_MONTH) break
      pendingByMonth.set(month, pending)
    }
  }
  return { length, todayComplete, freezesLeft: STREAK_FREEZES_PER_MONTH - committedIn(monthOf(today)) }
}
