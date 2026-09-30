import { useClientSnapshot } from '@wordado/client-data'
import type { MasteryTier } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

const TIERS: readonly MasteryTier[] = ['new', 'learning', 'young', 'mature']

/** The four metrics of spec §8.3, with motivation kept apart from learning. */
export function Progress() {
  const { t } = useT()
  const { progress, xp } = useClientSnapshot()
  if (!progress) return null
  const total = TIERS.reduce((sum, tier) => sum + progress.tiers[tier], 0)
  return (
    <section className="progress" aria-labelledby="progress-title">
      <h1 id="progress-title">{t('progress.title')}</h1>

      <div className="progress-main">
        <section className="panel progress-words" aria-labelledby="tiers">
          <div className="panel-head">
            <h2 id="tiers">{t('progress.tiers')}</h2>
            <p className="note">{t('progress.total', { count: total })}</p>
          </div>
          {/* The tiles below carry the numbers; the bar is their picture, one green from new to mature. */}
          <div className="tier-bar" aria-hidden="true">
            {TIERS.filter((tier) => progress.tiers[tier] > 0).map((tier) => (
              <span
                key={tier}
                className={`tier-${tier}`}
                style={{ flexGrow: progress.tiers[tier] }}
                data-tip={`${t(TIER_LABEL[tier])}: ${progress.tiers[tier]}`}
              />
            ))}
          </div>
          <dl className="tiers">
            {TIERS.map((tier) => (
              <div key={tier} className={`tier tier-${tier}`}>
                <dt>
                  <span className="tier-swatch" aria-hidden="true" />
                  {t(TIER_LABEL[tier])}
                </dt>
                <dd>{progress.tiers[tier]}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="panel" aria-labelledby="levels">
          <h2 id="levels">{t('progress.levels')}</h2>
          <ul className="levels">
            {Object.entries(progress.levels).map(([level, completion]) => {
              const summary =
                completion.kind === 'skipped' ? t('path.skipped') : t('path.levelProgress', { mature: completion.mature, live: completion.live })
              return (
                <li key={level} className="level-row">
                  <span className="level-code">{level}</span>
                  <div className="level-progress">
                    {completion.kind !== 'skipped' && (
                      <div
                        className="bar is-leaf"
                        role="progressbar"
                        aria-label={`${level}: ${summary}`}
                        aria-valuemin={0}
                        aria-valuemax={completion.live}
                        aria-valuenow={completion.mature}
                      >
                        <span style={{ width: `${completion.live > 0 ? (100 * completion.mature) / completion.live : 0}%` }} />
                      </div>
                    )}
                    <p className="note">{summary}</p>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div className="progress-side">
        <section className="panel progress-retention" aria-labelledby="retention">
          <h2 id="retention">{t('progress.retention')}</h2>
          {progress.retention === null ? (
            <p className="stat">{t('progress.retentionNone')}</p>
          ) : (
            <>
              <p className="hero-figure">{Math.round(progress.retention * 100)}%</p>
              <p>{t('progress.retentionPeriod')}</p>
            </>
          )}
          <p className="note">{t('progress.retentionHint')}</p>
        </section>

        <section className="panel" aria-labelledby="motivation">
          <h2 id="motivation">{t('progress.motivation')}</h2>
          <dl className="stat-tiles">
            <div className="stat-tile is-streak">
              <dt>{t('progress.streak')}</dt>
              <dd>{t('progress.streakDays', { count: progress.streak.length })}</dd>
            </div>
            <div className="stat-tile">
              <dt>{t('progress.freezesLeft')}</dt>
              <dd>{progress.streak.freezesLeft}</dd>
            </div>
            <div className="stat-tile">
              <dt>{t('progress.xpToday')}</dt>
              <dd>{xp.today}</dd>
            </div>
            <div className="stat-tile">
              <dt>{t('progress.xpTotal')}</dt>
              <dd>{xp.total}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  )
}
