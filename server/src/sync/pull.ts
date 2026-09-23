import {
  ENTITLEMENT_STALE_AFTER_MS,
  Grade,
  SCHEDULER_VERSION,
  utcDay,
  type DaySummary,
  type PullRequest,
  type PullResponse,
  type ReviewState,
} from '@wordado/core'
import type { ServerDeps } from '../deps'
import { lockLearner } from '../learner'
import { DOCUMENT_COLUMNS, toWire, type DocumentRow } from './documents'

/** The pulled summary's reach (spec §8.3). */
export const SUMMARY_DAYS = 90

/**
 * core's summarizeDays, over the kinds the derivation stored: the same five
 * counts per local day. pull.test.ts holds the two equal.
 */
const SUMMARY_SQL = `
  select local_day as day,
    (count(*) filter (where kind = 'review'))::int as reviews,
    (count(*) filter (where kind = 'review' and grade <> ${Grade.Again}))::int as successes,
    (count(*) filter (where kind = 'new'))::int as "newWords",
    count(*)::int as answered,
    (count(*) filter (where kind = 'practice'))::int as practice
  from review_event
  where user_id = $1 and local_day > $2
  group by local_day
  order by local_day`

/**
 * What a device needs to be ready after one pull (spec §9.2), read under
 * the learner's lock so the marks describe exactly the events the states
 * include (spec §4.3). Its size does not grow with the learner's history:
 * states are per word and the summary is trimmed.
 */
export async function handlePull(deps: ServerDeps, userId: string, request: PullRequest): Promise<PullResponse> {
  const min = deps.config.minProtocolVersion
  if (request.protocolVersion < min) return { status: 'upgrade_required', minProtocolVersion: min }
  const now = deps.now()
  const today = utcDay(now)
  return deps.db.transaction(async (tx) => {
    const learner = await lockLearner(tx, userId)
    const states = await tx.query<{ state: ReviewState }>('select state from review_state where user_id = $1 order by word_id', [userId])
    const marks = await tx.query<{ device_id: string; device_seq: number }>('select device_id, device_seq from device where user_id = $1', [userId])
    const summaries = await tx.query<DaySummary>(SUMMARY_SQL, [userId, today - SUMMARY_DAYS])
    const days = await tx.query<{ local_date: string }>('select local_date from day_complete where user_id = $1 order by local_date', [userId])
    // Server-owned copies always travel, with a fresh staleAfter, so a pull refreshes them (spec §9.2).
    const documents = await tx.query<DocumentRow>(
      `select ${DOCUMENT_COLUMNS} from document where user_id = $1 and (version > $2 or class = 'server_owned') order by version`,
      [userId, request.documentsSince],
    )
    const [xp] = await tx.query<{ total: number; today: number }>(
      `select coalesce(sum(xp_award), 0)::int8 as total, coalesce(sum(xp_award) filter (where utc_day = $2), 0)::int8 as today
       from review_event where user_id = $1`,
      [userId, today],
    )
    return {
      status: 'ok',
      serverNow: now,
      schedulerVersion: SCHEDULER_VERSION,
      reviewStates: states.map((r) => r.state),
      deviceMarks: Object.fromEntries(marks.map((m) => [m.device_id, m.device_seq])),
      summaries,
      dayComplete: days.map((d) => d.local_date),
      documents: documents.map((row) => toWire(row, now + ENTITLEMENT_STALE_AFTER_MS)),
      documentsVersion: learner.documentVersion,
      xp: { total: xp?.total ?? 0, utcDay: today, today: xp?.today ?? 0 },
    }
  })
}
