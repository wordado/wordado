import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { HelpMenu } from './HelpMenu'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const openMenu = () => {
  const circle = screen.getByRole('button', { name: 'Help' })
  fireEvent.click(circle)
  return circle
}

describe('HelpMenu', () => {
  it('is a circle with a question mark, closed at first', async () => {
    renderWith(<HelpMenu />, await setup())
    const circle = screen.getByRole('button', { name: 'Help' })
    expect(circle.textContent).toBe('?')
    expect(circle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('leads to the guide’s page about this screen, the whole guide and the form, in that order', async () => {
    window.history.replaceState(null, '', '/progress')
    renderWith(<HelpMenu />, await setup())
    openMenu()
    const links = screen.getAllByRole('link')
    expect(links.map((link) => link.textContent)).toEqual(['About this screenProgress and streak', 'All help topics', 'Write to us'])
    const [about, all, write] = links as [HTMLElement, HTMLElement, HTMLElement]
    expect(about.getAttribute('href')).toBe('https://wordado.com/en/guide/progress-and-streak/')
    expect(all.getAttribute('href')).toBe('https://wordado.com/en/guide/')
    for (const link of [about, all]) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener')
    }
    expect(write.getAttribute('href')).toBe('/feedback?from=%2Fprogress')
    expect(write.getAttribute('target')).toBeNull()
  })

  it('follows the screen and the interface language', async () => {
    window.history.replaceState(null, '', '/settings/reminders')
    renderWith(<HelpMenu />, { ...(await setup()), locale: 'bg' })
    fireEvent.click(screen.getByRole('button', { name: 'Помощ' }))
    const about = screen.getByRole('link', { name: 'За този екран Напомняния' })
    expect(about.getAttribute('href')).toBe('https://wordado.com/bg/guide/reminders/')
    expect(screen.getByRole('link', { name: 'Всички теми в помощта' }).getAttribute('href')).toBe('https://wordado.com/bg/guide/')
  })

  it('has no “About this screen” on a screen the guide has no page for', async () => {
    window.history.replaceState(null, '', '/settings')
    renderWith(<HelpMenu />, await setup())
    openMenu()
    expect(screen.queryByText('About this screen')).toBeNull()
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['All help topics', 'Write to us'])
  })

  it('opens the form and closes behind it; pressed on the form itself, it closes too', async () => {
    window.history.replaceState(null, '', '/path')
    renderWith(<HelpMenu />, await setup())
    openMenu()
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Write to us' })))
    expect(window.location.pathname + window.location.search).toBe('/feedback?from=%2Fpath')
    expect(screen.queryByRole('link', { name: 'Write to us' })).toBeNull()
    openMenu()
    const again = screen.getByRole('link', { name: 'Write to us' })
    expect(again.getAttribute('href')).toBe('/feedback?from=%2Fpath')
    await act(async () => fireEvent.click(again))
    expect(screen.queryByRole('link', { name: 'Write to us' })).toBeNull()
  })

  it('switches the interface language, among the learner’s L1 and English, and returns focus to the button', async () => {
    renderWith(<HelpMenu />, await setup())
    openMenu()
    const list = screen.getByRole('list', { name: 'Interface language' })
    expect(Array.from(list.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Български', 'English'])
    expect(screen.getByRole('button', { name: 'English' }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'Български' }))
    const circle = screen.getByRole('button', { name: 'Помощ' })
    expect(circle.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(circle)
    fireEvent.click(circle)
    expect(screen.getByRole('link', { name: 'Пишете ни' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Български' }).getAttribute('aria-current')).toBe('true')
  })

  it('says offline that the guide needs a connection, and offers no link to it; the form and the language stay', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    renderWith(<HelpMenu />, await setup())
    openMenu()
    expect(screen.getByText('About this screen')).toBeTruthy()
    expect(screen.getByText('Your first session')).toBeTruthy()
    expect(screen.getByText('All help topics')).toBeTruthy()
    expect(screen.getAllByText('Help needs an internet connection')).toHaveLength(1)
    expect(screen.getAllByRole('link').map((link) => link.textContent)).toEqual(['Write to us'])
    expect(screen.getByRole('button', { name: 'Български' })).toBeTruthy()
  })

  it('closes on Escape, returning focus, and on a press outside', async () => {
    renderWith(<HelpMenu />, await setup())
    const circle = openMenu()
    fireEvent.keyDown(screen.getByRole('link', { name: 'All help topics' }), { key: 'Escape' })
    expect(screen.queryByRole('link', { name: 'All help topics' })).toBeNull()
    expect(document.activeElement).toBe(circle)
    fireEvent.click(circle)
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('link', { name: 'All help topics' })).toBeNull()
  })
})
