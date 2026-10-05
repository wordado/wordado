import { useEffect, useState } from 'react'
import { App } from './App'
import { HostedApp } from './hosted/HostedApp'
import { hostedApi, type MeResult } from './hostedApi'

/** Picks the mode: the local server has no /api/me (404), the hosted Worker answers with the signed-in reviewer. */
export function Root() {
  const [me, setMe] = useState<MeResult | undefined>(undefined)
  const [error, setError] = useState('')
  useEffect(() => void hostedApi.me().then(setMe, (err: unknown) => setError(err instanceof Error ? err.message : String(err))), [])

  if (error)
    return (
      <section className="panel centered">
        <p role="alert">{error}</p>
      </section>
    )
  if (me === undefined) return <p>Loading…</p>
  if (me.kind === 'local') return <App />
  if (me.kind === 'me') return <HostedApp me={me.me} />
  if (me.kind === 'denied')
    return (
      <section className="panel centered">
        <p>{me.message}</p>
        <p className="note">Ask the coordinator for an invitation.</p>
      </section>
    )
  return (
    <section className="panel centered">
      <p>Your sign-in expired.</p>
      <a href="/">Sign in again</a>
    </section>
  )
}
