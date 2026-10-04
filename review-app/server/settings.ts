import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export const settingsFile = (home = homedir()) => join(home, '.config', 'wordado', 'review-app.json')

export function readReviewer(file: string): string | null {
  if (!existsSync(file)) return null
  const name = (JSON.parse(readFileSync(file, 'utf8')) as { reviewer?: unknown }).reviewer
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : null
}

export function writeReviewer(file: string, name: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify({ reviewer: name.trim() }, null, 2)}\n`)
}
