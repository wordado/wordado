import { spawn } from 'node:child_process'
import { copyFileSync, existsSync } from 'node:fs'
import { codeIn, runSmoke } from './smokeRun'

/**
 * Drives the real Worker under `wrangler dev` (workerd, Hyperdrive's local
 * connection string, the local queue and cron) through `runSmoke`. The Node
 * suites prove the logic; this proves the runtime. Run from server/: `pnpm smoke`.
 */
const PORT = 8788
const BASE = `http://localhost:${PORT}`

if (!existsSync('.dev.vars')) copyFileSync('.dev.vars.example', '.dev.vars')

const output: string[] = []
const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT), '--var', `BASE_URL:${BASE}`, '--test-scheduled'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group: `pnpm exec` leaves wrangler and workerd as grandchildren
  // that a signal to pnpm alone does not reach, so stop() signals the whole group.
  detached: true,
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE:
      process.env['CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE'] ?? 'postgres://wordado:wordado@localhost:54329/wordado',
  },
})
wrangler.stdout.on('data', (chunk) => output.push(String(chunk)))
wrangler.stderr.on('data', (chunk) => output.push(String(chunk)))
const exited = new Promise<void>((resolve) => wrangler.once('exit', () => resolve()))

function signalGroup(signal: NodeJS.Signals): void {
  try {
    if (wrangler.pid !== undefined) process.kill(-wrangler.pid, signal)
  } catch {
    // The group is already gone.
  }
}

/** Stops wrangler and everything it started, forcibly if it has not exited within 10 seconds. */
async function stop(): Promise<void> {
  signalGroup('SIGTERM')
  const timer = setTimeout(() => signalGroup('SIGKILL'), 10_000)
  await exited
  clearTimeout(timer)
  // workerd may outlive the pnpm process that led the group; make sure nothing is left.
  signalGroup('SIGKILL')
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    signalGroup('SIGKILL')
    process.exit(130)
  })
}

try {
  await runSmoke({ base: BASE, readCode: (email) => codeIn(() => output.join(''), email), runCron: true })
  console.log('smoke: ok')
} catch (error) {
  console.error(output.join('').split('\n').slice(-80).join('\n'))
  console.error('smoke: failed —', error)
  process.exitCode = 1
} finally {
  await stop()
}
