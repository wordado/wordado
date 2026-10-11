import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeLegalNotice, renderWith, setup, withProviders } from '../test/fixtures'
import { Banners } from './Banners'
import type { LegalState } from './legalNotice'

afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }
const every = (date: string) => ({ bg: date, de: date, en: date, es: date })
const SEEN = { terms: '2026-10-11', privacy: '2026-10-11' }
const TERMS_CHANGED: LegalState = { published: { terms: every('2026-11-01'), privacy: every('2026-10-11') }, seen: SEEN }
const BOTH_CHANGED: LegalState = { published: { terms: every('2026-11-01'), privacy: every('2026-11-02') }, seen: SEEN }

describe('the notice of changed terms (#184)', () => {
  it('says nothing before the website has answered, or while its dates are the ones seen', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx })
    expect(screen.queryByText(/have changed|has changed/)).toBeNull()
    cleanup()
    renderWith(<Banners />, { ...ctx, legalNotice: fakeLegalNotice({ published: { terms: every('2026-10-11'), privacy: every('2026-10-11') }, seen: SEEN }) })
    expect(screen.queryByText(/have changed|has changed/)).toBeNull()
  })

  it('says the terms have changed, politely, with a link to them in the interface language', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, locale: 'de', legalNotice: fakeLegalNotice(TERMS_CHANGED) })
    const line = screen.getByText('Die Nutzungsbedingungen haben sich geändert.')
    expect(line.closest('[role="status"]')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Nutzungsbedingungen lesen' }).getAttribute('href')).toBe('https://wordado.com/de/terms/')
    expect(screen.queryByText('Die Datenschutzerklärung hat sich geändert.')).toBeNull()
  })

  it('says each document by itself when both changed, each with its own link and its own Dismiss', async () => {
    const ctx = await setup()
    const legalNotice = fakeLegalNotice(BOTH_CHANGED)
    renderWith(<Banners />, { ...ctx, legalNotice })
    expect(screen.getByRole('link', { name: 'Read the terms' }).getAttribute('href')).toBe('https://wordado.com/en/terms/')
    expect(screen.getByRole('link', { name: 'Read the privacy policy' }).getAttribute('href')).toBe('https://wordado.com/en/privacy/')
    const privacy = screen.getByText('The privacy policy has changed.').closest<HTMLElement>('.banner')!
    // Two buttons of one name: each is described by the line it dismisses.
    const dismiss = within(privacy).getByRole('button', { name: 'Dismiss' })
    expect(document.getElementById(dismiss.getAttribute('aria-describedby')!)?.textContent).toBe('The privacy policy has changed.')
    fireEvent.click(dismiss)
    expect(legalNotice.dismissed).toEqual(['privacy 2026-11-02'])
    expect(screen.queryByText('The privacy policy has changed.')).toBeNull()
    expect(screen.getByText('The terms of use have changed.')).toBeTruthy()
  })

  it('is dismissed by keyboard: the link and the button are in the tab order, as they are', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, legalNotice: fakeLegalNotice(TERMS_CHANGED) })
    const banner = screen.getByText('The terms of use have changed.').closest<HTMLElement>('.banner')!
    const link = within(banner).getByRole('link')
    const button = within(banner).getByRole('button')
    expect(link.tagName).toBe('A')
    expect(button.tagName).toBe('BUTTON')
    for (const control of [link, button]) expect(control.hasAttribute('tabindex')).toBe(false)
  })

  it('keeps a dismissal in the demo on the device only', async () => {
    const ctx = await setup()
    const legalNotice = fakeLegalNotice(TERMS_CHANGED)
    renderWith(<Banners />, { ...ctx, legalNotice })
    await act(async () => fireEvent.click(within(screen.getByText('The terms of use have changed.').closest<HTMLElement>('.banner')!).getByRole('button', { name: 'Dismiss' })))
    expect(legalNotice.dismissed).toEqual(['terms 2026-11-01'])
    expect(ctx.client.snapshot.settings.termsSeen).toBeNull()
  })

  it('writes a learner’s dismissal into the account’s settings too, for their other devices', async () => {
    const ctx = await setup()
    const legalNotice = fakeLegalNotice(BOTH_CHANGED)
    renderWith(<Banners />, { ...ctx, legalNotice, account: ana })
    await act(async () => fireEvent.click(within(screen.getByText('The terms of use have changed.').closest<HTMLElement>('.banner')!).getByRole('button', { name: 'Dismiss' })))
    expect(legalNotice.dismissed).toEqual(['terms 2026-11-01'])
    expect(ctx.client.snapshot.settings).toMatchObject({ termsSeen: '2026-11-01', privacySeen: null })
  })

  it('says nothing of a change the learner dismissed on another device', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ termsSeen: '2026-11-01' })
    renderWith(<Banners />, { ...ctx, legalNotice: fakeLegalNotice(BOTH_CHANGED), account: ana })
    expect(screen.queryByText('The terms of use have changed.')).toBeNull()
    expect(screen.getByText('The privacy policy has changed.')).toBeTruthy()
    // It arrives while the app is open: the line goes.
    await act(async () => void (await ctx.client.updateSettings({ privacySeen: '2026-11-02' })))
    expect(screen.queryByText('The privacy policy has changed.')).toBeNull()
  })

  it('puts a notice that waited from an earlier visit into a status region that was there first, empty, so that it is announced', async () => {
    const ctx = await setup()
    const first = renderToString(withProviders(<Banners />, { ...ctx, legalNotice: fakeLegalNotice(TERMS_CHANGED) }))
    expect(first).not.toContain('The terms of use have changed.')
    expect(first).toContain('<div role="status" class="legal-notices"></div>')
    // A change found while the app is open goes into the same region.
    const legalNotice = fakeLegalNotice()
    renderWith(<Banners />, { ...ctx, legalNotice })
    const region = document.querySelector<HTMLElement>('.banners > [role="status"].legal-notices')!
    expect(region.textContent).toBe('')
    act(() => legalNotice.store.set(TERMS_CHANGED))
    expect(within(region).getByText('The terms of use have changed.')).toBeTruthy()
  })

  it('has its text in every interface language', async () => {
    const ctx = await setup()
    const said: Record<string, string[]> = {
      bg: ['Условията за ползване са променени.', 'Политиката за поверителност е променена.'],
      de: ['Die Nutzungsbedingungen haben sich geändert.', 'Die Datenschutzerklärung hat sich geändert.'],
      en: ['The terms of use have changed.', 'The privacy policy has changed.'],
      es: ['Las condiciones de uso han cambiado.', 'La política de privacidad ha cambiado.'],
    }
    for (const locale of ['bg', 'de', 'en', 'es'] as const) {
      renderWith(<Banners />, { ...ctx, locale, legalNotice: fakeLegalNotice(BOTH_CHANGED) })
      for (const text of said[locale]!) expect(screen.getByText(text), text).toBeTruthy()
      expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(
        expect.arrayContaining([`https://wordado.com/${locale}/terms/`, `https://wordado.com/${locale}/privacy/`]),
      )
      cleanup()
    }
  })
})
