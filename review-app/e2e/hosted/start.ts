import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { reviewFixture } from '../../server/fixture'
import { buildSnapshot } from '../../server/snapshot'
import { CURRENT_KEY } from '../../shared/snapshot'
import type { D1Database, R2Bucket } from '../../worker/bindings'
import { FakeGitHub, testAppKey } from '../../worker/test/fakeGitHub'
import { FakeLearnerApp } from '../../worker/test/fakeLearnerApp'
import { FakeModel } from '../../worker/test/fakeModel'
import { testKeys } from '../../worker/test/jwt'
import { migrate } from '../../worker/test/platform'
import { FEEDBACK, standInAnswer } from './feedbackFixture'

const root = join(import.meta.dirname, '..', '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const TEAM = 'e2e.example.com'
const AUD = 'e2e-aud'

const content = await reviewFixture()
const snap = mkdtempSync(join(tmpdir(), 'snap-'))
buildSnapshot(content, snap, { commit: 'e2e0000aaaa', built: new Date().toISOString() })

// Local D1 and R2 in the same directory wrangler dev will use: `--persist-to <state>` keeps them under
// <state>/v3, while getPlatformProxy uses its persist path as is, so the proxy is pointed at <state>/v3.
const state = mkdtempSync(join(tmpdir(), 'review-state-'))
const proxy = await getPlatformProxy<{ DB: D1Database; SNAPSHOTS: R2Bucket }>({ configPath: join(root, 'wrangler.jsonc'), persist: { path: join(state, 'v3') } })
await migrate(proxy.env.DB)
for (const p of walk(snap).filter((p) => !p.endsWith(CURRENT_KEY))) await proxy.env.SNAPSHOTS.put(relative(snap, p), readFileSync(p, 'utf8'))
await proxy.env.SNAPSHOTS.put(CURRENT_KEY, readFileSync(join(snap, CURRENT_KEY), 'utf8'))
await proxy.env.DB.prepare("INSERT INTO reviewers (email, name, languages, role, invited_at) VALUES ('reviewer@example.com', 'Rita', '[\"bg\",\"en\"]', 'reviewer', '2026-10-05T00:00:00Z')").run()
await proxy.env.DB.prepare("INSERT INTO reviewers (email, name, languages, role, invited_at) VALUES ('hans@example.com', 'Hans', '[\"de\",\"bg\"]', 'reviewer', '2026-10-05T00:00:00Z')").run()
await proxy.env.DB.prepare("INSERT INTO assignments (reviewer, queue, files, flagged_only, created_at) VALUES ('reviewer@example.com', 'translation-bg', '*', 1, '2026-10-05T00:00:00Z')").run()
// The phone run has a reviewer and a queue of its own, so the two browser projects can run side by side.
await proxy.env.DB.prepare("INSERT INTO reviewers (email, name, languages, role, invited_at) VALUES ('phone@example.com', 'Petra', '[\"en\"]', 'reviewer', '2026-10-05T00:00:00Z')").run()
await proxy.env.DB.prepare("INSERT INTO assignments (reviewer, queue, files, flagged_only, created_at) VALUES ('phone@example.com', 'level', '*', 0, '2026-10-05T00:00:00Z')").run()
await proxy.dispose()

// The fake GitHub: main holds the fixture's review files.
const files = Object.fromEntries(walk(join(content, 'review')).map((p) => [relative(content, p), readFileSync(p, 'utf8')]))
const gh = new FakeGitHub(files)
createServer((req, res) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (req.url === '/_state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ pulls: gh.pulls, branches: [...gh.branches.keys()] }))
      return
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    const out = await gh.fetch(`https://x${req.url}`, { method: req.method ?? 'GET', headers, ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}) })
    res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'text/plain' })
    res.end(await out.text())
  })()
}).listen(4182, '127.0.0.1')

// The fake learner app server: the feedback the Feedback tab reads (feedbackFixture.ts).
const FEEDBACK_TOKEN = 'e2e-feedback-read-token-0123456789abcdef'
const learnerApp = new FakeLearnerApp(FEEDBACK_TOKEN, [...FEEDBACK])
createServer((req, res) => {
  void (async () => {
    // What the review app has asked of it, for the test of the timed job.
    if (req.url === '/_state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ requests: learnerApp.requests }))
      return
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    const out = await learnerApp.fetch(`http://127.0.0.1:4183${req.url}`, { method: req.method ?? 'GET', headers })
    res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'text/plain' })
    res.end(await out.text())
  })()
}).listen(4183, '127.0.0.1')

// The stand-in model, for the AI help on the Feedback tab: it answers what feedbackFixture.ts wrote down for each
// message, and keeps what it was sent, so the browser run can look at it. No model is ever asked.
const MODEL_KEY = 'e2e-model-key'
const model = new FakeModel(MODEL_KEY)
model.answer = standInAnswer
createServer((req, res) => {
  void (async () => {
    if (req.url === '/_state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ requests: model.requests.map((r) => ({ url: r.url, body: r.body })) }))
      return
    }
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    const out = await model.fetch(`http://127.0.0.1:4184${req.url}`, { method: req.method ?? 'GET', headers, body: Buffer.concat(chunks).toString('utf8') })
    res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'text/plain' })
    res.end(await out.text())
  })()
}).listen(4184, '127.0.0.1')

const keys = await testKeys()
const env = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM }
mkdirSync(join(root, '.e2e'), { recursive: true })
const people = { admin: 'admin@example.com', reviewer: 'reviewer@example.com', phone: 'phone@example.com', hans: 'hans@example.com' }
const tokens: Record<string, string> = {}
for (const [who, email] of Object.entries(people)) tokens[who] = await keys.token(email, env)
writeFileSync(join(root, '.e2e', 'tokens.json'), JSON.stringify(tokens))

const vars = {
  ACCESS_JWKS: keys.jwks, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAIL: 'admin@example.com',
  GITHUB_API_URL: 'http://127.0.0.1:4182', GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '1', GITHUB_APP_PRIVATE_KEY: (await testAppKey()).pem,
  APP_ORIGIN: 'http://127.0.0.1:4181',
  LEARNER_APP_URL: 'http://127.0.0.1:4183', FEEDBACK_READ_TOKEN: FEEDBACK_TOKEN,
  FEEDBACK_AI_URL: 'http://127.0.0.1:4184', FEEDBACK_AI_KEY: MODEL_KEY,
}
spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', '4181', '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: root, stdio: 'inherit' })
