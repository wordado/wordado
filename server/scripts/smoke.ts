import { spawn } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { SCHEDULER_VERSION, SYNC_PROTOCOL_VERSION } from '@wordado/core'

/**
 * Drives the real Worker under `wrangler dev` (workerd, Hyperdrive's local
 * connection string, the local queue and cron) through one learner's life:
 * sign in by code, push, alias a word so the queue re-derives, pull, run the
 * cron, delete the account. The Node suites prove the logic; this proves the
 * runtime. Run from server/: `pnpm smoke`.
 */
const PORT = 8788
const BASE = `http://localhost:${PORT}`
const EMAIL = `smoke-${Date.now()}@example.com`

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars')

const output: string[] = []
const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT), '--var', `BASE_URL:${BASE}`, '--test-scheduled'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group: `pnpm exec` leaves wrangler and workerd as grandchildren
  // that a signal to pnpm alone does not reach, so stop() signals the whole group.
  detached: true,
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
      process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] ?? 'postgres://wordado:wordado@localhost:54329/wordado',
  },
})
wrangler.stdout.on('data', (chunk) => output.push(String(chunk)))
wrangler.stderr.on('data', (chunk) => output.push(String(chunk)))
const exited = new Promise<void>((resolve) => wrangler.once('exit', () => resolve()))

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function signalGroup(signal: NodeJS.Signals): void {
  try {
    if (wrangler.pid !== undefined) process.kill(-wrangler.pid, signal)
  } catch {
    // The group is already gone.
  }
}

/** Stops wrangler and everything it started, forcibly if it has not exited within 10 seconds. */
async function stop(): Promise<void> {
  signalGroup('SIGTERM')
  const timer = setTimeout(() => signalGroup('SIGKILL'), 10_000)
  await exited
  clearTimeout(timer)
  // workerd may outlive the pnpm process that led the group; make sure nothing is left.
  signalGroup('SIGKILL')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    signalGroup('SIGKILL')
    process.exit(130)
  })
}

async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null)
    if (value !== null) return value
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

let cookie = ''
async function call(method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { origin: BASE, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
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

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const escaped = EMAIL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

try {
  await until('the Worker to answer /health', async () => ((await fetch(`${BASE}/health`)).ok ? true : null))
  let reply = await call('POST', '/api/auth/email-otp/send-verification-otp', { email: EMAIL, type: 'sign-in' })
  check(reply.status === 200, `send code: ${reply.status} ${JSON.stringify(reply.body)}`)
  const code = await until('the sign-in code in the Worker log', async () => new RegExp(`Sign-in code for ${escaped}: (\\d{6})`).exec(output.join(''))?.[1] ?? null, 15_000)
  reply = await call('POST', '/api/auth/sign-in/email-otp', { email: EMAIL, otp: code })
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
      const pull = await call('POST', '/v1/sync/pull', { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'smoke-device', documentsSince: 0 })
      const states = pull.body?.reviewStates ?? []
      return states.length === 1 && states[0].wordId === 'c:hello-1' && states[0].reps === 2 ? true : null
    },
    30_000,
  )

  reply = await call('GET', `/__scheduled?cron=${encodeURIComponent('*/15 * * * *')}`)
  check(reply.status === 200, `cron: ${reply.status} ${JSON.stringify(reply.body)}`)

  reply = await call('DELETE', '/v1/account', { confirm: true })
  check(reply.body?.deleted === true, `delete: ${JSON.stringify(reply.body)}`)
  reply = await call('GET', '/v1/me')
  check(reply.status === 401, `after deletion /v1/me answered ${reply.status}`)
  console.log('smoke: ok')
} catch (error) {
  console.error(output.join('').split('\n').slice(-80).join('\n'))
  console.error('smoke: failed —', error)
  process.exitCode = 1
} finally {
  await stop()
}
