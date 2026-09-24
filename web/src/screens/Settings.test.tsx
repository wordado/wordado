import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MAX_NEW_WORD_LIMIT } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeAccounts, fakeAudio, renderWith, setup } from '../test/fixtures'
import { Settings } from './Settings'

beforeEach(() => window.history.replaceState(null, '', '/settings'))
afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }

/** Types into a number field and leaves it, as a learner does; the value is saved on leaving. */
async function typeAndLeave(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  await act(async () => fireEvent.blur(field))
}

describe('Settings: studying (spec §7.1, §7.4, §11.1)', () => {
  it('shows the current settings', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect((screen.getByLabelText('New words a day') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Reviews a day, at most') as HTMLInputElement).value).toBe('100')
    expect((screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'A1 · Beginner' }) as HTMLInputElement).checked).toBe(true)
  })

  it('saves a valid number when the field is left', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await typeAndLeave('New words a day', '15')
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(15)
  })

  it.each(['', '45', '-1', '2.5', 'ten'])('refuses %j, says why at the field, and saves nothing', async (value) => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await typeAndLeave('New words a day', value)
    const field = screen.getByLabelText('New words a day')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`Enter a whole number from 0 to ${MAX_NEW_WORD_LIMIT}.`)
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(10)
  })

  it('saves retention, audio and latency grading as they change', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /Intensive/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Play audio, and include listening exercises' })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' })))
    expect(ctx.client.snapshot.settings).toMatchObject({ retention: 'intensive', audio: false, latencyGrading: false })
  })

  it('sets and clears a daily goal', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.queryByLabelText('Answers a day')).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Set a daily goal' })))
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(20)
    await typeAndLeave('Answers a day', '35')
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(35)
    await typeAndLeave('Answers a day', '0')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(35)
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Set a daily goal' })))
    expect(ctx.client.snapshot.settings.dailyGoal).toBeNull()
  })

  it('offers only the levels the words come in', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    const levels = within(screen.getByRole('group', { name: 'Your level' })).getAllByRole('radio')
    // The bundled sample is A1 only.
    expect(levels.map((r) => r.getAttribute('value'))).toEqual(['A1'])
  })
})

describe('Settings: audio for offline study (spec §9.3)', () => {
  it('downloads every clip of the learner’s level', async () => {
    const ctx = await setup()
    const audio = fakeAudio()
    renderWith(<Settings />, { ...ctx, audio })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download A1 audio' })))
    expect(audio.fetched.map((c) => c.clipId).sort()).toEqual(ctx.client.levelClips('A1').map((c) => c.clipId).sort())
  })
})

describe('Settings: the account (spec §11)', () => {
  it('offers an account from the demo, and no export or deletion', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.getByText(/without an account/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Download your data (JSON)' })).toBeNull()
  })

  it('downloads the export with the session', async () => {
    const ctx = await setup()
    renderWith(<Settings />, { ...ctx, account: ana })
    expect(screen.getByText('Signed in as ana@example.com')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Download your data (JSON)' })
    expect(link.getAttribute('href')).toBe('/v1/export')
    expect(link.hasAttribute('download')).toBe(true)
  })

  it('signs out, and asks first when answers could not be synced', async () => {
    const ctx = await setup()
    let first = true
    const accounts = fakeAccounts({
      signOut: async (options) => {
        accounts.calls.push(`signOut${options?.force ? ' force' : ''}`)
        if (first && !options?.force) {
          first = false
          return 'unsynced'
        }
        return 'signed-out'
      },
    })
    renderWith(<Settings />, { ...ctx, account: ana, accounts })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(screen.getByRole('dialog', { name: 'Some answers haven’t synced' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out and delete them' })))
    expect(accounts.calls).toEqual(['signOut', 'signOut force'])
  })

  it('deletes the account only once the learner says they understand', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    renderWith(<Settings />, { ...ctx, account: ana, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Delete your account' }))
    const confirm = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }))
    expect(confirm.disabled).toBe(false)
    await act(async () => fireEvent.click(confirm))
    expect(accounts.calls).toEqual(['deleteAccount'])
  })
})
