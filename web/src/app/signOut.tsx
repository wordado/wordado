import { useState } from 'react'
import { errorMessageKey } from '../errors'
import { useT } from '../i18n/i18n'
import { navigate } from '../router'
import { ConfirmDialog } from './Confirm'
import { useApp } from './context'
import { useUpdateHold } from './updateSafety'

/**
 * Signing out as every button that offers it does (spec §11): answers that
 * could not be synced are confirmed first, a failure is kept to show, and a
 * signed-out learner lands on today.
 */
export function useSignOut() {
  const { t } = useT()
  const { accounts } = useApp()
  const [signingOut, setSigningOut] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsynced, setUnsynced] = useState(false)
  useUpdateHold(signingOut)

  const signOut = async (force: boolean) => {
    const outcome = await accounts.signOut({ force })
    if (outcome === 'unsynced') setUnsynced(true)
    else navigate({ name: 'home' }, { replace: true })
  }

  const start = async () => {
    setError(null)
    setSigningOut(true)
    try {
      await signOut(false)
    } catch (err) {
      setError(t(errorMessageKey(err)))
    } finally {
      setSigningOut(false)
    }
  }

  const dialog = unsynced && (
    <ConfirmDialog
      title={t('settings.unsyncedTitle')}
      body={<p>{t('settings.unsyncedBody')}</p>}
      confirmLabel={t('settings.unsyncedConfirm')}
      onConfirm={() => signOut(true)}
      onClose={() => setUnsynced(false)}
    />
  )

  return { signingOut, error, start, dialog }
}
