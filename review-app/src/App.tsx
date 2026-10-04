import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type Action, type ImportResult, type QueueSummary, type RowView } from './api'
import { RowList } from './RowList'
import { RowViewPanel } from './RowView'
import { useKeys } from './useKeys'

export function App() {
  const [reviewer, setReviewer] = useState<string | null | undefined>(undefined)
  const [name, setName] = useState('')
  const [queues, setQueues] = useState<QueueSummary[]>([])
  const [queue, setQueue] = useState<string | null>(null)
  const [all, setAll] = useState(false)
  const [rows, setRows] = useState<RowView[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [severity, setSeverity] = useState('')

  useEffect(() => void api.reviewer().then(setReviewer), [])
  useEffect(() => void api.queues().then((q) => (setQueues(q), setQueue((cur) => cur ?? q[0]?.queue ?? null))), [])
  const load = useCallback(async () => {
    if (!queue || reviewer == null) return
    const r = await api.rows(queue, all)
    setRows(r)
    setSelected((cur) => (cur && r.some((x) => x.key === cur) ? cur : (r.find((x) => !x.decided)?.key ?? null)))
  }, [queue, all, reviewer])
  useEffect(() => void load(), [load])

  const shown = useMemo(
    () => rows.filter((r) => (level === '' || r.context['level'] === level) && (severity === '' || (severity === 'report' ? r.reports !== '' : r.severity === severity))),
    [rows, level, severity],
  )
  const row = shown.find((r) => r.key === selected) ?? null
  const next = useCallback(() => setSelected(shown.find((r) => !r.decided && r.key !== selected)?.key ?? null), [shown, selected])
  const decide = useCallback(
    async (action: Action, cells: Record<string, string>, note: string) => {
      if (!row) return
      const res = await api.decide({ queue: row.queue, file: row.file, version: row.version, key: row.key, action, cells, note })
      if (!res.ok) setNotice(res.reason === 'invalid' ? res.message : 'This file changed; reloaded.')
      else setNotice('')
      await load()
      if (res.ok) next()
    },
    [row, load, next],
  )
  const keys = useMemo(() => ({ s: next, ArrowDown: next }), [next])
  useKeys(keys)
  const handleDecide = useCallback((action: Action, cells: Record<string, string>, note: string) => void decide(action, cells, note), [decide])

  if (reviewer === undefined) return <p>Loading…</p>
  if (reviewer === null)
    return (
      <form className="name" onSubmit={(e) => (e.preventDefault(), void api.setReviewer(name).then(setReviewer))}>
        <label>
          Your name, as decisions record it <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit">Start</button>
      </form>
    )
  const summary = queues.find((q) => q.queue === queue)
  const decided = rows.filter((r) => r.decided).length
  const importNow = async () => {
    const r: ImportResult = await api.importDecisions()
    setNotice(`Imported ${r.applied}; ${r.pending} still open${r.errors.length ? `; ${r.errors.length} rejected: ${r.errors.join('; ')}` : ''}`)
    await load()
    setQueues(await api.queues())
  }
  return (
    <div className="app">
      <header>
        <select value={queue ?? ''} onChange={(e) => setQueue(e.target.value)} aria-label="Queue">
          {queues.map((q) => (
            <option key={q.queue} value={q.queue}>
              {q.queue} · {q.flagged} flagged · {q.reported} reported
            </option>
          ))}
        </select>
        <label>
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> show unflagged
        </label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
          <option value="">all levels</option>
          {['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
          <option value="">all objections</option>
          <option value="report">learner reports</option>
          <option value="major">major</option>
          <option value="minor">minor</option>
        </select>
        <span>
          {decided} of {rows.length} decided{summary ? ` · ${summary.open} open in all` : ''}
        </span>
        <span className="muted">{reviewer}</span>
        <button onClick={() => void importNow()}>Import decisions</button>
      </header>
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <main>
        <RowList rows={shown} selected={selected} onSelect={setSelected} />
        {row ? (
          <RowViewPanel key={`${row.key}:${row.version}`} row={row} onDecide={handleDecide} onSkip={next} />
        ) : (
          <p className="muted">Nothing left to decide here.</p>
        )}
      </main>
    </div>
  )
}
