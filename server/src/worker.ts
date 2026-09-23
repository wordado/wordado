import { createApp } from './app'
import { configFromEnv, type Env } from './config'
import { createPool, pgDb } from './db/db'
import type { Job, ServerDeps } from './deps'
import { handleJob } from './jobs/rederive'
import { runScheduled } from './jobs/scheduled'
import { consoleMailer, resendMailer } from './mail'
import { webPushSender } from './reminders/sender'

/** The parts of the Workers runtime types the server uses, written by hand like `Env`. */
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
}
interface QueueMessage<T> {
  readonly body: T
  ack(): void
  retry(): void
}
interface MessageBatch<T> {
  readonly messages: readonly QueueMessage<T>[]
}

/**
 * One invocation's dependencies. The pool is made per invocation and closed
 * after it, as Cloudflare documents for Hyperdrive: connections cannot be
 * shared across requests.
 */
function depsFor(env: Env, ctx: ExecutionContext): ServerDeps {
  const config = configFromEnv(env)
  const now = () => Date.now()
  return {
    db: pgDb(createPool(env.HYPERDRIVE.connectionString, 5)),
    config,
    now,
    mailer: env.RESEND_API_KEY
      ? resendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM ?? 'Wordado <codes@wordado.com>' })
      : consoleMailer(),
    jobs: {
      send: (job) => env.JOBS.send(job),
      sendBatch: (jobs) => env.JOBS.sendBatch(jobs.map((body) => ({ body }))),
    },
    push: config.vapid
      ? webPushSender(config.vapid, now)
      : {
          send: async () => {
            throw new Error('Web Push is not configured')
          },
        },
    background: (promise) => ctx.waitUntil(promise),
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const deps = depsFor(env, ctx)
    try {
      return await createApp(deps).fetch(request)
    } finally {
      ctx.waitUntil(deps.db.end())
    }
  },

  /** Re-derivation messages (spec §4.4): each acknowledged alone, retried alone. */
  async queue(batch: MessageBatch<Job>, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = depsFor(env, ctx)
    try {
      for (const message of batch.messages) {
        try {
          await handleJob(deps, message.body)
          message.ack()
        } catch (error) {
          console.error('job failed', message.body, error)
          message.retry()
        }
      }
    } finally {
      await deps.db.end()
    }
  },

  /** The Cron Trigger (wrangler.jsonc): every 15 minutes. */
  async scheduled(_controller: unknown, env: Env, ctx: ExecutionContext): Promise<void> {
    const deps = depsFor(env, ctx)
    try {
      await runScheduled(deps)
    } finally {
      await deps.db.end()
    }
  },
}
