import type { Store } from '@wordado/client-data'

/**
 * Runs `run` now, and whenever the active corpus version or the native language changes (plan 8b, Decision 6; plan
 * 10): the credits and the fixes follow the pack the learner has, like the audio cache does (`refreshAudioOnActivation`).
 */
export function watchContentFiles(target: { readonly store: Store<{ readonly packVersion: number | null; readonly l1: string }> }, run: () => void): () => void {
  let { packVersion: version, l1: language } = target.store.get()
  run()
  return target.store.subscribe(() => {
    const { packVersion, l1 } = target.store.get()
    if (packVersion === version && l1 === language) return
    version = packVersion
    language = l1
    run()
  })
}
