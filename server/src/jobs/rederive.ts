import { SCHEDULER_VERSION } from '@wordado/core'
import type { Job, ServerDeps } from '../deps'
import { lockLearner } from '../learner'
import { rederiveUser } from '../sync/derive'

/**
 * Learners requested per cron run, and how long a request waits for its job
 * before it is made again. At 96 runs a day this stays inside the free Queues
 * allowance for a beta (spec §17); a full re-derivation of 500 learners takes
 * five runs. Tuning (§15).
 */
export const REDERIVE_BATCH = 100
export const REDERIVE_RETRY_MS = 3_600_000

/**
 * Queues one re-derivation per learner whose state was derived under another
 * scheduler version, or marked stale (spec §4.3, §4.4). Learners busy in a
 * push are skipped this run and found by the next.
 */
export async function requestStaleRederivations(deps: ServerDeps): Promise<number> {
  const now = deps.now()
  // The selection is materialized once. Inside `where user_id in (…)` Postgres may rescan it per learner (a
  // nested-loop semi join), and each rescan skips the rows this statement has already updated, so the limit moves on
  // and every stale learner is requested at once.
  const rows = await deps.db.query<{ user_id: string }>(
    `with picked as materialized (
       select user_id from learner
       where derived_scheduler_version <> $1 and (rederive_requested_at is null or rederive_requested_at < $3)
       order by user_id
       limit $4
       for update skip locked)
     update learner set rederive_requested_at = $2
     from picked
     where learner.user_id = picked.user_id
     returning learner.user_id`,
    [SCHEDULER_VERSION, now, now - REDERIVE_RETRY_MS, REDERIVE_BATCH],
  )
  if (rows.length > 0) await deps.jobs.sendBatch(rows.map((r): Job => ({ kind: 'rederive', userId: r.user_id })))
  return rows.length
}

/** One queue message. Safe to run twice: re-derivation is a function of the log. */
export async function handleJob(deps: ServerDeps, job: Job): Promise<void> {
  switch (job.kind) {
    case 'rederive':
      await deps.db.transaction(async (tx) => {
        const [user] = await tx.query('select 1 from "user" where id = $1', [job.userId])
        if (!user) return
        await lockLearner(tx, job.userId)
        await rederiveUser(tx, job.userId)
      })
      return
    default:
      return unhandledJob(job.kind)
  }
}

/** Fails to compile when a Job kind has no case above; throws for a message no build knows. */
function unhandledJob(kind: never): never {
  throw new Error(`Unknown job kind ${String(kind)}`)
}
