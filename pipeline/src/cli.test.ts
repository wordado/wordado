import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readConfig } from './config'
import { contentPaths } from './content'
import { runDraft } from './draft'
import { writeJson } from './files'
import { makeContent, sampleLlm } from './testing/fixture'

const PIPELINE = fileURLToPath(new URL('..', import.meta.url))
const corpus = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: PIPELINE, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } })

describe('corpus (the CLI)', () => {
  it('draft refuses --rebuild together with --regroup', () => {
    const out = corpus('draft', makeContent(), '--rebuild', '--regroup', '--offline')
    expect(out.status).toBe(2)
    expect(out.stderr).toMatch(/usage: corpus/)
  })

  it('status says when the next release may replace the published units, and only then', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    // The fixture's last published version is the sample, version 0.
    writeJson(contentPaths(dir).config, { ...readConfig(dir), units_rebuilt_after: 0 })
    expect(corpus('status', dir).stdout).toMatch(/units_rebuilt_after/)
    writeJson(contentPaths(dir).config, { ...readConfig(dir), units_rebuilt_after: 7 })
    expect(corpus('status', dir).stdout).not.toMatch(/units_rebuilt_after/)
  })

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

  it("status counts a row's human review and AI review waits separately, so the headline does not double-count it", async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const config = readConfig(dir)
    writeJson(contentPaths(dir).config, {
      ...config,
      ai_review: { queues: ['translation-bg'], reviewers: { flash: { provider: 'openrouter', model: 'google/gemini-3.8-flash' } }, default: 'flash', flag_when: 1 },
    })
    const out = corpus('status', dir)
    expect(out.status).toBe(0)
    const headline = out.stdout.split('\n')[0]!
    const review = Number(headline.match(/(\d+) items awaiting review/)?.[1])
    const ai = Number(headline.match(/(\d+) awaiting AI review/)?.[1])
    expect(ai).toBeGreaterThan(0)
    expect(review).toBeGreaterThan(0)
    // Every open translation-bg row is pending for both reasons; the grouped lines still show the AI-gate one.
    expect(out.stdout).toMatch(/× not yet AI-reviewed \(translation-bg\)/)
  })
})
