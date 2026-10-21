import { act, cleanup } from '@testing-library/react'
import { germanServing } from '@wordado/client-data/src/testing/sample'
import type { CorpusEntry } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { WordRow } from './WordRow'

afterEach(cleanup)

describe('WordRow', () => {
  it('shows a German noun in a list by its article and word only: the plural is for the card', async () => {
    const ctx = await setup()
    const german = await germanServing(ctx.env)
    await act(async () => {
      await ctx.client.switchCourse('de')
      await ctx.client.updateSettings({ l1: 'bg' })
      expect(await ctx.client.changeCourse({ target: 'de', l1: 'bg' }, german.manifest, german.fetch)).toEqual({ ok: true })
    })
    const first = [...ctx.client.snapshot.corpus!.entries.values()][0]!
    const haus: CorpusEntry = { ...first, headword: 'Haus', pos: 'noun', grammar: { gender: 'n', plural: 'Häuser' } }
    renderWith(
      <ul>
        <WordRow entry={haus} lang="bg" learn={false} />
      </ul>,
      ctx,
    )
    const head = document.querySelector('.word-head')!
    expect(head.textContent).toBe('das Haus')
    expect(head.getAttribute('lang')).toBe('de')
    expect(document.querySelector('.word-text')?.textContent).not.toContain('Häuser')
  })
})
