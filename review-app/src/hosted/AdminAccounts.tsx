import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { AccountDetails, AccountFound, AccountSeries, AccountSplits, AccountStats, AccountSweep } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { accountsByWeek, Chart, LANGUAGE_NAMES, madeByWeek, NEWS_PARTS, REMINDER_PARTS, Split, studiedByDay } from './AccountCharts'
import { count, messageOf } from './adminUtil'

/** A moment (epoch milliseconds) as a local day with its year, "30 Sept 2026": these dates are read two years on. */
export const dayWithYear = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

/** What the tab has of the sweep: nothing yet, that accounts are not connected, that the counts could not be read, or the counts. */
type Loaded = { readonly kind: 'loading' } | { readonly kind: 'unconnected' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'sweep'; readonly sweep: AccountSweep }

/** What the tab has of the counts of accounts (#206): nothing yet, that they could not be read, or the counts. Not connected is the sweep's to say. */
type Counted = { readonly kind: 'loading' } | { readonly kind: 'none' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'stats'; readonly stats: AccountStats }

/** What the tab has of what is behind the counts (#209): not asked for yet, on its way, that it could not be read, or the numbers. */
type Behind<T> = { readonly kind: 'idle' } | { readonly kind: 'loading' } | { readonly kind: 'failed'; readonly message: string } | { readonly kind: 'read'; readonly value: T }

/** The counts, in the order of the tiles, and what each one opens. */
type Tile = 'accounts' | 'made7' | 'made30' | 'reminders' | 'studied7' | 'studied30' | 'newsGiven' | 'newsWithdrawn'
type View = 'growth' | 'made' | 'studied' | 'news' | 'reminders'
const VIEW_OF: Readonly<Record<Tile, View>> = { accounts: 'growth', made7: 'made', made30: 'made', reminders: 'reminders', studied7: 'studied', studied30: 'studied', newsGiven: 'news', newsWithdrawn: 'news' }
/** The periods a view can show, the first the one it opens with; a view not here has one period. */
const PERIODS: Readonly<Partial<Record<View, readonly [number, number]>>> = { made: [12, 26], studied: [90, 30] }

/** An account that was looked up: the address it was asked by, and what the server said of it. */
interface LookedUp { readonly email: string; readonly account: AccountFound }

const lastSignIn = (account: Extract<AccountFound, { found: true }>): string => (account.lastSignInAt === null ? 'not recorded' : dayWithYear(account.lastSignInAt))

/**
 * The Accounts tab (#187): the provider's own handling of learners' accounts, which live on the learner app's
 * server. Above, how many accounts there are and how many are used (#206): counts of now, never a list, each a
 * button that opens what is behind it (#209): the accounts over time, or by language. Then the sweep that deletes
 * accounts not signed in to for 24 months, in numbers: what it would take next and what it took. Below, one
 * account, looked up by its whole address: when it was made and last signed in and how it is used; and deleted by
 * hand, for an erasure asked for by mail or an account closed, after a question that is answered by typing the
 * address again. Nothing of an account is kept by the review app.
 */
export function AdminAccounts() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [counted, setCounted] = useState<Counted>({ kind: 'loading' })
  const [tile, setTile] = useState<Tile>('studied30')
  const [series, setSeries] = useState<Behind<AccountSeries>>({ kind: 'idle' })
  const [splits, setSplits] = useState<Behind<AccountSplits>>({ kind: 'idle' })
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

  const loadStats = useCallback(async () => {
    try {
      const view = await hostedApi.admin.accountStats()
      setCounted(view.connected ? { kind: 'stats', stats: view.stats } : { kind: 'none' })
    } catch (err) {
      setCounted({ kind: 'failed', message: messageOf(err) })
    }
  }, [])
  useEffect(() => void loadStats(), [loadStats])

  // What is behind the counts is read when a tile first asks for it: the series for five of them, the splits for three.
  const view = VIEW_OF[tile]
  const byLanguage = view === 'news' || view === 'reminders'
  const shown = counted.kind === 'stats'
  useEffect(() => {
    if (!shown || byLanguage || series.kind !== 'idle') return
    setSeries({ kind: 'loading' })
    hostedApi.admin.accountSeries().then(
      (answer) => setSeries(answer.connected ? { kind: 'read', value: answer.series } : { kind: 'failed', message: 'Accounts are not connected.' }),
      (err: unknown) => setSeries({ kind: 'failed', message: messageOf(err) }),
    )
  }, [shown, byLanguage, series.kind])
  useEffect(() => {
    if (!shown || !byLanguage || splits.kind !== 'idle') return
    setSplits({ kind: 'loading' })
    hostedApi.admin.accountSplits().then(
      (answer) => setSplits(answer.connected ? { kind: 'read', value: answer.splits } : { kind: 'failed', message: 'Accounts are not connected.' }),
      (err: unknown) => setSplits({ kind: 'failed', message: messageOf(err) }),
    )
  }, [shown, byLanguage, splits.kind])

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
    void loadStats()
    setSeries({ kind: 'idle' })
    setSplits({ kind: 'idle' })
  }

  if (loaded.kind === 'loading' || counted.kind === 'loading') return <p className="note">Loading…</p>
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
      <p className="eyebrow">Accounts and their use</p>
      {counted.kind === 'failed' && (
        <div role="alert" className="notice feedback-failed">
          <p>The counts of accounts could not be read. {counted.message}</p>
          <button className="button small" onClick={() => void loadStats()}>
            Try again
          </button>
        </div>
      )}
      {counted.kind === 'stats' && <Stats stats={counted.stats} chosen={tile} onChoose={setTile} />}
      {counted.kind === 'stats' && (
        <Panel view={view} series={series} splits={splits} onRetry={() => (byLanguage ? setSplits({ kind: 'idle' }) : setSeries({ kind: 'idle' }))} />
      )}

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

      <p className="eyebrow">One account</p>
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
          <div className="account-head">
            <h3>{lookedUp.email}</h3>
            <button className="button small danger" onClick={() => setAsking(true)}>
              Delete this account…
            </button>
          </div>
          <Facts account={found} />
        </section>
      )}
      {lookedUp && found && asking && <DeleteQuestion email={lookedUp.email} account={found} onClose={() => setAsking(false)} onDone={(was) => deleted(lookedUp.email, was)} />}
    </>
  )
}

/** The accounts in eight numbers and a line: how many there are, how many are new, how many study, what they said
 * to news and how many have reminders on, with when that was counted. Each number is a button: the one pressed is
 * the one the panel under them is about (#209). */
function Stats(props: { stats: AccountStats; chosen: Tile; onChoose(tile: Tile): void }) {
  const s = props.stats
  const tiles: [Tile, number, string][] = [
    ['accounts', s.accounts, s.accounts === 1 ? 'account' : 'accounts'],
    ['made7', s.made7, 'made in the last 7 days'],
    ['made30', s.made30, 'made in the last 30 days'],
    ['reminders', s.reminders, 'with reminders on'],
    ['studied7', s.studied7, 'studied in the last 7 days'],
    ['studied30', s.studied30, 'studied in the last 30 days'],
    ['newsGiven', s.newsGiven, 'agreed to news'],
    ['newsWithdrawn', s.newsWithdrawn, 'withdrew from news'],
  ]
  return (
    <>
      <ul className="stats" aria-label="Accounts and their use">
        {tiles.map(([tile, n, what]) => (
          <li key={tile}>
            <button type="button" className="stat" aria-pressed={tile === props.chosen} onClick={() => props.onChoose(tile)}>
              <b>{n.toLocaleString('en')}</b>
              {what}
            </button>
          </li>
        ))}
      </ul>
      <p className="note">
        An account studied when it has at least one answer in that time. {count(s.newsNone, 'account has', 'accounts have')} said nothing about news yet. Counted {new Date(s.readAt).toLocaleString()}.
      </p>
    </>
  )
}

/** What each view is called and what its numbers mean, in a line under the title. */
const VIEWS: Readonly<Record<View, { readonly title: string; readonly note: string }>> = {
  growth: {
    title: 'Accounts in total',
    note: 'The accounts that exist today, by the week they were made. A deleted account leaves the earlier weeks too, so this is not what the count was then. Weeks begin on Monday, UTC; the last one is not over.',
  },
  made: {
    title: 'New accounts per week',
    note: 'The accounts that exist today, by the week they were made: a deleted account is in none. Weeks begin on Monday, UTC; the paler bar is the week so far.',
  },
  studied: {
    title: 'Accounts that studied, per day',
    note: 'An account counts on a day when it gave at least one answer. Days are UTC days, whatever the learner’s own time; the last one is not over.',
  },
  news: {
    title: 'News by email, by language',
    note: 'The language is the one an announcement would be written to the account in. Those who agreed are whom news would reach; where the language is not known, it goes in English.',
  },
  reminders: {
    title: 'Reminders, by language',
    note: 'The language is the one the account’s newest device asks its reminders in. Paused: the app stopped sending after reminders were ignored. The count above has these as on.',
  },
}

/**
 * What is behind the pressed count (#209): the accounts over time as a chart, or by language as a split, with a
 * switch between two periods where there are two. Numbers only, as the counts are. When they cannot be read it
 * says so here, and the counts above and the lookup below are as they were.
 */
function Panel(props: { view: View; series: Behind<AccountSeries>; splits: Behind<AccountSplits>; onRetry(): void }) {
  const { view } = props
  const [periods, setPeriods] = useState<Readonly<Partial<Record<View, number>>>>({})
  const choices = PERIODS[view]
  const period = periods[view] ?? choices?.[0] ?? 0
  const { title, note } = VIEWS[view]
  const behind = view === 'news' || view === 'reminders' ? props.splits : props.series
  const unit = view === 'studied' ? 'days' : 'weeks'
  return (
    <section className="stat-panel" aria-label={title}>
      <div className="stat-panel-head">
        <h3>{title}</h3>
        {choices && (
          <span className="segmented" role="group" aria-label="Period">
            {[...choices].sort((a, b) => a - b).map((choice) => (
              <button key={choice} type="button" aria-pressed={choice === period} onClick={() => setPeriods({ ...periods, [view]: choice })}>
                {choice} {unit}
              </button>
            ))}
          </span>
        )}
      </div>
      <p className="note">{note}</p>
      {(behind.kind === 'idle' || behind.kind === 'loading') && <p className="note">Loading…</p>}
      {behind.kind === 'failed' && (
        <div role="alert" className="notice feedback-failed">
          <p>These numbers could not be read. {behind.message}</p>
          <button className="button small" onClick={props.onRetry}>
            Try again
          </button>
        </div>
      )}
      {props.series.kind === 'read' && view === 'growth' && <Chart kind="line" title={title} step="Week from" points={accountsByWeek(props.series.value)} />}
      {props.series.kind === 'read' && view === 'made' && <Chart kind="bars" title={`${title}, ${period} weeks`} step="Week from" points={madeByWeek(props.series.value, period)} />}
      {props.series.kind === 'read' && view === 'studied' && <Chart kind="line" title={`${title}, ${period} days`} step="Day" points={studiedByDay(props.series.value, period)} />}
      {props.splits.kind === 'read' && view === 'news' && <Split label={title} rows={props.splits.value.news} parts={NEWS_PARTS} />}
      {props.splits.kind === 'read' && view === 'reminders' && <Split label={title} rows={props.splits.value.reminders} parts={REMINDER_PARTS} />}
    </section>
  )
}

/** A minute of the day and an offset from UTC as a person reads them: "19:30 (UTC+3)". */
export function reminderTime(minute: number, tzOffsetMin: number): string {
  const two = (v: number): string => String(v).padStart(2, '0')
  const [hours, minutes] = [Math.floor(Math.abs(tzOffsetMin) / 60), Math.abs(tzOffsetMin) % 60]
  const zone = tzOffsetMin === 0 ? 'UTC' : `UTC${tzOffsetMin < 0 ? '−' : '+'}${hours}${minutes === 0 ? '' : `:${two(minutes)}`}`
  return `${two(Math.floor(minute / 60))}:${two(minute % 60)} (${zone})`
}

const month = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

/** What the account said to news, with the day and, where the server knows it, the language it read the question in. */
function News(props: { details: AccountDetails }) {
  const { newsConsent, newsConsentAt, newsConsentLanguage } = props.details
  if (newsConsent === 'none') return <span className="chip off">Said nothing</span>
  const language = newsConsentLanguage === null ? '' : `, ${newsConsent === 'given' ? 'in' : 'had agreed in'} ${LANGUAGE_NAMES[newsConsentLanguage]}`
  return (
    <>
      <span className={`chip ${newsConsent === 'given' ? 'ok' : 'off'}`}>{newsConsent === 'given' ? 'Agreed' : 'Withdrew'}</span> {newsConsentAt === null ? '' : dayWithYear(newsConsentAt)}
      {language}
    </>
  )
}

/**
 * What the lookup says of one account (#209): its dates, how it is used, the language it is written to in (#199),
 * and the earliest month the sweep could take it. Use only: nothing the account holds is here. From a server that does not say how an account is used
 * yet, the two dates and a line that says so.
 */
function Facts(props: { account: Extract<AccountFound, { found: true }> }) {
  const { account } = props
  const d = account.details
  return (
    <>
      <dl className="facts">
        <div>
          <dt>Created</dt>
          <dd>{dayWithYear(account.createdAt)}</dd>
        </div>
        <div>
          <dt>Last sign-in</dt>
          <dd>{lastSignIn(account)}</dd>
        </div>
        {d && (
          <>
            <div>
              <dt>Last studied</dt>
              <dd>{d.lastStudiedAt === null ? 'never' : dayWithYear(d.lastStudiedAt)}</dd>
            </div>
            <div>
              <dt>Days studied, last 30</dt>
              <dd>{d.daysStudied30}</dd>
            </div>
            {d.language !== undefined && (
              <div>
                <dt>Language</dt>
                <dd>{d.language === null ? 'not known: written to in English' : LANGUAGE_NAMES[d.language]}</dd>
              </div>
            )}
            <div>
              <dt>News by email</dt>
              <dd>
                <News details={d} />
              </dd>
            </div>
            <div>
              <dt>Reminders</dt>
              {d.reminders.length === 0 && (
                <dd>
                  <span className="chip off">Off</span>
                </dd>
              )}
              {d.reminders.map((reminder, i) => (
                <dd key={i}>
                  <span className={`chip ${reminder.paused ? 'minor' : 'ok'}`}>{reminder.paused ? 'Paused' : 'On'}</span> {reminderTime(reminder.minute, reminder.tzOffsetMin)}
                </dd>
              ))}
            </div>
            <div>
              <dt>Devices</dt>
              <dd>{d.devices}</dd>
            </div>
            <div>
              <dt>Deleted for inactivity</dt>
              <dd>{d.sweepNotBefore === null ? 'never: it has no date of a last sign-in' : `not before ${month(d.sweepNotBefore)}`}</dd>
            </div>
          </>
        )}
      </dl>
      {!d && <p className="note">The app’s server says no more of an account: it is from before it did. Deploy it too.</p>}
      <p className="note">Shown only for an address typed in whole. Nothing of it is kept here.</p>
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
