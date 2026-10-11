import type { Hono } from 'hono'
import { requireAdminWriteToken } from '../adminToken'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { deleteAccount } from './deletion'
import { accountSweepStatus } from './sweep'

/** The longest address looked for; a longer one is no address. */
const MAX_EMAIL_LENGTH = 320

/** The address in a request's body as an account would have it, or null when the body has none. */
function emailOf(body: unknown): string | null {
  const raw = typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  return email.length >= 3 && email.length <= MAX_EMAIL_LENGTH && email.includes('@') ? email : null
}

interface AccountRow {
  readonly id: string
  readonly created_at: Date
  readonly last_sign_in_at: Date | null
}

/**
 * The provider's own handling of accounts, for the review app's Accounts tab (#187): an erasure asked for by
 * mail, an account closed, and the counts of the sweep. The caller is the review app's server, with
 * `ADMIN_WRITE_TOKEN` (src/adminToken.ts) and no cookie. The address travels in the body, never in the path
 * or the query, which are logged. Nothing is answered about an account beyond when it was made and last
 * signed in, and the log has no address and no id.
 */
export function accountAdminRoutes(app: Hono<AppEnv>, deps: ServerDeps): void {
  const admin = requireAdminWriteToken(deps)

  /** The accounts an address names: the whole address, whatever its capitals. More than one cannot be told apart, and is refused. */
  const find = (email: string): Promise<AccountRow[]> =>
    deps.db.query<AccountRow>('select id, "createdAt" as created_at, last_sign_in_at from "user" where lower(email) = $1 limit 2', [email])

  app.post('/v1/admin/accounts/lookup', admin, async (c) => {
    const email = emailOf(await readJson(c))
    if (email === null) return invalid(c, ['send {"email": "<the whole address>"}'])
    const found = await find(email)
    if (found.length > 1) return c.json({ error: 'ambiguous' }, 409)
    const [row] = found
    c.header('cache-control', 'no-store')
    return c.json(row ? { found: true, createdAt: row.created_at.getTime(), lastSignInAt: row.last_sign_in_at?.getTime() ?? null } : { found: false })
  })

  /** Deletes as the learner's own deletion does (deletion.ts). The body guards against a stray request. */
  app.post('/v1/admin/accounts/delete', admin, async (c) => {
    const body = await readJson(c)
    const email = emailOf(body)
    const confirmed = typeof body === 'object' && body !== null && (body as { confirm?: unknown }).confirm === true
    if (email === null || !confirmed) return invalid(c, ['send {"email": "<the whole address>", "confirm": true} to delete the account'])
    const found = await find(email)
    if (found.length > 1) return c.json({ error: 'ambiguous' }, 409)
    const deleted = found[0] ? await deleteAccount(deps.db, found[0].id) : false
    if (deleted) console.log('admin: 1 account deleted')
    c.header('cache-control', 'no-store')
    return c.json({ deleted })
  })

  app.get('/v1/admin/accounts/sweep', admin, async (c) => {
    c.header('cache-control', 'no-store')
    return c.json(await accountSweepStatus(deps))
  })
}
