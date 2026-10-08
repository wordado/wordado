import type { PracticeScope, WordId } from '@wordado/core'

/**
 * What practice kept to a unit or theme has shown since the app was opened (spec §7.4), so that its rounds go
 * through the whole scope before any word repeats. One memory per scope, shared by its runs and its matching
 * boards. It lives in memory only: nothing is stored or synced, and it is gone with the app. Practice over
 * everything keeps none.
 */
export class PracticeVisit {
  private readonly shown = new Map<string, Set<WordId>>()

  private static key(scope: PracticeScope): string {
    return `${scope.kind}:${scope.id}`
  }

  /**
   * What a new round draws against: the words the scope has shown so far, as a copy that later rounds do not
   * change. Once every one of `candidates` — the words a run of the scope can draw now, for runs and matching
   * boards alike — has been shown, the scope starts over, and nothing counts as shown.
   */
  begin(scope: PracticeScope, candidates: readonly WordId[]): ReadonlySet<WordId> {
    const key = PracticeVisit.key(scope)
    const shown = this.shown.get(key)
    if (!shown) return new Set()
    if (candidates.every((wordId) => shown.has(wordId))) {
      this.shown.delete(key)
      return new Set()
    }
    return new Set(shown)
  }

  /** A word of the scope came on screen. */
  show(scope: PracticeScope, wordId: WordId): void {
    const key = PracticeVisit.key(scope)
    const shown = this.shown.get(key)
    if (shown) shown.add(wordId)
    else this.shown.set(key, new Set([wordId]))
  }

  /** How many of these words the scope has shown. */
  seen(scope: PracticeScope, wordIds: readonly WordId[]): number {
    const shown = this.shown.get(PracticeVisit.key(scope))
    return shown ? wordIds.filter((wordId) => shown.has(wordId)).length : 0
  }
}
