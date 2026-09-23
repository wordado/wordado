import type { Db } from '../db/db'

/**
 * Erases the account (spec §11). Deleting the user row removes, through
 * `on delete cascade`, every row holding the learner's data: sessions and
 * linked sign-ins, the answer log (append-only, but not exempt from
 * erasure), derived state, documents, devices, push windows and
 * subscriptions. Content reports stay, with `reporter_id` set to null. A
 * pending sign-in code is keyed by address rather than by user, so it is
 * removed by address.
 */
export async function deleteAccount(db: Db, userId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [user] = await tx.query<{ email: string }>('delete from "user" where id = $1 returning email', [userId])
    if (!user) return false
    // Better Auth names them `<purpose>-otp-<email>`.
    await tx.query('delete from verification where right(identifier, char_length($1)) = $1', [`-otp-${user.email}`])
    return true
  })
}
