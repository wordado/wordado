import { useState } from 'react'
import { AppHeader } from '../AppHeader'
import type { AssignmentView, Me } from '../../shared/hosted'
import { Admin } from './Admin'
import { AssignmentReview } from './AssignmentReview'
import { Assignments } from './Assignments'

type View = { kind: 'list' } | { kind: 'review'; assignment: AssignmentView } | { kind: 'admin' }

/** The hosted review app for a signed-in reviewer: their assignments, one assignment's review, and (for an admin) the admin screens. */
export function HostedApp(props: { me: Me }) {
  const { me } = props
  const [view, setView] = useState<View>({ kind: 'list' })
  return (
    <div className="hosted">
      <AppHeader who={me.name}>
        <span className="spacer" />
        {view.kind !== 'list' && (
          <button className="button" onClick={() => setView({ kind: 'list' })}>
            Back to my assignments
          </button>
        )}
        {me.role === 'admin' && view.kind !== 'admin' && (
          <button className="button" onClick={() => setView({ kind: 'admin' })}>
            Admin
          </button>
        )}
      </AppHeader>
      {view.kind === 'list' && <Assignments onOpen={(assignment) => setView({ kind: 'review', assignment })} />}
      {view.kind === 'review' && <AssignmentReview key={view.assignment.id} assignment={view.assignment} />}
      {view.kind === 'admin' && <Admin />}
    </div>
  )
}
