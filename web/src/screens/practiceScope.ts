import { useClientSnapshot, type PracticeScope } from '@wordado/client-data'
import { corpusWordId, offeredThemes, themeEntries, type LocalizedText } from '@wordado/core'
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
  /** Started words that are not set aside: what practice draws on. */
  readonly started: number
  /** "Unit: {title}" or "Theme: {title}". */
  readonly label: MessageKey
  /** The mixed run's button. */
  readonly start: MessageKey
  /** Matching's sentence when the scope has fewer than five such words. */
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
  const { corpus, path, progress, states, flags } = useClientSnapshot()
  const { unit: unitId, theme: themeId } = params
  return useMemo((): PracticeScopeView | null => {
    if (!corpus) return null
    if (unitId !== undefined) {
      const unit = path?.unlocked.has(unitId) ? corpus.units.find((u) => u.unitId === unitId) : undefined
      if (!unit) return null
      return {
        scope: { kind: 'unit', id: unitId },
        params: { unit: unitId },
        title: unit.title,
        // The path's own count: live words of the unit with a review state.
        started: progress?.units.get(unitId)?.introduced ?? 0,
        label: 'practice.unit',
        start: 'path.practiseUnit',
        needWords: 'practice.needWordsUnit',
        back: { name: 'path' },
        backLabel: 'practice.toPath',
      }
    }
    const theme = themeId === undefined ? undefined : offeredThemes(corpus).find((t) => t.themeId === themeId)
    if (!theme) return null
    return {
      scope: { kind: 'theme', id: theme.themeId },
      params: { theme: theme.themeId },
      title: theme.name,
      started: themeStarted(themeEntries(corpus, theme.themeId).map((e) => e.entryId), states, flags),
      label: 'practice.theme',
      start: 'themes.practise',
      needWords: 'practice.needWordsTheme',
      back: { name: 'themes' },
      backLabel: 'practice.toThemes',
    }
  }, [corpus, path, progress, states, flags, unitId, themeId])
}

type Snapshot = ReturnType<typeof useClientSnapshot>

/** How many of a theme's entries are started and not set aside: a theme can be practised once this is above zero. */
export function themeStarted(entryIds: readonly string[], states: Snapshot['states'], flags: Snapshot['flags']): number {
  return entryIds.filter((entryId) => {
    const wordId = corpusWordId(entryId)
    return states.has(wordId) && !flags.has(wordId)
  }).length
}
