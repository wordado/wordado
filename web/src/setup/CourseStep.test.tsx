import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { Client } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeAudio, renderWith, type RenderContext } from '../test/fixtures'
import { CourseStep } from './CourseStep'

const build = vi.hoisted(() => ({ offered: ['en', 'de'] as readonly ('en' | 'de')[] }))
vi.mock('../content/packs', async (original) => ({
  ...(await original<typeof import('../content/packs')>()),
  get OFFERED_TARGETS() {
    return build.offered
  },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  build.offered = ['en', 'de']
})

/** A brand-new demo, as the boot hands the setup over: no pack installed, no L1 chosen. */
async function fresh(): Promise<RenderContext> {
  const env = testEnv()
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  await client.startSession()
  return { env, client, audio: fakeAudio() }
}

const choice = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

describe('CourseStep (spec §8.6)', () => {
  it('lists the courses the build offers, named in the interface language, with the current one chosen and its heading focused', async () => {
    const ctx = await fresh()
    renderWith(<CourseStep onDone={() => undefined} />, { ...ctx, locale: 'de' })
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Was möchtest du lernen?' }))
    expect(choice('Englisch').checked).toBe(true)
    expect(choice('Deutsch').checked).toBe(false)
    expect(choice('Englisch').closest('label')?.getAttribute('lang')).toBe('de')
    expect(choice('Englisch').closest('fieldset')?.classList.contains('choices')).toBe(true)
  })

  it('switches to the chosen course and goes on', async () => {
    const ctx = await fresh()
    const switchCourse = vi.spyOn(ctx.client, 'switchCourse')
    const onDone = vi.fn()
    renderWith(<CourseStep onDone={onDone} />, ctx)
    fireEvent.click(choice('German'))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(switchCourse).toHaveBeenCalledWith('de')
    expect(ctx.client.snapshot.settings.course).toBe('de')
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('says why when the course cannot be saved, and stays', async () => {
    const ctx = await fresh()
    vi.spyOn(ctx.client, 'switchCourse').mockRejectedValue(new Error('disk full'))
    const onDone = vi.fn()
    renderWith(<CourseStep onDone={onDone} />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(screen.getByRole('alert').textContent).toMatch(/^Your change wasn’t saved/)
    expect(onDone).not.toHaveBeenCalled()
  })
})
