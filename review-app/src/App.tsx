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
  // until the first rows are there (or it is known that there is no queue to load them from)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  /** why the last load of the queues or the rows failed; empty when it worked */
  const [loadError, setLoadError] = useState('')

  const message = (err: unknown) => (err instanceof Error ? err.message : String(err))
  const fail = useCallback((err: unknown) => setNotice(message(err)), [])
  useEffect(() => void api.reviewer().then(setReviewer).catch(fail), [fail])
  const loadQueues = useCallback(async () => {
    try {
      const q = await api.queues()
      setQueues(q)
      setQueue((cur) => cur ?? q[0]?.queue ?? null)
      setLoadError('')
      if (q.length === 0) setLoading(false)
    } catch (err) {
      setLoadError(message(err))
      setLoading(false)
    }
  }, [])
  useEffect(() => void loadQueues(), [loadQueues])
  const load = useCallback(async () => {
    if (!queue || reviewer == null) return
    try {
      setRows(await api.rows(queue, all))
      setLoadError('')
    } catch (err) {
      setLoadError(message(err))
    } finally {
      setLoading(false)
    }
  }, [queue, all, reviewer])
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
      <AppHeader account={{ name: reviewer }} />
      <ReviewScreen
        rows={rows}
        loading={loading}
        onDecide={onDecide}
        // without a queue it is the queues that did not load: the rows follow once there is one
        onReload={queue ? load : loadQueues}
        notice={loadError || notice}
        loadFailed={loadError !== ''}
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
            {/* one piece, so the button's gap does not come between the words; a phone shows "Import" */}
            <span>
              Import<span className="wide-label"> decisions</span>
            </span>
          </button>
        }
      />
    </>
  )
}
