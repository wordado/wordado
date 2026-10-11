import { isAnnouncementKind, validateAnnouncementTexts } from '@wordado/core'
import type { Hono } from 'hono'
import { announcementConfirmation, type AnnouncementsView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import {
  AnnouncementsUnanswered,
  accountsSource,
  deleteAnnouncement,
  previewAnnouncement,
  readAnnouncements,
  resumeAnnouncement,
  saveAnnouncement,
  sendAnnouncement,
  stopAnnouncement,
  testAnnouncement,
  type FeedbackSource,
} from '../learnerApp'

const NOT_CONNECTED = 'Announcements are not connected: set ADMIN_WRITE_TOKEN and LEARNER_APP_URL for the review app.'

const isId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 1
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0

/** The one address of a test send: a single address with no space in it. Null when there is none. */
function emailOf(body: Record<string, unknown>): string | null {
  const email = typeof body['email'] === 'string' ? body['email'].trim() : ''
  return /^[^\s@,;<>"]+@[^\s@,;<>"]+$/.test(email) && email.length <= 320 ? email : null
}

/**
 * The Announcements tab (#185): a mail to learners' account holders, written here and sent by the learner app's
 * server, which holds the accounts. Nothing of an announcement is kept here, and these routes run no statement of
 * their own against the database: each passes on the fields it names, and nothing else of the request, with the
 * token that changes things (the Accounts tab's). The address of a test send goes on in the request's body and is
 * never logged. Registered after adminRoutes, so every one is behind the admin-only middleware.
 */
export function announcementsRoutes(app: Hono<AppEnv>, deps: Deps): void {
  type C = Parameters<typeof apiError>[0]
  /** Runs what asks the learner app's server, and answers its failure in words for the page. */
  const asked = async <T>(c: C, ask: (source: FeedbackSource) => Promise<T>): Promise<Response> => {
    const source = accountsSource(deps)
    if (!source) return apiError(c, 503, NOT_CONNECTED)
    try {
      return c.json(await ask(source))
    } catch (err) {
      if (err instanceof AnnouncementsUnanswered) return apiError(c, err.status, err.message)
      throw err
    }
  }
  const NEEDS_ID = 'id must be the number of an announcement'

  /** What there is, newest first, with the limits a send works under. */
  app.get('/api/admin/announcements', async (c) => {
    if (!accountsSource(deps)) return c.json({ connected: false } satisfies AnnouncementsView)
    return asked(c, async (source) => ({ connected: true, ...(await readAnnouncements(deps, source)) }) satisfies AnnouncementsView)
  })

  /** Writes a draft (`{kind, texts}`) or changes one (`{id, kind, texts}`). The texts are checked here as the server checks them. */
  app.post('/api/admin/announcements/save', async (c) => {
    const { id, kind, texts } = await jsonBody<Record<string, unknown>>(c)
    if (id !== undefined && !isId(id)) return apiError(c, 400, NEEDS_ID)
    if (!isAnnouncementKind(kind)) return apiError(c, 400, 'kind must be service or news')
    const checked = validateAnnouncementTexts(texts)
    if (!checked.ok) return apiError(c, 400, checked.errors.join('; '))
    return asked(c, async (source) => ({ announcement: await saveAnnouncement(deps, source, { id: id ?? null, kind, texts: checked.texts }) }))
  })

  app.post('/api/admin/announcements/delete', async (c) => {
    const { id } = await jsonBody<Record<string, unknown>>(c)
    if (!isId(id)) return apiError(c, 400, NEEDS_ID)
    return asked(c, async (source) => {
      await deleteAnnouncement(deps, source, id)
      return { deleted: true }
    })
  })

  app.post('/api/admin/announcements/preview', async (c) => {
    const { id } = await jsonBody<Record<string, unknown>>(c)
    if (!isId(id)) return apiError(c, 400, NEEDS_ID)
    return asked(c, (source) => previewAnnouncement(deps, source, id))
  })

  /** The test send of one version to one address. Until it went, that version cannot be sent. */
  app.post('/api/admin/announcements/test', async (c) => {
    const body = await jsonBody<Record<string, unknown>>(c)
    const { id, version } = body
    const email = emailOf(body)
    if (!isId(id) || !isId(version)) return apiError(c, 400, 'id and version must be the numbers of an announcement and of the version read')
    if (email === null) return apiError(c, 400, 'email must be one whole address')
    return asked(c, async (source) => {
      const sent = await testAnnouncement(deps, source, { id, version, email })
      deps.log(`announcements: ${sent.mails} test mail${sent.mails === 1 ? '' : 's'} sent`)
      return sent
    })
  })

  /**
   * Starts the send. `confirm` is what the owner typed: the kind and the number of accounts, as the page showed
   * them. It is checked here, so a request that was not typed out starts nothing; the server then checks the
   * version, the kind and the number against what it has now.
   */
  app.post('/api/admin/announcements/send', async (c) => {
    const { id, version, kind, recipients, confirm } = await jsonBody<Record<string, unknown>>(c)
    if (!isId(id) || !isId(version) || !isAnnouncementKind(kind) || !isCount(recipients)) return apiError(c, 400, 'id, version, kind and recipients must be those of the announcement as it was shown')
    if (confirm !== announcementConfirmation(kind, recipients)) return apiError(c, 400, `To send, type the kind and the number of accounts as shown: ${announcementConfirmation(kind, recipients)}`)
    return asked(c, async (source) => {
      const announcement = await sendAnnouncement(deps, source, { id, version, kind, recipients })
      deps.log(`announcements: sending of a ${announcement.kind} announcement to ${announcement.recipients} account(s) started`)
      return { announcement }
    })
  })

  app.post('/api/admin/announcements/stop', async (c) => {
    const { id } = await jsonBody<Record<string, unknown>>(c)
    if (!isId(id)) return apiError(c, 400, NEEDS_ID)
    return asked(c, async (source) => ({ announcement: await stopAnnouncement(deps, source, id) }))
  })

  app.post('/api/admin/announcements/resume', async (c) => {
    const { id } = await jsonBody<Record<string, unknown>>(c)
    if (!isId(id)) return apiError(c, 400, NEEDS_ID)
    return asked(c, async (source) => ({ announcement: await resumeAnnouncement(deps, source, id) }))
  })
}
