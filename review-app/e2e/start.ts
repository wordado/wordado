import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reviewFixture } from '../server/fixture'
import { createReviewServer } from '../server/http'

const dir = await reviewFixture()
const settings = join(mkdtempSync(join(tmpdir(), 'home-')), 'review-app.json')
const staticDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
createReviewServer({ dir, staticDir, settings, now: () => new Date().toISOString() }).listen(4180, '127.0.0.1', () => console.log(`fixture ${dir}`))
