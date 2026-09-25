import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_DIR } from '@wordado/client-data/src/testing/sample'
import { describe, expect, it } from 'vitest'
import { clipUrl, fetchManifest, manifestUrlFor, packFetcher, SAMPLE_MANIFEST_URL, type Fetch } from './packs'

const PAGE = 'https://wordado.test/study'

/** Serves the sample directory as if it were at https://wordado.test/content/sample/. */
const serveSample: Fetch = async (input) => {
  const url = new URL(input)
  const path = url.pathname.replace('/content/sample/', '')
  try {
    return new Response(readFileSync(join(SAMPLE_DIR, path)))
  } catch {
    return new Response('missing', { status: 404 })
  }
}

describe('fetchManifest', () => {
  it('fetches and validates the manifest', async () => {
    const manifest = await fetchManifest(new URL('/content/sample/manifest.json', PAGE).href, serveSample)
    expect(manifest.packs.map((p) => p.pack_id)).toEqual(['corpus-bg'])
  })

  it('refuses a missing, invalid or too-new manifest with a reason', async () => {
    await expect(fetchManifest('https://wordado.test/content/none/manifest.json', serveSample)).rejects.toThrow('404')
    const json = (body: unknown): Fetch => async () => new Response(JSON.stringify(body))
    await expect(fetchManifest('https://x.test/m.json', json({ schema_version: 1, corpus_version: 0, packs: 'no' }))).rejects.toThrow('invalid')
    await expect(fetchManifest('https://x.test/m.json', json({ schema_version: 99, corpus_version: 0, packs: [] }))).rejects.toThrow('newer app')
  })
})

describe('packFetcher and clipUrl', () => {
  it('resolve pack and clip URLs against the manifest’s URL (plan 3 contract)', async () => {
    const manifestUrl = new URL('/content/sample/manifest.json', PAGE).href
    const manifest = await fetchManifest(manifestUrl, serveSample)
    const bytes = await packFetcher(serveSample)(manifest.packs[0]!)
    expect(bytes.byteLength).toBe(manifest.packs[0]!.bytes)
    const clip = { clipId: 'apple-1-uk', url: 'audio/apple-1-uk.m4a', sha256: '0'.repeat(64), bytes: 1, mime: 'audio/mp4' }
    expect(clipUrl(clip, manifestUrl)).toBe('https://wordado.test/content/sample/audio/apple-1-uk.m4a')
  })

  it('throws on a failed pack fetch, which client-data records as a rejected pack', async () => {
    const fail: Fetch = async () => new Response('', { status: 503 })
    const descriptor = { pack_id: 'p', l1: 'bg', corpus_version: 1, schema_version: 1, url: 'https://x.test/p.pack', sha256: '0'.repeat(64), bytes: 1 }
    await expect(packFetcher(fail)(descriptor)).rejects.toThrow('503')
  })
})

describe('learner content (plan 7)', () => {
  it('resolves every pack against its manifest once, so one fetcher serves any manifest', async () => {
    const manifest = { schema_version: 1, corpus_version: 3, packs: [{ pack_id: 'corpus-bg', l1: 'bg', corpus_version: 3, schema_version: 1, url: 'corpus-v3-bg.pack', sha256: 'a'.repeat(64), bytes: 10 }] }
    const fetchFn = async () => new Response(JSON.stringify(manifest), { status: 200 })
    const got = await fetchManifest('https://content.wordado.com/manifest.json', fetchFn)
    expect(got.packs[0]!.url).toBe('https://content.wordado.com/corpus-v3-bg.pack')
    const asked: string[] = []
    const fetcher = packFetcher(async (url) => {
      asked.push(url)
      return new Response(new Uint8Array([1, 2, 3]))
    })
    await fetcher(got.packs[0]!)
    expect(asked).toEqual(['https://content.wordado.com/corpus-v3-bg.pack'])
  })

  it('gives the demo the bundled sample and a learner the CDN’s manifest, or the sample when none is configured', () => {
    expect(manifestUrlFor(null, 'https://content.wordado.com/manifest.json')).toBe(SAMPLE_MANIFEST_URL)
    expect(manifestUrlFor({ userId: 'u1', email: 'a@b.c' }, 'https://content.wordado.com/manifest.json')).toBe('https://content.wordado.com/manifest.json')
    expect(manifestUrlFor({ userId: 'u1', email: 'a@b.c' }, SAMPLE_MANIFEST_URL)).toBe(SAMPLE_MANIFEST_URL)
  })
})
