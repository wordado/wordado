import { useClient } from '@wordado/client-data'
import { newsConsentText } from '@wordado/core'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, OfflineError, PasskeyCancelled, type CodeOutcome } from '../account/api'
import { consentAge } from '../account/ageGate'
import { countryOptions } from '../account/countries'
import { conditionalSignIn, markOfferAnswered, offerAnswered, offerPending, passkeysSupported, platformAuthenticator } from '../account/passkeys'
import { browserStorage, type KeyValue } from '../account/storage'
import { useApp } from '../app/context'
import { AccountGives } from '../app/AccountGives'
import { privacyUrl } from '../app/site'
import { ProgressBar } from '../app/ProgressBar'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'
import { useStore } from '../useStore'

type Step =
  | { readonly kind: 'method' }
  | { readonly kind: 'code'; readonly email: string }
  /** A right code for an address with no account (#293): the ticket creates it once the age is confirmed. */
  | { readonly kind: 'gate'; readonly email: string; readonly ticket: string }
  | { readonly kind: 'too-young'; readonly age: number }
  /**
   * After a code sign-in, once (#287). Not set by a step change: it shows while `offerPending` holds, since finishing the
   * sign-in remounts the screen.
   */
  | { readonly kind: 'passkey-offer' }

/** How the offer stands: asked, the device prompt open, or answered with a line to read before going on. */
type OfferState = 'ask' | 'busy' | 'added' | 'failed'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A failure from the server, as the learner reads it (plan 5: a 429 with `sign_in_email_limit` sent no code). */
function failureKey(err: unknown, fallback: MessageKey): MessageKey {
  if (err instanceof OfflineError) return 'signin.offline'
  if (err instanceof ApiError && err.status === 429) return err.code === 'sign_in_email_limit' ? 'signin.limit' : 'signin.tooMany'
  return fallback
}

/** A failed passkey sign-in, as the learner reads it (spec 2026-10-18 §5.2): a cancelled prompt says nothing. */
function passkeyFailureKey(err: unknown): MessageKey | null {
  if (err instanceof PasskeyCancelled) return null
  if (err instanceof ApiError && err.code === 'PASSKEY_NOT_FOUND') return 'signin.passkeyGone'
  return failureKey(err, 'signin.failed')
}

/** Refusals of a passkey the learner picked: only the server's check of it answers these. */
const PICKED_PASSKEY_REFUSED: ReadonlySet<unknown> = new Set(['PASSKEY_NOT_FOUND', 'AUTHENTICATION_FAILED', 'USER_NOT_VERIFIED'])

/**
 * The request waiting in the email field fails on its own too, before the learner picks anything (no connection, a
 * server that cannot give its options): that says nothing, since the learner asked for nothing yet. Only a passkey the
 * learner picked and the server refused is answered; the button reports everything.
 */
function autofillFailureKey(err: unknown): MessageKey | null {
  return err instanceof ApiError && PICKED_PASSKEY_REFUSED.has(err.code) ? passkeyFailureKey(err) : null
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

/** The steps every learner takes, as the counter numbers them; the age step of a new account is named instead. */
const STEP_NUMBER = { method: 1, code: 2 } as const

/**
 * Sign-in and sign-up are one flow (spec §8.6), as a wizard in the first-run
 * setup's look: an email address, then the code, and for an address with no
 * account the age gate (spec §11, #293). A right code for an account signs in
 * at once; for an address without one the server creates nothing yet and
 * answers with a ticket, and the gate comes next: the account is created only
 * once the age is confirmed, with that ticket and no second code. The gate
 * asks where the learner lives and that they are at least the age it sets;
 * the country stays on this device and is not sent (#166), and no birth date
 * is asked. A learner below the age is turned away and the server drops the
 * ticket. Under the age the gate asks, with a box that starts unticked,
 * whether the learner wants news by email (#186): the wording ticked travels
 * with the request that creates the account, and a returning sign-in sends
 * none. The first step says that the email decides which account it is, and
 * the gate names the address it found no account for, so a mistyped one can
 * be changed before anything is made (#273). The native language is asked by
 * the first-run setup, right after sign-up (plan 11), not here.
 *
 * Passkeys (#287), where the browser can do them: a button on the first step and, where the browser lists passkeys
 * in the email field's autofill, a request that waits there from the start and is aborted before anything else asks.
 * A passkey signs in to an account that exists, with the same rules as a code for the demo and for another account's
 * progress. After a code sign-in, a device with its own unlock that has not answered before is offered a passkey,
 * once; the answer is kept in `deviceStore`.
 */
export function SignIn(props: { readonly deviceStore?: KeyValue }) {
  const { t, locale } = useT()
  const { api, accounts, account } = useApp()
  const client = useClient()
  const online = useOnline()
  const [deviceStore] = useState(() => props.deviceStore ?? browserStorage('localStorage'))
  const [step, setStep] = useState<Step>({ kind: 'method' })
  const pending = useStore(offerPending)
  const [offer, setOffer] = useState<OfferState>('ask')
  // Where the browser lists passkeys in the email field (conditional mediation), and the request waiting there.
  const [autofill, setAutofill] = useState(false)
  const waiting = useRef<AbortController | null>(null)
  // Bumped to start the waiting request again after a passkey attempt that did not sign in.
  const [autofillRun, setAutofillRun] = useState(0)
  const continueButton = useRef<HTMLButtonElement>(null)
  const [country, setCountry] = useState<string | null>(null)
  const [ageConfirmed, setAgeConfirmed] = useState(false)
  // News by email (#186): unticked until the learner ticks it, and nothing about the account waits for it.
  const [newsConsent, setNewsConsent] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<MessageKey | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const countries = useMemo(() => countryOptions(locale), [locale])
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

  // The offer shows wherever it is owed and there is an account: the screen mounted after the sign-in's switch included.
  const view: Step['kind'] = pending && account !== null ? 'passkey-offer' : step.kind

  // Each step's heading takes focus, as a new page would (spec §11.1); the first step is where the page starts.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      if (view === 'method') return
    }
    heading.current?.focus()
  }, [view])

  useEffect(() => {
    let live = true
    void conditionalSignIn().then((available) => {
      if (live) setAutofill(available)
    })
    return () => {
      live = false
    }
  }, [])

  /** Aborts the request waiting in the email field, before anything else asks the browser or the server. */
  const stopWaiting = () => {
    waiting.current?.abort()
    waiting.current = null
  }

  const reset = () => {
    setFieldError(null)
    setFormError(null)
    setInfo(null)
  }

  const age = consentAge(country)

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
    stopWaiting()
    if (await requestCode(address)) setStep({ kind: 'code', email: address })
  }

  const stopWorking = () => {
    setBusy(false)
    setVerifying(false)
  }

  /**
   * The session is there: bring the account onto this device, and go home. After a code, a device that can hold a
   * passkey and has not answered is offered one first: once the sign-in is complete, so the demo's carry-over or
   * discard has run, and never for a sign-in refused for another account's progress.
   */
  const finishSignIn = async (method: 'code' | 'passkey') => {
    offerPending.set(false)
    try {
      const offerOwed = method === 'code' && passkeysSupported() && !offerAnswered(deviceStore) && (await platformAuthenticator())
      const outcome = await accounts.completeSignIn()
      if (outcome === 'other-account') {
        setFormError(t('signin.otherAccount', { email: account?.email ?? '' }))
        stopWorking()
        return
      }
      if (offerOwed) {
        // This screen may be gone by now (the switch remounts the app): whichever one is mounted shows the offer.
        setOffer('ask')
        offerPending.set(true)
        stopWorking()
        return
      }
      navigate({ name: 'home' }, { replace: true })
    } catch (err) {
      setFormError(t(failureKey(err, 'signin.failed')))
      stopWorking()
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
    let outcome: CodeOutcome
    try {
      outcome = await api.verifyCode(step.email, digits)
    } catch (err) {
      // Only 400/401/403 mean the code itself was wrong; anything else (5xx, a
      // malformed response) is a server fault, not the learner's mistake, and
      // 429/offline keep their own messages (fix round 1, #2).
      if (err instanceof ApiError && (err.status === 400 || err.status === 401 || err.status === 403)) {
        setFieldError('signin.codeWrong')
      } else {
        setFormError(t(failureKey(err, 'signin.failed')))
      }
      stopWorking()
      return
    }
    if (outcome.kind === 'new-account') {
      stopWorking()
      // The age is confirmed afresh for each new account, with the country as it stands.
      setAgeConfirmed(false)
      setStep({ kind: 'gate', email: step.email, ticket: outcome.ticket })
      return
    }
    await finishSignIn('code')
  }

  const submitGate = async (event: FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'gate' || !ageConfirmed) return
    reset()
    setBusy(true)
    setVerifying(true)
    try {
      await api.createAccount(step.email, step.ticket, newsConsent ? newsConsentText(locale) : null)
    } catch (err) {
      stopWorking()
      // The ticket is spent or has lapsed (it lives as long as a code): the way on is a new code.
      if (err instanceof ApiError && err.status === 400) {
        setCode('')
        setStep({ kind: 'method' })
        setFormError(t('signin.ticketExpired'))
        return
      }
      setFormError(t(failureKey(err, 'signin.failed')))
      return
    }
    await finishSignIn('code')
  }

  const signedInWithPasskey = async () => {
    setBusy(true)
    setVerifying(true)
    await finishSignIn('passkey')
  }

  const passkeyFailed = (err: unknown, picked: (err: unknown) => MessageKey | null = passkeyFailureKey) => {
    const key = picked(err)
    if (key !== null) setFormError(t(key))
  }

  // On the first step, a passkey picked from the email field's suggestions signs in; leaving the step aborts the wait.
  // signedInWithPasskey and passkeyFailed only set state and finish the sign-in, so the first render's copies do.
  useEffect(() => {
    if (view !== 'method' || !autofill) return
    const controller = new AbortController()
    waiting.current = controller
    api.passkeySignIn({ conditional: true, signal: controller.signal }).then(
      () => {
        if (!controller.signal.aborted) void signedInWithPasskey()
      },
      (err: unknown) => {
        if (!controller.signal.aborted) passkeyFailed(err, autofillFailureKey)
      },
    )
    return () => controller.abort()
  }, [view, autofill, api, autofillRun])

  const pressPasskey = async () => {
    stopWaiting()
    reset()
    setBusy(true)
    try {
      await api.passkeySignIn({ conditional: false })
    } catch (err) {
      setBusy(false)
      passkeyFailed(err)
      // The field's suggestions list passkeys again.
      setAutofillRun((n) => n + 1)
      return
    }
    await signedInWithPasskey()
  }

  /** Either answer is this device's for good (spec 2026-10-18 §5.1). */
  const addPasskey = async () => {
    markOfferAnswered(deviceStore)
    setOffer('busy')
    try {
      await api.passkeyRegister()
      setOffer('added')
    } catch {
      // A cancelled prompt and a failure read the same: not added, and settings is the way back.
      setOffer('failed')
    }
  }

  useEffect(() => {
    if (offer === 'added' || offer === 'failed') continueButton.current?.focus()
  }, [offer])

  const leaveOffer = () => {
    markOfferAnswered(deviceStore)
    offerPending.set(false)
    navigate({ name: 'home' }, { replace: true })
  }

  /** Leaving the age step without an account: the server drops the ticket. */
  const leaveGate = (next: Step) => {
    if (step.kind === 'gate') void api.discardSignUp(step.email, step.ticket)
    reset()
    setCode('')
    setStep(next)
  }

  const resend = async () => {
    if (step.kind !== 'code') return
    reset()
    if (await requestCode(step.email)) setInfo('signin.resent')
  }

  const title = account !== null ? t('signin.againTitle') : t('signin.title')
  const eyebrow = step.kind === 'method' || step.kind === 'code' ? t('setup.step', { n: STEP_NUMBER[step.kind], count: 2 }) : t('signin.newAccount')
  const working = verifying && (
    <>
      <p role="status">{t('signin.working')}</p>
      <ProgressBar label={t('signin.working')} />
    </>
  )
  const formAlert = formError !== null && (
    <p className="form-error" role="alert">
      {formError}
    </p>
  )

  if (view === 'passkey-offer') {
    return (
      <section className="setup signin" aria-labelledby="signin-title">
        <div className="setup-head">
          <h1 id="signin-title" ref={heading} tabIndex={-1}>
            {t('passkey.offerTitle')}
          </h1>
        </div>
        <div className="panel form-section">
          <p>{t('passkey.offerText')}</p>
          <p role="status">{offer === 'added' ? t('passkey.added') : offer === 'failed' ? t('passkey.failed') : null}</p>
          <div className="actions">
            {offer === 'added' || offer === 'failed' ? (
              <button type="button" className="button primary" ref={continueButton} onClick={leaveOffer}>
                {t('passkey.continue')}
              </button>
            ) : (
              <>
                <button type="button" className="button primary" disabled={offer === 'busy'} onClick={() => void addPasskey()}>
                  {t('passkey.offerUse')}
                </button>
                <button type="button" className="link-button" disabled={offer === 'busy'} onClick={leaveOffer}>
                  {t('passkey.offerLater')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    )
  }
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
        <p className="eyebrow">{eyebrow}</p>
      </div>
      {!online && <p className="note">{t('signin.offline')}</p>}
      <div className="panel form-section">
        {step.kind === 'method' && (
          <>
            <h2 ref={heading} tabIndex={-1}>
              {t('signin.stepMethod')}
            </h2>
            {account === null && <p>{t('signin.emailFirst')}</p>}
            {account === null && demoHasProgress && <p className="note demo-note">{t('signin.demoNote')}</p>}
            <form onSubmit={(e) => void submitEmail(e)} noValidate>
              <Field
                label={t('signin.email')}
                {...(account === null ? { hint: t('signin.emailHint') } : {})}
                error={fieldError === 'signin.emailInvalid' ? t(fieldError) : null}
              >
                {({ id, describedBy, invalid }) => (
                  <input
                    id={id}
                    type="email"
                    autoComplete={autofill ? 'email webauthn' : 'email'}
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
            {passkeysSupported() && (
              <button type="button" className="button signin-wide" disabled={busy || !online} onClick={() => void pressPasskey()}>
                {t('signin.passkey')}
              </button>
            )}
            {working}
            <p className="privacy-link">
              <a href={privacyUrl(locale)}>{t('privacy.link')}</a>
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
            {working}
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
        {step.kind === 'gate' && (
          <form onSubmit={(e) => void submitGate(e)} noValidate>
            <h2 ref={heading} tabIndex={-1}>
              {t('signin.stepGate')}
            </h2>
            <p>{t('signin.noAccount', { email: step.email })}</p>
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
            <div className="field">
              <label className="check">
                <input type="checkbox" checked={newsConsent} onChange={(e) => setNewsConsent(e.target.checked)} />
                {t('news.consent')}
              </label>
            </div>
            {formAlert}
            {working}
            <div className="actions">
              <button type="submit" className="button primary" disabled={!ageConfirmed || busy}>
                {t('signin.create')}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => leaveGate({ kind: 'too-young', age })}>
                {t('signin.younger', { age })}
              </button>
              <button type="button" className="link-button" disabled={busy} onClick={() => leaveGate({ kind: 'method' })}>
                {t('signin.otherEmail')}
              </button>
            </div>
          </form>
        )}
      </div>
      {/* Below the form, so on a phone the email field is in view without scrolling (#296). */}
      {step.kind === 'method' && account === null && <AccountGives />}
    </section>
  )
}
