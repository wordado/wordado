import type { AudioClip, Corpus } from '@wordado/core'
import type { AudioPort, AudioStore } from './audio'

/**
 * The one AudioPort the screens hold, over one AudioStore per manifest: a
 * clip's URL is relative to the manifest that listed its pack (plan 3), and
 * the demo (the bundled sample) and a learner (the CDN) use different ones.
 * Every store writes to the same cache, keyed by absolute URL.
 */
export class AudioSwitch implements AudioPort {
  private readonly stores = new Map<string, AudioStore>()
  private current: AudioStore
  private currentUrl: string

  constructor(
    private readonly make: (manifestUrl: string) => AudioStore,
    manifestUrl: string,
  ) {
    this.currentUrl = manifestUrl
    this.current = this.storeFor(manifestUrl)
  }

  private storeFor(manifestUrl: string): AudioStore {
    let store = this.stores.get(manifestUrl)
    if (!store) {
      store = this.make(manifestUrl)
      this.stores.set(manifestUrl, store)
    }
    return store
  }

  /** The manifest whose clips are answered for now. */
  get manifestUrl(): string {
    return this.currentUrl
  }

  /** Called before the app shows a Client (Boot's `prepare`): the demo's or the learner's manifest. */
  use(manifestUrl: string): void {
    this.currentUrl = manifestUrl
    this.current = this.storeFor(manifestUrl)
  }

  cachedClips(): ReadonlySet<string> {
    return this.current.cachedClips()
  }

  streamable(): boolean {
    return this.current.streamable()
  }

  play(clip: AudioClip): Promise<void> {
    return this.current.play(clip)
  }

  prefetch(clips: readonly AudioClip[]): Promise<number> {
    return this.current.prefetch(clips)
  }

  refresh(corpus: Corpus): Promise<void> {
    return this.current.refresh(corpus)
  }
}
