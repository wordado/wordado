import { DEFAULT_ENRICHMENT_PER_DAY, DOCUMENT_TYPES, SCHEDULER_VERSION } from '@wordado/core'
import type { Queryable } from './db/db'

export interface LearnerRow {
  readonly documentVersion: number
  readonly derivedSchedulerVersion: string
}

/** What every learner holds at launch (spec §8.8): one tier, never expiring. */
export function defaultEntitlementFields(): Record<string, unknown> {
  return { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: DEFAULT_ENRICHMENT_PER_DAY } }
}

/**
 * Takes the learner's row lock for the rest of the transaction, creating the
 * row — and the learner's entitlement, as document version 1 — on first use.
 * Every push and pull starts here, so one learner's pushes run one at a time
 * and a pull reads marks and states from one moment. `do update` is what
 * takes the lock on an existing row; `xmax = 0` is Postgres's sign that the
 * row was inserted rather than updated.
 */
export async function lockLearner(tx: Queryable, userId: string): Promise<LearnerRow> {
  const [row] = await tx.query<{ document_version: number; derived_scheduler_version: string; inserted: boolean }>(
    `insert into learner (user_id, derived_scheduler_version) values ($1, $2)
     on conflict (user_id) do update set user_id = excluded.user_id
     returning document_version, derived_scheduler_version, (xmax = 0) as inserted`,
    [userId, SCHEDULER_VERSION],
  )
  if (!row) throw new Error(`Could not lock learner ${userId}`)
  if (!row.inserted) return { documentVersion: row.document_version, derivedSchedulerVersion: row.derived_scheduler_version }
  await tx.query(
    `insert into document (user_id, type, key, class, version, fields, field_versions, deleted)
     values ($1, $2, '', 'server_owned', 1, $3::jsonb, '{}'::jsonb, false)`,
    [userId, DOCUMENT_TYPES.entitlement, JSON.stringify(defaultEntitlementFields())],
  )
  await tx.query('update learner set document_version = 1 where user_id = $1', [userId])
  return { documentVersion: 1, derivedSchedulerVersion: SCHEDULER_VERSION }
}
