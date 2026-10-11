import { useEffect, useId, useRef, useState } from 'react'
import { FEEDBACK_CATEGORIES, type FeedbackAiWhy, type FeedbackWeek } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AI_WHY } from './AdminFeedbackAi'
import { count } from './adminUtil'
import { CATEGORY_LABEL } from './FeedbackCard'

/** The one line for a paragraph that was not written. Nothing for a reason that is no failure. */
function noParagraphLine(why: FeedbackAiWhy | null, dailyCalls: number): string {
  if (why === 'limit') return `Today’s limit of ${dailyCalls.toLocaleString('en')} AI calls is reached: nothing is written about the week.`
  if (why === 'unreachable' || why === 'late' || why === 'refused' || why === 'unfit') return `The AI wrote nothing about the week this time (${AI_WHY[why]}).`
  return ''
}

/**
 * The week at the top of the Feedback tab (spec 2026-10-10 §3.4): how many messages of the last seven days the AI
 * read, by its category; the topics with the most messages; the bugs it reads as blocking; the new topics; and a
 * few sentences the AI wrote from those numbers and titles alone. The numbers come from the review app's own
 * database; they are read again when `version` changes. It is there only when the AI has read something of the
 * week. With no paragraph kept and the help on, it is asked for once; when that fails the numbers stay, with one
 * line. `onTopic` opens a topic in the By topic view.
 */
export function AdminFeedbackWeek(props: { aiOn: boolean; dailyCalls: number; version: number; onTopic(id: number): void }) {
  const { aiOn, version } = props
  const [week, setWeek] = useState<FeedbackWeek | null>(null)
  // The paragraph this visit asked for: the numbers may be read again before the server gives it with them.
  const [written, setWritten] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)
  const [why, setWhy] = useState<FeedbackAiWhy | null>(null)
  // Only the answer to the latest read is shown; the paragraph is asked for once in a visit.
  const reads = useRef(0)
  const asked = useRef(false)

  useEffect(() => {
    const mine = ++reads.current
    // A failure is not the tab's: the week is left out, or stays as it was last read.
    void hostedApi.admin.feedbackWeek().then(
      (found) => void (mine === reads.current && setWeek(found)),
      () => undefined,
    )
  }, [version])

  const wanted = aiOn && week !== null && week.read > 0 && week.paragraph === null
  useEffect(() => {
    if (!wanted || asked.current) return
    asked.current = true
    setWriting(true)
    void hostedApi.admin
      .feedbackWeekParagraph()
      .then(
        (answer) => (setWritten(answer.paragraph), setWhy(answer.paragraph === null ? answer.why : null)),
        () => setWhy('unreachable'),
      )
      .finally(() => setWriting(false))
  }, [wanted])

  if (week === null || week.read === 0) return null
  const paragraph = week.paragraph ?? written
  const failed = noParagraphLine(why, props.dailyCalls)
  return (
    <section className="feedback-week" aria-label="This week">
      {paragraph !== null && (
        <div className="feedback-week-text">
          <p className="feedback-ai-label">Written by the AI</p>
          <p className="feedback-week-paragraph">{paragraph}</p>
        </div>
      )}
      {paragraph === null && writing && (
        <p role="status" className="note">
          The AI is writing about the week…
        </p>
      )}
      {paragraph === null && !writing && failed !== '' && (
        <p role="status" className="note">
          {failed}
        </p>
      )}
      <p className="feedback-week-read">{count(week.read, 'message')} read by the AI in the last 7 days</p>
      <ul className="feedback-week-counts" aria-label="By the AI’s category">
        {FEEDBACK_CATEGORIES.map((category) => (
          <li key={category}>
            {CATEGORY_LABEL[category]} <strong>{week.byCategory[category].toLocaleString('en')}</strong>
          </li>
        ))}
      </ul>
      <div className="feedback-week-lists">
        <WeekList title="Most messages" topics={week.topTopics} onTopic={props.onTopic} />
        <WeekList title="Blocking bugs" topics={week.blocking} onTopic={props.onTopic} />
        <WeekList title="New topics" topics={week.newTopics} onTopic={props.onTopic} />
      </div>
    </section>
  )
}

/** One of the week's lists of topics, each with its count when it has one. A topic opens in the By topic view; what is in no topic has nowhere to open. */
function WeekList(props: { title: string; topics: readonly { readonly id: number | null; readonly title: string; readonly count?: number }[]; onTopic(id: number): void }) {
  const id = useId()
  if (props.topics.length === 0) return null
  return (
    <div className="feedback-week-list">
      <h3 id={id}>{props.title}</h3>
      <ul aria-labelledby={id}>
        {props.topics.map((topic) => (
          <li key={topic.id ?? 'none'}>
            {topic.id === null ? (
              <span>{topic.title}</span>
            ) : (
              <button type="button" className="feedback-week-topic" onClick={() => props.onTopic(topic.id!)}>
                {topic.title}
              </button>
            )}
            {topic.count !== undefined && (
              <>
                {' '}
                <strong>{topic.count.toLocaleString('en')}</strong>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
