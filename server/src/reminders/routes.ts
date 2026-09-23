import { isValidTzOffset, type Parsed } from '@wordado/core'
import type { Hono, MiddlewareHandler } from 'hono'
import type { ServerDeps } from '../deps'
import { invalid, readJson, type AppEnv } from '../http'
import { currentReminder } from './schedule'
import { isAllowedPushEndpoint } from './sender'
import { REMINDER_LANGUAGES, reminderText, type ReminderLanguage } from './text'

interface SubscriptionInput {
  readonly endpoint: string
  readonly p256dh: string
  readonly auth: string
  readonly reminderMinute: number
  readonly tzOffsetMin: number
  readonly language: ReminderLanguage
  readonly streakNudge: boolean
}

const isKey = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 256

function parseSubscription(raw: unknown): Parsed<SubscriptionInput> {
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['the subscription must be an object'] }
  const r = raw as Record<string, unknown>
  const keys = (typeof r['keys'] === 'object' && r['keys'] !== null ? r['keys'] : {}) as Record<string, unknown>
  const errors: string[] = []
  const { endpoint, reminderMinute, tzOffsetMin, language, streakNudge } = r
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || !isAllowedPushEndpoint(endpoint)) errors.push('endpoint must be a browser push service URL')
  if (!isKey(keys['p256dh']) || !isKey(keys['auth'])) errors.push('keys.p256dh and keys.auth are required')
  if (typeof reminderMinute !== 'number' || !Number.isInteger(reminderMinute) || reminderMinute < 0 || reminderMinute > 1439) {
    errors.push('reminderMinute must be a minute of the day, 0–1439')
  }
  if (typeof tzOffsetMin !== 'number' || !isValidTzOffset(tzOffsetMin)) errors.push('tzOffsetMin must be the minutes to add to UTC')
  if (!(REMINDER_LANGUAGES as readonly unknown[]).includes(language)) errors.push('language must be bg or en')
  if (typeof streakNudge !== 'boolean') errors.push('streakNudge must be true or false')
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      endpoint: endpoint as string,
      p256dh: keys['p256dh'] as string,
      auth: keys['auth'] as string,
      reminderMinute: reminderMinute as number,
      tzOffsetMin: tzOffsetMin as number,
      language: language as ReminderLanguage,
      streakNudge: streakNudge as boolean,
    },
  }
}

export function reminderRoutes(app: Hono<AppEnv>, deps: ServerDeps, user: MiddlewareHandler<AppEnv>): void {
  app.get('/v1/push/public-key', (c) =>
    deps.config.vapid ? c.json({ publicKey: deps.config.vapid.publicKey }) : c.json({ error: 'not_configured' }, 404),
  )

  /**
   * Opting in (spec §8.11). The client sends its current offset each launch,
   * so a change of time zone or of daylight saving follows the learner. A
   * browser that changes hands (sign-out, sign-in) moves to the new learner.
   */
  app.put('/v1/push/subscription', user, async (c) => {
    const parsed = parseSubscription(await readJson(c))
    if (!parsed.ok) return invalid(c, parsed.errors)
    const s = parsed.value
    await deps.db.query(
      `insert into push_subscription (endpoint, user_id, p256dh, auth, reminder_minute, tz_offset_min, language, streak_nudge, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         reminder_minute = excluded.reminder_minute, tz_offset_min = excluded.tz_offset_min, language = excluded.language,
         streak_nudge = excluded.streak_nudge, ignored = 0`,
      [s.endpoint, c.get('userId'), s.p256dh, s.auth, s.reminderMinute, s.tzOffsetMin, s.language, s.streakNudge, deps.now()],
    )
    return c.json({ ok: true })
  })

  app.delete('/v1/push/subscription', user, async (c) => {
    const body = await readJson(c)
    const endpoint = typeof body === 'object' && body !== null ? (body as { endpoint?: unknown }).endpoint : undefined
    if (typeof endpoint !== 'string') return invalid(c, ['endpoint is required'])
    await deps.db.query('delete from push_subscription where endpoint = $1 and user_id = $2', [endpoint, c.get('userId')])
    return c.json({ ok: true })
  })

  /** What the woken service worker shows. `tz` is the device's offset now, in minutes to add to UTC. */
  app.get('/v1/reminder', user, async (c) => {
    const tz = Number(c.req.query('tz'))
    if (!isValidTzOffset(tz)) return invalid(c, ['tz must be the minutes to add to UTC'])
    const language: ReminderLanguage = c.req.query('lang') === 'bg' ? 'bg' : 'en'
    return c.json(reminderText(language, await currentReminder(deps.db, c.get('userId'), deps.now(), tz)))
  })
}
