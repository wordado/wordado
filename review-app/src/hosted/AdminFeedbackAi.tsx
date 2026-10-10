import { useState } from 'react'
import type { FeedbackAiStatus, FeedbackAiWhy } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { count, messageOf } from './adminUtil'

/** What stands beside the switch, always (spec 2026-10-10 §5): switching it on sends learners' words to another company. */
export const AI_PRIVACY_NOTE =
  'Before this is switched on for learners’ feedback, the privacy policy must name the AI service: the service the model is reached through, the model’s provider, and that they receive the text of a feedback message without the contact address.'

/** Why the AI gave nothing, in words for the one line that says so. */
const WHY: Readonly<Record<'unreachable' | 'late' | 'refused' | 'unfit', string>> = {
  unreachable: 'it could not be reached',
  late: 'it took too long',
  refused: 'the service refused the request',
  unfit: 'its answer could not be used',
}

/** The one line for what went wrong with the AI on the pages shown: said once, never on each message. Nothing for a reason that is no failure. */
export function aiFailureLine(why: FeedbackAiWhy | null, dailyCalls: number): string {
  if (why === 'limit') return `Today’s limit of ${dailyCalls.toLocaleString('en')} AI calls is reached. Messages without AI results are read again tomorrow.`
  if (why === 'unreachable' || why === 'late' || why === 'refused' || why === 'unfit') return `The AI gave no results this time (${WHY[why]}). Messages without them are asked again the next time the page is read.`
  return ''
}

/**
 * The AI help's panel above the Feedback tab's filters (spec 2026-10-10 §4): the switch, how it stands, the note on
 * the privacy policy, and Forget the AI's results. `status` is null while it is not known yet and 'failed' when it
 * could not be read; `unreached` says a later call of the AI's failed. The tab under it works either way.
 */
export function AdminFeedbackAi(props: { status: FeedbackAiStatus | null | 'failed'; unreached?: boolean; onStatus(status: FeedbackAiStatus): void; onForgotten(): void }) {
  const { status } = props
  const known = status !== null && status !== 'failed' ? status : null
  // What the switch shows while its change is on its way; refused, it goes back to what the server holds.
  const [moving, setMoving] = useState<boolean | null>(null)
  const [refused, setRefused] = useState('')
  const [asking, setAsking] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const [forgetFailed, setForgetFailed] = useState('')
  const [forgotten, setForgotten] = useState<number | null>(null)

  const move = async (on: boolean) => {
    setMoving(on)
    setRefused('')
    try {
      props.onStatus(await hostedApi.admin.setFeedbackAi(on))
    } catch (err) {
      setRefused(messageOf(err))
    } finally {
      setMoving(null)
    }
  }

  const forget = async () => {
    setForgetting(true)
    setForgetFailed('')
    try {
      const { forgotten: n } = await hostedApi.admin.forgetFeedbackAi()
      setForgotten(n)
      setAsking(false)
      props.onForgotten()
    } catch (err) {
      setForgetFailed(messageOf(err))
    } finally {
      setForgetting(false)
    }
  }

  return (
    <section className="feedback-ai-panel" aria-label="AI help">
      <div className="feedback-ai-switch">
        <label className="check">
          <input type="checkbox" role="switch" checked={moving ?? known?.on ?? false} disabled={!known?.setUp || moving !== null} onChange={(e) => void move(e.target.checked)} /> AI help
        </label>
        <p role="status" className="feedback-ai-state">
          {status === 'failed' || (props.unreached && known) ? (
            'AI help could not be reached.'
          ) : !known ? (
            ''
          ) : !known.setUp ? (
            <>
              AI help is not set up: set <code>FEEDBACK_AI_KEY</code> for the review app.
            </>
          ) : known.on ? (
            `On: ${known.model}. ${known.callsToday.toLocaleString('en')} of ${known.dailyCalls.toLocaleString('en')} calls used today.`
          ) : (
            'Off. No message is sent to the AI.'
          )}
        </p>
        <button
          type="button"
          className="button small"
          onClick={() => {
            setForgetFailed('')
            setForgotten(null)
            setAsking(true)
          }}
        >
          Forget the AI’s results
        </button>
      </div>
      {refused && (
        <p role="alert" className="feedback-status failed">
          Not switched: {refused}
        </p>
      )}
      {forgotten !== null && (
        <p role="status" className="note">
          {count(forgotten, 'result')} forgotten.
        </p>
      )}
      <p className="note feedback-ai-privacy">{AI_PRIVACY_NOTE}</p>
      <Dialog open={asking} title="Forget the AI’s results" onClose={() => setAsking(false)} error={forgetFailed}>
        <p>Everything the AI wrote about the feedback is removed. Your marks and notes stay. It is made again as pages are read.</p>
        <span className="form-actions">
          <button type="button" className="button danger" disabled={forgetting} onClick={() => void forget()}>
            Forget them
          </button>
          <button type="button" className="button ghost" onClick={() => setAsking(false)}>
            Keep them
          </button>
        </span>
      </Dialog>
    </section>
  )
}
