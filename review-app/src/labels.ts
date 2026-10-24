import type { Target } from '@wordado/core'
import { type Language, LANGUAGE_NAMES, languageOf, queueParts } from '../shared/hosted'

/** A queue in plain words: "translation-de" → "German translations", "title-bg" → "Bulgarian unit titles",
 * "level" → "English levels"; a second target's by its course: "de/level" → "German levels", "de/translation-bg"
 * → "German course: Bulgarian translations". A queue it does not know comes back as it is. */
export function queueLabel(queue: string): string {
  const language = languageOf(queue)
  if (language === null) return queue
  const { target, name } = queueParts(queue)!
  if (name === 'level' || name === 'grammar') return `${LANGUAGE_NAMES[target]} ${name === 'level' ? 'levels' : 'grammar'}`
  const label = `${LANGUAGE_NAMES[language]} ${name.startsWith('title-') ? 'unit titles' : 'translations'}`
  return target === 'en' ? label : `${LANGUAGE_NAMES[target]} course: ${label}`
}

/** A language of a course as the overview lists it: "Bulgarian", "English levels" (English's own language is its
 * levels), "German course: Bulgarian", "German course" (the target's own: its levels and grammar). */
export function languageLabel(target: Target, language: Language): string {
  if (target === 'en') return language === 'en' ? 'English levels' : LANGUAGE_NAMES[language]
  const course = `${LANGUAGE_NAMES[target]} course`
  return language === target ? course : `${course}: ${LANGUAGE_NAMES[language]}`
}

/** What an assignment covers: "flagged rows", "all rows", "2 files", "flagged rows in 1 file"; "spot check" for a
 * sample of the rows the AI review passed. */
export function scopeLabel(a: { files: readonly string[] | '*'; flaggedOnly: boolean; spotCheck?: unknown }): string {
  if (a.spotCheck) return 'spot check'
  if (a.files === '*') return a.flaggedOnly ? 'flagged rows' : 'all rows'
  const files = `${a.files.length} ${a.files.length === 1 ? 'file' : 'files'}`
  return a.flaggedOnly ? `flagged rows in ${files}` : files
}

/** An assignment's plain name: "German translations · flagged rows". */
export function assignmentLabel(a: { queue: string; files: readonly string[] | '*'; flaggedOnly: boolean; spotCheck?: unknown }): string {
  return `${queueLabel(a.queue)} · ${scopeLabel(a)}`
}

const FIELD_LABELS: Readonly<Record<string, string>> = { translation: 'Translation', alternates: 'Alternates', sense: 'Sense', title_en: 'English title', title_l1: 'Translated title', level: 'Level',
  gender: 'Gender', plural: 'Plural', separable: 'Separable', irregular: 'Irregular', auxiliary: 'Auxiliary' }

/** A row's field in plain words: "title_l1" → "Translated title". A field it does not know comes back as it is. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}
