import { useClient, useClientSnapshot } from '@wordado/client-data'
import { offeredThemes } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
import { errorMessageKey } from '../errors'
import { localized, useT } from '../i18n/i18n'
import { StepActions, useStepHeading, type StepProps } from './step'

/** A first theme (spec §8.6, moved here from Home by plan 11): choosing one makes its words come first, and moves on. */
export function ThemeStep(props: StepProps) {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus } = useClientSnapshot()
  const heading = useStepHeading()
  const [error, setError] = useState<string | null>(null)
  /** True while a choice is being saved: a second click before it settles does nothing. */
  const going = useRef(false)
  /** False once the step is gone, so a save settling late moves nothing on. */
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const choose = async (themeId: string) => {
    if (going.current) return
    going.current = true
    try {
      await client.updateSettings({ activeTheme: themeId })
      if (mounted.current) props.next()
    } catch (err) {
      if (mounted.current) setError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
    } finally {
      going.current = false
    }
  }

  return (
    <section className="setup-step" aria-labelledby="setup-theme-title">
      <h2 id="setup-theme-title" ref={heading} tabIndex={-1}>
        {t('onboard.title')}
      </h2>
      <p className="note">{t('onboard.hint')}</p>
      {corpus && (
        <ul className="onboard-themes">
          {offeredThemes(corpus).map((theme) => (
            <li key={theme.themeId}>
              <button type="button" className="button" onClick={() => void choose(theme.themeId)}>
                {localized(theme.name, locale, corpus.l1)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <StepActions {...props} />
    </section>
  )
}
