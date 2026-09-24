import { useState } from 'react'
import { EXPORT_URL } from '../account/api'
import { ConfirmDialog } from '../app/Confirm'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** The account (spec §11): the export, signing out, and self-service deletion. The demo gets the way in. */
export function AccountSettings() {
  const { t } = useT()
  const { account, accounts } = useApp()
  const online = useOnline()
  const [dialog, setDialog] = useState<'unsynced' | 'delete' | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)

  if (account === null) {
    return (
      <section aria-labelledby="settings-account">
        <h2 id="settings-account">{t('settings.account')}</h2>
        <p>{t('settings.demo')}</p>
        <Link className="button primary" to={{ name: 'signin' }}>
          {t('banner.demoCreate')}
        </Link>
      </section>
    )
  }

  const signOut = async (force: boolean) => {
    const outcome = await accounts.signOut({ force })
    if (outcome === 'unsynced') setDialog('unsynced')
    else navigate({ name: 'home' }, { replace: true })
  }

  const signOutFromButton = async () => {
    setSignOutError(null)
    try {
      await signOut(false)
    } catch (err) {
      setSignOutError(messageOf(err))
    }
  }

  return (
    <section aria-labelledby="settings-account">
      <h2 id="settings-account">{t('settings.account')}</h2>
      <p>{t('settings.signedInAs', { email: account.email })}</p>
      <ul className="settings-actions">
        <li>
          {online ? (
            <a href={EXPORT_URL} download>
              {t('settings.export')}
            </a>
          ) : (
            <span className="note">{t('settings.exportOffline')}</span>
          )}
        </li>
        <li>
          <button type="button" className="button" onClick={() => void signOutFromButton()}>
            {t('settings.signOut')}
          </button>
          {signOutError !== null && (
            <p className="field-error" role="alert">
              {t('confirm.failed', { message: signOutError })}
            </p>
          )}
        </li>
        <li>
          <button type="button" className="button" disabled={!online} onClick={() => setDialog('delete')}>
            {t('settings.delete')}
          </button>
          {!online && <p className="note">{t('settings.deleteOffline')}</p>}
        </li>
      </ul>
      {dialog === 'unsynced' && (
        <ConfirmDialog
          title={t('settings.unsyncedTitle')}
          body={<p>{t('settings.unsyncedBody')}</p>}
          confirmLabel={t('settings.unsyncedConfirm')}
          onConfirm={() => signOut(true)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('settings.deleteTitle')}
          body={<p>{t('settings.deleteBody')}</p>}
          confirmLabel={t('settings.deleteConfirm')}
          confirmDisabled={!understood}
          onConfirm={async () => {
            await accounts.deleteAccount()
            navigate({ name: 'home' }, { replace: true })
          }}
          onClose={() => {
            setDialog(null)
            setUnderstood(false)
          }}
        >
          <label className="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            {t('settings.deleteUnderstand')}
          </label>
        </ConfirmDialog>
      )}
    </section>
  )
}
