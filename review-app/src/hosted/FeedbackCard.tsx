import type { FeedbackKind } from '@wordado/core'
import { type FormEvent, useId, useRef, useState } from 'react'
import { type FeedbackCategory, type FeedbackSeverity, type FeedbackState, type FeedbackTopicRef, type FeedbackView, MAX_FEEDBACK_NOTE_LENGTH, MAX_TOPIC_TITLE_LENGTH, MIN_TOPIC_TITLE_LENGTH } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { dateOf, messageOf } from './adminUtil'

const KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' }
const KIND_CHIP: Readonly<Record<FeedbackKind, string>> = { bug: 'chip major', idea: 'chip', other: 'chip off' }
export const STATES: readonly (readonly [FeedbackState, string])[] = [['new', 'New'], ['seen', 'Looked at'], ['done', 'Done'], ['declined', 'Not doing']]
export const STATE_LABEL: Readonly<Record<FeedbackState, string>> = Object.fromEntries(STATES) as Record<FeedbackState, string>
export const STATE_CHIP: Readonly<Record<FeedbackState, string>> = { new: 'chip', seen: 'chip off', done: 'chip ok', declined: 'chip off' }
export const CATEGORY_LABEL: Readonly<Record<FeedbackCategory, string>> = { bug: 'Bug', idea: 'Idea', question: 'Question', praise: 'Praise', junk: 'Junk' }
export const SEVERITY_LABEL: Readonly<Record<FeedbackSeverity, string>> = { blocks: 'Blocks study', annoys: 'Annoys', cosmetic: 'Cosmetic' }
export const SEVERITY_CHIP: Readonly<Record<FeedbackSeverity, string>> = { blocks: 'chip major', annoys: 'chip minor', cosmetic: 'chip off' }

/** How a save stands: nothing said, on its way, kept, or refused with the reason. */
export type Saving = { readonly kind: 'idle' } | { readonly kind: 'busy' } | { readonly kind: 'saved' } | { readonly kind: 'failed'; readonly message: string }
export const IDLE: Saving = { kind: 'idle' }

export function SaveStatus(props: { saving: Saving; what: string }) {
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
 * the note on Save. Each save sends the other one as it was last saved. A message the AI has read also shows the
 * topic it is in (spec 2026-10-10 §3.2), and `topics`, when given, are offered to move it to: the coordinator's
 * choice, which the AI does not change again. `onMoved` is told where it went. `inTopic`: the card stands under its
 * topic, which has a mark of its own, so the message's mark is folded away and its state shown in the head.
 * A message no topic suits is given a new one, with a title typed here (issue 260). `onMarked` is told of a state
 * that was saved, and the one before it: the list may then take the card away. `draft`, when given, puts Draft an
 * issue on the card of a message the AI has read: it drafts for the message's topic, so it needs the AI help on and
 * a message with a topic. A message the AI has not read shows nothing of it, as it shows nothing else of the AI. */
export function FeedbackCard(props: {
  item: FeedbackView
  topics?: readonly FeedbackTopicRef[]
  onMoved?(id: number, topic: FeedbackTopicRef): void
  onMarked?(id: number, mark: { readonly state: FeedbackState; readonly note: string }, was: FeedbackState): void
  draft?: { readonly aiOn: boolean; open(topic: number): void }
  inTopic?: boolean
}) {
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
  // Where the coordinator moved the message since the card was shown; until then, where its reading has it.
  const [moved, setMoved] = useState<FeedbackTopicRef | null>(null)
  const [moving, setMoving] = useState<Saving>(IDLE)
  // The title of a new topic as typed; null while none is being made.
  const [naming, setNaming] = useState<string | null>(null)
  const topic = moved ?? item.ai?.topic ?? null
  const others = (props.topics ?? []).filter((t) => t.id !== topic?.id)
  const when = new Date(item.receivedAt).toISOString()

  const save = (change: { state: FeedbackState } | { note: string }, say: (saving: Saving) => void, refused: () => void) => {
    say({ kind: 'busy' })
    queue.current = queue.current.then(async () => {
      try {
        const answer = await hostedApi.admin.markFeedback(item.id, { ...saved.current, ...change })
        const was = saved.current.state
        saved.current = { state: answer.state, note: answer.note }
        setSavedNote(answer.note)
        say({ kind: 'saved' })
        if ('state' in change) props.onMarked?.(item.id, saved.current, was)
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

  const move = async (to: number | { readonly title: string }) => {
    setMoving({ kind: 'busy' })
    try {
      const answer = await hostedApi.admin.moveFeedback(item.id, to)
      if (answer.topic) {
        setMoved(answer.topic)
        props.onMoved?.(item.id, answer.topic)
      }
      setNaming(null)
      setMoving({ kind: 'saved' })
    } catch (err) {
      setMoving({ kind: 'failed', message: messageOf(err) })
    }
  }

  const makeTopic = (e: FormEvent) => {
    e.preventDefault()
    // Refused: the title stays in the field, to be changed and sent again.
    void move({ title: (naming ?? '').trim() })
  }

  const drafter = props.draft && (
    <span className="feedback-draft">
      <button type="button" className="button tool" disabled={!props.draft.aiOn || topic === null} onClick={() => topic && props.draft?.open(topic.id)}>
        Draft an issue
      </button>
      {!props.draft.aiOn && <span className="feedback-status">Needs the AI help, which is off or not set up.</span>}
      {props.draft.aiOn && topic === null && <span className="feedback-status">Give the message a topic first.</span>}
    </span>
  )

  const mark = (
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
      </div>
      <label className="field feedback-note">
        Note
        <textarea
          rows={1}
          maxLength={MAX_FEEDBACK_NOTE_LENGTH}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setNoteSaving(IDLE)
          }}
        />
      </label>
      <span className="form-actions">
        <button type="submit" className="button tool" disabled={noteSaving.kind === 'busy' || draft.trim() === savedNote}>
          Save note
        </button>
      </span>
      <span className="feedback-saved">
        <SaveStatus saving={stateSaving} what="State" />
        <SaveStatus saving={noteSaving} what="Note" />
      </span>
    </form>
  )

  return (
    <li className="feedback-item">
      <article aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`} className="feedback-head">
          <span className={KIND_CHIP[item.kind]}>{KIND_LABEL[item.kind]}</span>
          <time dateTime={when}>{dateOf(when)}</time>
          <span className="note">{item.signedIn ? 'signed in' : 'not signed in'}</span>
          {props.inTopic && <span className={STATE_CHIP[chosen]}>{STATE_LABEL[chosen]}</span>}
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
            <div className="feedback-topic">
              <p className="feedback-topic-name">Topic: {topic ? topic.title : 'none'}</p>
              {props.topics !== undefined && naming === null && (
                <label className="field feedback-move">
                  Move to…
                  <select value="" disabled={moving.kind === 'busy'} onChange={(e) => (e.target.value === 'new' ? (setNaming(''), setMoving(IDLE)) : e.target.value !== '' && void move(Number(e.target.value)))}>
                    <option value="">Choose a topic</option>
                    {others.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                    <option value="new">New topic…</option>
                  </select>
                </label>
              )}
              {naming !== null && (
                <form className="feedback-new-topic" aria-label="A new topic" onSubmit={makeTopic}>
                  <label className="field">
                    New topic’s title
                    {/* Asked for by the choice just made: the field is where the typing goes on. */}
                    <input type="text" autoFocus maxLength={MAX_TOPIC_TITLE_LENGTH} value={naming} onChange={(e) => setNaming(e.target.value)} />
                  </label>
                  <span className="form-actions">
                    <button type="submit" className="button tool" disabled={moving.kind === 'busy' || naming.trim().length < MIN_TOPIC_TITLE_LENGTH}>
                      Make the topic
                    </button>
                    <button type="button" className="button tool" onClick={() => setNaming(null)}>
                      Cancel
                    </button>
                  </span>
                </form>
              )}
              <SaveStatus saving={moving} what="Topic" />
              {drafter}
            </div>
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
        {props.inTopic ? (
          <details className="feedback-details feedback-mark-fold">
            <summary>Mark this message</summary>
            {mark}
          </details>
        ) : (
          mark
        )}
      </article>
    </li>
  )
}
