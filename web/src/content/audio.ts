import type { AudioClip, Corpus } from '@wordado/core'
import { clipUrl, type Fetch } from './packs'

/** The one cache the app writes audio to (spec §9.3). Bump the suffix to drop every clip. */
export const AUDIO_CACHE = 'wordado-audio-v1'

/** Thrown by `play()` when a newer call has taken over; never a real playback failure (spec §7.5). */
export class ClipSuperseded extends Error {
  constructor(message = 'Superseded by another clip') {
    super(message)
    this.name = 'ClipSuperseded'
  }
}

/** What the study views and runs need from audio. */
export interface AudioPort {
  /** Clips that can be played offline: empty when this browser cannot play the pack's format (spec §7.5). */
  cachedClips(): ReadonlySet<string>
  /** Whether a clip that is not cached can be played now: the format plays and the device is online. */
  streamable(): boolean
  /** Plays a clip; resolves when it ends, rejects when it cannot be played. */
  play(clip: AudioClip): Promise<void>
  /** Fetches, verifies and caches clips ahead of need (spec §9.3); resolves with how many were added. */
  prefetch(clips: readonly AudioClip[]): Promise<number>
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
  private pending: { reject: (err: Error) => void } | null = null
  /** Bumped by every `play()`; a call whose value has moved on is superseded, whichever setup finishes last. */
  private generation = 0

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
   * Fetches `clip`'s bytes, verifies them against the pack's checksum, and
   * caches them (spec §9.3) — the one place either `prefetch` or `play`
   * puts an unverified clip into the cache. Throws if the fetch fails or the
   * bytes do not match; nothing is cached on failure.
   */
  private async fetchVerifyAndCache(clip: AudioClip): Promise<Uint8Array<ArrayBuffer>> {
    const response = await this.fetch(this.url(clip))
    if (!response.ok) throw new Error(`The clip could not be fetched (${response.status})`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength !== clip.bytes || (await this.options.sha256(bytes)) !== clip.sha256) {
      throw new Error('The clip does not match the pack’s checksum')
    }
    const cache = await this.open()
    await cache.put(this.url(clip), new Response(bytes, { headers: { 'content-type': clip.mime } }))
    this.cached.set(clip.clipId, clip.mime)
    return bytes
  }

  /**
   * Fetches, verifies and caches the clips not cached yet, one at a time
   * (spec §9.3). A clip that fails to fetch or to verify is skipped; it is
   * tried again at the next prefetch. Returns how many were added.
   */
  async prefetch(clips: readonly AudioClip[]): Promise<number> {
    let added = 0
    for (const clip of clips) {
      if (this.cached.has(clip.clipId)) continue
      try {
        await this.fetchVerifyAndCache(clip)
        added += 1
      } catch {
        // Offline, the CDN failed, or the bytes failed verification: the next prefetch tries again.
      }
    }
    return added
  }

  /**
   * Plays a clip, verifying it first when it is not already cached (spec
   * §9.3 and plan 3's verify-before-use contract: streamed bytes are checked
   * exactly like prefetched ones, never played unverified).
   *
   * Only the newest call ever touches `this.player`/`this.pending` or pauses
   * a player: `generation` is claimed synchronously, before any await, so an
   * older call started earlier can never win the race even if its own setup
   * (a slow fetch, say) finishes after a newer call has already started
   * playing. A call still waiting for `'ended'` is rejected immediately, via
   * `this.pending`; a call still in its own setup notices at its next await
   * and bails there instead, revoking whatever it had already created.
   */
  async play(clip: AudioClip): Promise<void> {
    const generation = ++this.generation
    const superseded = () => generation !== this.generation
    this.pending?.reject(new ClipSuperseded())

    const cache = await this.open()
    if (superseded()) throw new ClipSuperseded()

    const cached = await cache.match(this.url(clip))
    if (superseded()) throw new ClipSuperseded()

    const bytes = cached ? new Uint8Array(await cached.arrayBuffer()) : await this.fetchVerifyAndCache(clip)
    if (superseded()) throw new ClipSuperseded()

    const source = URL.createObjectURL(await new Response(bytes, { headers: { 'content-type': clip.mime } }).blob())
    if (superseded()) {
      URL.revokeObjectURL(source)
      throw new ClipSuperseded()
    }

    this.player?.pause()
    const player = (this.options.player ?? (() => new Audio()))()
    this.player = player

    const token: { reject: (err: Error) => void } = { reject: () => undefined }
    this.pending = token

    try {
      await new Promise<void>((resolve, reject) => {
        const removeListeners = () => {
          player.removeEventListener('ended', ended)
          player.removeEventListener('error', failed)
        }
        const ended = () => {
          removeListeners()
          resolve()
        }
        const failed = () => {
          removeListeners()
          reject(new Error('The clip could not be played'))
        }
        token.reject = (err) => {
          removeListeners()
          reject(err)
        }
        player.addEventListener('ended', ended)
        player.addEventListener('error', failed)
        player.src = source
        player.play().catch((err) => {
          removeListeners()
          reject(err)
        })
      })
    } finally {
      URL.revokeObjectURL(source)
      if (this.pending === token) this.pending = null
    }
  }
}
