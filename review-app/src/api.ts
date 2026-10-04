import type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView } from '../server/types'

export type { Action, DecisionRequest, DecisionResult, ImportResult, QueueSummary, RowView }

const get = async <T,>(path: string): Promise<T> => (await fetch(path)).json() as Promise<T>
const post = async <T,>(path: string, body: unknown): Promise<T> =>
  (await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json() as Promise<T>

export const api = {
  queues: () => get<QueueSummary[]>('/api/queues'),
  rows: (queue: string, all: boolean) => get<RowView[]>(`/api/rows?queue=${encodeURIComponent(queue)}${all ? '&all=1' : ''}`),
  decide: (req: DecisionRequest) => post<DecisionResult>('/api/decision', req),
  reviewer: async () => (await get<{ reviewer: string | null }>('/api/reviewer')).reviewer,
  setReviewer: async (name: string) => (await post<{ reviewer: string }>('/api/reviewer', { reviewer: name })).reviewer,
  importDecisions: () => post<ImportResult>('/api/import', {}),
}
