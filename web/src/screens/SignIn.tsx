import { useClient } from '@wordado/client-data'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, OfflineError } from '../account/api'
import { consentAge } from '../account/ageGate'
import { countryOptions } from '../account/countries'
import { pendingSignIn, type PendingSignIn } from '../account/storage'
import { useApp } from '../app/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

type Step =
  | { readonly kind: 'gate' }
  | { readonly kind: 'too-young'; readonly age: number }
  | { readonly kind: 'method' }
  | { readonly kind: 'code'; readonly email: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A failure from the server, as the learner reads it (plan 5: a 429 with `sign_in_email_limit` sent no code). */
function failureKey(err: unknown, fallback: MessageKey): MessageKey {
  if (err instanceof OfflineError) return 'signin.offline'
  if (err instanceof ApiError && err.status === 429) return err.code === 'sign_in_email_limit' ? 'signin.limit' : 'signin.tooMany'
  return fallback
}

/** One labelled field with its hint and its error tied to it (spec §11.1). */
function Field(props: {
  readonly label: string
  readonly hint?: string
  readonly error: string | null
  readonly children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.hint && (
        <p className="note" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.children({ id, describedBy, invalid: props.error !== null })}
      {props.error && (
        <p className="field-error" role="alert" id={errorId}>
          {props.error}
        </p>
      )}
    </div>
  )
}

/** The wizard's steps, as its counter numbers them. */
const STEP_NUMBER = { gate: 1, method: 2, code: 3 } as const

/**
 * Sign-in and sign-up are one flow (spec §8.6), as a wizard in the first-run
 * setup's look: the age gate (spec §11), then a code by email or Google, then
 * the code. The server creates the account at the first sign-in, so the gate
 * comes first every time. The gate asks where the learner lives and that they
 * are at least the age it sets; only the country is kept, and no birth date is
 * asked. The native language is asked by the first-run setup, right after
 * sign-up (plan 11), not here.
 */
export function SignIn(props: { readonly redirect?: (url: string) => void; readonly pending?: { save(p: PendingSignIn): void } }) {
  const { t, locale } = useT()
  const { api, accounts, account } = useApp()
  const client = useClient()
  const online = useOnline()
  const [step, setStep] = useState<Step>({ kind: 'gate' })
  const [country, setCountry] = useState<string | null>(null)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<MessageKey | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const countries = useMemo(() => countryOptions(locale), [locale])
  const redirect = props.redirect ?? ((url: string) => window.location.assign(url))
  const pending = props.pending ?? pendingSignIn()
  // A ref, not state: the pre-fill effect below must see the learner's own choice made after
  // this render started, not the `false` its closure was created with (fix round 1, #1).
  const countryTouched = useRef(false)
  // Whether signing in to an account with progress would discard anything: the controller's own test
  // (`Client.hasUnsynced`), so the warning shows exactly when the demo would be deleted with something in it.
  const [demoHasProgress, setDemoHasProgress] = useState(false)
  useEffect(() => {
    if (account !== null) return
    let live = true
    client.hasUnsynced().then(
      (unsynced) => {
        if (live) setDemoHasProgress(unsynced)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [client, account])

  // Pre-filled from the request's country (spec §11), unless the learner has already chosen.
  useEffect(() => {
    let live = true
    api.requestCountry().then(
      (found) => {
        if (live && !countryTouched.current && found !== null) setCountry(found)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [api])

  // Each step's heading takes focus, as a new page would (spec §11.1).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [step.kind])

  const reset = () => {
    setFieldError(null)
    setFormError(null)
    setInfo(null)
  }

  const age = consentAge(country)
  const submitGate = (event: FormEvent) => {
    event.preventDefault()
    reset()
    if (ageConfirmed) setStep({ kind: 'method' })
  }

  const requestCode = async (address: string): Promise<boolean> => {
    setBusy(true)
    try {
      await api.sendCode(address)
      return true
    } catch (err) {
      setFormError(t(failureKey(err, 'signin.failed')))
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault()
    reset()
    const address = email.trim()
    if (!EMAIL.test(address)) {
      setFieldError('signin.emailInvalid')
      return
    }
    if (await requestCode(address)) setStep({ kind: 'code', email: address })
  }

  const google = async () => {
    reset()
    setBusy(true)
    try {
      pending.save({ country })
      const origin = window.location.origin
      redirect(await api.googleUrl(`${origin}/?signin=google`, `${origin}/?signin=google-error`))
    } catch (err) {
      setFormError(t(err instanceof OfflineError ? 'signin.offline' : 'signin.googleFailed'))
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'code') return
    reset()
    const digits = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(digits)) {
      setFieldError('signin.codeInvalid')
      return
    }
    setBusy(true)
    setVerifying(true)
    try {
      await api.verifyCode(step.email, digits)
    } catch (err) {
      // Only 400/401/403 mean the code itself was wrong; anything else (5xx, a
      // malformed response) is a server fault, not the learner's mistake, and
      // 429/offline keep their own messages (fix round 1, #2).
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403)) {
        setFieldError('signin.codeWrong')
      } else {
        setFormError(t(failureKey(err, 'signin.failed')))
      }
      setBusy(false)
      setVerifying(false)
      return
    }
    try {
      const outcome = await accounts.completeSignIn(country)
      if (outcome === 'other-account') {
        setFormError(t('signin.otherAccount', { email: account?.email ?? '' }))
        setBusy(false)
        setVerifying(false)
        return
      }
      navigate({ name: 'home' }, { replace: true })
    } catch (err) {
      setFormError(t(failureKey(err, 'signin.failed')))
      setBusy(false)
      setVerifying(false)
    }
  }

  const resend = async () => {
    if (step.kind !== 'code') return
    reset()
    if (await requestCode(step.email)) setInfo('signin.resent')
  }

  const title = account !== null ? t('signin.againTitle') : t('signin.title')
  const formAlert = formError !== null && (
    <p className="form-error" role="alert">
      {formError}
    </p>
  )

  if (step.kind === 'too-young') {
    return (
      <section className="setup signin" aria-labelledby="signin-title">
        <div className="setup-head">
          <h1 id="signin-title" ref={heading} tabIndex={-1}>
            {t('signin.tooYoungTitle')}
          </h1>
        </div>
        <div className="panel form-section">
          <p>{t('signin.tooYoung', { age: step.age })}</p>
          <div className="actions">
            <Link className="button primary" to={{ name: 'home' }}>
              {t('signin.backToDemo')}
            </Link>
          </div>
        </div>
      </section>
    )
  }
  return (
    <section className="setup signin" aria-labelledby="signin-title">
      <div className="setup-head">
        <h1 id="signin-title">{title}</h1>
        <p className="eyebrow">{t('setup.step', { n: STEP_NUMBER[step.kind], count: 3 })}</p>
      </div>
      {!online && <p className="note">{t('signin.offline')}</p>}
      <div className="panel form-section">
        {step.kind === 'gate' && (
          <form onSubmit={submitGate} noValidate>
            <h2 ref={heading} tabIndex={-1}>
              {t('signin.stepGate')}
            </h2>
            <p className="note">{t('signin.gateIntro')}</p>
            <Field label={t('signin.country')} error={null}>
              {({ id }) => (
                <select
                  id={id}
                  value={country ?? ''}
                  onChange={(e) => {
                    countryTouched.current = true
                    setCountry(e.target.value === '' ? null : e.target.value)
                    // Another country may set another age: confirm it again.
                    setAgeConfirmed(false)
                  }}
                >
                  <option value="">{t('signin.countryUnknown')}</option>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={ageConfirmed} onChange={(e) => setAgeConfirmed(e.target.checked)} />
                {t('signin.ageConfirm', { age })}
              </label>
            </div>
            <div className="actions">
              <button type="submit" className="button primary" disabled={!ageConfirmed}>
                {t('signin.continue')}
              </button>
              <button type="button" className="link-button" onClick={() => setStep({ kind: 'too-young', age })}>
                {t('signin.younger', { age })}
              </button>
            </div>
          </form>
        )}
        {step.kind === 'method' && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {t('signin.stepMethod')}
            </h2>
            {account === null && demoHasProgress && <p className="note demo-note">{t('signin.demoNote')}</p>}
            <form onSubmit={(e) => void submitEmail(e)} noValidate>
              <Field label={t('signin.email')} error={fieldError === 'signin.emailInvalid' ? t(fieldError) : null}>
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    type="email"
                    autoComplete="email"
                    value={email}
                    aria-describedby={describedBy}
                    aria-invalid={invalid || undefined}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              {formAlert}
              <button type="submit" className="button primary signin-wide" disabled={busy || !online}>
                {t('signin.sendCode')}
              </button>
            </form>
            <p className="or">{t('signin.or')}</p>
            <button type="button" className="button signin-wide" disabled={busy || !online} onClick={() => void google()}>
              {t('signin.google')}
            </button>
            <p className="privacy-link">
              <a href="/privacy">{t('privacy.link')}</a>
            </p>
          </>
        )}
        {step.kind === 'code' && (
          <form onSubmit={(e) => void submitCode(e)} noValidate>
            <h2 ref={heading} tabIndex={-1}>
              {t('signin.stepCode')}
            </h2>
            <p>{t('signin.codeSent', { email: step.email })}</p>
            <Field label={t('signin.code')} error={fieldError === 'signin.codeInvalid' || fieldError === 'signin.codeWrong' ? t(fieldError) : null}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setCode(e.target.value)}
                />
              )}
            </Field>
            {formAlert}
            {info !== null && <p role="status">{t(info)}</p>}
            {verifying && <p role="status">{t('signin.working')}</p>}
            <div className="actions">
              <button type="submit" className="button primary" disabled={busy}>
                {t('signin.verify')}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => void resend()}>
                {t('signin.resend')}
              </button>
              <button
                type="button"
                className="link-button"
                onClick={() => {
                  reset()
                  setCode('')
                  setStep({ kind: 'method' })
                }}
              >
                {t('signin.otherEmail')}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
