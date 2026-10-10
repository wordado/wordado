import { FEEDBACK_KINDS, type FeedbackItem, type FeedbackKind } from '@wordado/core'
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

/** What is asked of the server: how many messages, and optionally of one kind, older than an id, received at or after a moment (epoch ms). */
export interface FeedbackQuery { readonly limit: number; readonly kind?: FeedbackKind | null; readonly before?: number | null; readonly since?: number | null }

/** One page of feedback from the learner app's server, newest first: a single request, with the shared token. */
export async function readFeedback(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, q: FeedbackQuery): Promise<{ items: FeedbackItem[]; nextBefore: number | null }> {
  const query = new URLSearchParams({ limit: String(q.limit) })
  if (q.kind) query.set('kind', q.kind)
  if (typeof q.before === 'number') query.set('before', String(q.before))
  if (typeof q.since === 'number') query.set('since', String(q.since))
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
  return { items: items as FeedbackItem[], nextBefore: next }
}
