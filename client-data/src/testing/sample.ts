import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CefrLevel, Corpus, PackManifest } from '@wordado/core'
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

/**
 * The sample with its entries spread across `levels` in equal runs, in the
 * order the corpus lists them. The sample is all A1; the placement test needs
 * bands, and nothing else about the entries changes.
 */
export function leveledCorpus(corpus: Corpus, levels: readonly CefrLevel[]): Corpus {
  const entries = [...corpus.entries.values()]
  const per = Math.ceil(entries.length / levels.length)
  return {
    ...corpus,
    entries: new Map(entries.map((entry, i) => [entry.entryId, { ...entry, level: levels[Math.floor(i / per)]! }])),
  }
}
