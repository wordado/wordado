import { useClientSnapshot } from '@wordado/client-data'
import { localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { AccountGives } from './AccountGives'

/** Stands for the theme's name while the sentence is cut around it, so the name can be a link (#290). */
const NAME = '\u0000'

/** Where a trial ends (spec 2026-10-12 §4.4): every word of its unit is started, and an account is the way on, with what it gives (#289). When the demo's open theme was not chosen, its words are still there to try, and that line stands in place of the first (#290). */
export function TrialInvite(props: { /** The class of a line of the screen it stands on, so it reads as one of them. */ readonly line: string }) {
  const { t, locale } = useT()
  const { corpus, path } = useClientSnapshot()
  const openTheme = path?.trialOpenTheme == null ? undefined : corpus?.themes.find((theme) => theme.themeId === path.trialOpenTheme)
  const [before = '', after = ''] = openTheme ? t('trial.openTheme', { name: NAME }).split(NAME) : []
  return (
    <>
      {openTheme ? (
        <p className={props.line}>
          {before}
          <Link to={{ name: 'theme', themeId: openTheme.themeId }}>{localized(openTheme.name, locale, corpus!.l1)}</Link>
          {after}
        </p>
      ) : (
        <p className={props.line}>{t('trial.finished')}</p>
      )}
      <AccountGives />
      <p className={props.line}>
        {t('trial.invite')} <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
      </p>
    </>
  )
}
