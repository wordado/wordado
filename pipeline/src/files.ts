import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

/** Content-repository files are diffed by people, so every write is stable: two-space JSON, one trailing newline. */
export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function readJsonOr<T>(file: string, fallback: T): T {
  return existsSync(file) ? readJson<T>(file) : fallback
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return []
      try {
        return [JSON.parse(line) as T]
      } catch {
        throw new Error(`${basename(file)}:${i + 1}: not JSON`)
      }
    })
}

/** One line per item, appended at once: a crash never loses a line already written (Review Focus 2). */
export function appendJsonl(file: string, items: readonly unknown[]): void {
  if (items.length === 0) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, items.map((item) => `${JSON.stringify(item)}\n`).join(''))
}
