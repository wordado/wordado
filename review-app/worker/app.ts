import { Hono, type Context } from 'hono'
import { accessKeys, verifyAccessJwt } from './access'
import type { Env } from './bindings'
import { getReviewer, insertReviewer, type ReviewerRow } from './db'
import { decisionRoutes } from './routes/decision'
import { meRoutes } from './routes/me'
import { reviewerRoutes } from './routes/reviewer'

export interface Deps {
  readonly env: Env
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
  readonly now: () => Date
  readonly log: (line: string) => void
}

export type AppEnv = { Variables: { me: ReviewerRow } }

/** A request body the client got wrong; answered 400. */
export class BadBody extends Error {}

export async function jsonBody<T>(c: Context): Promise<T> {
  let parsed: unknown
  try {
    parsed = await c.req.json()
  } catch {
    throw new BadBody('the request body is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadBody('the request body is not valid JSON')
  return parsed as T
}

export const apiError = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 410 | 415 | 503, message: string) => c.json({ message }, status)

/** Paths that are not called by the browser and so carry no Origin or Access token (GitHub's webhook). */
const MACHINE_PATHS = new Set(['/api/github/webhook'])

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.onError((err, c) => {
    if (err instanceof BadBody) return apiError(c, 400, err.message)
    deps.log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    return c.json({ message: 'internal error' }, 500)
  })
  // Spec §6.2: in place of the local Host check, a state-changing request must come from the app's own origin.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && !MACHINE_PATHS.has(c.req.path)) {
      if (c.req.header('origin') !== deps.env.APP_ORIGIN) return apiError(c, 403, 'bad origin')
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) return apiError(c, 415, 'a request with a body needs content-type: application/json')
    }
    await next()
  })
  // Every /api/* request except MACHINE_PATHS must carry a valid Cloudflare Access token for an invited reviewer.
  app.use('/api/*', async (c, next) => {
    if (MACHINE_PATHS.has(c.req.path)) return next()
    const token = c.req.header('cf-access-jwt-assertion') ?? ''
    const who = await verifyAccessJwt(token, { aud: deps.env.ACCESS_AUD, issuer: `https://${deps.env.ACCESS_TEAM_DOMAIN}`, keys: accessKeys(deps), now: deps.now() })
    if (!who) return apiError(c, 401, 'sign in again')
    let me = await getReviewer(deps.env.DB, who.email)
    // The first admin (spec §5) is created on their first request.
    if (!me && who.email === deps.env.ADMIN_EMAIL.toLowerCase()) {
      me = { email: who.email, name: 'Coordinator', languages: ['bg', 'de', 'es', 'en'], role: 'admin', invitedAt: deps.now().toISOString(), inviteSentAt: null, disabledAt: null }
      await insertReviewer(deps.env.DB, me)
    }
    if (!me || me.disabledAt) return apiError(c, 403, 'This address has no invitation. Ask the coordinator for one.')
    c.set('me', me)
    await next()
  })
  meRoutes(app)
  reviewerRoutes(app, deps)
  decisionRoutes(app, deps)
  // Routes added by later tasks are registered before this catch-all; keep the catch-all last.
  app.all('/api/*', (c) => apiError(c, 404, 'no such API'))
  return app
}
