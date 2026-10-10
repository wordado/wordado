import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { useStore } from '../useStore'

/** About (plan 8b): how the translations were checked (spec §8.10), the way to feedback about the app (spec §8.12), and the attributions the word data's licences require, shown verbatim in English (Decision 3). */
export function AboutSettings() {
  const { t } = useT()
  const { credits } = useApp()
  const view = useStore(credits.store)
  const sources = view.credits?.sources ?? null
  return (
    <section aria-labelledby="settings-about">
      <h2 id="settings-about">{t('settings.about')}</h2>
      {/* Said plainly (spec §8.10): what checked the translations, and how to tell us of a fault. */}
      <p>{t('about.aiChecked')}</p>
      <p className="note">{t('about.howToReport')}</p>
      {/* Anything about the app itself, not a word (spec §8.12). */}
      <p>
        <Link to={{ name: 'feedback', from: '/settings/about' }}>{t('feedback.aboutLink')}</Link>
      </p>
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
