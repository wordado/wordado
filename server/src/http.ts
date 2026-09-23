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
