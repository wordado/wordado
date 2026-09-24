import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Where the Worker's output goes: the sign-in codes are read from it (plan 5 prints them in development). */
export const WORKER_LOG = fileURLToPath(new URL('../test-results/worker.log', import.meta.url))
const HEALTH = 'http://localhost:8787/health'

const up = async () => {
  try {
    return (await fetch(HEALTH)).ok
  } catch {
    return false
  }
}

/** Starts plan 5's Worker, with Postgres in Docker, and stops it afterwards. */
export default async function setup(): Promise<() => Promise<void>> {
  if (await up()) throw new Error('A Worker is already running on :8787. Stop it: this run reads sign-in codes from its own Worker’s output.')
  mkdirSync(fileURLToPath(new URL('../test-results/', import.meta.url)), { recursive: true })
  const log = createWriteStream(WORKER_LOG)
  const worker = spawn('pnpm', ['--filter', '@wordado/server', 'dev'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  worker.stdout.pipe(log)
  worker.stderr.pipe(log)
  // Shared by the health-check failure path and the returned teardown: whichever one
  // rejects, the detached Worker must not outlive it, or the next run finds :8787 taken
  // (fix round 1, Important — thrown after spawn but before this was returned, the
  // teardown never ran and the Worker leaked).
  const kill = () => {
    try {
      process.kill(-worker.pid!, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
  try {
    const deadline = Date.now() + 180_000
    while (!(await up())) {
      if (worker.exitCode !== null) throw new Error(`The Worker exited (${worker.exitCode}); see ${WORKER_LOG}`)
      if (Date.now() > deadline) throw new Error(`The Worker did not answer ${HEALTH}; see ${WORKER_LOG}`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  } catch (err) {
    kill()
    throw err
  }
  return async () => kill()
}
