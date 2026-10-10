import { useClientSnapshot } from '@wordado/client-data'
import { FEEDBACK_KINDS, FEEDBACK_TRAP_FIELD, MAX_FEEDBACK_EMAIL_LENGTH, MAX_FEEDBACK_MESSAGE_LENGTH, type FeedbackKind } from '@wordado/core'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { OfflineError } from '../account/api'
import { useApp } from '../app/context'
import { ProgressBar } from '../app/ProgressBar'
import { appVersion } from '../app/version'
import { errorMessageKey } from '../errors'
import { ENDONYM, useT, type MessageKey } from '../i18n/i18n'
import { Link, parseRoute } from '../router'
import { useOnline } from '../useOnline'

const KIND_LABEL: Readonly<Record<FeedbackKind, MessageKey>> = {
  bug: 'feedback.kind.bug',
  idea: 'feedback.kind.idea',
  other: 'feedback.kind.other',
}

/** Loose on purpose, as the server is: a person answers this address, and nothing is sent to it by itself. */
const EMAIL = /^[^\s@]+@[^\s@]+$/

/**
 * Feedback about the app itself (spec §8.12): what is broken, an idea, or anything else, signed in or not. A
 * screen of its own, opened from the masthead on any screen; `from` is the path of the screen it was opened on.
 * Sending needs a connection: nothing is queued, and what was typed stays in the form when a send fails. What
 * is sent beside the message is listed under the fields, so nothing leaves unseen. `version` is the app's
 * version, which tests set.
 */
export function Feedback(props: { readonly from?: string | undefined; readonly version?: string }) {
  const { t, locale } = useT()
  const { api, account } = useApp()
  const { packVersion, l1 } = useClientSnapshot()
  const online = useOnline()
  const messageId = useId()
  const messageErrorId = useId()
  const emailId = useId()
  const emailErrorId = useId()
  const detailsId = useId()
  const [kind, setKind] = useState<FeedbackKind>('bug')
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [messageError, setMessageError] = useState<MessageKey | null>(null)
  const [emailError, setEmailError] = useState<MessageKey | null>(null)
  const [formError, setFormError] = useState<MessageKey | null>(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const submitting = useRef(false)
  const thanks = useRef<HTMLParagraphElement>(null)

  // The thanks are announced and take focus once the message is sent (spec §11.1).
  useEffect(() => {
    if (sent) thanks.current?.focus()
  }, [sent])

  const version = props.version ?? appVersion()
  const corpusVersion = packVersion === null ? '' : `${l1}-${packVersion}`
  const screen = props.from ?? '/'
  const userAgent = navigator.userAgent

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (submitting.current) return
    const text = message.trim()
    const address = email.trim()
    setFormError(null)
    setMessageError(text === '' ? 'feedback.messageEmpty' : null)
    setEmailError(address !== '' && !EMAIL.test(address) ? 'signin.emailInvalid' : null)
    if (text === '' || (address !== '' && !EMAIL.test(address))) return
    submitting.current = true
    setSending(true)
    try {
      await api.sendFeedback({ kind, message: text, email: address, appVersion: version, corpusVersion, language: locale, screen, userAgent, website })
      setSent(true)
    } catch (err) {
      setFormError(err instanceof OfflineError ? 'feedback.offline' : errorMessageKey(err))
    } finally {
      submitting.current = false
      setSending(false)
    }
  }

  if (sent) {
    return (
      <section className="setup feedback-form" aria-labelledby="feedback-title">
        <div className="setup-head">
          <h1 id="feedback-title">{t('feedback.title')}</h1>
        </div>
        <div className="panel form-section">
          <p role="status" ref={thanks} tabIndex={-1}>
            {t('feedback.thanks')}
          </p>
          <div className="actions">
            <Link className="button primary" to={parseRoute(screen, '')}>
              {t('feedback.back')}
            </Link>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="setup feedback-form" aria-labelledby="feedback-title">
      <div className="setup-head">
        <h1 id="feedback-title">{t('feedback.title')}</h1>
      </div>
      {!online && <p className="note">{t('feedback.offline')}</p>}
      <div className="panel form-section">
        <form onSubmit={(event) => void submit(event)} noValidate>
          <p className="note">{t('feedback.intro')}</p>
          <fieldset className="choices">
            <legend>{t('feedback.kind')}</legend>
            {FEEDBACK_KINDS.map((value) => (
              <label key={value}>
                <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} />
                {t(KIND_LABEL[value])}
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor={messageId}>{t('feedback.message')}</label>
            <textarea
              id={messageId}
              value={message}
              rows={6}
              maxLength={MAX_FEEDBACK_MESSAGE_LENGTH}
              required
              aria-invalid={messageError !== null}
              aria-describedby={messageError !== null ? messageErrorId : undefined}
              onChange={(event) => setMessage(event.target.value)}
            />
            {messageError !== null && (
              <p className="field-error" role="alert" id={messageErrorId}>
                {t(messageError)}
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor={emailId}>{t('feedback.email')}</label>
            <input
              id={emailId}
              type="email"
              autoComplete="email"
              value={email}
              maxLength={MAX_FEEDBACK_EMAIL_LENGTH}
              aria-invalid={emailError !== null}
              aria-describedby={emailError !== null ? emailErrorId : undefined}
              onChange={(event) => setEmail(event.target.value)}
            />
            {emailError !== null && (
              <p className="field-error" role="alert" id={emailErrorId}>
                {t(emailError)}
              </p>
            )}
          </div>
          {/* No person sees or reaches this field; a program that fills in every field does (core's FEEDBACK_TRAP_FIELD). */}
          <div className="visually-hidden" aria-hidden="true">
            <label>
              Website
              <input type="text" name={FEEDBACK_TRAP_FIELD} tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} />
            </label>
          </div>
          <div className="feedback-details">
            <h2 id={detailsId}>{t('feedback.sentWith')}</h2>
            <ul aria-labelledby={detailsId}>
              {account !== null && <li>{t('feedback.account', { email: account.email })}</li>}
              <li>{t('feedback.appVersion', { version })}</li>
              <li>{corpusVersion === '' ? t('feedback.corpusNone') : t('feedback.corpusVersion', { version: corpusVersion })}</li>
              <li>{t('feedback.language', { language: `${ENDONYM[locale]} (${locale})` })}</li>
              <li>{t('feedback.screen', { screen })}</li>
              <li>{t('feedback.browser', { browser: userAgent })}</li>
            </ul>
          </div>
          {formError !== null && (
            <p className="form-error" role="alert">
              {t(formError)}
            </p>
          )}
          {sending && <ProgressBar label={t('feedback.sending')} />}
          <div className="actions">
            <button type="submit" className="button primary" disabled={sending}>
              {t('feedback.send')}
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
