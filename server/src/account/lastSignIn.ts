import type { Queryable } from '../db/db'

/**
 * Records that the learner is here (#187): called when a session is made, which is a sign-in, and when one is
 * extended, which happens once a day of use (src/auth.ts). Without the second a learner who never signs out
 * would count as away. The sweep of inactive accounts reads this date and nothing else writes it.
 */
export async function recordSignIn(db: Queryable, userId: string | undefined, now: number): Promise<void> {
  if (userId === undefined) return
  await db.query('update "user" set last_sign_in_at = $2 where id = $1', [userId, new Date(now)])
}
