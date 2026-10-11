import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Link, navigate, parseRoute, routeHref, routePath, useRoute, type Route } from './router'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

const ROUTES: Route[] = [
  { name: 'home' },
  { name: 'study', mode: null },
  { name: 'study', mode: 'flashcard' },
  { name: 'study', mode: 'listening_select' },
  { name: 'practice' },
  { name: 'practice-words', mode: null },
  { name: 'practice-words', mode: 'multiple_choice' },
  { name: 'matching' },
  { name: 'practice', unit: 'a1-02' },
  { name: 'practice-words', mode: null, unit: 'a1-02' },
  { name: 'practice-words', mode: 'flashcard', unit: 'a1-02' },
  { name: 'matching', unit: 'a1-02' },
  { name: 'practice', theme: 'daily-life' },
  { name: 'practice-words', mode: 'flashcard', theme: 'daily-life' },
  { name: 'matching', theme: 'daily-life' },
  { name: 'path' },
  { name: 'themes' },
  { name: 'progress' },
  { name: 'feedback' },
  { name: 'feedback', from: '/path' },
  { name: 'feedback', from: '/settings/about' },
]

describe('routes', () => {
  it('round-trip through their URLs', () => {
    for (const route of ROUTES) {
      const url = new URL(routeHref(route), 'http://localhost')
      expect(parseRoute(url.pathname, url.search)).toEqual(route)
    }
  })

  it('send an unknown path home and ignore an unknown mode', () => {
    expect(parseRoute('/nowhere', '')).toEqual({ name: 'home' })
    expect(parseRoute('/study', '?mode=matching')).toEqual({ name: 'study', mode: null })
    expect(parseRoute('/study/', '')).toEqual({ name: 'study', mode: null })
  })

  it('carries the unit being practised in the query, before the mode', () => {
    expect(routeHref({ name: 'practice', unit: 'a1-02' })).toBe('/practice?unit=a1-02')
    expect(routeHref({ name: 'practice-words', mode: 'multiple_choice', unit: 'a1-02' })).toBe('/practice/words?unit=a1-02&mode=multiple_choice')
    expect(routeHref({ name: 'matching', unit: 'a1-02' })).toBe('/practice/matching?unit=a1-02')
    expect(routeHref({ name: 'practice', unit: 'a b&c' })).toBe('/practice?unit=a+b%26c')
    expect(parseRoute('/practice', '?unit=a+b%26c')).toEqual({ name: 'practice', unit: 'a b&c' })
    expect(parseRoute('/practice/words', '?mode=flashcard&unit=a1-02')).toEqual({ name: 'practice-words', mode: 'flashcard', unit: 'a1-02' })
    // No unit, or an empty one, is practice over everything; a session has no unit.
    expect(parseRoute('/practice', '?unit=')).toEqual({ name: 'practice' })
    expect('unit' in parseRoute('/practice/matching', '')).toBe(false)
    expect(parseRoute('/study', '?unit=a1-02')).toEqual({ name: 'study', mode: null })
  })

  it('carries the theme being practised the same way, and lets a unit win over it', () => {
    expect(routeHref({ name: 'practice', theme: 'daily-life' })).toBe('/practice?theme=daily-life')
    expect(routeHref({ name: 'practice-words', mode: 'multiple_choice', theme: 'daily-life' })).toBe('/practice/words?theme=daily-life&mode=multiple_choice')
    expect(routeHref({ name: 'matching', theme: 'daily-life' })).toBe('/practice/matching?theme=daily-life')
    expect(parseRoute('/practice/words', '?mode=flashcard&theme=daily-life')).toEqual({ name: 'practice-words', mode: 'flashcard', theme: 'daily-life' })
    expect(parseRoute('/practice', '?theme=daily-life&unit=a1-02')).toEqual({ name: 'practice', unit: 'a1-02' })
    expect('theme' in parseRoute('/practice', '?theme=daily-life&unit=a1-02')).toBe(false)
    expect(parseRoute('/practice', '?theme=')).toEqual({ name: 'practice' })
    expect(parseRoute('/study', '?theme=daily-life')).toEqual({ name: 'study', mode: null })
  })

  it('routes a theme’s page, with the word search it starts with', () => {
    expect(parseRoute('/themes/daily-life', '')).toEqual({ name: 'theme', themeId: 'daily-life' })
    expect(parseRoute('/themes/daily-life/', '?q=key')).toEqual({ name: 'theme', themeId: 'daily-life', q: 'key' })
    expect('q' in parseRoute('/themes/daily-life', '?q=')).toBe(false)
    expect(routeHref({ name: 'theme', themeId: 'daily-life' })).toBe('/themes/daily-life')
    expect(routeHref({ name: 'theme', themeId: 'daily-life', q: 'река и бряг' })).toBe('/themes/daily-life?q=%D1%80%D0%B5%D0%BA%D0%B0+%D0%B8+%D0%B1%D1%80%D1%8F%D0%B3')
    expect(parseRoute('/themes/daily-life', '?q=%D1%80%D0%B5%D0%BA%D0%B0+%D0%B8+%D0%B1%D1%80%D1%8F%D0%B3')).toEqual({ name: 'theme', themeId: 'daily-life', q: 'река и бряг' })
    // Nothing deeper is a theme.
    expect(parseRoute('/themes/daily-life/words', '')).toEqual({ name: 'home' })
    expect(parseRoute('/themes', '')).toEqual({ name: 'themes' })
  })

  it('routes feedback, keeping where it was opened from only as the path of a screen the app has', () => {
    expect(routeHref({ name: 'feedback', from: '/practice/words' })).toBe('/feedback?from=%2Fpractice%2Fwords')
    expect(parseRoute('/feedback', '?from=%2Fpractice%2Fwords%3Funit%3Da1-02')).toEqual({ name: 'feedback', from: '/practice/words' })
    expect(parseRoute('/feedback', '?from=/settings/about/')).toEqual({ name: 'feedback', from: '/settings/about' })
    expect(parseRoute('/feedback', '?from=%2Fno-such-screen')).toEqual({ name: 'feedback', from: '/' })
    expect(parseRoute('/feedback', '?from=https%3A%2F%2Fexample.com%2F')).toEqual({ name: 'feedback' })
    expect(parseRoute('/feedback', '?from=%2Ffeedback')).toEqual({ name: 'feedback' })
    expect(parseRoute('/feedback/', '')).toEqual({ name: 'feedback' })
  })

  it('names a route’s path without its query', () => {
    expect(routePath({ name: 'practice-words', mode: 'flashcard', unit: 'a1-02' })).toBe('/practice/words')
    expect(routePath({ name: 'home' })).toBe('/')
  })

  it('routes the sign-in screen', () => {
    expect(parseRoute('/signin', '')).toEqual({ name: 'signin' })
    expect(routeHref({ name: 'signin' })).toBe('/signin')
  })

  it('routes settings', () => {
    expect(parseRoute('/settings', '')).toEqual({ name: 'settings' })
    expect(routeHref({ name: 'settings' })).toBe('/settings')
  })

  it('routes each settings section, and nothing else under settings', () => {
    expect(parseRoute('/settings/study', '')).toEqual({ name: 'settings', section: 'study' })
    expect(parseRoute('/settings/languages/', '')).toEqual({ name: 'settings', section: 'languages' })
    expect(routeHref({ name: 'settings', section: 'account' })).toBe('/settings/account')
    expect(parseRoute('/settings/nonsense', '')).toEqual({ name: 'home' })
  })

  it('routes the placement test under settings', () => {
    expect(parseRoute('/settings/placement', '')).toEqual({ name: 'placement' })
    expect(routeHref({ name: 'placement' })).toBe('/settings/placement')
  })

  it('routes changing the native language under settings (plan 11)', () => {
    expect(parseRoute('/settings/native-language', '')).toEqual({ name: 'native-language' })
    expect(routeHref({ name: 'native-language' })).toBe('/settings/native-language')
  })
})

function Where() {
  const route = useRoute()
  return (
    <>
      <output>{route.name}</output>
      <Link to={{ name: 'path' }}>path</Link>
    </>
  )
}

describe('the search route', () => {
  it('reads and writes the query', () => {
    expect(parseRoute('/search', '')).toEqual({ name: 'search', q: '' })
    expect(parseRoute('/search/', '?q=run')).toEqual({ name: 'search', q: 'run' })
    expect(routeHref({ name: 'search', q: '' })).toBe('/search')
    expect(routeHref({ name: 'search', q: 'thank you' })).toBe('/search?q=thank+you')
  })

  it('carries any text through the address unchanged', () => {
    for (const q of ['a+b', 'c&d=e', '100%', '“run”', 'бягам', ' two  spaces ']) {
      const url = new URL(routeHref({ name: 'search', q }), 'http://local')
      expect(parseRoute(url.pathname, url.search)).toEqual({ name: 'search', q })
    }
  })
})

describe('the path route', () => {
  it('reads and writes the unit it opens at', () => {
    expect(parseRoute('/path', '')).toEqual({ name: 'path' })
    expect(parseRoute('/path', '?unit=a1-02')).toEqual({ name: 'path', unit: 'a1-02' })
    expect(routeHref({ name: 'path' })).toBe('/path')
    expect(routeHref({ name: 'path', unit: 'a1-02' })).toBe('/path?unit=a1-02')
  })
})

describe('navigation', () => {
  it('updates the route on navigate and on a link click', () => {
    render(<Where />)
    expect(screen.getByRole('status').textContent).toBe('home')
    act(() => navigate({ name: 'themes' }))
    expect(screen.getByRole('status').textContent).toBe('themes')
    expect(window.location.pathname).toBe('/themes')
    fireEvent.click(screen.getByRole('link', { name: 'path' }))
    expect(screen.getByRole('status').textContent).toBe('path')
    expect(window.location.pathname).toBe('/path')
  })

  it('leaves a modified click to the browser', () => {
    render(<Where />)
    fireEvent.click(screen.getByRole('link', { name: 'path' }), { ctrlKey: true })
    expect(screen.getByRole('status').textContent).toBe('home')
  })

  it('replaces the entry when asked', () => {
    const before = window.history.length
    act(() => navigate({ name: 'progress' }, { replace: true }))
    expect(window.history.length).toBe(before)
    expect(window.location.pathname).toBe('/progress')
  })

  it('tells the listeners even when the browser refuses a replacement, and not when it refuses a push', () => {
    const told = vi.fn()
    window.addEventListener('wordado:navigate', told)
    const refuse = () => {
      throw new DOMException('Too many calls', 'SecurityError')
    }
    vi.spyOn(window.history, 'replaceState').mockImplementation(refuse)
    vi.spyOn(window.history, 'pushState').mockImplementation(refuse)
    try {
      expect(() => navigate({ name: 'progress' }, { replace: true })).not.toThrow()
      expect(told).toHaveBeenCalledTimes(1)
      expect(() => navigate({ name: 'progress' })).toThrow()
      expect(told).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('wordado:navigate', told)
      vi.restoreAllMocks()
    }
  })
})
