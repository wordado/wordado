import type { Queryable } from '../db/db'

/**
 * Records that the learner is here (#187): called when a session is made, which is a sign-in, and when one is
 * extended, which happens once a day of use (src/auth.ts). Without the second a learner who never signs out
 * would count as away. The sweep of inactive accounts reads this date and nothing else writes it.
 * A date that cannot be written must not undo the sign-in it follows: the failure is logged, without the
 * account, and the sweep keeps anyone with a session in use whatever their date says (sweep.ts).
 */
export async function recordSignIn(db: Queryable, userId: string | undefined, now: number): Promise<void> {
  if (userId === undefined) return
  try {
    await db.query('update "user" set last_sign_in_at = $2 where id = $1', [userId, new Date(now)])
  } catch (error) {
    console.error('last sign-in not recorded', error instanceof Error ? error.name : 'error')
  }
}
