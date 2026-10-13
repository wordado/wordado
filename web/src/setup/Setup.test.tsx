import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { Client, ITEM_SETTLE_MS, type PackFetcher } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import type { PackManifest } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../account/storage'
import { fakeAudio, fakeReminders, renderWith, type RenderContext } from '../test/fixtures'
import { packsFrom, twoLevels } from '../test/twoLevels'
import { Setup } from './Setup'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A brand-new demo: no pack installed, no L1 chosen, as the boot hands the setup over (plan 11). */
async function fresh(options: { manifest?: PackManifest; fetchPack?: PackFetcher } = {}): Promise<RenderContext> {
  const env = testEnv()
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  await client.startSession()
  return { env, client, audio: fakeAudio(), packs: packsFrom(options.manifest ?? sampleManifest, options.fetchPack ?? sampleFetcher) }
}

/** Language → Continue, and waits for the install to finish. */
async function pastLanguage() {
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
}

const account = { userId: 'u1', email: 'learner@example.com' } as unknown as AccountRecord

describe('Setup, the demo (plan 11)', () => {
  it('owns the page’s h1 and starts at the language, with no counter before the words are known', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    expect(screen.getByRole('heading', { level: 1, name: 'Set up Wordado' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Which language do you speak?' }))
    expect(screen.queryByText(/^Step /)).toBeNull()
  })

  it('is one card in the Settings look, under its title (Task 7a)', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    const card = screen.getByRole('heading', { level: 2, name: 'Which language do you speak?' }).closest('.panel')
    expect(card?.classList.contains('form-section')).toBe(true)
    expect(card?.contains(screen.getByRole('heading', { level: 1, name: 'Set up Wordado' }))).toBe(false)
    await pastLanguage()
    const theme = screen.getByRole('heading', { level: 2, name: 'What do you want English for?' })
    expect(theme.closest('.panel')?.classList.contains('form-section')).toBe(true)
    expect(screen.getByText('Step 2 of 3').closest('.panel')).toBeNull()
  })

  it('shows each theme as a row button, named by the theme and described by its description (Task 7a)', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    const row = screen.getByRole('button', { name: 'Daily life' })
    expect(row.classList.contains('settings-row')).toBe(true)
    expect(row.closest('ul')?.classList.contains('settings-rows')).toBe(true)
    expect(row.querySelector('.settings-row-icon svg')).not.toBeNull()
    const note = document.getElementById(row.getAttribute('aria-describedby')!)
    expect(note?.textContent).not.toBe('')
    expect(row.contains(note)).toBe(true)
    // With no Continue of its own, the step's primary way on is Start studying.
    expect(screen.getByRole('button', { name: 'Start studying' }).classList.contains('primary')).toBe(true)
    expect(screen.getByRole('button', { name: 'Skip' }).classList.contains('link-button')).toBe(true)
  })

  it('goes from the language to the theme, skipping the level the sample does not have, and counts only the steps that show', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    const heading = screen.getByRole('heading', { level: 2, name: 'What do you want English for?' })
    expect(document.activeElement).toBe(heading)
    expect(screen.queryByRole('heading', { name: 'Your English level' })).toBeNull()
    expect(screen.getByText('Step 2 of 3')).toBeTruthy()
  })

  it('choosing a theme writes it and moves on to the goal, whose heading takes focus', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Daily life' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'A daily goal' }))
    expect(screen.getByText('Step 3 of 3')).toBeTruthy()
    // The last step has nothing to skip to: Start studying is its one way on.
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  })

  it('Skip on the theme moves on without writing one', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('heading', { level: 2, name: 'A daily goal' })).toBeTruthy()
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('Start studying finishes the setup', async () => {
    const ctx = await fresh()
    const onFinish = vi.fn()
    renderWith(<Setup onFinish={onFinish} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('Start studying on the goal step finishes the setup (review, fix 1)', async () => {
    const ctx = await fresh()
    const onFinish = vi.fn()
    renderWith(<Setup onFinish={onFinish} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('heading', { level: 2, name: 'A daily goal' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
  })

  it('says so when a theme cannot be saved, and stays on the theme (review, fix 1)', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    vi.spyOn(ctx.client, 'updateSettings').mockRejectedValue(new Error('disk full'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Daily life' })))
    expect(screen.getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
    expect(screen.getByRole('heading', { level: 2, name: 'What do you want English for?' })).toBeTruthy()
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('sets a daily goal on the goal step, and offers no reminders to the demo', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByText('Optional. You can set it or change it any time in Settings.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Set a daily goal' })))
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(20)
    expect(screen.getByRole('textbox', { name: 'Answers a day' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Reminders' })).toBeNull()
    expect(screen.queryByRole('checkbox', { name: 'Remind me to study' })).toBeNull()
  })
})

describe('Setup, a corpus with two levels (plan 11)', () => {
  it('shows the level with A1 preselected, and choosing B1 writes it', async () => {
    const ctx = await fresh(twoLevels())
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Your English level' }))
    expect(screen.getByText('Step 2 of 4')).toBeTruthy()
    expect(screen.getByText('A1 · Beginner', { selector: 'p.note' })).toBeTruthy()
    const a1 = screen.getByRole('radio', { name: /^A1/ }) as HTMLInputElement
    expect(a1.checked).toBe(true)
    // Settings' segmented level control (Task 7a): every radio in one segmented group.
    const group = a1.closest('.segmented')
    expect(group?.closest('fieldset')?.classList.contains('segmented-field')).toBe(true)
    expect(group?.querySelectorAll('input[type="radio"]').length).toBe(screen.getAllByRole('radio').length)
    // Continue is the step's primary: Start studying is not a second one.
    expect(screen.getByRole('button', { name: 'Continue' }).classList.contains('primary')).toBe(true)
    expect(screen.getByRole('button', { name: 'Start studying' }).classList.contains('primary')).toBe(false)
    expect(screen.queryByRole('radio', { name: /^A2/ })).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^B1/ })))
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('B1')
    expect(screen.getByText('B1 · Intermediate', { selector: 'p.note' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(screen.getByRole('heading', { level: 2, name: 'What do you want English for?' })).toBeTruthy()
    expect(screen.getByText('Step 3 of 4')).toBeTruthy()
  })

  it('says so when the level cannot be saved (review, fix 1)', async () => {
    const ctx = await fresh(twoLevels())
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    vi.spyOn(ctx.client, 'updateSettings').mockRejectedValue(new Error('disk full'))
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^B1/ })))
    expect(screen.getByRole('alert').textContent).toBe('Your change wasn’t saved: Something went wrong. Try again.')
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A1')
  })

  it('opens the placement test on the level step, over the whole screen, and comes back with nothing changed when it is left', async () => {
    const ctx = await fresh(twoLevels('A2'))
    const onFocus = vi.fn()
    renderWith(<Setup onFinish={() => undefined} onFocus={onFocus} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Find your level with a short test' }))
    expect(onFocus).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('heading', { level: 1, name: 'Find your level' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Set up Wordado' })).toBeNull()
    // The way back is the setup, not Settings: there is no Settings yet.
    expect(screen.queryByRole('link', { name: 'Back to settings' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the setup' }))
    expect(onFocus).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Your English level' }))
    expect(screen.getByText('Step 2 of 4')).toBeTruthy()
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A1')
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('comes back from the test with its level chosen, says so, and lets it be changed', async () => {
    const ctx = await fresh(twoLevels('A2'))
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^A2/ })))
    fireEvent.click(screen.getByRole('button', { name: 'Find your level with a short test' }))
    for (let i = 0; i < 40 && document.querySelector('.hw-word'); i += 1) {
      ctx.env.advance(ITEM_SETTLE_MS + 1_000)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I don’t know' })))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level: A1')
    // Keeping the level that was chosen is a way back too.
    expect(screen.getByRole('button', { name: 'Keep A2' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use A1' })))
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Your English level' }))
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A1')
    expect((screen.getByRole('radio', { name: /^A1/ }) as HTMLInputElement).checked).toBe(true)
    expect(screen.getByRole('status').textContent).toBe('The test placed you at A1. You can still change it.')
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^A2/ })))
    expect(screen.queryByRole('status')).toBeNull()
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A2')
  })

  it('reached by the test’s own address, starts the test straight after the language and comes back to the level step (#213)', async () => {
    const ctx = await fresh(twoLevels('A2'))
    const onFocus = vi.fn()
    renderWith(<Setup onFinish={() => undefined} onFocus={onFocus} startWithTest />, ctx)
    // The language still comes first: the test needs its words.
    expect(screen.getByRole('heading', { level: 1, name: 'Set up Wordado' })).toBeTruthy()
    await pastLanguage()
    expect(onFocus).toHaveBeenLastCalledWith(true)
    expect(screen.getByRole('heading', { level: 1, name: 'Find your level' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the setup' }))
    expect(onFocus).toHaveBeenLastCalledWith(false)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Your English level' }))
    expect(screen.getByText('Step 2 of 4')).toBeTruthy()
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A1')
  })

  it('reached by the test’s own address where the test cannot run, is the setup as ever (#213)', async () => {
    const ctx = await fresh(twoLevels())
    const onFocus = vi.fn()
    renderWith(<Setup onFinish={() => undefined} onFocus={onFocus} startWithTest />, ctx)
    await pastLanguage()
    expect(screen.getByRole('heading', { level: 2, name: 'Your English level' })).toBeTruthy()
    expect(onFocus).not.toHaveBeenCalledWith(true)
  })

  it('does not offer the test where it cannot run: the levels have a gap', async () => {
    const ctx = await fresh(twoLevels())
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    expect(screen.getByRole('heading', { level: 2, name: 'Your English level' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Find your level with a short test' })).toBeNull()
    expect(screen.queryByText(/^Not sure\?/)).toBeNull()
  })

  it('Skip leaves A1', async () => {
    const ctx = await fresh(twoLevels())
    renderWith(<Setup onFinish={() => undefined} />, ctx)
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('heading', { level: 2, name: 'What do you want English for?' })).toBeTruthy()
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A1')
  })

  it('Start studying from the level calls onFinish with nothing else written', async () => {
    const ctx = await fresh(twoLevels())
    const onFinish = vi.fn()
    renderWith(<Setup onFinish={onFinish} />, ctx)
    await pastLanguage()
    const before = ctx.client.snapshot.settings
    const write = vi.spyOn(ctx.client, 'updateSettings')
    fireEvent.click(screen.getByRole('button', { name: 'Start studying' }))
    expect(onFinish).toHaveBeenCalledTimes(1)
    expect(write).not.toHaveBeenCalled()
    expect(ctx.client.snapshot.settings).toEqual(before)
  })
})

describe('Setup, the goal for an account (plan 11)', () => {
  it('offers reminders when the device supports them, under the step’s own heading', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, { ...ctx, account, reminders: fakeReminders({ support: () => 'supported' }) })
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Reminders' })).toBeTruthy()
    expect(screen.getByRole('checkbox', { name: 'Remind me to study' })).toBeTruthy()
  })

  it('offers none where they cannot work', async () => {
    const ctx = await fresh()
    renderWith(<Setup onFinish={() => undefined} />, { ...ctx, account, reminders: fakeReminders({ support: () => 'unsupported' }) })
    await pastLanguage()
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('heading', { name: 'Reminders' })).toBeNull()
  })
})
