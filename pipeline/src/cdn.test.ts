import { describe, expect, it } from 'vitest'
import { cdnEnv, cdnLayout } from './cdn'

describe('cdnLayout', () => {
  it('leaves English where it always was: the bucket root and the deploy’s manifest URL', () => {
    expect(cdnLayout('en', 'https://content.example.test/manifest.json')).toEqual({
      target: 'en',
      dir: '',
      manifestUrl: 'https://content.example.test/manifest.json',
    })
    expect(cdnEnv(cdnLayout('en', 'https://content.example.test/manifest.json'))).toBe(
      'CDN_TARGET=en\nCDN_DIR=\nCDN_MANIFEST_URL=https://content.example.test/manifest.json\n',
    )
  })

  it('puts another target in a folder named after it, beside English, where the app asks for it', () => {
    // The same URLs as targetManifestUrl's tests in web/src/content/packs.test.ts.
    expect(cdnLayout('de', 'https://cdn.example/manifest.json')).toEqual({ target: 'de', dir: 'de', manifestUrl: 'https://cdn.example/de/manifest.json' })
    expect(cdnLayout('de', 'https://cdn.example/content/manifest.json').manifestUrl).toBe('https://cdn.example/content/de/manifest.json')
    expect(cdnEnv(cdnLayout('de', 'https://cdn.example/manifest.json'))).toBe('CDN_TARGET=de\nCDN_DIR=de\nCDN_MANIFEST_URL=https://cdn.example/de/manifest.json\n')
  })
})
