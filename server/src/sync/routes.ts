import { parsePushPage, protocolVersionOf } from '@wordado/core'
import type { Context, Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { handlePush } from './push'

/**
 * Checked before the shape: a client from before a protocol bump may send a
 * request this build no longer parses, and must still learn to upgrade
 * rather than be told it is malformed (spec §4.3).
 */
function upgradeRequired(c: Context, deps: ServerDeps, raw: unknown) {
  const version = protocolVersionOf(raw)
  const min = deps.config.minProtocolVersion
  return version !== null && version < min ? c.json({ status: 'upgrade_required', minProtocolVersion: min }) : null
}

export function syncRoutes(app: Hono<AppEnv>, deps: ServerDeps, user: MiddlewareHandler<AppEnv>): void {
  app.post('/v1/sync/push', user, async (c) => {
    const raw = await readJson(c)
    const upgrade = upgradeRequired(c, deps, raw)
    if (upgrade) return upgrade
    const parsed = parsePushPage(raw)
    if (!parsed.ok) return invalid(c, parsed.errors)
    return c.json(await handlePush(deps, c.get('userId'), parsed.value))
  })
}
