import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { makeContent } from '@wordado/pipeline/testing/fixture'
import { describe, expect, it } from 'vitest'

const REVIEW_APP = fileURLToPath(new URL('..', import.meta.url))

describe('main (the entry point)', () => {
  it('refuses to start, with a clear message, when pipeline.json has no ai_review block', () => {
    const dir = makeContent()
    const out = spawnSync(process.execPath, ['--import', 'tsx', 'server/main.ts', dir, '--no-open'], { cwd: REVIEW_APP, encoding: 'utf8' })
    expect(out.status).toBe(2)
    expect(out.stderr).toMatch(/ai_review/)
  })
})
