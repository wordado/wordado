import { useClient, useClientSnapshot } from '@wordado/client-data'
import { offeredThemes, type Mode } from '@wordado/core'
import { useState } from 'react'
import { useApp } from '../app/context'
import { localized, useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'
import { useOnline } from '../useOnline'

const ONE_WAY: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select']

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Today (spec §8.3): the capped due figure first, the backlog second, then the day's motivation. */
export function Home() {
  const { t, locale } = useT()
  const { audio } = useApp()
  const client = useClient()
  const { plan, progress, xp, states, settings, corpus } = useClientSnapshot()
  useOnline() // re-renders on every `online`/`offline` event, so `canListen` below is re-evaluated
  const [skipped, setSkipped] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  if (!plan || !progress) return null
  const reviews = plan.reviews.length
  const fresh = plan.newWords.length
  const nothing = reviews + fresh === 0
  // Re-evaluated on every `online`/`offline` event (useOnline re-renders), and never with audio off (spec §11.1).
  const canListen = settings.audio && (audio.streamable() || audio.cachedClips().size > 0)
  const modes = ONE_WAY.filter((mode) => mode !== 'listening_select' || canListen)
  const { streak } = progress
  return (
    <section className="home" aria-labelledby="today">
      <h1 id="today" className="today">
        {nothing ? t('home.allDone') : reviews > 0 ? t('home.reviews', { count: reviews }) : t('home.newWords', { count: fresh })}
      </h1>
      {!skipped && states.size === 0 && settings.activeTheme === null && corpus && offeredThemes(corpus).length > 0 && (
        <div className="onboard" role="group" aria-labelledby="onboard-title">
          <h2 id="onboard-title">{t('onboard.title')}</h2>
          <p className="note">{t('onboard.hint')}</p>
          <ul className="onboard-themes">
            {offeredThemes(corpus).map((theme) => (
              <li key={theme.themeId}>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    client.updateSettings({ activeTheme: theme.themeId }).then(
                      () => setThemeError(null),
                      (err: unknown) => setThemeError(t('settings.saveFailed', { message: messageOf(err) })),
                    )
                  }}
                >
                  {localized(theme.name, locale)}
                </button>
              </li>
            ))}
          </ul>
          {themeError && <p role="alert">{themeError}</p>}
          <button type="button" className="link-button" onClick={() => setSkipped(true)}>
            {t('onboard.skip')}
          </button>
        </div>
      )}
      {nothing && <p className="today-more">{t('home.allDoneHint')}</p>}
      {!nothing && reviews > 0 && fresh > 0 && <p className="today-more">{t('home.newWords', { count: fresh })}</p>}
      {progress.backlogTotal > progress.dueToday && <p className="note">{t('home.backlog', { count: progress.backlogTotal })}</p>}
      {progress.newWordsPaused && <p className="note">{t('home.paused')}</p>}

      {nothing ? (
        <Link className="button primary" to={{ name: 'practice' }}>
          {t('home.practice')}
        </Link>
      ) : (
        <Link className="button primary" to={{ name: 'study', mode: null }}>
          {t('home.start')}
        </Link>
      )}

      {!nothing && (
        <nav className="one-way" aria-labelledby="one-way">
          <h2 id="one-way">{t('home.oneWay')}</h2>
          <ul>
            {modes.map((mode) => (
              <li key={mode}>
                <Link to={{ name: 'study', mode }}>{t(MODE_LABEL[mode])}</Link>
              </li>
            ))}
            <li>
              <Link to={{ name: 'practice' }}>{t('home.practice')}</Link>
            </li>
          </ul>
        </nav>
      )}

      <section className="motivation" aria-labelledby="motivation">
        <h2 id="motivation" className="visually-hidden">
          {t('progress.motivation')}
        </h2>
        <p>
          {streak.length > 0 ? t('home.streak', { count: streak.length }) : t('home.noStreak')}
          {streak.todayComplete && ` ${t('home.todayComplete')}`}
        </p>
        <p>{t('home.freezes', { count: streak.freezesLeft })}</p>
        <p>{t('home.xp', { today: xp.today, total: xp.total })}</p>
        {xp.provisional > 0 && <p className="note">{t('home.xpProvisional')}</p>}
      </section>
    </section>
  )
}
