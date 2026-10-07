import type { Mode } from '@wordado/core'
import { useMemo, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

/** The sections of settings, each on its own page (`/settings/<section>`); `/settings` alone is their menu. */
export const SETTINGS_SECTIONS = ['study', 'words', 'audio', 'reminders', 'languages', 'account', 'app', 'about'] as const
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'study'; readonly mode: Mode | null }
  | { readonly name: 'practice'; readonly unit?: string | undefined; readonly theme?: string | undefined }
  | { readonly name: 'practice-words'; readonly mode: Mode | null; readonly unit?: string | undefined; readonly theme?: string | undefined }
  | { readonly name: 'matching'; readonly unit?: string | undefined; readonly theme?: string | undefined }
  | { readonly name: 'path' }
  | { readonly name: 'themes' }
  | { readonly name: 'progress' }
  | { readonly name: 'signin' }
  | { readonly name: 'settings'; readonly section?: SettingsSection }
  | { readonly name: 'placement' }
  | { readonly name: 'native-language' }

/** Modes a learner can choose for a run; matching has its own route. */
const RUN_MODES: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select']

function modeParam(search: string): Mode | null {
  const mode = new URLSearchParams(search).get('mode')
  return RUN_MODES.find((m) => m === mode) ?? null
}

/**
 * What a practice route keeps to: one unit (`?unit=<unitId>`) or one theme (`?theme=<themeId>`), the unit when both
 * are given. The screens check it against the path and the themes on offer.
 */
function scopeParam(search: string): { readonly unit?: string; readonly theme?: string } {
  const params = new URLSearchParams(search)
  const unit = params.get('unit')
  if (unit) return { unit }
  const theme = params.get('theme')
  return theme ? { theme } : {}
}

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  switch (path) {
    case '/study':
      return { name: 'study', mode: modeParam(search) }
    case '/practice':
      return { name: 'practice', ...scopeParam(search) }
    case '/practice/words':
      return { name: 'practice-words', mode: modeParam(search), ...scopeParam(search) }
    case '/practice/matching':
      return { name: 'matching', ...scopeParam(search) }
    case '/path':
      return { name: 'path' }
    case '/themes':
      return { name: 'themes' }
    case '/progress':
      return { name: 'progress' }
    case '/signin':
      return { name: 'signin' }
    case '/settings':
      return { name: 'settings' }
    case '/settings/placement':
      return { name: 'placement' }
    case '/settings/native-language':
      return { name: 'native-language' }
    default: {
      const section = SETTINGS_SECTIONS.find((s) => path === `/settings/${s}`)
      return section ? { name: 'settings', section } : { name: 'home' }
    }
  }
}

/** A path with its query: the unit or the theme first, then the mode, each only when there is one. */
function withQuery(path: string, query: { readonly unit?: string | undefined; readonly theme?: string | undefined; readonly mode?: Mode | null }): string {
  const params = new URLSearchParams()
  if (query.unit) params.set('unit', query.unit)
  else if (query.theme) params.set('theme', query.theme)
  if (query.mode) params.set('mode', query.mode)
  const search = params.toString()
  return search === '' ? path : `${path}?${search}`
}

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'study':
      return withQuery('/study', route)
    case 'practice':
      return withQuery('/practice', route)
    case 'practice-words':
      return withQuery('/practice/words', route)
    case 'matching':
      return withQuery('/practice/matching', route)
    case 'placement':
      return '/settings/placement'
    case 'native-language':
      return '/settings/native-language'
    case 'settings':
      return route.section ? `/settings/${route.section}` : '/settings'
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
  readonly 'aria-current'?: 'page' | undefined
  readonly 'aria-label'?: string
  readonly 'aria-describedby'?: string
}

/** An ordinary link that navigates in place; a modified click opens a tab as usual. */
export function Link(props: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(props.to)
  }
  return (
    <a
      href={routeHref(props.to)}
      className={props.className}
      aria-current={props['aria-current']}
      aria-label={props['aria-label']}
      aria-describedby={props['aria-describedby']}
      onClick={onClick}
    >
      {props.children}
    </a>
  )
}
