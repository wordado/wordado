import { QUEUES, type Decisions, type DecisionEvent } from './decisions'

export interface ReopenResult {
  readonly reopened: readonly string[]
  /** Keys left alone, each with the reason ("bank-2: dropped"). */
  readonly skipped: readonly string[]
}

/**
 * A planned second review: sends reviewed items of one queue back, as triage does for reported ones (spec §8.10).
 * `queues` then writes them out again with their current values and the note in the reopened column, and a
 * release waits for them again. A dropped item stays dropped, and an item not yet reviewed is already open, so
 * both are skipped. Audio is not reopened: a clip is sent back with `redo`.
 */
export function reopenReviewed(
  decisions: Decisions,
  queue: string,
  opts: { readonly keys: readonly string[] | 'all'; readonly by: string; readonly note: string; readonly now: string },
): ReopenResult {
  if (queue === QUEUES.audio) throw new Error('audio clips are not reopened; mark them redo in an audio review file')
  if (opts.by.trim() === '') throw new Error('name who reopens with --by')
  const keys = opts.keys === 'all' ? [...new Set(decisions.all(queue).map((e) => e.key))] : [...new Set(opts.keys)]
  const reopened: string[] = []
  const skipped: string[] = []
  for (const key of keys) {
    const events = decisions.for(queue, key)
    if (events.some((e) => e.verdict === 'drop')) {
      skipped.push(`${key}: dropped`)
      continue
    }
    const last = events.filter((e) => e.verdict === 'ok' || e.verdict === 'fix' || e.verdict === 'reopen').at(-1)
    if (!last || last.verdict === 'reopen') {
      skipped.push(`${key}: ${last ? 'already reopened' : 'not reviewed yet'}`)
      continue
    }
    reopened.push(key)
  }
  const note = opts.note.trim()
  decisions.append(
    queue,
    reopened.map((key): DecisionEvent => ({ key, at: opts.now, verdict: 'reopen', by: opts.by.trim(), ...(note ? { note } : {}) })),
  )
  return { reopened, skipped }
}
