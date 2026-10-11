import type { Hono } from 'hono'
import type { AccountSeriesView, AccountSplitsView, AccountStatsView, AccountSweepView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { AccountsUnanswered, accountsSource, deleteLearnerAccount, lookUpAccount, readAccountSeries, readAccountSplits, readAccountStats, readAccountSweep } from '../learnerApp'

const NOT_CONNECTED = 'Accounts are not connected: set ADMIN_WRITE_TOKEN and LEARNER_APP_URL for the review app.'

/** The address in a request's body as an account has it: the whole of it, in small letters. Null when there is none. */
function emailOf(body: Record<string, unknown>): string | null {
  const email = typeof body['email'] === 'string' ? body['email'].trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+$/.test(email) && email.length <= 320 ? email : null
}

/**
 * The Accounts tab (#187): the provider's own handling of learners' accounts, which live on the learner app's
 * server. Nothing of an account is kept here, and these routes run no statement of their own against the database.
 * An address is sent on in a request's body and is never logged. Registered after adminRoutes, so all of them are
 * behind the admin-only middleware.
 */
export function accountsRoutes(app: Hono<AppEnv>, deps: Deps): void {
  /** Runs what asks the learner app's server, and answers its failure in words for the page. */
  const asked = async <T>(c: Parameters<typeof apiError>[0], ask: () => Promise<T>): Promise<Response> => {
    try {
      return c.json(await ask())
    } catch (err) {
      if (err instanceof AccountsUnanswered) return apiError(c, err.status, err.message)
      throw err
    }
  }

  /** How many accounts the sweep of inactive accounts would take next, and how many it took. */
  app.get('/api/admin/accounts/sweep', async (c) => {
    const source = accountsSource(deps)
    if (!source) return c.json({ connected: false } satisfies AccountSweepView)
    return asked(c, async () => ({ connected: true, sweep: await readAccountSweep(deps, source) }) satisfies AccountSweepView)
  })

  /** How many accounts there are and how many are used (#206): counts of now, and nothing of an account. */
  app.get('/api/admin/accounts/stats', async (c) => {
    const source = accountsSource(deps)
    if (!source) return c.json({ connected: false } satisfies AccountStatsView)
    return asked(c, async () => ({ connected: true, stats: await readAccountStats(deps, source) }) satisfies AccountStatsView)
  })

  /** What is behind those counts (#209): the accounts by week made and by day studied, and by language. Numbers only. */
  app.get('/api/admin/accounts/series', async (c) => {
    const source = accountsSource(deps)
    if (!source) return c.json({ connected: false } satisfies AccountSeriesView)
    return asked(c, async () => ({ connected: true, series: await readAccountSeries(deps, source) }) satisfies AccountSeriesView)
  })

  app.get('/api/admin/accounts/splits', async (c) => {
    const source = accountsSource(deps)
    if (!source) return c.json({ connected: false } satisfies AccountSplitsView)
    return asked(c, async () => ({ connected: true, splits: await readAccountSplits(deps, source) }) satisfies AccountSplitsView)
  })

  /** The account an address names: when it was made and last signed in, how it is used (#209), and nothing else. */
  app.post('/api/admin/accounts/lookup', async (c) => {
    const email = emailOf(await jsonBody<Record<string, unknown>>(c))
    if (email === null) return apiError(c, 400, 'email must be the whole address of an account')
    const source = accountsSource(deps)
    if (!source) return apiError(c, 503, NOT_CONNECTED)
    return asked(c, () => lookUpAccount(deps, source, email))
  })

  /** Deletes the account an address names, as the learner's own deletion in the app does. `confirm` guards against a stray request. */
  app.post('/api/admin/accounts/delete', async (c) => {
    const body = await jsonBody<Record<string, unknown>>(c)
    const email = emailOf(body)
    if (email === null || body['confirm'] !== true) return apiError(c, 400, 'send the whole address of the account and confirm: true to delete it')
    const source = accountsSource(deps)
    if (!source) return apiError(c, 503, NOT_CONNECTED)
    return asked(c, async () => {
      const deleted = await deleteLearnerAccount(deps, source, email)
      if (deleted) deps.log('accounts: 1 account deleted')
      return { deleted }
    })
  })
}
