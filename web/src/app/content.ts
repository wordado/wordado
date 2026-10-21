import type { Client, InstallReport, PackFetcher, Store } from '@wordado/client-data'
import type { Corpus, Course, PackManifest } from '@wordado/core'
import type { AppLifecycle } from './lifecycle'

/** How often a running app looks for newer packs (spec §9.3). Tuning (§15). */
export const PACK_CHECK_INTERVAL_MS = 6 * 60 * 60_000

/** A pack this build cannot read means the app needs updating (spec §9.3); the installed pack stays meanwhile. */
export function noteInstallReport(report: InstallReport, lifecycle: Pick<AppLifecycle, 'markAppTooOld'>): void {
  if (report.appUpdateNeeded.length > 0) lifecycle.markAppTooOld()
}

export interface PackCheckOptions {
  client(): Client | null
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  online(): boolean
  onReport(report: InstallReport): void
}

/** The periodic check (spec §9.3). A newer pack is staged and swaps in at the next session's start. */
export function startPackChecks(options: PackCheckOptions): () => void {
  const timer = setInterval(() => {
    const client = options.client()
    if (!client || !client.snapshot.corpus || !options.online()) return
    void options
      .fetchManifest()
      .then((manifest) => client.installPacks(manifest, options.fetchPack))
      .then(options.onReport)
      .catch(() => undefined)
  }, PACK_CHECK_INTERVAL_MS)
  return () => clearInterval(timer)
}

/**
 * When a staged pack becomes active (at a session's start), or the course
 * changes (a pack of the other L1 or the other target swaps in, perhaps at the
 * same corpus version, plan 10, spec §8.6), the clips it lists may differ:
 * `AudioStore` re-reads which are cached (6a contract), so listening is offered
 * exactly when it can play.
 */
export function refreshAudioOnActivation(
  target: { readonly store: Store<{ readonly packVersion: number | null; readonly corpus: Corpus | null; readonly course: Course }> },
  audio: { refresh(corpus: Corpus): Promise<void> },
): () => void {
  let { packVersion: version, course: current } = target.store.get()
  return target.store.subscribe(() => {
    const { packVersion, corpus, course } = target.store.get()
    if (packVersion === version && course.target === current.target && course.l1 === current.l1) return
    version = packVersion
    current = course
    if (corpus) void audio.refresh(corpus).catch(() => undefined)
  })
}
