import { cleanup, screen } from '@testing-library/react'
import { Client } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { NativeLanguageSettings } from './NativeLanguageSettings'

afterEach(cleanup)

describe('Settings: the native language (plan 11)', () => {
  it('shows the current native language, named in itself, and a hint', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    expect(screen.getByRole('heading', { name: 'Native language' })).toBeTruthy()
    expect(screen.getByText('The language the words are translated into.')).toBeTruthy()
    expect(screen.getByText('Български')).toBeTruthy()
  })

  it('shows "Deutsch" when German is installed', async () => {
    const ctx = await setup()
    const client = await Client.open({ driver: nodeSqliteDriver(), env: ctx.env, l1: 'de' })
    await client.installPacks(sampleManifest, sampleFetcher)
    await client.startSession()
    renderWith(<NativeLanguageSettings />, { ...ctx, client })
    expect(screen.getByText('Deutsch')).toBeTruthy()
  })

  it('"Change" links to the language page, with a descriptive accessible name (fix round 1)', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    const link = screen.getByRole('link', { name: 'Change native language' })
    expect(link.getAttribute('href')).toBe('/settings/native-language')
    expect(link.textContent).toBe('Change')
  })

  it('names the "Change" link with its visible text, in every interface language (WCAG 2.5.3, final review)', async () => {
    const ctx = await setup()
    for (const locale of ['en', 'bg', 'de'] as const) {
      const { unmount } = renderWith(<NativeLanguageSettings />, { ...ctx, locale })
      const link = screen.getByRole('link')
      const name = link.getAttribute('aria-label') ?? ''
      expect(name.toLocaleLowerCase(locale)).toContain((link.textContent ?? '').toLocaleLowerCase(locale))
      unmount()
    }
  })

  it('says a change is pending until the new language is installed', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ l1: 'de' })
    renderWith(<NativeLanguageSettings />, ctx)
    expect(screen.getByText('Your words switch to German as soon as the translations have downloaded.')).toBeTruthy()
    // The chosen language shows at once; the note is what says the Bulgarian pack is still the one installed.
    expect(screen.getByText('Deutsch')).toBeTruthy()
  })

  it('shows no pending note once the setting matches what is installed', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    expect(screen.queryByText(/as soon as the translations have downloaded/)).toBeNull()
  })

  it('words the pending note in the interface language', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ l1: 'de' })
    const { unmount } = renderWith(<NativeLanguageSettings />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Думите ви ще се превеждат на немски, щом преводите бъдат изтеглени.')).toBeTruthy()
    unmount()
    renderWith(<NativeLanguageSettings />, { ...ctx, locale: 'de' })
    expect(screen.getByText('Sobald die Übersetzungen heruntergeladen sind, erscheinen deine Wörter auf Deutsch.')).toBeTruthy()
  })
})
