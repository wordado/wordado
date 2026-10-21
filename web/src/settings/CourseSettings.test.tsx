import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
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

  it('switching to a course already started installs it and stays in the app', async () => {
    const ctx = await setup()
    const startSetup = vi.fn()
    const packs = fakePacks()
    // German started from Spanish, then back to English.
    await ctx.client.switchCourse('de')
    await ctx.client.updateSettings({ l1: 'es' })
    await ctx.client.switchCourse('en')
    renderWith(<CourseSettings />, { ...ctx, packs, startSetup })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch to German' })))
    expect(ctx.client.snapshot.settings).toMatchObject({ course: 'de', l1: 'es' })
    expect(startSetup).not.toHaveBeenCalled()
    expect(screen.getByText('German, from Spanish')).toBeTruthy()
    // The course watcher installs it; the page shows that download, as the native-language page does.
    act(() => packs.store.set({ phase: 'downloading', client: ctx.client, course: { target: 'de', l1: 'es' }, received: 5, total: 10 }))
    expect(screen.getByRole('progressbar')).toBeTruthy()
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
