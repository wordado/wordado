import type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView } from '../server/types'

export type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView }

/** Reads a response's JSON body; on a non-2xx status, throws an Error with the server's message instead of
 * returning its error body as if it were the expected shape. */
async function checked(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => null)
  if (res.ok) return body
  const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : `request failed (${res.status})`
  throw new Error(message)
}

const get = async <T,>(path: string): Promise<T> => checked(await fetch(path)) as Promise<T>
const post = async <T,>(path: string, body: unknown): Promise<T> =>
  checked(await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<T>

/** decide resolves its DecisionResult even for 400/409/410 (the server's normal "could not apply this" answers);
 * only a 5xx (the server itself failing) throws. */
async function decide(req: DecisionRequest): Promise<DecisionResult> {
  const res = await fetch('/api/decision', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) })
  const body: unknown = await res.json().catch(() => null)
  if (res.status >= 500) {
    const message = body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string' ? (body as { message: string }).message : `request failed (${res.status})`
    throw new Error(message)
  }
  return body as DecisionResult
}

export const api = {
  queues: () => get<QueueSummary[]>('/api/queues'),
  rows: (queue: string, all: boolean) => get<RowView[]>(`/api/rows?queue=${encodeURIComponent(queue)}${all ? '&all=1' : ''}`),
  decide,
  reviewer: async () => (await get<{ reviewer: string | null }>('/api/reviewer')).reviewer,
  setReviewer: async (name: string) => (await post<{ reviewer: string }>('/api/reviewer', { reviewer: name })).reviewer,
  importDecisions: () => post<ImportResult>('/api/import', {}),
}
