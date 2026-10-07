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
    ['🙂 🎉', '?'],
    // an astral letter is one letter, kept whole
    ['𐐨lma 𐐺ee', '𐐀𐐒'],
    ['𝒜da', '𝒜'],
    // a letter that upper-cases to two gives one
    ['ßeta Ägidius', 'SÄ'],
    ['ßeta', 'S'],
    // a decomposed letter keeps its accent
    ['e\u0301mile zola', 'E\u0301Z'],
    ['a'.repeat(500), 'A'],
    [`${'ab '.repeat(166)}z`, 'AZ'],
  ])('%j gives %s', (name, expected) => {
    expect(initials(name)).toBe(expected)
    // never more than two letters (a letter's combining marks aside)
    expect([...initials(name).replace(/\p{M}/gu, '')].length).toBeLessThanOrEqual(2)
  })
})

const hosted = { name: 'Anna Schmidt', email: 'anna@example.com', signOutHref: '/cdn-cgi/access/logout' }
const button = () => screen.getByRole('button', { name: 'Account: Anna Schmidt' })

describe('AccountMenu', () => {
  it('is a round button with the initials, named after the person, closed at first', () => {
    render(<AccountMenu account={hosted} />)
    expect(button().textContent).toBe('AS')
    // a disclosure, not a menu: it says whether it is open and, when it is, what it opened
    expect(button().hasAttribute('aria-haspopup')).toBe(false)
    expect(button().getAttribute('aria-expanded')).toBe('false')
    expect(button().hasAttribute('aria-controls')).toBe(false)
    expect(screen.queryByRole('group')).toBeNull()
    expect(screen.queryByRole('menu')).toBeNull()
    expect(screen.queryByText('anna@example.com')).toBeNull()
  })

  it('opens on a click with the name, the email and Sign out through Access, and closes on the next click', () => {
    render(<AccountMenu account={hosted} />)
    fireEvent.click(button())
    expect(button().getAttribute('aria-expanded')).toBe('true')
    const popup = screen.getByRole('group', { name: 'Account' })
    expect(button().getAttribute('aria-controls')).toBe(popup.id)
    expect(screen.queryByRole('menu')).toBeNull()
    const menu = within(popup)
    expect(menu.getByText('Anna Schmidt')).toBeTruthy()
    expect(menu.getByText('anna@example.com')).toBeTruthy()
    const out = menu.getByRole('link', { name: 'Sign out' })
    expect(out.tagName).toBe('A')
    expect(out.hasAttribute('role')).toBe(false)
    expect(out.getAttribute('href')).toBe('/cdn-cgi/access/logout')
    expect(menu.queryByText('Running on this computer.')).toBeNull()
    fireEvent.click(button())
    expect(screen.queryByRole('group')).toBeNull()
    expect(button().getAttribute('aria-expanded')).toBe('false')
  })

  it('has nothing to sign out of in the local mode: the name and where it runs', () => {
    render(<AccountMenu account={{ name: 'Anna Schmidt' }} />)
    fireEvent.click(button())
    const menu = within(screen.getByRole('group', { name: 'Account' }))
    expect(menu.getByText('Anna Schmidt')).toBeTruthy()
    expect(menu.getByText('Running on this computer.')).toBeTruthy()
    expect(menu.queryByRole('link')).toBeNull()
    expect(menu.queryByRole('button')).toBeNull()
  })

  it('closes on Escape, wherever the focus is in it, and the focus is back on the button', () => {
    render(<AccountMenu account={hosted} />)
    fireEvent.click(button())
    const out = screen.getByRole('link', { name: 'Sign out' })
    out.focus()
    fireEvent.keyDown(out, { key: 'Escape' })
    expect(screen.queryByRole('group')).toBeNull()
    expect(document.activeElement).toBe(button())
  })

  it('has Sign out as the next stop after the button for Tab; the arrow keys do nothing (it is no menu)', () => {
    render(<AccountMenu account={hosted} />)
    button().focus()
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    expect(screen.queryByRole('group')).toBeNull()
    fireEvent.click(button())
    const out = screen.getByRole('link', { name: 'Sign out' })
    expect(document.activeElement).toBe(button())
    // the next thing in the page that takes the focus, after the button, is the link
    const stops = [...document.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')].filter((el) => el.tabIndex >= 0)
    expect(stops[stops.indexOf(button()) + 1]).toBe(out)
    fireEvent.keyDown(out, { key: 'ArrowUp' })
    expect(screen.getByRole('group', { name: 'Account' })).toBeTruthy()
  })

  it('leaves nothing to run after it is gone: a press outside, then the header goes', () => {
    vi.useFakeTimers()
    try {
      const { unmount } = render(
        <>
          <AccountMenu account={hosted} />
          <p>the page</p>
        </>,
      )
      fireEvent.click(button())
      fireEvent.pointerDown(screen.getByText('the page'))
      expect(vi.getTimerCount()).toBe(1)
      unmount()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
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
    expect(screen.getByRole('group', { name: 'Account' })).toBeTruthy()
    screen.getByRole('link', { name: 'Sign out' }).focus()
    fireEvent.pointerDown(screen.getByText('the page'))
    expect(screen.queryByRole('group')).toBeNull()
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
    expect(screen.queryByRole('group')).toBeNull()
    // a press on the other control closed it too: the focus is not taken back from there
    fireEvent.click(button())
    fireEvent.pointerDown(other)
    act(() => other.focus())
    await new Promise((r) => setTimeout(r, 10))
    expect(screen.queryByRole('group')).toBeNull()
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
