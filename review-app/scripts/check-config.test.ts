import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProductionConfig } from './check-config'

const real = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')

/** A wrangler config whose production block is `over` on top of a filled-in one. */
function config(over: { database_id?: string; vars?: Record<string, string>; drop?: readonly string[] } = {}): string {
  const vars: Record<string, string> = {
    APP_ORIGIN: 'https://review.wordado.com',
    ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com',
    ACCESS_AUD: 'abc',
    CONTENT_REPO: 'wordado/wordado-content',
    GITHUB_APP_ID: '123',
    GITHUB_INSTALLATION_ID: '456',
    MAIL_FROM: 'Wordado Review <review@wordado.com>',
    ...over.vars,
  }
  for (const name of over.drop ?? []) delete vars[name]
  return JSON.stringify({
    env: {
      production: {
        routes: [{ pattern: 'review.wordado.com', custom_domain: true }],
        d1_databases: [{ binding: 'DB', database_id: over.database_id ?? '1b2c3d4e-0000-4000-8000-000000000001' }],
        vars,
      },
    },
  })
}

describe('checkProductionConfig', () => {
  it('passes the config the repository ships with (JSONC, comments and all)', () => {
    expect(checkProductionConfig(real)).toEqual([])
  })
  it('refuses placeholders', () => {
    const problems = checkProductionConfig(
      config({ database_id: '00000000-0000-0000-0000-000000000000', vars: { ACCESS_TEAM_DOMAIN: '', ACCESS_AUD: '', GITHUB_APP_ID: '', GITHUB_INSTALLATION_ID: '' } }),
    ).join('\n')
    expect(problems).toMatch(/database_id/)
    expect(problems).toMatch(/ACCESS_TEAM_DOMAIN/)
    expect(problems).toMatch(/ACCESS_AUD/)
    expect(problems).toMatch(/GITHUB_APP_ID/)
    expect(problems).toMatch(/GITHUB_INSTALLATION_ID/)
  })
  it('passes a filled-in config and refuses test-only or secret values in production vars', () => {
    expect(checkProductionConfig(config())).toEqual([])
    expect(checkProductionConfig(config({ vars: { ACCESS_JWKS: '{}' } })).join('\n')).toMatch(/ACCESS_JWKS/)
    expect(checkProductionConfig(config({ vars: { GITHUB_API_URL: 'http://127.0.0.1:4182' } })).join('\n')).toMatch(/GITHUB_API_URL/)
    expect(checkProductionConfig(config({ vars: { ADMIN_EMAIL: 'admin@example.com' } })).join('\n')).toMatch(/ADMIN_EMAIL/)
  })
  it('refuses another origin', () => {
    expect(checkProductionConfig(config({ vars: { APP_ORIGIN: 'https://example.com' } })).join('\n')).toMatch(/APP_ORIGIN/)
  })
})
