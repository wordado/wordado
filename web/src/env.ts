import type { ClientEnv } from '@wordado/client-data'

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The browser's ClientEnv (plan 4 contract). */
export function webEnv(): ClientEnv {
  const word = new Uint32Array(1)
  return {
    now: () => Date.now(),
    // `0 -` rather than unary minus, so UTC is 0 and not -0.
    tzOffsetMin: () => 0 - new Date().getTimezoneOffset(),
    uuid: () => crypto.randomUUID(),
    rng: () => {
      crypto.getRandomValues(word)
      return word[0]! / 4_294_967_296
    },
    // A copy, so the digest sees an ArrayBuffer-backed view whatever the caller passed.
    sha256: async (bytes) => toHex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
  }
}
