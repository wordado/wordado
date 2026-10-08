import { cleanup, render, screen } from '@testing-library/react'
import type { CorpusEntry } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Translation } from './Headword'

afterEach(cleanup)

const time = { translations: ['време'], sense: 'по часовник' } as unknown as CorpusEntry
const apple = { translations: ['ябълка'], sense: '' } as unknown as CorpusEntry

describe('Translation', () => {
  it('puts the gloss after the word in brackets', () => {
    render(<Translation entry={time} lang="bg" />)
    expect(document.querySelector('.translation')?.textContent).toBe('време (по часовник)')
  })

  it('stacked, puts the gloss on its own line without brackets, and an answer button reads as "word, gloss"', () => {
    render(
      <button type="button">
        <Translation entry={time} lang="bg" stacked />
      </button>,
    )
    expect(document.querySelector('.translation-word')?.textContent).toBe('време')
    expect(document.querySelector('.sense')?.textContent).toBe('по часовник')
    // The comma is only heard. A row of its own may put a space before it in the computed name; that is not spoken.
    expect(screen.getByRole('button', { name: /^време ?, по часовник$/ })).toBeTruthy()
  })

  it('stacked, a translation that needs no gloss is the word alone', () => {
    render(<Translation entry={apple} lang="bg" stacked />)
    expect(document.querySelector('.translation')?.textContent).toBe('ябълка')
    expect(document.querySelector('.sense')).toBeNull()
  })
})
