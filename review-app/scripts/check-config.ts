import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** JSONC to JSON: drops line comments and block comments outside strings, and trailing commas. */
export function parseJsonc(text: string): unknown {
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

/** Settings that are secrets: set with `wrangler secret put`, never written in the config. */
const SECRETS = new Set(['ADMIN_EMAIL', 'FEEDBACK_READ_TOKEN', 'FEEDBACK_AI_KEY'])

/** What still stops a production deploy (spec 2026-10-05 §14). */
export function checkProductionConfig(jsonc: string): string[] {
  const prod = ((parseJsonc(jsonc) as { env?: { production?: Prod } }).env?.production ?? {}) as Prod
  const problems: string[] = []
  const id = prod.d1_databases?.[0]?.database_id ?? ''
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id) || id === '') problems.push('env.production d1_databases[0].database_id is still the placeholder (review-app/README.md, "Hosted", step 1)')
  for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID']) {
    if (!prod.vars?.[name]) problems.push(`env.production vars.${name} is empty (review-app/README.md, "Hosted")`)
  }
  for (const name of ['ACCESS_JWKS', 'GITHUB_API_URL', 'ADMIN_EMAIL', 'FEEDBACK_READ_TOKEN', 'FEEDBACK_AI_KEY']) {
    if (prod.vars && name in prod.vars) problems.push(`env.production vars.${name} must not be set: ${SECRETS.has(name) ? 'it is a secret' : 'it is for tests only'}`)
  }
  // Optional: without it the Feedback tab says it is not connected. The token only ever goes to an https origin.
  const learnerApp = prod.vars?.['LEARNER_APP_URL'] ?? ''
  if (learnerApp !== '' && !/^https:\/\/[a-z0-9.-]+$/.test(learnerApp)) problems.push('env.production vars.LEARNER_APP_URL must be an https origin with no path, such as https://app.wordado.com')
  // The AI help on feedback (spec 2026-10-10): all optional, and the Worker has a default for each. The key and the
  // messages only ever go to an https address; to one written wrong the Worker sends nothing, so a deploy says it.
  const aiUrl = prod.vars?.['FEEDBACK_AI_URL']
  if (aiUrl !== undefined && (!/^https:\/\/[a-z0-9.-]+(:\d+)?(\/[A-Za-z0-9._~/-]*[A-Za-z0-9._~-])?$/.test(aiUrl) || aiUrl.endsWith('/chat/completions'))) {
    problems.push('env.production vars.FEEDBACK_AI_URL must be an https address with no slash at its end and without /chat/completions, such as https://openrouter.ai/api/v1')
  }
  // Written wrong, the Worker would quietly take the default for these two.
  const dailyCalls = prod.vars?.['FEEDBACK_AI_DAILY_CALLS']
  if (dailyCalls !== undefined && !/^\d+$/.test(dailyCalls)) problems.push('env.production vars.FEEDBACK_AI_DAILY_CALLS must be a whole number, such as 200')
  const reads = prod.vars?.['FEEDBACK_READS']
  if (reads !== undefined && !/^[a-z]{2}(,[a-z]{2})*$/.test(reads)) problems.push('env.production vars.FEEDBACK_READS must be two-letter language codes with commas between, such as en,bg')
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
