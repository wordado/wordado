import { useEffect, useState } from 'react'
import { App } from './App'
import { AppHeader } from './AppHeader'
import { HostedApp } from './hosted/HostedApp'
import { hostedApi, type MeResult } from './hostedApi'

/** Cloudflare Access's sign-out: the only way to a new sign-in with another address. */
const SIGN_OUT = '/cdn-cgi/access/logout'

/** Picks the mode: the local server has no /api/me (404), the hosted Worker answers with the signed-in reviewer. */
export function Root() {
  const [me, setMe] = useState<MeResult | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => void hostedApi.me().then(setMe, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [])

  if (error)
    return (
      <>
        <AppHeader />
        <section className="panel centered">
          <p role="alert">{error}</p>
        </section>
      </>
    )
  if (me === undefined) return <p className="page note">Loading…</p>
  if (me.kind === 'local') return <App />
  if (me.kind === 'me') return <HostedApp me={me.me} />
  if (me.kind === 'denied')
    return (
      <>
        <AppHeader />
        <section className="panel centered">
          {me.email && (
            <p>
              You are signed in as <strong>{me.email}</strong>.
            </p>
          )}
          <p>{me.message}</p>
          <p className="note">If you were invited at another address, sign in with that one.</p>
          <a className="button primary" href={SIGN_OUT}>
            Sign in with another address
          </a>
        </section>
      </>
    )
  return (
    <>
      <AppHeader />
      <section className="panel centered">
        <p>Your sign-in expired.</p>
        <a className="button primary" href="/">
          Sign in again
        </a>
      </section>
    </>
  )
}
