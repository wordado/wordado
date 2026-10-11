import { dayToIsoDate, isNewsConsentText, utcDay, type NewsConsent } from '@wordado/core'
import type { Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { deleteAccount } from './deletion'
import { buildExport } from './export'
import { setNewsConsent } from './newsConsent'

export function accountRoutes(
  app: Hono<AppEnv>,
  deps: ServerDeps,
  user: MiddlewareHandler<AppEnv>,
  /** The session user, who must be the one the client names (x-wordado-user): deletion and export act on a whole account. */
  owner: MiddlewareHandler<AppEnv>,
): void {
  app.get('/v1/me', user, async (c) => {
    const [row] = await deps.db.query<{ id: string; email: string; created_at: Date; news_consent: NewsConsent }>(
      'select id, email, "createdAt" as created_at, news_consent from "user" where id = $1',
      [c.get('userId')],
    )
    if (!row) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ userId: row.id, email: row.email, createdAt: row.created_at.getTime(), newsConsent: row.news_consent })
  })

  /** The settings switch for news by email (#186): `{"consent": true, "text": <the wording shown>}` gives it, `{"consent": false}` withdraws it. */
  app.put('/v1/account/news-consent', owner, async (c) => {
    const body = await readJson(c)
    const { consent, text } = (typeof body === 'object' && body !== null ? body : {}) as { consent?: unknown; text?: unknown }
    if (typeof consent !== 'boolean') return invalid(c, ['consent must be true or false'])
    if (consent && !isNewsConsentText(text)) return invalid(c, ['text must name the wording that was shown'])
    const change = consent && isNewsConsentText(text) ? ({ consent: true, text } as const) : ({ consent: false } as const)
    const newsConsent = await setNewsConsent(deps.db, c.get('userId'), change, deps.now())
    if (newsConsent === null) return c.json({ error: 'unauthorized' }, 401)
    return c.json({ newsConsent })
  })

  /** Cloudflare's reading of the request's country, to pre-fill sign-up (spec §11). XX is unknown, T1 is Tor. */
  app.get('/v1/country', (c) => {
    const country = c.req.header('cf-ipcountry')
    const known = country !== undefined && /^[A-Z]{2}$/.test(country) && country !== 'XX' && country !== 'T1'
    return c.json({ country: known ? country : null })
  })

  /** Self-service erasure (spec §11). The body guards against a stray request. */
  app.delete('/v1/account', owner, async (c) => {
    const body = await readJson(c)
    const confirmed = typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === true
    if (!confirmed) return invalid(c, ['send {"confirm": true} to delete the account'])
    await deleteAccount(deps.db, c.get('userId'))
    return c.json({ deleted: true })
  })

  /** The portable copy (spec §11). */
  app.get('/v1/export', owner, async (c) => {
    const now = deps.now()
    const data = await buildExport(deps.db, c.get('userId'), now)
    if (!data) return c.json({ error: 'unauthorized' }, 401)
    c.header('content-disposition', `attachment; filename="wordado-export-${dayToIsoDate(utcDay(now))}.json"`)
    return c.json(data)
  })
}
