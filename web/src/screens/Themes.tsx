import { useClient, useClientSnapshot } from '@wordado/client-data'
import { corpusWordId, levelIndex, offeredThemes, themeEntries, type Theme } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { ThemeIcon } from '../themes/icons'
import { themeStarted } from './practiceScope'

/** Theme collections (spec §8.9): choosing one puts its words first; nothing else changes. */
export function Themes() {
  const { t } = useT()
  const client = useClient()
  const { corpus, settings } = useClientSnapshot()
  if (!corpus) return null
  const offered = offeredThemes(corpus)
  const active = settings.activeTheme
  const choose = (activeTheme: string | null) => void client.updateSettings({ activeTheme })
  // The theme being studied leads; the rest keep the pack's order.
  const ordered = [...offered].sort((a, b) => Number(b.themeId === active) - Number(a.themeId === active))
  return (
    <section className="themes-page" aria-labelledby="themes-title">
      <div className="themes-head">
        <h1 id="themes-title">{t('themes.title')}</h1>
        <p className="lede">{t('themes.intro')}</p>
      </div>
      {active !== null && !offered.some((theme) => theme.themeId === active) && (
        <button type="button" className="button" onClick={() => choose(null)}>
          {t('themes.clear')}
        </button>
      )}
      {offered.length === 0 ? (
        <p className="panel">{t('themes.none')}</p>
      ) : (
        <ul className="theme-grid" aria-label={t('themes.all')}>
          {ordered.map((theme) => (
            <ThemeCard key={theme.themeId} theme={theme} active={active === theme.themeId} onChoose={choose} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ThemeCard(props: { readonly theme: Theme; readonly active: boolean; onChoose(themeId: string | null): void }) {
  const { t, locale } = useT()
  const { corpus, settings, states, flags } = useClientSnapshot()
  const { theme, active } = props
  const entries = themeEntries(corpus!, theme.themeId)
  const started = entries.filter((e) => states.has(corpusWordId(e.entryId))).length
  const aboveLevel = entries.some((e) => levelIndex(e.level) > levelIndex(settings.declaredLevel))
  const name = localized(theme.name, locale, corpus!.l1)
  // Practice draws on started words that are not set aside (spec §7.4); the bar above counts every started word.
  const canPractise = themeStarted(entries.map((e) => e.entryId), states, flags) > 0
  const startedText = t('themes.started', { started, count: entries.length })
  return (
    <li className={active ? 'panel theme-card is-active' : 'panel theme-card'}>
      <span className="theme-icon" aria-hidden="true">
        <ThemeIcon themeId={theme.themeId} size={24} />
      </span>
      <div className="theme-text">
        {active && (
          <p className="theme-active">
            <span aria-hidden="true">✓ </span>
            {t('themes.active')}
          </p>
        )}
        <h2>{name}</h2>
        <p className="note">{localized(theme.description, locale, corpus!.l1)}</p>
        {aboveLevel && <p className="note">{t('themes.aboveLevel')}</p>}
      </div>
      <div className="theme-progress">
        <div
          className="bar"
          role="progressbar"
          aria-label={`${name}: ${startedText}`}
          aria-valuemin={0}
          aria-valuemax={entries.length}
          aria-valuenow={started}
        >
          <span style={{ width: `${entries.length > 0 ? (100 * started) / entries.length : 0}%` }} />
        </div>
        <p className="note">{startedText}</p>
      </div>
      {active ? (
        <button type="button" className="button theme-action" onClick={() => props.onChoose(null)}>
          {t('themes.clear')}
        </button>
      ) : (
        <button type="button" className="button theme-action theme-choose" aria-label={t('themes.chooseNamed', { name })} onClick={() => props.onChoose(theme.themeId)}>
          <span className="label-long">{t('themes.choose')}</span>
          <span className="label-short">{t('themes.chooseShort')}</span>
        </button>
      )}
      {canPractise && (
        <Link className="button theme-practise" to={{ name: 'practice', theme: theme.themeId }} aria-label={t('themes.practiseNamed', { name })}>
          {t('themes.practise')}
        </Link>
      )}
    </li>
  )
}
