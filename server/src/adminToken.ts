import type { MiddlewareHandler } from 'hono'
import type { ServerDeps } from './deps'
import type { AppEnv } from './http'

const sha256 = async (text: string): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))

/**
 * Whether a request carries the token, compared in constant time: both sides
 * are hashed first, so neither the time taken nor the length compared says
 * anything about the token.
 */
export async function hasBearerToken(token: string, authorization: string | undefined): Promise<boolean> {
  const given = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]
  if (given === undefined) return false
  const [want, got] = await Promise.all([sha256(token), sha256(given)])
  let diff = 0
  for (let i = 0; i < want.length; i += 1) diff |= want[i]! ^ got[i]!
  return diff === 0
}

/**
 * For the routes with which the review app's server changes something here (#187): they answer only to
 * `ADMIN_WRITE_TOKEN`, a secret apart from the one that reads feedback, so that what can read learners'
 * messages cannot delete an account. Without the secret, or to a request without the token, they are routes
 * that do not exist.
 */
export function requireAdminWriteToken(deps: ServerDeps): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = deps.config.adminWriteToken
    if (token === null || !(await hasBearerToken(token, c.req.header('authorization')))) return c.notFound()
    await next()
  }
}
