import { describe, expect, it } from 'vitest'
import { isAllowedPushEndpoint, webPushSender } from './sender'
import { generateVapidKeys } from './vapid'

describe('isAllowedPushEndpoint', () => {
  it.each([
    ['https://fcm.googleapis.com/fcm/send/abc', true],
    ['https://updates.push.services.mozilla.com/wpush/v2/abc', true],
    ['https://web.push.apple.com/QGx', true],
    ['https://wns2-db5p.notify.windows.com/w/?token=abc', true],
    ['http://fcm.googleapis.com/fcm/send/abc', false],
    ['https://fcm.googleapis.com:8443/fcm/send/abc', false],
    ['https://evilfcm.googleapis.com.example/x', false],
    ['https://example.com/push', false],
    ['not a url', false],
  ])('%s → %s', (endpoint, allowed) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(allowed)
  })
})

describe('webPushSender', () => {
  it('wakes the subscription with an empty, signed push', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    const calls: { url: string; init: RequestInit }[] = []
    const sender = webPushSender(keys, () => 1_790_000_000_000, async (url, init) => {
      calls.push({ url, init })
      return new Response(null, { status: 201 })
    })
    expect(await sender.send('https://fcm.googleapis.com/fcm/send/abc')).toBe('sent')
    const headers = new Headers(calls[0]!.init.headers)
    expect(calls[0]!.url).toBe('https://fcm.googleapis.com/fcm/send/abc')
    expect(calls[0]!.init.method).toBe('POST')
    expect(headers.get('authorization')).toMatch(/^vapid t=.+, k=/)
    expect(headers.get('ttl')).toBe('3600')
    expect(calls[0]!.init.body).toBeUndefined()
  })

  it('reports a subscription the push service has forgotten as gone, and throws on other failures', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    const answering = (status: number) => webPushSender(keys, () => 0, async () => new Response(null, { status }))
    expect(await answering(410).send('https://fcm.googleapis.com/fcm/send/abc')).toBe('gone')
    expect(await answering(404).send('https://fcm.googleapis.com/fcm/send/abc')).toBe('gone')
    await expect(answering(500).send('https://fcm.googleapis.com/fcm/send/abc')).rejects.toThrow('500')
  })

  it('never follows a redirect: an allow-listed host answering 3xx is a failure, not a new destination', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    const calls: RequestInit[] = []
    const sender = webPushSender(keys, () => 0, async (_url, init) => {
      calls.push(init)
      return new Response(null, { status: 302, headers: { location: 'https://example.com/steal' } })
    })
    await expect(sender.send('https://fcm.googleapis.com/fcm/send/abc')).rejects.toThrow('302')
    expect(calls[0]!.redirect).toBe('manual')
  })

  it('never calls an endpoint outside the push services', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    let called = false
    const sender = webPushSender(keys, () => 0, async () => {
      called = true
      return new Response(null, { status: 201 })
    })
    expect(await sender.send('https://example.com/push')).toBe('gone')
    expect(called).toBe(false)
  })
})
