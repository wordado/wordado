import type { AnnouncementKind, AnnouncementLanguage, AnnouncementText, AnnouncementTexts, FeedbackKind } from '@wordado/core'
import type { DecisionResult } from '../server/types'
import type {
  AccountFound,
  AccountSeriesView,
  AccountSplitsView,
  AccountStatsView,
  AccountSweepView,
  Announcement,
  AnnouncementPreview,
  AnnouncementTranslation,
  AnnouncementsView,
  AssignmentView,
  FeedbackAiRead,
  FeedbackAiStatus,
  FeedbackDraft,
  FeedbackList,
  FeedbackMark,
  FeedbackState,
  FeedbackStateFilter,
  FeedbackTopicOpened,
  FeedbackTopicRef,
  FeedbackTopicView,
  FeedbackWeek,
  FeedbackWeekParagraph,
  HostedDecisionRequest,
  Language,
  Me,
  PreparedNoticeView,
  ReviewerView,
  Role,
  RowsResponse,
  SnapshotStatus,
  SplitProposal,
  SpotCheckCreated,
  SubmissionView,
  SubmitResult,
} from '../shared/hosted'

/** The server's message from an error body, or a generic one naming the status. */
function messageOf(body: unknown, status: number): string {
  return body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : `request failed (${status})`
}

/** Reads a response's JSON body; on a non-2xx status, throws an Error with the server's message instead of
 * returning its error body as if it were the expected shape. */
async function checked(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return body
  throw new Error(messageOf(body, res.status))
}

const get = async <T,>(path: string): Promise<T> => checked(await fetch(path)) as Promise<T>
const send = async <T,>(method: string, path: string, body: unknown): Promise<T> =>
  checked(await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<T>

export type MeResult = { kind: 'local' } | { kind: 'me'; me: Me } | { kind: 'denied'; message: string; email?: string } | { kind: 'signedOut' }

/** The hosted (Worker) API. `me` also tells the hosted app from the local one: the local server has no /api/me. */
export const hostedApi = {
  async me(): Promise<MeResult> {
    const res = await fetch('/api/me')
    const body: unknown = await res.json().catch(() => null)
    if (res.status === 404) return { kind: 'local' }
    if (res.status === 401) return { kind: 'signedOut' }
    if (res.status === 403) {
      const denied = body as { message?: string; email?: string } | null
      return { kind: 'denied', message: denied?.message ?? 'No invitation.', ...(denied?.email ? { email: denied.email } : {}) }
    }
    if (!res.ok) throw new Error(`request failed (${res.status})`)
    return { kind: 'me', me: body as Me }
  },
  assignments: () => get<AssignmentView[]>('/api/assignments'),
  rows: (id: number) => get<RowsResponse>(`/api/rows?assignment=${id}`),
  /** Resolves its DecisionResult even for 400/409/410 (the server's normal "could not apply this" answers); only a
   * 5xx (the server itself failing) throws. */
  async decide(req: HostedDecisionRequest): Promise<DecisionResult> {
    const res = await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
    const body: unknown = await res.json().catch(() => null)
    if (res.status >= 500) throw new Error(messageOf(body, res.status))
    return body as DecisionResult
  },
  undo: (assignment: number, key: string) => send<{ ok: true }>('DELETE', '/api/decision', { assignment, key }),
  submit: (assignment: number) => send<SubmitResult>('POST', '/api/submit', { assignment }),
  admin: {
    reviewers: () => get<ReviewerView[]>('/api/admin/reviewers'),
    invite: (b: { email: string; name: string; languages: Language[]; role?: Role }) =>
      send<{ reviewer: ReviewerView; inviteSent: boolean; link: string }>('POST', '/api/admin/reviewers', b),
    patchReviewer: (email: string, patch: { name?: string; languages?: Language[]; role?: Role; disabled?: boolean }) =>
      send<ReviewerView>('PATCH', `/api/admin/reviewers/${encodeURIComponent(email)}`, patch),
    resendInvite: (email: string) => send<{ inviteSent: boolean; link: string }>('POST', `/api/admin/reviewers/${encodeURIComponent(email)}/invite`, {}),
    assignments: () => get<AssignmentView[]>('/api/admin/assignments'),
    assign: (b: { reviewer: string; queue: string; files: string[] | '*'; flaggedOnly: boolean }) => send<AssignmentView>('POST', '/api/admin/assignments', b),
    spotCheck: (b: { reviewer: string; queue: string; rows: number }) => send<SpotCheckCreated>('POST', '/api/admin/spot-checks', b),
    close: (id: number) => send<AssignmentView>('POST', `/api/admin/assignments/${id}/close`, {}),
    reassign: (id: number, to: string, decisions: 'move' | 'discard') => send<AssignmentView>('POST', `/api/admin/assignments/${id}/reassign`, { to, decisions }),
    split: (b: { queue: string; flaggedOnly: boolean; reviewers: string[]; confirm?: boolean; proposal?: SplitProposal[] }) =>
      send<{ proposal?: SplitProposal[]; assignments?: AssignmentView[] }>('POST', '/api/admin/assignments/split', b),
    submissions: () => get<SubmissionView[]>('/api/admin/submissions'),
    snapshot: () => get<SnapshotStatus | null>('/api/admin/snapshot'),
    /** One page of learners' feedback, newest first; `before` is the `nextBefore` of the page above it. */
    feedback: (q: { kind: FeedbackKind | ''; state: FeedbackStateFilter; before?: number }) =>
      get<FeedbackList>(`/api/admin/feedback?${new URLSearchParams({ kind: q.kind, state: q.state, ...(q.before !== undefined ? { before: String(q.before) } : {}) }).toString()}`),
    markFeedback: (id: number, mark: { state: FeedbackState; note: string }) => send<FeedbackMark & { id: number }>('PUT', `/api/admin/feedback/${id}`, mark),
    /** The AI help on feedback (spec 2026-10-10): whether it is set up and on, and how the day's limit stands. */
    feedbackAi: () => get<FeedbackAiStatus>('/api/admin/feedback/ai'),
    setFeedbackAi: (on: boolean) => send<FeedbackAiStatus>('PUT', '/api/admin/feedback/ai', { on }),
    /** Has the AI read one page of the list, named as the list names it. No message goes from the browser: the Worker reads the page itself. */
    readFeedbackAi: (q: { kind: FeedbackKind | ''; before?: number }) => send<FeedbackAiRead>('POST', '/api/admin/feedback/ai/read', { kind: q.kind, before: q.before ?? null }),
    forgetFeedbackAi: () => send<{ forgotten: number }>('DELETE', '/api/admin/feedback/ai/results', {}),
    /** The last seven days of feedback in numbers (spec 2026-10-10 §3.4), and the AI's paragraph about them: asked for by itself, since it may take a while. */
    feedbackWeek: () => get<FeedbackWeek>('/api/admin/feedback/week'),
    feedbackWeekParagraph: () => send<FeedbackWeekParagraph>('POST', '/api/admin/feedback/week/paragraph', {}),
    /** The feedback by topic (spec 2026-10-10 §3.2): one line a topic, the one with the newest message first. */
    feedbackTopics: () => get<FeedbackTopicView[]>('/api/admin/feedback/topics'),
    /** A topic's newest messages, as the list of messages gives them. */
    feedbackTopic: (id: number) => get<FeedbackTopicOpened>(`/api/admin/feedback/topics/${id}`),
    /** A topic's title, state and note, all three each time; `marked` is how many of its messages were marked done with it. */
    putFeedbackTopic: (id: number, topic: { title: string; state: FeedbackState; note: string }) => send<{ topic: FeedbackTopicView; marked: number }>('PUT', `/api/admin/feedback/topics/${id}`, topic),
    /** Merges a topic into another, and answers that other one. */
    mergeFeedbackTopic: (id: number, into: number) => send<FeedbackTopicView>('POST', `/api/admin/feedback/topics/${id}/merge`, { into }),
    /** Moves a message to a topic: the coordinator's choice, which the AI does not change again. */
    moveFeedback: (id: number, topic: number) => send<{ id: number; topic: FeedbackTopicRef | null }>('PUT', `/api/admin/feedback/${id}/topic`, { topic }),
    /** A topic's match with a known issue: a number confirms it, null removes it. */
    setFeedbackTopicIssue: (id: number, issue: number | null) => send<FeedbackTopicView>('PUT', `/api/admin/feedback/topics/${id}/issue`, { issue }),
    /** Asks the AI to draft an issue for a topic (spec 2026-10-10 §3.5): one call, counted; the draft is for this page alone, and is kept nowhere. */
    draftFeedbackTopic: (id: number) => send<FeedbackDraft>('POST', `/api/admin/feedback/topics/${id}/draft`, {}),
    /** The Accounts tab (#187). The sweep of inactive accounts in numbers: what it would take next and what it took. */
    accountSweep: () => get<AccountSweepView>('/api/admin/accounts/sweep'),
    /** How many accounts there are and how many are used (#206): counts of now, never a list. */
    accountStats: () => get<AccountStatsView>('/api/admin/accounts/stats'),
    /** What is behind those counts (#209): the accounts by week made and by day studied, and by language. */
    accountSeries: () => get<AccountSeriesView>('/api/admin/accounts/series'),
    accountSplits: () => get<AccountSplitsView>('/api/admin/accounts/splits'),
    /** The account an address names: when it was made and last signed in, and how it is used. The address goes in the body, never in the path. */
    lookUpAccount: (email: string) => send<AccountFound>('POST', '/api/admin/accounts/lookup', { email }),
    /** Deletes the account an address names, as the learner's own deletion does; `deleted` is false when there was none. */
    deleteAccount: (email: string) => send<{ deleted: boolean }>('POST', '/api/admin/accounts/delete', { email, confirm: true }),
    /** The Mail tab (#185): what there is, newest first, and the limits a send works under. */
    announcements: () => get<AnnouncementsView>('/api/admin/announcements'),
    /** Writes a draft, or with an `id` changes that one: a change is a new version, which needs its own test send. */
    saveAnnouncement: (draft: { id: number | null; kind: AnnouncementKind; texts: Partial<AnnouncementTexts> }) =>
      send<{ announcement: Announcement }>('POST', '/api/admin/announcements/save', { ...(draft.id === null ? {} : { id: draft.id }), kind: draft.kind, texts: draft.texts }),
    deleteAnnouncement: (id: number) => send<{ deleted: boolean }>('POST', '/api/admin/announcements/delete', { id }),
    /** Each language as it would be mailed, and how many accounts would get which if it were sent now. */
    previewAnnouncement: (id: number) => send<AnnouncementPreview>('POST', '/api/admin/announcements/preview', { id }),
    /** Sends this version to one address, which goes in the body and is kept nowhere. */
    testAnnouncement: (id: number, version: number, email: string) => send<{ announcement: Announcement; mails: number }>('POST', '/api/admin/announcements/test', { id, version, email }),
    /** Starts the send: the version, the kind and the count as they were shown, and what was typed to confirm them. */
    sendAnnouncement: (confirmed: { id: number; version: number; kind: AnnouncementKind; recipients: number; confirm: string }) => send<{ announcement: Announcement }>('POST', '/api/admin/announcements/send', confirmed),
    /** The newest prepared notice that no announcement has used, for the form to offer (#215); null when there is none. */
    preparedNotice: () => get<PreparedNoticeView>('/api/admin/announcements/prepared'),
    /** The English text in `languages`, written by the AI help (#215): nothing but that text goes, and nothing is saved. */
    translateAnnouncement: (english: AnnouncementText, languages: readonly AnnouncementLanguage[]) =>
      send<AnnouncementTranslation>('POST', '/api/admin/announcements/translate', { subject: english.subject, body: english.body, languages }),
    stopAnnouncement: (id: number) => send<{ announcement: Announcement }>('POST', '/api/admin/announcements/stop', { id }),
    resumeAnnouncement: (id: number) => send<{ announcement: Announcement }>('POST', '/api/admin/announcements/resume', { id }),
  },
}
