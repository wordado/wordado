import { useState } from 'react'
import { ConfirmDialog } from '../app/Confirm'
import { useApp } from '../app/context'
import { useSignOut } from '../app/signOut'
import { holdingUpdates, SAVE_HOLD_MS } from '../app/updateSafety'
import { saveFile } from '../download'
import { errorMessageKey } from '../errors'
import { ProgressBar } from '../app/ProgressBar'
import { useT } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

/** The account (spec §11): the export, signing out, and self-service deletion. The demo gets the way in. */
export function AccountSettings() {
  const { t } = useT()
  const { account, accounts, api, lifecycle } = useApp()
  const online = useOnline()
  const [deleting, setDeleting] = useState(false)
  const [understood, setUnderstood] = useState(false)
  const { signingOut, error: signOutError, start: signOut, dialog: unsyncedDialog } = useSignOut()
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

  /** The export names the recorded learner (x-wordado-user), so a session that is someone else's is refused (spec §11). */
  const exportData = async () => {
    setExportError(null)
    setExporting(true)
    try {
      // No automatic update while the export is fetched, wherever the learner goes, nor in the moments after the
      // file is handed to the browser: a reload then can cancel the save.
      await holdingUpdates(
        lifecycle,
        async () => {
          const file = await api.exportData()
          saveFile(file.name, file.json)
        },
        SAVE_HOLD_MS,
      )
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
              {exporting && <ProgressBar label={t('settings.exporting')} />}
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
          <button type="button" className="button" disabled={signingOut} onClick={() => void signOut()}>
            {t('settings.signOut')}
          </button>
          <p className="note" role="status">
            {signingOut ? t('settings.signingOut') : ''}
          </p>
          {signingOut && <ProgressBar label={t('settings.signingOut')} />}
          {signOutError !== null && (
            <p className="field-error" role="alert">
              {signOutError}
            </p>
          )}
        </li>
        <li>
          <button type="button" className="button" disabled={!online} onClick={() => setDeleting(true)}>
            {t('settings.delete')}
          </button>
          {!online && <p className="note">{t('settings.deleteOffline')}</p>}
        </li>
      </ul>
      {unsyncedDialog}
      {deleting && (
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
            setDeleting(false)
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
