import { FEEDBACK_KINDS, type FeedbackItem, type FeedbackKind } from '@wordado/core'
import type { AccountFound, AccountSweep } from '../shared/hosted'
import type { Deps } from './app'

/** How long the learner app's server has to answer. */
const TIMEOUT_MS = 10_000

export interface FeedbackSource { readonly url: string; readonly token: string }

/** The learner app's server and the token it answers to, or null while either setting is missing (spec §16). */
export function feedbackSource(deps: Pick<Deps, 'env'>): FeedbackSource | null {
  const url = (deps.env.LEARNER_APP_URL ?? '').trim()
  const token = (deps.env.FEEDBACK_READ_TOKEN ?? '').trim()
  return url === '' || token === '' ? null : { url, token }
}

/** The learner app's server did not give the feedback: `message` is for the page, and holds nothing of the request. */
export class FeedbackUnread extends Error {}

const isText = (v: unknown): v is string => typeof v === 'string'

/** One message as the server sent it, field by field: anything else it may send is not passed on. */
function itemOf(raw: unknown): FeedbackItem | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  const { id, receivedAt, kind, message, contactEmail, signedIn, appVersion, corpusVersion, language, screen, userAgent } = r
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || typeof receivedAt !== 'number' || typeof signedIn !== 'boolean') return null
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(kind)) return null
  if (!isText(message) || !isText(contactEmail) || !isText(appVersion) || !isText(corpusVersion) || !isText(language) || !isText(screen) || !isText(userAgent)) return null
  return { id, receivedAt, kind: kind as FeedbackKind, message, contactEmail, signedIn, appVersion, corpusVersion, language, screen, userAgent }
}

/** What is asked of the server: how many messages, and optionally of one kind, older than an id, received at or after
 * a moment (epoch ms), or the messages of some ids alone (1 to 100 of them). */
export interface FeedbackQuery { readonly limit: number; readonly kind?: FeedbackKind | null; readonly before?: number | null; readonly since?: number | null; readonly ids?: readonly number[] | null }

/**
 * One page of feedback from the learner app's server, newest first: a single request, with the shared token.
 * Asked by `ids`, a message that was not asked for is dropped and counted in `others`: a server from before `ids`
 * ignores the parameter and gives its newest page, so with `others` above 0 (or a `nextBefore`) what is missing
 * from `items` may only be unread, not gone.
 */
export async function readFeedback(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, q: FeedbackQuery): Promise<{ items: FeedbackItem[]; nextBefore: number | null; others: number }> {
  const query = new URLSearchParams({ limit: String(q.limit) })
  if (q.kind) query.set('kind', q.kind)
  if (typeof q.before === 'number') query.set('before', String(q.before))
  if (typeof q.since === 'number') query.set('since', String(q.since))
  if (q.ids) query.set('ids', q.ids.join(','))
  let res: Response
  try {
    // A redirect is not followed: the token goes to the server it was made for and nowhere else.
    res = await deps.fetch(`${source.url.replace(/\/+$/, '')}/v1/admin/feedback?${query.toString()}`, {
      headers: { authorization: `Bearer ${source.token}`, accept: 'application/json' },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    deps.log(`feedback: the app's server was not reached: ${err instanceof Error ? err.name : 'error'}`)
    throw new FeedbackUnread('The app’s server could not be reached.')
  }
  if (res.status !== 200) {
    deps.log(`feedback: the app's server answered ${res.status}`)
    // To a wrong token the server is a route that does not exist.
    throw new FeedbackUnread(`The app’s server answered ${res.status}.${res.status === 404 ? ' Check that FEEDBACK_READ_TOKEN is the same in both deployments.' : ''}`)
  }
  const body = (await res.json().catch(() => null)) as { items?: unknown; nextBefore?: unknown } | null
  const items = Array.isArray(body?.items) ? body.items.map(itemOf) : null
  const next = body?.nextBefore ?? null
  if (items === null || items.includes(null) || (next !== null && (typeof next !== 'number' || !Number.isSafeInteger(next) || next < 1))) {
    deps.log('feedback: the answer of the app’s server was not a page of feedback')
    throw new FeedbackUnread('The app’s server gave an answer the review app does not understand.')
  }
  const given = items as FeedbackItem[]
  const asked = q.ids ? new Set(q.ids) : null
  const kept = asked ? given.filter((item) => asked.has(item.id)) : given
  return { items: kept, nextBefore: next, others: given.length - kept.length }
}

/** The learner app's server and the token its accounts routes answer to (#187), or null while either setting is
 * missing. Not the token that reads feedback: what can read learners' messages cannot delete an account. */
export function accountsSource(deps: Pick<Deps, 'env'>): FeedbackSource | null {
  const url = (deps.env.LEARNER_APP_URL ?? '').trim()
  const token = (deps.env.ADMIN_WRITE_TOKEN ?? '').trim()
  return url === '' || token === '' ? null : { url, token }
}

/** The learner app's server did not do what was asked of an account: `message` is for the page, and holds nothing
 * of the request. `status` is what the page is answered with. */
export class AccountsUnanswered extends Error {
  constructor(message: string, readonly status: 409 | 502 = 502) {
    super(message)
  }
}

/** One request to the accounts routes: the token in a header, an address only ever in the body. The log has the
 * status and nothing else, since the address is in neither. */
async function askAccounts(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, path: 'lookup' | 'delete' | 'sweep', body?: unknown): Promise<Record<string, unknown>> {
  let res: Response
  try {
    // A redirect is not followed: the token goes to the server it was made for and nowhere else.
    res = await deps.fetch(`${source.url.replace(/\/+$/, '')}/v1/admin/accounts/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${source.token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    deps.log(`accounts: the app's server was not reached: ${err instanceof Error ? err.name : 'error'}`)
    throw new AccountsUnanswered('The app’s server could not be reached.')
  }
  if (res.status === 409) throw new AccountsUnanswered('Two accounts answer to this address, and the app’s server cannot tell which is meant. Nothing was deleted.', 409)
  if (res.status !== 200) {
    deps.log(`accounts: the app's server answered ${res.status}`)
    // To a wrong token the server is a route that does not exist.
    throw new AccountsUnanswered(`The app’s server answered ${res.status}.${res.status === 404 ? ' Check that ADMIN_WRITE_TOKEN is the same in both deployments.' : ''}`)
  }
  const answer: unknown = await res.json().catch(() => null)
  if (typeof answer !== 'object' || answer === null || Array.isArray(answer)) throw unfit(deps)
  return answer as Record<string, unknown>
}

function unfit(deps: Pick<Deps, 'log'>): AccountsUnanswered {
  deps.log('accounts: the answer of the app’s server was not what was asked for')
  return new AccountsUnanswered('The app’s server gave an answer the review app does not understand.')
}

const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const isCount = isTime

/** The account an address names, field by field: anything else the server may send is not passed on. */
export async function lookUpAccount(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, email: string): Promise<AccountFound> {
  const { found, createdAt, lastSignInAt } = await askAccounts(deps, source, 'lookup', { email })
  if (found === false) return { found: false }
  if (found !== true || !isTime(createdAt) || (lastSignInAt !== null && !isTime(lastSignInAt))) throw unfit(deps)
  return { found: true, createdAt, lastSignInAt }
}

/** Deletes the account an address names, as the learner's own deletion does; false when there was none. */
export async function deleteLearnerAccount(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, email: string): Promise<boolean> {
  const { deleted } = await askAccounts(deps, source, 'delete', { email, confirm: true })
  if (typeof deleted !== 'boolean') throw unfit(deps)
  return deleted
}

/** The counts of the sweep of inactive accounts. */
export async function readAccountSweep(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource): Promise<AccountSweep> {
  const { months, batch, due, undated, taken, lastRunAt, lastTaken } = await askAccounts(deps, source, 'sweep')
  if (!isCount(months) || !isCount(batch) || !isCount(due) || !isCount(undated) || !isCount(taken) || !isCount(lastTaken) || (lastRunAt !== null && !isTime(lastRunAt))) throw unfit(deps)
  return { months, batch, due, undated, taken, lastRunAt, lastTaken }
}
