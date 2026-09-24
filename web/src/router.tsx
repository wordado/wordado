import type { Mode } from '@wordado/core'
import { useMemo, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'study'; readonly mode: Mode | null }
  | { readonly name: 'practice' }
  | { readonly name: 'practice-words'; readonly mode: Mode | null }
  | { readonly name: 'matching' }
  | { readonly name: 'path' }
  | { readonly name: 'themes' }
  | { readonly name: 'progress' }

/** Modes a learner can choose for a run; matching has its own route. */
const RUN_MODES: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select']

function modeParam(search: string): Mode | null {
  const mode = new URLSearchParams(search).get('mode')
  return RUN_MODES.find((m) => m === mode) ?? null
}

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  switch (path) {
    case '/study':
      return { name: 'study', mode: modeParam(search) }
    case '/practice':
      return { name: 'practice' }
    case '/practice/words':
      return { name: 'practice-words', mode: modeParam(search) }
    case '/practice/matching':
      return { name: 'matching' }
    case '/path':
      return { name: 'path' }
    case '/themes':
      return { name: 'themes' }
    case '/progress':
      return { name: 'progress' }
    default:
      return { name: 'home' }
  }
}

const withMode = (path: string, mode: Mode | null) => (mode === null ? path : `${path}?mode=${mode}`)

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'study':
      return withMode('/study', route.mode)
    case 'practice':
      return '/practice'
    case 'practice-words':
      return withMode('/practice/words', route.mode)
    case 'matching':
      return '/practice/matching'
    default:
      return `/${route.name}`
  }
}

const NAVIGATE = 'wordado:navigate'

export function navigate(route: Route, options: { readonly replace?: boolean } = {}): void {
  const href = routeHref(route)
  if (options.replace) window.history.replaceState(null, '', href)
  else window.history.pushState(null, '', href)
  window.dispatchEvent(new Event(NAVIGATE))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAVIGATE, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAVIGATE, listener)
  }
}

const location = () => `${window.location.pathname}${window.location.search}`

export function useRoute(): Route {
  const current = useSyncExternalStore(subscribe, location, location)
  return useMemo(() => {
    const url = new URL(current, 'http://local')
    return parseRoute(url.pathname, url.search)
  }, [current])
}

export interface LinkProps {
  readonly to: Route
  readonly className?: string
  readonly children?: ReactNode
  readonly 'aria-current'?: 'page'
}

/** An ordinary link that navigates in place; a modified click opens a tab as usual. */
export function Link(props: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(props.to)
  }
  return (
    <a href={routeHref(props.to)} className={props.className} aria-current={props['aria-current']} onClick={onClick}>
      {props.children}
    </a>
  )
}
