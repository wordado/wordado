import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { Client, type PackFetcher } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { SAMPLE_DIR, sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import type { PackManifest } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountRecord } from '../account/storage'
import { PackSwitcher } from '../app/packSwitch'
import { fakeAudio, fakeReminders, renderWith, type RenderContext } from '../test/fixtures'
import { Setup } from './Setup'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** A switcher that really installs from `manifest`. */
const packsFrom = (manifest: PackManifest, fetchPack: PackFetcher) => new PackSwitcher({ fetchManifest: async () => manifest, fetcher: () => fetchPack })

/**
 * The sample's Bulgarian pack with its last unit (and that unit's words) moved up to B1: a corpus whose units span
 * two levels, A1 and B1.
 */
function twoLevels(): { manifest: PackManifest; fetchPack: PackFetcher } {
  const descriptor = sampleManifest.packs.find((p) => p.l1 === 'bg')!
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, descriptor.url), 'utf8')) as {
    units: { unit_id: string; level: string }[]
    entries: { unit_id: string; level: string }[]
  }
  const last = pack.units[pack.units.length - 1]!.unit_id
  for (const unit of pack.units) if (unit.unit_id === last) unit.level = 'B1'
  for (const entry of pack.entries) if (entry.unit_id === last) entry.level = 'B1'
  const bytes = new TextEncoder().encode(JSON.stringify(pack))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    manifest: { ...sampleManifest, packs: [{ ...descriptor, sha256, bytes: bytes.byteLength }] },
    fetchPack: async () => bytes,
  }
}

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
    expect(screen.getByText('Not sure? You can take a short placement test later in Settings.')).toBeTruthy()
    const a1 = screen.getByRole('radio', { name: /^A1/ }) as HTMLInputElement
    expect(a1.checked).toBe(true)
    expect(screen.queryByRole('radio', { name: /^A2/ })).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^B1/ })))
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('B1')
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
