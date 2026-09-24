import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PackManifest } from '@wordado/core'
import { Client } from '../client'
import { nodeSqliteDriver } from '../drivers/nodeSqlite'
import type { PackFetcher } from '../packs'
import { testEnv, type TestEnv } from './testEnv'

/**
 * The bundled A1 Bulgarian sample (plan 3). Node only. Built from the string
 * form of import.meta.url: happy-dom replaces the global URL class.
 */
export const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pipeline', 'samples', 'a1-bg')

export const sampleManifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest

export const sampleFetcher: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

/** A demo client over an in-memory database with the sample active. */
export async function openSampleClient(env: TestEnv = testEnv()): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  await client.installPacks(sampleManifest, sampleFetcher)
  await client.startSession()
  return client
}
