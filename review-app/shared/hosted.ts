import type { Action, RowView } from '../server/types'

export type Language = 'bg' | 'de' | 'es' | 'en'
export const LANGUAGES: readonly Language[] = ['bg', 'de', 'es', 'en']
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { bg: 'Bulgarian', de: 'German', es: 'Spanish', en: 'English levels' }
export type Role = 'reviewer' | 'admin'

/** The language a reviewer needs for a queue: translation-<l1> and title-<l1> need l1, level needs en; null for queues the hosted app does not serve. */
export function languageOf(queue: string): Language | null {
  if (queue === 'level') return 'en'
  const m = /^(?:translation|title)-([a-z]{2})$/.exec(queue)
  const l = m?.[1]
  return l && (LANGUAGES as readonly string[]).includes(l) && l !== 'en' ? (l as Language) : null
}

export interface Me {
  readonly email: string
  readonly name: string
  readonly role: Role
  readonly languages: readonly Language[]
}

export interface Progress {
  readonly inScope: number
  readonly decided: number
  readonly changed: number
  readonly submitted: number
  readonly merged: number
  readonly remaining: number
}

/** How serious the fault a spot-check decision put right was (spec §15): major is shown as "serious". */
export type Severity = 'major' | 'minor'
export const SEVERITIES: readonly Severity[] = ['major', 'minor']

/** One row of a spot check's sample. */
export interface SampleRef {
  readonly file: string
  readonly key: string
}

/** What a spot check has found so far, over its decisions whether submitted or not. */
export interface SpotCheckResult {
  /** decisions that count: on a row of the sample that has not changed since */
  readonly checked: number
  /** kept as it is */
  readonly fine: number
  readonly minor: number
  readonly serious: number
  /** the keys of the rows with a serious fault, in the sample's order */
  readonly seriousKeys: readonly string[]
}

export interface SpotCheckView {
  /** the rows drawn when the assignment was made */
  readonly sample: number
  /** null while the review data is not available */
  readonly result: SpotCheckResult | null
}

export interface AssignmentView {
  readonly id: number
  readonly reviewer: string
  readonly reviewerName: string
  readonly queue: string
  readonly files: readonly string[] | '*'
  readonly flaggedOnly: boolean
  /** null unless the assignment is a spot check */
  readonly spotCheck: SpotCheckView | null
  readonly createdAt: string
  readonly closedAt: string | null
  readonly progress: Progress | null
}

/** What making a spot check answers: fewer rows than asked for when the queue has no more that qualify. */
export interface SpotCheckCreated {
  readonly assignment: AssignmentView
  readonly asked: number
  readonly drawn: number
}

export interface HostedDecision {
  readonly action: Action
  readonly cells: Readonly<Record<string, string>>
  readonly note: string
  /** a spot check's answer to "How serious was it?"; null for a row kept and outside a spot check */
  readonly severity: Severity | null
  readonly submission: number | null
  /** the row changed in a newer snapshot since this decision */
  readonly changed: boolean
}
export interface HostedRow extends RowView {
  readonly decision: HostedDecision | null
}
export interface RowsResponse {
  readonly rows: readonly HostedRow[]
  readonly discarded: readonly string[]
}

export interface HostedDecisionRequest {
  readonly assignment: number
  readonly queue: string
  readonly file: string
  readonly key: string
  readonly rowHash: string
  readonly action: Action
  readonly cells?: Record<string, string>
  readonly note?: string
  /** a spot check only, and there with every action but keep */
  readonly severity?: Severity
}

export interface SubmitResult {
  readonly pr: number
  readonly url: string
  readonly count: number
  readonly leftOut: readonly { readonly key: string; readonly reason: 'changed' | 'gone' }[]
}

export interface ReviewerView {
  readonly email: string
  readonly name: string
  readonly role: Role
  readonly languages: readonly Language[]
  readonly invitedAt: string
  readonly inviteSentAt: string | null
  readonly disabledAt: string | null
}

export interface SubmissionView {
  readonly id: number
  readonly assignment: number
  readonly reviewer: string
  readonly reviewerName: string
  readonly queue: string
  readonly branch: string
  readonly pr: number | null
  readonly url: string | null
  readonly count: number
  readonly leftOut: number
  readonly status: 'open' | 'merged' | 'closed'
  readonly createdAt: string
}

export interface SplitProposal {
  readonly reviewer: string
  readonly files: readonly string[]
  readonly rows: number
}

export interface SnapshotStatus {
  readonly id: string
  readonly built: string
  readonly commit: string
  readonly queues: readonly {
    readonly queue: string
    readonly language: Language
    readonly files: readonly { readonly file: string; readonly rows: number; readonly flagged: number; readonly reported: number; readonly assignedTo: string | null }[]
  }[]
}
