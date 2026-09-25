import { writeFileSync } from 'node:fs'
import { workerSecrets } from './secretsFile'

/** Writes the secrets file a deploy uploads (docs/deploy.md). Prints names only, never values. */
const out = process.argv[2]
if (!out) {
  console.error('usage: tsx scripts/write-secrets.ts <out-file>')
  process.exit(2)
}
const secrets = workerSecrets(process.env)
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 })
console.log(`Worker secrets: ${Object.keys(secrets).join(', ')}`)
