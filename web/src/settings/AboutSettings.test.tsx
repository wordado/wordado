import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeCredits, renderWith, setup } from '../test/fixtures'
import { AboutSettings } from './AboutSettings'

const credits = { schema_version: 1 as const, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb by Hugging Face (ODC-By 1.0).' }] }

describe('AboutSettings', () => {
  it('lists each source’s attribution verbatim, in English, under a localised heading', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, locale: 'bg', credits: fakeCredits({ manifestUrl: 'x', credits }) })
    expect(screen.getByRole('heading', { name: 'За приложението' })).toBeTruthy()
    const item = screen.getByText('Word frequencies counted from FineWeb by Hugging Face (ODC-By 1.0).')
    expect(item.closest('[lang]')?.getAttribute('lang')).toBe('en')
  })

  it('says the word list is Wordado’s own when no source needs an attribution', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, credits: fakeCredits({ manifestUrl: 'x', credits: { ...credits, sources: [] } }) })
    expect(screen.getByText('This word list was prepared by Wordado.')).toBeTruthy()
  })

  it('before it has ever been online, says the sources appear once it has', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, credits: fakeCredits() })
    expect(screen.getByText('The word data’s sources appear here once the app has been online.')).toBeTruthy()
  })
})
