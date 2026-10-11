import type { AnnouncementKind, AnnouncementLanguage, AnnouncementTexts, FeedbackItem } from '@wordado/core'
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

/** A topic's title: one line, in our words. It is shown in the tab and may be named in a mail. */
export const MIN_TOPIC_TITLE_LENGTH = 3
export const MAX_TOPIC_TITLE_LENGTH = 80
/** A topic's match with a known issue (spec 2026-10-10 §3.3): none, proposed by the AI, confirmed by the coordinator
 * (or a number they typed), or removed by the coordinator, after which the AI proposes none for the topic again. */
export type TopicIssueState = 'none' | 'proposed' | 'confirmed' | 'removed'

/** The topic a message is in (spec 2026-10-10 §3.2). */
export interface FeedbackTopicRef {
  readonly id: number
  readonly title: string
}

/** A topic as the By topic view lists it. `count`, `newestAt` and `worst` are of its messages that have a reading;
 * the last two are null when it has none, or no bug. `issueTitle` is the issue's title while it is among the open ones last read. */
export interface FeedbackTopicView extends FeedbackTopicRef {
  readonly state: FeedbackState
  readonly note: string
  readonly issue: number | null
  readonly issueState: TopicIssueState
  readonly issueTitle: string | null
  readonly count: number
  readonly newestAt: number | null
  readonly worst: FeedbackSeverity | null
}

/** `GET /api/admin/feedback/topics/:id`: the topic and its newest messages, as the list of messages gives them.
 * `more` is how many older messages it has beside them. `incomplete`: the learner app's server did not answer by id
 * (it is from before that), so messages may be missing from `items` that it still has. */
export interface FeedbackTopicOpened {
  readonly topic: FeedbackTopicView
  readonly items: readonly FeedbackView[]
  readonly more: number
  readonly incomplete: boolean
}

/** The AI's reading of a message as the tab shows it: with the topic the message is in now, which the AI or the coordinator chose, or none. */
export type FeedbackAiView = FeedbackAi & { readonly topic: FeedbackTopicRef | null }

/** A message as the learner app's server gives it, with the coordinator's mark and, when there is one, the AI's reading. */
export type FeedbackView = FeedbackItem & FeedbackMark & { readonly ai: FeedbackAiView | null }

/** `GET /api/admin/feedback/ai`. `setUp`: the sign-in, the secret and the address are there. `needs`: the first setting that is missing or wrong while
 * it is not. `on`: an admin switched it on. `reads`: the languages that need no translation. `repo`: the public app repository whose issues a topic's
 * match links to, as owner/name, or empty when none is set. */
export interface FeedbackAiStatus {
  readonly setUp: boolean
  readonly needs: 'FEEDBACK_AI_AUTH' | 'FEEDBACK_AI_KEY' | 'FEEDBACK_AI_URL' | null
  readonly on: boolean
  readonly model: string
  readonly callsToday: number
  readonly dailyCalls: number
  readonly reads: readonly string[]
  readonly repo: string
}

/** Why the AI gave nothing: switched off, no key, the day's limit, not reached, late, refused by the service, or an answer that did not fit. */
export type FeedbackAiWhy = 'off' | 'not-set-up' | 'limit' | 'unreachable' | 'late' | 'refused' | 'unfit'

/** `POST /api/admin/feedback/ai/read`: the readings of the page's messages by message id, the new ones and those of this prompt version kept
 * before (none when the AI gave nothing); how many messages were sent; how many still have none. */
export interface FeedbackAiRead {
  readonly results: Readonly<Record<number, FeedbackAiView>>
  readonly asked: number
  readonly left: number
  readonly why: FeedbackAiWhy | null
}

/** `GET /api/admin/feedback/week`: what a period of feedback came to (spec 2026-10-10 §3.4), from the kept readings:
 * numbers and topic titles, nothing a learner wrote. `since` and `until` are epoch ms. */
export interface FeedbackWeek {
  readonly since: number
  readonly until: number
  /** Messages of the period that have a reading. */
  readonly read: number
  readonly byCategory: Readonly<Record<FeedbackCategory, number>>
  /** Bugs of the period the AI reads as blocking, in a topic or in none. */
  readonly blockingBugs: number
  /** The topics with the most messages in the period: five at most. */
  readonly topTopics: readonly { readonly id: number; readonly title: string; readonly count: number }[]
  /** The blocking bugs by topic; `id` is null for those in no topic. */
  readonly blocking: readonly { readonly id: number | null; readonly title: string; readonly count: number }[]
  /** The topics whose first message came in the period. */
  readonly newTopics: readonly FeedbackTopicRef[]
  /** A few sentences the AI wrote from the numbers and the titles alone, or null while there are none. */
  readonly paragraph: string | null
}

/** `POST /api/admin/feedback/week/paragraph`: the paragraph, or why there is none (`why` is null for a period with no reading). */
export interface FeedbackWeekParagraph {
  readonly paragraph: string | null
  readonly why: FeedbackAiWhy | null
}

/** A drafted issue (spec 2026-10-10 §3.5): the longest title and the longest text that are taken from the AI. */
export const MAX_DRAFT_TITLE = 120
export const MAX_DRAFT_BODY = 4000
/** Why there is no draft: the AI's own reasons, or the draft was dropped because it repeated a learner's words (`quoted`)
 * or held an address, a link, a phone number or the name of an account (`personal`), or the topic has no message left to write from. */
export type FeedbackDraftWhy = FeedbackAiWhy | 'quoted' | 'personal' | 'no-messages'
/** `POST /api/admin/feedback/topics/:id/draft`: a draft of an issue for the topic, written from `messages` of its
 * messages, or why there is none. It is kept nowhere: it is for the page that asked, to be read, changed and filed by the coordinator. */
export type FeedbackDraft = { readonly ok: true; readonly title: string; readonly body: string; readonly messages: number } | { readonly ok: false; readonly why: FeedbackDraftWhy }

/** `GET /api/admin/feedback`. Not connected: the token or the server's address is not set. `read` is how many
 * messages the server's page held, before the filter by state; `nextBefore` is the `before` of the next, older
 * page, or null on the last. A page filtered by state can be short, or empty, with older ones still to come. */
export type FeedbackList =
  | { readonly connected: false }
  | { readonly connected: true; readonly items: readonly FeedbackView[]; readonly read: number; readonly nextBefore: number | null }

/** What the Accounts tab is told of the account an address names (#187): that there is none, or when it was made
 * and last signed in (epoch milliseconds; null when no sign-in was ever recorded). Nothing else of an account
 * leaves the learner app's server. */
export type AccountFound = { readonly found: false } | { readonly found: true; readonly createdAt: number; readonly lastSignInAt: number | null }

/** The sweep of inactive accounts, as the learner app's server counts it (#187): numbers and times only. */
export interface AccountSweep {
  /** The months without a sign-in after which an account is deleted, and the most one run deletes. */
  readonly months: number
  readonly batch: number
  /** The accounts past that now: the next run takes the longest away of them, up to `batch`. */
  readonly due: number
  /** The accounts with no date of a last sign-in, which no run takes. */
  readonly undated: number
  /** The accounts every run so far deleted, together. */
  readonly taken: number
  /** The last run (epoch milliseconds) and how many it deleted; null and 0 before the first. */
  readonly lastRunAt: number | null
  readonly lastTaken: number
}

/** `GET /api/admin/accounts/sweep`. Not connected: the token or the server's address is not set. */
export type AccountSweepView = { readonly connected: false } | { readonly connected: true; readonly sweep: AccountSweep }

export type AnnouncementStatus = 'draft' | 'sending' | 'stopped' | 'sent'
/** Why the last run of a send sent nothing or stopped early: the day's own allowance of announcement mails is used,
 * the mail service says its allowance is, or the mail service takes nothing now. */
export type AnnouncementHeld = 'day' | 'quota' | 'busy'

/** An announcement as the learner app's server tells of it (#185): its texts, its state, and counts. Times are
 * epoch milliseconds. Nothing of an account: no address, no id. */
export interface Announcement {
  readonly id: number
  readonly kind: AnnouncementKind
  readonly texts: AnnouncementTexts
  /** Raised by every change of a draft; `testedVersion` is the one whose test send went, null before any. Only a
   * version that was tested can be sent. */
  readonly version: number
  readonly testedVersion: number | null
  readonly status: AnnouncementStatus
  readonly createdAt: number
  readonly startedAt: number | null
  readonly stoppedAt: number | null
  readonly finishedAt: number | null
  readonly held: { readonly reason: AnnouncementHeld; readonly at: number } | null
  /** The accounts it was for when sending started, and what became of their mails. What these do not add up to
   * are accounts deleted before their turn. */
  readonly recipients: number
  readonly sent: number
  readonly failed: number
  readonly skipped: number
  readonly queued: number
}

/** What a send works under: the announcement mails of one UTC day at most and how many went today, and the mails of one run (every 15 minutes). */
export interface AnnouncementLimits {
  readonly perDay: number
  readonly sentToday: number
  readonly batch: number
}

/** `GET /api/admin/announcements`. Not connected: the token or the server's address is not set. */
export type AnnouncementsView = { readonly connected: false } | { readonly connected: true; readonly announcements: readonly Announcement[]; readonly limits: AnnouncementLimits }

/** `POST /api/admin/announcements/preview`: each language as it would be mailed, footer and all, and how many
 * accounts would get which if it were sent now. `version` is the one that was read. */
export interface AnnouncementPreview {
  readonly version: number
  readonly kind: AnnouncementKind
  readonly recipients: number
  readonly byLanguage: Readonly<Partial<Record<AnnouncementLanguage, number>>>
  readonly mails: readonly { readonly language: AnnouncementLanguage; readonly subject: string; readonly text: string }[]
}

/** What the owner types to send: the kind and the number of accounts, "service 1204". */
export const announcementConfirmation = (kind: AnnouncementKind, recipients: number): string => `${kind} ${recipients}`
