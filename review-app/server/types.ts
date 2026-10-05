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
  /** true when this row's file predates the draft: its frozen proposal no longer matches the draft's current one, so it can never get a matching AI verdict until `corpus queues` writes it out again */
  stale: boolean
  /** rowContent(queue, proposed, reopened): what an AI verdict and a hosted decision are keyed on */
  rowHash: string
}

export interface QueueSummary {
  queue: string
  open: number
  flagged: number
  reported: number
  decided: number
}

export type Action = 'accept' | 'keep' | 'edit' | 'drop'

export interface DecisionRequest {
  queue: string
  file: string
  version: string
  key: string
  action: Action
  cells?: Record<string, string>
  note?: string
}

export type DecisionResult = { ok: true; version: string } | { ok: false; reason: 'changed' | 'gone' | 'invalid'; message: string }

export interface ImportResult {
  applied: number
  pending: number
  errors: string[]
}
