import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/i18n'
import { fakeAccounts, fakeAudio, fakeLifecycle, fakeReminders } from '../test/fixtures'
import { fakeApi } from '../test/fakeApi'
import type { Backend } from '../storage/protocol'
import { Boot, type LockPort } from './boot'
import { Root } from './Root'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

async function renderRoot(options: { free?: boolean; backend?: Backend } = {}) {
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
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: options.backend ?? 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    },
    () => lock,
  )
  render(
    <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
      <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle() }} />
    </I18nProvider>,
  )
  await act(() => boot.start())
  return boot
}

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
    expect(await screen.findByText(/done, \d+ to go/)).toBeTruthy()
  })

  it('switches the interface language', async () => {
    await renderRoot()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Български' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 нови думи')
    expect(screen.getByRole('button', { name: 'Български' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('shows a storage message when opening the database fails', async () => {
    const env = testEnv()
    const lock: LockPort = { acquire: async () => true, takeOver: async () => undefined }
    const boot = new Boot(
      {
        env,
        l1: 'bg',
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
        <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle() }} />
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
      { env, l1: 'bg', openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }), fetchManifest: async () => sampleManifest, fetchPack: sampleFetcher },
      () => lock,
    )
    render(
      <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
        <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined, api: fakeApi(), accounts: fakeAccounts(), reminders: fakeReminders(), lifecycle: fakeLifecycle() }} />
      </I18nProvider>,
    )
    await act(() => boot.start())
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wordado could not check whether it is open in another tab. Try again.')
  })
})
