import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { Client } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../app/App'
import { fakeAudio, renderWith, setup, type RenderContext } from '../test/fixtures'
import { twoLevels } from '../test/twoLevels'

afterEach(cleanup)
beforeEach(() => window.history.replaceState(null, '', '/'))

/** A learner whose course has two levels, A1 and A2, as an account's has after the demo's one. */
async function withCourse(): Promise<RenderContext> {
  const env = testEnv()
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  const course = twoLevels('A2')
  await client.installPacks(course.manifest, course.fetchPack)
  await client.startSession()
  return { env, client, audio: fakeAudio() }
}

const app = (asked: () => void, askLevel = true) => <App resumed={false} setup={false} onFinishSetup={() => undefined} askLevel={askLevel} onLevelAsked={asked} />

describe('the level, asked once after the demo was carried into an account', () => {
  it('stands in place of Today, with the level to choose and the test, and Continue ends it', async () => {
    const ctx = await withCourse()
    const asked = vi.fn()
    renderWith(app(asked), ctx)
    expect(screen.getByRole('heading', { level: 1, name: 'Where do you start?' })).toBeTruthy()
    expect(screen.getByText(/^Your account has the whole course now, at every level\. Words below your level count as known/)).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Your level in English' })).toBeTruthy()
    // The rest of the app stays within reach.
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Find your level with a short test' })).toBeTruthy()
    // One way on: no Skip and no Start studying beside it.
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start studying' })).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /^A2/ })))
    expect(ctx.client.snapshot.settings.declaredLevel).toBe('A2')
    // Choosing does not end it: Continue does.
    expect(asked).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(asked).toHaveBeenCalledTimes(1)
  })

  it('gives way to Today once it was asked', async () => {
    renderWith(app(() => undefined, false), await withCourse())
    expect(screen.queryByRole('heading', { name: 'Where do you start?' })).toBeNull()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
  })

  it('runs the placement test over the whole screen, and comes back to the question', async () => {
    const ctx = await withCourse()
    renderWith(app(() => undefined), ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Find your level with a short test' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Find your level' })).toBeTruthy()
    expect(document.querySelector('.app')?.classList.contains('is-focus')).toBe(true)
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to the setup' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Where do you start?' })).toBeTruthy()
    expect(document.querySelector('.app')?.classList.contains('is-focus')).toBe(false)
  })

  it('is asked on Today only', async () => {
    window.history.replaceState(null, '', '/settings')
    renderWith(app(() => undefined), await withCourse())
    expect(screen.queryByRole('heading', { name: 'Where do you start?' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeTruthy()
  })

  it('is not asked of a course with one level: there is nothing to choose', async () => {
    renderWith(app(() => undefined), await setup())
    expect(screen.queryByRole('heading', { name: 'Where do you start?' })).toBeNull()
  })
})
