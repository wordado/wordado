import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { germanServing } from '@wordado/client-data/src/testing/sample'
import type { PackManifest } from '@wordado/core'
import { PackSwitcher } from '../app/packSwitch'
import { fakePacks, renderWith, setup } from '../test/fixtures'
import { CourseSettings } from './CourseSettings'

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

describe('Settings: the course (spec §8.6)', () => {
  it('names the current course and its native language, says what a course keeps, and offers the other course', async () => {
    const ctx = await setup()
    renderWith(<CourseSettings />, ctx)
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2, name: 'Course' }))
    expect(screen.getByText('English, from Bulgarian')).toBeTruthy()
    expect(screen.getByText('Each course keeps its own level, theme and native language; your streak and goal are shared.')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Switch to German'])
  })

  it('switching to a course started before installs it first, then switches, and stays in the app', async () => {
    const ctx = await setup()
    const german = await germanServing(ctx.env)
    const startSetup = vi.fn()
    const packs = new PackSwitcher({ fetchManifest: async () => german.manifest, fetcher: () => german.fetch })
    // German started from Bulgarian, then back to English: its pack is gone, its settings parked.
    await ctx.client.switchCourse('de')
    await ctx.client.updateSettings({ l1: 'bg', declaredLevel: 'A2' })
    await ctx.client.switchCourse('en')
    renderWith(<CourseSettings />, { ...ctx, packs, startSetup })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to German' })))
    await vi.waitFor(() => expect(ctx.client.snapshot.settings).toMatchObject({ course: 'de', l1: 'bg', declaredLevel: 'A2' }))
    expect(ctx.client.snapshot.course).toEqual({ target: 'de', l1: 'bg' })
    expect(startSetup).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe('German, from Bulgarian')
    expect(screen.queryByText(/when they have downloaded/)).toBeNull()
  })

  it('shows the download of a course being installed', async () => {
    const ctx = await setup()
    const packs = fakePacks()
    renderWith(<CourseSettings />, { ...ctx, packs })
    act(() => packs.store.set({ phase: 'downloading', client: ctx.client, course: { target: 'de', l1: 'bg' }, received: 5, total: 10 }))
    expect(screen.getByRole('progressbar')).toBeTruthy()
  })

  it('a switch whose pack cannot be had changes nothing, says so, and can be tried again', async () => {
    const ctx = await setup()
    const german = await germanServing(ctx.env)
    let offline = true
    const packs = new PackSwitcher({
      fetchManifest: async (): Promise<PackManifest> => {
        if (offline) throw new Error('offline')
        return german.manifest
      },
      fetcher: () => german.fetch,
    })
    await ctx.client.switchCourse('de')
    await ctx.client.updateSettings({ l1: 'bg' })
    await ctx.client.switchCourse('en')
    const before = ctx.client.snapshot.settings
    renderWith(<CourseSettings />, { ...ctx, packs })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to German' })))

    expect((await screen.findByRole('alert')).textContent).toContain('The words could not be downloaded. Check your connection and try again.')
    expect(ctx.client.snapshot.settings).toEqual(before)
    expect(ctx.client.snapshot.course).toEqual({ target: 'en', l1: 'bg' })
    expect(screen.getByRole('status').textContent).toBe('English, from Bulgarian')

    offline = false
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Try again' })))
    await vi.waitFor(() => expect(ctx.client.snapshot.settings).toMatchObject({ course: 'de', l1: 'bg' }))
    expect(ctx.client.snapshot.course).toEqual({ target: 'de', l1: 'bg' })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('says a switch is pending while the course the settings name is not installed (a switch synced while offline)', async () => {
    const ctx = await setup()
    // Another device switched to German, started before; this one has not got its words yet.
    await ctx.client.switchCourse('de')
    await ctx.client.updateSettings({ l1: 'bg' })
    renderWith(<CourseSettings />, ctx)
    expect(screen.getByText('Your words switch to German when they have downloaded.')).toBeTruthy()
  })

  it('switching to a new course opens its setup at the language', async () => {
    const ctx = await setup()
    const startSetup = vi.fn()
    renderWith(<CourseSettings />, { ...ctx, startSetup })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to German' })))
    expect(ctx.client.snapshot.settings.course).toBe('de')
    expect(ctx.client.snapshot.settings.l1).toBeNull()
    expect(startSetup).toHaveBeenCalledTimes(1)
  })

  it('writes nothing when the current course is chosen again', async () => {
    const ctx = await setup()
    const switchCourse = vi.spyOn(ctx.client, 'switchCourse')
    renderWith(<CourseSettings />, ctx)
    // The current course is no choice to make: only the other one is offered.
    expect(screen.queryByRole('button', { name: 'Switch to English' })).toBeNull()
    expect(switchCourse).not.toHaveBeenCalled()
  })

  it('on a build that does not offer the synced course, offers the way back to one it does', async () => {
    build.offered = ['en']
    const ctx = await setup()
    await ctx.client.switchCourse('de')
    await ctx.client.updateSettings({ l1: 'bg' })
    renderWith(<CourseSettings />, ctx)
    expect(screen.getByText('German, from Bulgarian')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Switch to English'])
  })

  it('says why when the switch cannot be saved', async () => {
    const ctx = await setup()
    const startSetup = vi.fn()
    vi.spyOn(ctx.client, 'switchCourse').mockRejectedValue(new Error('disk full'))
    renderWith(<CourseSettings />, { ...ctx, startSetup })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to German' })))
    expect(screen.getByRole('alert').textContent).toMatch(/^Your change wasn’t saved/)
    expect(startSetup).not.toHaveBeenCalled()
  })
})
