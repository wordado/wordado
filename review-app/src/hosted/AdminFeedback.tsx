import type { FeedbackKind } from '@wordado/core'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import {
  type FeedbackAiStatus,
  type FeedbackAiWhy,
  type FeedbackCategory,
  type FeedbackSeverity,
  type FeedbackState,
  type FeedbackStateFilter,
  type FeedbackView,
  MAX_FEEDBACK_NOTE_LENGTH,
} from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedbackAi, aiFailureLine } from './AdminFeedbackAi'
import { count, dateOf, messageOf } from './adminUtil'

const KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' }
const KIND_CHIP: Readonly<Record<FeedbackKind, string>> = { bug: 'chip major', idea: 'chip', other: 'chip off' }
const STATES: readonly (readonly [FeedbackState, string])[] = [['new', 'New'], ['seen', 'Looked at'], ['done', 'Done'], ['declined', 'Not doing']]
const KIND_FILTERS: readonly (readonly [FeedbackKind | '', string])[] = [['', 'All'], ['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']]
const CATEGORY_LABEL: Readonly<Record<FeedbackCategory, string>> = { bug: 'Bug', idea: 'Idea', question: 'Question', praise: 'Praise', junk: 'Junk' }
const SEVERITY_LABEL: Readonly<Record<FeedbackSeverity, string>> = { blocks: 'Blocks study', annoys: 'Annoys', cosmetic: 'Cosmetic' }
const SEVERITY_CHIP: Readonly<Record<FeedbackSeverity, string>> = { blocks: 'chip major', annoys: 'chip minor', cosmetic: 'chip off' }
const STATE_FILTERS: readonly (readonly [FeedbackStateFilter, string])[] = [['open', 'Open'], ['all', 'All'], ['done', 'Done'], ['declined', 'Not doing']]

/** What the tab has from the server: nothing yet, that feedback is not connected, that it could not be read, or the
 * messages so far with the way to the older ones. `read` counts every message the pages held, shown or not. */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unconnected' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'list'; readonly items: readonly FeedbackView[]; readonly nextBefore: number | null; readonly read: number; readonly moreFailed: string }

/** A page the AI has not read to its end: its cursor (none for the newest page) and how many of its messages have no result. */
interface AiLeft { readonly before: number | undefined; readonly left: number }

/** The Feedback tab (spec §16): what learners wrote about the app, newest first, read from the learner app's server
 * each time, and the coordinator's own mark on each message: where it stands, and a note. With the AI help set up
 * and switched on (spec 2026-10-10), each page shown is then read by the AI, and what it says is put on the cards
 * as advice; without it, or when it fails, the tab is what it is without it and says so in one line. */
export function AdminFeedback() {
  const [kind, setKind] = useState<FeedbackKind | ''>('')
  const [state, setState] = useState<FeedbackStateFilter>('open')
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [busy, setBusy] = useState(true)
  // Only the answer to the latest question is shown: a filter changed while a page was on its way wins.
  const asked = useRef(0)
  // The AI help: how it stands (null: not known yet), how many of its readings are on their way, why the last one
  // gave nothing, and the pages with messages it has not read yet.
  const [ai, setAi] = useState<FeedbackAiStatus | null | 'failed'>(null)
  const [aiReading, setAiReading] = useState(0)
  const [aiWhy, setAiWhy] = useState<FeedbackAiWhy | null>(null)
  const [aiLeft, setAiLeft] = useState<readonly AiLeft[]>([])
  const [aiUnreached, setAiUnreached] = useState(false)
  // The AI's answers are for one list: a list read anew (another filter) takes none of the answers asked for before it.
  const listed = useRef(0)
  const aiKnown = useRef<Promise<FeedbackAiStatus | null> | null>(null)

  /** The AI help's status, asked for once. A failure is not the list's: the tab goes on without the AI. */
  const aiStatus = useCallback(() => {
    aiKnown.current ??= hostedApi.admin.feedbackAi().then(
      (status) => (setAi(status), status),
      () => (setAi('failed'), null),
    )
    return aiKnown.current
  }, [])

  /** Has the AI read one page already shown, and puts what it says on the cards. The list is not read again. */
  const readAi = useCallback(
    async (pageKind: FeedbackKind | '', before: number | undefined, list: number) => {
      const status = await aiStatus()
      if (list !== listed.current || !status?.setUp || !status.on) return
      setAiReading((n) => n + 1)
      try {
        const answer = await hostedApi.admin.readFeedbackAi({ kind: pageKind, ...(before !== undefined ? { before } : {}) })
        if (list !== listed.current) return
        setAiUnreached(false)
        // Switched off, or the key taken away, since the tab asked: the panel shows how it stands now.
        if (answer.why === 'off' || answer.why === 'not-set-up') {
          aiKnown.current = null
          void aiStatus()
          return
        }
        setLoaded((now) => (now.kind === 'list' ? { ...now, items: now.items.map((item) => (answer.results[item.id] ? { ...item, ai: answer.results[item.id]! } : item)) } : now))
        setAiWhy(answer.why)
        setAiLeft((pages) => [...pages.filter((p) => p.before !== before), ...(answer.left > 0 ? [{ before, left: answer.left }] : [])])
        if (answer.asked > 0) setAi((now) => (now !== null && now !== 'failed' ? { ...now, callsToday: now.callsToday + 1 } : now))
      } catch {
        if (list === listed.current) setAiUnreached(true)
      } finally {
        // A list read anew started its own count: an answer to the one before it is not waited for.
        if (list === listed.current) setAiReading((n) => n - 1)
      }
    },
    [aiStatus],
  )

  const load = useCallback(
    async (filter: { kind: FeedbackKind | ''; state: FeedbackStateFilter }, older?: { readonly before: number }) => {
      const mine = ++asked.current
      const list = older ? listed.current : ++listed.current
      setBusy(true)
      if (!older) {
        setLoaded({ kind: 'loading' })
        setAiReading(0)
        setAiWhy(null)
        setAiLeft([])
      }
      try {
        const page = await hostedApi.admin.feedback({ ...filter, ...(older ? { before: older.before } : {}) })
        if (mine !== asked.current) return
        if (!page.connected) return setLoaded({ kind: 'unconnected' })
        // The older messages go under the ones shown as they are now: with what the AI said of them in the meantime.
        if (older) setLoaded((now) => (now.kind === 'list' ? { kind: 'list', items: [...now.items, ...page.items], nextBefore: page.nextBefore, read: now.read + page.read, moreFailed: '' } : now))
        else setLoaded({ kind: 'list', items: page.items, nextBefore: page.nextBefore, read: page.read, moreFailed: '' })
        void readAi(filter.kind, older?.before, list)
      } catch (err) {
        if (mine !== asked.current) return
        // The older messages could not be read: the ones already shown stay, with their marks.
        if (older) setLoaded((now) => (now.kind === 'list' ? { ...now, moreFailed: messageOf(err) } : now))
        else setLoaded({ kind: 'failed', message: messageOf(err) })
      } finally {
        if (mine === asked.current) setBusy(false)
      }
    },
    [readAi],
  )

  useEffect(() => void load({ kind, state }), [load, kind, state])
  useEffect(() => void aiStatus(), [aiStatus])

  /** The switch was moved. On: the list is read again, and with it the AI reads the page. Off: nothing more is asked. */
  const switched = (status: FeedbackAiStatus) => {
    const was = ai !== null && ai !== 'failed' && ai.on
    aiKnown.current = Promise.resolve(status)
    setAi(status)
    setAiUnreached(false)
    if (status.setUp && status.on && !was) void load({ kind, state })
    if (!status.on) {
      setAiWhy(null)
      setAiLeft([])
    }
  }

  /** The AI's results are gone: its parts leave the cards, which stay as they are otherwise. */
  const forgotten = () => {
    setLoaded((now) => (now.kind === 'list' ? { ...now, items: now.items.map((item) => (item.ai ? { ...item, ai: null } : item)) } : now))
    setAiWhy(null)
    setAiLeft([])
  }

  const filtered = kind !== '' || state !== 'all'
  const items = loaded.kind === 'list' ? loaded.items : []
  // Under Open, what the AI reads as junk is folded away under the list: out of the way, never out of reach.
  const junk = state === 'open' ? items.filter((item) => item.ai?.category === 'junk') : []
  const shown = junk.length > 0 ? items.filter((item) => item.ai?.category !== 'junk') : items
  const aiFailed = aiFailureLine(aiWhy, ai !== null && ai !== 'failed' ? ai.dailyCalls : 0)
  const left = aiLeft.reduce((sum, p) => sum + p.left, 0)
  return (
    <>
      <h2 className="visually-hidden">Feedback</h2>
      <AdminFeedbackAi status={ai} unreached={aiUnreached} onStatus={switched} onForgotten={forgotten} />
      <div className="tab-actions feedback-filters">
        <label className="field">
          Kind
          <select value={kind} onChange={(e) => setKind(e.target.value as FeedbackKind | '')}>
            {KIND_FILTERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Show
          <select value={state} onChange={(e) => setState(e.target.value as FeedbackStateFilter)}>
            {STATE_FILTERS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {busy && (
        <div className="busy-bar" role="progressbar" aria-label="Loading feedback">
          <span />
        </div>
      )}
      {loaded.kind === 'unconnected' && (
        <p className="note">
          Feedback is not connected: set <code>FEEDBACK_READ_TOKEN</code> and <code>LEARNER_APP_URL</code> for the review app, then open this tab again.
        </p>
      )}
      {loaded.kind === 'failed' && (
        <div role="alert" className="notice feedback-failed">
          <p>Feedback could not be read. {loaded.message}</p>
          <button className="button small" onClick={() => void load({ kind, state })}>
            Try again
          </button>
        </div>
      )}
      {loaded.kind === 'list' && (
        <>
          {aiReading > 0 && (
            <p role="status" className="note feedback-ai-reading">
              The AI is reading the new messages…
            </p>
          )}
          {aiReading === 0 && aiFailed !== '' && (
            <p role="status" className="note feedback-ai-note">
              {aiFailed}
            </p>
          )}
          {aiReading === 0 && aiFailed === '' && left > 0 && (
            <div className="feedback-ai-left">
              <p role="status" className="note feedback-ai-note">
                {count(left, 'message')} {left === 1 ? 'has' : 'have'} no AI result yet.
              </p>
              <button className="button small" onClick={() => void readAi(kind, aiLeft[0]!.before, listed.current)}>
                Ask the AI
              </button>
            </div>
          )}
          {shown.length === 0 && (
            <p className="note">
              {loaded.read === 0 && kind === '' ? 'No feedback yet.' : loaded.nextBefore === null ? 'Nothing here to show.' : `Nothing to show among the newest ${count(loaded.read, 'message')}.`}
            </p>
          )}
          {shown.length > 0 && (
            <>
              <p className="eyebrow">
                {count(shown.length, 'message')}
                {filtered && loaded.read > shown.length ? ` of ${loaded.read.toLocaleString('en')} read` : ''}
              </p>
              <ul className="feedback-list" aria-label="Feedback">
                {shown.map((item) => (
                  <FeedbackCard key={item.id} item={item} />
                ))}
              </ul>
            </>
          )}
          {junk.length > 0 && (
            <details className="feedback-junk">
              <summary>
                {count(junk.length, 'message')} the AI reads as junk
              </summary>
              <ul className="feedback-list" aria-label="Messages the AI reads as junk">
                {junk.map((item) => (
                  <FeedbackCard key={item.id} item={item} />
                ))}
              </ul>
            </details>
          )}
          {loaded.moreFailed && (
            <p role="alert" className="notice">
              The older messages could not be read. {loaded.moreFailed}
            </p>
          )}
          {loaded.nextBefore !== null && (
            <div className="tab-actions">
              <button className="button" disabled={busy} onClick={() => void load({ kind, state }, { before: loaded.nextBefore! })}>
                {loaded.moreFailed ? 'Try again' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </>
  )
}

/** How a save stands: nothing said, on its way, kept, or refused with the reason. */
type Saving = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'saved' } | { readonly kind: 'failed'; readonly message: string }
const IDLE: Saving = { kind: 'idle' }

function SaveStatus(props: { saving: Saving; what: string }) {
  const { saving } = props
  return (
    <span role="status" className={`feedback-status${saving.kind === 'failed' ? ' failed' : ''}`}>
      {saving.kind === 'busy' && 'Saving…'}
      {saving.kind === 'saved' && 'Saved'}
      {saving.kind === 'failed' && `${props.what} not saved: ${saving.message}`}
    </span>
  )
}

/** One message: what the learner sent, what the AI reads in it when it has (marked as the AI's, under the learner's
 * own words, which are never changed), the details folded away, and the mark. The state saves when it is chosen;
 * the note on Save. Each save sends the other one as it was last saved. */
function FeedbackCard(props: { item: FeedbackView }) {
  const { item } = props
  const id = useId()
  // The mark as the server last confirmed it. Each save sends the whole mark, so the saves of one message go one
  // after another, and each builds on the answer to the one before.
  const saved = useRef<{ readonly state: FeedbackState; readonly note: string }>({ state: item.state, note: item.note })
  const queue = useRef<Promise<void>>(Promise.resolve())
  const [savedNote, setSavedNote] = useState(item.note)
  // What the control shows: the saved state, or the one on its way.
  const [chosen, setChosen] = useState(item.state)
  const [draft, setDraft] = useState(item.note)
  const [stateSaving, setStateSaving] = useState<Saving>(IDLE)
  const [noteSaving, setNoteSaving] = useState<Saving>(IDLE)
  const when = new Date(item.receivedAt).toISOString()

  const save = (change: { state: FeedbackState } | { note: string }, say: (saving: Saving) => void, refused: () => void) => {
    say({ kind: 'busy' })
    queue.current = queue.current.then(async () => {
      try {
        const answer = await hostedApi.admin.markFeedback(item.id, { ...saved.current, ...change })
        saved.current = { state: answer.state, note: answer.note }
        setSavedNote(answer.note)
        say({ kind: 'saved' })
      } catch (err) {
        refused()
        say({ kind: 'failed', message: messageOf(err) })
      }
    })
  }

  const choose = (next: FeedbackState) => {
    setChosen(next)
    // Refused: the control goes back to what the server holds.
    save({ state: next }, setStateSaving, () => setChosen(saved.current.state))
  }

  const saveNote = (e: FormEvent) => {
    e.preventDefault()
    // Refused: what was typed stays in the field, to be saved again.
    save({ note: draft.trim() }, setNoteSaving, () => undefined)
  }

  return (
    <li className="feedback-item">
      <article aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`} className="feedback-head">
          <span className={KIND_CHIP[item.kind]}>{KIND_LABEL[item.kind]}</span>
          <time dateTime={when}>{dateOf(when)}</time>
          <span className="note">{item.signedIn ? 'signed in' : 'not signed in'}</span>
        </h3>
        <p className="feedback-message">{item.message}</p>
        {item.ai && item.ai.translation !== '' && (
          <div className="feedback-translated">
            <p className="feedback-ai-label">Translation by the AI</p>
            <p className="feedback-translation" lang="en">
              {item.ai.translation}
            </p>
          </div>
        )}
        {item.ai && (
          <div className="feedback-ai">
            <p className="feedback-ai-chips">
              <span className="chip ai">AI: {CATEGORY_LABEL[item.ai.category]}</span>
              {item.ai.severity && <span className={SEVERITY_CHIP[item.ai.severity]}>{SEVERITY_LABEL[item.ai.severity]}</span>}
            </p>
            <p className="feedback-ai-summary">AI summary: {item.ai.summary}</p>
          </div>
        )}
        {item.contactEmail !== '' && (
          <p className="feedback-contact">
            Answer to <span className="invite-link">{item.contactEmail}</span>{' '}
            <a className="row-link" href={`mailto:${encodeURIComponent(item.contactEmail).replace('%40', '@')}`}>
              Write a mail
            </a>
          </p>
        )}
        <details className="feedback-details">
          <summary>Details</summary>
          <dl>
            <dt>App version</dt>
            <dd>{item.appVersion}</dd>
            <dt>Word list version</dt>
            <dd>{item.corpusVersion === '' ? 'none' : item.corpusVersion}</dd>
            <dt>Language</dt>
            <dd>{item.language}</dd>
            <dt>Screen</dt>
            <dd>{item.screen}</dd>
            <dt>Browser</dt>
            <dd>{item.userAgent === '' ? 'not given' : item.userAgent}</dd>
          </dl>
        </details>
        <form className="feedback-mark" aria-label="Your mark" onSubmit={saveNote}>
          <div className="feedback-state">
            <label className="field">
              State
              <select value={chosen} aria-busy={stateSaving.kind === 'busy'} onChange={(e) => choose(e.target.value as FeedbackState)}>
                {STATES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <SaveStatus saving={stateSaving} what="State" />
          </div>
          <label className="field feedback-note">
            Note
            <textarea
              rows={2}
              maxLength={MAX_FEEDBACK_NOTE_LENGTH}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setNoteSaving(IDLE)
              }}
            />
          </label>
          <span className="form-actions">
            <button type="submit" className="button small" disabled={noteSaving.kind === 'busy' || draft.trim() === savedNote}>
              Save note
            </button>
            <SaveStatus saving={noteSaving} what="Note" />
          </span>
        </form>
      </article>
    </li>
  )
}
