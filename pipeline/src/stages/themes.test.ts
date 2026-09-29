import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import type { CuratedTheme } from '../config'
import { fakeLlm } from '../llm'
import { themeSenses } from './themes'

const theme = (theme_id: string, en: string): CuratedTheme => ({ theme_id, name: { en, bg: en }, description: { en: `${en}.`, bg: `${en}.` } })
const THEMES = [theme('food', 'Food'), theme('comparing', 'Comparing')]
const bread = { headword: 'bread', pos: 'noun' as const, gloss: '', example: 'I buy bread.' }
const compare = { headword: 'compare', pos: 'verb' as const, gloss: '', example: 'Compare the two prices.' }

const cacheFile = () => join(mkdtempSync(join(tmpdir(), 'themes-')), 'themes.jsonl')
const run = (answer: (n: string, i: unknown) => unknown, file = cacheFile()) => ({ llm: fakeLlm(answer), cache: StageCache.open(file), concurrency: 1, offline: false })

describe('themeSenses', () => {
  it('keeps known themes, at most three, most relevant first, and asks with the list and its descriptions', async () => {
    const r = run(() => ({ items: [{ key: '0', themes: ['food', 'unknown', 'food'] }, { key: '1', themes: [] }] }))
    expect(await themeSenses([bread, compare], THEMES, r)).toEqual([['food'], []])
    expect(r.llm.calls[0]!.input).toEqual({
      themes: [
        { id: 'comparing', name: 'Comparing', description: 'Comparing.' },
        { id: 'food', name: 'Food', description: 'Food.' },
      ],
      items: [{ key: '0', ...bread }, { key: '1', ...compare }],
    })
  })

  it('asks again only when the theme list changes', async () => {
    const file = cacheFile()
    const answer = () => ({ items: [{ key: '0', themes: ['food'] }] })
    await themeSenses([bread], THEMES, run(answer, file))
    const same = run(answer, file)
    await themeSenses([bread], THEMES, same)
    expect(same.llm.calls).toHaveLength(0)
    const changed = run(answer, file)
    await themeSenses([bread], [...THEMES, theme('home', 'At home')], changed)
    expect(changed.llm.calls).toHaveLength(1)
  })

  it('rejects a response that answers other items than it was asked', async () => {
    await expect(themeSenses([bread], THEMES, run(() => ({ items: [{ key: '1', themes: [] }] })))).rejects.toThrow(/answers other items/)
  })
})
