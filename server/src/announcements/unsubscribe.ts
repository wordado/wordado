import { ANNOUNCEMENT_FALLBACK_LANGUAGE, isAnnouncementLanguage, type AnnouncementLanguage } from '@wordado/core'
import type { Context, Hono } from 'hono'
import { setNewsConsent } from '../account/newsConsent'
import type { ServerConfig, ServerDeps } from '../deps'
import type { AppEnv } from '../http'
import { unsubscribePage } from './text'

/** Whom a link is for: one account, or nobody, on the mail of a test send. */
export type UnsubscribeSubject = { readonly userId: string } | 'test'

const encoder = new TextEncoder()

const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[\w-]+$/.test(text)) return null
  try {
    return Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0))
  } catch {
    return null
  }
}

/** The key for these links alone: the server's secret, with what is signed marked as an unsubscribe link, so a signature made here is of no use elsewhere. */
const keyOf = (secret: string): Promise<CryptoKey> => crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
const signed = (name: string): Uint8Array<ArrayBuffer> => encoder.encode(`news-unsubscribe\n${name}`)

/**
 * The token in a news mail's unsubscribe link (#185): whom it is for, and an HMAC of that under the server's
 * secret (the one the feedback limit keys its hashes with, src/feedback/limit.ts). It works without a sign-in,
 * for as long as the secret stands, and nobody without the secret can make one for an account: a link withdraws
 * only the consent of the account it was mailed to. It carries the account's id in base64, as nothing else would
 * let the server find the account without keeping a table of links.
 */
export async function unsubscribeToken(secret: string, subject: UnsubscribeSubject): Promise<string> {
  const name = subject === 'test' ? 't' : `u:${subject.userId}`
  const signature = await crypto.subtle.sign('HMAC', await keyOf(secret), signed(name))
  return `${toBase64Url(encoder.encode(name))}.${toBase64Url(new Uint8Array(signature))}`
}

/** Whom a token is for, or null for anything that was not made here with this secret. */
export async function readUnsubscribeToken(secret: string, token: string): Promise<UnsubscribeSubject | null> {
  const parts = token.split('.')
  if (parts.length !== 2) return null
  const [nameBytes, signature] = [fromBase64Url(parts[0]!), fromBase64Url(parts[1]!)]
  if (nameBytes === null || signature === null) return null
  let name: string
  try {
    name = new TextDecoder('utf-8', { fatal: true }).decode(nameBytes)
  } catch {
    return null
  }
  // `verify` compares in constant time.
  if (!(await crypto.subtle.verify('HMAC', await keyOf(secret), signature, signed(name)))) return null
  if (name === 't') return 'test'
  return name.startsWith('u:') && name.length > 2 ? { userId: name.slice(2) } : null
}

export const UNSUBSCRIBE_PATH = '/v1/news/unsubscribe'

/** The link itself. `language` is the mail's, for the page. */
export function unsubscribeUrl(config: Pick<ServerConfig, 'baseUrl'>, token: string, language: AnnouncementLanguage): string {
  return `${config.baseUrl.replace(/\/+$/, '')}${UNSUBSCRIBE_PATH}?t=${token}&l=${language}`
}

/**
 * Where a news mail's unsubscribe link leads (#185). GET shows a question and changes nothing: mail scanners and
 * link previews open every link in a mail. POST withdraws the consent, through the same function as the settings
 * switch: it is what the button of the page sends, and what a mail program's own unsubscribe button sends by
 * itself (RFC 8058, `List-Unsubscribe-Post`). Neither needs a session; the token is the whole proof.
 *
 * Registered before the /v1 guard: a mail program posts a form with no Origin, which the guard refuses. Nothing is
 * lost by that here: the route reads no cookie, so another site has nothing of the learner's to ride on, and it
 * can only do what the token it would need allows. The answer never says whether the account exists or had
 * consented.
 */
export function newsUnsubscribeRoutes(app: Hono<AppEnv>, deps: ServerDeps): void {
  const page = (c: Context<AppEnv>, state: Parameters<typeof unsubscribePage>[0], status: 200 | 404) => {
    const asked = c.req.query('l')
    c.header('cache-control', 'no-store')
    c.header('referrer-policy', 'no-referrer')
    c.header('x-robots-tag', 'noindex')
    c.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'")
    return c.html(unsubscribePage(state, isAnnouncementLanguage(asked) ? asked : ANNOUNCEMENT_FALLBACK_LANGUAGE), status)
  }
  const subjectOf = (c: Context<AppEnv>) => readUnsubscribeToken(deps.config.authSecret, c.req.query('t') ?? '')

  app.get(UNSUBSCRIBE_PATH, async (c) => ((await subjectOf(c)) === null ? page(c, 'invalid', 404) : page(c, 'ask', 200)))

  app.post(UNSUBSCRIBE_PATH, async (c) => {
    const subject = await subjectOf(c)
    if (subject === null) return page(c, 'invalid', 404)
    if (subject !== 'test') await setNewsConsent(deps.db, subject.userId, { consent: false }, deps.now())
    return page(c, 'done', 200)
  })
}
