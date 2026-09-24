import { useClientSnapshot } from '@wordado/client-data'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, OfflineError } from '../account/api'
import { checkBirthYear } from '../account/ageGate'
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

/**
 * Sign-in and sign-up are one flow (spec §8.6): the age gate (spec §11),
 * then a code by email or Google. The server creates the account at the
 * first sign-in, so the gate comes first every time. Only the country is
 * kept; the birth year is checked here and forgotten.
 */
export function SignIn(props: { readonly redirect?: (url: string) => void; readonly pending?: { save(p: PendingSignIn): void } }) {
  const { t, locale } = useT()
  const { api, accounts, account, env } = useApp()
  const { states } = useClientSnapshot()
  const online = useOnline()
  const [step, setStep] = useState<Step>({ kind: 'gate' })
  const [country, setCountry] = useState<string | null>(null)
  const [year, setYear] = useState('')
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

  const submitGate = (event: FormEvent) => {
    event.preventDefault()
    reset()
    const result = checkBirthYear(year, country, env.now())
    if (result.status === 'invalid') setFieldError('signin.birthYearInvalid')
    else if (result.status === 'too-young') setStep({ kind: 'too-young', age: result.age })
    else setStep({ kind: 'method' })
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
      <section className="signin" aria-labelledby="signin-title">
        <h1 id="signin-title" ref={heading} tabIndex={-1}>
          {t('signin.tooYoungTitle')}
        </h1>
        <p>{t('signin.tooYoung', { age: step.age })}</p>
        <Link className="button" to={{ name: 'home' }}>
          {t('signin.backToDemo')}
        </Link>
      </section>
    )
  }

  return (
    <section className="signin" aria-labelledby="signin-title">
      <h1 id="signin-title" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {!online && <p className="note">{t('signin.offline')}</p>}

      {step.kind === 'gate' && (
        <form onSubmit={submitGate} noValidate>
          <p className="lede">{t('signin.gateIntro')}</p>
          <Field label={t('signin.country')} error={null}>
            {({ id }) => (
              <select
                id={id}
                value={country ?? ''}
                onChange={(e) => {
                  countryTouched.current = true
                  setCountry(e.target.value === '' ? null : e.target.value)
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
          <Field label={t('signin.birthYear')} hint={t('signin.birthYearHint')} error={fieldError === 'signin.birthYearInvalid' ? t(fieldError) : null}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                inputMode="numeric"
                autoComplete="bday-year"
                maxLength={4}
                value={year}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(e) => setYear(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="button primary">
            {t('signin.continue')}
          </button>
        </form>
      )}

      {step.kind === 'method' && (
        <>
          {account === null && states.size > 0 && <p className="note demo-note">{t('signin.demoNote')}</p>}
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
            <button type="submit" className="button primary" disabled={busy || !online}>
              {t('signin.sendCode')}
            </button>
          </form>
          <p className="or">{t('signin.or')}</p>
          <button type="button" className="button" disabled={busy || !online} onClick={() => void google()}>
            {t('signin.google')}
          </button>
        </>
      )}

      {step.kind === 'code' && (
        <form onSubmit={(e) => void submitCode(e)} noValidate>
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
          <button type="submit" className="button primary" disabled={busy}>
            {t('signin.verify')}
          </button>
          <p className="actions">
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
          </p>
        </form>
      )}
    </section>
  )
}
