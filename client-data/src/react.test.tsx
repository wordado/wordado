// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Grade, type PackManifest } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from './client'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { PackFetcher } from './packs'
import { ClientProvider, useClient, useProgress, useSessionPlan, useSyncStatus } from './react'
import { testEnv } from './testing/testEnv'

// happy-dom replaces the global URL class, so the path is built from the string form of import.meta.url.
const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pipeline', 'samples', 'a1-bg')
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

function Home() {
  const plan = useSessionPlan()
  const progress = useProgress()
  const sync = useSyncStatus()
  return (
    <div>
      <span data-testid="new">{plan?.newWords.length ?? -1}</span>
      <span data-testid="tier-new">{progress?.tiers.new ?? -1}</span>
      <span data-testid="phase">{sync.phase}</span>
    </div>
  )
}

afterEach(cleanup)

describe('hooks', () => {
  it('render the snapshot and follow it as the client changes', async () => {
    const client = await Client.open({ driver: nodeSqliteDriver(), env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    render(
      <ClientProvider client={client}>
        <Home />
      </ClientProvider>,
    )
    expect(screen.getByTestId('new').textContent).toBe('10')
    expect(screen.getByTestId('tier-new').textContent).toBe('60')
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    await act(async () => {
      await client.answer({ wordId: 'c:hello-1', mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1200, practice: false })
    })
    expect(screen.getByTestId('new').textContent).toBe('9')
    expect(screen.getByTestId('tier-new').textContent).toBe('59')
  })

  it('refuse to run outside a provider', () => {
    function Bare() {
      useClient()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/ClientProvider/)
  })
})
