import { ANNOUNCEMENT_LANGUAGES, isAnnouncementKind, validateAnnouncementTexts, type AnnouncementKind, type FeedbackItem, type FeedbackPage } from '@wordado/core'
import type { AccountDetails, AccountSeries, AccountSplits, AccountStats, AccountSweep, Announcement, AnnouncementLimits } from '../../shared/hosted'

/** A message with every field filled in; `over` names what a test cares about. */
export function feedbackItem(id: number, over: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id,
    receivedAt: Date.parse('2026-10-05T09:00:00Z') + id * 60_000,
    kind: 'bug',
    message: `message ${id}`,
    contactEmail: '',
    signedIn: false,
    appVersion: 'B3kq9xZa',
    corpusVersion: 'bg 6',
    language: 'bg',
    screen: '/path',
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    ...over,
  }
}

/** The learner app server's `GET /v1/admin/feedback`, in memory (spec §13): the token, the pages and the `kind`, `since` and `ids` filters as the real route has them.
 * With a `writeToken` it has that server's `/v1/admin/accounts/*` too (#187), which answer to that token alone, and
 * its `/v1/admin/announcements*` (#185): drafts, the test send, and a send that goes when `runSend` is called. */
export class FakeLearnerApp {
  /** Every request made, as `METHOD path?query`. */
  readonly requests: string[] = []
  /** Set, every request gets this instead: a status with a body, or an error thrown as when the server is not reached. */
  failure: { status: number; body: string } | Error | null = null
  /** False: a server from before `ids`, which ignores the parameter and gives its newest page. */
  knowsIds = true
  /** What the accounts routes answer to; null, they are routes that do not exist. */
  writeToken: string | null = null
  /** The accounts, by address in small letters: when each was made and last signed in, and how it is used (#209).
   * One without `details` is answered about as a server from before them does. */
  readonly accounts = new Map<string, { createdAt: number; lastSignInAt: number | null; details?: AccountDetails }>()
  /** Addresses two accounts answer to: asked about one, the server answers 409. */
  readonly ambiguous = new Set<string>()
  /** What the sweep's counts are. */
  sweep: AccountSweep = { months: 24, batch: 50, due: 0, undated: 0, taken: 0, lastRunAt: null, lastTaken: 0 }
  /** What the counts of accounts and their use are (#206). */
  stats: AccountStats = { readAt: 0, accounts: 0, made7: 0, made30: 0, studied7: 0, studied30: 0, newsGiven: 0, newsWithdrawn: 0, newsNone: 0, reminders: 0 }
  /** What is behind those counts (#209); null, a server from before it had them: the routes do not exist. */
  series: AccountSeries | null = null
  splits: AccountSplits | null = null
  /** The bodies the accounts routes were sent, in order. */
  readonly bodies: unknown[] = []
  /** The announcements, oldest first. */
  announcements: Announcement[] = []
  /** How many accounts an announcement of each kind would go to. */
  recipients: Record<AnnouncementKind, number> = { service: 3, news: 1 }
  limits: AnnouncementLimits = { perDay: 50, sentToday: 0, batch: 20 }
  /** Every test send asked for: the address is here and nowhere in an announcement. */
  readonly testSends: { id: number; version: number; email: string }[] = []
  /** Set, the mailer does not take a test send. */
  mailRefused = false
  /** The clock of the announcements. */
  now = Date.parse('2026-10-12T09:00:00Z')

  /** What the cron's step would do: sends up to `mails` waiting mails of the announcements being sent. */
  runSend(mails = this.limits.batch): void {
    this.announcements = this.announcements.map((a) => {
      if (a.status !== 'sending') return a
      const went = Math.min(a.queued, mails)
      mails -= went
      const queued = a.queued - went
      return { ...a, sent: a.sent + went, queued, ...(queued === 0 ? { status: 'sent' as const, finishedAt: this.now } : {}) }
    })
  }

  private announcement(path: string, body: Record<string, unknown>, json: (v: unknown, status?: number) => Response): Response {
    this.bodies.push(body)
    const { id, kind, texts, version, email, recipients } = body
    const at = this.announcements.findIndex((a) => a.id === id)
    const found = this.announcements[at]
    const put = (next: Announcement) => {
      this.announcements = this.announcements.map((a) => (a.id === next.id ? next : a))
      return json({ announcement: next })
    }
    if (path === 'save') {
      const checked = validateAnnouncementTexts(texts)
      if (!checked.ok || !isAnnouncementKind(kind)) return json({ error: 'invalid', errors: checked.ok ? ['kind must be service or news'] : checked.errors }, 400)
      if (id === undefined) {
        const made: Announcement = {
          id: Math.max(0, ...this.announcements.map((a) => a.id)) + 1, kind, texts: checked.texts, version: 1, testedVersion: null, status: 'draft', createdAt: this.now,
          startedAt: null, stoppedAt: null, finishedAt: null, held: null, recipients: 0, sent: 0, failed: 0, skipped: 0, queued: 0,
        }
        this.announcements.push(made)
        return json({ announcement: made })
      }
      if (!found) return json({ error: 'not_found' }, 404)
      if (found.status !== 'draft') return json({ error: 'not_draft' }, 409)
      return put({ ...found, kind, texts: checked.texts, version: found.version + 1 })
    }
    if (!found) return json({ error: 'not_found' }, 404)
    if (path === 'delete') {
      if (found.status !== 'draft') return json({ error: 'not_draft' }, 409)
      this.announcements = this.announcements.filter((a) => a.id !== id)
      return json({ deleted: true })
    }
    if (path === 'preview') {
      const why = found.kind === 'news' ? 'You are receiving this because you agreed to news about Wordado by email. To stop it, open: https://app.test/v1/news/unsubscribe?t=test' : 'You are receiving this notice because you have a Wordado account.'
      const mails = ANNOUNCEMENT_LANGUAGES.filter((l) => found.texts[l]).map((language) => ({ language, subject: found.texts[language]!.subject, text: `${found.texts[language]!.body}\n\n-- \n${why}` }))
      return json({ version: found.version, kind: found.kind, recipients: this.recipients[found.kind], byLanguage: { en: this.recipients[found.kind] }, mails })
    }
    if (path === 'test') {
      if (typeof email !== 'string' || !email.includes('@') || typeof version !== 'number') return json({ error: 'invalid', errors: [] }, 400)
      if (found.status !== 'draft') return json({ error: 'not_draft' }, 409)
      if (found.version !== version) return json({ error: 'stale' }, 409)
      if (this.mailRefused) return json({ error: 'mail_not_sent', reason: 'busy' }, 502)
      this.testSends.push({ id: found.id, version, email })
      const mails = ANNOUNCEMENT_LANGUAGES.filter((l) => found.texts[l]).length
      this.limits = { ...this.limits, sentToday: this.limits.sentToday + mails }
      const next = { ...found, testedVersion: version }
      this.announcements = this.announcements.map((a) => (a.id === next.id ? next : a))
      return json({ announcement: next, mails })
    }
    if (path === 'send') {
      if (typeof version !== 'number' || !isAnnouncementKind(kind) || typeof recipients !== 'number') return json({ error: 'invalid', errors: [] }, 400)
      if (found.status !== 'draft') return json({ error: 'not_draft' }, 409)
      if (found.version !== version || found.kind !== kind) return json({ error: 'stale' }, 409)
      if (found.testedVersion !== found.version) return json({ error: 'untested' }, 409)
      const now = this.recipients[found.kind]
      if (now !== recipients) return json({ error: 'changed', recipients: now }, 409)
      if (now === 0) return json({ error: 'nobody' }, 409)
      return put({ ...found, status: 'sending', startedAt: this.now, recipients: now, queued: now })
    }
    if (path === 'stop') return found.status === 'sending' ? put({ ...found, status: 'stopped', stoppedAt: this.now, held: null }) : json({ error: 'not_sending' }, 409)
    if (path === 'resume') return found.status === 'stopped' ? put({ ...found, status: 'sending', stoppedAt: null }) : json({ error: 'not_stopped' }, 409)
    return json({ error: 'not_found' }, 404)
  }
  constructor(readonly token: string, public items: FeedbackItem[] = []) {}

  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    this.requests.push(`${method} ${url.pathname}${url.search}`)
    if (this.failure instanceof Error) throw this.failure
    if (this.failure) return new Response(this.failure.body, { status: this.failure.status })
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const authorization = new Headers(init.headers).get('authorization')
    if (url.pathname === '/v1/admin/announcements' || url.pathname.startsWith('/v1/admin/announcements/')) {
      if (this.writeToken === null || authorization !== `Bearer ${this.writeToken}`) return json({ error: 'not_found' }, 404)
      // Newest first, with a field the review app has no use for, as a server may come to have.
      if (method === 'GET' && url.pathname === '/v1/admin/announcements') return json({ announcements: [...this.announcements].reverse().map((a) => ({ ...a, updatedAt: this.now })), limits: this.limits })
      if (method !== 'POST' || !(new Headers(init.headers).get('content-type') ?? '').startsWith('application/json')) return json({ error: 'not_found' }, 404)
      return this.announcement(url.pathname.slice('/v1/admin/announcements/'.length), JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<string, unknown>, json)
    }
    if (url.pathname.startsWith('/v1/admin/accounts/')) {
      if (this.writeToken === null || authorization !== `Bearer ${this.writeToken}`) return json({ error: 'not_found' }, 404)
      const what = url.pathname.slice('/v1/admin/accounts/'.length)
      if (method === 'GET' && what === 'sweep') return json(this.sweep)
      if (method === 'GET' && what === 'stats') return json(this.stats)
      if (method === 'GET' && what === 'series' && this.series) return json(this.series)
      if (method === 'GET' && what === 'splits' && this.splits) return json(this.splits)
      if (method !== 'POST' || (what !== 'lookup' && what !== 'delete') || !(new Headers(init.headers).get('content-type') ?? '').startsWith('application/json')) return json({ error: 'not_found' }, 404)
      const body = JSON.parse(typeof init.body === 'string' ? init.body : '{}') as { email?: unknown; confirm?: unknown }
      this.bodies.push(body)
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
      if (!email.includes('@') || (what === 'delete' && body.confirm !== true)) return json({ error: 'invalid', errors: [] }, 400)
      if (this.ambiguous.has(email)) return json({ error: 'ambiguous' }, 409)
      const account = this.accounts.get(email)
      if (what === 'lookup') return json(account ? { found: true, ...account } : { found: false })
      return json({ deleted: this.accounts.delete(email) })
    }
    if (method !== 'GET' || url.pathname !== '/v1/admin/feedback' || authorization !== `Bearer ${this.token}`) return json({ error: 'not_found' }, 404)
    const limit = Number(url.searchParams.get('limit') ?? '50')
    const before = url.searchParams.get('before')
    const kind = url.searchParams.get('kind')
    const since = url.searchParams.get('since')
    const asked = this.knowsIds ? url.searchParams.get('ids') : null
    if (asked !== null && !/^[1-9]\d{0,14}(,[1-9]\d{0,14}){0,99}$/.test(asked)) return json({ error: 'invalid', errors: ['ids must be 1 to 100 message ids'] }, 400)
    const ids = asked === null ? null : asked.split(',').map(Number)
    const found = this.items
      .filter((item) => (before === null || item.id < Number(before)) && (kind === null || item.kind === kind) && (since === null || item.receivedAt >= Number(since)) && (ids === null || ids.includes(item.id)))
      .sort((a, b) => b.id - a.id)
    const items = found.slice(0, limit)
    return json({ items, nextBefore: found.length > limit ? items.at(-1)!.id : null } satisfies FeedbackPage)
  }
}
