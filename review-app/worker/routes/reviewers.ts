import type { Hono } from 'hono'
import { LANGUAGES, languageOf, type Language, type ReviewerView, type Role } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { getReviewer, insertReviewer, listReviewers, toReviewerView, updateReviewer, type ReviewerRow } from '../db'
import { reviewMailer } from '../mail'
import { closeAssignmentsWhere } from './admin'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const languagesOf = (v: unknown): Language[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((l) => (LANGUAGES as readonly unknown[]).includes(l)) ? [...new Set(v as Language[])] : null

/** Names go into mail headers, commit authors and pull request titles: no control characters. */
const hasControl = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)
const NAME_CONTROL = 'a name cannot contain control characters such as line breaks or tabs'

export function reviewersRoutes(app: Hono<AppEnv>, deps: Deps): void {
  const mailer = reviewMailer(deps)
  const invite = async (r: ReviewerRow): Promise<boolean> => {
    try {
      await mailer.invite(r.email, r.name, r.languages)
      await updateReviewer(deps.env.DB, r.email, { inviteSentAt: deps.now().toISOString() })
      return true
    } catch (err) {
      deps.log(`invite to ${r.email} not sent: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  app.get('/api/admin/reviewers', async (c) => c.json((await listReviewers(deps.env.DB)).map(toReviewerView)))

  app.post('/api/admin/reviewers', async (c) => {
    const body = await jsonBody<{ email?: unknown; name?: unknown; languages?: unknown; role?: unknown }>(c)
    const email = String(body.email ?? '').trim().toLowerCase()
    if (hasControl(String(body.name ?? ''))) return apiError(c, 400, NAME_CONTROL)
    const name = String(body.name ?? '').trim()
    const languages = languagesOf(body.languages)
    const role: Role = body.role === 'admin' ? 'admin' : 'reviewer'
    if (!EMAIL.test(email)) return apiError(c, 400, 'that is not an email address')
    if (name === '') return apiError(c, 400, 'a name is needed')
    if (!languages) return apiError(c, 400, `pick one or more of ${LANGUAGES.join(', ')}`)
    if (await getReviewer(deps.env.DB, email)) return apiError(c, 409, `${email} is already a reviewer`)
    const r: ReviewerRow = { email, name, languages, role, invitedAt: deps.now().toISOString(), inviteSentAt: null, disabledAt: null }
    await insertReviewer(deps.env.DB, r)
    const inviteSent = await invite(r)
    return c.json({ reviewer: toReviewerView((await getReviewer(deps.env.DB, email))!), inviteSent, link: deps.env.APP_ORIGIN }, 201)
  })

  app.patch('/api/admin/reviewers/:email', async (c) => {
    const r = await getReviewer(deps.env.DB, c.req.param('email'))
    if (!r) return apiError(c, 404, 'no such reviewer')
    const body = await jsonBody<{ name?: unknown; languages?: unknown; role?: unknown; disabled?: unknown }>(c)
    const self = r.email === c.get('me').email
    if (self && (body.disabled === true || body.role === 'reviewer')) return apiError(c, 400, 'you cannot disable or demote yourself')
    const patch: { name?: string; languages?: Language[]; role?: Role; disabledAt?: string | null } = {}
    if (body.name !== undefined) {
      if (hasControl(String(body.name))) return apiError(c, 400, NAME_CONTROL)
      const name = String(body.name).trim()
      if (name === '') return apiError(c, 400, 'a name is needed')
      patch.name = name
    }
    if (body.languages !== undefined) {
      const languages = languagesOf(body.languages)
      if (!languages) return apiError(c, 400, `pick one or more of ${LANGUAGES.join(', ')}`)
      patch.languages = languages
      await closeAssignmentsWhere(deps, r.email, (a) => !languages.includes(languageOf(a.queue)!))
    }
    if (body.role === 'admin' || body.role === 'reviewer') patch.role = body.role
    if (body.disabled === true) {
      patch.disabledAt = deps.now().toISOString()
      await closeAssignmentsWhere(deps, r.email, () => true)
    }
    if (body.disabled === false) patch.disabledAt = null
    await updateReviewer(deps.env.DB, r.email, patch)
    const out: ReviewerView = toReviewerView((await getReviewer(deps.env.DB, r.email))!)
    return c.json(out)
  })

  app.post('/api/admin/reviewers/:email/invite', async (c) => {
    const r = await getReviewer(deps.env.DB, c.req.param('email'))
    if (!r) return apiError(c, 404, 'no such reviewer')
    return c.json({ inviteSent: await invite(r), link: deps.env.APP_ORIGIN })
  })
}
