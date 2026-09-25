import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// happy-dom (the `unit` project's environment) replaces the global URL with a browser one that
// resolves a relative URL against `window.location`, not import.meta.url, so `new URL(...)` here
// would not resolve to this file; import.meta.dirname sidesteps URL entirely.
const headers = readFileSync(join(import.meta.dirname, '../public/_headers'), 'utf8')

/** The rule block for `path`: its header lines, trimmed. */
const rules = (path: string) => {
  const lines = headers.split('\n')
  const start = lines.indexOf(path)
  expect(start).toBeGreaterThanOrEqual(0)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(' ')) break
    out.push(line.trim())
  }
  return out
}

describe('static asset caching (plan 6a: the service worker and the manifest are never cached)', () => {
  it('revalidates the service worker and the web manifest on every load', () => {
    expect(rules('/sw.js')).toEqual(['Cache-Control: no-cache'])
    expect(rules('/manifest.webmanifest')).toEqual(['Cache-Control: no-cache'])
  })

  it('keeps hashed build files for a year', () => {
    expect(rules('/assets/*')).toEqual(['Cache-Control: public, max-age=31536000, immutable'])
  })
})
