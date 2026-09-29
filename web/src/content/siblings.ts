import { manifestBase, type Fetch } from './packs'

/** The small files the CDN serves beside the manifest (plan 8b). */
export type SiblingFile = 'credits.json' | 'fixes.json'

/** Where `name` is: beside the manifest, so the demo's sample and a learner's CDN each have their own. */
export function siblingUrl(manifestUrl: string, name: SiblingFile, page?: string): string {
  // manifestBase's page defaults to the current location when undefined.
  return new URL(name, manifestBase(manifestUrl, page)).href
}

/**
 * The validated file, or null for anything else: offline, missing, not JSON, another schema. Never throws; the
 * caller keeps what it had and asks again at the next trigger (plan 8b, Decision 6).
 */
export async function fetchSibling<T>(
  manifestUrl: string,
  name: SiblingFile,
  validate: (value: unknown) => T | null,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<T | null> {
  try {
    const response = await fetchFn(siblingUrl(manifestUrl, name), { cache: 'no-cache' })
    if (!response.ok) return null
    return validate(await response.json())
  } catch {
    return null
  }
}
