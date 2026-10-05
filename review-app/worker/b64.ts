export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4))
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  },
  encodeText: (text: string) => b64url.encode(new TextEncoder().encode(text)),
  decodeText: (text: string) => new TextDecoder().decode(b64url.decode(text)),
}
