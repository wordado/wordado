import { newsConsentText } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from '../db/migrate'

const HOUR = 3_600_000
const BG = newsConsentText('bg')
const EN = newsConsentText('en')

/** What the account records about news, the time in milliseconds. */
async function recorded(h: Harness, s: Session): Promise<{ consent: string; at: number | null; text: string | null } | undefined> {
  const [row] = await h.deps.db.query<{ consent: string; at: Date | null; text: string | null }>(
    'select news_consent as consent, news_consent_at as at, news_consent_text as text from "user" where id = $1',
    [s.userId],
  )
  return row && { ...row, at: row.at?.getTime() ?? null }
}

describe('consent to news at sign-in (#186)', () => {
  it('records it with the time and the wording when the account is created with the box ticked', async () => {
    const h = harness()
    const s = await h.signIn(undefined, { newsConsent: BG })
    expect(await recorded(h, s)).toEqual({ consent: 'given', at: h.clock.now, text: BG })
  })

  it('creates the account without it just the same, and records no decision', async () => {
    const h = harness()
    const s = await h.signIn()
    expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
    expect((await s.get('/v1/me')).status).toBe(200)
  })

  it('fills a missing decision at a later sign-in', async () => {
    const h = harness()
    const first = await h.signIn()
    h.clock.advance(HOUR)
    const again = await h.signIn(first.email, { newsConsent: EN })
    expect(again.userId).toBe(first.userId)
    expect(await recorded(h, again)).toEqual({ consent: 'given', at: h.clock.now, text: EN })
  })

  it('leaves a consent already given as it was first recorded, box ticked or not', async () => {
    const h = harness()
    const s = await h.signIn(undefined, { newsConsent: BG })
    const given = await recorded(h, s)
    h.clock.advance(HOUR)
    await h.signIn(s.email)
    await h.signIn(s.email, { newsConsent: EN })
    expect(await recorded(h, s)).toEqual(given)
  })

  it('takes a ticked box after a withdrawal as consent given anew, and never withdraws at a sign-in', async () => {
    const h = harness()
    const s = await h.signIn(undefined, { newsConsent: BG })
    h.clock.advance(HOUR)
    expect((await s.put('/v1/account/news-consent', { consent: false })).status).toBe(200)
    const withdrawn = await recorded(h, s)
    expect(withdrawn).toEqual({ consent: 'withdrawn', at: h.clock.now, text: BG })
    h.clock.advance(2 * HOUR)
    // The box left alone says nothing: the withdrawal stands.
    await h.signIn(s.email)
    expect(await recorded(h, s)).toEqual(withdrawn)
    await h.signIn(s.email, { newsConsent: EN })
    expect(await recorded(h, s)).toEqual({ consent: 'given', at: h.clock.now, text: EN })
  })

  it('signs in and records nothing when the wording is not one it knows', async () => {
    const h = harness()
    for (const newsConsent of [true, 'news-0.bg', 'news-1.fr', '', null, { text: BG }]) {
      const s = await h.signIn(undefined, { newsConsent })
      expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
    }
  })

  it('records nothing for an address whose code was wrong', async () => {
    const h = harness()
    const s = await h.signIn()
    const headers = { 'content-type': 'application/json', origin: 'http://localhost:8787', 'cf-connecting-ip': '10.8.0.1' }
    await h.request('/api/auth/email-otp/send-verification-otp', { method: 'POST', headers, body: JSON.stringify({ email: s.email, type: 'sign-in' }) })
    await h.settle()
    const code = h.codes.at(-1)!.code
    const wrong = code === '000000' ? '111111' : '000000'
    const reply = await h.request('/api/auth/sign-in/email-otp', { method: 'POST', headers, body: JSON.stringify({ email: s.email, otp: wrong, newsConsent: BG }) })
    expect(reply.status).toBeGreaterThanOrEqual(400)
    expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
  })

  it('cannot be set through Better Auth’s own update-user', async () => {
    const h = harness()
    const s = await h.signIn()
    await s.post('/api/auth/update-user', { news_consent: 'given', newsConsent: 'given' })
    expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
  })

  it('finds the account whatever the case the address was typed in', async () => {
    const h = harness()
    const first = await h.signIn('mixed-case@example.com')
    await h.signIn('Mixed-Case@Example.com', { newsConsent: BG })
    expect((await recorded(h, first))?.consent).toBe('given')
  })
})

describe('PUT /v1/account/news-consent (#186)', () => {
  it('gives the consent with the wording shown, and withdraws it, each with its time', async () => {
    const h = harness()
    const s = await h.signIn()
    const given = await s.put('/v1/account/news-consent', { consent: true, text: EN })
    expect(given.status).toBe(200)
    expect(given.body).toEqual({ newsConsent: 'given' })
    expect(await recorded(h, s)).toEqual({ consent: 'given', at: h.clock.now, text: EN })
    const givenAt = h.clock.now
    h.clock.advance(HOUR)
    const withdrawn = await s.put('/v1/account/news-consent', { consent: false })
    expect(withdrawn.body).toEqual({ newsConsent: 'withdrawn' })
    // The wording stays: it says what was withdrawn.
    expect(await recorded(h, s)).toEqual({ consent: 'withdrawn', at: givenAt + HOUR, text: EN })
    h.clock.advance(HOUR)
    expect((await s.put('/v1/account/news-consent', { consent: true, text: BG })).body).toEqual({ newsConsent: 'given' })
    expect(await recorded(h, s)).toEqual({ consent: 'given', at: givenAt + 2 * HOUR, text: BG })
  })

  it('keeps the first record when asked for what is already so', async () => {
    const h = harness()
    const s = await h.signIn(undefined, { newsConsent: BG })
    const first = await recorded(h, s)
    h.clock.advance(HOUR)
    expect((await s.put('/v1/account/news-consent', { consent: true, text: EN })).body).toEqual({ newsConsent: 'given' })
    expect(await recorded(h, s)).toEqual(first)
    await s.put('/v1/account/news-consent', { consent: false })
    const withdrawn = await recorded(h, s)
    h.clock.advance(HOUR)
    expect((await s.put('/v1/account/news-consent', { consent: false })).body).toEqual({ newsConsent: 'withdrawn' })
    expect(await recorded(h, s)).toEqual(withdrawn)
  })

  it('has nothing to withdraw where none was given', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.put('/v1/account/news-consent', { consent: false })).body).toEqual({ newsConsent: 'none' })
    expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
  })

  it('refuses a body it cannot read, and a consent without a wording it knows', async () => {
    const h = harness()
    const s = await h.signIn()
    for (const body of [{}, { consent: 'yes' }, { consent: true }, { consent: true, text: 'news-0.bg' }, [true]]) {
      expect((await s.put('/v1/account/news-consent', body)).status).toBe(400)
    }
    expect(await recorded(h, s)).toEqual({ consent: 'none', at: null, text: null })
  })

  it('needs a session, and the session of the learner the client names', async () => {
    const h = harness()
    const s = await h.signIn()
    const other = await h.signIn()
    const bare = await h.request('/v1/account/news-consent', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({ consent: true, text: EN }),
    })
    expect(bare.status).toBe(401)
    expect((await s.put('/v1/account/news-consent', { consent: true, text: EN }, { 'x-wordado-user': other.userId })).status).toBe(409)
    expect((await recorded(h, s))?.consent).toBe('none')
    expect((await recorded(h, other))?.consent).toBe('none')
  })
})

describe('the consent as the learner reads it back (#186)', () => {
  it('is in GET /v1/me', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.get('/v1/me')).body).toMatchObject({ newsConsent: 'none' })
    await s.put('/v1/account/news-consent', { consent: true, text: EN })
    expect((await s.get('/v1/me')).body).toMatchObject({ newsConsent: 'given' })
  })

  it('is in the export, with when and which wording', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.get('/v1/export')).body.account.newsConsent).toEqual({ state: 'none', at: null, text: null })
    await s.put('/v1/account/news-consent', { consent: true, text: EN })
    expect((await s.get('/v1/export')).body.account.newsConsent).toEqual({ state: 'given', at: h.clock.now, text: EN })
  })
})

const files = readMigrationFiles()

describe('migration 0009 (#186)', () => {
  it('leaves every account that exists without a decision, and takes no other state than the three', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, files.filter((f) => f.name < '0009_'))
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now())`)
      expect(await migrate(db, files.filter((f) => f.name <= '0009_news_consent.sql'))).toEqual(['0009_news_consent.sql'])
      expect(await db.query('select news_consent, news_consent_at, news_consent_text from "user"')).toEqual([
        { news_consent: 'none', news_consent_at: null, news_consent_text: null },
      ])
      await expect(db.query(`update "user" set news_consent = 'maybe'`)).rejects.toThrow()
      await expect(db.query(`update "user" set news_consent = 'given'`)).rejects.toThrow()
      await db.query(`update "user" set news_consent = 'given', news_consent_at = now(), news_consent_text = 'news-1.bg'`)
    })
  })
})
