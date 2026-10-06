import { useEffect, useState } from 'react'
import type { AssignmentView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { assignmentLabel } from '../labels'

/** How far an assignment is: "741 rows · 212 decided · 60 submitted", "8 rows · none decided yet". */
function countsOf(a: AssignmentView): string {
  const p = a.progress
  if (!p) return 'The review data is not available yet.'
  const rows = `${p.inScope} ${p.inScope === 1 ? 'row' : 'rows'}`
  if (p.decided === 0 && p.submitted === 0) return `${rows} · none decided yet`
  return [rows, p.decided > 0 ? `${p.decided} decided` : '', p.submitted > 0 ? `${p.submitted} submitted` : ''].filter(Boolean).join(' · ')
}

const share = (part: number, whole: number) => `${whole > 0 ? (part / whole) * 100 : 0}%`

/** The signed-in reviewer's open assignments: a plain name, how far it is, and one button each. */
export function Assignments(props: { onOpen(a: AssignmentView): void }) {
  const [list, setList] = useState<AssignmentView[] | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => void hostedApi.assignments().then(setList, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [])

  return (
    <section className="page" aria-label="My assignments">
      <h2 className="page-title">Your assignments</h2>
      <p className="note page-lead">Pick up where you stopped. Your decisions are saved as you go; Submit sends them to the coordinator.</p>
      {error && (
        <p role="status" className="notice">
          {error}
        </p>
      )}
      {list === undefined && !error && <p className="note">Loading…</p>}
      {list?.length === 0 && <p className="note">Nothing is assigned to you yet.</p>}
      {list && list.length > 0 && (
        <>
          <ul className="settings-rows assignments">
            {list.map((a) => {
              const p = a.progress
              const started = p !== null && (p.decided > 0 || p.submitted > 0)
              return (
                <li key={a.id} className="settings-row" title={a.queue}>
                  <span className="settings-row-text">
                    <span className="settings-row-title" id={`assignment-${a.id}`}>
                      {assignmentLabel(a)}
                    </span>
                    <span className="note">{countsOf(a)}</span>
                  </span>
                  <span className="progress" aria-hidden="true">
                    {p && <span className="submitted" style={{ width: share(p.submitted, p.inScope) }} />}
                    {p && <span className="decided" style={{ width: share(p.decided, p.inScope) }} />}
                  </span>
                  <button className={started ? 'button primary' : 'button'} aria-describedby={`assignment-${a.id}`} onClick={() => props.onOpen(a)}>
                    {started ? 'Continue' : 'Start'}
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="note keys-hint">Keys: 1 accept, 2 keep, 3 edit, 4 drop, S skip.</p>
          <p className="note swipe-hint">Swipe left for the next row, right for the previous one.</p>
        </>
      )}
    </section>
  )
}
