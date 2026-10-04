export type Source = 'report' | 'ai'

export interface ObjectionView {
  reviewer: string
  model: string
  field: string
  category: string
  severity: 'minor' | 'major'
  reason: string
  fix: string
}

export interface RowView {
  queue: string
  file: string
  version: string
  key: string
  kind: 'translation' | 'title' | 'level'
  cells: Record<string, string>
  fields: string[]
  /** headword, pos, sense_en, level, example, band, words, as the CSV holds them */
  context: Record<string, string>
  otherSenses: { key: string; translation: string; sense_en: string }[]
  /** the reopened column */
  reports: string
  ai: 'unreviewed' | 'passed' | 'flagged'
  /** the worst objection among required verdicts */
  severity: 'major' | 'minor' | null
  /** every configured reviewer's current objections */
  objections: ObjectionView[]
  /** a verdict already written in the CSV, not yet imported */
  decided: { verdict: string; note: string } | null
}

export interface QueueSummary {
  queue: string
  open: number
  flagged: number
  reported: number
  decided: number
}
