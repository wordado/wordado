import { useClientSnapshot } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'

const ONE_WAY: readonly Mode[] = ['flashcard', 'multiple_choice']

/** Extra practice (spec §7.4): outside the schedule, at reduced XP, never touching review state. */
export function Practice() {
  const { t } = useT()
  const { states } = useClientSnapshot()
  return (
    <section aria-labelledby="practice-title">
      <h1 id="practice-title">{t('practice.title')}</h1>
      <p className="lede">{t('practice.intro')}</p>
      {states.size === 0 ? (
        <p>{t('practice.noneYet')}</p>
      ) : (
        <ul className="practice-list">
          <li>
            <Link className="button primary" to={{ name: 'practice-words', mode: null }}>
              {t('home.practice')}
            </Link>
          </li>
          {ONE_WAY.map((mode) => (
            <li key={mode}>
              <Link to={{ name: 'practice-words', mode }}>{t(MODE_LABEL[mode])}</Link>
            </li>
          ))}
          <li>
            <Link to={{ name: 'matching' }}>{t('practice.matching')}</Link>
          </li>
        </ul>
      )}
    </section>
  )
}
