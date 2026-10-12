import { useT } from '../i18n/i18n'
import { Link } from '../router'

/** Where a trial ends (spec 2026-10-12 §4.4): every word of its unit is started, and an account is the way on. */
export function TrialInvite() {
  const { t } = useT()
  return (
    <div className="trial-invite">
      <p>{t('trial.finished')}</p>
      <p>
        {t('trial.invite')} <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
      </p>
    </div>
  )
}
