import { SCHEDULER_VERSION, SYNC_PAGE_SIZE, SYNC_PROTOCOL_VERSION } from '@wordado/core'

export interface SmokeOptions {
  /** Where the Worker answers: `http://localhost:8788` locally, the preview's origin remotely. */
  readonly base: string
  /** The newest sign-in code the Worker printed for `email` (plan 5's console mailer). */
  readCode(email: string): Promise<string>
  /** Only `wrangler dev --test-scheduled` has /__scheduled; a deployment's cron runs on its own. */
  readonly runCron: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null)
    if (value !== null) return value
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** The code printed for `email` in `output()`, waiting for it to appear. */
export function codeIn(output: () => string, email: string, timeoutMs = 15_000): Promise<string> {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return until('the sign-in code in the Worker log', async () => new RegExp(`Sign-in code for ${escaped}: (\\d{6})`).exec(output())?.[1] ?? null, timeoutMs)
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * One learner's life against a running Worker: sign in by code, push, alias a
 * word so the queue re-derives, pull, push a full page (the heaviest request a
 * learner makes: spec §4.4 has it exercised on the preview before merge), run
 * the cron where possible, delete the account. Throws on the first failure.
 */
export async function runSmoke(options: SmokeOptions): Promise<void> {
  const { base } = options
  const email = `smoke-${Date.now()}@example.com`
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { origin: base, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const setCookie = response.headers.getSetCookie()
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
    const text = await response.text()
    try {
      return { status: response.status, body: JSON.parse(text) }
    } catch {
      return { status: response.status, body: text }
    }
  }
  const now = Date.now()
  const event = (seq: number, wordId: string, clientTs: number) => ({
    reviewId: `smoke-${now}-${seq}`,
    wordId,
    mode: 'multiple_choice',
    direction: 'en_to_l1',
    grade: 3,
    latencyMs: 1500,
    practice: false,
    clientTs,
    clientTzOffsetMin: 0,
    deviceId: 'smoke-device',
    deviceSeq: seq,
    schedulerVersion: SCHEDULER_VERSION,
  })
  const page = (pushId: string, events: unknown[], documents: unknown[] = []) => ({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    pushId,
    clientNow: Date.now(),
    deviceId: 'smoke-device',
    page: 0,
    lastPage: true,
    events,
    dayComplete: [],
    documents,
  })
  const pull = () => call('POST', '/v1/sync/pull', { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'smoke-device', documentsSince: 0 })

  await until('the Worker to answer /health', async () => ((await fetch(`${base}/health`)).ok ? true : null))
  let reply = await call('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
  check(reply.status === 200, `send code: ${reply.status} ${JSON.stringify(reply.body)}`)
  reply = await call('POST', '/api/auth/sign-in/email-otp', { email, otp: await options.readCode(email) })
  check(reply.status === 200 && cookie !== '', `sign in: ${reply.status}`)

  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-1`, [event(1, 'c:hello-1', now - 120_000), event(2, 'u:smoke-mine', now - 60_000)]))
  check(reply.body?.status === 'ok', `push: ${JSON.stringify(reply.body)}`)
  // An alias marks the learner stale and queues a re-derivation (spec §6.1, §4.4).
  const alias = { type: 'word_alias', key: 'u:smoke-mine', patch: { baseVersion: 0, fields: { target: 'c:hello-1' } } }
  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-2`, [], [alias]))
  check(reply.body?.status === 'ok' && reply.body.rejected.length === 0, `alias: ${JSON.stringify(reply.body)}`)
  await until(
    'the queue to merge the aliased word',
    async () => {
      const states = (await pull()).body?.reviewStates ?? []
      return states.length === 1 && states[0].wordId === 'c:hello-1' && states[0].reps === 2 ? true : null
    },
    30_000,
  )

  // A full page over 100 words, answered after everything above, then a pull of them all.
  const start = Date.now() - 50_000
  const full = Array.from({ length: SYNC_PAGE_SIZE }, (_, i) => event(1_000 + i, `c:smoke-${i % 100}`, start + i * 100))
  let timer = Date.now()
  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-full`, full))
  check(reply.status === 200 && reply.body?.status === 'ok', `full page: ${reply.status} ${JSON.stringify(reply.body).slice(0, 300)}`)
  console.log(`smoke: a ${SYNC_PAGE_SIZE}-event page took ${Date.now() - timer} ms`)
  timer = Date.now()
  reply = await pull()
  check(reply.status === 200 && (reply.body?.reviewStates ?? []).length === 101, `pull after the full page: ${reply.status} ${(reply.body?.reviewStates ?? []).length} states`)
  console.log(`smoke: a pull of 101 words took ${Date.now() - timer} ms`)

  if (options.runCron) {
    reply = await call('GET', `/__scheduled?cron=${encodeURIComponent('*/15 * * * *')}`)
    check(reply.status === 200, `cron: ${reply.status} ${JSON.stringify(reply.body)}`)
  }

  reply = await call('DELETE', '/v1/account', { confirm: true })
  check(reply.body?.deleted === true, `delete: ${JSON.stringify(reply.body)}`)
  reply = await call('GET', '/v1/me')
  check(reply.status === 401, `after deletion /v1/me answered ${reply.status}`)
}
