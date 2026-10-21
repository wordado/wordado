import { useClientSnapshot } from '@wordado/client-data'
import { COURSE_L1S, isCourseL1, type L1 } from '@wordado/core'
import { languageName, useT } from '../i18n/i18n'
import { Link } from '../router'

/**
 * The native language the words are translated into (plan 10). Changing it is the setup's language page, reused in
 * `change` mode at `/settings/native-language` (plan 11); this section only shows what is set and links there.
 */
export function NativeLanguageSettings() {
  const { t, locale } = useT()
  const { settings, l1: installedText } = useClientSnapshot()
  // `Client.l1` is the active pack's L1, or the default before any pack exists. Under a course switched to and not set
  // up yet it may be the course's own language (German installed for English, now learning German): the course's
  // first native language stands in then, as it does for a value the snapshot carries as a plain `string`.
  const installed: L1 = isCourseL1(settings.course, installedText) ? installedText : COURSE_L1S[settings.course][0]!
  const current = settings.l1 ?? installed
  // Intl's own form of the name, as it sits mid-sentence: "German", "Deutsch", "немски".
  const inSentence = (l1: L1) => new Intl.DisplayNames([locale], { type: 'language' }).of(l1) ?? l1
  /** A setting the installed pack does not match yet: `watchCourse` installs it once it can (offline, it waits). */
  const pending = settings.l1 !== null && settings.l1 !== installed ? settings.l1 : null

  return (
    <section aria-labelledby="settings-native-language">
      <h3 id="settings-native-language">{t('settings.nativeLanguage')}</h3>
      <p className="note">{t('settings.nativeLanguageHint')}</p>
      <p lang={current}>{languageName(current, current)}</p>
      {pending !== null && <p className="note">{t('settings.nativeLanguagePending', { language: inSentence(pending) })}</p>}
      <Link to={{ name: 'native-language' }} aria-label={t('settings.nativeLanguageChangeLink')}>
        {t('settings.nativeLanguageChange')}
      </Link>
    </section>
  )
}
