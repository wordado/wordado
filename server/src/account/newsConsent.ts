import { isNewsConsentText, type NewsConsent } from '@wordado/core'
import type { MiddlewareHandler } from 'hono'
import type { Db } from '../db/db'
import type { ServerDeps } from '../deps'
import type { AppEnv } from '../http'

/** The body of Better Auth's sign-in: the address as Better Auth stores it, and the wording of a ticked box. */
async function signInOf(request: Request): Promise<{ readonly email: string; readonly text: string } | null> {
  try {
    const body: unknown = await request.clone().json()
    if (typeof body !== 'object' || body === null) return null
    const { email, newsConsent } = body as Record<string, unknown>
    return typeof email === 'string' && isNewsConsentText(newsConsent) ? { email: email.toLowerCase(), text: newsConsent } : null
  } catch {
    return null
  }
}

/**
 * Around Better Auth's sign-in (#186). Sign-in and sign-up are one request, and the first creates the account, so
 * the sign-up checkbox travels with the code as `newsConsent`: the wording the learner ticked, absent when they did
 * not. It is recorded only once the code was right. A ticked box is consent given now, so it counts where none is
 * recorded (a new account, or one from before the question was asked) and after a withdrawal alike; a consent
 * already given keeps its first time and wording. A box left alone changes nothing, whatever is recorded: a sign-in
 * never withdraws. A failure to record must not undo a sign-in that happened, so it is logged; the account is asked
 * again at its next one.
 */
export function newsConsentAtSignIn(deps: ServerDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const signIn = await signInOf(c.req.raw)
    await next()
    if (signIn === null || c.res.status !== 200) return
    try {
      await deps.db.query(
        `update "user" set news_consent = 'given', news_consent_at = to_timestamp($2::double precision / 1000), news_consent_text = $3
         where email = $1 and news_consent <> 'given'`,
        [signIn.email, deps.now(), signIn.text],
      )
    } catch (error) {
      console.error('consent to news not recorded', error)
    }
  }
}

/**
 * The settings switch (#186). Giving records the wording shown; withdrawing keeps it, as what was withdrawn. Asking
 * for what is already so changes nothing, so the first record stands, and where none was given there is nothing to
 * withdraw. Answers the state afterwards, or null when the account is gone.
 */
export async function setNewsConsent(db: Db, userId: string, change: { readonly consent: true; readonly text: string } | { readonly consent: false }, now: number): Promise<NewsConsent | null> {
  if (change.consent) {
    await db.query(
      `update "user" set news_consent = 'given', news_consent_at = to_timestamp($2::double precision / 1000), news_consent_text = $3
       where id = $1 and news_consent <> 'given'`,
      [userId, now, change.text],
    )
  } else {
    await db.query(
      `update "user" set news_consent = 'withdrawn', news_consent_at = to_timestamp($2::double precision / 1000)
       where id = $1 and news_consent = 'given'`,
      [userId, now],
    )
  }
  const [row] = await db.query<{ news_consent: NewsConsent }>('select news_consent from "user" where id = $1', [userId])
  return row?.news_consent ?? null
}
