import type { PackFetcher } from '@wordado/client-data'
import { validateManifest, type AudioClip, type PackManifest } from '@wordado/core'

/** The bundled sample (spec §8.6). Plan 7 adds the CDN's manifest beside it. */
export const SAMPLE_MANIFEST_URL = '/content/sample/manifest.json'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const pageUrl = () => globalThis.location?.href ?? 'http://localhost/'

/** The manifest's absolute URL: what every pack and clip URL is relative to (plan 3 contract). */
export function manifestBase(manifestUrl: string, page: string = pageUrl()): URL {
  return new URL(manifestUrl, page)
}

/** Fetches and validates a manifest (plan 3 contract: the manifest goes through `validateManifest` first). */
export async function fetchManifest(manifestUrl: string, fetchFn: Fetch = (i, init) => fetch(i, init)): Promise<PackManifest> {
  const response = await fetchFn(manifestBase(manifestUrl).href, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`The manifest could not be fetched (${response.status})`)
  const result = validateManifest(await response.json())
  if (result.status === 'ok') return result.manifest
  if (result.status === 'unsupported_schema') throw new Error(`The manifest's schema ${result.schemaVersion} needs a newer app`)
  throw new Error(`The manifest is invalid: ${result.errors[0]?.path}: ${result.errors[0]?.message}`)
}

/** client-data's PackFetcher on the web: the pack's URL resolved against the manifest's. Throws on any failure. */
export function packFetcher(manifestUrl: string, fetchFn: Fetch = (i, init) => fetch(i, init)): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(new URL(descriptor.url, manifestBase(manifestUrl)).href)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

export function clipUrl(clip: AudioClip, manifestUrl: string): string {
  return new URL(clip.url, manifestBase(manifestUrl)).href
}
