import type { Context, MiddlewareHandler } from 'hono'
import type { Auth } from './auth'

export type AppEnv = { Variables: { userId: string } }

/**
 * Resolves the session cookie to a user, or answers 401 (spec §8.6). Once a
 * day of use Better Auth extends the session and sends a new cookie; it is
 * passed on, or the browser's cookie would still lapse after 60 days.
 */
export function requireUser(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { headers, response: session } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
    if (!session) return c.json({ error: 'unauthorized' }, 401)
    c.set('userId', session.user.id)
    await next()
    for (const cookie of headers.getSetCookie()) c.res.headers.append('set-cookie', cookie)
  }
}

/**
 * For a route anyone may call (feedback, spec §8.12): the session's user when
 * there is one, and no `userId` otherwise. A refreshed cookie is passed on as
 * requireUser does.
 */
export function optionalUser(auth: Auth): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const { headers, response: session } = await auth.api.getSession({ headers: c.req.raw.headers, returnHeaders: true })
    if (session) c.set('userId', session.user.id)
    await next()
    for (const cookie of headers.getSetCookie()) c.res.headers.append('set-cookie', cookie)
  }
}

/** The learner a client means to sync, sent beside the session cookie. */
export const EXPECTED_USER_HEADER = 'x-wordado-user'

/**
 * After requireUser: a client that names the learner it means to sync or
 * subscribe for is refused when the cookie belongs to someone else, so one
 * learner's answers never land in another's account. A request without the
 * header (an older client) is let through.
 */
export function sameUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const expected = c.req.header(EXPECTED_USER_HEADER)
    if (expected !== undefined && expected !== c.get('userId')) return c.json({ error: 'wrong_user' }, 409)
    await next()
  }
}

/** The request's JSON body; `undefined` when it is not JSON, which every caller answers with 400. */
export async function readJson(c: Context): Promise<unknown> {
  if (!/^application\/json\b/i.test(c.req.header('content-type') ?? '')) return undefined
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

export function invalid(c: Context, errors: readonly string[]) {
  return c.json({ error: 'invalid', errors: errors.slice(0, 20) }, 400)
}

