import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import type { FeedbackDraftWhy, FeedbackTopicView } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { AI_WHY } from './AdminFeedbackAi'
import { count, messageOf } from './adminUtil'
import { issueNumber, issueUrl } from './issueUrl'

/** Where the draft stands: the AI is writing, it wrote one from so many messages, or there is none, with the line that says why and whether another try can help. */
type Draft = { readonly kind: 'writing' } | { readonly kind: 'written'; readonly messages: number } | { readonly kind: 'none'; readonly line: string; readonly again: boolean }

/** Why there is no draft, in one line, and whether asking again can give one. */
function noDraft(why: FeedbackDraftWhy, dailyCalls: number): { line: string; again: boolean } {
  if (why === 'quoted') return { line: 'The AI’s draft repeated a learner’s words and was dropped.', again: true }
  if (why === 'personal') return { line: 'The AI’s draft held an address, a link, a phone number or the name of an account, and was dropped.', again: true }
  if (why === 'limit') return { line: `Today’s limit of ${dailyCalls.toLocaleString('en')} AI calls is reached.`, again: false }
  if (why === 'off') return { line: 'AI help is off.', again: false }
  if (why === 'not-set-up') return { line: 'AI help is not set up.', again: false }
  if (why === 'no-messages') return { line: 'This topic has no messages left to write from.', again: false }
  return { line: `The AI wrote no draft this time (${AI_WHY[why]}).`, again: true }
}

/**
 * Draft an issue (spec 2026-10-10 §3.5): the AI writes a title and a text for a topic from its messages, in its
 * own words, and they open here in two fields the coordinator can change. Open on GitHub is a link to the
 * repository's new-issue page with what is in the fields now: the coordinator's own browser opens it, and they
 * file the issue under their own name. The review app writes nothing to GitHub. A text too long for a link is
 * copied instead. When the issue is filed, its number or its address is pasted here and becomes the topic's match.
 * The draft is kept nowhere: closing the dialog loses it.
 */
export function FeedbackDraftDialog(props: { open: boolean; topic: FeedbackTopicView; repo: string; dailyCalls: number; onClose(): void; onFiled(): void | Promise<void> }) {
  return (
    <Dialog open={props.open} title="Draft an issue" onClose={props.onClose}>
      <DraftForm {...props} />
    </Dialog>
  )
}

/** What the dialog holds. It exists only while the dialog is open, so every opening asks for a draft of its own. */
function DraftForm(props: { topic: FeedbackTopicView; repo: string; dailyCalls: number; onClose(): void; onFiled(): void | Promise<void> }) {
  const { topic, repo } = props
  const [draft, setDraft] = useState<Draft>({ kind: 'writing' })
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [copied, setCopied] = useState<'' | 'yes' | 'no'>('')
  const [filed, setFiled] = useState('')
  const [filing, setFiling] = useState(false)
  const [refused, setRefused] = useState('')
  // Only the answer to the latest question is taken, and none after the dialog is gone.
  const asked = useRef(0)

  /** One call to the AI. A draft takes the place of what is in the fields; no draft leaves them as they are. */
  const ask = useCallback(async () => {
    const mine = ++asked.current
    setDraft({ kind: 'writing' })
    try {
      const answer = await hostedApi.admin.draftFeedbackTopic(topic.id)
      if (mine !== asked.current) return
      if (!answer.ok) return setDraft({ kind: 'none', ...noDraft(answer.why, props.dailyCalls) })
      setTitle(answer.title)
      setBody(answer.body)
      setCopied('')
      setDraft({ kind: 'written', messages: answer.messages })
    } catch (err) {
      if (mine === asked.current) setDraft({ kind: 'none', line: `No draft: ${messageOf(err)}`, again: true })
    }
  }, [topic.id, props.dailyCalls])

  useEffect(() => {
    void ask()
    return () => void (asked.current += 1)
  }, [ask])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(body)
      setCopied('yes')
    } catch {
      setCopied('no')
    }
  }

  const file = async (e: FormEvent) => {
    e.preventDefault()
    const number = issueNumber(repo, filed)
    if (number === null) return setRefused(`That is not the number or the address of an issue${repo === '' ? '' : ` of ${repo}`}.`)
    setFiling(true)
    setRefused('')
    try {
      await hostedApi.admin.setFeedbackTopicIssue(topic.id, number)
      await props.onFiled()
      props.onClose()
    } catch (err) {
      setRefused(`Not kept: ${messageOf(err)}`)
      setFiling(false)
    }
  }

  const writing = draft.kind === 'writing'
  const link = repo === '' ? null : issueUrl(repo, title, body)
  return (
    <div className="draft">
      {writing && (
        <p role="status" className="note">
          The AI is writing a draft…
        </p>
      )}
      {draft.kind === 'none' && (
        <div className="draft-none">
          <p role="alert" className="dialog-error">
            {draft.line} Write the issue yourself{draft.again ? ', or try again' : ''}.
          </p>
          {draft.again && (
            <button type="button" className="button small" onClick={() => void ask()}>
              Try again
            </button>
          )}
        </div>
      )}
      {draft.kind === 'written' && <p className="note">Written by the AI from {count(draft.messages, 'message')}. Read it before you file it: it becomes public under your name.</p>}
      <label className="field">
        Title
        <input type="text" value={title} disabled={writing} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        Text
        <textarea
          rows={12}
          value={body}
          disabled={writing}
          onChange={(e) => {
            setBody(e.target.value)
            setCopied('')
          }}
        />
      </label>
      {!writing && (
        <div className="draft-open">
          {link !== null && !link.bodyInUrl && <p className="note">The text is too long for a link. Copy it, and paste it into the issue that opens.</p>}
          {link === null && (
            <p className="note">
              No repository is set (<code>APP_REPO</code>): copy the text, and open the issue yourself.
            </p>
          )}
          <span className="form-actions">
            {link !== null && (
              <a className="button primary" href={link.url} target="_blank" rel="noopener noreferrer">
                Open on GitHub
              </a>
            )}
            {(link === null || !link.bodyInUrl) && (
              <button type="button" className="button" onClick={() => void copy()}>
                Copy the text
              </button>
            )}
            {copied !== '' && (
              <span role="status" className={copied === 'yes' ? 'feedback-status' : 'feedback-status failed'}>
                {copied === 'yes' ? 'Copied.' : 'Not copied: select the text and copy it yourself.'}
              </span>
            )}
          </span>
        </div>
      )}
      <form className="draft-filed" aria-label="The filed issue" onSubmit={(e) => void file(e)}>
        <label className="field">
          When the issue is filed, paste its number or its address here
          <input
            type="text"
            placeholder="#94"
            value={filed}
            onChange={(e) => {
              setFiled(e.target.value)
              setRefused('')
            }}
          />
        </label>
        <button type="submit" className="button small" disabled={filing || filed.trim() === ''}>
          Save
        </button>
        {refused && (
          <p role="alert" className="feedback-status failed">
            {refused}
          </p>
        )}
      </form>
    </div>
  )
}
