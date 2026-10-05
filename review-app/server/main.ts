import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readConfig } from '@wordado/pipeline/config'
import { createReviewServer } from './http'
import { settingsFile } from './settings'

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const dir = resolve(args[0] ?? '')
if (!args[0] || !existsSync(join(dir, 'pipeline.json'))) {
  console.error('usage: pnpm --filter @wordado/review-app review <content-dir>  (a content checkout: it has pipeline.json)')
  process.exit(2)
}
if (!readConfig(dir).ai_review) {
  console.error(`${dir}: pipeline.json has no ai_review block (pipeline/README.md, "AI review")`)
  process.exit(2)
}
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const server = createReviewServer({ dir, staticDir: existsSync(staticDir) ? staticDir : null, settings: settingsFile(), now: () => new Date().toISOString() })
server.listen(Number(process.env['REVIEW_PORT'] ?? 0), '127.0.0.1', () => {
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
  console.log(`review app: ${url} (content: ${dir}); Ctrl-C to stop`)
  if (!process.argv.includes('--no-open')) execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], () => undefined)
})
