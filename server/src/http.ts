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

/** ISO 3166-1 alpha-2, as the age gate stores it (spec §11). */
const COUNTRY = /^[A-Z]{2}$/

/**
 * In front of Better Auth's update-user, which stores `country` as any
 * string it is given: only a two-letter country code, or null to clear it.
 */
export function checkUpdateUser(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    let body: unknown
    try {
      body = await c.req.raw.clone().json()
    } catch {
      // Not JSON: Better Auth refuses it itself.
      return next()
    }
    if (typeof body === 'object' && body !== null && 'country' in body) {
      const country = (body as Record<string, unknown>)['country']
      if (country !== null && !(typeof country === 'string' && COUNTRY.test(country))) return invalid(c, ['country is invalid'])
    }
    return next()
  }
}
