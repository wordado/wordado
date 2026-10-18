import { useClientSnapshot } from '@wordado/client-data'
import { corpusWordId, studyUnits, themeEntries } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'
import { Link } from '../router'
import { AccountGives } from './AccountGives'

/** Stands for the theme's name while the sentence is cut around it, so the name can be a link (#290). */
const NAME = '\u0000'

/** Where a trial ends (spec 2026-10-12 §4.4): every word of its unit is started, and an account is the way on, with what it gives (#289). When the demo's open theme was not chosen, its words are still there to try, and that line stands in place of the first (#290). */
export function TrialInvite(props: { /** The class of a line of the screen it stands on, so it reads as one of them. */ readonly line: string }) {
  const { t, locale } = useT()
  const { corpus, path, settings, states, flags } = useClientSnapshot()
  const openTheme = path?.trialOpenTheme == null ? undefined : corpus?.themes.find((theme) => theme.themeId === path.trialOpenTheme)
  // The demo's words: its unit, and the open theme's when it was chosen. Some may have been set aside (Known, Not now)
  // rather than started, and then "started every word" would not be true (#234).
  const chosenTheme = corpus?.trial?.openTheme != null && settings.activeTheme === corpus.trial.openTheme ? corpus.trial.openTheme : null
  const words = corpus ? [...studyUnits(corpus, settings.declaredLevel).flatMap((u) => u.wordIds), ...(chosenTheme ? themeEntries(corpus, chosenTheme).map((e) => corpusWordId(e.entryId)) : [])] : []
  const setAside = words.some((id) => flags.has(id) && !states.has(id))
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
        <p className={props.line}>{t(setAside ? 'trial.finishedAside' : 'trial.finished')}</p>
      )}
      <AccountGives />
      <p className={props.line}>
        {t('trial.invite')} <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
      </p>
    </>
  )
}
