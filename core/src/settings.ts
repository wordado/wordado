import { RETENTION_TARGETS, type RetentionSetting } from './scheduler'
import { DEFAULT_NEW_WORD_LIMIT, DEFAULT_REVIEW_CAP, MAX_NEW_WORD_LIMIT } from './session'
import { CEFR_LEVELS, type CefrLevel } from './types'

/** The learner's settings document (spec §6.2, §7.4, §8.4). Validated before any rule reads it. */
export interface Settings {
  readonly declaredLevel: CefrLevel
  readonly newWordLimit: number
  readonly reviewCap: number
  readonly retention: RetentionSetting
  /** Answers per day; null for no goal. */
  readonly dailyGoal: number | null
  /** The active theme collection (spec §8.9); null for path order. */
  readonly activeTheme: string | null
  readonly audio: boolean
}

export const MAX_REVIEW_CAP = 1000

export const DEFAULT_SETTINGS: Settings = {
  declaredLevel: 'A1',
  newWordLimit: DEFAULT_NEW_WORD_LIMIT,
  reviewCap: DEFAULT_REVIEW_CAP,
  retention: 'standard',
  dailyGoal: null,
  activeTheme: null,
  audio: true,
}

export type SettingsValidation =
  | { readonly ok: true; readonly fields: Partial<Settings> }
  | { readonly ok: false; readonly errors: readonly string[] }

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/**
 * Checks a settings patch field by field (roadmap contract: settings are
 * validated before they reach `core`). Unknown fields are errors; the result
 * names only the fields the patch set.
 */
export function validateSettingsPatch(patch: Record<string, unknown>): SettingsValidation {
  const fields: Record<string, unknown> = {}
  const errors: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const valid =
      key === 'declaredLevel'
        ? typeof value === 'string' && (CEFR_LEVELS as readonly string[]).includes(value)
        : key === 'newWordLimit'
          ? isInt(value, 0, MAX_NEW_WORD_LIMIT)
          : key === 'reviewCap'
            ? isInt(value, 0, MAX_REVIEW_CAP)
            : key === 'retention'
              ? typeof value === 'string' && value in RETENTION_TARGETS
              : key === 'dailyGoal'
                ? value === null || isInt(value, 1, Number.MAX_SAFE_INTEGER)
                : key === 'activeTheme'
                  ? value === null || (typeof value === 'string' && value !== '')
                  : key === 'audio'
                    ? typeof value === 'boolean'
                    : false
    if (valid) fields[key] = value
    else errors.push(key)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields: fields as Partial<Settings> }
}

/** Bounds of a real UTC offset in minutes (roadmap contract). */
export const TZ_OFFSET_MIN = -720
export const TZ_OFFSET_MAX = 840

/** A NaN offset would turn a word's stability into NaN for good; check before recording an event. */
export function isValidTzOffset(minutes: number): boolean {
  return isInt(minutes, TZ_OFFSET_MIN, TZ_OFFSET_MAX)
}
