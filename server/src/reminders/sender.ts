import type { Fetch, PushSender, VapidKeys } from '../deps'
import { importVapidKeys, vapidAuthorization } from './vapid'

/** The push services browsers use (Chrome, Firefox, Safari, Edge). */
const PUSH_HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com']

/**
 * Whether an endpoint belongs to a browser push service. Anything else is
 * refused, so a subscription cannot make the server POST to a URL of the
 * learner's choosing.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL
  try {
    url = new URL(endpoint)
  } catch {
    return false
  }
  if (url.protocol !== 'https:' || url.port !== '') return false
  return PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
}

/** How long a push service keeps an undelivered reminder: after an hour it is stale. */
const TTL_SECONDS = 3600

/**
 * Wakes a subscription with an empty push (spec §8.11): the service worker
 * then asks GET /v1/reminder what to show, so nothing needs encrypting.
 */
export function webPushSender(keys: VapidKeys, now: () => number, send: Fetch = (input, init) => fetch(input, init)): PushSender {
  let privateKey: Promise<CryptoKey> | null = null
  return {
    async send(endpoint) {
      if (!isAllowedPushEndpoint(endpoint)) return 'gone'
      privateKey ??= importVapidKeys(keys)
      const response = await send(endpoint, {
        method: 'POST',
        headers: {
          authorization: await vapidAuthorization(keys, await privateKey, endpoint, now()),
          ttl: String(TTL_SECONDS),
          urgency: 'normal',
          'content-length': '0',
        },
      })
      if (response.status === 404 || response.status === 410) return 'gone'
      if (!response.ok) throw new Error(`The push service answered ${response.status}`)
      return 'sent'
    },
  }
}
