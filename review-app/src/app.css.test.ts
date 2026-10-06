// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')

describe('app.css', () => {
  it('uses colour tokens everywhere outside :root', () => {
    const withoutRoot = css.replace(/(?:@media \(prefers-color-scheme: dark\) \{\s*)?:root \{[^}]*\}\s*\}?/g, '')
    expect(withoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })
  it('shows the swipe hint only on a touch screen, not in every narrow window', () => {
    const shown = [...css.matchAll(/@media ([^{]+)\{\s*\.swipe-hint \{\s*display: block;/g)].map((m) => m[1]!.trim())
    expect(shown).toEqual(['(pointer: coarse)'])
    expect(css).toMatch(/\n\.swipe-hint \{\s*display: none;/)
  })
  it('hides visually hidden text from the eye only: it stays in the page for a screen reader', () => {
    const rule = /\n\.visually-hidden \{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/position: absolute;/)
    expect(rule).toMatch(/clip-path: inset\(50%\);/)
    expect(rule).toMatch(/width: 1px;/)
    expect(rule).not.toMatch(/display: none|visibility: hidden/)
  })
  it('has the learner app’s tokens, light and dark', () => {
    for (const t of ['--paper', '--paper-raised', '--ink', '--ink-soft', '--rule', '--rose', '--leaf', '--blue', '--font-ui', '--font-entry']) expect(css).toContain(`${t}:`)
    expect(css).toMatch(/prefers-color-scheme: dark/)
  })
})
