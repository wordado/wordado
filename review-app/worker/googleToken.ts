import type { Deps } from './app'
import { b64url } from './b64'

/** Google's token endpoint: where a service account's signed JWT is changed for an access token, and the only address one is sent to. */
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
/** What the token may do: call Google Cloud's services, as far as the service account's own roles allow. */
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'
/** The longest a signed JWT may ask for, and what Google gives: an hour. */
const TOKEN_LIFE_S = 3600
/** A token is not used in the last minutes of its life: a new one is made instead. */
export const TOKEN_MARGIN_S = 300

/** A token, or why there is none, as the model's client says it, and where it went wrong: a word or a status, never anything of the key file, the JWT or an answer. */
export type GoogleToken = { readonly ok: true; readonly token: string } | { readonly ok: false; readonly why: 'unreachable' | 'late' | 'refused' | 'unfit'; readonly detail: string }

/** The name of what was thrown, when it is a plain word: a name is logged, a message never (it can hold part of the request). */
export function nameOf(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name
  return typeof name === 'string' && /^[A-Za-z]{1,40}$/.test(name) ? name : 'error'
}

/** The one token kept, in this isolate's memory and nowhere else: the key file it was made from, and when it is no longer used. */
let kept: { readonly keyFile: string; readonly token: string; readonly until: number } | null = null

/** Forgets the token kept: after the service refused it, and between tests. */
export function forgetGoogleToken(): void {
  kept = null
}

/** A token address on this machine: taken for a stand-in only (feedbackAiConfig.ts). */
function onThisMachine(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && u.username === '' && u.search === '' && u.hash === ''
  } catch {
    return false
  }
}

/** The private key of a key file, ready to sign: PKCS#8 in PEM, as Google writes it. Null for anything else. */
async function signingKey(pem: string): Promise<CryptoKey | null> {
  const body = /^-----BEGIN PRIVATE KEY-----([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----$/.exec(pem.trim())?.[1]
  if (body === undefined) return null
  try {
    const der = Uint8Array.from(atob(body.replace(/\s+/g, '')), (c) => c.charCodeAt(0))
    return await crypto.subtle.importKey('pkcs8', der as Uint8Array<ArrayBuffer>, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  } catch {
    return null
  }
}

/**
 * An access token for a Google service account, from the content of its JSON key file (`client_email`,
 * `private_key`, and `token_uri` when it has one): a JWT signed with the key (RS256) is changed for a token at
 * Google's token endpoint, and the token is kept in memory until shortly before it ends. So a request goes out only
 * when none is kept, once, with no second try, and it ends with `signal`. Never throws.
 *
 * The signed JWT goes to Google's token endpoint and nowhere else: a key file that names another address is
 * refused, since a file must not say where a secret is sent. A stand-in's address on this machine is taken where
 * `standIn` says a developer or a test runs the Worker. Nothing is written to the database or the log here.
 */
export async function googleToken(deps: Pick<Deps, 'fetch' | 'now'>, keyFile: string, opts: { readonly standIn: boolean; readonly signal: AbortSignal }): Promise<GoogleToken> {
  const failed = (why: 'unreachable' | 'late' | 'refused' | 'unfit', detail: string): GoogleToken => ({ ok: false, why, detail })
  const nowMs = deps.now().getTime()
  if (kept !== null && kept.keyFile === keyFile && nowMs < kept.until) return { ok: true, token: kept.token }

  let file: { client_email?: unknown; private_key?: unknown; token_uri?: unknown } | null
  try {
    file = JSON.parse(keyFile) as typeof file
  } catch {
    file = null
  }
  if (file === null || typeof file !== 'object') return failed('refused', 'key file: not JSON')
  const email = typeof file.client_email === 'string' ? file.client_email.trim() : ''
  if (email === '') return failed('refused', 'key file: no client_email')
  if (typeof file.private_key !== 'string' || file.private_key.trim() === '') return failed('refused', 'key file: no private_key')
  const uri = file.token_uri === undefined ? GOOGLE_TOKEN_URL : file.token_uri
  if (typeof uri !== 'string' || (uri !== GOOGLE_TOKEN_URL && !(opts.standIn && onThisMachine(uri)))) return failed('refused', 'key file: token_uri')
  const key = await signingKey(file.private_key)
  if (key === null) return failed('refused', 'key file: private_key')

  const iat = Math.floor(nowMs / 1000)
  const head = b64url.encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url.encodeText(JSON.stringify({ iss: email, scope: SCOPE, aud: uri, iat, exp: iat + TOKEN_LIFE_S }))
  let text: string
  try {
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claims}`))
    const res = await deps.fetch(uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claims}.${b64url.encode(new Uint8Array(sig))}` }).toString(),
      redirect: 'manual',
      signal: opts.signal,
    })
    if (res.status === 429 || res.status >= 500) return failed('unreachable', `token: ${res.status}`)
    if (res.status !== 200) return failed('refused', `token: ${res.status}`)
    text = await res.text()
  } catch (err) {
    const name = nameOf(err)
    return failed(name === 'TimeoutError' ? 'late' : 'unreachable', `token: ${name}`)
  }
  let body: { access_token?: unknown; expires_in?: unknown } | null
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return failed('unfit', 'token: not JSON')
  }
  const token = body?.access_token
  const life = body?.expires_in
  // A token is a word for a header: anything with a space or a line in it is none.
  if (typeof token !== 'string' || !/^[\x21-\x7e]+$/.test(token) || typeof life !== 'number' || !Number.isFinite(life) || life <= 0) return failed('unfit', 'token: no access_token')
  kept = { keyFile, token, until: nowMs + (life - TOKEN_MARGIN_S) * 1000 }
  return { ok: true, token }
}
