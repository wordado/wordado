import { useEffect, useId, useRef, useState } from 'react'
import { useT } from '../i18n/i18n'
import { Link, useRoute } from '../router'
import { SyncLine, useSyncMessage } from './Banners'
import { useApp } from './context'
import { useSignOut } from './signOut'

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
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const circle = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const route = useRoute()

  // Choosing an item navigates; the menu closes behind it.
  useEffect(() => setOpen(false), [route])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !root.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])

  if (account === null) {
    return (
      <Link className="button account-signin" to={{ name: 'signin' }}>
        {t('account.signIn')}
      </Link>
    )
  }

  const warning = message?.tone === 'warning' ? t(message.key, message.vars) : null
  const close = () => {
    setOpen(false)
    circle.current?.focus()
  }

  return (
    <div
      className="account"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) close()
      }}
    >
      <button
        ref={circle}
        type="button"
        className="account-circle"
        aria-label={warning === null ? t('account.label', { email: account.email }) : t('account.labelWarning', { email: account.email, warning })}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span aria-hidden="true">{account.email.charAt(0).toUpperCase()}</span>
        {warning !== null && <span className="account-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div className="account-panel" id={panelId}>
          <p className="account-email">{account.email}</p>
          <SyncLine />
          <ul>
            <li>
              <Link to={{ name: 'settings' }}>{t('account.settings')}</Link>
            </li>
            <li>
              <button type="button" className="link-button" disabled={signingOut} onClick={() => void signOut()}>
                {t('settings.signOut')}
              </button>
              <p className="note" role="status">
                {signingOut ? t('settings.signingOut') : ''}
              </p>
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
