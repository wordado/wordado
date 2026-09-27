import { canonicalJson } from '@wordado/core'
import { readLastPublished } from './lastPublished'

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * A release is built on `last-published/`. If the CDN serves anything else,
 * the release would skip a version, or re-number one, and its succession
 * check would pass against the wrong predecessor (Review Focus 3).
 */
export async function liveProblems(dir: string, manifestUrl: string, fetchText: (url: string) => Promise<string> = defaultFetch): Promise<string[]> {
  const local = readLastPublished(dir).manifest
  let text: string
  try {
    text = await fetchText(manifestUrl)
  } catch (err) {
    return [`${manifestUrl}: ${err instanceof Error ? err.message : String(err)}`]
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
