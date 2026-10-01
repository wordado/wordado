import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import type { ChangeL1Outcome } from '@wordado/client-data'
import type { L1 } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../account/storage'
import { fakePacks, renderWith, setup } from '../test/fixtures'
import { LanguageStep } from './LanguageStep'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const choice = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

/** A switcher whose installs the test settles by hand: each call is logged, and its promise waits for `settle`. */
function controlledPacks() {
  const packs = fakePacks()
  const calls: L1[] = []
  const pending: ((outcome: ChangeL1Outcome) => void)[] = []
  vi.spyOn(packs, 'install').mockImplementation((_client, _account, l1) => {
    calls.push(l1)
    return new Promise<ChangeL1Outcome>((resolve) => pending.push(resolve))
  })
  const reset = vi.spyOn(packs, 'reset')
  return {
    packs,
    calls,
    reset,
    /** Settles the oldest pending install, as the real switcher's store would. */
    async settle(outcome: ChangeL1Outcome) {
      const l1 = calls[calls.length - pending.length]!
      packs.store.set(outcome.ok ? { phase: 'idle' } : { phase: 'failed', l1 })
      await act(async () => pending.shift()!(outcome))
    },
  }
}

const account = { email: 'learner@example.com' } as unknown as AccountRecord

describe('LanguageStep, setup mode (plan 11)', () => {
  it('preselects German for a German interface and Bulgarian for an English one, each named in itself', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, { ...ctx, locale: 'de' })
    expect(screen.getByRole('heading', { name: 'Welche Sprache sprichst du?' })).toBeTruthy()
    expect(choice('Deutsch').checked).toBe(true)
    expect(choice('Български').checked).toBe(false)
    unmount()
    renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, ctx)
    expect(screen.getByRole('heading', { name: 'Which language do you speak?' })).toBeTruthy()
    expect(screen.getByText('Words are explained in this language. You can change it later in Settings.')).toBeTruthy()
    expect(choice('Български').checked).toBe(true)
    expect(choice('Deutsch').checked).toBe(false)
  })

  it('gives its heading focus when it appears', async () => {
    const ctx = await setup()
    renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, ctx)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Which language do you speak?' }))
  })

  it('links to Sign in for a returning learner', async () => {
    const ctx = await setup()
    renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, ctx)
    expect(screen.getByRole('link', { name: 'I already have an account' }).getAttribute('href')).toBe('/signin')
  })

  it('Continue writes the setting, installs that pack, and is done once it is installed', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    const onDone = vi.fn()
    renderWith(<LanguageStep mode="setup" onDone={onDone} />, { ...ctx, packs: fake.packs })
    fireEvent.click(choice('Deutsch'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(fake.calls).toEqual(['de'])
    expect(vi.mocked(fake.packs.install).mock.calls[0]![0]).toBe(ctx.client)
    expect(onDone).not.toHaveBeenCalled()
    await fake.settle({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the download while the install runs: a status first, then a progress bar with values', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, { ...ctx, packs: fake.packs })
    expect(screen.queryByRole('progressbar')).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    // Before the manifest arrives the total is unknown: the status says so, and there is no bar yet.
    act(() => fake.packs.store.set({ phase: 'downloading', l1: 'bg', received: 0, total: 0 }))
    expect(screen.getByRole('status').textContent).toContain('Getting your words ready')
    expect(screen.queryByRole('progressbar')).toBeNull()
    act(() => fake.packs.store.set({ phase: 'downloading', l1: 'bg', received: 50, total: 100 }))
    const bar = screen.getByRole('progressbar', { name: 'Getting your words ready' })
    expect(bar.getAttribute('aria-valuenow')).toBe('50')
    expect(bar.getAttribute('aria-valuemax')).toBe('100')
    expect(screen.getByText('50%')).toBeTruthy()
    // Nothing can be started twice meanwhile.
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('says why on failure, keeps Sign in reachable, and Try again resets and installs again (Review Focus 4)', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    const onDone = vi.fn()
    renderWith(<LanguageStep mode="setup" onDone={onDone} />, { ...ctx, account, packs: fake.packs })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    await fake.settle({ ok: false, reason: 'unavailable' })
    expect(screen.getByRole('alert').textContent).toBe('The words could not be downloaded. Check your connection and try again.')
    expect(screen.getByRole('link', { name: 'I already have an account' })).toBeTruthy()
    expect(onDone).not.toHaveBeenCalled()
    // The saved-choice note belongs to changing the language later, not to the setup.
    expect(screen.queryByText('Your choice is saved: the words switch as soon as you are online.')).toBeNull()

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(fake.reset).toHaveBeenCalledTimes(1)
    expect(fake.calls).toEqual(['bg', 'bg'])
    expect(screen.queryByRole('alert')).toBeNull()
    await fake.settle({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('shows the same failure in the demo, where Try again is the remedy', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    renderWith(<LanguageStep mode="setup" onDone={() => undefined} />, { ...ctx, packs: fake.packs })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    await fake.settle({ ok: false, reason: 'unavailable' })
    expect(screen.getByRole('alert').textContent).toBe('The words could not be downloaded. Check your connection and try again.')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })
})

describe('LanguageStep, change mode (plan 11)', () => {
  it('preselects the installed language and links back to the language settings', async () => {
    const ctx = await setup()
    renderWith(<LanguageStep mode="change" onDone={() => undefined} />, { ...ctx, locale: 'de' })
    expect(choice('Български').checked).toBe(true)
    expect(screen.getByRole('link', { name: 'Zurück' }).getAttribute('href')).toBe('/settings/languages')
    expect(screen.queryByRole('link', { name: 'Ich habe schon ein Konto' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
  })

  it('asks before changing, then writes the setting, installs and is done', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    const onDone = vi.fn()
    renderWith(<LanguageStep mode="change" onDone={onDone} />, { ...ctx, packs: fake.packs })
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    fireEvent.click(choice('Deutsch'))
    expect(screen.getByText('Your progress stays. The words switch to German translations.')).toBeTruthy()
    expect(ctx.client.snapshot.settings.l1).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(fake.calls).toEqual(['de'])
    // The interface spoke English, not the old native language: it stays English.
    expect(screen.getByRole('heading', { name: 'Native language' })).toBeTruthy()
    await fake.settle({ ok: true })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('switches the interface too when it spoke the old native language', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    renderWith(<LanguageStep mode="change" onDone={() => undefined} />, { ...ctx, locale: 'bg', packs: fake.packs })
    fireEvent.click(choice('Deutsch'))
    expect(screen.getByText('Напредъкът ви се запазва. Думите ще се превеждат на немски.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Сменете' })))
    expect(ctx.client.snapshot.settings.l1).toBe('de')
    expect(screen.getByRole('heading', { name: 'Muttersprache' })).toBeTruthy()
  })

  it('for an account that fails, says the choice is saved and offers Try again', async () => {
    const ctx = await setup()
    const fake = controlledPacks()
    renderWith(<LanguageStep mode="change" onDone={() => undefined} />, { ...ctx, account, packs: fake.packs })
    fireEvent.click(choice('Deutsch'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Change' })))
    await fake.settle({ ok: false, reason: 'unavailable' })
    expect(screen.getByRole('alert').textContent).toContain('The words could not be downloaded. Check your connection and try again.')
    expect(screen.getByText('Your choice is saved: the words switch as soon as you are online.')).toBeTruthy()
    // The choice stays selected, though the Bulgarian pack is still the installed one.
    expect(choice('Deutsch').checked).toBe(true)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    expect(fake.reset).toHaveBeenCalledTimes(1)
    expect(fake.calls).toEqual(['de', 'de'])
  })
})
