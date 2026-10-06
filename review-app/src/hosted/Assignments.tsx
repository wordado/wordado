import { useEffect, useState } from 'react'
import type { AssignmentView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'

/** What an assignment covers: "flagged rows · all files", "all rows · 3 files". */
export function scopeOf(a: AssignmentView): string {
  const files = a.files === '*' ? 'all files' : `${a.files.length} ${a.files.length === 1 ? 'file' : 'files'}`
  return `${a.flaggedOnly ? 'flagged rows' : 'all rows'} · ${files}`
}

function progressOf(a: AssignmentView): string {
  const p = a.progress
  if (!p) return 'The review data is not available yet.'
  return `${p.decided} decided · ${p.submitted} submitted · ${p.remaining} to go`
}

/** The signed-in reviewer's open assignments, one settings row each. */
export function Assignments(props: { onOpen(a: AssignmentView): void }) {
  const [list, setList] = useState<AssignmentView[] | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => void hostedApi.assignments().then(setList, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [])

  return (
    <section className="page" aria-label="My assignments">
      <h2 className="panel-title">My assignments</h2>
      {error && (
        <p role="status" className="notice">
          {error}
        </p>
      )}
      {list === undefined && !error && <p className="note">Loading…</p>}
      {list?.length === 0 && <p className="note">Nothing is assigned to you yet.</p>}
      {list && list.length > 0 && (
        <ul className="settings-rows">
          {list.map((a) => (
            <li key={a.id}>
              <button className="settings-row" onClick={() => props.onOpen(a)}>
                <span className="settings-row-text">
                  <span className="settings-row-title">{a.queue}</span>
                  <span className="note">{scopeOf(a)}</span>
                  <span className="note">{progressOf(a)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
