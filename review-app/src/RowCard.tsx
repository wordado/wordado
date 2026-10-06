import { useCallback, useMemo, useRef, useState } from 'react'
import type { Action, RowView } from '../server/types'
import { Compare } from './Compare'
import { fieldLabel } from './labels'
import { Objections } from './Objections'
import { applyFixes, firstPerField, toggleTick } from './RowView'
import { useKeys } from './useKeys'
import { useSwipe } from './useSwipe'

const nothing = () => {}

/** What stands above the word: part of speech · level · English sense; a unit title and a level row say what they are. */
function eyebrowOf(row: RowView): string {
  const c = row.context
  const parts = row.kind === 'title' ? [c['level'], 'unit title'] : row.kind === 'level' ? [c['pos'], 'level'] : [c['pos'], c['level'], c['sense_en']]
  return parts.filter(Boolean).join(' · ')
}

/** One row to decide: where it is among the shown rows, the word, "Now" beside "AI suggests", the objections, and
 * the decisions with their keys (1 accept, 2 keep, 3 edit and save, 4 drop). On a touch screen a swipe to the left
 * skips to the next row and one to the right goes back. */
export function RowCard(props: {
  row: RowView
  /** the row's place among the shown rows; `index` counts from 0 */
  position: { index: number; total: number }
  onDecide: (action: Action, cells: Record<string, string>, note: string) => void
  onSkip: () => void
  onPrev: () => void
  saving?: boolean
}) {
  const { row, position, onDecide, onSkip, onPrev, saving = false } = props
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => firstPerField(row.objections))
  const [editing, setEditing] = useState(false)
  const [cells, setCells] = useState<Record<string, string>>(row.cells)
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  const canDrop = row.kind === 'translation'
  const hasObjections = row.objections.length > 0

  const accept = useCallback(() => onDecide('accept', applyFixes(row.cells, row.objections, ticked), note), [onDecide, row.cells, row.objections, ticked, note])
  const keep = useCallback(() => onDecide('keep', row.cells, note), [onDecide, row.cells, note])
  const drop = useCallback(() => onDecide('drop', row.cells, note), [onDecide, row.cells, note])
  const startEdit = useCallback(() => {
    setCells(applyFixes(row.cells, row.objections, ticked))
    setEditing(true)
  }, [row.cells, row.objections, ticked])
  const save = useCallback(() => onDecide('edit', cells, note), [onDecide, cells, note])
  const cancel = useCallback(() => setEditing(false), [])

  // While editing, only Save (3) and Cancel (Escape) are on offer, as buttons and as keys.
  const keys = useMemo((): Record<string, () => void> => {
    if (saving) return {}
    if (editing) return { '3': save, Escape: cancel }
    return { ...(hasObjections ? { '1': accept } : {}), '2': keep, '3': startEdit, ...(canDrop ? { '4': drop } : {}) }
  }, [saving, editing, save, cancel, hasObjections, accept, keep, startEdit, canDrop, drop])
  useKeys(keys)

  // A swipe leaves the row, so not while an edit is open (it would be lost) or a decision saves.
  const card = useRef<HTMLElement>(null)
  const still = editing || saving
  useSwipe(card, { onLeft: still ? nothing : onSkip, onRight: still ? nothing : onPrev })

  const c = row.context
  return (
    <article ref={card} className={editing ? 'row-card editing' : 'row-card'} aria-label={`Row ${row.key}`}>
      <div className="progress-line">
        <div className="progress" aria-hidden="true">
          <span className="decided" style={{ width: `${position.total > 0 ? (position.index / position.total) * 100 : 0}%` }} />
        </div>
        <span>
          {position.index + 1} of {position.total}
        </span>
        {row.reports !== '' && <span className="chip report">report</span>}
        {row.severity && <span className={`chip ${row.severity}`}>{row.severity}</span>}
        {row.decided && <span className="chip ok">decided: {row.decided.verdict}</span>}
      </div>
      <div className="panel card">
        {row.stale && <p className="stale-notice">This file is older than the draft: import your decisions, then run corpus queues.</p>}
        <div className="card-head">
          <p className="eyebrow">{eyebrowOf(row)}</p>
          <h2 className="word">{c['headword'] ?? row.key}</h2>
          {c['example'] && <p className="example">“{c['example']}”</p>}
          {c['words'] && <p className="example">{c['words']}</p>}
          {c['band'] && <p className="note">frequency band {c['band']}</p>}
        </div>
        {editing ? (
          <div className="edit-fields">
            {row.fields.map((f, i) => (
              <label key={f} className="field">
                {fieldLabel(f)}
                <input
                  value={cells[f] ?? ''}
                  autoFocus={i === 0}
                  disabled={saving}
                  onChange={(e) => setCells({ ...cells, [f]: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') save()
                    else if (e.key === 'Escape') cancel()
                  }}
                />
              </label>
            ))}
          </div>
        ) : (
          <Compare row={row} ticked={ticked} />
        )}
        <Objections objections={row.objections} reports={row.reports} ticked={ticked} disabled={editing} onTick={(i) => setTicked((t) => toggleTick(row.objections, t, i))} />
        {row.otherSenses.length > 0 && (
          <div className="other-senses">
            {row.otherSenses.map((s) => (
              <p key={s.key} className="note">
                Other sense: <b>{s.key}</b> {s.translation} ({s.sense_en})
              </p>
            ))}
          </div>
        )}
        {noting ? (
          <label className="field">
            Note for the coordinator
            <input value={note} autoFocus onChange={(e) => setNote(e.target.value)} />
          </label>
        ) : (
          <button className="button small ghost add-note" onClick={() => setNoting(true)}>
            Add a note
          </button>
        )}
        {editing ? (
          <div className="decisions">
            <button className="button large primary" onClick={save} disabled={saving}>
              Save<kbd aria-hidden="true">3</kbd>
            </button>
            <button className="button large" onClick={cancel} disabled={saving}>
              Cancel<kbd aria-hidden="true">Esc</kbd>
            </button>
          </div>
        ) : (
          <div className="decisions">
            <button className={hasObjections ? 'button large primary' : 'button large'} onClick={accept} disabled={saving || !hasObjections}>
              Accept fix<kbd aria-hidden="true">1</kbd>
            </button>
            <button className={hasObjections ? 'button large' : 'button large primary'} onClick={keep} disabled={saving}>
              Keep as it is<kbd aria-hidden="true">2</kbd>
            </button>
            <button className="button large" onClick={startEdit} disabled={saving}>
              Edit<kbd aria-hidden="true">3</kbd>
            </button>
            {canDrop && (
              <button className="button large" onClick={drop} disabled={saving}>
                Drop<kbd aria-hidden="true">4</kbd>
              </button>
            )}
          </div>
        )}
        <div className="card-nav">
          <button className="button small ghost" onClick={onSkip} disabled={saving}>
            Skip<kbd aria-hidden="true">S</kbd>
            <kbd aria-hidden="true">↓</kbd>
          </button>
          <button className="button small ghost" onClick={onPrev} disabled={saving}>
            Previous<kbd aria-hidden="true">↑</kbd>
          </button>
        </div>
      </div>
    </article>
  )
}
