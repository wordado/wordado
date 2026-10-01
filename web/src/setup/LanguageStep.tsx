import { useClient, useClientSnapshot } from '@wordado/client-data'
import { isSupportedL1, SUPPORTED_L1S, type L1 } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { errorMessageKey } from '../errors'
import { languageName, useT } from '../i18n/i18n'
import { Link } from '../router'
import { useStore } from '../useStore'

/** Where an attempt stands: nothing yet, installing, or failed (with the language it was for, so Try again repeats it). */
type Attempt = { readonly phase: 'idle' } | { readonly phase: 'installing'; readonly l1: L1 } | { readonly phase: 'failed'; readonly l1: L1 }

/**
 * The native language (plan 11, Task 5). In `setup` mode it is the first-run setup's first step; in `change` mode it
 * is Settings' language page, at `/settings/native-language` (Task 7). Either way it writes `settings.l1`, then
 * installs that pack through the one `PackSwitcher` and shows its download; `onDone` follows once the pack is
 * installed. A failed install says so and offers Try again, and the setup's link to Sign in stays, so it is never a
 * dead end (Review Focus 4). `ownBack` is false when the page around it already has its own Back link.
 */
export function LanguageStep(props: { readonly mode: 'setup' | 'change'; readonly ownBack?: boolean; onDone(): void }) {
  const { t, locale, setLocale } = useT()
  const client = useClient()
  const { account, packs } = useApp()
  const { settings, l1: installedText } = useClientSnapshot()
  const download = useStore(packs.store)
  const heading = useRef<HTMLHeadingElement>(null)
  const installed: L1 | null = isSupportedL1(installedText) ? installedText : null
  // In `change` mode the current choice is the setting, even while it is pending (offline): choosing the installed
  // language again then cancels that change.
  const current: L1 = settings.l1 ?? installed ?? 'bg'
  const [chosen, setChosen] = useState<L1>(() => (props.mode === 'change' ? current : (settings.l1 ?? (locale === 'de' ? 'de' : 'bg'))))
  const [attempt, setAttempt] = useState<Attempt>({ phase: 'idle' })
  const [saveError, setSaveError] = useState<string | null>(null)
  // Intl's own form of the name, as it sits mid-sentence: "German", "Deutsch", "немски".
  const inSentence = (l1: L1) => new Intl.DisplayNames([locale], { type: 'language' }).of(l1) ?? l1

  /** True while a go or retry runs: a second click before React re-renders the disabled button does nothing. */
  const going = useRef(false)
  /** False once the step is gone (the learner followed Sign in or Back mid-install): nothing happens after that. */
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    heading.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])

  /** Installs `l1`; the caller has set `going`. */
  const install = async (l1: L1) => {
    setAttempt({ phase: 'installing', l1 })
    const outcome = await packs.install(client, account, l1)
    going.current = false
    if (!mounted.current) return
    if (outcome.ok) {
      // The chosen language reaches the account now, not at the next sync.
      if (account !== null) void client.sync().catch(() => undefined)
      props.onDone()
    }
    else setAttempt({ phase: 'failed', l1 })
  }

  const go = async () => {
    if (going.current) return
    going.current = true
    const l1 = chosen
    setSaveError(null)
    setAttempt({ phase: 'installing', l1 })
    try {
      await client.updateSettings({ l1 })
    } catch (err) {
      going.current = false
      if (!mounted.current) return
      setAttempt({ phase: 'idle' })
      setSaveError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
      return
    }
    if (!mounted.current) {
      going.current = false
      return
    }
    // An interface that spoke the old native language follows the new one (plan 10).
    if (props.mode === 'change' && locale === installed) setLocale(l1)
    // In `change` mode `watchL1` asks for the same install; the switcher joins the two.
    await install(l1)
  }

  const retry = async (l1: L1) => {
    if (going.current) return
    going.current = true
    // Only a failure is cleared: a download that is running (`watchL1`'s, say) is left alone.
    const state = packs.store.get()
    if (state.phase === 'failed' && state.client === client) packs.reset()
    await install(l1)
  }

  const busy = attempt.phase === 'installing'
  const failed = attempt.phase === 'failed' ? attempt.l1 : null
  // The bar shows only once the total is known, so `aria-valuemax` is never 0.
  const progress =
    busy && download.phase === 'downloading' && download.client === client && download.l1 === attempt.l1 && download.total > 0 ? download : null
  const percent = progress
    ? new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(Math.min(1, progress.received / progress.total))
    : null
  const changing = props.mode === 'change' && chosen !== current && !busy && failed === null

  return (
    <section className="language-step" aria-labelledby="language-step-title">
      {/* The page's h1 is the setup's, or Settings' own: either way this is a section under it, headed by an h2. */}
      <h2 id="language-step-title" ref={heading} tabIndex={-1}>
        {props.mode === 'setup' ? t('setup.language.title') : t('settings.nativeLanguage')}
      </h2>
      <fieldset className="choices" disabled={busy}>
        <legend className="visually-hidden">{props.mode === 'setup' ? t('setup.language.title') : t('settings.nativeLanguage')}</legend>
        <p className="note">{props.mode === 'setup' ? t('setup.language.hint') : t('settings.nativeLanguageHint')}</p>
        {SUPPORTED_L1S.map((l1) => (
          <label key={l1} lang={l1}>
            <input
              type="radio"
              name="native-language"
              value={l1}
              checked={chosen === l1}
              onChange={() => {
                setChosen(l1)
                setAttempt({ phase: 'idle' })
                setSaveError(null)
              }}
            />
            {languageName(l1, l1)}
          </label>
        ))}
      </fieldset>

      <p className="note" role="status">
        {busy ? t('setup.downloading') : null}
      </p>
      {progress && (
        <div className="download-progress">
          <div className="bar" role="progressbar" aria-label={t('setup.downloading')} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.received}>
            <span style={{ width: `${Math.min(100, (100 * progress.received) / progress.total)}%` }} />
          </div>
          <p className="note" aria-hidden="true">
            {percent}
          </p>
        </div>
      )}

      {(failed !== null || saveError !== null) && (
        <div role="alert">
          <p>{saveError ?? t('setup.downloadFailed')}</p>
          {failed !== null && props.mode === 'change' && account !== null && <p className="note">{t('setup.savedOffline')}</p>}
        </div>
      )}

      {changing && <p>{t('settings.nativeLanguageConfirm', { language: inSentence(chosen) })}</p>}

      <div className="actions">
        {failed !== null ? (
          <button type="button" className="button primary" onClick={() => void retry(failed)}>
            {t('setup.retry')}
          </button>
        ) : props.mode === 'setup' ? (
          <button type="button" className="button primary" disabled={busy} onClick={() => void go()}>
            {t('setup.continue')}
          </button>
        ) : (
          changing && (
            <button type="button" className="button primary" onClick={() => void go()}>
              {t('settings.nativeLanguageChange')}
            </button>
          )
        )}
        {props.mode === 'setup' ? (
          // A signed-in account has nothing to sign in to: the link would be a dead end.
          account === null && <Link to={{ name: 'signin' }}>{t('setup.haveAccount')}</Link>
        ) : (
          (props.ownBack ?? true) && <Link to={{ name: 'settings', section: 'languages' }}>{t('common.back')}</Link>
        )}
      </div>
    </section>
  )
}
