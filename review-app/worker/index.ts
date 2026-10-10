import { createApp, type Deps } from './app'
import type { Env, ScheduledController } from './bindings'
import { runWeekly } from './weekly'

const depsOf = (env: Env): Deps => ({ env, fetch: (input, init) => fetch(input, init), now: () => new Date(), log: (line) => console.log(line), sleep: (ms) => new Promise((done) => setTimeout(done, ms)) })

/** What each cron line of wrangler.jsonc runs. A line that is not here is logged and does nothing. */
export const JOBS: Readonly<Record<string, (deps: Deps) => Promise<unknown>>> = {
  // The weekly feedback mail (spec 2026-10-10 §3.4): Monday 06:00 UTC, and a second try on Tuesday that does nothing after a Monday that worked.
  '0 6 * * 1': runWeekly,
  '0 6 * * 2': runWeekly,
}

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createApp(depsOf(env)).fetch(request)
  },
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const job = JOBS[controller.cron]
    if (!job) {
      console.log(`no job for the cron line ${controller.cron}`)
      return
    }
    await job(depsOf(env))
  },
}
