import { canonicalJson } from '@wordado/core'

/** The pipeline's rowContent (aiReview/store.ts), with WebCrypto instead of node:crypto, for the Worker. */
export async function rowHash(queue: string, proposed: unknown, reopened: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson({ queue, proposed, reopened })))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
