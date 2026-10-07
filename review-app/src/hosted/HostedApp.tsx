import { useState } from 'react'
import { AppHeader } from '../AppHeader'
import type { AssignmentView, Me } from '../../shared/hosted'
import { Admin, adminTabOf } from './Admin'
import { AssignmentReview } from './AssignmentReview'
import { Assignments } from './Assignments'

/** Cloudflare Access's sign-out on the protected host. */
const SIGN_OUT = '/cdn-cgi/access/logout'

type View = { kind: 'list' } | { kind: 'review'; assignment: AssignmentView } | { kind: 'admin' }

/** The hosted review app for a signed-in reviewer: their assignments, one assignment's review, and (for an admin) the admin page, which
 * puts its tabs and the way back into the header. */
export function HostedApp(props: { me: Me }) {
  const { me } = props
  // An admin tab in the address (#reviewers) is the admin page: a reload stays where it was.
  const [view, setView] = useState<View>(() => (me.role === 'admin' && adminTabOf(window.location.hash) ? { kind: 'admin' } : { kind: 'list' }))
  /** Back from the admin page: its tab goes from the address with it. */
  const leaveAdmin = () => {
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search)
    setView({ kind: 'list' })
  }
  return (
    <div className="hosted">
      <AppHeader account={{ name: me.name, email: me.email, signOutHref: SIGN_OUT }}>
        <span className="spacer" />
        {view.kind === 'review' && (
          // The header has room for the first word only; the button keeps its whole name.
          <button className="button header-nav" onClick={() => setView({ kind: 'list' })}>
            Back<span className="visually-hidden"> to my assignments</span>
          </button>
        )}
        {me.role === 'admin' && view.kind !== 'admin' && (
          <button className="button header-nav" onClick={() => setView({ kind: 'admin' })}>
            Admin
          </button>
        )}
      </AppHeader>
      {view.kind === 'list' && <Assignments onOpen={(assignment) => setView({ kind: 'review', assignment })} />}
      {view.kind === 'review' && <AssignmentReview key={view.assignment.id} assignment={view.assignment} onBack={() => setView({ kind: 'list' })} />}
      {view.kind === 'admin' && <Admin onBack={leaveAdmin} />}
    </div>
  )
}
