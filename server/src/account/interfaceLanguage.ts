import type { InterfaceLanguage } from '@wordado/core'
import type { Db } from '../db/db'

/**
 * The language the account's interface is in (#199), as the app says it: at sign-in, when the learner changes it,
 * and once from an account that was signed in before the app said it at all. One value an account, so with several
 * devices it is that of the device that said it last. Nothing else is kept beside it, neither when nor from which
 * device. Answers what the account now holds, or null when the account is gone.
 */
export async function setInterfaceLanguage(db: Db, userId: string, language: InterfaceLanguage): Promise<InterfaceLanguage | null> {
  const [row] = await db.query<{ interface_language: InterfaceLanguage }>('update "user" set interface_language = $2 where id = $1 returning interface_language', [userId, language])
  return row?.interface_language ?? null
}
