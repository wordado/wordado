import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MAX_NEW_WORD_LIMIT, type WordId } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../account/api'
import { SignOutOffline } from '../account/controller'
import { fakeApi } from '../test/fakeApi'
import { fakeAccounts, fakeAudio, fakeLifecycle, fakeReminders, renderWith, setup } from '../test/fixtures'
import { saveFile } from '../download'
import { SAVE_HOLD_MS } from '../app/updateSafety'
import { AUTO_CONTINUE_KEY } from '../study/autoContinue'
import { Settings } from './Settings'

vi.mock('../download', () => ({ saveFile: vi.fn() }))

beforeEach(() => window.history.replaceState(null, '', '/settings'))
afterEach(() => {
  cleanup()
  window.localStorage.removeItem(AUTO_CONTINUE_KEY)
})

const ana = { userId: 'u1', email: 'ana@example.com' }

/** The open section's page, apart from the menu that summarises it. */
const page = () => within(document.querySelector<HTMLElement>('.settings-section')!)

/** Types into a number field and leaves it, as a learner does; the value is saved on leaving. */
async function typeAndLeave(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  await act(async () => fireEvent.blur(field))
}

describe('Settings: the menu', () => {
  const row = (name: RegExp) => screen.getByRole('link', { name })

  it('lists each section with what it is set to, each on its own page', async () => {
    const ctx = await setup()
    renderWith(<Settings section={null} />, ctx)
    expect(row(/^Studying/).textContent).toContain('A1 · 10 new words a day · Standard')
    expect(row(/^Studying/).getAttribute('href')).toBe('/settings/study')
    expect(row(/^Words set aside/).textContent).toContain('None')
    expect(row(/^Audio for offline study/).textContent).toContain('0 of 60 clips on this device')
    expect(row(/^Reminders/).textContent).toContain('Reminders come with an account.')
    expect(row(/^Languages/).textContent).toContain('Translations: Български · Menus: English')
    expect(row(/^Account/).textContent).toContain('Not signed in')
    expect(row(/^About and privacy/).getAttribute('href')).toBe('/settings/about')
  })

  it('names the signed-in learner, and says how the app updates', async () => {
    const ctx = await setup()
    renderWith(<Settings section={null} />, { ...ctx, account: ana })
    expect(row(/^Account/).textContent).toContain('ana@example.com')
    expect(row(/^The app/).textContent).toContain('Updates automatically')
    expect(row(/^The app/).getAttribute('href')).toBe('/settings/app')
  })

  it('says the app updates when asked once that is switched off, and offers installation where it can', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ autoUpdate: false })
    renderWith(<Settings section={null} />, { ...ctx, lifecycle })
    expect(row(/^The app/).textContent).toContain('Updates when you ask')
    act(() => lifecycle.store.set({ ...lifecycle.store.get(), installable: 'prompt' }))
    expect(row(/^The app/).textContent).toContain('Install Wordado on this device')
  })

  it('marks the open section and offers the way back to the menu', async () => {
    const ctx = await setup()
    renderWith(<Settings section="languages" />, ctx)
    expect(row(/^Languages/).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('/settings')
    expect(screen.getByRole('heading', { level: 2, name: 'Languages' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Native language' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Interface language' })).toBeTruthy()
  })

  it('offers the learner’s L1 and English as the interface language, nothing else (spec §11.2)', async () => {
    const ctx = await setup()
    renderWith(<Settings section="languages" />, ctx)
    const names = screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).name === 'locale').map((r) => r.closest('label')?.textContent)
    expect(names).toEqual(['Български', 'English'])
  })
})

describe('Settings: studying (spec §7.1, §7.4, §11.1)', () => {
  it('shows the current settings', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    expect((screen.getByLabelText('New words a day') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Reviews a day, at most') as HTMLInputElement).value).toBe('100')
    expect((screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'A1 · Beginner' }) as HTMLInputElement).checked).toBe(true)
  })

  it('steps a number with − and +, saving at once, and stops at the limits', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'More: New words a day' })))
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(11)
    expect((screen.getByLabelText('New words a day') as HTMLInputElement).value).toBe('11')
    await act(async () => ctx.client.updateSettings({ newWordLimit: 0 }))
    expect((screen.getByRole('button', { name: 'Less: New words a day' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('saves a valid number when the field is left', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    await typeAndLeave('New words a day', '15')
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(15)
  })

  it.each(['', '45', '-1', '2.5', 'ten'])('refuses %j, says why at the field, and saves nothing', async (value) => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    await typeAndLeave('New words a day', value)
    const field = screen.getByLabelText('New words a day')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`Enter a whole number from 0 to ${MAX_NEW_WORD_LIMIT}.`)
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(10)
  })

  it('saves retention, audio and latency grading as they change', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /Intensive/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Play audio, and include listening exercises' })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' })))
    expect(ctx.client.snapshot.settings).toMatchObject({ retention: 'intensive', audio: false, latencyGrading: false })
  })

  it('continues automatically after a right answer unless the learner switches that off, on this device only', async () => {
    const ctx = await setup()
    const synced = ctx.client.snapshot.settings
    renderWith(<Settings section="study" />, ctx)
    const toggle = screen.getByRole('checkbox', { name: 'Continue automatically after a right answer' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toBe(
      'The next question comes by itself after a right answer. A wrong answer always waits for you. This applies to this device only.',
    )
    fireEvent.click(toggle)
    expect(toggle.checked).toBe(false)
    expect(window.localStorage.getItem(AUTO_CONTINUE_KEY)).toBe('off')
    expect(page().getByRole('status').textContent).toBe('Saved')
    // No synced setting changed.
    expect(ctx.client.snapshot.settings).toBe(synced)
    cleanup()
    renderWith(<Settings section="study" />, ctx)
    const again = screen.getByRole('checkbox', { name: 'Continue automatically after a right answer' }) as HTMLInputElement
    expect(again.checked).toBe(false)
    fireEvent.click(again)
    expect(again.checked).toBe(true)
    expect(window.localStorage.getItem(AUTO_CONTINUE_KEY)).toBeNull()
  })

  it('sets and clears a daily goal', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
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

  it('ties the goal’s and the latency setting’s hints to their checkboxes', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    const goal = screen.getByRole('checkbox', { name: 'Set a daily goal' })
    expect(document.getElementById(goal.getAttribute('aria-describedby')!)?.textContent).toBe('A day also counts toward your streak once you answer this many.')
    const latency = screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' })
    expect(document.getElementById(latency.getAttribute('aria-describedby')!)?.textContent).toBe(
      'Switch this off to be graded on whether you are right, not how quickly.',
    )
  })

  it('offers only the levels the words come in', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    const levels = within(screen.getByRole('group', { name: 'Your level' })).getAllByRole('radio')
    // The bundled sample is A1 only.
    expect(levels.map((r) => r.getAttribute('value'))).toEqual(['A1'])
  })
})

describe('Settings: audio for offline study (spec §9.3)', () => {
  it('downloads every clip of the learner’s level', async () => {
    const ctx = await setup()
    const audio = fakeAudio()
    renderWith(<Settings section="audio" />, { ...ctx, audio })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download A1 audio' })))
    expect(audio.fetched.map((c) => c.clipId).sort()).toEqual(ctx.client.levelClips('A1').map((c) => c.clipId).sort())
  })
})

describe('Settings: work that outlives its page holds the automatic update (spec §9.1)', () => {
  it('holds it until the audio download is over, though the learner left the page', async () => {
    const ctx = await setup()
    let finish!: () => void
    const audio = fakeAudio({ prefetch: () => new Promise<number>((resolve) => (finish = () => resolve(0))) })
    const lifecycle = fakeLifecycle()
    const { unmount } = renderWith(<Settings section="audio" />, { ...ctx, audio, lifecycle })
    fireEvent.click(screen.getByRole('button', { name: 'Download A1 audio' }))
    expect(lifecycle.holds).toBe(1)
    unmount()
    expect(lifecycle.holds).toBe(1)
    await act(async () => finish())
    expect(lifecycle.holds).toBe(0)
  })

  it('holds it until the export has arrived and a few seconds past the save, though the learner left the page', async () => {
    const ctx = await setup()
    let arrive!: () => void
    const api = fakeApi()
    api.exportData = () => new Promise((resolve) => (arrive = () => resolve({ name: 'wordado-export.json', json: '{}' })))
    const lifecycle = fakeLifecycle()
    const { unmount } = renderWith(<Settings section="account" />, { ...ctx, account: ana, api, lifecycle })
    fireEvent.click(screen.getByRole('button', { name: 'Download your data (JSON)' }))
    expect(lifecycle.holds).toBe(1)
    unmount()
    vi.useFakeTimers()
    try {
      await act(async () => arrive())
      expect(lifecycle.holds).toBe(1)
      vi.advanceTimersByTime(SAVE_HOLD_MS)
      expect(lifecycle.holds).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds it until a reminder is saved, though the learner left the page', async () => {
    const ctx = await setup()
    let answer!: () => void
    const reminders = fakeReminders({ enable: () => new Promise((resolve) => (answer = () => resolve('on'))) })
    const lifecycle = fakeLifecycle()
    const { unmount } = renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders, lifecycle })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' }))
    expect(lifecycle.holds).toBe(1)
    unmount()
    expect(lifecycle.holds).toBe(1)
    await act(async () => answer())
    expect(lifecycle.holds).toBe(0)
  })
})

describe('Settings: the account (spec §11)', () => {
  it('offers an account from the demo, and no export or deletion', async () => {
    const ctx = await setup()
    renderWith(<Settings section="account" />, ctx)
    expect(screen.getByText(/without an account/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download your data (JSON)' })).toBeNull()
  })

  it('downloads the export for the recorded learner and saves it under the server’s name', async () => {
    vi.mocked(saveFile).mockClear()
    const ctx = await setup()
    const api = fakeApi()
    renderWith(<Settings section="account" />, { ...ctx, account: ana, api })
    expect(screen.getByText('Signed in as ana@example.com')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download your data (JSON)' })))
    expect(api.calls).toContain('exportData')
    expect(saveFile).toHaveBeenCalledWith('wordado-export-2026-09-25.json', '{"format":"wordado-export-1"}')
  })

  it('says why the export failed and saves nothing', async () => {
    vi.mocked(saveFile).mockClear()
    const ctx = await setup()
    const api = fakeApi({
      exportData: async () => {
        throw new ApiError(409, 'wrong_user')
      },
    })
    renderWith(<Settings section="account" />, { ...ctx, account: ana, api })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download your data (JSON)' })))
    expect(screen.getByRole('alert').textContent).toBe('Your sign-in has expired. Sign in again.')
    expect(saveFile).not.toHaveBeenCalled()
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
    renderWith(<Settings section="account" />, { ...ctx, account: ana, accounts })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(screen.getByRole('dialog', { name: 'Some answers haven’t synced' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out and delete them' })))
    expect(accounts.calls).toEqual(['signOut', 'signOut force'])
  })

  it('says signing out needs a connection, and disables the button with a status while it runs', async () => {
    const ctx = await setup()
    let fail: (err: unknown) => void = () => undefined
    const accounts = fakeAccounts({
      signOut: () =>
        new Promise((_, reject) => {
          fail = reject
        }),
    })
    renderWith(<Settings section="account" />, { ...ctx, account: ana, accounts })
    const button = screen.getByRole('button', { name: 'Sign out' }) as HTMLButtonElement
    await act(async () => fireEvent.click(button))
    expect(button.disabled).toBe(true)
    expect(screen.getByText('Signing out…').getAttribute('role')).toBe('status')
    await act(async () => fail(new SignOutOffline(new Error('offline'))))
    expect(button.disabled).toBe(false)
    expect(screen.queryByText('Signing out…')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe('Signing out needs a connection. Your progress stays on this device.')
  })

  it('deletes the account only once the learner says they understand', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    renderWith(<Settings section="account" />, { ...ctx, account: ana, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Delete your account' }))
    const confirm = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }))
    expect(confirm.disabled).toBe(false)
    await act(async () => fireEvent.click(confirm))
    expect(accounts.calls).toEqual(['deleteAccount'])
  })
})

describe('Settings: the app (spec §9.1)', () => {
  it('updates automatically unless the learner switches that off, and says what it means', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    renderWith(<Settings section="app" />, { ...ctx, lifecycle })
    const toggle = page().getByRole('checkbox', { name: 'Update automatically' }) as HTMLInputElement
    expect(toggle.checked).toBe(true)
    expect(document.getElementById(toggle.getAttribute('aria-describedby')!)?.textContent).toContain('when you are not in the middle of anything')
    fireEvent.click(toggle)
    expect(lifecycle.calls).toEqual(['setAutoUpdate false'])
    expect(toggle.checked).toBe(false)
    expect(page().getByRole('status').textContent).toBe('Saved')
    fireEvent.click(toggle)
    expect(lifecycle.calls).toEqual(['setAutoUpdate false', 'setAutoUpdate true'])
    expect(toggle.checked).toBe(true)
  })

  it('does not say Saved when the browser would not keep the setting', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle()
    lifecycle.keeps = false
    renderWith(<Settings section="app" />, { ...ctx, lifecycle })
    fireEvent.click(page().getByRole('checkbox', { name: 'Update automatically' }))
    expect(page().getByRole('status').textContent).toBe('This browser could not keep the setting. It lasts until Wordado is closed.')
  })

  it('shows the setting as this device keeps it, and installation beside it where the browser offers it', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ autoUpdate: false, installable: 'prompt' })
    renderWith(<Settings section="app" />, { ...ctx, lifecycle })
    expect((page().getByRole('checkbox', { name: 'Update automatically' }) as HTMLInputElement).checked).toBe(false)
    await act(async () => fireEvent.click(page().getByRole('button', { name: 'Install' })))
    expect(lifecycle.calls).toEqual(['install'])
  })
})

describe('Settings: the placement test (spec §7.2)', () => {
  it('says why there is no test on the A1-only sample', async () => {
    const ctx = await setup()
    renderWith(<Settings section="study" />, ctx)
    expect(screen.queryByRole('link', { name: 'Find your level with a short test' })).toBeNull()
    expect(screen.getByText('A placement test opens once words of more than one level are installed.')).toBeTruthy()
  })
})

describe('Settings: words set aside (spec §7.4)', () => {
  it('lists them and brings one back', async () => {
    const ctx = await setup()
    await ctx.client.setFlag('c:hello-1' as WordId, 'suspended')
    renderWith(<Settings section="words" />, ctx)
    const list = screen.getByRole('region', { name: 'Words set aside' })
    expect(within(list).getByText('hello')).toBeTruthy()
    expect(within(list).getByText('Not now')).toBeTruthy()
    await act(async () => fireEvent.click(within(list).getByRole('button', { name: 'Bring back: hello' })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(within(list).getByText('No words are set aside.')).toBeTruthy()
    // The row went with the button pressed: focus moves to the section's heading (spec §11.1).
    expect(document.activeElement).toBe(within(list).getByRole('heading', { name: 'Words set aside' }))
  })
})

describe('Settings: reminders (spec §8.11)', () => {
  const ana = { userId: 'u1', email: 'ana@example.com' }

  it('needs an account', async () => {
    const ctx = await setup()
    renderWith(<Settings section="reminders" />, ctx)
    expect(page().getByText('Reminders come with an account.')).toBeTruthy()
  })

  it('turns on at 19:00, changes the time and the nudge, and turns off', async () => {
    const ctx = await setup()
    const reminders = fakeReminders()
    renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    const time = screen.getByLabelText('At') as HTMLInputElement
    expect(time.value).toBe('19:00')
    fireEvent.change(time, { target: { value: '07:30' } })
    await act(async () => fireEvent.blur(time))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: /streak needs today/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(reminders.calls).toEqual(['enable 1140 false', 'enable 450 false', 'enable 450 true', 'disable'])
    expect(page().getByText('Reminders are off.')).toBeTruthy()
  })

  it('saves the time once per blur, and never disables the time field', async () => {
    const ctx = await setup()
    const reminders = fakeReminders()
    renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders })
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
    renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders: fakeReminders({ support: () => 'needs-install' }) })
    const blocked = screen.getByText(/once Wordado is on your home screen/)
    expect(blocked.getAttribute('role')).toBe('status')
    cleanup()
    renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders: fakeReminders({ enable: async () => 'denied' }) })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Remind me to study' }) as HTMLInputElement).checked).toBe(false)
  })

  it('says the prompt was dismissed, not blocked, and leaves the toggle off', async () => {
    const ctx = await setup()
    renderWith(<Settings section="reminders" />, { ...ctx, account: ana, reminders: fakeReminders({ enable: async () => 'dismissed' }) })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(screen.getByText('Reminders stay off: notifications weren’t allowed.')).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Remind me to study' }) as HTMLInputElement).checked).toBe(false)
  })
})

describe('Settings: the privacy policy (spec §11)', () => {
  it('links to the policy', async () => {
    const ctx = await setup()
    renderWith(<Settings section="about" />, ctx)
    expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('https://wordado.com/en/privacy/')
  })
})
