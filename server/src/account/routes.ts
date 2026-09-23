import type { Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import type { AppEnv } from '../http'

export function accountRoutes(app: Hono<AppEnv>, deps: ServerDeps, user: MiddlewareHandler<AppEnv>): void {
  app.get('/v1/me', user, async (c) => {
    const [row] = await deps.db.query<{ id: string; email: string; country: string | null; created_at: Date }>(
      'select id, email, country, "createdAt" as created_at from "user" where id = $1',
      [c.get('userId')],
    )
    if (!row) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ userId: row.id, email: row.email, country: row.country, createdAt: row.created_at.getTime() })
  })

  /** Cloudflare's reading of the request's country, to pre-fill sign-up (spec §11). XX is unknown, T1 is Tor. */
  app.get('/v1/country', (c) => {
    const country = c.req.header('cf-ipcountry')
    const known = country !== undefined && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1'
    return c.json({ country: known ? country : null })
  })
}
