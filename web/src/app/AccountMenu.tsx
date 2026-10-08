import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { SyncLine, useSyncMessage } from './Banners'
import { useApp } from './context'
import { ProgressBar } from './ProgressBar'
import { useSignOut } from './signOut'
import { usePopover } from './usePopover'

/**
 * Who is signed in, at the end of the masthead: a circle with the first
 * letter of the email that opens a small menu (the email, what sync is doing,
 * the account settings, signing out). A sync warning marks the circle so it
 * is not hidden in the closed menu. The demo gets the way in instead.
 */
export function AccountMenu() {
  const { t } = useT()
  const { account } = useApp()
  const message = useSyncMessage()
  const { signingOut, error, start: signOut, dialog } = useSignOut()
  const { open, root, trigger, onKeyDown, triggerProps, panelId } = usePopover()

  if (account === null) {
    return (
      <Link className="button account-signin" to={{ name: 'signin' }}>
        {t('account.signIn')}
      </Link>
    )
  }

  const warning = message?.tone === 'warning' ? t(message.key, message.vars) : null
  return (
    <div className="account" ref={root} onKeyDown={onKeyDown}>
      <button
        ref={trigger}
        type="button"
        className="account-circle"
        aria-label={warning === null ? t('account.label', { email: account.email }) : t('account.labelWarning', { email: account.email, warning })}
        {...triggerProps}
      >
        <span aria-hidden="true">{account.email.charAt(0).toUpperCase()}</span>
        {warning !== null && <span className="account-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="popover-panel account-panel" id={panelId}>
          <p className="account-email">{account.email}</p>
          <SyncLine />
          <ul>
            <li>
              <Link to={{ name: 'settings', section: 'account' }}>{t('account.settings')}</Link>
            </li>
            <li>
              <button type="button" className="link-button" disabled={signingOut} onClick={() => void signOut()}>
                {t('settings.signOut')}
              </button>
              <p className="note" role="status">
                {signingOut ? t('settings.signingOut') : ''}
              </p>
              {signingOut && <ProgressBar label={t('settings.signingOut')} />}
              {error !== null && (
                <p className="field-error" role="alert">
                  {error}
                </p>
              )}
            </li>
          </ul>
        </div>
      )}
      {dialog}
    </div>
  )
}
