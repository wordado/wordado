import type { Store } from '@wordado/client-data'

/**
 * Runs `run` now, and whenever the active corpus version changes (plan 8b, Decision 6): the credits and the
 * fixes follow the pack the learner has, like the audio cache does (`refreshAudioOnActivation`).
 */
export function watchContentFiles(target: { readonly store: Store<{ readonly packVersion: number | null }> }, run: () => void): () => void {
  let version = target.store.get().packVersion
  run()
  return target.store.subscribe(() => {
    const { packVersion } = target.store.get()
    if (packVersion === version) return
    version = packVersion
    run()
  })
}
