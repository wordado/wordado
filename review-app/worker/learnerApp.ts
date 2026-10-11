import { ANNOUNCEMENT_LANGUAGES, FEEDBACK_KINDS, isAnnouncementKind, isAnnouncementLanguage, validateAnnouncementTexts, type AnnouncementKind, type AnnouncementLanguage, type AnnouncementTexts, type FeedbackItem, type FeedbackKind } from '@wordado/core'
import type { AccountFound, AccountStats, AccountSweep, Announcement, AnnouncementHeld, AnnouncementLimits, AnnouncementPreview, AnnouncementStatus } from '../shared/hosted'
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
async function askAccounts(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, path: 'lookup' | 'delete' | 'sweep' | 'stats', body?: unknown): Promise<Record<string, unknown>> {
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

/** The counts of accounts and their use (#206), field by field: anything else the server may send is not passed on. */
export async function readAccountStats(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource): Promise<AccountStats> {
  const { readAt, accounts, made7, made30, studied7, studied30, newsGiven, newsWithdrawn, newsNone, reminders } = await askAccounts(deps, source, 'stats')
  if (!isTime(readAt) || !isCount(accounts) || !isCount(made7) || !isCount(made30) || !isCount(studied7) || !isCount(studied30) || !isCount(newsGiven) || !isCount(newsWithdrawn) || !isCount(newsNone) || !isCount(reminders)) throw unfit(deps)
  return { readAt, accounts, made7, made30, studied7, studied30, newsGiven, newsWithdrawn, newsNone, reminders }
}

/** The learner app's server did not do what was asked of an announcement (#185): `message` is for the page, and
 * holds nothing of the request. `status` is what the page is answered with. */
export class AnnouncementsUnanswered extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 502 = 502) {
    super(message)
  }
}

/** What the server's refusals mean, in words for the page. `changed` is said with the new count. */
const ANNOUNCEMENT_REFUSALS: Readonly<Record<string, string>> = {
  not_draft: 'This announcement is no longer a draft: its sending has started, and it cannot be changed, tested or sent again.',
  not_sending: 'This announcement is not being sent.',
  not_stopped: 'This announcement is not stopped.',
  stale: 'The announcement was changed after this page read it. Nothing was done. Open it again.',
  untested: 'This version has not been sent as a test yet. Send a test first.',
  nobody: 'No account would get this announcement. Nothing was sent.',
}

function unfitAnnouncements(deps: Pick<Deps, 'log'>): AnnouncementsUnanswered {
  deps.log('announcements: the answer of the app’s server was not what was asked for')
  return new AnnouncementsUnanswered('The app’s server gave an answer the review app does not understand.')
}

/** One request to the announcements routes, with the token that changes things: the same server and the same
 * token as the accounts (accountsSource). The address of a test send is only ever in the body; the log has the
 * status and nothing else. */
async function askAnnouncements(deps: Pick<Deps, 'fetch' | 'log'>, source: FeedbackSource, path: '' | 'save' | 'delete' | 'preview' | 'test' | 'send' | 'stop' | 'resume', body?: unknown): Promise<Record<string, unknown>> {
  let res: Response
  try {
    // A redirect is not followed: the token goes to the server it was made for and nowhere else.
    res = await deps.fetch(`${source.url.replace(/\/+$/, '')}/v1/admin/announcements${path === '' ? '' : `/${path}`}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: `Bearer ${source.token}`, accept: 'application/json', ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    deps.log(`announcements: the app's server was not reached: ${err instanceof Error ? err.name : 'error'}`)
    throw new AnnouncementsUnanswered('The app’s server could not be reached.')
  }
  const answer: unknown = await res.json().catch(() => null)
  const fields = typeof answer === 'object' && answer !== null && !Array.isArray(answer) ? (answer as Record<string, unknown>) : null
  if (res.status === 200) {
    if (fields === null) throw unfitAnnouncements(deps)
    return fields
  }
  const error = typeof fields?.['error'] === 'string' ? fields['error'] : ''
  if (res.status === 409) {
    const now = fields?.['recipients']
    if (error === 'changed' && isCount(now)) throw new AnnouncementsUnanswered(`The number of accounts has changed: it would now go to ${now.toLocaleString('en')}. Nothing was sent. Read the count again and confirm it.`, 409)
    throw new AnnouncementsUnanswered(ANNOUNCEMENT_REFUSALS[error] ?? 'The app’s server refused: the announcement is not in the state this needs.', 409)
  }
  // To a wrong token the server is a route that does not exist; the list is what meets that first.
  if (res.status === 404 && path !== '') throw new AnnouncementsUnanswered('The app’s server has no such announcement.', 404)
  if (res.status === 502 && error === 'mail_not_sent') {
    const reason = fields?.['reason']
    throw new AnnouncementsUnanswered(`The test was not sent: the mail service did not take it (${reason === 'refused' || reason === 'busy' || reason === 'quota' ? reason : 'no answer'}). Nothing was marked as tested.`)
  }
  deps.log(`announcements: the app's server answered ${res.status}`)
  if (res.status === 400) throw new AnnouncementsUnanswered('The app’s server did not take the request as it was written.', 400)
  throw new AnnouncementsUnanswered(`The app’s server answered ${res.status}.${res.status === 404 ? ' Check that ADMIN_WRITE_TOKEN is the same in both deployments, and that the app’s server has announcements.' : ''}`)
}

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const isTimeOrNull = (v: unknown): v is number | null => v === null || isTime(v)
const STATUSES: readonly AnnouncementStatus[] = ['draft', 'sending', 'stopped', 'sent']
const HELD: readonly AnnouncementHeld[] = ['day', 'quota', 'busy']

/** One announcement as the server sent it, field by field: anything else it may send is not passed on. */
function announcementOf(raw: unknown): Announcement | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { id, kind, texts, version, testedVersion, status, createdAt, startedAt, stoppedAt, finishedAt, held, recipients, sent, failed, skipped, queued } = raw as Record<string, unknown>
  const checked = validateAnnouncementTexts(texts)
  if (!isId(id) || !isAnnouncementKind(kind) || !checked.ok || !isId(version) || !(testedVersion === null || isId(testedVersion))) return null
  if (!(STATUSES as readonly unknown[]).includes(status) || !isTime(createdAt) || !isTimeOrNull(startedAt) || !isTimeOrNull(stoppedAt) || !isTimeOrNull(finishedAt)) return null
  if (!isCount(recipients) || !isCount(sent) || !isCount(failed) || !isCount(skipped) || !isCount(queued)) return null
  let heldBy: Announcement['held'] = null
  if (held !== null) {
    const { reason, at } = (typeof held === 'object' ? held : {}) as Record<string, unknown>
    if (!(HELD as readonly unknown[]).includes(reason) || !isTime(at)) return null
    heldBy = { reason: reason as AnnouncementHeld, at }
  }
  return { id, kind, texts: checked.texts, version, testedVersion, status: status as AnnouncementStatus, createdAt, startedAt, stoppedAt, finishedAt, held: heldBy, recipients, sent, failed, skipped, queued }
}

/** The announcement in an answer, or the failure that it was none. */
function changedAnnouncement(deps: Pick<Deps, 'log'>, answer: Record<string, unknown>): Announcement {
  const announcement = announcementOf(answer['announcement'])
  if (announcement === null) throw unfitAnnouncements(deps)
  return announcement
}

type Asking = Pick<Deps, 'fetch' | 'log'>

/** The announcements, newest first, and the limits a send works under. */
export async function readAnnouncements(deps: Asking, source: FeedbackSource): Promise<{ announcements: Announcement[]; limits: AnnouncementLimits }> {
  const { announcements, limits } = await askAnnouncements(deps, source, '')
  const list = Array.isArray(announcements) ? announcements.map(announcementOf) : null
  const { perDay, sentToday, batch } = (typeof limits === 'object' && limits !== null ? limits : {}) as Record<string, unknown>
  if (list === null || list.includes(null) || !isCount(perDay) || !isCount(sentToday) || !isCount(batch)) throw unfitAnnouncements(deps)
  return { announcements: list as Announcement[], limits: { perDay, sentToday, batch } }
}

/** Writes a draft, or changes the one `id` names. */
export async function saveAnnouncement(deps: Asking, source: FeedbackSource, draft: { id: number | null; kind: AnnouncementKind; texts: AnnouncementTexts }): Promise<Announcement> {
  return changedAnnouncement(deps, await askAnnouncements(deps, source, 'save', { ...(draft.id === null ? {} : { id: draft.id }), kind: draft.kind, texts: draft.texts }))
}

export async function deleteAnnouncement(deps: Asking, source: FeedbackSource, id: number): Promise<void> {
  const { deleted } = await askAnnouncements(deps, source, 'delete', { id })
  if (deleted !== true) throw unfitAnnouncements(deps)
}

/** Each language as it would be mailed, and how many accounts would get which. */
export async function previewAnnouncement(deps: Asking, source: FeedbackSource, id: number): Promise<AnnouncementPreview> {
  const { version, kind, recipients, byLanguage, mails } = await askAnnouncements(deps, source, 'preview', { id })
  const counts: Partial<Record<AnnouncementLanguage, number>> = {}
  const given = (typeof byLanguage === 'object' && byLanguage !== null ? byLanguage : {}) as Record<string, unknown>
  for (const language of ANNOUNCEMENT_LANGUAGES) {
    const n = given[language]
    if (n !== undefined && !isCount(n)) throw unfitAnnouncements(deps)
    if (isCount(n)) counts[language] = n
  }
  const texts = Array.isArray(mails)
    ? mails.map((mail: unknown) => {
        const { language, subject, text } = (typeof mail === 'object' && mail !== null ? mail : {}) as Record<string, unknown>
        return isAnnouncementLanguage(language) && isText(subject) && isText(text) ? { language, subject, text } : null
      })
    : null
  if (!isId(version) || !isAnnouncementKind(kind) || !isCount(recipients) || texts === null || texts.includes(null)) throw unfitAnnouncements(deps)
  return { version, kind, recipients, byLanguage: counts, mails: texts as AnnouncementPreview['mails'] }
}

/** The test send of one version to one address; answers the announcement, now tested, and how many mails went. */
export async function testAnnouncement(deps: Asking, source: FeedbackSource, test: { id: number; version: number; email: string }): Promise<{ announcement: Announcement; mails: number }> {
  const answer = await askAnnouncements(deps, source, 'test', test)
  if (!isCount(answer['mails'])) throw unfitAnnouncements(deps)
  return { announcement: changedAnnouncement(deps, answer), mails: answer['mails'] }
}

/** Starts the send, with what the owner confirmed. */
export async function sendAnnouncement(deps: Asking, source: FeedbackSource, confirmed: { id: number; version: number; kind: AnnouncementKind; recipients: number }): Promise<Announcement> {
  return changedAnnouncement(deps, await askAnnouncements(deps, source, 'send', confirmed))
}

export async function stopAnnouncement(deps: Asking, source: FeedbackSource, id: number): Promise<Announcement> {
  return changedAnnouncement(deps, await askAnnouncements(deps, source, 'stop', { id }))
}

export async function resumeAnnouncement(deps: Asking, source: FeedbackSource, id: number): Promise<Announcement> {
  return changedAnnouncement(deps, await askAnnouncements(deps, source, 'resume', { id }))
}
