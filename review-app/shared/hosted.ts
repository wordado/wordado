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

export interface AssignmentView {
  readonly id: number
  readonly reviewer: string
  readonly reviewerName: string
  readonly queue: string
  readonly files: readonly string[] | '*'
  readonly flaggedOnly: boolean
  readonly createdAt: string
  readonly closedAt: string | null
  readonly progress: Progress | null
}

export interface HostedDecision {
  readonly action: Action
  readonly cells: Readonly<Record<string, string>>
  readonly note: string
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
