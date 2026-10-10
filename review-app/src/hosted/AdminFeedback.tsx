import type { FeedbackKind } from '@wordado/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedbackAiStatus, FeedbackAiWhy, FeedbackStateFilter, FeedbackTopicRef, FeedbackTopicView, FeedbackView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedbackAi, aiFailureLine } from './AdminFeedbackAi'
import { AdminFeedbackTopics } from './AdminFeedbackTopics'
import { count, messageOf } from './adminUtil'
import { FeedbackCard } from './FeedbackCard'

/** How the tab lists the feedback: a card a message, or a line a topic (spec 2026-10-10 §3.2). */
type View = 'messages' | 'topics'
const VIEWS: readonly (readonly [View, string])[] = [['messages', 'Messages'], ['topics', 'By topic']]
const KIND_FILTERS: readonly (readonly [FeedbackKind | '', string])[] = [['', 'All'], ['bug', 'Bug'], ['idea', 'Idea'], ['other', 'Other']]
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
 * as advice; without it, or when it fails, the tab is what it is without it and says so in one line.
 * By topic, the same feedback is one line for each thing it is about (AdminFeedbackTopics); the filter by state
 * is then of the topics' own state, and the view stays as it is when the filter changes. */
export function AdminFeedback() {
  const [view, setView] = useState<View>('messages')
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
  // The topics: for the By topic view, and for a card to offer them to move its message to. Null: not known yet.
  const [topics, setTopics] = useState<readonly FeedbackTopicView[] | null | 'failed'>(null)
  const topicsAsked = useRef(0)

  /** Reads the topics, from the review app's own database: nothing is asked of the AI or of the learner app's server.
   * A failure is not the list's: the messages stay as they are, and By topic says so. */
  const loadTopics = useCallback(async () => {
    const mine = ++topicsAsked.current
    try {
      const found = await hostedApi.admin.feedbackTopics()
      if (mine === topicsAsked.current) setTopics(found)
    } catch {
      if (mine === topicsAsked.current) setTopics('failed')
    }
  }, [])

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
        // A reading may have made a topic, or put a message in one.
        if (Object.keys(answer.results).length > 0) void loadTopics()
      } catch {
        if (list === listed.current) setAiUnreached(true)
      } finally {
        // A list read anew started its own count: an answer to the one before it is not waited for.
        if (list === listed.current) setAiReading((n) => n - 1)
      }
    },
    [aiStatus, loadTopics],
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
  useEffect(() => void loadTopics(), [loadTopics])

  /** Another view. By topic shows the topics as they are now. */
  const look = (next: View) => {
    setView(next)
    if (next === 'topics') void loadTopics()
  }

  /** A message was moved from its card: the list shows where it is now, and the topics are counted again. */
  const moved = (id: number, topic: FeedbackTopicRef) => {
    setLoaded((now) => (now.kind === 'list' ? { ...now, items: now.items.map((item) => (item.id === id && item.ai ? { ...item, ai: { ...item.ai, topic } } : item)) } : now))
    void loadTopics()
  }

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

  /** The AI's results are gone: its parts leave the cards, which stay as they are otherwise, and the topics nobody worked on are gone too. */
  const forgotten = () => {
    setLoaded((now) => (now.kind === 'list' ? { ...now, items: now.items.map((item) => (item.ai ? { ...item, ai: null } : item)) } : now))
    setAiWhy(null)
    setAiLeft([])
    void loadTopics()
  }

  const filtered = kind !== '' || state !== 'all'
  const items = loaded.kind === 'list' ? loaded.items : []
  // Under Open, what the AI reads as junk is folded away under the list: out of the way, never out of reach.
  const junk = state === 'open' ? items.filter((item) => item.ai?.category === 'junk') : []
  const shown = junk.length > 0 ? items.filter((item) => item.ai?.category !== 'junk') : items
  const aiFailed = aiFailureLine(aiWhy, ai !== null && ai !== 'failed' ? ai.dailyCalls : 0)
  const left = aiLeft.reduce((sum, p) => sum + p.left, 0)
  const known = ai !== null && ai !== 'failed' ? ai : null
  const offered = topics !== null && topics !== 'failed' ? topics : []
  return (
    <>
      <h2 className="visually-hidden">Feedback</h2>
      <AdminFeedbackAi status={ai} unreached={aiUnreached} onStatus={switched} onForgotten={forgotten} />
      <div className="tab-actions feedback-filters">
        <label className="field">
          View
          <select value={view} onChange={(e) => look(e.target.value as View)}>
            {VIEWS.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {view === 'messages' && (
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
        )}
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
      {view === 'topics' && <AdminFeedbackTopics topics={topics} show={state} aiOn={known !== null && known.setUp && known.on} repo={known?.repo ?? ''} onChanged={loadTopics} />}
      {view === 'messages' && busy && (
        <div className="busy-bar" role="progressbar" aria-label="Loading feedback">
          <span />
        </div>
      )}
      {view === 'messages' && loaded.kind === 'unconnected' && (
        <p className="note">
          Feedback is not connected: set <code>FEEDBACK_READ_TOKEN</code> and <code>LEARNER_APP_URL</code> for the review app, then open this tab again.
        </p>
      )}
      {view === 'messages' && loaded.kind === 'failed' && (
        <div role="alert" className="notice feedback-failed">
          <p>Feedback could not be read. {loaded.message}</p>
          <button className="button small" onClick={() => void load({ kind, state })}>
            Try again
          </button>
        </div>
      )}
      {view === 'messages' && loaded.kind === 'list' && (
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
                  <FeedbackCard key={item.id} item={item} topics={offered} onMoved={moved} />
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
                  <FeedbackCard key={item.id} item={item} topics={offered} onMoved={moved} />
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
