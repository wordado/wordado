import { describe, expect, it } from 'vitest'
import { base64UrlDecode, base64UrlEncode, generateVapidKeys, importVapidKeys, VAPID_TOKEN_SECONDS, vapidAuthorization } from './vapid'

const decodeJson = (part: string) => JSON.parse(new TextDecoder().decode(base64UrlDecode(part)))

describe('VAPID (RFC 8292)', () => {
  it('signs a token for the push service origin that the public key verifies', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    const header = await vapidAuthorization(keys, await importVapidKeys(keys), 'https://fcm.googleapis.com/fcm/send/abc', 1_790_000_000_000)
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)
    expect(match).not.toBeNull()
    const [, head, claims, signature, k] = match!
    expect(k).toBe(keys.publicKey)
    expect(decodeJson(head!)).toEqual({ typ: 'JWT', alg: 'ES256' })
    expect(decodeJson(claims!)).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_790_000_000 + VAPID_TOKEN_SECONDS, sub: 'mailto:reminders@wordado.com' })
    const publicKey = await crypto.subtle.importKey('raw', base64UrlDecode(keys.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlDecode(signature!),
      new TextEncoder().encode(`${head}.${claims}`),
    )
    expect(valid).toBe(true)
  })

  it('refuses a public key that is not an uncompressed P-256 point', async () => {
    const keys = await generateVapidKeys('mailto:reminders@wordado.com')
    await expect(importVapidKeys({ ...keys, publicKey: base64UrlEncode(new Uint8Array(33)) })).rejects.toThrow('uncompressed P-256')
  })

  it('round-trips base64url', () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255, 62, 63])
    expect(base64UrlEncode(bytes)).not.toMatch(/[+/=]/)
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes)
  })
})
