import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveProblems } from './live'
import { makeContent } from './testing/fixture'

describe('liveProblems', () => {
  it('finds nothing when the CDN serves the last published manifest, whatever its formatting', async () => {
    const dir = makeContent()
    const served = JSON.stringify(JSON.parse(readFileSync(join(dir, 'last-published', 'manifest.json'), 'utf8')))
    expect(await liveProblems(dir, 'https://content.example/manifest.json', async () => served)).toEqual([])
  })

  it('names a CDN that serves another version, so no release is built on a stale predecessor', async () => {
    const dir = makeContent()
    const other = { ...JSON.parse(readFileSync(join(dir, 'last-published', 'manifest.json'), 'utf8')), corpus_version: 3 }
    expect(await liveProblems(dir, 'https://c/manifest.json', async () => JSON.stringify(other))).toEqual([
      'https://c/manifest.json serves corpus version 3, but last-published/ holds version 0 with other files; merge the content repository’s latest publish commit, or restore last-published/ from the CDN',
    ])
  })

  it('names a manifest it cannot fetch or read', async () => {
    const dir = makeContent()
    expect(await liveProblems(dir, 'https://c/m', async () => { throw new Error('HTTP 404') })).toEqual(['https://c/m: HTTP 404'])
    expect(await liveProblems(dir, 'https://c/m', async () => '<html>')).toEqual(['https://c/m: not JSON'])
  })
})
