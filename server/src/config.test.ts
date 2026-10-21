import { describe, expect, it } from 'vitest'
import { configFromEnv, DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY, passkeyRpIdFits, DEFAULT_MIN_PROTOCOL_VERSION, MIN_ADMIN_WRITE_TOKEN_LENGTH, MIN_FEEDBACK_READ_TOKEN_LENGTH, type Env } from './config'

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
      adminWriteToken: null,
      announcementMailsPerDay: DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY,
      passkeyRpId: 'localhost',
    })
  })

  it('takes the passkey relying party from PASSKEY_RP_ID, else from the BASE_URL hostname (#287)', () => {
    expect(configFromEnv(env({ BASE_URL: 'https://app.wordado.com', PASSKEY_RP_ID: 'wordado.com' })).passkeyRpId).toBe('wordado.com')
    expect(configFromEnv(env({ BASE_URL: 'https://app.example.test' })).passkeyRpId).toBe('app.example.test')
  })

  it("refuses a PASSKEY_RP_ID that BASE_URL's host is not on, so every passkey does not fail unexplained (#304)", () => {
    expect(configFromEnv(env({ BASE_URL: 'https://app.wordado.com', PASSKEY_RP_ID: 'app.wordado.com' })).passkeyRpId).toBe('app.wordado.com')
    expect(configFromEnv(env({ BASE_URL: 'https://app.wordado.com', PASSKEY_RP_ID: 'WORDADO.com' })).passkeyRpId).toBe('WORDADO.com')
    expect(() => configFromEnv(env({ BASE_URL: 'https://app.wordado.com', PASSKEY_RP_ID: 'example.com' }))).toThrow(/PASSKEY_RP_ID/)
    expect(() => configFromEnv(env({ BASE_URL: 'https://app.wordado.com', PASSKEY_RP_ID: 'ordado.com' }))).toThrow(/PASSKEY_RP_ID/)
    expect(() => configFromEnv(env({ BASE_URL: 'https://wordado.com', PASSKEY_RP_ID: 'app.wordado.com' }))).toThrow(/PASSKEY_RP_ID/)
  })

  it('tells whether a relying party id is the host of a URL or a domain it is on (#304)', () => {
    expect(passkeyRpIdFits('wordado.com', 'https://app.wordado.com')).toBe(true)
    expect(passkeyRpIdFits('wordado.com', 'https://wordado.com:8443/x')).toBe(true)
    expect(passkeyRpIdFits('localhost', 'http://localhost:8787')).toBe(true)
    expect(passkeyRpIdFits('wordado.com', 'https://notwordado.com')).toBe(false)
    expect(passkeyRpIdFits('', 'https://wordado.com')).toBe(false)
    expect(passkeyRpIdFits('wordado.com', 'nonsense')).toBe(false)
  })

  it('reads the optional settings', () => {
    const config = configFromEnv(
      env({
        TRUSTED_ORIGINS: 'http://localhost:5173, https://preview.wordado.com',
        MIN_PROTOCOL_VERSION: '2',
        VAPID_PUBLIC_KEY: 'pub',
        VAPID_PRIVATE_KEY: 'priv',
        FEEDBACK_READ_TOKEN: ` ${'t'.repeat(32)} `,
        ADMIN_WRITE_TOKEN: ` ${'w'.repeat(32)} `,
      }),
    )
    expect(config.trustedOrigins).toEqual(['http://localhost:5173', 'https://preview.wordado.com'])
    expect(config.minProtocolVersion).toBe(2)
    expect(config.vapid).toEqual({ publicKey: 'pub', privateKey: 'priv', subject: 'mailto:reminders@wordado.com' })
    expect(config.feedbackReadToken).toBe('t'.repeat(32))
    expect(config.adminWriteToken).toBe('w'.repeat(32))
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

  it('reads an empty or a short ADMIN_WRITE_TOKEN as none, and one that is also the token that reads feedback (#187)', () => {
    expect(configFromEnv(env({ ADMIN_WRITE_TOKEN: '' })).adminWriteToken).toBeNull()
    expect(configFromEnv(env({ ADMIN_WRITE_TOKEN: 'w'.repeat(MIN_ADMIN_WRITE_TOKEN_LENGTH - 1) })).adminWriteToken).toBeNull()
    const same = configFromEnv(env({ FEEDBACK_READ_TOKEN: 't'.repeat(40), ADMIN_WRITE_TOKEN: ` ${'t'.repeat(40)}` }))
    expect(same).toMatchObject({ feedbackReadToken: 't'.repeat(40), adminWriteToken: null })
  })

  it('holds a day’s announcement mails to half of the provider’s free allowance unless told another number (#185)', () => {
    expect(DEFAULT_ANNOUNCEMENT_MAILS_PER_DAY).toBe(50)
    expect(configFromEnv(env({ ANNOUNCEMENT_MAILS_PER_DAY: '' })).announcementMailsPerDay).toBe(50)
    expect(configFromEnv(env({ ANNOUNCEMENT_MAILS_PER_DAY: '2000' })).announcementMailsPerDay).toBe(2000)
    expect(configFromEnv(env({ ANNOUNCEMENT_MAILS_PER_DAY: '0' })).announcementMailsPerDay).toBe(0)
    for (const bad of ['-1', '1.5', 'many']) expect(() => configFromEnv(env({ ANNOUNCEMENT_MAILS_PER_DAY: bad }))).toThrow('ANNOUNCEMENT_MAILS_PER_DAY')
  })
})
