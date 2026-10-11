import { ANNOUNCEMENT_LANGUAGES, MAX_ANNOUNCEMENT_BODY, MAX_ANNOUNCEMENT_SUBJECT, type AnnouncementKind, type AnnouncementLanguage, type AnnouncementText, type AnnouncementTexts } from '@wordado/core'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { announcementConfirmation, type Announcement, type AnnouncementLimits, type AnnouncementPreview } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { dayWithYear } from './AdminAccounts'
import { count, messageOf } from './adminUtil'

/** What the tab has of the announcements: nothing yet, that they are not connected, that they could not be read, or the list. */
type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unconnected' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'list'; readonly announcements: readonly Announcement[]; readonly limits: AnnouncementLimits }

const KIND_NAMES: Readonly<Record<AnnouncementKind, string>> = { service: 'Service notice', news: 'News' }
const STATUS_NAMES: Readonly<Record<Announcement['status'], string>> = { draft: 'Draft', sending: 'Sending', stopped: 'Stopped', sent: 'Sent' }
const LANGUAGE_NAMES: Readonly<Record<AnnouncementLanguage, string>> = { en: 'English', bg: 'Bulgarian', de: 'German', es: 'Spanish' }
/** English first: it is the one every announcement has. */
const LANGUAGE_ORDER: readonly AnnouncementLanguage[] = ['en', ...ANNOUNCEMENT_LANGUAGES.filter((l) => l !== 'en')]
const HELD_LINES: Readonly<Record<NonNullable<Announcement['held']>['reason'], string>> = {
  day: 'Today’s allowance of announcement mails is used: it goes on tomorrow (UTC).',
  quota: 'The mail service says its allowance is used up: it goes on when there is some again.',
  busy: 'The mail service is not taking mail now: it is tried again every 15 minutes.',
}

const n = (value: number): string => value.toLocaleString('en')

/** To how many it went and what became of the rest. What the counts do not add up to are accounts deleted before their turn. */
function progressOf(a: Announcement): string {
  const gone = a.recipients - a.sent - a.failed - a.skipped - a.queued
  return [
    `${n(a.sent)} of ${n(a.recipients)} sent`,
    ...(a.status !== 'sent' || a.queued > 0 ? [`${n(a.queued)} waiting`] : []),
    ...(a.failed > 0 ? [`${n(a.failed)} failed`] : []),
    ...(a.skipped > 0 ? [`${n(a.skipped)} skipped (consent withdrawn)`] : []),
    ...(gone > 0 ? [`${n(gone)} deleted before their turn`] : []),
  ].join(' · ')
}

/** When it started, stopped or finished. */
function datesOf(a: Announcement): string {
  if (a.finishedAt !== null) return `Finished ${dayWithYear(a.finishedAt)}`
  if (a.stoppedAt !== null) return `Stopped ${dayWithYear(a.stoppedAt)}`
  return a.startedAt === null ? '' : `Started ${dayWithYear(a.startedAt)}`
}

/**
 * The Announcements tab (#185): a mail to learners' account holders, written here and sent by the learner app's
 * server. Two kinds, kept apart: a service notice goes to every account holder; news goes only to the accounts
 * that agreed to it, each mail with a link that stops it. The list shows what was written and sent, when, and to
 * how many: counts only, nothing of an account. Sending cannot be taken back, so it is behind a test send of the
 * very version and a question answered by typing the kind and the number of accounts.
 */
export function AdminAnnouncements() {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' })
  // The announcement that is open: one of the list by its id, or a new one.
  const [open, setOpen] = useState<{ readonly id: number | null } | null>(null)
  const [failed, setFailed] = useState('')
  const [deleting, setDeleting] = useState<Announcement | null>(null)

  const load = useCallback(async () => {
    try {
      const view = await hostedApi.admin.announcements()
      setLoaded(view.connected ? { kind: 'list', announcements: view.announcements, limits: view.limits } : { kind: 'unconnected' })
    } catch (err) {
      setLoaded({ kind: 'failed', message: messageOf(err) })
    }
  }, [])
  useEffect(() => void load(), [load])

  /** Stop and Resume: done at once, and the list read again whatever came of it. */
  const act = async (action: () => Promise<unknown>) => {
    setFailed('')
    try {
      await action()
    } catch (err) {
      setFailed(messageOf(err))
    }
    await load()
  }

  if (loaded.kind === 'loading') return <p className="note">Loading…</p>
  if (loaded.kind === 'unconnected') {
    return (
      <p className="note">
        Announcements are not connected: set <code>ADMIN_WRITE_TOKEN</code> and <code>LEARNER_APP_URL</code> for the review app, then open this tab again.
      </p>
    )
  }
  if (loaded.kind === 'failed') {
    return (
      <div role="alert" className="notice feedback-failed">
        <p>The announcements could not be read. {loaded.message}</p>
        <button className="button small" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }
  const { announcements, limits } = loaded
  if (open) {
    const close = () => {
      setOpen(null)
      void load()
    }
    return <Editor key={open.id ?? 'new'} announcement={announcements.find((a) => a.id === open.id) ?? null} limits={limits} onClose={close} />
  }
  return (
    <>
      <p className="eyebrow">Announcements</p>
      <p className="note">
        A service notice goes to every account holder. News goes only to the accounts that agreed to news by email, each mail with a link to stop it. At most {n(limits.perDay)} announcement mails go out a day (
        {n(limits.sentToday)} so far today), {n(limits.batch)} every 15 minutes.
      </p>
      <p className="form-actions">
        <button className="button primary" onClick={() => setOpen({ id: null })}>
          New announcement
        </button>
        <button className="button ghost" onClick={() => void load()}>
          Refresh
        </button>
      </p>
      {failed && (
        <p role="alert" className="notice">
          {failed}
        </p>
      )}
      {announcements.length === 0 ? (
        <p className="note">No announcement has been written yet.</p>
      ) : (
        <ul className="settings-rows" aria-label="Announcements">
          {announcements.map((a) => (
            <li key={a.id} className="settings-row">
              <span className="settings-row-text">
                <span className="settings-row-title">
                  {a.texts.en.subject} <span className={`chip ${a.kind === 'news' ? 'minor' : 'major'}`}>{KIND_NAMES[a.kind]}</span> <span className={`chip ${a.status === 'sent' ? 'ok' : 'off'}`}>{STATUS_NAMES[a.status]}</span>
                </span>
                {a.status === 'draft' ? (
                  <span className="note">
                    Version {a.version} · {a.testedVersion === a.version ? 'test sent' : 'not sent as a test yet'}
                  </span>
                ) : (
                  <>
                    <span className="note">{progressOf(a)}</span>
                    <span className="note">{datesOf(a)}</span>
                  </>
                )}
                {a.status === 'sending' && a.held && <span className="note">{HELD_LINES[a.held.reason]}</span>}
              </span>
              <span className="row-actions">
                {a.status === 'sending' && (
                  <button className="button small danger" onClick={() => void act(() => hostedApi.admin.stopAnnouncement(a.id))}>
                    Stop sending
                  </button>
                )}
                {a.status === 'stopped' && (
                  <button className="button small" onClick={() => void act(() => hostedApi.admin.resumeAnnouncement(a.id))}>
                    Resume
                  </button>
                )}
                <button className="button small" onClick={() => setOpen({ id: a.id })}>
                  Open
                </button>
                {a.status === 'draft' && (
                  <button className="button small ghost" onClick={() => setDeleting(a)}>
                    Delete…
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {deleting && (
        <DeleteQuestion
          announcement={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            setDeleting(null)
            void load()
          }}
        />
      )}
    </>
  )
}

type Fields = Readonly<Record<AnnouncementLanguage, AnnouncementText>>

const EMPTY: AnnouncementText = { subject: '', body: '' }
const fieldsOf = (texts: AnnouncementTexts | null): Fields => ({ en: texts?.en ?? EMPTY, bg: texts?.bg ?? EMPTY, de: texts?.de ?? EMPTY, es: texts?.es ?? EMPTY })
/** What is sent to be saved: every language with something written. English always, so the server can say what it lacks. */
const textsOf = (fields: Fields): Partial<AnnouncementTexts> =>
  Object.fromEntries(LANGUAGE_ORDER.filter((l) => l === 'en' || fields[l].subject.trim() !== '' || fields[l].body.trim() !== '').map((l) => [l, { subject: fields[l].subject.trim(), body: fields[l].body.trim() }]))
const same = (a: Fields, b: Fields): boolean => LANGUAGE_ORDER.every((l) => a[l].subject.trim() === b[l].subject.trim() && a[l].body.trim() === b[l].body.trim())

/**
 * One announcement: written and changed while it is a draft, read once its sending has started. Under the texts,
 * the three steps before a send, in order: the preview (each language as it is mailed, and to how many), the test
 * send of this version to one address, and the send, which stays closed until that test went and nothing has been
 * changed since.
 */
function Editor(props: { announcement: Announcement | null; limits: AnnouncementLimits; onClose(): void }) {
  // What the server has: null until a new announcement is first saved.
  const [saved, setSaved] = useState<Announcement | null>(props.announcement)
  const [kind, setKind] = useState<AnnouncementKind>(props.announcement?.kind ?? 'service')
  const [fields, setFields] = useState<Fields>(() => fieldsOf(props.announcement?.texts ?? null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null)
  const [email, setEmail] = useState('')
  const [asking, setAsking] = useState(false)

  const draft = saved === null || saved.status === 'draft'
  const dirty = saved === null || kind !== saved.kind || !same(fields, fieldsOf(saved.texts))
  const tested = saved !== null && saved.testedVersion === saved.version

  const write = (language: AnnouncementLanguage, part: keyof AnnouncementText, value: string) => {
    setFields((f) => ({ ...f, [language]: { ...f[language], [part]: value } }))
    setStatus('')
  }

  /** Runs one request of the form: its failure is said above the buttons, and what was written stays. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError('')
    setStatus('')
    try {
      await action()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    if (!draft || busy) return
    void run(async () => {
      const { announcement } = await hostedApi.admin.saveAnnouncement({ id: saved?.id ?? null, kind, texts: textsOf(fields) })
      setSaved(announcement)
      setKind(announcement.kind)
      setFields(fieldsOf(announcement.texts))
      setPreview(null)
      setStatus(`Saved as version ${announcement.version}.`)
    })
  }

  const look = () =>
    void run(async () => {
      if (saved) setPreview(await hostedApi.admin.previewAnnouncement(saved.id))
    })

  const test = () =>
    void run(async () => {
      if (!saved) return
      const sent = await hostedApi.admin.testAnnouncement(saved.id, saved.version, email.trim())
      setSaved(sent.announcement)
      setStatus(`The test of version ${sent.announcement.version} was sent: ${count(sent.mails, 'mail')}. Read it before sending.`)
    })

  const why = dirty ? 'Save the changes first.' : tested ? '' : 'This version has not been sent as a test yet.'

  return (
    <>
      <p className="eyebrow">{saved === null ? 'New announcement' : `${KIND_NAMES[saved.kind]} · ${STATUS_NAMES[saved.status]}`}</p>
      {saved && !draft && (
        <p className="note">
          {progressOf(saved)}. {datesOf(saved)}. Its sending has started, so it cannot be changed or sent again.
        </p>
      )}
      <form aria-label="Announcement" className="form announcement" onSubmit={save}>
        <fieldset className="announcement-kind" disabled={!draft}>
          <legend>Kind</legend>
          <label className="check">
            <input type="radio" name="announcement-kind" checked={kind === 'service'} onChange={() => setKind('service')} />
            <span>
              <b>Service notice</b>: to every account holder. For what is part of the service: changed terms, planned downtime, a shutdown.
            </span>
          </label>
          <label className="check">
            <input type="radio" name="announcement-kind" checked={kind === 'news'} onChange={() => setKind('news')} />
            <span>
              <b>News</b>: only to the accounts that agreed to news by email. Every mail carries a link that stops it.
            </span>
          </label>
        </fieldset>
        {LANGUAGE_ORDER.map((language) => (
          <fieldset key={language} className="announcement-text">
            <legend>{language === 'en' ? 'English (needed)' : LANGUAGE_NAMES[language]}</legend>
            <label className="field">
              Subject
              <input type="text" lang={language} autoComplete="off" maxLength={MAX_ANNOUNCEMENT_SUBJECT} readOnly={!draft} required={language === 'en'} value={fields[language].subject} onChange={(e) => write(language, 'subject', e.target.value)} />
            </label>
            <label className="field">
              Text
              <textarea lang={language} rows={8} maxLength={MAX_ANNOUNCEMENT_BODY} readOnly={!draft} required={language === 'en'} value={fields[language].body} onChange={(e) => write(language, 'body', e.target.value)} />
            </label>
          </fieldset>
        ))}
        {draft && (
          <p className="note">
            Plain text: a link is its address written out. An account gets the text in its own language where there is one, and the English one otherwise. Why the mail came, and who sent it, is added under the text.
          </p>
        )}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
        {status && (
          <p role="status" className="note">
            {status}
          </p>
        )}
        <span className="form-actions">
          {draft && (
            <button type="submit" className="button primary" disabled={busy || !dirty}>
              Save draft
            </button>
          )}
          <button type="button" className="button" disabled={busy || saved === null || (draft && dirty)} onClick={look}>
            Preview
          </button>
          <button type="button" className="button ghost" onClick={props.onClose}>
            Back to the list
          </button>
        </span>
        {preview && <Preview preview={preview} />}
        {draft && (
          <>
            <p className="eyebrow">Test send</p>
            <label className="field">
              Send a test to
              <input type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <span className="form-actions">
              <button type="button" className="button" disabled={busy || dirty || email.trim() === ''} onClick={test}>
                Send test
              </button>
            </span>
            <p className="note">Every language of this version goes to that one address, as the real mails are made. The address is kept nowhere.</p>
            <p className="eyebrow">Send</p>
            {why && <p className="note">{why}</p>}
            <span className="form-actions">
              <button type="button" className="button danger" disabled={busy || dirty || !tested} onClick={() => setAsking(true)}>
                Send…
              </button>
            </span>
          </>
        )}
      </form>
      {asking && saved && <SendQuestion announcement={saved} limits={props.limits} onClose={() => setAsking(false)} onDone={props.onClose} />}
    </>
  )
}

/** To how many accounts, by the language of the mail each gets: "English 2, Bulgarian 1". */
const byLanguage = (preview: AnnouncementPreview): string =>
  LANGUAGE_ORDER.flatMap((l) => (preview.byLanguage[l] ? [`${LANGUAGE_NAMES[l]} ${n(preview.byLanguage[l])}`] : [])).join(', ')

/** Each language as it is mailed, footer and all. */
function Preview(props: { preview: AnnouncementPreview }) {
  const { preview } = props
  return (
    <section aria-label="Preview" className="announcement-preview">
      <p className="note">
        It would go to {count(preview.recipients, 'account')} now{preview.recipients > 0 ? `: ${byLanguage(preview)}` : ''}.
      </p>
      {preview.mails.map((mail) => (
        <article key={mail.language} lang={mail.language} className="announcement-mail">
          <p className="eyebrow" lang="en">
            {LANGUAGE_NAMES[mail.language]}
          </p>
          <p>
            <b>{mail.subject}</b>
          </p>
          <pre>{mail.text}</pre>
        </article>
      ))}
    </section>
  )
}

/**
 * The question before a send: the kind and the number of accounts, read from the server as the question opens,
 * and both typed out to answer it. The server is told that kind and that number, and starts nothing if either is
 * no longer so; the count is then read again, and has to be typed again.
 */
function SendQuestion(props: { announcement: Announcement; limits: AnnouncementLimits; onClose(): void; onDone(): void }) {
  const { announcement: a, limits } = props
  const [preview, setPreview] = useState<AnnouncementPreview | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const recount = useCallback(async () => {
    try {
      setPreview(await hostedApi.admin.previewAnnouncement(a.id))
    } catch (err) {
      setError(messageOf(err))
    }
  }, [a.id])
  useEffect(() => void recount(), [recount])

  const phrase = preview ? announcementConfirmation(preview.kind, preview.recipients) : ''
  const ready = preview !== null && preview.version === a.version && preview.recipients > 0 && typed.trim() === phrase

  const confirm = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready || busy || !preview) return
    setBusy(true)
    setError('')
    try {
      await hostedApi.admin.sendAnnouncement({ id: a.id, version: a.version, kind: preview.kind, recipients: preview.recipients, confirm: typed.trim() })
      props.onDone()
    } catch (err) {
      setError(messageOf(err))
      setTyped('')
      setBusy(false)
      await recount()
    }
  }

  return (
    <Dialog open title="Send this announcement?" onClose={props.onClose} error={error}>
      {preview === null ? (
        <p className="note">Counting the accounts…</p>
      ) : (
        <form className="form" onSubmit={(e) => void confirm(e)}>
          <p>
            <b>{a.texts.en.subject}</b>
          </p>
          <p>
            {preview.kind === 'service' ? 'A service notice' : 'News'}, to {count(preview.recipients, 'account')}.
          </p>
          {preview.recipients > 0 && <p className="note">{byLanguage(preview)}</p>}
          <p>
            {preview.kind === 'service'
              ? 'It goes to every account holder, whatever they said about news, and carries no way to unsubscribe.'
              : 'It goes only to the accounts that agreed to news by email; who withdraws before their mail goes gets none.'}{' '}
            A mail that has gone cannot be taken back, and this announcement cannot be changed or sent again. Accounts made after this moment do not get it.
          </p>
          <p className="note">
            At most {n(limits.perDay)} mails go out a day, {n(limits.batch)} every 15 minutes: the list shows how far it is, and it can be stopped there.
          </p>
          <label className="field">
            Type {phrase} to send
            <input type="text" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
          </label>
          <span className="form-actions">
            <button type="submit" className="button danger" disabled={!ready || busy}>
              Send to {count(preview.recipients, 'account')}
            </button>
            <button type="button" className="button ghost" onClick={props.onClose}>
              Cancel
            </button>
          </span>
        </form>
      )}
    </Dialog>
  )
}

/** The question before a draft is deleted. Only a draft can be: what was sent stays as the record of it. */
function DeleteQuestion(props: { announcement: Announcement; onClose(): void; onDone(): void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await hostedApi.admin.deleteAnnouncement(props.announcement.id)
      props.onDone()
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }
  return (
    <Dialog open title="Delete this draft?" onClose={props.onClose} error={error}>
      <p>
        <b>{props.announcement.texts.en.subject}</b>
      </p>
      <p>It was sent to nobody. What is written in it goes with it.</p>
      <span className="form-actions">
        <button type="button" className="button danger" disabled={busy} onClick={() => void confirm()}>
          Delete the draft
        </button>
        <button type="button" className="button ghost" onClick={props.onClose}>
          Cancel
        </button>
      </span>
    </Dialog>
  )
}
