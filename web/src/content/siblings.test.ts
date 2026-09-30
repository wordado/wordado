import { validateFixes } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { fetchSibling, siblingUrl } from './siblings'

const PAGE = 'https://wordado.com/study'
const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe('siblingUrl', () => {
  it('resolves beside the manifest, on the CDN or in the bundled sample', () => {
    expect(siblingUrl('https://content.wordado.com/manifest.json', 'fixes.json', PAGE)).toBe('https://content.wordado.com/fixes.json')
    expect(siblingUrl('/content/sample/manifest.json', 'credits.json', PAGE)).toBe('https://wordado.com/content/sample/credits.json')
  })
})

describe('fetchSibling', () => {
  const file = { schema_version: 1, corpus_version: 1, fixes: [] }

  it('returns the validated file, fetched without the browser cache', async () => {
    const seen: RequestInit[] = []
    const fetchFn = async (_: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return new Response(JSON.stringify(file))
    }
    expect(await fetchSibling('https://content.wordado.com/manifest.json', 'fixes.json', validateFixes, fetchFn)).toEqual(file)
    expect(seen[0]).toMatchObject({ cache: 'no-cache' })
  })

  it('returns null, never throws, when offline, missing, not JSON, or not the file', async () => {
    const url = 'https://content.wordado.com/manifest.json'
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => Promise.reject(new TypeError('offline')))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => new Response('', { status: 404 }))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => new Response('<html>'))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, ok({ ...file, schema_version: 2 }))).toBeNull()
  })
})
