import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { accountRoutes } from './account/routes'
import { createAuth } from './auth'
import type { ServerDeps } from './deps'
import { requireUser, type AppEnv } from './http'

/** A sync page of 500 events is about 150 KB. */
export const MAX_BODY_BYTES = 1_000_000

export function createApp(deps: ServerDeps): Hono<AppEnv> {
  const auth = createAuth(deps)
  const user = requireUser(auth)
  const app = new Hono<AppEnv>()

  app.get('/health', async (c) => {
    await deps.db.query('select 1')
    return c.json({ ok: true })
  })
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // JSON bodies already need a CORS preflight cross-site, which this app never
  // grants; csrf() closes the form-post route that needs none.
  app.use('/v1/*', csrf({ origin: [deps.config.baseUrl, ...deps.config.trustedOrigins] }))
  app.use('/v1/*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: (c) => c.json({ error: 'too_large' }, 413) }))

  accountRoutes(app, deps, user)

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((error, c) => {
    // hono/csrf throws HTTPException(403) on a cross-site form post; let it through as-is.
    if (error instanceof HTTPException) return error.getResponse()
    console.error(error)
    return c.json({ error: 'internal' }, 500)
  })
  return app
}
