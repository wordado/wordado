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
    await act(async () => fireEvent.click(within(dialog).getByRole('button', { name: 'Смени' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(screen.getByRole('heading', { name: 'Muttersprache' })).toBeTruthy()
  })
})
