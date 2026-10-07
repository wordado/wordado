import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppHeader, HeaderSlot } from './AppHeader'

afterEach(cleanup)

describe('AppHeader', () => {
  it('reads as "Wordado review": one word for the name, "ado" in a part of its own for its colour', () => {
    render(<AppHeader />)
    const mark = screen.getByRole('banner').querySelector('.wordmark')
    expect(mark?.textContent).toBe('Wordado review')
    expect(mark?.querySelector('.wordmark-name')?.textContent).toBe('Wordado')
    expect(mark?.querySelector('.wordmark-ado')?.textContent).toBe('ado')
    expect(mark?.querySelector('.wordmark-tail')?.textContent?.trim()).toBe('review')
  })

  it('starts with the review app’s own icon, which says nothing to a screen reader', () => {
    render(<AppHeader />)
    const icon = screen.getByRole('banner').querySelector('.wordmark')?.firstElementChild
    expect(icon?.tagName).toBe('IMG')
    expect(icon?.getAttribute('src')).toBe('/icon.svg')
    expect(icon?.getAttribute('alt')).toBe('')
  })

  it('keeps the mark, what a screen puts in and the name in one centred column', () => {
    render(
      <>
        <AppHeader who="Ana Reviewer">
          <button>Admin</button>
        </AppHeader>
        <HeaderSlot>
          <span>Translations · English</span>
        </HeaderSlot>
      </>,
    )
    const column = screen.getByRole('banner').querySelector('.app-header-inner')
    expect(column).toBeTruthy()
    for (const text of ['Wordado review', 'Translations · English', 'Admin', 'Ana Reviewer']) expect(column?.textContent).toContain(text)
  })
})
