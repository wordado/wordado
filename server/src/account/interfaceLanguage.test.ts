import { describe, expect, it, vi } from 'vitest'
import { harness, type Harness, type Session } from '../../test/harness'
import { withScratchDatabase } from '../../test/db'
import { readMigrationFiles } from '../../scripts/migrationFiles'
import { migrate } from '../db/migrate'

/** The language the account holds. */
async function recorded(h: Harness, s: Session): Promise<string | null | undefined> {
  const [row] = await h.deps.db.query<{ interface_language: string | null }>('select interface_language from "user" where id = $1', [s.userId])
  return row?.interface_language
}

describe('PUT /v1/account/interface-language (#199)', () => {
  it('keeps the language the app says, and the last one said', async () => {
    const h = harness()
    const s = await h.signIn()
    expect(await recorded(h, s)).toBeNull()
    const said = await s.put('/v1/account/interface-language', { language: 'bg' })
    expect(said.status).toBe(200)
    expect(said.body).toEqual({ interfaceLanguage: 'bg' })
    expect(await recorded(h, s)).toBe('bg')
    expect((await s.put('/v1/account/interface-language', { language: 'en' })).body).toEqual({ interfaceLanguage: 'en' })
    expect((await s.put('/v1/account/interface-language', { language: 'en' })).body).toEqual({ interfaceLanguage: 'en' })
    expect(await recorded(h, s)).toBe('en')
  })

  it('takes each of the interface languages', async () => {
    const h = harness()
    const s = await h.signIn()
    for (const language of ['bg', 'de', 'en', 'es']) {
      expect((await s.put('/v1/account/interface-language', { language })).status).toBe(200)
      expect(await recorded(h, s)).toBe(language)
    }
  })

  it('refuses anything that is not one of them, and keeps what it had', async () => {
    const h = harness()
    const s = await h.signIn()
    await s.put('/v1/account/interface-language', { language: 'de' })
    for (const body of [{}, { language: 'fr' }, { language: 'DE' }, { language: 'en-GB' }, { language: '' }, { language: null }, { language: ['bg'] }, { language: 1 }, ['bg'], 'bg']) {
      expect((await s.put('/v1/account/interface-language', body)).status).toBe(400)
    }
    expect(await recorded(h, s)).toBe('de')
  })

  it('needs a session, and the session of the learner the client names', async () => {
    const h = harness()
    const s = await h.signIn()
    const other = await h.signIn()
    const bare = await h.request('/v1/account/interface-language', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:8787' },
      body: JSON.stringify({ language: 'bg' }),
    })
    expect(bare.status).toBe(401)
    expect((await s.put('/v1/account/interface-language', { language: 'bg' }, { 'x-wordado-user': other.userId })).status).toBe(409)
    expect(await recorded(h, s)).toBeNull()
    expect(await recorded(h, other)).toBeNull()
  })

  it('logs nothing', async () => {
    const h = harness()
    const s = await h.signIn()
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => undefined), vi.spyOn(console, 'error').mockImplementation(() => undefined)]
    try {
      await s.put('/v1/account/interface-language', { language: 'bg' })
      await s.put('/v1/account/interface-language', { language: 'fr' })
      for (const log of logs) expect(log.mock.calls).toEqual([])
    } finally {
      for (const log of logs) log.mockRestore()
    }
  })

  it('cannot be set through Better Auth’s own update-user, and a sign-in leaves it as it is', async () => {
    const h = harness()
    const s = await h.signIn()
    await s.post('/api/auth/update-user', { interface_language: 'bg', interfaceLanguage: 'bg' })
    expect(await recorded(h, s)).toBeNull()
    await s.put('/v1/account/interface-language', { language: 'es' })
    await h.signIn(s.email)
    expect(await recorded(h, s)).toBe('es')
  })
})

describe('the interface language as the learner reads it back (#199)', () => {
  it('is in GET /v1/me', async () => {
    const h = harness()
    const s = await h.signIn()
    expect((await s.get('/v1/me')).body).toMatchObject({ interfaceLanguage: null })
    await s.put('/v1/account/interface-language', { language: 'bg' })
    expect((await s.get('/v1/me')).body).toMatchObject({ interfaceLanguage: 'bg' })
  })

  it('is in the export', async () => {
    const h = harness()
    const s = await h.signIn()
    const before = await s.get('/v1/export')
    expect(before.body.format).toBe('wordado-export-5')
    expect(before.body.account.interfaceLanguage).toBeNull()
    await s.put('/v1/account/interface-language', { language: 'de' })
    expect((await s.get('/v1/export')).body.account.interfaceLanguage).toBe('de')
  })
})

const files = readMigrationFiles()

describe('migration 0012 (#199)', () => {
  it('leaves every account that exists without a language, and takes no other than the four', async () => {
    await withScratchDatabase(async (db) => {
      await migrate(db, files.filter((f) => f.name < '0012_'))
      await db.query(`insert into "user" (id, name, email, "emailVerified", "updatedAt") values ('u1', '', 'ana@example.com', true, now())`)
      expect(await migrate(db, files.filter((f) => f.name <= '0012_interface_language.sql'))).toEqual(['0012_interface_language.sql'])
      expect(await db.query('select interface_language from "user"')).toEqual([{ interface_language: null }])
      await expect(db.query(`update "user" set interface_language = 'fr'`)).rejects.toThrow()
      await expect(db.query(`update "user" set interface_language = ''`)).rejects.toThrow()
      for (const language of ['bg', 'de', 'en', 'es']) await db.query('update "user" set interface_language = $1', [language])
      await db.query('update "user" set interface_language = null')
    })
  })
})
