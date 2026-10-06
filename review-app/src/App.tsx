import { useCallback, useEffect, useState } from 'react'
import { AppHeader } from './AppHeader'
import { api, type Action, type ImportResult, type QueueSummary, type RowView } from './api'
import { ReviewScreen } from './ReviewScreen'

/** The local review app: one reviewer, decisions written to the draft's decision files on this machine. */
export function App() {
  const [reviewer, setReviewer] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [queue, setQueue] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [rows, setRows] = useState<RowView[]>([])
  const [notice, setNotice] = useState('')

  const fail = useCallback((err: unknown) => setNotice(err instanceof Error ? err.message : String(err)), [])
  useEffect(() => void api.reviewer().then(setReviewer).catch(fail), [fail])
  useEffect(() => void api.queues().then((q) => (setQueues(q), setQueue((cur) => cur ?? q[0]?.queue ?? null))).catch(fail), [fail])
  const load = useCallback(async () => {
    if (!queue || reviewer == null) return
    try {
      setRows(await api.rows(queue, all))
    } catch (err) {
      fail(err)
    }
  }, [queue, all, reviewer, fail])
  useEffect(() => void load(), [load])

  const onDecide = useCallback(async (row: RowView, action: Action, cells: Record<string, string>, note: string) => {
    const res = await api.decide({ queue: row.queue, file: row.file, version: row.version, key: row.key, action, cells, note })
    if (res.ok) return null
    return res.reason === 'invalid' ? res.message : 'This file changed; reloaded.'
  }, [])

  if (reviewer === undefined) return <p className="page note">Loading…</p>
  if (reviewer === null)
    return (
      <>
        <AppHeader />
        <form className="name panel form" onSubmit={(e) => (e.preventDefault(), void api.setReviewer(name).then(setReviewer).catch(fail))}>
          <label className="field">
            Your name, as decisions record it <input value={name} onChange={(e) => setName(e.target.value)} required />
          </label>
          <button type="submit" className="button primary">
            Start
          </button>
        </form>
      </>
    )
  const summary = queues.find((q) => q.queue === queue)
  const importNow = async () => {
    try {
      const r: ImportResult = await api.importDecisions()
      setNotice(`Imported ${r.applied}; ${r.pending} still open${r.errors.length ? `; ${r.errors.length} rejected: ${r.errors.join('; ')}` : ''}`)
      await load()
      setQueues(await api.queues())
    } catch (err) {
      fail(err)
    }
  }
  return (
    <>
      <AppHeader who={reviewer} />
      <ReviewScreen
        rows={rows}
        onDecide={onDecide}
        onReload={load}
        notice={notice}
        controls={
          <>
            <span className="field">
              <select value={queue ?? ''} onChange={(e) => setQueue(e.target.value)} aria-label="Queue">
                {queues.map((q) => (
                  <option key={q.queue} value={q.queue}>
                    {q.queue} · {q.flagged} flagged · {q.reported} reported
                  </option>
                ))}
              </select>
            </span>
            <label className="check">
              <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show unflagged
            </label>
            {summary && <span className="muted">{summary.open} open in all</span>}
          </>
        }
        actions={
          <button className="button primary" onClick={() => void importNow()}>
            Import decisions
          </button>
        }
      />
    </>
  )
}
