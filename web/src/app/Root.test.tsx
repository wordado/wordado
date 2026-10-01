import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/i18n'
import { fakeAccounts, fakeAudio, fakeCredits, fakeFixNotices, fakeLifecycle, fakePacks, fakeReminders } from '../test/fixtures'
import { chosenL1 } from '../test/disk'
import { fakeApi } from '../test/fakeApi'
import type { Backend } from '../storage/protocol'
import { Boot, type LockPort } from './boot'
import { PackSwitcher } from './packSwitch'
import { Root } from './Root'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

async function renderRoot(options: { free?: boolean; backend?: Backend; fresh?: boolean } = {}) {
  let owner = options.free ?? true
  const lock: LockPort = {
    acquire: async () => owner,
    takeOver: async () => {
      owner = true
    },
  }
  const env = testEnv()
  const boot = new Boot(
    {
      env,
      l1: () => 'bg',
      // The learner has chosen Bulgarian already, so the app opens without the first-run setup (plan 11); a `fresh` file opens in it.
      openDriver: async () => ({ driver: options.fresh ? nodeSqliteDriver() : await chosenL1(nodeSqliteDriver()), backend: options.backend ?? 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    },
    () => lock,
  )
  render(
    <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
      <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle(), credits: fakeCredits(), fixNotices: fakeFixNotices(), packs: options.fresh ? samplePacks() : fakePacks() }} />
    </I18nProvider>,
  )
  await act(() => boot.start())
  return boot
}

/** A switcher that installs the sample, as the setup's Language step needs. */
const samplePacks = () => new PackSwitcher({ fetchManifest: async () => sampleManifest, fetcher: () => sampleFetcher })

describe('Root', () => {
  it('opens on today, in the demo', async () => {
    await renderRoot()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(screen.getByText('You are trying Wordado. Your progress stays on this device.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('says when the database is open in another tab, and takes it over', async () => {
    await renderRoot({ free: false })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wordado is open in another tab.')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use Wordado here' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(document.activeElement?.tagName).toBe('MAIN')
  })

  it('warns that nothing will be kept on the in-memory fallback (spec §9.1)', async () => {
    await renderRoot({ backend: 'memory' })
    expect(screen.getByText(/can’t keep your progress/)).toBeTruthy()
  })

  it('navigates between screens and marks the current one', async () => {
    await renderRoot()
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Path' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your path')
    expect(screen.getByRole('link', { name: 'Path' }).getAttribute('aria-current')).toBe('page')
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Wordado' })))
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Start studying' })))
    expect(await screen.findByRole('progressbar', { name: 'Session progress' })).toBeTruthy()
  })

  it('hides the masthead, navigation and banners while studying, and brings them back after', async () => {
    await renderRoot()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Start studying' })))
    await screen.findByRole('progressbar', { name: 'Session progress' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByText(/You are trying Wordado/)).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Back to today' })))
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
  })

  it('switches the interface language', async () => {
    await renderRoot()
    fireEvent.click(screen.getByRole('button', { name: 'Interface language: English (EN)' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Български' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 нови думи')
    expect(screen.getByRole('button', { name: 'Език на интерфейса: Български (BG)' }).textContent).toBe('BG')
  })

  it('opens a new learner in the first-run setup, without the navigation or banners (plan 11)', async () => {
    await renderRoot({ fresh: true })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Set up Wordado')
    expect(screen.getByRole('heading', { level: 2, name: 'Which language do you speak?' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '10 new words' })).toBeNull()
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
    expect(screen.queryByText(/You are trying Wordado/)).toBeNull()
    // The masthead's first row stays: the wordmark, the interface language and the account.
    expect(screen.getByRole('link', { name: 'Wordado' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Interface language: English (EN)' })).toBeTruthy()
  })

  it('shows Sign in during the setup when the route asks for it', async () => {
    window.history.replaceState(null, '', '/signin')
    await renderRoot({ fresh: true })
    expect(screen.queryByRole('heading', { name: 'Set up Wordado' })).toBeNull()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Create an account or sign in')
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull()
  })

  it('opens today once the setup is finished, focused, with the navigation back', async () => {
    const boot = await renderRoot({ fresh: true })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Set up Wordado')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Start studying' })))
    expect(boot.store.get()).toMatchObject({ status: 'ready', setup: false })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy()
    expect(document.activeElement?.tagName).toBe('MAIN')
  })

  it('renders today after finishSetup()', async () => {
    const boot = await renderRoot({ fresh: true })
    const state = boot.store.get()
    if (state.status !== 'ready') throw new Error('not ready')
    await act(async () => void (await state.client.changeL1('bg', sampleManifest, sampleFetcher)))
    act(() => boot.finishSetup())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
  })

  it('shows a storage message when opening the database fails', async () => {
    const env = testEnv()
    const lock: LockPort = { acquire: async () => true, takeOver: async () => undefined }
    const boot = new Boot(
      {
        env,
        l1: () => 'bg',
        openDriver: async () => {
          throw new Error('disk unavailable')
        },
        fetchManifest: async () => sampleManifest,
        fetchPack: sampleFetcher,
      },
      () => lock,
    )
    render(
      <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
        <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle(), credits: fakeCredits(), fixNotices: fakeFixNotices(), packs: fakePacks() }} />
      </I18nProvider>,
    )
    await act(() => boot.start())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Wordado could not open its storage in this browser. Try again, or use another browser.',
    )
  })

  it('shows a lock message when the tab lock fails', async () => {
    const env = testEnv()
    const lock: LockPort = {
      acquire: async () => {
        throw new Error('Locks are not available in this context')
      },
      takeOver: async () => undefined,
    }
    const boot = new Boot(
      { env, l1: () => 'bg', openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }), fetchManifest: async () => sampleManifest, fetchPack: sampleFetcher },
      () => lock,
    )
    render(
      <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
        <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle(), credits: fakeCredits(), fixNotices: fakeFixNotices(), packs: fakePacks() }} />
      </I18nProvider>,
    )
    await act(() => boot.start())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wordado could not check whether it is open in another tab. Try again.')
  })
})
