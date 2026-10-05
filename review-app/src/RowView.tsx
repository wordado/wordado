import { useCallback, useMemo, useState } from 'react'
import type { Action, ObjectionView, RowView } from '../server/types'
import { Objections } from './Objections'
import { useKeys } from './useKeys'

/** The cells after applying the ticked objections' fixes. Ticks are exclusive per field (RowViewPanel enforces at
 * most one tick per field), but this stays defensive and takes the first ticked fix if more than one ever is. */
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

/** The first objection's index for each field: what starts ticked. */
function firstPerField(objections: readonly ObjectionView[]): Set<number> {
  const seen = new Set<string>()
  const out = new Set<number>()
  objections.forEach((o, i) => {
    if (!seen.has(o.field)) {
      seen.add(o.field)
      out.add(i)
    }
  })
  return out
}

export function RowViewPanel(props: {
  row: RowView
  onDecide: (action: Action, cells: Record<string, string>, note: string) => void
  onSkip: () => void
  saving?: boolean
}) {
  const { row, onDecide, onSkip, saving = false } = props
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => firstPerField(row.objections))
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

  const hasObjections = row.objections.length > 0
  const keys = useMemo(
    () => (saving ? {} : { ...(hasObjections ? { '1': accept } : {}), '2': keep, '3': edit, ...(canDrop ? { '4': drop } : {}) }),
    [accept, keep, edit, drop, canDrop, hasObjections, saving],
  )
  useKeys(keys)
  const c = row.context
  return (
    <article className="row" aria-label={`Row ${row.key}`}>
      {row.stale && <p className="stale-notice">This file is older than the draft: import your decisions, then run corpus queues.</p>}
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
        onTick={(i) =>
          setTicked((t) => {
            if (t.has(i)) return new Set([...t].filter((x) => x !== i))
            // Exclusive per field: ticking one objection unticks any other on the same field.
            const field = row.objections[i]!.field
            return new Set([...[...t].filter((x) => row.objections[x]!.field !== field), i])
          })
        }
      />
      <label className="note">
        Note <input value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <div className="actions">
        <button onClick={accept} disabled={saving || row.objections.length === 0}>
          Accept fix (1)
        </button>
        <button onClick={keep} disabled={saving}>
          Keep (2)
        </button>
        <button onClick={edit} disabled={saving}>
          {editing ? 'Save edit (3)' : 'Edit (3)'}
        </button>
        {canDrop && (
          <button onClick={drop} disabled={saving}>
            Drop (4)
          </button>
        )}
        <button onClick={onSkip} disabled={saving}>
          Skip (S)
        </button>
      </div>
    </article>
  )
}
