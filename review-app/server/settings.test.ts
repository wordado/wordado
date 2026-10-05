import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readReviewer, settingsFile, writeReviewer } from './settings'

describe('settings', () => {
  it('remembers the reviewer name outside any repository', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const file = settingsFile(home)
    expect(file).toBe(join(home, '.config', 'wordado', 'review-app.json'))
    expect(readReviewer(file)).toBeNull()
    writeReviewer(file, '  Мария ')
    expect(readReviewer(file)).toBe('Мария')
  })

  it('reads a corrupt settings file as null, not a throw', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-'))
    const file = settingsFile(home)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, '{ not json')
    expect(readReviewer(file)).toBeNull()
  })
})
