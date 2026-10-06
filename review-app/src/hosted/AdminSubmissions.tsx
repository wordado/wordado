import type { SubmissionView } from '../../shared/hosted'
import { queueLabel } from '../labels'
import { count, dateOf } from './adminUtil'

const STATUS_CHIP: Readonly<Record<SubmissionView['status'], string>> = { open: 'chip minor', merged: 'chip ok', closed: 'chip off' }

/** The Submissions tab: one row per pull request a reviewer's submit opened. */
export function AdminSubmissions(props: { submissions: readonly SubmissionView[] | undefined }) {
  const { submissions } = props
  if (submissions === undefined) return <p className="note">Loading…</p>
  if (submissions.length === 0) return <p className="note">No submissions yet.</p>
  return (
    <>
      <p className="eyebrow">{count(submissions.length, 'submission')}</p>
      <ul className="settings-rows">
        {submissions.map((s) => (
          <li key={s.id} className="settings-row" title={s.queue}>
            <span className="settings-row-text">
              <span className="settings-row-title">
                <span>
                  {s.reviewerName} · {queueLabel(s.queue)}
                </span>
                <span className={STATUS_CHIP[s.status]}>{s.status}</span>
              </span>
              <span className="note">
                {count(s.count, 'decision')}
                {s.leftOut > 0 ? ` · ${s.leftOut} left out` : ''} · {dateOf(s.createdAt)}
              </span>
            </span>
            {s.pr !== null && s.url !== null && (
              <a className="row-link" href={s.url} target="_blank" rel="noreferrer">
                pull request {s.pr}
              </a>
            )}
          </li>
        ))}
      </ul>
    </>
  )
}
