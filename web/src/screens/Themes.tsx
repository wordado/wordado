import { useClient, useClientSnapshot } from '@wordado/client-data'
import { levelIndex, offeredThemes, themeEntries } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'

/** Theme collections (spec §8.9): choosing one puts its words first; nothing else changes. */
export function Themes() {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, settings } = useClientSnapshot()
  if (!corpus) return null
  const offered = offeredThemes(corpus)
  const active = settings.activeTheme
  const choose = (activeTheme: string | null) => void client.updateSettings({ activeTheme })
  return (
    <section aria-labelledby="themes-title">
      <h1 id="themes-title">{t('themes.title')}</h1>
      <p className="lede">{t('themes.intro')}</p>
      {active !== null && !offered.some((theme) => theme.themeId === active) && (
        <button type="button" className="button" onClick={() => choose(null)}>
          {t('themes.clear')}
        </button>
      )}
      {offered.length === 0 ? (
        <p>{t('themes.none')}</p>
      ) : (
        <ul className="themes">
          {offered.map((theme) => {
            const entries = themeEntries(corpus, theme.themeId)
            const aboveLevel = entries.some((e) => levelIndex(e.level) > levelIndex(settings.declaredLevel))
            const isActive = active === theme.themeId
            return (
              <li key={theme.themeId} className={isActive ? 'theme active' : 'theme'}>
                <h2>{localized(theme.name, locale)}</h2>
                <p>{localized(theme.description, locale)}</p>
                <p className="note">{t('themes.count', { count: entries.length })}</p>
                {aboveLevel && <p className="note">{t('themes.aboveLevel')}</p>}
                {isActive ? (
                  <>
                    <p className="stat">
                      <span aria-hidden="true">✓ </span>
                      {t('themes.active')}
                    </p>
                    <button type="button" className="button" onClick={() => choose(null)}>
                      {t('themes.clear')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="button" onClick={() => choose(theme.themeId)}>
                    {t('themes.choose')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
