import type { SubmissionView } from '../../shared/hosted'
import { dateOf } from './adminUtil'

/** Submissions: one row per pull request a reviewer's submit opened. */
export function AdminSubmissions(props: { submissions: readonly SubmissionView[] | undefined }) {
  const { submissions } = props
  return (
    <section className="panel" aria-label="Submissions">
      <h2 className="panel-title">Submissions</h2>
      {submissions === undefined && <p className="note">Loading…</p>}
      {submissions?.length === 0 && <p className="note">No submissions yet.</p>}
      {submissions && submissions.length > 0 && (
        <ul className="settings-rows">
          {submissions.map((s) => (
            <li key={s.id} className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-title">
                  {s.reviewerName} · {s.queue}
                </span>
                <span className="note">
                  {s.count} {s.count === 1 ? 'decision' : 'decisions'} · {s.leftOut} left out · {s.status} · {dateOf(s.createdAt)}
                </span>
              </span>
              {s.pr !== null && s.url !== null && (
                <a href={s.url} target="_blank" rel="noreferrer">
                  pull request {s.pr}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
