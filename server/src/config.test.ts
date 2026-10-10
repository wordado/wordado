import { describe, expect, it } from 'vitest'
import { configFromEnv, DEFAULT_MIN_PROTOCOL_VERSION, MIN_FEEDBACK_READ_TOKEN_LENGTH, type Env } from './config'

const env = (over: Partial<Env> = {}): Env => ({
  HYPERDRIVE: { connectionString: 'postgres://localhost/x' },
  JOBS: { send: async () => undefined, sendBatch: async () => undefined },
  BASE_URL: 'http://localhost:8787',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  ...over,
})

describe('configFromEnv', () => {
  it('reads the minimum: no reminders, protocol 1, no other origins', () => {
    expect(configFromEnv(env())).toEqual({
      baseUrl: 'http://localhost:8787',
      trustedOrigins: [],
      authSecret: 'x'.repeat(32),
      minProtocolVersion: DEFAULT_MIN_PROTOCOL_VERSION,
      vapid: null,
      feedbackReadToken: null,
    })
  })

  it('reads the optional settings', () => {
    const config = configFromEnv(
      env({
        TRUSTED_ORIGINS: 'http://localhost:5173, https://preview.wordado.com',
        MIN_PROTOCOL_VERSION: '2',
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        FEEDBACK_READ_TOKEN: ` ${'t'.repeat(32)} `,
      }),
    )
    expect(config.trustedOrigins).toEqual(['http://localhost:5173', 'https://preview.wordado.com'])
    expect(config.minProtocolVersion).toBe(2)
    expect(config.vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:reminders@wordado.com' })
    expect(config.feedbackReadToken).toBe('t'.repeat(32))
  })

  it('needs both halves of a VAPID pair', () => {
    expect(configFromEnv(env({ VAPID_PUBLIC_KEY: 'pub' })).vapid).toBeNull()
  })

  it('refuses a short secret and a bad protocol minimum', () => {
    expect(() => configFromEnv(env({ BETTER_AUTH_SECRET: 'short' }))).toThrow('BETTER_AUTH_SECRET')
    expect(() => configFromEnv(env({ MIN_PROTOCOL_VERSION: 'two' }))).toThrow('MIN_PROTOCOL_VERSION')
    expect(() => configFromEnv(env({ MIN_PROTOCOL_VERSION: '0' }))).toThrow('MIN_PROTOCOL_VERSION')
  })

  it('refuses an empty BASE_URL: a deploy that forgot --var BASE_URL must fail, not run with undefined', () => {
    expect(() => configFromEnv(env({ BASE_URL: '' }))).toThrow('BASE_URL must be set')
  })

  it('reads an empty or a short FEEDBACK_READ_TOKEN as none: the route stays closed and the app runs', () => {
    expect(configFromEnv(env({ FEEDBACK_READ_TOKEN: '' })).feedbackReadToken).toBeNull()
    expect(configFromEnv(env({ FEEDBACK_READ_TOKEN: 't'.repeat(MIN_FEEDBACK_READ_TOKEN_LENGTH - 1) })).feedbackReadToken).toBeNull()
  })

})
