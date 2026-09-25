import { useState } from 'react'
import { ConfirmDialog } from '../app/Confirm'
import { useApp } from '../app/context'
import { saveFile } from '../download'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

/** The account (spec §11): the export, signing out, and self-service deletion. The demo gets the way in. */
export function AccountSettings() {
  const { t } = useT()
  const { account, accounts, api } = useApp()
  const online = useOnline()
  const [dialog, setDialog] = useState<'unsynced' | 'delete' | null>(null)
  const [understood, setUnderstood] = useState(false)
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)

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
    setSigningOut(true)
    try {
      await signOut(false)
    } catch (err) {
      setSignOutError(t(errorMessageKey(err)))
    } finally {
      setSigningOut(false)
    }
  }

  /** The export names the recorded learner (x-wordado-user), so a session that is someone else's is refused (spec §11). */
  const exportData = async () => {
    setExportError(null)
    setExporting(true)
    try {
      const file = await api.exportData()
      saveFile(file.name, file.json)
    } catch (err) {
      setExportError(t(errorMessageKey(err)))
    } finally {
      setExporting(false)
    }
  }

  return (
    <section aria-labelledby="settings-account">
      <h2 id="settings-account">{t('settings.account')}</h2>
      <p>{t('settings.signedInAs', { email: account.email })}</p>
      <ul className="settings-actions">
        <li>
          {online ? (
            <>
              <button type="button" className="button" disabled={exporting} onClick={() => void exportData()}>
                {t('settings.export')}
              </button>
              <p className="note" role="status">
                {exporting ? t('settings.exporting') : ''}
              </p>
              {exportError !== null && (
                <p className="field-error" role="alert">
                  {exportError}
                </p>
              )}
            </>
          ) : (
            <span className="note">{t('settings.exportOffline')}</span>
          )}
        </li>
        <li>
          <button type="button" className="button" disabled={signingOut} onClick={() => void signOutFromButton()}>
            {t('settings.signOut')}
          </button>
          <p className="note" role="status">
            {signingOut ? t('settings.signingOut') : ''}
          </p>
          {signOutError !== null && (
            <p className="field-error" role="alert">
              {signOutError}
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
