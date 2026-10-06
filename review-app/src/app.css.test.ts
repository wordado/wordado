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
  it('has the learner app’s tokens, light and dark', () => {
    for (const t of ['--paper', '--paper-raised', '--ink', '--ink-soft', '--rule', '--rose', '--leaf', '--blue', '--font-ui', '--font-entry']) expect(css).toContain(`${t}:`)
    expect(css).toMatch(/prefers-color-scheme: dark/)
  })
})
