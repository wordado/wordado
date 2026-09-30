import { useClient, useClientSnapshot } from '@wordado/client-data'
import { offeredThemes, type Mode } from '@wordado/core'
import { Flame, Headphones, Layers, ListChecks, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { errorMessageKey } from '../errors'
import { localized, useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'
import { useOnline } from '../useOnline'

const ONE_WAY = ['flashcard', 'multiple_choice', 'listening_select'] as const satisfies readonly Mode[]
const MODE_ICON: Readonly<Record<(typeof ONE_WAY)[number], LucideIcon>> = { flashcard: Layers, multiple_choice: ListChecks, listening_select: Headphones }

/** Today (spec §8.3): the capped due figure first, the backlog second, then the day's motivation. */
export function Home() {
  const { t, locale } = useT()
  const { audio } = useApp()
  const client = useClient()
  const { plan, progress, xp, states, settings, corpus } = useClientSnapshot()
  useOnline() // re-renders on every `online`/`offline` event, so `canListen` below is re-evaluated
  const [skipped, setSkipped] = useState(false)
  const [themeError, setThemeError] = useState<string | null>(null)
  const today = useRef<HTMLHeadingElement>(null)
  /** Set by a choice or Skip: the block, and the button pressed, go, so focus moves to Today's heading (spec §11.1). */
  const leaving = useRef(false)
  const onboarding = !skipped && states.size === 0 && settings.activeTheme === null && corpus !== null && offeredThemes(corpus).length > 0
  useEffect(() => {
    if (onboarding || !leaving.current) return
    leaving.current = false
    today.current?.focus()
  }, [onboarding])
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
      <div className="panel home-main">
        <div className="today-head">
          <p className="eyebrow" aria-hidden="true">
            {t('nav.home')}
          </p>
          <h1 id="today" className="today" ref={today} tabIndex={-1}>
            {nothing ? t('home.allDone') : reviews > 0 ? t('home.reviews', { count: reviews }) : t('home.newWords', { count: fresh })}
          </h1>
          {nothing && <p className="today-more">{t('home.allDoneHint')}</p>}
          {!nothing && reviews > 0 && fresh > 0 && <p className="today-more">{t('home.newWords', { count: fresh })}</p>}
          {progress.backlogTotal > progress.dueToday && <p className="note">{t('home.backlog', { count: progress.backlogTotal })}</p>}
          {progress.newWordsPaused && <p className="note">{t('home.paused')}</p>}
        </div>
        {onboarding && corpus && (
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
                      leaving.current = true
                      client.updateSettings({ activeTheme: theme.themeId }).then(
                        () => setThemeError(null),
                        (err: unknown) => {
                          leaving.current = false
                          setThemeError(t('settings.saveFailed', { message: t(errorMessageKey(err)) }))
                        },
                      )
                    }}
                  >
                    {localized(theme.name, locale)}
                  </button>
                </li>
              ))}
            </ul>
            {themeError && <p role="alert">{themeError}</p>}
            <button
              type="button"
              className="link-button"
              onClick={() => {
                leaving.current = true
                setSkipped(true)
              }}
            >
              {t('onboard.skip')}
            </button>
          </div>
        )}

        <div className="home-actions">
          {nothing ? (
            <Link className="button primary" to={{ name: 'practice' }}>
              {t('home.practice')}
            </Link>
          ) : (
            <>
              <Link className="button primary" to={{ name: 'study', mode: null }}>
                {t('home.start')}
              </Link>
              <Link className="button" to={{ name: 'practice' }}>
                {t('home.practice')}
              </Link>
            </>
          )}
        </div>

        {!nothing && (
          <nav className="one-way" aria-labelledby="one-way">
            <h2 id="one-way">{t('home.oneWay')}</h2>
            <ul>
              {modes.map((mode) => {
                const Icon = MODE_ICON[mode]
                return (
                  <li key={mode}>
                    <Link className="tile" to={{ name: 'study', mode }}>
                      <Icon aria-hidden="true" size={22} strokeWidth={1.75} />
                      <span>{t(MODE_LABEL[mode])}</span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </nav>
        )}
      </div>

      <section className="panel motivation" aria-labelledby="motivation">
        <h2 id="motivation">{t('progress.motivation')}</h2>
        <div className="streak">
          <span className="streak-badge" aria-hidden="true">
            <Flame size={24} strokeWidth={1.75} />
          </span>
          <p>
            {streak.length > 0 ? t('home.streak', { count: streak.length }) : t('home.noStreak')}
            {streak.todayComplete && <span className="today-counts"> {t('home.todayComplete')}</span>}
          </p>
        </div>
        <p>{t('home.xp', { today: xp.today, total: xp.total })}</p>
        <p>{t('home.freezes', { count: streak.freezesLeft })}</p>
        {xp.provisional > 0 && <p className="note">{t('home.xpProvisional')}</p>}
      </section>
    </section>
  )
}
