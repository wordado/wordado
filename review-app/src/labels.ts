import { LANGUAGE_NAMES, languageOf } from '../shared/hosted'

/** A queue in plain words: "translation-de" → "German translations", "title-bg" → "Bulgarian unit titles",
 * "level" → "English levels". A queue it does not know comes back as it is. */
export function queueLabel(queue: string): string {
  if (queue === 'level') return 'English levels'
  const language = languageOf(queue)
  if (language === null) return queue
  return `${LANGUAGE_NAMES[language]} ${queue.startsWith('title-') ? 'unit titles' : 'translations'}`
}

/** What an assignment covers: "flagged rows", "all rows", "2 files", "flagged rows in 1 file". */
export function scopeLabel(a: { files: readonly string[] | '*'; flaggedOnly: boolean }): string {
  if (a.files === '*') return a.flaggedOnly ? 'flagged rows' : 'all rows'
  const files = `${a.files.length} ${a.files.length === 1 ? 'file' : 'files'}`
  return a.flaggedOnly ? `flagged rows in ${files}` : files
}

/** An assignment's plain name: "German translations · flagged rows". */
export function assignmentLabel(a: { queue: string; files: readonly string[] | '*'; flaggedOnly: boolean }): string {
  return `${queueLabel(a.queue)} · ${scopeLabel(a)}`
}

const FIELD_LABELS: Readonly<Record<string, string>> = { translation: 'Translation', alternates: 'Alternates', sense: 'Sense', title_en: 'English title', title_l1: 'Translated title', level: 'Level' }

/** A row's field in plain words: "title_l1" → "Translated title". A field it does not know comes back as it is. */
export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}
