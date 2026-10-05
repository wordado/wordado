import { useCallback, useEffect, useState } from 'react'
import type { AssignmentView, ReviewerView, SnapshotStatus, SubmissionView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminAssignments } from './AdminAssignments'
import { AdminReviewers } from './AdminReviewers'
import { AdminSubmissions } from './AdminSubmissions'
import { type Act, dateOf, fileName, messageOf } from './adminUtil'

/** The admin page: the review data, the reviewers, the assignments and the submissions, one panel each. */
export function Admin() {
  const [snapshot, setSnapshot] = useState<SnapshotStatus | null | undefined>(undefined)
  const [reviewers, setReviewers] = useState<ReviewerView[] | undefined>(undefined)
  const [assignments, setAssignments] = useState<AssignmentView[] | undefined>(undefined)
  const [submissions, setSubmissions] = useState<SubmissionView[] | undefined>(undefined)
  const [notice, setNotice] = useState('')

  const reload = useCallback(async () => {
    const fail = (err: unknown) => setNotice(messageOf(err))
    await Promise.all([
      hostedApi.admin.snapshot().then(setSnapshot, fail),
      hostedApi.admin.reviewers().then(setReviewers, fail),
      hostedApi.admin.assignments().then(setAssignments, fail),
      hostedApi.admin.submissions().then(setSubmissions, fail),
    ])
  }, [])

  useEffect(() => void reload(), [reload])

  const act: Act = useCallback(
    async (action) => {
      setNotice('')
      try {
        await action()
        return true
      } catch (err) {
        setNotice(messageOf(err))
        return false
      } finally {
        await reload()
      }
    },
    [reload],
  )

  return (
    <div className="admin">
      {notice && (
        <p role="status" className="notice">
          {notice}
        </p>
      )}
      <ReviewData snapshot={snapshot} />
      <AdminReviewers reviewers={reviewers} act={act} />
      <AdminAssignments snapshot={snapshot} reviewers={reviewers} assignments={assignments} act={act} />
      <AdminSubmissions submissions={submissions} />
    </div>
  )
}

function ReviewData(props: { snapshot: SnapshotStatus | null | undefined }) {
  const { snapshot } = props
  return (
    <section className="panel" aria-label="Review data">
      <h2 className="panel-title">Review data</h2>
      {snapshot === undefined && <p className="note">Loading…</p>}
      {snapshot === null && <p className="note">No review data yet: the review-snapshot workflow has not run.</p>}
      {snapshot && (
        <>
          <p className="note">
            Built {dateOf(snapshot.built)} from {snapshot.commit.slice(0, 7)}
          </p>
          <ul className="settings-rows">
            {snapshot.queues.map((q) => {
              const rows = q.files.reduce((n, f) => n + f.rows, 0)
              const flagged = q.files.reduce((n, f) => n + f.flagged, 0)
              return (
                <li key={q.queue} className="settings-row">
                  <span className="settings-row-text">
                    <span className="settings-row-title">
                      {q.queue}: {q.files.length} {q.files.length === 1 ? 'file' : 'files'}, {rows} rows, {flagged} flagged
                    </span>
                    <details>
                      <summary className="note">Files</summary>
                      <ul>
                        {q.files.map((f) => (
                          <li key={f.file} className="note" title={f.file}>
                            {`${fileName(f.file)} · ${f.rows} rows · ${f.flagged} flagged · ${f.reported} reported · ${f.assignedTo ?? 'free'}`}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </span>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}
