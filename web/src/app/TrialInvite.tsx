import { useT } from '../i18n/i18n'
import { Link } from '../router'

/** Where a trial ends (spec 2026-10-12 §4.4): every word of its unit is started, and an account is the way on. */
export function TrialInvite(props: { /** The class of a line of the screen it stands on, so it reads as one of them. */ readonly line: string }) {
  const { t } = useT()
  return (
    <>
      <p className={props.line}>{t('trial.finished')}</p>
      <p className={props.line}>
        {t('trial.invite')} <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
      </p>
    </>
  )
}
