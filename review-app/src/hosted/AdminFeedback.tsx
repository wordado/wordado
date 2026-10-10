import type { FeedbackKind } from '@wordado/core'
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react'
import { type FeedbackState, type FeedbackStateFilter, type FeedbackView, MAX_FEEDBACK_NOTE_LENGTH } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { count, dateOf, messageOf } from './adminUtil'

const KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' }
const KIND_CHIP: Readonly<Record<FeedbackKind, string>> = { bug: 'chip major', idea: 'chip', other: 'chip off' }
const STATES: readonly (readonly [FeedbackState, string])[] = [['new', 'New'], ['seen', 'Looked at'], ['done', 'Done'], ['declined', 'Not doing']]
const KIND_FILTERS: readonly (readonly [FeedbackKind | '', string])[] = [['', 'All'], ['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']]
const STATE_FILTERS: readonly (readonly [FeedbackStateFilter, string])[] = [['open', 'Open'], ['all', 'All'], ['done', 'Done'], ['declined', 'Not doing']]

/** What the tab has from the server: nothing yet, that feedback is not connected, that it could not be read, or the
 * messages so far with the way to the older ones. `read` counts every message the pages held, shown or not. */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unconnected' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'list'; readonly items: readonly FeedbackView[]; readonly nextBefore: number | null; readonly read: number; readonly moreFailed: string }

/** The Feedback tab (spec §16): what learners wrote about the app, newest first, read from the learner app's server
 * each time, and the coordinator's own mark on each message: where it stands, and a note. */
export function AdminFeedback() {
  const [kind, setKind] = useState<FeedbackKind | ''>('')
  const [state, setState] = useState<FeedbackStateFilter>('open')
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  const [busy, setBusy] = useState(true)
  // Only the answer to the latest question is shown: a filter changed while a page was on its way wins.
  const asked = useRef(0)

  const load = useCallback(async (filter: { kind: FeedbackKind | ''; state: FeedbackStateFilter }, older?: { readonly items: readonly FeedbackView[]; readonly before: number; readonly read: number }) => {
    const mine = ++asked.current
    setBusy(true)
    if (!older) setLoaded({ kind: 'loading' })
    try {
      const page = await hostedApi.admin.feedback({ ...filter, ...(older ? { before: older.before } : {}) })
      if (mine !== asked.current) return
      if (!page.connected) setLoaded({ kind: 'unconnected' })
      else setLoaded({ kind: 'list', items: [...(older?.items ?? []), ...page.items], nextBefore: page.nextBefore, read: (older?.read ?? 0) + page.read, moreFailed: '' })
    } catch (err) {
      if (mine !== asked.current) return
      // The older messages could not be read: the ones already shown stay, with their marks.
      if (older) setLoaded({ kind: 'list', items: older.items, nextBefore: older.before, read: older.read, moreFailed: messageOf(err) })
      else setLoaded({ kind: 'failed', message: messageOf(err) })
    } finally {
      if (mine === asked.current) setBusy(false)
    }
  }, [])

  useEffect(() => void load({ kind, state }), [load, kind, state])

  const filtered = kind !== '' || state !== 'all'
  return (
    <>
      <h2 className="visually-hidden">Feedback</h2>
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
          {loaded.items.length === 0 && (
            <p className="note">
              {loaded.read === 0 && kind === '' ? 'No feedback yet.' : loaded.nextBefore === null ? 'Nothing here to show.' : `Nothing to show among the newest ${count(loaded.read, 'message')}.`}
            </p>
          )}
          {loaded.items.length > 0 && (
            <>
              <p className="eyebrow">
                {count(loaded.items.length, 'message')}
                {filtered && loaded.read > loaded.items.length ? ` of ${loaded.read.toLocaleString('en')} read` : ''}
              </p>
              <ul className="feedback-list" aria-label="Feedback">
                {loaded.items.map((item) => (
                  <FeedbackCard key={item.id} item={item} />
                ))}
              </ul>
            </>
          )}
          {loaded.moreFailed && (
            <p role="alert" className="notice">
              The older messages could not be read. {loaded.moreFailed}
            </p>
          )}
          {loaded.nextBefore !== null && (
            <div className="tab-actions">
              <button className="button" disabled={busy} onClick={() => void load({ kind, state }, { items: loaded.items, before: loaded.nextBefore!, read: loaded.read })}>
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

/** One message: what the learner sent, the details folded away, and the mark. The state saves when it is chosen;
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
