import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** JSONC to JSON: drops line comments and block comments outside strings, and trailing commas. */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
    } else out += ch
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

interface Prod { d1_databases?: { database_id?: string }[]; vars?: Record<string, string>; routes?: { pattern?: string }[] }

/** What still stops a production deploy (spec 2026-10-05 §14). */
export function checkProductionConfig(jsonc: string): string[] {
  const prod = ((parseJsonc(jsonc) as { env?: { production?: Prod } }).env?.production ?? {}) as Prod
  const problems: string[] = []
  const id = prod.d1_databases?.[0]?.database_id ?? ''
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id) || id === '') problems.push('env.production d1_databases[0].database_id is still the placeholder (review-app/README.md, "Hosted", step 1)')
  for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID']) {
    if (!prod.vars?.[name]) problems.push(`env.production vars.${name} is empty (review-app/README.md, "Hosted")`)
  }
  for (const name of ['ACCESS_JWKS', 'GITHUB_API_URL', 'ADMIN_EMAIL']) {
    if (prod.vars && name in prod.vars) problems.push(`env.production vars.${name} must not be set: ${name === 'ADMIN_EMAIL' ? 'it is a secret' : 'it is for tests only'}`)
  }
  if (prod.vars?.['APP_ORIGIN'] !== 'https://review.wordado.com') problems.push('env.production vars.APP_ORIGIN must be https://review.wordado.com')
  if (!prod.routes?.some((r) => r.pattern === 'review.wordado.com')) problems.push('env.production routes must include review.wordado.com')
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: tsx scripts/check-config.ts <wrangler.jsonc>')
    process.exit(2)
  }
  const problems = checkProductionConfig(readFileSync(file, 'utf8'))
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(problems.length > 0 ? 1 : 0)
}
