/**
 * A single namespaced identifier for anything reviewable (spec §6.1).
 * `c:<entry_id>` is a corpus entry; `u:<uuid>` is a standalone user word.
 */
export type WordId = `c:${string}` | `u:${string}`

export type WordKind = 'corpus' | 'user'

const PATTERN = /^(c|u):([A-Za-z0-9][A-Za-z0-9._-]*)$/

export function corpusWordId(entryId: string): WordId {
  return toWordId(`c:${entryId}`)
}

export function userWordId(uuid: string): WordId {
  return toWordId(`u:${uuid}`)
}

export function isWordId(value: string): value is WordId {
  return PATTERN.test(value)
}

export function toWordId(value: string): WordId {
  if (!isWordId(value)) throw new Error(`Invalid word_id: ${JSON.stringify(value)}`)
  return value
}

export function parseWordId(wordId: WordId): { kind: WordKind; key: string } {
  const match = PATTERN.exec(wordId)
  if (!match) throw new Error(`Invalid word_id: ${JSON.stringify(wordId)}`)
  return { kind: match[1] === 'c' ? 'corpus' : 'user', key: match[2]! }
}
