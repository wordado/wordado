import { useClient, useClientSnapshot } from '@wordado/client-data'
import { SUPPORTED_L1S, type L1 } from '@wordado/core'
import { useState } from 'react'
import { ConfirmDialog } from '../app/Confirm'
import { languageName, useT } from '../i18n/i18n'

/**
 * The native language the words are translated into (plan 10). Changing it keeps every bit of progress; it only
 * writes `settings.l1`, and `watchL1` switches the pack. An interface that spoke the old language follows along.
 */
export function NativeLanguageSettings() {
  const { t, locale, setLocale } = useT()
  const client = useClient()
  const { settings, l1: installed } = useClientSnapshot()
  const current = settings.l1 ?? installed
  const [target, setTarget] = useState<L1 | null>(null)

  const change = async (l1: L1) => {
    await client.updateSettings({ l1 })
    if (locale === current) setLocale(l1)
  }

  return (
    <section aria-labelledby="settings-native-language">
      <h2 id="settings-native-language">{t('settings.nativeLanguage')}</h2>
      <fieldset className="choices">
        <legend className="visually-hidden">{t('settings.nativeLanguage')}</legend>
        <p className="note">{t('settings.nativeLanguageHint')}</p>
        {SUPPORTED_L1S.map((l1) => (
          <label key={l1} lang={l1}>
            <input type="radio" name="native-language" value={l1} checked={current === l1} onChange={() => setTarget(l1)} />
            {languageName(l1, l1)}
          </label>
        ))}
      </fieldset>
      {target !== null && (
        <ConfirmDialog
          title={t('settings.nativeLanguage')}
          // Intl's own form of the name, as it sits mid-sentence: "German", "Deutsch", "немски".
          body={<p>{t('settings.nativeLanguageConfirm', { language: new Intl.DisplayNames([locale], { type: 'language' }).of(target) ?? target })}</p>}
          confirmLabel={t('settings.nativeLanguageChange')}
          onConfirm={() => change(target)}
          onClose={() => setTarget(null)}
        />
      )}
    </section>
  )
}
