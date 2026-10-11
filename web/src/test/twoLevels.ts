import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PackFetcher } from '@wordado/client-data'
import { SAMPLE_DIR, sampleManifest } from '@wordado/client-data/src/testing/sample'
import type { PackManifest } from '@wordado/core'
import { PackSwitcher } from '../app/packSwitch'

/** A switcher that really installs from `manifest`. */
export const packsFrom = (manifest: PackManifest, fetchPack: PackFetcher) => new PackSwitcher({ fetchManifest: async () => manifest, fetcher: () => fetchPack })

/**
 * The sample's Bulgarian pack with its last unit (and that unit's words) moved up to B1: a corpus whose units span
 * two levels, A1 and B1.
 */
export function twoLevels(level = 'B1'): { manifest: PackManifest; fetchPack: PackFetcher } {
  const descriptor = sampleManifest.packs.find((p) => p.l1 === 'bg')!
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, descriptor.url), 'utf8')) as {
    units: { unit_id: string; level: string }[]
    entries: { unit_id: string; level: string }[]
  }
  const last = pack.units[pack.units.length - 1]!.unit_id
  for (const unit of pack.units) if (unit.unit_id === last) unit.level = level
  for (const entry of pack.entries) if (entry.unit_id === last) entry.level = level
  const bytes = new TextEncoder().encode(JSON.stringify(pack))
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return {
    manifest: { ...sampleManifest, packs: [{ ...descriptor, sha256, bytes: bytes.byteLength }] },
    fetchPack: async () => bytes,
  }
}
