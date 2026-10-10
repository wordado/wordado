import { describe, expect, it } from 'vitest'
import { WORKER_SECRETS, workerSecrets } from './secretsFile'

const secret = 's'.repeat(48)

describe('workerSecrets: what a deploy uploads (spec §4.4: secrets from the GitHub environment)', () => {
  it('names every secret the Worker reads', () => {
    expect(WORKER_SECRETS).toEqual([
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'FEEDBACK_READ_TOKEN',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ])
  })

  it('keeps only the secrets that are set, and nothing else from the environment', () => {
    expect(workerSecrets({ BETTER_AUTH_SECRET: secret, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', EMAIL_FROM: '', PATH: '/usr/bin' })).toEqual({
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
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, EMAIL_FROM: 'x@example.com', VAPID_PRIVATE_KEY: 'priv' })).toThrow(
      'VAPID_PRIVATE_KEY is set without VAPID_PUBLIC_KEY; EMAIL_FROM is set without RESEND_API_KEY',
    )
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, RESEND_API_KEY: 're_x' })).toThrow('RESEND_API_KEY is set without EMAIL_FROM')
  })


  it('refuses a FEEDBACK_READ_TOKEN under 32 characters, and takes a deploy without one', () => {
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, FEEDBACK_READ_TOKEN: 't'.repeat(31) })).toThrow('FEEDBACK_READ_TOKEN must be at least 32 characters')
    expect(workerSecrets({ BETTER_AUTH_SECRET: secret, FEEDBACK_READ_TOKEN: 't'.repeat(32) })).toEqual({ BETTER_AUTH_SECRET: secret, FEEDBACK_READ_TOKEN: 't'.repeat(32) })
    expect(workerSecrets({ BETTER_AUTH_SECRET: secret, FEEDBACK_READ_TOKEN: '' })).toEqual({ BETTER_AUTH_SECRET: secret })
  })
})
