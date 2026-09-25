import { spawn } from 'node:child_process'
import { codeIn, processGroup, runSmoke, until } from './smokeRun'

/**
 * `runSmoke` against a deployment (spec §4.4: CPU-sensitive paths run on the
 * preview before merge). Sign-in codes are read from the Worker's own log
 * through `wrangler tail`: the preview has no mailer, so plan 5's console
 * mailer prints them there. Needs CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID. Usage, from server/: tsx scripts/smoke-remote.ts <origin> <env>
 */
const [origin, env] = process.argv.slice(2)
if (!origin || !env) {
  console.error('usage: tsx scripts/smoke-remote.ts <origin> <preview|production>')
  process.exit(2)
}

const output: string[] = []
const tail = spawn('pnpm', ['exec', 'wrangler', 'tail', '--env', env, '--format', 'pretty'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  // Its own process group: `pnpm exec` leaves wrangler and the tail connection as
  // grandchildren that a signal to pnpm alone does not reach, so group.stop() signals the whole group.
  detached: true,
  env: { ...process.env, FORCE_COLOR: '0' },
})
tail.stdout.on('data', (chunk) => output.push(String(chunk)))
tail.stderr.on('data', (chunk) => output.push(String(chunk)))
const group = processGroup(tail)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    group.signal('SIGKILL')
    process.exit(130)
  })
}

try {
  await until('wrangler tail to connect', async () => (/Connected to/i.test(output.join('')) ? true : null), 60_000)
  await runSmoke({ base: origin.replace(/\/$/, ''), readCode: (email) => codeIn(() => output.join(''), email, 30_000), runCron: false })
  console.log('smoke: ok')
} catch (error) {
  console.error(output.join('').split('\n').slice(-60).join('\n'))
  console.error('smoke: failed —', error)
  process.exitCode = 1
} finally {
  await group.stop()
}
