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

  it('routes the sign-in screen', () => {
    expect(parseRoute('/signin', '')).toEqual({ name: 'signin' })
    expect(routeHref({ name: 'signin' })).toBe('/signin')
  })

  it('routes settings', () => {
    expect(parseRoute('/settings', '')).toEqual({ name: 'settings' })
    expect(routeHref({ name: 'settings' })).toBe('/settings')
  })

  it('routes the placement test under settings', () => {
    expect(parseRoute('/settings/placement', '')).toEqual({ name: 'placement' })
    expect(routeHref({ name: 'placement' })).toBe('/settings/placement')
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
