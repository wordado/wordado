import type { ServerDeps } from '../deps'
import { sendDueReminders } from '../reminders/schedule'
import { pruneSignInLimits } from '../signInLimit'
import { requestStaleRederivations } from './rederive'

/** A push whose last page has not come a day after its first has been abandoned (spec §9.2). */
export const PUSH_WINDOW_TTL_MS = 86_400_000

export async function cleanupPushWindows(deps: ServerDeps): Promise<number> {
  const rows = await deps.db.query('delete from push_window where opened_at < $1 returning push_id', [deps.now() - PUSH_WINDOW_TTL_MS])
  return rows.length
}

/**
 * The Cron Trigger, every 15 minutes (spec §4.4, §8.11). Each step stands
 * alone: one failing does not stop the others, and the failures are reported
 * together once all have run.
 */
export async function runScheduled(deps: ServerDeps): Promise<void> {
  const steps: (() => Promise<unknown>)[] = [
    () => requestStaleRederivations(deps),
    () => cleanupPushWindows(deps),
    () => pruneSignInLimits(deps),
    () => sendDueReminders(deps),
  ]
  const results = await Promise.allSettled(steps.map((step) => step()))
  const failures = results.flatMap((r) => (r.status === 'rejected' ? [r.reason as unknown] : []))
  if (failures.length > 0) throw new AggregateError(failures, `${failures.length} scheduled step(s) failed`)
}
