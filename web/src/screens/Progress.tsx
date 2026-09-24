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
    <section aria-labelledby="progress-title">
      <h1 id="progress-title">{t('progress.title')}</h1>

      <section aria-labelledby="tiers">
        <h2 id="tiers">{t('progress.tiers')}</h2>
        <div className="tier-bar" aria-hidden="true">
          {TIERS.map((tier) => (
            <span key={tier} className={`tier-${tier}`} style={{ flexGrow: total === 0 ? 0 : progress.tiers[tier] }} />
          ))}
        </div>
        <dl className="tiers">
          {TIERS.map((tier) => (
            <div key={tier} className={`tier tier-${tier}`}>
              <dt>{t(TIER_LABEL[tier])}</dt>
              <dd>{progress.tiers[tier]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="levels">
        <h2 id="levels">{t('progress.levels')}</h2>
        <dl className="levels">
          {Object.entries(progress.levels).map(([level, completion]) => (
            <div key={level}>
              <dt className="level-code">{level}</dt>
              <dd>
                {completion.kind === 'skipped'
                  ? t('path.skipped')
                  : t('path.levelProgress', { mature: completion.mature, live: completion.live })}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">{t('progress.retention')}</h2>
        <p className="stat">
          {progress.retention === null
            ? t('progress.retentionNone')
            : t('progress.retentionValue', { percent: Math.round(progress.retention * 100) })}
        </p>
        <p className="note">{t('progress.retentionHint')}</p>
      </section>

      <section aria-labelledby="motivation">
        <h2 id="motivation">{t('progress.motivation')}</h2>
        <p>{progress.streak.length > 0 ? t('home.streak', { count: progress.streak.length }) : t('home.noStreak')}</p>
        <p>{t('home.freezes', { count: progress.streak.freezesLeft })}</p>
        <p>{t('home.xp', { today: xp.today, total: xp.total })}</p>
      </section>
    </section>
  )
}
