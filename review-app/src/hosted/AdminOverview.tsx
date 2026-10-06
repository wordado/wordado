import type { AssignmentView, Language, ReviewerView, SnapshotStatus, SubmissionView } from '../../shared/hosted'
import { dateOf, share } from './adminUtil'
import { type LanguageOverview, overviewOf } from './overview'

interface Props {
  snapshot: SnapshotStatus | null | undefined
  reviewers: readonly ReviewerView[] | undefined
  assignments: readonly AssignmentView[] | undefined
  submissions: readonly SubmissionView[] | undefined
  /** Assign on a language nobody holds */
  onAssign(language: Language): void
}

/** The Overview tab: how far the review is, in four numbers and a row per language, and what the review data was
 * built from. All of it is worked out here from what the admin API returns. */
export function AdminOverview(props: Props) {
  const { snapshot, reviewers, assignments, submissions } = props
  if (snapshot === undefined || reviewers === undefined || assignments === undefined || submissions === undefined) return <p className="note">Loading…</p>
  const o = overviewOf({ snapshot, reviewers, assignments, submissions })
  const stats: readonly (readonly [number, string])[] = [
    [o.toDecide, o.toDecide === 1 ? 'row to decide' : 'rows to decide'],
    [o.decided, 'decided, not submitted'],
    [o.openPrs, o.openPrs === 1 ? 'pull request open' : 'pull requests open'],
    [o.activeReviewers, o.activeReviewers === 1 ? 'active reviewer' : 'active reviewers'],
  ]
  return (
    <>
      <ul className="stats" aria-label="In numbers">
        {stats.map(([n, label]) => (
          <li key={label} className="stat">
            <b>{n.toLocaleString('en')}</b>
            <span>{label}</span>
          </li>
        ))}
      </ul>
      {snapshot === null ? (
        <p className="note">No review data yet: the review-snapshot workflow has not run.</p>
      ) : (
        <>
          <p className="eyebrow">By language</p>
          {o.languages.length === 0 && <p className="note">The review data has no queue to review.</p>}
          {o.languages.length > 0 && (
            <ul className="settings-rows" aria-label="By language">
              {o.languages.map((l) => (
                <LanguageRow key={l.language} language={l} onAssign={() => props.onAssign(l.language)} />
              ))}
            </ul>
          )}
          <p className="note snapshot-line">
            Review data built {dateOf(snapshot.built)} from commit {snapshot.commit.slice(0, 7)}
          </p>
        </>
      )}
    </>
  )
}

function LanguageRow(props: { language: LanguageOverview; onAssign(): void }) {
  const l = props.language
  const done = l.state === 'done'
  const who = l.reviewers.join(', ') || (done ? '' : 'nobody assigned')
  // The bar is over the language's flagged rows; decisions on rows that are not flagged do not overfill it.
  const submitted = Math.min(l.submitted, l.flagged)
  const decided = Math.min(l.decided, l.flagged - submitted)
  return (
    <li className="settings-row language-row">
      <span className="settings-row-text">
        <span className="settings-row-title">{l.label}</span>
        <span className="note">{[l.parts, who].filter(Boolean).join(' · ')}</span>
      </span>
      <span className="progress" aria-hidden="true">
        <span className="submitted" style={{ width: share(submitted, l.flagged) }} />
        <span className="decided" style={{ width: done ? '100%' : share(decided, l.flagged) }} />
      </span>
      <span className="row-state">
        {l.state === 'unassigned' ? (
          <button className="button small primary" aria-label={`Assign ${l.label}`} onClick={props.onAssign}>
            Assign
          </button>
        ) : (
          <span className="chip ok">{l.state}</span>
        )}
      </span>
    </li>
  )
}
