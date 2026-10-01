import { useClient, useClientSnapshot } from '@wordado/client-data'
import { offeredThemes } from '@wordado/core'
import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { errorMessageKey } from '../errors'
import { localized, useT } from '../i18n/i18n'
import { ThemeIcon } from '../themes/icons'
import { StepActions, useStepHeading, type StepProps } from './step'

/**
 * A first theme (spec §8.6, moved here from Home by plan 11): choosing one makes its words come first, and moves on.
 * Each theme is a row in Settings' look, with its picture from the Themes page, its name and its description.
 */
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
        <ul className="settings-rows">
          {offeredThemes(corpus).map((theme) => {
            const id = `setup-theme-${theme.themeId}`
            return (
              <li key={theme.themeId}>
                {/* A row as in Settings' menu, but a button: its name is the theme's, its description describes it. */}
                <button type="button" className="settings-row" aria-labelledby={id} aria-describedby={`${id}-note`} onClick={() => void choose(theme.themeId)}>
                  <span className="settings-row-icon" aria-hidden="true">
                    <ThemeIcon themeId={theme.themeId} size={20} />
                  </span>
                  <span className="settings-row-text">
                    <span className="settings-row-title" id={id}>
                      {localized(theme.name, locale, corpus.l1)}
                    </span>
                    <span className="note" id={`${id}-note`}>
                      {localized(theme.description, locale, corpus.l1)}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" size={18} className="settings-chevron" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {error !== null && <p role="alert">{error}</p>}
      <StepActions {...props} />
    </section>
  )
}
