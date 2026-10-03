import type { PlaywrightTestOptions, PlaywrightWorkerOptions, Project } from '@playwright/test'
import { devices } from 'playwright'

/**
 * Spec §13's browser matrix: desktop Chrome, Firefox and Safari, and mobile
 * Chrome and Safari. WebKit's contexts cannot open OPFS files, so the two
 * WebKit projects run the IndexedDB fallback (spec §13's "no-OPFS" case).
 */
/** A project with Playwright's own option types, so `use.launchOptions` is known. */
export type BrowserProject = Project<PlaywrightTestOptions, PlaywrightWorkerOptions>

export const BROWSER_PROJECTS: readonly BrowserProject[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  // No form history: after one test has typed a birth year, Firefox offers it again in a dropdown under
  // the field, and the click that closes that dropdown is swallowed (the page saw only a mouseup on
  // Continue: run 36315140278). Browser chrome, not the app, so the test browser turns it off.
  { name: 'firefox', use: { ...devices['Desktop Firefox'], launchOptions: { firefoxUserPrefs: { 'browser.formfill.enable': false } } } },
  // Since about 2 October 2026, WebKit on GitHub's runners now and then leaves a page that follows a navigation stuck
  // opening its database, in a different test each run (runs 37101071723, 37103265351); it has not happened on a Mac or
  // in Playwright's Linux image, even on one CPU. One retry keeps CI honest about real failures until the cause is found.
  { name: 'webkit', retries: 1, use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-safari', retries: 1, use: { ...devices['iPhone 15'] } },
]

/** The projects `E2E_PROJECTS` names (comma-separated, or `all`); Chromium alone when it is unset, as local runs have always been. */
export function selectProjects(value: string | undefined, all: readonly BrowserProject[] = BROWSER_PROJECTS): BrowserProject[] {
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
