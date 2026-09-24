import { ENDONYM, LOCALES, useT } from '../i18n/i18n'

/** The interface language (spec §11.2), also in the masthead. */
export function LanguageSettings() {
  const { t, locale, setLocale } = useT()
  return (
    <section aria-labelledby="settings-language">
      <h2 id="settings-language">{t('settings.language')}</h2>
      <fieldset className="choices">
        <legend className="visually-hidden">{t('settings.language')}</legend>
        <p className="note">{t('settings.languageHint')}</p>
        {LOCALES.map((l) => (
          <label key={l} lang={l}>
            <input type="radio" name="locale" value={l} checked={locale === l} onChange={() => setLocale(l)} />
            {ENDONYM[l]}
          </label>
        ))}
      </fieldset>
    </section>
  )
}
