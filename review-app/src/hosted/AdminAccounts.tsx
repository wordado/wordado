import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { AccountFound, AccountSweep } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { count, messageOf } from './adminUtil'

/** A moment (epoch milliseconds) as a local day with its year, "30 Sept 2026": these dates are read two years on. */
export const dayWithYear = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** What the tab has of the sweep: nothing yet, that accounts are not connected, that the counts could not be read, or the counts. */
type Loaded = { readonly kind: 'loading' } | { readonly kind: 'unconnected' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'sweep'; readonly sweep: AccountSweep }

/** An account that was looked up: the address it was asked by, and what the server said of it. */
interface LookedUp { readonly email: string; readonly account: AccountFound }

const lastSignIn = (account: Extract<AccountFound, { found: true }>): string => (account.lastSignInAt === null ? 'not recorded' : dayWithYear(account.lastSignInAt))

/**
 * The Accounts tab (#187): the provider's own handling of learners' accounts, which live on the learner app's
 * server. Above, the sweep that deletes accounts not signed in to for 24 months, in numbers: what it would take
 * next and what it took. Below, one account deleted by hand, for an erasure asked for by mail or an account
 * closed: it is looked up by its whole address, which shows only when it was made and last signed in, and deleted
 * after a question that is answered by typing the address again. Nothing of an account is kept by the review app.
 */
export function AdminAccounts() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [lookedUp, setLookedUp] = useState<LookedUp | null>(null)
  const [failed, setFailed] = useState('')
  const [done, setDone] = useState('')
  const [asking, setAsking] = useState(false)
  // Only the answer to the latest lookup is shown: an address changed while one was on its way wins.
  const asked = useRef(0)

  const load = useCallback(async () => {
    try {
      const view = await hostedApi.admin.accountSweep()
      setLoaded(view.connected ? { kind: 'sweep', sweep: view.sweep } : { kind: 'unconnected' })
    } catch (err) {
      setLoaded({ kind: 'failed', message: messageOf(err) })
    }
  }, [])
  useEffect(() => void load(), [load])

  /** The address in the field: what was looked up is of another address from now on, so it goes. */
  const type = (next: string) => {
    asked.current += 1
    setEmail(next)
    setLookedUp(null)
    setFailed('')
    setBusy(false)
  }

  const lookUp = async (e: FormEvent) => {
    e.preventDefault()
    const address = email.trim().toLowerCase()
    if (address === '') return
    const mine = (asked.current += 1)
    setBusy(true)
    setLookedUp(null)
    setFailed('')
    setDone('')
    try {
      const account = await hostedApi.admin.lookUpAccount(address)
      if (asked.current === mine) setLookedUp({ email: address, account })
    } catch (err) {
      if (asked.current === mine) setFailed(messageOf(err))
    } finally {
      if (asked.current === mine) setBusy(false)
    }
  }

  /** After the question: the account is gone (or was already), and the counts are read again. */
  const deleted = (address: string, was: boolean) => {
    setAsking(false)
    setLookedUp(null)
    setEmail('')
    setDone(was ? `The account of ${address} was deleted.` : `No account had the address ${address} any more: nothing was deleted.`)
    void load()
  }

  if (loaded.kind === 'loading') return <p className="note">Loading…</p>
  if (loaded.kind === 'unconnected') {
    return (
      <p className="note">
        Accounts are not connected: set <code>ADMIN_WRITE_TOKEN</code> and <code>LEARNER_APP_URL</code> for the review app, then open this tab again.
      </p>
    )
  }
  const found = lookedUp?.account.found ? lookedUp.account : null
  return (
    <>
      <p className="eyebrow">Inactive accounts</p>
      {loaded.kind === 'failed' && (
        <div role="alert" className="notice feedback-failed">
          <p>The sweep’s counts could not be read. {loaded.message}</p>
          <button className="button small" onClick={() => void load()}>
            Try again
          </button>
        </div>
      )}
      {loaded.kind === 'sweep' && <Sweep sweep={loaded.sweep} />}

      <p className="eyebrow">Delete an account</p>
      <form aria-label="Look an account up" className="form" onSubmit={(e) => void lookUp(e)}>
        <label className="field">
          Email address
          <input type="email" required autoComplete="off" value={email} onChange={(e) => type(e.target.value)} />
        </label>
        <span className="form-actions">
          <button type="submit" className="button primary" disabled={busy}>
            Look up
          </button>
        </span>
      </form>
      {failed && (
        <p role="alert" className="notice">
          The account could not be looked up. {failed}
        </p>
      )}
      {done && (
        <p role="status" className="note">
          {done}
        </p>
      )}
      {lookedUp && !lookedUp.account.found && <p className="note">No account has the address {lookedUp.email}.</p>}
      {lookedUp && found && (
        <section aria-label="The account" className="account-found">
          <ul className="settings-rows">
            <li className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-title">{lookedUp.email}</span>
                <span className="note">Created {dayWithYear(found.createdAt)}</span>
                <span className="note">Last sign-in {lastSignIn(found)}</span>
              </span>
              <span className="row-actions">
                <button className="button small danger" onClick={() => setAsking(true)}>
                  Delete this account…
                </button>
              </span>
            </li>
          </ul>
        </section>
      )}
      {lookedUp && found && asking && <DeleteQuestion email={lookedUp.email} account={found} onClose={() => setAsking(false)} onDone={(was) => deleted(lookedUp.email, was)} />}
    </>
  )
}

/** The sweep in four numbers and a line: the next run takes the accounts longest away, up to its most. */
function Sweep(props: { sweep: AccountSweep }) {
  const s = props.sweep
  return (
    <>
      <ul className="stats" aria-label="The sweep of inactive accounts">
        <li className="stat">
          <b>{s.due.toLocaleString('en')}</b>past {s.months} months now
        </li>
        <li className="stat">
          <b>{Math.min(s.due, s.batch).toLocaleString('en')}</b>the next run deletes
        </li>
        <li className="stat">
          <b>{s.lastTaken.toLocaleString('en')}</b>deleted by the last run
        </li>
        <li className="stat">
          <b>{s.taken.toLocaleString('en')}</b>deleted so far
        </li>
      </ul>
      <p className="note">
        An account not signed in to for {s.months} months is deleted, at most {s.batch} a day, with no mail first. {s.lastRunAt === null ? 'It has not run yet.' : `Last run: ${dayWithYear(s.lastRunAt)}.`}
      </p>
      {s.undated > 0 && (
        <p className="note">
          {count(s.undated, 'account has', 'accounts have')} no date of a last sign-in: the sweep never takes {s.undated === 1 ? 'it' : 'them'}.
        </p>
      )}
    </>
  )
}

/** The question before an account is deleted: what goes and what stays, and the address typed again, so that a
 * slip of the hand deletes nobody. It deletes the account that was looked up, whatever is in the page's field. */
function DeleteQuestion(props: { email: string; account: Extract<AccountFound, { found: true }>; onClose(): void; onDone(deleted: boolean): void }) {
  const { email, account } = props
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const same = again.trim().toLowerCase() === email

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!same || busy) return
    setBusy(true)
    setError('')
    try {
      props.onDone((await hostedApi.admin.deleteAccount(email)).deleted)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Dialog open title="Delete this account?" onClose={props.onClose} error={error}>
      <form className="form" onSubmit={(e) => void confirm(e)}>
        <p>
          <b>{email}</b>
        </p>
        <p className="note">
          Created {dayWithYear(account.createdAt)} · last sign-in {lastSignIn(account)}
        </p>
        <p>
          The account goes with everything the learner did in the app, as when they delete it themselves: it cannot be brought back. Their reports on words and their feedback stay, with nothing that says whose they were.
        </p>
        <label className="field">
          Type the address again to delete the account
          <input type="email" autoComplete="off" value={again} onChange={(e) => setAgain(e.target.value)} />
        </label>
        <span className="form-actions">
          <button type="submit" className="button danger" disabled={!same || busy}>
            Delete the account
          </button>
          <button type="button" className="button ghost" onClick={props.onClose}>
            Cancel
          </button>
        </span>
      </form>
    </Dialog>
  )
}
