import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Action, RowView } from '../server/types'
import { RowList } from './RowList'
import { RowViewPanel } from './RowView'
import { useKeys } from './useKeys'

/** The review screen both modes share, under the app header: the level and severity filters, the decided count,
 * the row list, the row panel and the keys. The parent owns the rows and how a decision is stored; `onDecide` resolves to a notice to show
 * (null when the decision went through, and the screen then moves on to the next undecided row). */
export function ReviewScreen(props: {
  rows: readonly RowView[]
  onDecide(row: RowView, action: Action, cells: Record<string, string>, note: string): Promise<string | null>
  onReload(): Promise<void>
  controls?: ReactNode
  actions?: ReactNode
  notice?: string
}) {
  const { rows } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [severity, setSeverity] = useState('')
  const [saving, setSaving] = useState(false)

  // Selection keeps the current row while it is still listed, else falls to the first undecided one.
  useEffect(() => setSelected((cur) => (cur && rows.some((x) => x.key === cur) ? cur : (rows.find((x) => !x.decided)?.key ?? null))), [rows])

  const shown = useMemo(
    () => rows.filter((r) => (level === '' || r.context['level'] === level) && (severity === '' || (severity === 'report' ? r.reports !== '' : r.severity === severity))),
    [rows, level, severity],
  )
  const row = shown.find((r) => r.key === selected) ?? null
  /** The next (dir 1) or previous (dir -1) undecided row from the selected one, wrapping around the list. */
  const move = useCallback(
    (dir: 1 | -1) => {
      if (shown.length === 0) return setSelected(null)
      const i = shown.findIndex((r) => r.key === selected)
      for (let step = 1; step <= shown.length; step += 1) {
        const r = shown[(((i + dir * step) % shown.length) + shown.length) % shown.length]!
        if (!r.decided) return setSelected(r.key)
      }
      setSelected(null)
    },
    [shown, selected],
  )
  const next = useCallback(() => move(1), [move])
  const prev = useCallback(() => move(-1), [move])
  const decide = useCallback(
    async (action: Action, cells: Record<string, string>, note: string) => {
      if (!row || saving) return
      setSaving(true)
      try {
        const message = await props.onDecide(row, action, cells, note)
        setNotice(message ?? '')
        await props.onReload()
        if (message === null) next()
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [row, saving, props, next],
  )
  const keys = useMemo(() => (saving ? {} : { s: next, ArrowDown: next, ArrowUp: prev }), [next, prev, saving])
  useKeys(keys)
  const handleDecide = useCallback((action: Action, cells: Record<string, string>, note: string) => void decide(action, cells, note), [decide])

  const decided = rows.filter((r) => r.decided).length
  const shownNotice = notice || props.notice || ''
  return (
    <div className="app page wide">
      <header className="toolbar">
        {props.controls}
        <span className="field">
          <select value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
            <option value="">all levels</option>
            {['A1', 'A2', 'B1', 'B2', 'C1'].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </span>
        <span className="field">
          <select value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severity">
            <option value="">all objections</option>
            <option value="report">learner reports</option>
            <option value="major">major</option>
            <option value="minor">minor</option>
          </select>
        </span>
        <span className="muted">
          {decided} of {rows.length} decided
        </span>
        {props.actions}
      </header>
      {shownNotice && (
        <p role="status" className="notice">
          {shownNotice}
        </p>
      )}
      <main>
        <RowList rows={shown} selected={selected} onSelect={setSelected} />
        {row ? (
          <RowViewPanel key={`${row.key}:${row.version}`} row={row} onDecide={handleDecide} onSkip={next} saving={saving} />
        ) : (
          <p className="muted">Nothing left to decide here.</p>
        )}
      </main>
    </div>
  )
}
