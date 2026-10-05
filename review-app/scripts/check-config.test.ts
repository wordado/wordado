import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProductionConfig } from './check-config'

const real = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')

describe('checkProductionConfig', () => {
  it('refuses the placeholders the repository ships with', () => {
    const problems = checkProductionConfig(real)
    expect(problems.join('\n')).toMatch(/database_id/)
    expect(problems.join('\n')).toMatch(/ACCESS_AUD/)
    expect(problems.join('\n')).toMatch(/GITHUB_APP_ID/)
  })
  it('passes a filled-in config and refuses ACCESS_JWKS or GITHUB_API_URL in production', () => {
    const filled = real
      .replace(/"database_id": "0{8}-0{4}-0{4}-0{4}-0{12}"(?![\s\S]*"database_id")/, '"database_id": "1b2c3d4e-0000-4000-8000-000000000001"')
      .replace(/("production"[\s\S]*?)"ACCESS_TEAM_DOMAIN": ""/, '$1"ACCESS_TEAM_DOMAIN": "wordado.cloudflareaccess.com"')
      .replace(/("production"[\s\S]*?)"ACCESS_AUD": ""/, '$1"ACCESS_AUD": "abc"')
      .replace(/("production"[\s\S]*?)"GITHUB_APP_ID": ""/, '$1"GITHUB_APP_ID": "123"')
      .replace(/("production"[\s\S]*?)"GITHUB_INSTALLATION_ID": ""/, '$1"GITHUB_INSTALLATION_ID": "456"')
    expect(checkProductionConfig(filled)).toEqual([])
    expect(checkProductionConfig(filled.replace('"MAIL_FROM": "Wordado Review <review@wordado.com>"\n      }', '"MAIL_FROM": "x", "ACCESS_JWKS": "{}"\n      }'))).not.toEqual([])
  })
})
