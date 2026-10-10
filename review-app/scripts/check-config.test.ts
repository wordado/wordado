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
    expect(checkProductionConfig(config({ vars: { ADMIN_EMAIL: 'admin@example.com' } })).join('\n')).toMatch(/ADMIN_EMAIL must not be set: it is a secret/)
    expect(checkProductionConfig(config({ vars: { FEEDBACK_READ_TOKEN: 't'.repeat(40) } })).join('\n')).toMatch(/FEEDBACK_READ_TOKEN must not be set: it is a secret/)
  })
  it('takes the learner app’s server as an https origin, or none at all', () => {
    expect(checkProductionConfig(config({ vars: { LEARNER_APP_URL: 'https://app.example.com' } }))).toEqual([])
    expect(checkProductionConfig(config({ vars: { LEARNER_APP_URL: '' } }))).toEqual([])
    for (const bad of ['http://app.example.com', 'https://app.example.com/', 'https://app.example.com/v1', 'app.example.com']) {
      expect(checkProductionConfig(config({ vars: { LEARNER_APP_URL: bad } })).join('\n')).toMatch(/LEARNER_APP_URL/)
    }
  })
  it('refuses the AI help’s key in production vars, and an address of its service that is not https', () => {
    expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_KEY: 'k'.repeat(40) } })).join('\n')).toMatch(/FEEDBACK_AI_KEY must not be set: it is a secret/)
    for (const good of ['https://openrouter.ai/api/v1', 'https://ai.example.com', 'https://ai.example.com:8443/v1']) expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_URL: good } }))).toEqual([])
    for (const bad of ['', 'http://127.0.0.1:4184', 'http://ai.example.com/v1', 'ai.example.com/v1', 'https://ai.example.com/v1/', 'https://ai.example.com/v1?key=1', 'https://user:pass@ai.example.com/v1', 'https://ai.example.com/v1/chat/completions']) {
      expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_URL: bad } })).join('\n')).toMatch(/FEEDBACK_AI_URL must be an https address/)
    }
  })
  it('takes the AI help’s sign-in as key or google-service-account, and nothing else', () => {
    for (const good of ['key', 'google-service-account']) expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_AUTH: good, FEEDBACK_AI_URL: 'https://aiplatform.eu.rep.googleapis.com/v1/projects/a-project/locations/eu/endpoints/openapi' } }))).toEqual([])
    for (const bad of ['', 'google', 'Key', 'service-account', ' key']) expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_AUTH: bad } })).join('\n')).toMatch(/FEEDBACK_AI_AUTH must be key or google-service-account/)
  })
  it('takes, with a Google service account, an https address on googleapis.com and no other', () => {
    const google = (url?: string) => checkProductionConfig(config({ vars: { FEEDBACK_AI_AUTH: 'google-service-account', ...(url === undefined ? {} : { FEEDBACK_AI_URL: url }) } }))
    for (const good of [
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/a-project/locations/eu/endpoints/openapi',
      'https://europe-west1-aiplatform.googleapis.com/v1/projects/a-project/locations/europe-west1/endpoints/openapi',
      'https://aiplatform.googleapis.com/v1/projects/a-project/locations/global/endpoints/openapi',
    ]) expect(google(good)).toEqual([])
    for (const bad of [
      'https://openrouter.ai/api/v1',
      'https://ai.example.com/v1',
      'https://googleapis.com.example.com/v1/projects/p/locations/eu/endpoints/openapi',
      'https://example.com/aiplatform.eu.rep.googleapis.com',
      'https://notgoogleapis.com/v1',
      'https://aiplatform.eu.rep.googleapis.com:8443/v1',
      'http://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/endpoints/openapi',
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/endpoints/openapi/',
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/endpoints/openapi/chat/completions',
      'https://aiplatform.eu.rep.googleapis.com/v1/projects/p/locations/eu/endpoints/openapi?key=1',
      'http://127.0.0.1:4184',
      '',
    ]) expect(google(bad).join('\n')).toMatch(/FEEDBACK_AI_URL must be an https address on googleapis\.com/)
    // There is no default to fall back to: the address must be written.
    expect(google().join('\n')).toMatch(/FEEDBACK_AI_URL must be an https address on googleapis\.com/)
    // By key, the rules are as they were: any https address, and none at all is the default.
    expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_AUTH: 'key', FEEDBACK_AI_URL: 'https://ai.example.com/v1' } }))).toEqual([])
    expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_AUTH: 'key' } }))).toEqual([])
  })
  it('takes the AI help’s limit as digits and its languages as two-letter codes with commas, or neither at all', () => {
    expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_MODEL: 'test/model', FEEDBACK_AI_DAILY_CALLS: '200', FEEDBACK_READS: 'en,bg' } }))).toEqual([])
    expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_DAILY_CALLS: '0', FEEDBACK_READS: 'en' } }))).toEqual([])
    for (const bad of ['', 'many', '-1', '1.5', '2 00']) expect(checkProductionConfig(config({ vars: { FEEDBACK_AI_DAILY_CALLS: bad } })).join('\n')).toMatch(/FEEDBACK_AI_DAILY_CALLS/)
    for (const bad of ['', 'english', 'en, bg', 'en;bg', 'EN', 'en,']) expect(checkProductionConfig(config({ vars: { FEEDBACK_READS: bad } })).join('\n')).toMatch(/FEEDBACK_READS/)
  })
  it('refuses another origin', () => {
    expect(checkProductionConfig(config({ vars: { APP_ORIGIN: 'https://example.com' } })).join('\n')).toMatch(/APP_ORIGIN/)
  })
})
