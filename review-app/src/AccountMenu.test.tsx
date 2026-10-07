import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountMenu, initials } from './AccountMenu'
import { useKeys } from './useKeys'

afterEach(cleanup)

describe('initials', () => {
  it.each([
    ['Anna Schmidt', 'AS'],
    ['Coordinator', 'C'],
    ['Мария Петрова', 'МП'],
    ['anna maria schmidt', 'AS'],
    ['  ', '?'],
    ['', '?'],
    ["'Quoted' Name", 'QN'],
    ['Anne-Marie Dupont', 'AD'],
    ['Jean-Luc', 'J'],
    ['  Petra  ', 'P'],
    ['Anna (she) 2', 'AS'],
    ['42', '?'],
  ])('%j gives %s', (name, expected) => {
    expect(initials(name)).toBe(expected)
  })
})

const hosted = { name: 'Anna Schmidt', email: 'anna@example.com', signOutHref: '/cdn-cgi/access/logout' }
const button = () => screen.getByRole('button', { name: 'Account: Anna Schmidt' })

describe('AccountMenu', () => {
  it('is a round button with the initials, named after the person, closed at first', () => {
    render(<AccountMenu account={hosted} />)
    expect(button().textContent).toBe('AS')
    expect(button().getAttribute('aria-haspopup')).toBe('menu')
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByText('anna@example.com')).toBeNull()
  })

  it('opens on a click with the name, the email and Sign out through Access, and closes on the next click', () => {
    render(<AccountMenu account={hosted} />)
    fireEvent.click(button())
    expect(button().getAttribute('aria-expanded')).toBe('true')
    const menu = within(screen.getByRole('menu', { name: 'Account' }))
    expect(menu.getByText('Anna Schmidt')).toBeTruthy()
    expect(menu.getByText('anna@example.com')).toBeTruthy()
    const out = menu.getByRole('menuitem', { name: 'Sign out' })
    expect(out.tagName).toBe('A')
    expect(out.getAttribute('href')).toBe('/cdn-cgi/access/logout')
    expect(menu.queryByText('Running on this computer.')).toBeNull()
    fireEvent.click(button())
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('has nothing to sign out of in the local mode: the name and where it runs', () => {
    render(<AccountMenu account={{ name: 'Anna Schmidt' }} />)
    fireEvent.click(button())
    const menu = within(screen.getByRole('menu', { name: 'Account' }))
    expect(menu.getByText('Anna Schmidt')).toBeTruthy()
    expect(menu.getByText('Running on this computer.')).toBeTruthy()
    expect(menu.queryByRole('menuitem')).toBeNull()
    expect(menu.queryByRole('link')).toBeNull()
  })

  it('closes on Escape, wherever the focus is in it, and the focus is back on the button', () => {
    render(<AccountMenu account={hosted} />)
    fireEvent.click(button())
    const out = screen.getByRole('menuitem', { name: 'Sign out' })
    out.focus()
    fireEvent.keyDown(out, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('goes to the first action on the down arrow', () => {
    render(<AccountMenu account={hosted} />)
    button().focus()
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Sign out' }))
  })

  it('closes on a press outside it, and the focus is back on the button; a press inside leaves it open', async () => {
    render(
      <>
        <AccountMenu account={hosted} />
        <p>the page</p>
      </>,
    )
    fireEvent.click(button())
    fireEvent.pointerDown(screen.getByText('anna@example.com'))
    expect(screen.getByRole('menu')).toBeTruthy()
    screen.getByRole('menuitem', { name: 'Sign out' }).focus()
    fireEvent.pointerDown(screen.getByText('the page'))
    expect(screen.queryByRole('menu')).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(button()))
  })

  it('closes when the focus goes elsewhere (a dialog opening, Tab past its end), and leaves the focus there', async () => {
    render(
      <>
        <AccountMenu account={hosted} />
        <button>All rows</button>
      </>,
    )
    fireEvent.click(button())
    const other = screen.getByRole('button', { name: 'All rows' })
    act(() => other.focus())
    expect(screen.queryByRole('menu')).toBeNull()
    // a press on the other control closed it too: the focus is not taken back from there
    fireEvent.click(button())
    fireEvent.pointerDown(other)
    act(() => other.focus())
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(other)
  })

  it('keeps the review keys off while it is open', () => {
    const onKey = vi.fn()
    function Harness() {
      useKeys({ '2': onKey, s: onKey, ArrowRight: onKey })
      return <AccountMenu account={hosted} />
    }
    render(<Harness />)
    fireEvent.click(button())
    for (const key of ['2', 's', 'ArrowRight']) fireEvent.keyDown(document.body, { key })
    expect(onKey).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    fireEvent.keyDown(document.body, { key: '2' })
    expect(onKey).toHaveBeenCalledTimes(1)
  })
})
