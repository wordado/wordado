import type { FeedbackItem } from '@wordado/core'
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

/** Where a learner's feedback stands with the coordinator (spec §16): shown as New, Looked at, Done and Not doing. */
export type FeedbackState = 'new' | 'seen' | 'done' | 'declined'
export const FEEDBACK_STATES: readonly FeedbackState[] = ['new', 'seen', 'done', 'declined']
/** What the Feedback tab can show: `open` is everything not done and not declined. */
export type FeedbackStateFilter = 'open' | 'all' | 'done' | 'declined'
export const FEEDBACK_STATE_FILTERS: readonly FeedbackStateFilter[] = ['open', 'all', 'done', 'declined']
export const MAX_FEEDBACK_NOTE_LENGTH = 2000

/** The coordinator's mark on a message. `markedAt` is null while nobody has marked it: it is new, with no note. */
export interface FeedbackMark {
  readonly state: FeedbackState
  readonly note: string
  readonly markedAt: string | null
}

/** How the AI reads a message (spec 2026-10-10 §3.1): beside the kind the learner chose, never in its place. */
export const FEEDBACK_CATEGORIES = ['bug', 'idea', 'question', 'praise', 'junk'] as const
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number]
/** How bad a bug sounds to the AI: the learner cannot study or loses data, it is in the way, or it only looks wrong. */
export const FEEDBACK_SEVERITIES = ['blocks', 'annoys', 'cosmetic'] as const
export type FeedbackSeverity = (typeof FEEDBACK_SEVERITIES)[number]

/** The AI's reading of one message (spec 2026-10-10 §3.1). `translation` is empty when none was needed. Advice only. */
export interface FeedbackAi {
  readonly language: string
  readonly translation: string
  readonly category: FeedbackCategory
  readonly severity: FeedbackSeverity | null
  readonly summary: string
}

/** A message as the learner app's server gives it, with the coordinator's mark and, when there is one, the AI's reading. */
export type FeedbackView = FeedbackItem & FeedbackMark & { readonly ai: FeedbackAi | null }

/** `GET /api/admin/feedback/ai`. `setUp`: the key is there. `on`: an admin switched it on. `reads`: the languages that need no translation. */
export interface FeedbackAiStatus {
  readonly setUp: boolean
  readonly on: boolean
  readonly model: string
  readonly callsToday: number
  readonly dailyCalls: number
  readonly reads: readonly string[]
}

/** Why the AI gave nothing: switched off, no key, the day's limit, not reached, late, refused by the service, or an answer that did not fit. */
export type FeedbackAiWhy = 'off' | 'not-set-up' | 'limit' | 'unreachable' | 'late' | 'refused' | 'unfit'

/** `POST /api/admin/feedback/ai/read`: the new results by message id; how many messages were sent; how many still have none. */
export interface FeedbackAiRead {
  readonly results: Readonly<Record<number, FeedbackAi>>
  readonly asked: number
  readonly left: number
  readonly why: FeedbackAiWhy | null
}

/** `GET /api/admin/feedback`. Not connected: the token or the server's address is not set. `read` is how many
 * messages the server's page held, before the filter by state; `nextBefore` is the `before` of the next, older
 * page, or null on the last. A page filtered by state can be short, or empty, with older ones still to come. */
export type FeedbackList =
  | { readonly connected: false }
  | { readonly connected: true; readonly items: readonly FeedbackView[]; readonly read: number; readonly nextBefore: number | null }
