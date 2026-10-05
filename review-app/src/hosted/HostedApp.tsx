import { useState } from 'react'
import type { AssignmentView, Me } from '../../shared/hosted'
import { AssignmentReview } from './AssignmentReview'
import { Assignments } from './Assignments'

type View = { kind: 'list' } | { kind: 'review'; assignment: AssignmentView } | { kind: 'admin' }

/** The hosted review app for a signed-in reviewer: their assignments, one assignment's review, and (for an admin) the admin screens. */
export function HostedApp(props: { me: Me }) {
  const { me } = props
  const [view, setView] = useState<View>({ kind: 'list' })
  return (
    <div className="hosted">
      <header className="hosted-bar">
        <strong>Wordado review</strong>
        <span className="muted">{me.name}</span>
        <span className="hosted-bar-actions">
          {view.kind !== 'list' && <button onClick={() => setView({ kind: 'list' })}>Back to my assignments</button>}
          {me.role === 'admin' && view.kind !== 'admin' && <button onClick={() => setView({ kind: 'admin' })}>Admin</button>}
        </span>
      </header>
      {view.kind === 'list' && <Assignments onOpen={(assignment) => setView({ kind: 'review', assignment })} />}
      {view.kind === 'review' && <AssignmentReview key={view.assignment.id} assignment={view.assignment} />}
      {view.kind === 'admin' && <p>Admin</p>}
    </div>
  )
}
