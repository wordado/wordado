import { DAY_MS } from './scheduler'

/** The server's day for the XP cap (spec §8.7): UTC, so no client setting can move it. */
export function utcDay(ts: number): number {
  return Math.floor(ts / DAY_MS)
}

/** `YYYY-MM-DD` for a day number, the form `day_complete.local_date` is stored in (spec §6.2). */
export function dayToIsoDate(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10)
}

/** Years 0-99 are out of range: `Date.UTC` remaps a two-digit year into 1900-1999. */
export function isoDateToDay(iso: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) throw new Error(`Invalid date: ${JSON.stringify(iso)}`)
  const day = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS
  if (dayToIsoDate(day) !== iso) throw new Error(`Invalid date: ${JSON.stringify(iso)}`)
  return day
}

/** The calendar month a day falls in, as months since year 0. For grouping only. */
export function monthOf(day: number): number {
  const date = new Date(day * DAY_MS)
  return date.getUTCFullYear() * 12 + date.getUTCMonth()
}
