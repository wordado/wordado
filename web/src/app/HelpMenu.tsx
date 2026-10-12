import { ExternalLink } from 'lucide-react'
import { useEffect, useId } from 'react'
import { useT } from '../i18n/i18n'
import { Link, onNavigation, useFeedbackRoute, useRoute } from '../router'
import { useOnline } from '../useOnline'
import { LanguageChoices } from './LanguageMenu'
import { guidePageUrl, guideSlug, guideUrl } from './site'
import { usePopover } from './usePopover'

/**
 * Help, in the masthead once the setup is done (#243): a circle with a question mark that opens the guide's page
 * about the screen the learner is on (where the guide has one), the whole guide, the form to write to us, and the
 * interface language. The guide is on the website and opens in a new tab, so the app stays where it was; it is not
 * kept on the device, so offline those two say so and are no links. Writing and the language work offline.
 */
export function HelpMenu() {
  const { t, locale } = useT()
  const { open, close, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()
  const online = useOnline()
  const slug = guideSlug(useRoute())
  const feedback = useFeedbackRoute()
  const languages = useId()

  // The panel closes behind a navigation; "Write to us" pressed on the form itself changes no route, and closes it too.
  useEffect(() => (open ? onNavigation(close) : undefined), [open])

  const about = slug !== null && (
    <>
      <span className="help-title">{t('help.about')}</span>
      <span className="note">{t(`help.topic.${slug}`)}</span>
    </>
  )
  return (
    <div className="help" ref={root} onKeyDown={onKeyDown}>
      <button ref={trigger} type="button" className="help-circle" aria-label={t('help.button')} {...triggerProps}>
        <span aria-hidden="true">?</span>
      </button>
      {open && (
        <div className="popover-panel help-panel" id={panelId}>
          <ul className="help-list">
            {slug !== null && (
              <li>
                {online ? (
                  <a className="help-item" href={guidePageUrl(slug, locale)} target="_blank" rel="noopener">
                    <span className="help-text">{about}</span>
                    <ExternalLink aria-hidden="true" size={18} />
                  </a>
                ) : (
                  <div className="help-item is-off">
                    <span className="help-text">{about}</span>
                  </div>
                )}
              </li>
            )}
            <li>
              {online ? (
                <a className="help-item" href={guideUrl(locale)} target="_blank" rel="noopener">
                  <span className="help-title">{t('help.all')}</span>
                  <ExternalLink aria-hidden="true" size={18} />
                </a>
              ) : (
                <div className="help-item is-off">
                  <span className="help-text">
                    <span className="help-title">{t('help.all')}</span>
                    <span className="note">{t('settings.helpOffline')}</span>
                  </span>
                </div>
              )}
            </li>
            <li>
              <Link className="help-item" to={feedback}>
                <span className="help-title">{t('feedback.open')}</span>
              </Link>
            </li>
          </ul>
          <p className="help-heading" id={languages}>
            {t('lang.label')}
          </p>
          <LanguageChoices className="language-panel" aria-labelledby={languages} onChoose={close} />
        </div>
      )}
    </div>
  )
}
