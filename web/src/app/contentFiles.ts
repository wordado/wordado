import type { Store } from '@wordado/client-data'
import type { Course } from '@wordado/core'

/**
 * Runs `run` now, and whenever the active corpus version or the course (its native language or its target) changes
 * (plan 8b, Decision 6; plan 10; spec §8.6): the credits and the fixes follow the pack the learner has, like the audio
 * cache does (`refreshAudioOnActivation`).
 */
export function watchContentFiles(target: { readonly store: Store<{ readonly packVersion: number | null; readonly course: Course }> }, run: () => void): () => void {
  let { packVersion: version, course: current } = target.store.get()
  run()
  return target.store.subscribe(() => {
    const { packVersion, course } = target.store.get()
    // Each snapshot carries a new `course` object: compared by its fields.
    if (packVersion === version && course.target === current.target && course.l1 === current.l1) return
    version = packVersion
    current = course
    run()
  })
}
