import { canonicalJson } from '@wordado/core'
import { readLastPublished } from './lastPublished'

/** The served text, or null when the CDN answers 404: nothing is published there. */
async function defaultFetch(url: string): Promise<string | null> {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * A release is built on `last-published/`. If the CDN serves anything else,
 * the release would skip a version, or re-number one, and its succession
 * check would pass against the wrong predecessor (Review Focus 3).
 *
 * `fetchText` gives null for a manifest the CDN does not have (404). That is right only before a corpus's first
 * release: `last-published/` is then the empty version 0 that `corpus init --target` writes (a second target, #329).
 */
export async function liveProblems(dir: string, manifestUrl: string, fetchText: (url: string) => Promise<string | null> = defaultFetch): Promise<string[]> {
  const local = readLastPublished(dir).manifest
  let text: string | null
  try {
    text = await fetchText(manifestUrl)
  } catch (err) {
    return [`${manifestUrl}: ${err instanceof Error ? err.message : String(err)}`]
  }
  if (text === null) {
    if (local.corpus_version === 0 && local.packs.length === 0) return []
    return [`${manifestUrl}: not found, but last-published/ holds version ${local.corpus_version}; restore the manifest on the CDN, or check the manifest URL`]
  }
  let served: { corpus_version?: unknown }
  try {
    served = JSON.parse(text) as { corpus_version?: unknown }
  } catch {
    return [`${manifestUrl}: not JSON`]
  }
  if (canonicalJson(served) === canonicalJson(local)) return []
  return [
    `${manifestUrl} serves corpus version ${String(served.corpus_version)}, but last-published/ holds version ${local.corpus_version} with other files; merge the content repository’s latest publish commit, or restore last-published/ from the CDN`,
  ]
}
