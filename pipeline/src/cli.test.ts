import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PIPELINE = fileURLToPath(new URL('..', import.meta.url))
const corpus = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: PIPELINE, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } })

describe('corpus (the CLI)', () => {
  it('init makes a content directory, and refuses to overwrite one', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    expect(corpus('init', dir).status).toBe(0)
    expect(existsSync(join(dir, 'registry.json'))).toBe(true)
    const again = corpus('init', dir)
    expect(again.status).toBe(1)
    expect(again.stderr).toMatch(/not empty/)
  })

  it('draft stops at the licence register of a new content directory, before any network', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    corpus('init', dir)
    const out = corpus('draft', dir, '--offline')
    expect(out.status).toBe(1)
    expect(out.stderr).toMatch(/sources\.json lists no sources/)
  })

  it('draft without --offline needs OPENROUTER_API_KEY; import needs --by', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    corpus('init', dir)
    expect(corpus('draft', dir).stderr).toMatch(/OPENROUTER_API_KEY/)
    expect(corpus('import', dir).status).toBe(2)
  })
})
