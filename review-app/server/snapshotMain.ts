import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildSnapshot } from './snapshot'

const argv = process.argv.slice(2)
const commitAt = argv.indexOf('--commit')
const commitArg = commitAt >= 0 ? argv[commitAt + 1] : undefined
const [contentArg, outArg] = argv.filter((a, i) => !a.startsWith('--') && i !== commitAt + 1)
if (!contentArg || !outArg || !existsSync(join(resolve(contentArg), 'pipeline.json'))) {
  console.error('usage: pnpm --filter @wordado/review-app snapshot <content-dir> <out-dir> [--commit <sha>]')
  process.exit(2)
}
const dir = resolve(contentArg)
const commit = commitArg ?? execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const index = buildSnapshot(dir, resolve(outArg), { commit, built: new Date().toISOString() })
for (const q of index.queues) {
  const rows = q.files.reduce((n, f) => n + f.rows, 0)
  const flagged = q.files.reduce((n, f) => n + f.flagged, 0)
  console.log(`${q.queue}: ${q.files.length} files, ${rows} rows, ${flagged} flagged`)
}
console.log(`snapshot ${index.id}`)
