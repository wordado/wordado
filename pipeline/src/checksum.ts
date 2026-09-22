import { createHash } from 'node:crypto'

/** The checksum a manifest carries for a pack, and a pack for a clip (spec §5.1, §9.3). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
