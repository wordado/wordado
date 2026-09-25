/** The Worker's secrets (server/src/config.ts `Env`). Everything else it reads is a plain variable. */
export const WORKER_SECRETS = [
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const

/** Secrets that mean nothing alone: the Worker would quietly run without the feature. */
const PAIRS: readonly (readonly [string, string])[] = [
  ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  ['RESEND_API_KEY', 'EMAIL_FROM'],
]

/**
 * The secrets a deploy uploads with `wrangler deploy --secrets-file`, from
 * the GitHub environment (spec §4.4). An unset or empty one is left out, and
 * a deploy never deletes one it leaves out (Wrangler's rule). Throws, naming
 * every problem, when the Worker would refuse to start or would silently run
 * without a feature.
 */
export function workerSecrets(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of WORKER_SECRETS) {
    const value = env[name]
    if (value !== undefined && value !== '') out[name] = value
  }
  const problems: string[] = []
  if ((out['BETTER_AUTH_SECRET'] ?? '').length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters')
  for (const [a, b] of PAIRS) {
    if (a in out && !(b in out)) problems.push(`${a} is set without ${b}`)
    if (b in out && !(a in out)) problems.push(`${b} is set without ${a}`)
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return out
}
