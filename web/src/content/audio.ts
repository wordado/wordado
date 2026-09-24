import type { AudioClip, Corpus } from '@wordado/core'
import { clipUrl, type Fetch } from './packs'

/** The one cache the app writes audio to (spec §9.3). Bump the suffix to drop every clip. */
export const AUDIO_CACHE = 'wordado-audio-v1'

/** What the study views and runs need from audio. */
export interface AudioPort {
  /** Clips that can be played offline: empty when this browser cannot play the pack's format (spec §7.5). */
  cachedClips(): ReadonlySet<string>
  /** Whether a clip that is not cached can be played now: the format plays and the device is online. */
  streamable(): boolean
  /** Plays a clip; resolves when it ends, rejects when it cannot be played. */
  play(clip: AudioClip): Promise<void>
}

/** The part of HTMLAudioElement the store uses. */
export interface PlayerLike {
  src: string
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}

export interface AudioStoreOptions {
  readonly manifestUrl: string
  readonly sha256: (bytes: Uint8Array) => Promise<string>
  readonly caches?: CacheStorage
  readonly fetch?: Fetch
  readonly online?: () => boolean
  /** Whether the browser plays a MIME type; `canPlayType` by default. */
  readonly canPlay?: (mime: string) => boolean
  readonly player?: () => PlayerLike
}

const browserCanPlay = (mime: string): boolean => {
  try {
    return new Audio().canPlayType(mime) !== ''
  } catch {
    return false
  }
}

/**
 * Clips verified against the pack's checksum and kept in Cache Storage
 * (spec §9.3). Every question about availability is answered for clips this
 * browser can play, so `client-data` never offers listening that would fail.
 */
export class AudioStore implements AudioPort {
  private readonly cached = new Map<string, string>()
  private readonly playable = new Map<string, boolean>()
  private formatsPlay = false
  private player: PlayerLike | null = null

  constructor(private readonly options: AudioStoreOptions) {}

  private canPlay(mime: string): boolean {
    let known = this.playable.get(mime)
    if (known === undefined) {
      known = (this.options.canPlay ?? browserCanPlay)(mime)
      this.playable.set(mime, known)
    }
    return known
  }

  private url(clip: AudioClip): string {
    return clipUrl(clip, this.options.manifestUrl)
  }

  private open(): Promise<Cache> {
    return (this.options.caches ?? caches).open(AUDIO_CACHE)
  }

  private fetch(url: string): Promise<Response> {
    return (this.options.fetch ?? ((i, init) => fetch(i, init)))(url)
  }

  /** Re-reads which of the corpus's clips are cached; call after a pack is activated. */
  async refresh(corpus: Corpus): Promise<void> {
    const cache = await this.open()
    const keys = new Set((await cache.keys()).map((request) => request.url))
    const clips = [...corpus.clips.values()]
    this.cached.clear()
    for (const clip of clips) if (keys.has(this.url(clip))) this.cached.set(clip.clipId, clip.mime)
    this.formatsPlay = clips.length > 0 && clips.every((clip) => this.canPlay(clip.mime))
  }

  cachedClips(): ReadonlySet<string> {
    return new Set([...this.cached].filter(([, mime]) => this.canPlay(mime)).map(([clipId]) => clipId))
  }

  streamable(): boolean {
    return this.formatsPlay && (this.options.online ?? (() => navigator.onLine))()
  }

  /**
   * Fetches, verifies and caches the clips not cached yet, one at a time
   * (spec §9.3). A clip that fails to fetch or to verify is skipped; it is
   * tried again at the next prefetch. Returns how many were added.
   */
  async prefetch(clips: readonly AudioClip[]): Promise<number> {
    const cache = await this.open()
    let added = 0
    for (const clip of clips) {
      if (this.cached.has(clip.clipId)) continue
      try {
        const response = await this.fetch(this.url(clip))
        if (!response.ok) continue
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== clip.bytes || (await this.options.sha256(bytes)) !== clip.sha256) continue
        await cache.put(this.url(clip), new Response(bytes, { headers: { 'content-type': clip.mime } }))
        this.cached.set(clip.clipId, clip.mime)
        added += 1
      } catch {
        // Offline, or the CDN failed: the next prefetch tries again.
      }
    }
    return added
  }

  async play(clip: AudioClip): Promise<void> {
    const cache = await this.open()
    const response = (await cache.match(this.url(clip))) ?? (await this.fetch(this.url(clip)))
    if (!response.ok) throw new Error(`The clip could not be fetched (${response.status})`)
    const source = URL.createObjectURL(await response.blob())
    this.player?.pause()
    const player = (this.options.player ?? (() => new Audio()))()
    this.player = player
    try {
      await new Promise<void>((resolve, reject) => {
        const ended = () => resolve()
        const failed = () => reject(new Error('The clip could not be played'))
        player.addEventListener('ended', ended)
        player.addEventListener('error', failed)
        player.src = source
        player.play().catch(reject)
      })
    } finally {
      URL.revokeObjectURL(source)
    }
  }
}
