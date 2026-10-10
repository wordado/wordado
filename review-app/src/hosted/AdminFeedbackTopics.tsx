import { type FormEvent, useCallback, useId, useRef, useState } from 'react'
import { type FeedbackState, type FeedbackStateFilter, type FeedbackTopicOpened, type FeedbackTopicView, MAX_FEEDBACK_NOTE_LENGTH, MAX_TOPIC_TITLE_LENGTH } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { count, dateOf, messageOf } from './adminUtil'
import { FeedbackCard, IDLE, SaveStatus, type Saving, SEVERITY_CHIP, SEVERITY_LABEL, STATES } from './FeedbackCard'

const SHOWN: Readonly<Record<FeedbackStateFilter, readonly FeedbackState[]>> = { open: ['new', 'seen'], all: ['new', 'seen', 'done', 'declined'], done: ['done'], declined: ['declined'] }
const STATE_LABEL: Readonly<Record<FeedbackState, string>> = Object.fromEntries(STATES) as Record<FeedbackState, string>
const STATE_CHIP: Readonly<Record<FeedbackState, string>> = { new: 'chip', seen: 'chip off', done: 'chip ok', declined: 'chip off' }

/**
 * The Feedback tab by topic (spec 2026-10-10 §3.2, §3.3): one line for each thing the feedback is about, with how
 * many messages it has, its newest one, its worst severity, its state, and the known issue it looks like. The AI
 * makes the topics and proposes the matches; what is done with them here is the coordinator's. `topics` is null
 * while they are not known yet and 'failed' when they could not be read; `show` is the tab's filter by state, here
 * of the topics' own; `repo` is where an issue's number links to. After every change `onChanged` reads them again.
 */
export function AdminFeedbackTopics(props: { topics: readonly FeedbackTopicView[] | null | 'failed'; show: FeedbackStateFilter; aiOn: boolean; repo: string; onChanged(): void | Promise<void> }) {
  const { topics } = props
  if (topics === null) {
    return (
      <div className="busy-bar" role="progressbar" aria-label="Loading topics">
        <span />
      </div>
    )
  }
  if (topics === 'failed') {
    return (
      <div role="alert" className="notice feedback-failed">
        <p>The topics could not be read.</p>
        <button className="button small" onClick={() => void props.onChanged()}>
          Try again
        </button>
      </div>
    )
  }
  if (topics.length === 0) return <p className="note">{props.aiOn ? 'No topics yet. The AI makes them as it reads the messages.' : 'Topics are made by the AI help, which is off.'}</p>
  const shown = topics.filter((topic) => SHOWN[props.show].includes(topic.state))
  if (shown.length === 0) return <p className="note">Nothing here to show.</p>
  return (
    <>
      <p className="eyebrow">
        {count(shown.length, 'topic')}
        {topics.length > shown.length ? ` of ${topics.length.toLocaleString('en')}` : ''}
      </p>
      <ul className="topic-list" aria-label="Topics">
        {shown.map((topic) => (
          <TopicLine key={topic.id} topic={topic} topics={topics} repo={props.repo} onChanged={props.onChanged} />
        ))}
      </ul>
    </>
  )
}

/** What a topic's messages are: not asked for, on their way, read, or not read with the reason. */
type Opened = { readonly kind: 'closed' } | { readonly kind: 'loading' } | { readonly kind: 'read'; readonly topic: FeedbackTopicOpened; readonly version: number } | { readonly kind: 'failed'; readonly message: string }

/** An issue's number, as a link to it in the app's repository when one is set. */
function IssueLink(props: { repo: string; issue: number; title: string | null; children: string }) {
  if (props.repo === '') return <span>{props.children}</span>
  return (
    <a className="row-link" href={`https://github.com/${props.repo}/issues/${props.issue}`} target="_blank" rel="noreferrer" {...(props.title ? { title: props.title } : {})}>
      {props.children}
    </a>
  )
}

/** One topic: its line, and, opened, what the coordinator can do with it and its messages. */
function TopicLine(props: { topic: FeedbackTopicView; topics: readonly FeedbackTopicView[]; repo: string; onChanged(): void | Promise<void> }) {
  const { topic } = props
  const id = useId()
  const [opened, setOpened] = useState<Opened>({ kind: 'closed' })
  // Only the answer to the latest read is shown.
  const asked = useRef(0)
  const versions = useRef(0)
  const [matching, setMatching] = useState<Saving>(IDLE)

  /** Reads the topic's messages: one request, each time it is opened, and again after its messages were marked. */
  const read = useCallback(
    async (quiet = false) => {
      const mine = ++asked.current
      if (!quiet) setOpened({ kind: 'loading' })
      try {
        const found = await hostedApi.admin.feedbackTopic(topic.id)
        if (mine === asked.current) setOpened({ kind: 'read', topic: found, version: ++versions.current })
      } catch (err) {
        if (mine === asked.current) setOpened({ kind: 'failed', message: messageOf(err) })
      }
    },
    [topic.id],
  )

  const toggle = () => {
    if (opened.kind === 'closed') return void read()
    asked.current += 1
    setOpened({ kind: 'closed' })
  }

  /** The coordinator's answer on the match: a number confirms, null removes. */
  const match = async (issue: number | null): Promise<boolean> => {
    setMatching({ kind: 'busy' })
    try {
      await hostedApi.admin.setFeedbackTopicIssue(topic.id, issue)
      await props.onChanged()
      setMatching(IDLE)
      return true
    } catch (err) {
      setMatching({ kind: 'failed', message: messageOf(err) })
      return false
    }
  }

  /** A message was moved to another topic from its card: it is no longer among this topic's. */
  const moved = (messageId: number) => {
    setOpened((now) => (now.kind === 'read' ? { ...now, topic: { ...now.topic, items: now.topic.items.filter((item) => item.id !== messageId) } } : now))
    void props.onChanged()
  }

  const newest = topic.newestAt === null ? null : new Date(topic.newestAt).toISOString()
  return (
    <li className="topic-item">
      <article aria-labelledby={`${id}-title`}>
        <div className="topic-line">
          <h3 id={`${id}-title`} className="topic-title">
            <button type="button" className="topic-open" aria-expanded={opened.kind !== 'closed'} aria-controls={`${id}-body`} onClick={toggle}>
              {topic.title}
            </button>
          </h3>
          <p className="topic-meta">
            <span>{count(topic.count, 'message')}</span>
            {newest && <time dateTime={newest}>{dateOf(newest)}</time>}
            {topic.worst && <span className={SEVERITY_CHIP[topic.worst]}>{SEVERITY_LABEL[topic.worst]}</span>}
            <span className={STATE_CHIP[topic.state]}>{STATE_LABEL[topic.state]}</span>
          </p>
          {topic.issue !== null && topic.issueState === 'proposed' && (
            <p className="topic-match">
              <IssueLink repo={props.repo} issue={topic.issue} title={topic.issueTitle}>{`looks like #${topic.issue}`}</IssueLink>
              <button type="button" className="button small" disabled={matching.kind === 'busy'} onClick={() => void match(topic.issue)}>
                Confirm
              </button>
              <button type="button" className="button small ghost" disabled={matching.kind === 'busy'} onClick={() => void match(null)}>
                Remove
              </button>
            </p>
          )}
          {topic.issue !== null && topic.issueState === 'confirmed' && (
            <p className="topic-match">
              Issue <IssueLink repo={props.repo} issue={topic.issue} title={topic.issueTitle}>{`#${topic.issue}`}</IssueLink>
            </p>
          )}
          {matching.kind === 'failed' && (
            <p role="alert" className="feedback-status failed">
              Not kept: {matching.message}
            </p>
          )}
        </div>
        <div id={`${id}-body`} className="topic-body" hidden={opened.kind === 'closed'}>
          {opened.kind === 'loading' && (
            <div className="busy-bar" role="progressbar" aria-label="Loading the topic’s messages">
              <span />
            </div>
          )}
          {opened.kind === 'failed' && (
            <div role="alert" className="notice feedback-failed">
              <p>The messages could not be read. {opened.message}</p>
              <button className="button small" onClick={() => void read()}>
                Try again
              </button>
            </div>
          )}
          {opened.kind === 'read' && (
            <>
              <TopicTools topic={topic} topics={props.topics} match={match} onChanged={props.onChanged} onMarked={() => void read(true)} />
              {opened.topic.incomplete && <p className="note">Some messages may be missing here: the app’s server does not give messages by their ids yet.</p>}
              {opened.topic.items.length === 0 && <p className="note">No messages to show.</p>}
              <ul className="feedback-list" aria-label="Messages of the topic">
                {opened.topic.items.map((item) => (
                  <FeedbackCard key={`${opened.version}-${item.id}`} item={item} topics={props.topics} onMoved={moved} />
                ))}
              </ul>
              {opened.topic.more > 0 && <p className="note">and {count(opened.topic.more, 'older message')}, not shown here.</p>}
            </>
          )}
        </div>
      </article>
    </li>
  )
}

/** What the coordinator does with an opened topic: rename it, merge it into another, mark it and note it as a
 * message is marked, and give it the number of a known issue. A save sends the title, the state and the note
 * together, each as it was last saved but for the one that changed. */
function TopicTools(props: { topic: FeedbackTopicView; topics: readonly FeedbackTopicView[]; match(issue: number | null): Promise<boolean>; onChanged(): void | Promise<void>; onMarked(): void }) {
  const { topic } = props
  // The topic as the server last confirmed it; the saves go one after another, each building on the answer before.
  const saved = useRef<{ readonly title: string; readonly state: FeedbackState; readonly note: string }>({ title: topic.title, state: topic.state, note: topic.note })
  const queue = useRef<Promise<void>>(Promise.resolve())
  const [savedNote, setSavedNote] = useState(topic.note)
  const [chosen, setChosen] = useState(topic.state)
  const [draft, setDraft] = useState(topic.note)
  const [stateSaving, setStateSaving] = useState<Saving>(IDLE)
  const [noteSaving, setNoteSaving] = useState<Saving>(IDLE)
  const [marked, setMarked] = useState(0)
  // Renaming: null while the title is not a field.
  const [title, setTitle] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<Saving>(IDLE)
  // The topic chosen to merge into, while the dialog asks.
  const [into, setInto] = useState<FeedbackTopicView | null>(null)
  const [merging, setMerging] = useState(false)
  const [mergeFailed, setMergeFailed] = useState('')
  // The issue's number as typed; it follows the topic's own when that changes.
  const [issue, setIssue] = useState(topic.issue === null ? '' : String(topic.issue))
  const [issueOf, setIssueOf] = useState(topic.issue)
  const [issueWrong, setIssueWrong] = useState(false)
  if (issueOf !== topic.issue) {
    setIssueOf(topic.issue)
    setIssue(topic.issue === null ? '' : String(topic.issue))
  }
  const others = props.topics.filter((t) => t.id !== topic.id)

  const save = (change: { title: string } | { state: FeedbackState } | { note: string }, say: (saving: Saving) => void, refused: () => void, kept: () => void = () => undefined) => {
    say({ kind: 'busy' })
    queue.current = queue.current.then(async () => {
      try {
        const answer = await hostedApi.admin.putFeedbackTopic(topic.id, { ...saved.current, ...change })
        saved.current = { title: answer.topic.title, state: answer.topic.state, note: answer.topic.note }
        setSavedNote(answer.topic.note)
        setMarked(answer.marked)
        say({ kind: 'saved' })
        kept()
        await props.onChanged()
        // Its messages were marked with it: they are shown as they are now.
        if (answer.marked > 0) props.onMarked()
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

  const rename = (e: FormEvent) => {
    e.preventDefault()
    if (title === null) return
    // Refused: the field stays, with what was typed and the reason.
    save({ title: title.trim() }, setRenaming, () => undefined, () => (setTitle(null), setRenaming(IDLE)))
  }

  const merge = async () => {
    if (!into) return
    setMerging(true)
    setMergeFailed('')
    try {
      await hostedApi.admin.mergeFeedbackTopic(topic.id, into.id)
      setInto(null)
      // This topic is gone with the next list.
      await props.onChanged()
    } catch (err) {
      setMergeFailed(messageOf(err))
    } finally {
      setMerging(false)
    }
  }

  const saveIssue = async (e: FormEvent) => {
    e.preventDefault()
    const typed = issue.trim()
    const number = /^#?[1-9]\d{0,8}$/.test(typed) ? Number(typed.replace('#', '')) : null
    setIssueWrong(typed !== '' && number === null)
    if (typed !== '' && number === null) return
    await props.match(number)
  }

  return (
    <div className="topic-tools">
      {title === null ? (
        <div className="topic-tool">
          <button
            type="button"
            className="button small"
            onClick={() => {
              setRenaming(IDLE)
              setTitle(saved.current.title)
            }}
          >
            Rename
          </button>
        </div>
      ) : (
        <form className="topic-tool topic-rename" aria-label="Rename the topic" onSubmit={rename}>
          <label className="field">
            Title
            <input type="text" value={title} maxLength={MAX_TOPIC_TITLE_LENGTH} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <span className="form-actions">
            <button type="submit" className="button small" disabled={renaming.kind === 'busy' || title.trim() === ''}>
              Save
            </button>
            <button type="button" className="button small ghost" onClick={() => setTitle(null)}>
              Cancel
            </button>
          </span>
          {renaming.kind === 'failed' && (
            <p role="alert" className="feedback-status failed">
              Not renamed: {renaming.message}
            </p>
          )}
        </form>
      )}
      {others.length > 0 && (
        <label className="field topic-tool topic-merge">
          Merge into…
          <select
            value=""
            onChange={(e) => {
              setMergeFailed('')
              setInto(others.find((t) => String(t.id) === e.target.value) ?? null)
            }}
          >
            <option value="">Choose a topic</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
      )}
      <form className="topic-tool topic-issue" aria-label="The topic’s issue" onSubmit={(e) => void saveIssue(e)}>
        <label className="field">
          Issue number
          <input
            type="text"
            inputMode="numeric"
            placeholder="#94"
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value)
              setIssueWrong(false)
            }}
          />
        </label>
        <span className="form-actions">
          <button type="submit" className="button small" disabled={issue.trim() === (topic.issue === null ? '' : String(topic.issue))}>
            Save issue
          </button>
        </span>
        {issueWrong && (
          <p role="alert" className="feedback-status failed">
            Type the number of an issue, such as 94.
          </p>
        )}
      </form>
      <form className="feedback-mark topic-mark" aria-label="The topic’s mark" onSubmit={saveNote}>
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
          {marked > 0 && (
            <span role="status" className="feedback-status">
              {count(marked, 'message')} marked done.
            </span>
          )}
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
      <Dialog open={into !== null} title="Merge topics" onClose={() => setInto(null)} error={mergeFailed}>
        <p>
          The {count(topic.count, 'message')} of “{topic.title}” go to “{into?.title}”, with its note. “{topic.title}” is then gone. This cannot be undone.
        </p>
        <span className="form-actions">
          <button type="button" className="button danger" disabled={merging} onClick={() => void merge()}>
            Merge
          </button>
          <button type="button" className="button ghost" onClick={() => setInto(null)}>
            Keep both
          </button>
        </span>
      </Dialog>
    </div>
  )
}
