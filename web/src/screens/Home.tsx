import { useClientSnapshot } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { Flame, Headphones, Layers, ListChecks, type LucideIcon } from 'lucide-react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'
import { useOnline } from '../useOnline'
import { todayCounts } from './today'

const ONE_WAY = ['flashcard', 'multiple_choice', 'listening_select'] as const satisfies readonly Mode[]
const MODE_ICON: Readonly<Record<(typeof ONE_WAY)[number], LucideIcon>> = { flashcard: Layers, multiple_choice: ListChecks, listening_select: Headphones }

/** Today (spec §8.3): the capped due figure first, the backlog second, then the day's motivation. */
export function Home() {
  const { t } = useT()
  const { audio } = useApp()
  const { plan, progress, xp, settings } = useClientSnapshot()
  useOnline() // re-renders on every `online`/`offline` event, so `canListen` below is re-evaluated
  if (!plan || !progress) return null
  const { reviews, fresh, nothing } = todayCounts(plan)
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
          <h1 id="today" className="today">
            {nothing ? t('home.allDone') : reviews > 0 ? t('home.reviews', { count: reviews }) : t('home.newWords', { count: fresh })}
          </h1>
          {nothing && <p className="today-more">{t('home.allDoneHint')}</p>}
          {!nothing && reviews > 0 && fresh > 0 && <p className="today-more">{t('home.newWords', { count: fresh })}</p>}
          {progress.backlogTotal > progress.dueToday && <p className="note">{t('home.backlog', { count: progress.backlogTotal })}</p>}
          {progress.newWordsPaused && <p className="note">{t('home.paused')}</p>}
        </div>
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
