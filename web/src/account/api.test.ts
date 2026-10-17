import { describe, expect, it } from 'vitest'
import { ApiError, httpApi, OfflineError } from './api'

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A fetch that answers from a table of `METHOD path` → [status, body, headers?], and records every call. */
function fakeFetch(routes: Record<string, readonly [number, unknown, Record<string, string>?]>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes[`${init?.method ?? 'GET'} ${url}`]
    if (!route) throw new TypeError('Failed to fetch')
    const [status, body, headers = {}] = route
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  return { fetchFn, calls }
}

const bodyOf = (call: Call) => JSON.parse(String(call.init?.body))

describe('httpApi (plan 5 contract)', () => {
  it('asks for a sign-in code with the session cookie', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/email-otp/send-verification-otp': [200, { success: true }] })
    await httpApi(fetchFn).sendCode('ana@example.com')
    expect(bodyOf(calls[0]!)).toEqual({ email: 'ana@example.com', type: 'sign-in' })
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).get('content-type')).toBe('application/json')
  })

  it("names the server's limit on codes, and Better Auth's error codes", async () => {
    const limited = fakeFetch({ 'POST /api/auth/email-otp/send-verification-otp': [429, { error: 'sign_in_email_limit' }] })
    await expect(httpApi(limited.fetchFn).sendCode('a@b.c')).rejects.toMatchObject({ status: 429, code: 'sign_in_email_limit' })
    const wrong = fakeFetch({ 'POST /api/auth/sign-in/email-otp': [400, { code: 'INVALID_OTP', message: 'Invalid OTP' }] })
    const err = await httpApi(wrong.fetchFn).verifyCode('a@b.c', '000000').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'INVALID_OTP' })
  })

  it('signs in with the code, and sends nothing of the news box with it (#186, #293)', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/sign-in/email-otp': [200, { token: 't' }] })
    expect(await httpApi(fetchFn).verifyCode('ana@example.com', '123456')).toEqual({ kind: 'signed-in' })
    expect(bodyOf(calls[0]!)).toEqual({ email: 'ana@example.com', otp: '123456' })
  })

  it('reads a right code for an address with no account as the ticket for the age step (#293)', async () => {
    const { fetchFn } = fakeFetch({ 'POST /api/auth/sign-in/email-otp': [202, { code: 'NEW_ACCOUNT', message: 'm', ticket: 'tk' }] })
    expect(await httpApi(fetchFn).verifyCode('bo@example.com', '123456')).toEqual({ kind: 'new-account', ticket: 'tk' })
    const odd = fakeFetch({ 'POST /api/auth/sign-in/email-otp': [202, { code: 'SOMETHING_ELSE' }] })
    await expect(httpApi(odd.fetchFn).verifyCode('bo@example.com', '123456')).rejects.toMatchObject({ status: 202, code: 'SOMETHING_ELSE' })
  })

  it('creates the account with the ticket and the age confirmed, and the wording of a ticked news box (#186, #293)', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/email-otp/create-account': [200, { token: 't' }] })
    await httpApi(fetchFn).createAccount('bo@example.com', 'tk', null)
    await httpApi(fetchFn).createAccount('bo@example.com', 'tk', 'news-1.bg')
    expect(bodyOf(calls[0]!)).toEqual({ email: 'bo@example.com', ticket: 'tk', ageConfirmed: true })
    expect(bodyOf(calls[1]!)).toEqual({ email: 'bo@example.com', ticket: 'tk', ageConfirmed: true, newsConsent: 'news-1.bg' })
    const spent = fakeFetch({ 'POST /api/auth/email-otp/create-account': [400, { code: 'INVALID_TICKET' }] })
    await expect(httpApi(spent.fetchFn).createAccount('bo@example.com', 'tk', null)).rejects.toMatchObject({ status: 400, code: 'INVALID_TICKET' })
  })

  it('drops the ticket when the age is not confirmed, and takes the refusal, or no answer, quietly (#293)', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/email-otp/create-account': [403, { code: 'AGE_NOT_CONFIRMED' }] })
    await httpApi(fetchFn).discardSignUp('bo@example.com', 'tk')
    expect(bodyOf(calls[0]!)).toEqual({ email: 'bo@example.com', ticket: 'tk', ageConfirmed: false })
    await httpApi(fakeFetch({}).fetchFn).discardSignUp('bo@example.com', 'tk')
  })

  it('gives and withdraws the consent to news for the recorded learner, and reads back what the server holds (#186)', async () => {
    const { fetchFn, calls } = fakeFetch({ 'PUT /v1/account/news-consent': [200, { newsConsent: 'withdrawn' }] })
    const api = httpApi(fetchFn, () => 'u1')
    expect(await api.setNewsConsent(true, 'news-1.en')).toBe('withdrawn')
    expect(await api.setNewsConsent(false, 'news-1.en')).toBe('withdrawn')
    expect(bodyOf(calls[0]!)).toEqual({ consent: true, text: 'news-1.en' })
    expect(bodyOf(calls[1]!)).toEqual({ consent: false })
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
    const refused = fakeFetch({ 'PUT /v1/account/news-consent': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').setNewsConsent(false, 'news-1.en')).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
  })

  it('tells the server the interface language for the recorded learner, and reads back what the server holds (#199)', async () => {
    const { fetchFn, calls } = fakeFetch({ 'PUT /v1/account/interface-language': [200, { interfaceLanguage: 'bg' }] })
    expect(await httpApi(fetchFn, () => 'u1').setInterfaceLanguage('bg')).toBe('bg')
    expect(bodyOf(calls[0]!)).toEqual({ language: 'bg' })
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
    const refused = fakeFetch({ 'PUT /v1/account/interface-language': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').setInterfaceLanguage('en')).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
    await expect(httpApi(fakeFetch({}).fetchFn, () => 'u1').setInterfaceLanguage('en')).rejects.toBeInstanceOf(OfflineError)
  })

  it('reports no answer at all as OfflineError', async () => {
    const { fetchFn } = fakeFetch({})
    await expect(httpApi(fetchFn).sendCode('a@b.c')).rejects.toBeInstanceOf(OfflineError)
  })

  it('reads the signed-in learner, and null without a session', async () => {
    const me = { userId: 'u1', email: 'ana@example.com', createdAt: 1, newsConsent: 'none', interfaceLanguage: null }
    expect(await httpApi(fakeFetch({ 'GET /v1/me': [200, me] }).fetchFn).me()).toEqual(me)
    expect(await httpApi(fakeFetch({ 'GET /v1/me': [401, { error: 'unauthorized' }] }).fetchFn).me()).toBeNull()
  })

  it('pre-fills the country, signs out, deletes with confirmation', async () => {
    const { fetchFn, calls } = fakeFetch({
      'GET /v1/country': [200, { country: 'BG' }],
      'POST /api/auth/sign-out': [200, { success: true }],
      'DELETE /v1/account': [200, { deleted: true }],
    })
    const api = httpApi(fetchFn)
    expect(await api.requestCountry()).toBe('BG')
    await api.signOut()
    await api.deleteAccount()
    expect(bodyOf(calls[2]!)).toEqual({ confirm: true })
  })

  it('names the learner a push subscription is for, when one is known', async () => {
    let user: string | null = 'u1'
    const { fetchFn, calls } = fakeFetch({ 'PUT /v1/push/subscription': [200, { ok: true }], 'DELETE /v1/push/subscription': [200, { ok: true }] })
    const api = httpApi(fetchFn, () => user)
    const body = { endpoint: 'https://push.example/1', keys: { p256dh: 'p', auth: 'a' }, reminderMinute: 540, tzOffsetMin: 0, language: 'en' as const, streakNudge: false }
    await api.putSubscription(body)
    await api.deleteSubscription('https://push.example/1')
    user = null
    await api.putSubscription(body)
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
    expect(new Headers(calls[1]!.init?.headers).get('x-wordado-user')).toBe('u1')
    expect(new Headers(calls[2]!.init?.headers).has('x-wordado-user')).toBe(false)
    const refused = fakeFetch({ 'PUT /v1/push/subscription': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').putSubscription(body)).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
  })

  it('sends feedback signed in or not, naming the learner when one is known, and reports a refusal or no connection', async () => {
    const body = {
      kind: 'idea' as const,
      message: 'A dark theme, please.',
      email: '',
      appVersion: 'B3kq9xZa',
      corpusVersion: 'bg-6',
      language: 'bg',
      screen: '/path',
      userAgent: 'Mozilla/5.0',
      website: '',
    }
    const { fetchFn, calls } = fakeFetch({ 'POST /v1/feedback': [200, { ok: true }] })
    await httpApi(fetchFn).sendFeedback(body)
    await httpApi(fetchFn, () => 'u1').sendFeedback(body)
    expect(bodyOf(calls[0]!)).toEqual(body)
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).has('x-wordado-user')).toBe(false)
    expect(new Headers(calls[1]!.init?.headers).get('x-wordado-user')).toBe('u1')
    const refused = fakeFetch({ 'POST /v1/feedback': [429, { error: 'feedback_limit' }] })
    await expect(httpApi(refused.fetchFn).sendFeedback(body)).rejects.toMatchObject({ status: 429, code: 'feedback_limit' })
    await expect(httpApi(fakeFetch({}).fetchFn).sendFeedback(body)).rejects.toBeInstanceOf(OfflineError)
  })

  it('treats reminders as unavailable when the server has no key', async () => {
    expect(await httpApi(fakeFetch({ 'GET /v1/push/public-key': [404, { error: 'not_configured' }] }).fetchFn).pushPublicKey()).toBeNull()
    expect(await httpApi(fakeFetch({ 'GET /v1/push/public-key': [200, { publicKey: 'BPk' }] }).fetchFn).pushPublicKey()).toBe('BPk')
  })

  it('names the learner an account deletion is for, and reports a refusal', async () => {
    const { fetchFn, calls } = fakeFetch({ 'DELETE /v1/account': [200, { deleted: true }] })
    await httpApi(fetchFn, () => 'u1').deleteAccount()
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
    const refused = fakeFetch({ 'DELETE /v1/account': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').deleteAccount()).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
  })

  it('fetches the export for the recorded learner, with the server’s file name', async () => {
    const { fetchFn, calls } = fakeFetch({
      'GET /v1/export': [200, { format: 'wordado-export-1' }, { 'content-disposition': 'attachment; filename="wordado-export-2026-09-25.json"' }],
    })
    const file = await httpApi(fetchFn, () => 'u1').exportData()
    expect(file).toEqual({ name: 'wordado-export-2026-09-25.json', json: '{"format":"wordado-export-1"}' })
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
  })

  it('names the export file itself when the server does not, and reports a refusal or no connection', async () => {
    const unnamed = fakeFetch({ 'GET /v1/export': [200, { format: 'wordado-export-1' }] })
    expect((await httpApi(unnamed.fetchFn).exportData()).name).toBe('wordado-export.json')
    const refused = fakeFetch({ 'GET /v1/export': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').exportData()).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
    await expect(httpApi(fakeFetch({}).fetchFn).exportData()).rejects.toBeInstanceOf(OfflineError)
  })
})
