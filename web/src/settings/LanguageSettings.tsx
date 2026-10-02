import { useClientSnapshot } from '@wordado/client-data'
import { ENDONYM, interfaceLocales, useT } from '../i18n/i18n'

/** The interface language (spec §11.2), also in the masthead: the learner's L1 or English once a pack is installed. */
export function LanguageSettings() {
  const { t, locale, setLocale } = useT()
  const { corpus } = useClientSnapshot()
  return (
    <section aria-labelledby="settings-language">
      <h3 id="settings-language">{t('settings.language')}</h3>
      <fieldset className="choices">
        <legend className="visually-hidden">{t('settings.language')}</legend>
        <p className="note">{t('settings.languageHint')}</p>
        {interfaceLocales(corpus?.l1 ?? null).map((l) => (
          <label key={l} lang={l}>
            <input type="radio" name="locale" value={l} checked={locale === l} onChange={() => setLocale(l)} />
            {ENDONYM[l]}
          </label>
        ))}
      </fieldset>
    </section>
  )
}
