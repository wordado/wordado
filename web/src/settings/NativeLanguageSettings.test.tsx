import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { NativeLanguageSettings } from './NativeLanguageSettings'

afterEach(cleanup)

const choice = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

describe('Settings: the native language (plan 10)', () => {
  it('shows the current native language, each named in itself', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    expect(screen.getByRole('heading', { name: 'Native language' })).toBeTruthy()
    expect(screen.getByText('The language the words are translated into.')).toBeTruthy()
    expect(choice('Български').checked).toBe(true)
    expect(choice('Deutsch').checked).toBe(false)
  })

  it('asks before changing it, says progress stays, then writes the setting', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    fireEvent.click(choice('Deutsch'))
    const dialog = screen.getByRole('dialog', { name: 'Native language' })
    expect(dialog.textContent).toContain('Your progress stays. The words switch to German translations.')
    expect(ctx.client.snapshot.settings.l1).toBeNull()
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Change' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(choice('Deutsch').checked).toBe(true)
    // The interface was English, not the old native language: it stays English.
    expect(screen.getByRole('heading', { name: 'Native language' })).toBeTruthy()
  })

  it('changes nothing when the learner cancels', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    fireEvent.click(choice('Deutsch'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(ctx.client.snapshot.settings.l1).toBeNull()
    expect(choice('Български').checked).toBe(true)
  })

  it('switches the interface too when it spoke the old native language', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Роден език' })).toBeTruthy()
    fireEvent.click(choice('Deutsch'))
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('Думите ще се превеждат на немски.')
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Сменете' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(screen.getByRole('heading', { name: 'Muttersprache' })).toBeTruthy()
  })

  it('says a change is pending until the new language is installed, with the chosen one selected (final review)', async () => {
    const ctx = await setup()
    renderWith(<NativeLanguageSettings />, ctx)
    const pending = 'Your words switch to German as soon as the translations have downloaded.'
    expect(screen.queryByText(pending)).toBeNull()
    fireEvent.click(choice('Deutsch'))
    await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change' })))
    // No `watchL1` runs here: the Bulgarian pack stays installed, as it does offline.
    expect(ctx.client.snapshot.l1).toBe('bg')
    expect(screen.getByText(pending)).toBeTruthy()
    expect(choice('Deutsch').checked).toBe(true)
    // Choosing the installed language again ends the pending change.
    fireEvent.click(choice('Български'))
    await act(async () => fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change' })))
    expect(screen.queryByText(pending)).toBeNull()
  })

  it('words the pending note in the interface language (final review)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ l1: 'de' })
    const { unmount } = renderWith(<NativeLanguageSettings />, { ...ctx, locale: 'bg' })
    expect(screen.getByText('Думите ви ще се превеждат на немски, щом преводите бъдат изтеглени.')).toBeTruthy()
    unmount()
    renderWith(<NativeLanguageSettings />, { ...ctx, locale: 'de' })
    expect(screen.getByText('Sobald die Übersetzungen heruntergeladen sind, erscheinen deine Wörter auf Deutsch.')).toBeTruthy()
  })
})
