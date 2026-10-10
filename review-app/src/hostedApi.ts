import type { FeedbackKind } from '@wordado/core'
import type { DecisionResult } from '../server/types'
import type {
  AssignmentView,
  FeedbackList,
  FeedbackMark,
  FeedbackState,
  FeedbackStateFilter,
  HostedDecisionRequest,
  Language,
  Me,
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
  },
}
