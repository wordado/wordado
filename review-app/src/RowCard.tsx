import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Action, RowView } from '../server/types'
import type { Severity } from '../shared/hosted'
import { Compare } from './Compare'
import { fieldLabel } from './labels'
import { Objections } from './Objections'
import { applyFixes, firstPerField, toggleTick } from './RowView'
import { useKeys } from './useKeys'
import { useSwipe } from './useSwipe'

const nothing = () => {}

/** What stands above the word: part of speech · level · English sense; a unit title and a level row say what they
 * are (a level row's level is what is being decided, so the word "level" stands in its place: the sense says which
 * meaning is graded). Parts that are empty are left out. */
function eyebrowOf(row: RowView): string {
  const c = row.context
  const parts = row.kind === 'title' ? [c['level'], 'unit title'] : row.kind === 'level' ? [c['pos'], 'level', c['sense_en']] : [c['pos'], c['level'], c['sense_en']]
  return parts.filter(Boolean).join(' · ')
}

/** A spot check's question (spec 2026-10-05 §15), in its order: the key, the severity stored, the word shown and what it means. */
const SEVERITY_ANSWERS = [
  ['1', 'major', 'Serious', 'a learner would be taught something wrong, or marked wrong for a right answer'],
  ['2', 'minor', 'Minor', 'right, but could be better'],
] as const

/** One row to decide: where it is among the shown rows, the word, "Now" beside "AI suggests", the objections, and
 * the decisions with their keys (1 accept, 2 keep, 3 edit and save, 4 drop). On a touch screen a swipe to the left
 * skips to the next row and one to the right goes back. In a spot check (`askSeverity`) a decision that changes
 * the row is followed by one question, "How serious was it?" (1 serious, 2 minor, Escape to go back), and only
 * its answer sends the decision. */
export function RowCard(props: {
  row: RowView
  /** the row's place among the shown rows; `index` counts from 0 */
  position: { index: number; total: number }
  onDecide: (action: Action, cells: Record<string, string>, note: string, severity?: Severity) => void
  onSkip: () => void
  onPrev: () => void
  saving?: boolean
  /** told true when an edit opens and false when it is over (saved, cancelled, or the row is gone); the question
   * that follows a decision in a spot check counts as part of it */
  onEditing?: (editing: boolean) => void
  /** a spot check: ask how serious it was before a decision that changes the row is sent */
  askSeverity?: boolean
  /** what the reviewer answered for the decision this row already has */
  rated?: Severity | null
}) {
  const { row, position, onDecide, onSkip, onPrev, saving = false, onEditing, askSeverity = false, rated = null } = props
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => firstPerField(row.objections))
  const [editing, setEditing] = useState(false)
  const [cells, setCells] = useState<Record<string, string>>(row.cells)
  const [note, setNote] = useState('')
  const [noting, setNoting] = useState(false)
  /** the decision that waits for "How serious was it?"; null when nothing is asked */
  const [asking, setAsking] = useState<{ action: Action; cells: Record<string, string> } | null>(null)
  const canDrop = row.kind === 'translation'
  const hasObjections = row.objections.length > 0

  /** Sends a decision that changes the row, or in a spot check asks first how serious the fault was. */
  const change = useCallback(
    (action: Action, changed: Record<string, string>) => (askSeverity ? setAsking({ action, cells: changed }) : onDecide(action, changed, note)),
    [askSeverity, onDecide, note],
  )
  const accept = useCallback(() => change('accept', applyFixes(row.cells, row.objections, ticked)), [change, row.cells, row.objections, ticked])
  const keep = useCallback(() => onDecide('keep', row.cells, note), [onDecide, row.cells, note])
  const drop = useCallback(() => change('drop', row.cells), [change, row.cells])
  const startEdit = useCallback(() => {
    setCells(applyFixes(row.cells, row.objections, ticked))
    setEditing(true)
  }, [row.cells, row.objections, ticked])
  const save = useCallback(() => change('edit', cells), [change, cells])
  const cancel = useCallback(() => setEditing(false), [])
  const answer = useCallback((severity: Severity) => asking && onDecide(asking.action, asking.cells, note, severity), [asking, onDecide, note])
  const serious = useCallback(() => void answer('major'), [answer])
  const minor = useCallback(() => void answer('minor'), [answer])
  const back = useCallback(() => setAsking(null), [])
  const busy = editing || asking !== null
  useEffect(() => {
    if (!busy || !onEditing) return
    onEditing(true)
    return () => onEditing(false)
  }, [busy, onEditing])

  // The question takes the focus (an edit's field would swallow its keys); going back to an edit returns it there.
  const question = useRef<HTMLDivElement>(null)
  const firstField = useRef<HTMLInputElement>(null)
  const asked = useRef(false)
  useEffect(() => {
    if (asking) question.current?.focus()
    else if (asked.current) firstField.current?.focus()
    asked.current = asking !== null
  }, [asking])

  // While editing, only Save (3) and Cancel (Escape) are on offer, as buttons and as keys; while the question is
  // open, only its two answers (1, 2) and the way back (Escape).
  const keys = useMemo((): Record<string, () => void> => {
    if (saving) return {}
    if (asking) return { '1': serious, '2': minor, Escape: back }
    if (editing) return { '3': save, Escape: cancel }
    return { ...(hasObjections ? { '1': accept } : {}), '2': keep, '3': startEdit, ...(canDrop ? { '4': drop } : {}) }
  }, [saving, asking, serious, minor, back, editing, save, cancel, hasObjections, accept, keep, startEdit, canDrop, drop])
  useKeys(keys)

  // A swipe leaves the row, so not while an edit or the question is open (it would be lost) or a decision saves.
  const card = useRef<HTMLElement>(null)
  const still = busy || saving
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
        {row.decided && rated && <span className={`chip ${rated}`}>rated {rated === 'major' ? 'serious' : 'minor'}</span>}
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
                  ref={i === 0 ? firstField : undefined}
                  autoFocus={i === 0}
                  disabled={saving || asking !== null}
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
        <Objections objections={row.objections} reports={row.reports} ticked={ticked} disabled={busy} onTick={(i) => setTicked((t) => toggleTick(row.objections, t, i))} />
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
        {asking ? (
          <div ref={question} className="decisions severity-ask" role="group" aria-labelledby="severity-question" tabIndex={-1}>
            <p className="ask-title" id="severity-question">
              How serious was it?
            </p>
            {SEVERITY_ANSWERS.map(([key, severity, word, meaning]) => (
              <button key={severity} className="button large" onClick={severity === 'major' ? serious : minor} disabled={saving}>
                <span className="ask-word">
                  {word}
                  <kbd aria-hidden="true">{key}</kbd>
                </span>
                <span className="ask-meaning">{meaning}</span>
              </button>
            ))}
            <button className="button small ghost ask-back" onClick={back} disabled={saving}>
              Back<kbd aria-hidden="true">Esc</kbd>
            </button>
          </div>
        ) : editing ? (
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
