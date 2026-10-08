import { useClientSnapshot, type ClientSnapshot } from '@wordado/client-data'
import { offeredThemes, practisable, scopePool, unitPractisable, type LocalizedText, type PracticeContext, type PracticeScope, type WordId } from '@wordado/core'
import { useMemo } from 'react'
import type { MessageKey } from '../i18n/i18n'
import type { Route } from '../router'

/** What a practice address may name (`?unit=<unitId>` or `?theme=<themeId>`); a unit wins over a theme. */
export interface ScopeParams {
  readonly unit?: string | undefined
  readonly theme?: string | undefined
}

/** The unit or theme a practice screen keeps to, with everything the screens say about it. */
export interface PracticeScopeView {
  readonly scope: PracticeScope
  /** What the practice routes carry on, so the learner stays in the scope. */
  readonly params: ScopeParams
  readonly title: LocalizedText
  /** How many words practice draws on: every live word of a theme or of a skipped level's unit, the started ones of any other unit; none of them set aside. */
  readonly words: number
  /** How many of those were never started: above zero only where the scope is practised whole. */
  readonly unstarted: number
  /** A unit of a level the learner skipped (spec §7.2): its practice shows words that were never started, and says so. */
  readonly skipped: boolean
  /** "Unit: {title}" or "Theme: {title}". */
  readonly label: MessageKey
  /** The mixed run's button. */
  readonly start: MessageKey
  /** Matching's sentence when the scope has fewer than five such words; only a unit of the learner's own levels asks for started ones. */
  readonly needWords: MessageKey
  /** Where the learner came from, and what the way back is called. */
  readonly back: Route
  readonly backLabel: MessageKey
}

/**
 * The unit or theme a practice route names (spec §7.4), or null for practice over everything: nothing in the
 * address, a unit the corpus does not hold or that is still locked, or a theme that is not offered.
 */
export function usePracticeScope(params: ScopeParams): PracticeScopeView | null {
  const { corpus, settings, path, progress, states, flags } = useClientSnapshot()
  const { unit: unitId, theme: themeId } = params
  return useMemo((): PracticeScopeView | null => {
    if (!corpus) return null
    if (unitId !== undefined) {
      const unit = path?.unlocked.has(unitId) ? corpus.units.find((u) => u.unitId === unitId) : undefined
      if (!unit) return null
      const skipped = progress?.levels[unit.level]?.kind === 'skipped'
      const unitProgress = progress?.units.get(unitId)
      return {
        scope: { kind: 'unit', id: unitId },
        params: { unit: unitId },
        title: unit.title,
        // The path's own count, by the same rule as `practisable`.
        words: unitProgress ? unitPractisable(unitProgress, skipped) : 0,
        unstarted: unitProgress && skipped ? unitProgress.live - unitProgress.introduced : 0,
        skipped,
        label: 'practice.unit',
        start: 'path.practiseUnit',
        needWords: skipped ? 'practice.needWordsSkippedUnit' : 'practice.needWordsUnit',
        back: { name: 'path' },
        backLabel: 'practice.toPath',
      }
    }
    const theme = themeId === undefined ? undefined : offeredThemes(corpus).find((t) => t.themeId === themeId)
    if (!theme) return null
    const scope: PracticeScope = { kind: 'theme', id: theme.themeId }
    return {
      scope,
      params: { theme: theme.themeId },
      title: theme.name,
      ...scopeWords({ corpus, settings, states, flags }, scope),
      skipped: false,
      label: 'practice.theme',
      start: 'themes.practise',
      needWords: 'practice.needWordsTheme',
      back: { name: 'themes' },
      backLabel: 'practice.toThemes',
    }
  }, [corpus, settings, path, progress, states, flags, unitId, themeId])
}

/** How many of these words practice may use (started unless the scope is practised whole, not set aside, not retired): something can be practised once this is above zero. */
export function practisableCount(wordIds: Iterable<WordId>, ctx: PracticeContext): number {
  let count = 0
  for (const wordId of wordIds) if (practisable(wordId, ctx)) count += 1
  return count
}

/**
 * The same count for one unit or theme, by the rule its practice draws by (`scopePool`): a theme is counted whole.
 * With it, how many of those words were never started.
 */
export function scopeWords(snapshot: Pick<ClientSnapshot, 'corpus' | 'settings' | 'states' | 'flags'>, scope: PracticeScope): { readonly words: number; readonly unstarted: number } {
  const { corpus, settings, states, flags } = snapshot
  const pool = scopePool(corpus, settings.declaredLevel, scope)
  if (!corpus || !pool) return { words: 0, unstarted: 0 }
  const ctx = { states, flags, retired: corpus.retired }
  const words = practisableCount(pool.within, { ...ctx, unstarted: pool.unstarted })
  return { words, unstarted: words - practisableCount(pool.within, ctx) }
}
