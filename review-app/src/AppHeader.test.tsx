import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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

  it('stacks "review" under the name: both in one block beside the icon', () => {
    render(<AppHeader />)
    const mark = screen.getByRole('banner').querySelector('.wordmark')
    const block = mark?.querySelector('.wordmark-text')
    expect(block?.previousElementSibling?.tagName).toBe('IMG')
    expect([...(block?.children ?? [])].map((el) => el.className)).toEqual(['wordmark-name', 'wordmark-tail'])
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
        <AppHeader account={{ name: 'Ana Reviewer', email: 'ana@example.com', signOutHref: '/cdn-cgi/access/logout' }}>
          <button>Admin</button>
        </AppHeader>
        <HeaderSlot>
          <span>Translations · English</span>
        </HeaderSlot>
      </>,
    )
    const column = screen.getByRole('banner').querySelector('.app-header-inner')
    expect(column).toBeTruthy()
    for (const text of ['Wordado review', 'Translations · English', 'Admin']) expect(column?.textContent).toContain(text)
    // the name is the account button's, the last thing in the column; the menu opens from it
    const account = within(column as HTMLElement).getByRole('button', { name: 'Account: Ana Reviewer' })
    expect(account.textContent).toBe('AR')
    expect(column?.lastElementChild?.contains(account)).toBe(true)
    expect(column?.textContent).not.toContain('Ana Reviewer')
    fireEvent.click(account)
    const menu = within(within(column as HTMLElement).getByRole('menu', { name: 'Account' }))
    expect(menu.getByText('Ana Reviewer')).toBeTruthy()
    expect(menu.getByText('ana@example.com')).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Sign out' }).getAttribute('href')).toBe('/cdn-cgi/access/logout')
  })

  it('has no account button when nobody is known yet', () => {
    render(<AppHeader />)
    expect(screen.queryByRole('button', { name: /^Account/ })).toBeNull()
  })
})
