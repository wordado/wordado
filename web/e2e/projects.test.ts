import { describe, expect, it } from 'vitest'
import { BROWSER_PROJECTS, selectProjects } from './projects'

const names = (value: string | undefined) => selectProjects(value).map((p) => p.name)

describe('the end-to-end browser matrix (spec §13)', () => {
  it('holds desktop Chrome, Firefox and Safari, and mobile Chrome and Safari', () => {
    expect(BROWSER_PROJECTS.map((p) => p.name)).toEqual(['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'])
  })

  it('turns off Firefox’s form history, whose dropdown swallows the next click', () => {
    const firefox = BROWSER_PROJECTS.find((p) => p.name === 'firefox')
    expect(firefox?.use?.launchOptions?.firefoxUserPrefs).toEqual({ 'browser.formfill.enable': false })
  })

  it('retries a test once in the WebKit projects only, whose CI runs stall at random since October 2026', () => {
    expect(Object.fromEntries(BROWSER_PROJECTS.map((p) => [p.name, p.retries ?? 0]))).toEqual({
      chromium: 0, firefox: 0, webkit: 1, 'mobile-chrome': 0, 'mobile-safari': 1,
    })
  })

  it('runs Chromium alone unless told otherwise, as local runs always have', () => {
    expect(names(undefined)).toEqual(['chromium'])
    expect(names('')).toEqual(['chromium'])
  })

  it('runs the named projects, or all of them', () => {
    expect(names('webkit')).toEqual(['webkit'])
    expect(names(' firefox , webkit ')).toEqual(['firefox', 'webkit'])
    expect(names('all')).toEqual(['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'])
  })

  it('refuses a name it does not know, rather than running nothing', () => {
    expect(() => selectProjects('safari')).toThrow(/Unknown E2E_PROJECTS: safari/)
  })
})
