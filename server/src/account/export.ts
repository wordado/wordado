import type { StampedReviewEvent, WireDocument } from '@wordado/core'
import type { Db } from '../db/db'
import { EVENT_COLUMNS, toStampedEvent, toStoredEvent, type EventRow } from '../sync/events'
import { DOCUMENT_COLUMNS, toWire, type DocumentRow } from '../sync/documents'

export const EXPORT_FORMAT = 'wordado-export-1'

/** The learner's portable copy (spec §11). Words join it in Phase 2. */
export interface AccountExport {
  readonly format: string
  readonly exportedAt: number
  readonly account: { readonly userId: string; readonly email: string; readonly country: string | null; readonly createdAt: number }
  /** Settings, flags, unlocks, reports and the entitlement, as the pull sends them. */
  readonly documents: readonly WireDocument[]
  readonly dayComplete: readonly string[]
  /** Every answer, as stamped, in replay order. */
  readonly reviewEvents: readonly StampedReviewEvent[]
}

/**
 * Builds the export in one read-only snapshot. It is sized by the learner's
 * whole history, so it is one of the CPU-sensitive paths the preview
 * deployment checks (spec §4.4).
 */
export async function buildExport(db: Db, userId: string, now: number): Promise<AccountExport | null> {
  return db.transaction(async (tx) => {
    await tx.query('set transaction isolation level repeatable read, read only')
    const [user] = await tx.query<{ id: string; email: string; country: string | null; created_at: Date }>(
      'select id, email, country, "createdAt" as created_at from "user" where id = $1',
      [userId],
    )
    if (!user) return null
    const documents = await tx.query<DocumentRow>(`select ${DOCUMENT_COLUMNS} from document where user_id = $1 order by version`, [userId])
    const days = await tx.query<{ local_date: string }>('select local_date from day_complete where user_id = $1 order by local_date', [userId])
    const events = await tx.query<EventRow>(
      `select ${EVENT_COLUMNS} from review_event where user_id = $1 order by effective_ts, device_id, device_seq, review_id`,
      [userId],
    )
    return {
      format: EXPORT_FORMAT,
      exportedAt: now,
      account: { userId: user.id, email: user.email, country: user.country, createdAt: user.created_at.getTime() },
      documents: documents.map((row) => toWire(row, null)),
      dayComplete: days.map((d) => d.local_date),
      reviewEvents: events.map((row) => toStampedEvent(toStoredEvent(row))),
    }
  })
}
