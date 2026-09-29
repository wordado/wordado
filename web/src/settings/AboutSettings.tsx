import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'

/** About (plan 8b): the attributions the word data's licences require, shown verbatim in English (Decision 3). */
export function AboutSettings() {
  const { t } = useT()
  const { credits } = useApp()
  const view = useStore(credits.store)
  const sources = view.credits?.sources ?? null
  return (
    <section aria-labelledby="settings-about">
      <h2 id="settings-about">{t('settings.about')}</h2>
      {sources === null ? (
        <p className="note">{t('about.unavailable')}</p>
      ) : sources.length === 0 ? (
        <p>{t('about.ownList')}</p>
      ) : (
        <>
          <p>{t('about.sources')}</p>
          <ul className="credits" lang="en">
            {sources.map((s) => (
              <li key={s.source}>{s.attribution}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
