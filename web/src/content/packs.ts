import type { PackFetcher } from '@wordado/client-data'
import { validateManifest, type AudioClip, type PackManifest } from '@wordado/core'
import type { AccountRecord } from '../account/storage'

/** The bundled sample (spec §8.6): the demo's content, and a learner's where no CDN manifest is configured. */
export const SAMPLE_MANIFEST_URL = '/content/sample/manifest.json'

/** A learner's manifest (spec §9.3): the CDN's when the build names one (plan 7), otherwise the bundled sample. */
export const CONTENT_MANIFEST_URL: string = import.meta.env.VITE_CONTENT_MANIFEST_URL || SAMPLE_MANIFEST_URL

/** The demo always studies the bundled sample (spec §8.6); a signed-in learner studies the CDN's packs. */
export function manifestUrlFor(account: AccountRecord | null, learnerManifest: string = CONTENT_MANIFEST_URL): string {
  return account === null ? SAMPLE_MANIFEST_URL : learnerManifest
}

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
  if (result.status === 'ok') {
    // Each pack's URL is relative to its manifest (plan 3 contract): resolved here, once, so the fetcher needs no manifest.
    const base = manifestBase(manifestUrl)
    return { ...result.manifest, packs: result.manifest.packs.map((pack) => ({ ...pack, url: new URL(pack.url, base).href })) }
  }
  if (result.status === 'unsupported_schema') throw new Error(`The manifest's schema ${result.schemaVersion} needs a newer app`)
  throw new Error(`The manifest is invalid: ${result.errors[0]?.path}: ${result.errors[0]?.message}`)
}

/** client-data's PackFetcher on the web: the pack's URL as `fetchManifest` resolved it. Throws on any failure. */
export function packFetcher(fetchFn: Fetch = (i, init) => fetch(i, init)): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(descriptor.url)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

export function clipUrl(clip: AudioClip, manifestUrl: string): string {
  return new URL(clip.url, manifestBase(manifestUrl)).href
}
