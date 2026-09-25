import { describe, expect, it } from 'vitest'
import { WORKER_SECRETS, workerSecrets } from './secretsFile'

const secret = 's'.repeat(48)

describe('workerSecrets: what a deploy uploads (spec §4.4: secrets from the GitHub environment)', () => {
  it('names every secret the Worker reads', () => {
    expect(WORKER_SECRETS).toEqual([
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ])
  })

  it('keeps only the secrets that are set, and nothing else from the environment', () => {
    expect(workerSecrets({ BETTER_AUTH_SECRET: secret, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', GOOGLE_CLIENT_ID: '', PATH: '/usr/bin' })).toEqual({
      BETTER_AUTH_SECRET: secret,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
    })
  })

  it('refuses a missing or short BETTER_AUTH_SECRET', () => {
    expect(() => workerSecrets({})).toThrow('BETTER_AUTH_SECRET must be at least 32 characters')
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: 'short' })).toThrow('BETTER_AUTH_SECRET must be at least 32 characters')
  })

  it('refuses half of a pair, naming every problem at once', () => {
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, GOOGLE_CLIENT_ID: 'id', VAPID_PRIVATE_KEY: 'priv' })).toThrow(
      'GOOGLE_CLIENT_ID is set without GOOGLE_CLIENT_SECRET; VAPID_PRIVATE_KEY is set without VAPID_PUBLIC_KEY',
    )
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, RESEND_API_KEY: 're_x' })).toThrow('RESEND_API_KEY is set without EMAIL_FROM')
  })
})
