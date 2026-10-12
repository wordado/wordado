import { useState } from 'react'
import { AppHeader } from '../AppHeader'
import type { AssignmentView, Me } from '../../shared/hosted'
import { Admin } from './Admin'
import { AssignmentReview } from './AssignmentReview'
import { Assignments } from './Assignments'

/** Cloudflare Access's sign-out on the protected host. */
const SIGN_OUT = '/cdn-cgi/access/logout'

type View = { kind: 'home' } | { kind: 'review'; assignment: AssignmentView }

/** The hosted review app for who is signed in. A reviewer has their assignments and one assignment's review. An admin
 * has the admin page, which puts its tabs into the header; their own assignments are one of its pages (My work,
 * under Review), and Back from a review goes there: the address still names it. */
export function HostedApp(props: { me: Me }) {
  const { me } = props
  const [view, setView] = useState<View>({ kind: 'home' })
  const open = (assignment: AssignmentView) => setView({ kind: 'review', assignment })
  const home = () => setView({ kind: 'home' })
  return (
    <div className="hosted">
      <AppHeader account={{ name: me.name, email: me.email, signOutHref: SIGN_OUT }}>
        <span className="spacer" />
        {view.kind === 'review' && (
          // The header has room for the first word only; the button keeps its whole name.
          <button className="button header-nav" onClick={home}>
            Back<span className="visually-hidden"> to my assignments</span>
          </button>
        )}
      </AppHeader>
      {view.kind === 'home' && (me.role === 'admin' ? <Admin onOpen={open} /> : <Assignments onOpen={open} />)}
      {view.kind === 'review' && <AssignmentReview key={view.assignment.id} assignment={view.assignment} onBack={home} />}
    </div>
  )
}
