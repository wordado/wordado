import { useClient, useClientSnapshot } from '@wordado/client-data'
import type { Target } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
import { OFFERED_TARGETS } from '../content/packs'
import { errorMessageKey } from '../errors'
import { languageName, useT } from '../i18n/i18n'

/**
 * The setup's first question when the build offers more than one course (spec §8.6): what to learn. The courses are
 * named in the interface language; the current one is chosen to begin with (or the build's first, when the settings
 * name a course this build does not offer). Continue switches to the chosen course, then the setup goes on to its
 * language, which lists the native languages that course is taught from.
 */
export function CourseStep(props: { onDone(): void }) {
  const { t, locale } = useT()
  const client = useClient()
  const { settings } = useClientSnapshot()
  const heading = useRef<HTMLHeadingElement>(null)
  const [chosen, setChosen] = useState<Target>(() => (OFFERED_TARGETS.includes(settings.course) ? settings.course : OFFERED_TARGETS[0]!))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  /** True while a switch runs: a second click before React re-renders the disabled button does nothing. */
  const going = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    heading.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])

  const go = async () => {
    if (going.current) return
    going.current = true
    setBusy(true)
    setSaveError(null)
    try {
      await client.switchCourse(chosen)
    } catch (err) {
      going.current = false
      if (!mounted.current) return
      setBusy(false)
      setSaveError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
      return
    }
    going.current = false
    if (mounted.current) props.onDone()
  }

  return (
    <section className="course-step" aria-labelledby="course-step-title">
      <h2 id="course-step-title" ref={heading} tabIndex={-1}>
        {t('setup.course.title')}
      </h2>
      <fieldset className="choices" disabled={busy}>
        <legend className="visually-hidden">{t('setup.course.title')}</legend>
        {OFFERED_TARGETS.map((target) => (
          <label key={target} lang={locale}>
            <input
              type="radio"
              name="course"
              value={target}
              checked={chosen === target}
              onChange={() => {
                setChosen(target)
                setSaveError(null)
              }}
            />
            {languageName(target, locale)}
          </label>
        ))}
      </fieldset>
      {saveError !== null && (
        <div role="alert">
          <p>{saveError}</p>
        </div>
      )}
      <div className="actions">
        <button type="button" className="button primary" disabled={busy} onClick={() => void go()}>
          {t('setup.continue')}
        </button>
      </div>
    </section>
  )
}
