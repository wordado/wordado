import { dayToIsoDate, utcDay } from '@wordado/core'
import type { Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { deleteAccount } from './deletion'
import { buildExport } from './export'

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

  /** Self-service erasure (spec §11). The body guards against a stray request. */
  app.delete('/v1/account', user, async (c) => {
    const body = await readJson(c)
    const confirmed = typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === true
    if (!confirmed) return invalid(c, ['send {"confirm": true} to delete the account'])
    await deleteAccount(deps.db, c.get('userId'))
    return c.json({ deleted: true })
  })

  /** The portable copy (spec §11). */
  app.get('/v1/export', user, async (c) => {
    const now = deps.now()
    const data = await buildExport(deps.db, c.get('userId'), now)
    if (!data) return c.json({ error: 'unauthorized' }, 401)
    c.header('content-disposition', `attachment; filename="wordado-export-${dayToIsoDate(utcDay(now))}.json"`)
    return c.json(data)
  })
}
