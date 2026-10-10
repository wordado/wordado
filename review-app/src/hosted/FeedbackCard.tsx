import type { FeedbackKind } from '@wordado/core'
import { type FormEvent, useId, useRef, useState } from 'react'
import { type FeedbackCategory, type FeedbackSeverity, type FeedbackState, type FeedbackTopicRef, type FeedbackView, MAX_FEEDBACK_NOTE_LENGTH } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { dateOf, messageOf } from './adminUtil'

const KIND_LABEL: Readonly<Record<FeedbackKind, string>> = { bug: 'Bug', idea: 'Idea', other: 'Other' }
const KIND_CHIP: Readonly<Record<FeedbackKind, string>> = { bug: 'chip major', idea: 'chip', other: 'chip off' }
export const STATES: readonly (readonly [FeedbackState, string])[] = [['new', 'New'], ['seen', 'Looked at'], ['done', 'Done'], ['declined', 'Not doing']]
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
 * choice, which the AI does not change again. `onMoved` is told where it went. */
export function FeedbackCard(props: { item: FeedbackView; topics?: readonly FeedbackTopicRef[]; onMoved?(id: number, topic: FeedbackTopicRef): void }) {
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
  const topic = moved ?? item.ai?.topic ?? null
  const others = (props.topics ?? []).filter((t) => t.id !== topic?.id)
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

  const move = async (to: number) => {
    setMoving({ kind: 'busy' })
    try {
      const answer = await hostedApi.admin.moveFeedback(item.id, to)
      if (answer.topic) {
        setMoved(answer.topic)
        props.onMoved?.(item.id, answer.topic)
      }
      setMoving({ kind: 'saved' })
    } catch (err) {
      setMoving({ kind: 'failed', message: messageOf(err) })
    }
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
            <div className="feedback-topic">
              <p className="feedback-topic-name">Topic: {topic ? topic.title : 'none'}</p>
              {others.length > 0 && (
                <label className="field feedback-move">
                  Move to…
                  <select value="" disabled={moving.kind === 'busy'} onChange={(e) => e.target.value !== '' && void move(Number(e.target.value))}>
                    <option value="">Choose a topic</option>
                    {others.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <SaveStatus saving={moving} what="Topic" />
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
