import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { useInterfaceLocales } from './interfaceLanguage'
import { LanguageMenu } from './LanguageMenu'

/** The shell's rule beside the menu, as App has it. */
function Shell() {
  useInterfaceLocales()
  return <LanguageMenu />
}

afterEach(cleanup)

describe('LanguageMenu', () => {
  it('shows the code of the interface language in a circle', async () => {
    const ctx = await setup()
    renderWith(<LanguageMenu />, { ...ctx })
    const circle = screen.getByRole('button', { name: 'Interface language: English (EN)' })
    expect(circle.textContent).toBe('EN')
    expect(circle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'Български' })).toBeNull()
  })

  it('lists each language in itself, marks the current one, and switches', async () => {
    const ctx = await setup()
    renderWith(<LanguageMenu />, { ...ctx })
    fireEvent.click(screen.getByRole('button', { name: 'Interface language: English (EN)' }))
    const english = screen.getByRole('button', { name: 'English' })
    const bulgarian = screen.getByRole('button', { name: 'Български' })
    expect(english.getAttribute('aria-current')).toBe('true')
    expect(bulgarian.getAttribute('aria-current')).toBeNull()
    expect(bulgarian.getAttribute('lang')).toBe('bg')
    fireEvent.click(bulgarian)
    const circle = screen.getByRole('button', { name: 'Език на интерфейса: Български (BG)' })
    expect(circle.textContent).toBe('BG')
    expect(screen.queryByRole('button', { name: 'English' })).toBeNull()
    expect(document.activeElement).toBe(circle)
  })

  it('offers only the learner’s L1 and English once a pack is installed (spec §11.2)', async () => {
    const ctx = await setup()
    renderWith(<LanguageMenu />, { ...ctx })
    fireEvent.click(screen.getByRole('button', { name: 'Interface language: English (EN)' }))
    expect(screen.getByRole('button', { name: 'Български' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'English' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Deutsch' })).toBeNull()
  })

  it('moves an interface outside the pair to the L1 (a choice saved before this rule)', async () => {
    const ctx = await setup()
    renderWith(<Shell />, { ...ctx, locale: 'de' })
    expect(await screen.findByRole('button', { name: 'Език на интерфейса: Български (BG)' })).toBeTruthy()
  })

  it('moves a saved Spanish interface to Bulgarian under a Bulgarian pack (plan 12, Review Focus 2)', async () => {
    const ctx = await setup()
    renderWith(<Shell />, { ...ctx, locale: 'es' })
    expect(await screen.findByRole('button', { name: 'Език на интерфейса: Български (BG)' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Език на интерфейса: Български (BG)' }))
    expect(screen.queryByRole('button', { name: 'Español' })).toBeNull()
  })

  it('closes on Escape, returning focus, and on a press outside', async () => {
    const ctx = await setup()
    renderWith(<LanguageMenu />, { ...ctx })
    const circle = screen.getByRole('button', { name: 'Interface language: English (EN)' })
    fireEvent.click(circle)
    fireEvent.keyDown(screen.getByRole('button', { name: 'English' }), { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'English' })).toBeNull()
    expect(document.activeElement).toBe(circle)
    fireEvent.click(circle)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('button', { name: 'English' })).toBeNull()
  })
})
