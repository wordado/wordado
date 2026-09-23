import { Hono, type Context } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { accountRoutes } from './account/routes'
import { createAuth } from './auth'
import type { ServerDeps } from './deps'
import { checkUpdateUser, requireUser, type AppEnv } from './http'
import { reminderRoutes } from './reminders/routes'
import { signInEmailLimit } from './signInLimit'
import { syncRoutes } from './sync/routes'

/** A sync page of 500 events is about 150 KB. */
export const MAX_BODY_BYTES = 1_000_000
/** A sign-in or profile request is a few hundred bytes. */
export const AUTH_MAX_BODY_BYTES = 16_384

export function createApp(deps: ServerDeps): Hono<AppEnv> {
  const auth = createAuth(deps)
  const user = requireUser(auth)
  const app = new Hono<AppEnv>()

  app.get('/health', async (c) => {
    await deps.db.query('select 1')
    return c.json({ ok: true })
  })
  const tooLarge = (c: Context) => c.json({ error: 'too_large' }, 413)
  app.use('/api/auth/*', bodyLimit({ maxSize: AUTH_MAX_BODY_BYTES, onError: tooLarge }))
  app.post('/api/auth/email-otp/send-verification-otp', signInEmailLimit(deps))
  app.post('/api/auth/update-user', checkUpdateUser())
  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw))

  // JSON bodies already need a CORS preflight cross-site, which this app never
  // grants; csrf() closes the form-post route that needs none.
  app.use('/v1/*', csrf({ origin: [deps.config.baseUrl, ...deps.config.trustedOrigins] }))
  app.use('/v1/*', bodyLimit({ maxSize: MAX_BODY_BYTES, onError: tooLarge }))

  accountRoutes(app, deps, user)
  syncRoutes(app, deps, user)
  reminderRoutes(app, deps, user)

  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((error, c) => {
    // hono/csrf throws HTTPException(403) on a cross-site form post; let it through as-is.
    if (error instanceof HTTPException) return error.getResponse()
    console.error(error)
    return c.json({ error: 'internal' }, 500)
  })
  return app
}
