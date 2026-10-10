import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import type { D1Database, Env, R2Bucket } from '../bindings'
import type { Deps } from '../app'

const root = join(import.meta.dirname, '..', '..')

/** Runs the migrations, statement by statement, as `wrangler d1 migrations apply` would. */
export async function migrate(db: D1Database): Promise<void> {
  for (const name of readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = readFileSync(join(root, 'migrations', name), 'utf8').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)
    await db.batch(statements.map((s) => db.prepare(s)))
  }
}

export async function resetDb(db: D1Database): Promise<void> {
  await db.batch(['DELETE FROM feedback_marks', 'DELETE FROM decisions', 'DELETE FROM submissions', 'DELETE FROM assignments', 'DELETE FROM reviewers'].map((s) => db.prepare(s)))
}

/** Local D1 and R2 from wrangler.jsonc's top level, in memory, migrated. */
export async function startPlatform(): Promise<{ env: Env; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Database; SNAPSHOTS: R2Bucket }>({ configPath: join(root, 'wrangler.jsonc'), persist: false })
  await migrate(proxy.env.DB)
  const env: Env = {
    DB: proxy.env.DB,
    SNAPSHOTS: proxy.env.SNAPSHOTS,
    APP_ORIGIN: 'https://review.test',
    ACCESS_TEAM_DOMAIN: 'team.example.com',
    ACCESS_AUD: 'aud-test',
    ADMIN_EMAIL: 'admin@example.com',
    CONTENT_REPO: 'wordado/wordado-content',
    GITHUB_APP_ID: '1',
    GITHUB_INSTALLATION_ID: '2',
    MAIL_FROM: 'Wordado Review <review@wordado.com>',
  }
  return { env, dispose: () => proxy.dispose() }
}

export function testDeps(env: Env, overrides: Partial<Deps> = {}): Deps {
  return {
    env,
    fetch: async (input) => new Response(`no fake for ${input}`, { status: 599 }),
    now: () => new Date('2026-10-05T12:00:00Z'),
    log: () => undefined,
    sleep: async () => undefined,
    ...overrides,
  }
}
