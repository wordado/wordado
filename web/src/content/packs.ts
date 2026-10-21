import type { PackFetcher } from '@wordado/client-data'
import { TARGETS, validateManifest, type AudioClip, type PackManifest, type Target } from '@wordado/core'
import type { AccountRecord } from '../account/storage'

/** The bundled sample (spec §8.6): the demo's content, and a learner's where no CDN manifest is configured. */
export const SAMPLE_MANIFEST_URL = '/content/sample/manifest.json'

/** A learner's manifest (spec §9.3): the CDN's when the build names one (plan 7), otherwise the bundled sample. */
export const CONTENT_MANIFEST_URL: string = import.meta.env.VITE_CONTENT_MANIFEST_URL || SAMPLE_MANIFEST_URL

/** A visitor's manifest (spec 2026-10-12 §4.1): the trial's when the build names one, otherwise the bundled sample. */
export const TRIAL_MANIFEST_URL: string = import.meta.env.VITE_TRIAL_MANIFEST_URL || SAMPLE_MANIFEST_URL

/** A target's manifest sits beside English's, in a folder named after the target (spec §5.1). */
export function targetManifestUrl(manifestUrl: string, target: string): string {
  if (target === 'en') return manifestUrl
  const slash = manifestUrl.lastIndexOf('/')
  return `${manifestUrl.slice(0, slash + 1)}${target}/${manifestUrl.slice(slash + 1)}`
}

/** The courses this build offers (spec §5.5): English always, then what `VITE_COURSE_TARGETS` adds, in `TARGETS` order. */
export function parseTargets(value: string | undefined): readonly Target[] {
  const named = new Set((value ?? '').split(',').map((s) => s.trim()))
  return TARGETS.filter((t) => t === 'en' || named.has(t))
}

export const OFFERED_TARGETS: readonly Target[] = parseTargets(import.meta.env.VITE_COURSE_TARGETS)

/**
 * A visitor studies the trial's packs (the bundled sample when the build names none); a signed-in learner studies the
 * CDN's. Either way, each course's manifest is its own (`targetManifestUrl`).
 */
export function manifestUrlFor(
  account: AccountRecord | null,
  target: string,
  learnerManifest: string = CONTENT_MANIFEST_URL,
  visitorManifest: string = TRIAL_MANIFEST_URL,
): string {
  return targetManifestUrl(account === null ? visitorManifest : learnerManifest, target)
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
export function packFetcher(
  fetchFn: Fetch = (i, init) => fetch(i, init),
  onProgress?: (received: number, total: number) => void,
): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(descriptor.url)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    const total = descriptor.bytes
    onProgress?.(0, total)
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      onProgress?.(bytes.byteLength, total)
      return bytes
    }
    // Read in chunks so the setup can show how far the download is (plan 11, Decision 8); the integrity check that
    // follows (`installPacks`) still compares the size and checksum with the manifest.
    const chunks: Uint8Array[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      onProgress?.(received, total)
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (received !== total) onProgress?.(received, total)
    return bytes
  }
}

export function clipUrl(clip: AudioClip, manifestUrl: string): string {
  return new URL(clip.url, manifestBase(manifestUrl)).href
}
