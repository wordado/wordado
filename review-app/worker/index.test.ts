import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseJsonc } from '../scripts/check-config'
import type { Env } from './bindings'
import worker, { JOBS } from './index'

interface Triggers { triggers?: { crons?: string[] } }
const config = parseJsonc(readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')) as Triggers & { env: { production: Triggers } }

afterEach(() => vi.restoreAllMocks())

describe('the timed jobs', () => {
  it('have a job for every cron line of the config, and a cron line for every job, locally and in production', () => {
    const jobs = Object.keys(JOBS).sort()
    expect(jobs.length).toBeGreaterThan(0)
    expect([...(config.triggers?.crons ?? [])].sort()).toEqual(jobs)
    expect([...(config.env.production.triggers?.crons ?? [])].sort()).toEqual(jobs)
  })

  it('run the weekly mail on Monday’s line and on Tuesday’s', async () => {
    const lines: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
    // With nothing set the job stops at once, which is enough to see that it was the one called.
    await worker.scheduled({ cron: '0 6 * * 1', scheduledTime: 0 }, {} as Env)
    await worker.scheduled({ cron: '0 6 * * 2', scheduledTime: 0 }, {} as Env)
    expect(lines).toEqual(Array(2).fill('weekly mail: not connected, LEARNER_APP_URL and FEEDBACK_READ_TOKEN are not both set'))
  })

  it('log a cron line they do not know, and do nothing', async () => {
    const lines: unknown[] = []
    vi.spyOn(console, 'log').mockImplementation((line) => void lines.push(line))
    await expect(worker.scheduled({ cron: '*/5 * * * *', scheduledTime: 0 }, {} as Env)).resolves.toBeUndefined()
    expect(lines).toEqual(['no job for the cron line */5 * * * *'])
  })
})
