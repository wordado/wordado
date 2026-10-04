import { useCallback, useMemo, useState } from 'react'
import type { Action, ObjectionView, RowView } from '../server/types'
import { Objections } from './Objections'
import { useKeys } from './useKeys'

/** The cells after applying the ticked objections' fixes (the first ticked fix per field wins). */
export function applyFixes(cells: Record<string, string>, objections: readonly ObjectionView[], ticked: ReadonlySet<number>): Record<string, string> {
  const out = { ...cells }
  const done = new Set<string>()
  objections.forEach((o, i) => {
    if (ticked.has(i) && !done.has(o.field)) {
      out[o.field] = o.fix
      done.add(o.field)
    }
  })
  return out
}

export function RowViewPanel(props: { row: RowView; onDecide: (action: Action, cells: Record<string, string>, note: string) => void }) {
  const { row, onDecide } = props
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(row.objections.map((_, i) => i)))
  const [editing, setEditing] = useState(false)
  const [cells, setCells] = useState<Record<string, string>>(row.cells)
  const [note, setNote] = useState('')
  const targeted = useMemo(() => new Set(row.objections.map((o) => o.field)), [row.objections])
  const canDrop = row.kind === 'translation'

  const accept = useCallback(
    () => onDecide('accept', applyFixes(row.cells, row.objections, ticked), note),
    [onDecide, row.cells, row.objections, ticked, note],
  )
  const keep = useCallback(() => onDecide('keep', row.cells, note), [onDecide, row.cells, note])
  const edit = useCallback(() => {
    if (editing) {
      onDecide('edit', cells, note)
    } else {
      setCells(applyFixes(row.cells, row.objections, ticked))
      setEditing(true)
    }
  }, [editing, onDecide, cells, note, row.cells, row.objections, ticked])
  const drop = useCallback(() => {
    if (canDrop) onDecide('drop', row.cells, note)
  }, [canDrop, onDecide, row.cells, note])

  const keys = useMemo(() => ({ '1': accept, '2': keep, '3': edit, ...(canDrop ? { '4': drop } : {}) }), [accept, keep, edit, drop, canDrop])
  useKeys(keys)
  const c = row.context
  return (
    <article className="row" aria-label={`Row ${row.key}`}>
      <section className="english">
        <h2>
          {c['headword'] ?? row.key} <small>{[c['pos'], c['level']].filter(Boolean).join(' · ')}</small>
        </h2>
        {c['sense_en'] && <p className="sense">{c['sense_en']}</p>}
        {c['example'] && <p className="example">“{c['example']}”</p>}
        {c['words'] && <p className="words">{c['words']}</p>}
        {c['band'] && <p className="muted">frequency band {c['band']}</p>}
        {row.otherSenses.length > 0 && (
          <ul className="others">
            {row.otherSenses.map((s) => (
              <li key={s.key}>
                {s.key}: {s.translation} ({s.sense_en})
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="cells" aria-label="Current row">
        {row.fields.map((f) => (
          <label key={f} className={targeted.has(f) ? 'targeted' : ''}>
            <span>{f}</span>
            {editing ? <input value={cells[f] ?? ''} onChange={(e) => setCells({ ...cells, [f]: e.target.value })} /> : <output>{row.cells[f] || '—'}</output>}
          </label>
        ))}
      </section>
      <Objections
        objections={row.objections}
        reports={row.reports}
        ticked={ticked}
        onTick={(i) => setTicked((t) => (t.has(i) ? new Set([...t].filter((x) => x !== i)) : new Set([...t, i])))}
      />
      <label className="note">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button onClick={accept} disabled={row.objections.length === 0}>
          Accept fix (1)
        </button>
        <button onClick={keep}>Keep (2)</button>
        <button onClick={edit}>{editing ? 'Save edit (3)' : 'Edit (3)'}</button>
        {canDrop && <button onClick={drop}>Drop (4)</button>}
      </div>
    </article>
  )
}
