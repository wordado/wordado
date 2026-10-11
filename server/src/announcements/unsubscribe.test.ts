import { describe, expect, it } from 'vitest'
import { createTestUser } from '../../test/db'
import { BASE_URL, harness, type Harness } from '../../test/harness'
import { readUnsubscribeToken, unsubscribeToken, unsubscribeUrl } from './unsubscribe'

const SECRET = 'b4f1c9e07a2d4e6f8a3b5c7d9e1f2a4b6c8d0e2f4a6b8c0d'

const consentOf = async (h: Harness, id: string) =>
  (await h.deps.db.query<{ news_consent: string; news_consent_at: Date | null; news_consent_text: string | null }>('select news_consent, news_consent_at, news_consent_text from "user" where id = $1', [id]))[0]

async function consenting(h: Harness): Promise<string> {
  const id = await createTestUser(h.deps.db)
  await h.deps.db.query(`update "user" set news_consent = 'given', news_consent_at = to_timestamp(1), news_consent_text = 'news-1.bg' where id = $1`, [id])
  return id
}

/** The link of a news mail, as a path of the app. */
const linkOf = async (h: Harness, userId: string, language = 'en') => unsubscribeUrl(h.deps.config, await unsubscribeToken(SECRET, { userId }), language as 'en').slice(BASE_URL.length)

/** As a mail program's own unsubscribe button asks (RFC 8058): a form post, with no cookie and no Origin. */
const oneClick = (h: Harness, path: string) => h.request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click' })

describe('the token of an unsubscribe link (#185)', () => {
  it('names one account, and is read back only as it was made', async () => {
    const token = await unsubscribeToken(SECRET, { userId: 'user-1' })
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/)
    expect(await readUnsubscribeToken(SECRET, token)).toEqual({ userId: 'user-1' })
    expect(await unsubscribeToken(SECRET, { userId: 'user-1' })).toBe(token)
    expect(await unsubscribeToken(SECRET, { userId: 'user-2' })).not.toBe(token)
  })

  it('cannot be made for another account, or without the server’s secret', async () => {
    const mine = await unsubscribeToken(SECRET, { userId: 'user-1' })
    const theirs = await unsubscribeToken(SECRET, { userId: 'user-2' })
    const [myName, mySignature] = mine.split('.') as [string, string]
    const [theirName] = theirs.split('.') as [string]
    // Another account's name under my signature.
    expect(await readUnsubscribeToken(SECRET, `${theirName}.${mySignature}`)).toBeNull()
    expect(await readUnsubscribeToken(SECRET, `${myName}.${mySignature.slice(0, -2)}AA`)).toBeNull()
    expect(await readUnsubscribeToken(SECRET, await unsubscribeToken('another secret, as long as the real one is', { userId: 'user-1' }))).toBeNull()
    for (const junk of ['', '.', 'a', 'a.b', `${myName}.`, `.${mySignature}`, `${mine}.x`, 'no t a token']) expect(await readUnsubscribeToken(SECRET, junk)).toBeNull()
  })

  it('has a form for the test send, which names no account and is not an account’s token', async () => {
    const test = await unsubscribeToken(SECRET, 'test')
    expect(await readUnsubscribeToken(SECRET, test)).toBe('test')
    // An account cannot be named so that it reads as the test, nor the other way round.
    expect(await readUnsubscribeToken(SECRET, await unsubscribeToken(SECRET, { userId: 'test' }))).toEqual({ userId: 'test' })
  })
})

describe('the unsubscribe link of a news mail (#185)', () => {
  it('shows a question when it is opened, and withdraws nothing by that: a mail scanner opens every link', async () => {
    const h = harness()
    const id = await consenting(h)
    const reply = await h.request(await linkOf(h, id))
    expect(reply.status).toBe(200)
    expect(reply.headers.get('content-type')).toBe('text/html; charset=UTF-8')
    expect(reply.headers.get('cache-control')).toBe('no-store')
    expect(reply.headers.get('referrer-policy')).toBe('no-referrer')
    expect(reply.headers.get('x-robots-tag')).toBe('noindex')
    expect(reply.headers.get('content-security-policy')).toBe("default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    expect(reply.body).toContain('Stop news about Wordado by email?')
    expect(reply.body).toContain('<form method="post">')
    expect((await consentOf(h, id))!.news_consent).toBe('given')
    // HEAD, which some scanners send, the same.
    await h.request(await linkOf(h, id), { method: 'HEAD' })
    expect((await consentOf(h, id))!.news_consent).toBe('given')
  })

  it('withdraws the consent on the post of a mail program’s own button: no session, no Origin, a form body', async () => {
    const h = harness()
    const id = await consenting(h)
    const other = await consenting(h)
    const reply = await oneClick(h, await linkOf(h, id))
    expect(reply.status).toBe(200)
    expect(reply.body).toContain('no more news')
    // As the settings switch withdraws: the state, the time of it, and the wording that was given kept.
    expect(await consentOf(h, id)).toEqual({ news_consent: 'withdrawn', news_consent_at: new Date(h.clock.now), news_consent_text: 'news-1.bg' })
    expect((await consentOf(h, other))!.news_consent).toBe('given')
    // Pressed again, it is as done as before.
    h.clock.advance(60_000)
    expect((await oneClick(h, await linkOf(h, id))).status).toBe(200)
    expect((await consentOf(h, id))!.news_consent_at).toEqual(new Date(h.clock.now - 60_000))
  })

  it('withdraws on the button of its own page, posted from the app’s origin or from none', async () => {
    const h = harness()
    const id = await consenting(h)
    const reply = await h.request(await linkOf(h, id), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE_URL }, body: '' })
    expect(reply.status).toBe(200)
    expect((await consentOf(h, id))!.news_consent).toBe('withdrawn')
  })

  it('does nothing for a token that was not made here, and says only that the link does not work', async () => {
    const h = harness()
    const id = await consenting(h)
    const other = await consenting(h)
    const [, signature] = (await unsubscribeToken(SECRET, { userId: other })).split('.')
    const [name] = (await unsubscribeToken(SECRET, { userId: id })).split('.')
    for (const path of [`/v1/news/unsubscribe?t=${name}.${signature}`, '/v1/news/unsubscribe?t=abc.def', '/v1/news/unsubscribe', `/v1/news/unsubscribe?t=${id}`]) {
      for (const reply of [await h.request(path), await oneClick(h, path)]) {
        expect(reply.status).toBe(404)
        expect(reply.body).toContain('This link does not work.')
        expect(reply.body).not.toContain('<form')
      }
    }
    expect((await consentOf(h, id))!.news_consent).toBe('given')
    expect((await consentOf(h, other))!.news_consent).toBe('given')
  })

  it('answers the same for an account that is gone or never consented, and changes nothing', async () => {
    const h = harness()
    const never = await createTestUser(h.deps.db)
    expect((await oneClick(h, await linkOf(h, never))).status).toBe(200)
    expect(await consentOf(h, never)).toEqual({ news_consent: 'none', news_consent_at: null, news_consent_text: null })
    expect((await oneClick(h, await linkOf(h, 'nobody'))).status).toBe(200)
  })

  it('lets the link of a test send be tried: the page, and a post that withdraws nobody’s consent', async () => {
    const h = harness()
    const id = await consenting(h)
    const path = unsubscribeUrl(h.deps.config, await unsubscribeToken(SECRET, 'test'), 'en').slice(BASE_URL.length)
    expect((await h.request(path)).body).toContain('<form method="post">')
    expect((await oneClick(h, path)).body).toContain('no more news')
    expect((await consentOf(h, id))!.news_consent).toBe('given')
  })

  it('speaks the language of the mail it came in, and English for one it does not know', async () => {
    const h = harness()
    const id = await consenting(h)
    expect((await h.request(await linkOf(h, id, 'de'))).body).toContain('<html lang="de">')
    expect((await h.request(await linkOf(h, id, 'bg'))).body).toContain('Новини по имейл')
    expect((await h.request((await linkOf(h, id)).replace('l=en', 'l=fr'))).body).toContain('<html lang="en">')
    expect((await h.request((await linkOf(h, id)).replace('&l=en', ''))).body).toContain('<html lang="en">')
  })

  it('leaves the guard of every other route as it was: a form post from another site is still refused', async () => {
    const h = harness()
    const s = await h.signIn()
    const reply = await h.request('/v1/account', { method: 'DELETE', headers: { cookie: s.cookie, origin: 'https://evil.example', 'content-type': 'application/x-www-form-urlencoded' }, body: 'confirm=true' })
    expect(reply.status).toBe(403)
    // And the unsubscribe path takes nothing but GET, HEAD and POST: any other method meets the guard like every /v1 path.
    const id = await consenting(h)
    expect((await h.request(await linkOf(h, id), { method: 'DELETE' })).status).toBe(403)
    expect((await h.request(await linkOf(h, id), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await consentOf(h, id))!.news_consent).toBe('given')
  })
})
