import { useClient, useClientSnapshot } from '@wordado/client-data'
import { isCourseL1, type Target } from '@wordado/core'
import { ChevronRight, GraduationCap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { ProgressBar } from '../app/ProgressBar'
import { OFFERED_TARGETS } from '../content/packs'
import { errorMessageKey } from '../errors'
import { languageInSentence, languageName, useT } from '../i18n/i18n'
import { Link } from '../router'
import { useStore } from '../useStore'

/** The course the settings name, with its native language once one is known: "German, from Bulgarian". */
function useCourseLabel(): string {
  const { t, locale } = useT()
  const { settings, l1: installedText } = useClientSnapshot()
  const course = settings.course
  // The setting, else the installed pack's when it is one this course is taught from: the course's own language never.
  const l1 = settings.l1 ?? (isCourseL1(course, installedText) ? installedText : null)
  return l1 === null ? languageName(course, locale) : t('settings.courseCurrent', { course: languageName(course, locale), language: languageInSentence(l1, locale) })
}

/**
 * Settings' Languages section names the course and leads to its page when the build offers more than one, or when
 * the settings name a course this build does not offer (the way back to one it does).
 */
export function CourseRow() {
  const { t } = useT()
  const { settings } = useClientSnapshot()
  const label = useCourseLabel()
  if (OFFERED_TARGETS.length < 2 && OFFERED_TARGETS.includes(settings.course)) return null
  return (
    <ul className="settings-rows">
      <li>
        <Link className="settings-row" to={{ name: 'course' }}>
          <span className="settings-row-icon" aria-hidden="true">
            <GraduationCap size={20} strokeWidth={1.75} />
          </span>
          <span className="settings-row-text">
            <span className="settings-row-title">{t('settings.course')}</span>
            <span className="note">{label}</span>
          </span>
          <ChevronRight aria-hidden="true" size={18} className="settings-chevron" />
        </Link>
      </li>
    </ul>
  )
}

/**
 * Switching course (spec §8.6), at `/settings/course`: the current course and its native language, what a course keeps
 * of its own, and one button per other course the build offers. A course never started opens its setup at the
 * language (`startSetup`); one started before has its language back, and the course watcher installs it while this
 * page shows the download, as the native-language page does.
 *
 * A build that does not offer the course the settings name (an English-only build, after a switch to German on another
 * device) still names it here and offers the way back to a course it does offer; the watcher installs what the settings
 * name in the meantime, since that course's manifest exists.
 */
export function CourseSettings() {
  const { t, locale } = useT()
  const client = useClient()
  const { packs, startSetup } = useApp()
  const { settings } = useClientSnapshot()
  const label = useCourseLabel()
  const download = useStore(packs.store)
  const heading = useRef<HTMLHeadingElement>(null)
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const going = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    heading.current?.focus()
    return () => {
      mounted.current = false
    }
  }, [])

  const course = settings.course
  const others = OFFERED_TARGETS.filter((target) => target !== course)
  const progress = download.phase === 'downloading' && download.client === client && download.course.target === course ? download : null

  const switchTo = async (target: Target) => {
    if (going.current) return
    going.current = true
    setBusy(true)
    setSaveError(null)
    try {
      const { needsSetup } = await client.switchCourse(target)
      if (needsSetup) startSetup()
    } catch (err) {
      if (mounted.current) setSaveError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
    } finally {
      going.current = false
      if (mounted.current) setBusy(false)
    }
  }

  return (
    <section className="course-settings" aria-labelledby="course-settings-title">
      <h2 id="course-settings-title" ref={heading} tabIndex={-1}>
        {t('settings.course')}
      </h2>
      <p>{label}</p>
      <p className="note">{t('settings.courseHint')}</p>
      {progress && (
        <div className="download-progress">
          <ProgressBar label={t('setup.downloading')} value={progress.received} max={progress.total} />
        </div>
      )}
      {saveError !== null && (
        <div role="alert">
          <p>{saveError}</p>
        </div>
      )}
      <div className="actions">
        {others.map((target) => (
          <button key={target} type="button" className="button" disabled={busy} onClick={() => void switchTo(target)}>
            {t('settings.courseSwitch', { language: languageInSentence(target, locale) })}
          </button>
        ))}
      </div>
    </section>
  )
}
