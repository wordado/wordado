import type { Db, Queryable } from '../db/db'

/**
 * Erases the account (spec §11). Deleting the user row removes, through
 * `on delete cascade`, every row holding the learner's data: sessions,
 * linked sign-ins and passkeys, the answer log (append-only, but not exempt from
 * erasure), derived state, documents, devices, push windows and
 * subscriptions. Content reports stay, with `reporter_id` set to null. So
 * does feedback about the app (spec §8.12), which names no account (#166); the
 * address given there for an answer is removed. A pending sign-in code and
 * the record of codes sent (src/signInLimit.ts) are keyed by address rather
 * than by user, so they are removed by address.
 */
export async function deleteAccount(db: Db, userId: string): Promise<boolean> {
  return db.transaction((tx) => eraseAccount(tx, userId))
}

/** The same, inside the caller's transaction: for the sweep of inactive accounts (sweep.ts), which counts with it. */
export async function eraseAccount(tx: Queryable, userId: string): Promise<boolean> {
  const [user] = await tx.query<{ email: string }>('delete from "user" where id = $1 returning email', [userId])
  if (!user) return false
  await tx.query(`update feedback set contact_email = '' where lower(contact_email) = $1`, [user.email.toLowerCase()])
  // Better Auth names them `<purpose>-otp-<email>`.
  await tx.query('delete from verification where right(identifier, char_length($1)) = $1', [`-otp-${user.email}`])
  await tx.query('delete from sign_in_code_send where email = $1', [user.email.toLowerCase()])
  return true
}
