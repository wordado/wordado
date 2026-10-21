import type { CefrLevel } from './types'
import type { L1, Settings } from './settings'
import type { Target } from './target'

export interface Course { readonly target: Target; readonly l1: L1 }

/** A course the learner is not studying now (spec §8.6): its own three settings, waiting in its `course` document. */
export interface ParkedCourse {
  readonly l1: L1 | null
  readonly declaredLevel: CefrLevel
  readonly activeTheme: string | null
}

/**
 * Switching course: the current course's three settings are parked (unless its language was never chosen), and the
 * other's are restored, or reset for a course never started. One settings patch, so a second device follows at once.
 */
export function courseSwitchPatch(settings: Settings, parked: ParkedCourse | null, to: Target): { park: ParkedCourse | null; settings: Partial<Settings> } {
  if (to === settings.course) return { park: null, settings: {} }
  const park = settings.l1 === null ? null : { l1: settings.l1, declaredLevel: settings.declaredLevel, activeTheme: settings.activeTheme }
  const next = parked ?? { l1: null, declaredLevel: 'A1' as const, activeTheme: null }
  return { park, settings: { course: to, l1: next.l1, declaredLevel: next.declaredLevel, activeTheme: next.activeTheme } }
}
