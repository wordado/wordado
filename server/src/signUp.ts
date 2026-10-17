import type { BetterAuthPlugin, User } from 'better-auth'
import { APIError, createAuthEndpoint } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'

/**
 * Email first, the age step only for a new account (#293, spec §8.6, §11).
 *
 * The learner enters the email and the code. For an address with an account, Better Auth's sign-in signs them in
 * as before. For an address without one it would create the account there and then, before anyone was asked their
 * age; instead the user hook below stops that creation and answers 202 with a ticket. The ticket is the proof that
 * the code for that address was right, so the account can be made after the age step without a second code. Only
 * this file's route creates an account, and only with the age confirmed and a ticket for that address.
 *
 * The ticket is kept as little as it can be: 32 random bytes the client holds, of which the server keeps only the
 * SHA-256 hash, in Better Auth's verification table, beside the address it was issued for. It lasts no longer than
 * a code ({@link TICKET_SECONDS}), and the first use consumes it, whatever the answer: an account, a learner below
 * the age who is turned away, or a wrong address. Nothing is learned about an address before its code is right:
 * up to the code check the requests and their answers are Better Auth's own, the same for every address.
 */

/** The route that creates an account (under /api/auth). */
export const CREATE_ACCOUNT_PATH = '/email-otp/create-account'
/** Better Auth's sign-in by code, where the code is checked (better-auth/plugins/email-otp). */
export const SIGN_IN_PATH = '/sign-in/email-otp'
/** As long as a code lives (src/auth.ts's OTP_SECONDS): the ticket is the code's right answer, kept for the age step. */
export const TICKET_SECONDS = 300
/** Tickets per minute from one address, as Better Auth allows for code checks. */
export const CREATE_ACCOUNT_PER_MINUTE = 3

/** What the sign-in answers for a right code and an address with no account. */
export const NEW_ACCOUNT = 'NEW_ACCOUNT'

const IDENTIFIER_PREFIX = 'sign-up-ticket-'

function base64Url(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Where a ticket is kept: under the hash of what the client holds, never the ticket itself. */
async function identifierOf(ticket: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ticket)))
  return `${IDENTIFIER_PREFIX}${base64Url(digest)}`
}

/** The slice of Better Auth's endpoint context a hook is handed. */
interface HookContext {
  readonly path?: string
  readonly context: {
    readonly internalAdapter: {
      createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>
    }
  }
}

/**
 * Better Auth's `user.create.before`, given the endpoint's context. The account is created by the create-account
 * route and nowhere else. In the sign-in by code it is reached only after the code was right and no account has the
 * address, so it issues a ticket and stops there: the answer is 202 `{ code: 'NEW_ACCOUNT', ticket }`. Anywhere else
 * (no endpoint, another route) the creation is refused.
 */
export async function refuseAccountWithoutAge(user: { readonly email: string }, ctx: HookContext | null): Promise<void> {
  if (ctx?.path === CREATE_ACCOUNT_PATH) return
  if (ctx?.path !== SIGN_IN_PATH) throw new APIError('FORBIDDEN', { code: 'SIGN_UP_REFUSED', message: 'An account is created only after the age step' })
  const ticket = base64Url(crypto.getRandomValues(new Uint8Array(32)))
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: await identifierOf(ticket),
    value: user.email.toLowerCase(),
    // Better Auth's clock, not the server's: it is the one that reads the expiry (consumeVerificationValue), as for codes.
    expiresAt: new Date(Date.now() + TICKET_SECONDS * 1000),
  })
  throw new APIError('ACCEPTED', { code: NEW_ACCOUNT, message: 'No account has this address: confirm the age to create one', ticket })
}

/** The create-account body: the address, the ticket from the sign-in, and the age step's answer. `newsConsent` is read beside it (src/account/newsConsent.ts). */
function bodyOf(body: unknown): { readonly email: string; readonly ticket: string; readonly ageConfirmed: boolean } | null {
  if (typeof body !== 'object' || body === null) return null
  const { email, ticket, ageConfirmed } = body as Record<string, unknown>
  if (typeof email !== 'string' || typeof ticket !== 'string' || typeof ageConfirmed !== 'boolean') return null
  return { email: email.trim().toLowerCase(), ticket, ageConfirmed }
}

/**
 * `POST /api/auth/email-otp/create-account` with `{ email, ticket, ageConfirmed, newsConsent? }`. The ticket is
 * consumed first, so it serves once whatever follows. With the age confirmed, the account is created and signed in,
 * as Better Auth's sign-in would have (`{ token, user }` and the session cookie). With `ageConfirmed: false` the
 * learner was turned away, or chose another address: nothing is created (403 `AGE_NOT_CONFIRMED`). A ticket that is
 * unknown, used, expired or for another address is refused (400 `INVALID_TICKET`); the learner asks for a new code.
 */
export function signUpAfterAge(): BetterAuthPlugin {
  return {
    id: 'wordado-sign-up-after-age',
    endpoints: {
      createAccountEmailOTP: createAuthEndpoint(CREATE_ACCOUNT_PATH, { method: 'POST' }, async (ctx) => {
        const body = bodyOf(ctx.body)
        if (body === null) throw new APIError('BAD_REQUEST', { code: 'INVALID_BODY', message: 'Expected email, ticket and ageConfirmed' })
        const { internalAdapter } = ctx.context
        const consumed = await internalAdapter.consumeVerificationValue(await identifierOf(body.ticket))
        if (consumed === null || consumed.value !== body.email) throw new APIError('BAD_REQUEST', { code: 'INVALID_TICKET', message: 'Ask for a new code' })
        if (!body.ageConfirmed) throw new APIError('FORBIDDEN', { code: 'AGE_NOT_CONFIRMED', message: 'No account was created' })
        // Another tab may have made it meanwhile, with its own ticket: the code was right for this address all the same.
        const user: User = (await internalAdapter.findUserByEmail(body.email))?.user ?? (await internalAdapter.createUser({ email: body.email, emailVerified: true, name: '' }, { method: 'email-otp' }))
        const session = await internalAdapter.createSession(user.id)
        await setSessionCookie(ctx, { session, user })
        return ctx.json({ token: session.token, user: { id: user.id, email: user.email } })
      }),
    },
    rateLimit: [{ pathMatcher: (path: string) => path === CREATE_ACCOUNT_PATH, window: 60, max: CREATE_ACCOUNT_PER_MINUTE }],
  }
}
