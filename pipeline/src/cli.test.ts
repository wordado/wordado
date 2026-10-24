import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
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
  it('init --target de starts a German corpus with nothing inherited from the English sample', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'init-')), 'de')
    expect(corpus('init', dir, '--target', 'de').status).toBe(0)
    const config = readConfig(dir)
    expect(config.target).toBe('de')
    expect(config.l1s).toEqual(['bg'])
    expect(Object.keys(config.tts.accents)).toEqual(['de'])
    expect(config.tts.accents.de!.instructions).toBe('Say the German word or phrase once, clearly and naturally, in standard German. Nothing else.')
    const paths = contentPaths(dir)
    expect(JSON.parse(readFileSync(paths.registry, 'utf8'))).toEqual({ entries: [], units: [] })
    expect(readdirSync(paths.lastPublished).sort()).toEqual(['fixes.json', 'manifest.json'])
    expect(JSON.parse(readFileSync(join(paths.lastPublished, 'manifest.json'), 'utf8')).packs).toEqual([])
    expect(JSON.parse(readFileSync(paths.themes, 'utf8')).length).toBeGreaterThan(0)
    // The English essentials are English words: the language writes its own list, under the template's header.
    const essentials = readFileSync(paths.essentials, 'utf8')
    expect(essentials.split('\n').filter((l) => l.trim() !== '' && !l.startsWith('#'))).toEqual([])
    expect(essentials).toMatch(/^# Everyday spoken words/)
  })

  it('init without --target is the English directory, seeded with the sample', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'init-')), 'en')
    expect(corpus('init', dir).status).toBe(0)
    const config = readConfig(dir)
    expect(config.target ?? 'en').toBe('en')
    expect(Object.keys(config.tts.accents)).toEqual(['uk'])
    expect(readdirSync(contentPaths(dir).lastPublished)).toContain('corpus-v0-bg.pack')
  })

  it('init refuses --target without a code, and makes nothing', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'init-')), 'x')
    const out = corpus('init', dir, '--target')
    expect(out.status).toBe(2)
    expect(out.stderr).toMatch(/--target needs a target code: en, de/)
    expect(existsSync(dir)).toBe(false)
  })

  it('init refuses an unknown target', () => {
    const out = corpus('init', join(mkdtempSync(join(tmpdir(), 'init-')), 'x'), '--target', 'fr')
    expect(out.status).toBe(2)
    expect(out.stderr).toMatch(/unknown target "fr"/)
  })

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
  it('cdn gives English the bucket root and its manifest URL unchanged, and German de/ beside it (#329)', () => {
    const env = join(mkdtempSync(join(tmpdir(), 'cdn-')), 'env')
    const en = corpus('cdn', makeContent(), 'https://content.example.test/manifest.json', env)
    expect(en.status).toBe(0)
    const de = corpus('cdn', makeContent({ config: { target: 'de', l1s: ['bg'] } }), 'https://content.example.test/manifest.json', env)
    expect(de.status).toBe(0)
    expect(readFileSync(env, 'utf8')).toBe(
      'CDN_TARGET=en\nCDN_DIR=\nCDN_MANIFEST_URL=https://content.example.test/manifest.json\n' +
        'CDN_TARGET=de\nCDN_DIR=de\nCDN_MANIFEST_URL=https://content.example.test/de/manifest.json\n',
    )
  })

  it('cdn refuses a manifest URL it could not place a folder beside', () => {
    const env = join(mkdtempSync(join(tmpdir(), 'cdn-')), 'env')
    for (const url of ['manifest.json', 'https://content.example.test/', 'https://content.example.test/manifest.json?v=1']) {
      const out = corpus('cdn', makeContent(), url, env)
      expect(out.status, url).toBe(2)
    }
    expect(existsSync(env)).toBe(false)
  })
})

