import { SAMPLE_DIR } from '@wordado/client-data/src/testing/sample'
import { describe, expect, it } from 'vitest'
import { contentType, sampleFiles, samplePack, SAMPLE_PREFIX } from './samplePack'

describe('sampleFiles', () => {
  it('lists what the manifest can reach, and not the pipeline’s source', () => {
    const files = sampleFiles(SAMPLE_DIR)
    expect(files).toContain('manifest.json')
    expect(files).toContain('corpus-v0-bg.pack')
    expect(files.filter((f) => f.startsWith('audio/') && f.endsWith('.m4a'))).toHaveLength(60)
    expect(files).not.toContain('source.json')
  })

  it('names content types the browser needs', () => {
    expect(contentType('manifest.json')).toBe('application/json')
    expect(contentType('corpus-v0-bg.pack')).toBe('application/json')
    expect(contentType('audio/apple-1-uk.m4a')).toBe('audio/mp4')
  })
})

type Middleware = (req: { url?: string }, res: FakeResponse, next: () => void) => void

class FakeResponse {
  statusCode = 200
  headers = new Map<string, string>()
  body: Buffer | null = null
  setHeader(name: string, value: string) {
    this.headers.set(name, value)
  }
  end(body?: Buffer) {
    this.body = body ?? null
  }
}

describe('samplePack in development', () => {
  const middleware = (): Middleware => {
    let installed: Middleware | null = null
    const plugin = samplePack(SAMPLE_DIR)
    const hook = plugin.configureServer as unknown as (server: { middlewares: { use(m: Middleware): void } }) => void
    hook({ middlewares: { use: (m) => (installed = m) } })
    return installed!
  }

  it('serves sample files with their type, and 404s anything else under the prefix', () => {
    const serve = middleware()
    const ok = new FakeResponse()
    serve({ url: `/${SAMPLE_PREFIX}manifest.json?v=1` }, ok, () => {
      throw new Error('should not fall through')
    })
    expect(ok.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(ok.body!.toString('utf8')).packs[0].pack_id).toBe('corpus-bg')
    const missing = new FakeResponse()
    serve({ url: `/${SAMPLE_PREFIX}source.json` }, missing, () => undefined)
    expect(missing.statusCode).toBe(404)
  })

  it('passes other requests on', () => {
    let passed = false
    middleware()({ url: '/src/main.tsx' }, new FakeResponse(), () => {
      passed = true
    })
    expect(passed).toBe(true)
  })
})
