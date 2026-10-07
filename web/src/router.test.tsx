import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Link, navigate, parseRoute, routeHref, useRoute, type Route } from './router'

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
})
