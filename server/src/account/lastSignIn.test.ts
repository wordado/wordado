import { describe, expect, it } from 'vitest'
import { harness, type Harness } from '../../test/harness'

const DAY = 86_400_000

const lastSignIn = async (h: Harness, userId: string): Promise<number | null> => {
  const [row] = await h.deps.db.query<{ last_sign_in_at: Date | null }>('select last_sign_in_at from "user" where id = $1', [userId])
  return row?.last_sign_in_at?.getTime() ?? null
}

describe('the last sign-in (#187)', () => {
  it('is written at the first sign-in, which makes the account, and at each one after', async () => {
    const h = harness()
    const first = await h.signIn('ana@example.com')
    expect(await lastSignIn(h, first.userId)).toBe(h.clock.now)
    h.clock.advance(30 * DAY)
    const second = await h.signIn('ana@example.com')
    expect(second.userId).toBe(first.userId)
    expect(await lastSignIn(h, first.userId)).toBe(h.clock.now)
  })

  it('moves on when a session is extended: a learner who never signs out is not away', async () => {
    const h = harness()
    const s = await h.signIn()
    const signedInAt = h.clock.now
    h.clock.advance(3 * DAY)
    // While the session is fresh an API call writes nothing.
    expect((await s.get('/v1/me')).status).toBe(200)
    expect(await lastSignIn(h, s.userId)).toBe(signedInAt)
    // Better Auth reads the real clock: age the session by two days in the database instead (src/auth.test.ts).
    await h.deps.db.query(`update session set "expiresAt" = "expiresAt" - interval '2 days' where "userId" = $1`, [s.userId])
    expect((await s.get('/v1/me')).status).toBe(200)
    expect(await lastSignIn(h, s.userId)).toBe(h.clock.now)
  })

  it('is one learner’s alone, and no client reads or sets it', async () => {
    const h = harness()
    const a = await h.signIn()
    h.clock.advance(DAY)
    const b = await h.signIn()
    expect(await lastSignIn(h, a.userId)).toBe(h.clock.now - DAY)
    expect(await lastSignIn(h, b.userId)).toBe(h.clock.now)
    await b.post('/api/auth/update-user', { lastSignInAt: 0, last_sign_in_at: 0 })
    expect(await lastSignIn(h, b.userId)).toBe(h.clock.now)
    expect(JSON.stringify((await b.get('/api/auth/get-session')).body)).not.toMatch(/last_?sign/i)
  })
})
