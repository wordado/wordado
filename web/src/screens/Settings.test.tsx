import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MAX_NEW_WORD_LIMIT, type WordId } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeAccounts, fakeAudio, fakeReminders, renderWith, setup } from '../test/fixtures'
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

describe('Settings: the placement test (spec §7.2)', () => {
  it('says why there is no test on the A1-only sample', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.queryByRole('link', { name: 'Find your level with a short test' })).toBeNull()
    expect(screen.getByText('A placement test opens once words of more than one level are installed.')).toBeTruthy()
  })
})

describe('Settings: words set aside (spec §7.4)', () => {
  it('lists them and brings one back', async () => {
    const ctx = await setup()
    await ctx.client.setFlag('c:hello-1' as WordId, 'suspended')
    renderWith(<Settings />, ctx)
    const list = screen.getByRole('region', { name: 'Words set aside' })
    expect(within(list).getByText('hello')).toBeTruthy()
    expect(within(list).getByText('Not now')).toBeTruthy()
    await act(async () => fireEvent.click(within(list).getByRole('button', { name: 'Bring back: hello' })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(within(list).getByText('No words are set aside.')).toBeTruthy()
  })
})

describe('Settings: reminders (spec §8.11)', () => {
  const ana = { userId: 'u1', email: 'ana@example.com' }

  it('needs an account', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.getByText('Reminders come with an account.')).toBeTruthy()
  })

  it('turns on at 19:00, changes the time and the nudge, and turns off', async () => {
    const ctx = await setup()
    const reminders = fakeReminders()
    renderWith(<Settings />, { ...ctx, account: ana, reminders })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    const time = screen.getByLabelText('At') as HTMLInputElement
    expect(time.value).toBe('19:00')
    fireEvent.change(time, { target: { value: '07:30' } })
    await act(async () => fireEvent.blur(time))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: /streak needs today/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(reminders.calls).toEqual(['enable 1140 false', 'enable 450 false', 'enable 450 true', 'disable'])
    expect(screen.getByText('Reminders are off.')).toBeTruthy()
  })

  it('saves the time once per blur, and never disables the time field', async () => {
    const ctx = await setup()
    const reminders = fakeReminders()
    renderWith(<Settings />, { ...ctx, account: ana, reminders })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    const time = screen.getByLabelText('At') as HTMLInputElement
    fireEvent.change(time, { target: { value: '07:00' } })
    expect(time.disabled).toBe(false)
    fireEvent.change(time, { target: { value: '07:30' } })
    expect(time.disabled).toBe(false)
    await act(async () => fireEvent.blur(time))
    expect(time.disabled).toBe(false)
    expect(reminders.calls).toEqual(['enable 1140 false', 'enable 450 false'])
  })

  it('says plainly why reminders cannot work here', async () => {
    const ctx = await setup()
    renderWith(<Settings />, { ...ctx, account: ana, reminders: fakeReminders({ support: () => 'needs-install' }) })
    const blocked = screen.getByText(/once Wordado is on your home screen/)
    expect(blocked.getAttribute('role')).toBe('status')
    cleanup()
    renderWith(<Settings />, { ...ctx, account: ana, reminders: fakeReminders({ enable: async () => 'denied' }) })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Remind me to study' }) as HTMLInputElement).checked).toBe(false)
  })

  it('says the prompt was dismissed, not blocked, and leaves the toggle off', async () => {
    const ctx = await setup()
    renderWith(<Settings />, { ...ctx, account: ana, reminders: fakeReminders({ enable: async () => 'dismissed' }) })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(screen.getByText('Reminders stay off: notifications weren’t allowed.')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Remind me to study' }) as HTMLInputElement).checked).toBe(false)
  })
})
