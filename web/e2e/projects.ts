import type { Project } from '@playwright/test'
import { devices } from 'playwright'

/**
 * Spec §13's browser matrix: desktop Chrome, Firefox and Safari, and mobile
 * Chrome and Safari. WebKit's contexts cannot open OPFS files, so the two
 * WebKit projects run the IndexedDB fallback (spec §13's "no-OPFS" case).
 */
export const BROWSER_PROJECTS: readonly Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
]

/** The projects `E2E_PROJECTS` names (comma-separated, or `all`); Chromium alone when it is unset, as local runs have always been. */
export function selectProjects(value: string | undefined, all: readonly Project[] = BROWSER_PROJECTS): Project[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) return all.filter((p) => p.name === 'chromium')
  if (names.includes('all')) return [...all]
  const unknown = names.filter((name) => !all.some((p) => p.name === name))
  if (unknown.length > 0) throw new Error(`Unknown E2E_PROJECTS: ${unknown.join(', ')} (known: ${all.map((p) => p.name).join(', ')}, all)`)
  return all.filter((p) => names.includes(p.name!))
}
