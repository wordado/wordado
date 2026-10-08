import { useId, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'

/**
 * Updating by itself, and installing from settings whatever the day (spec §9.1). "Update automatically" is this
 * device's own (the lifecycle keeps it in the browser's storage): it is about this installation, and it has to
 * work in the demo and before any sync.
 */
export function AppSettings() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { installable, autoUpdate } = useStore(lifecycle.store)
  const hintId = useId()
  const [status, setStatus] = useState<string | null>(null)
  return (
    <section aria-labelledby="settings-app">
      <h2 id="settings-app">{t('settings.app')}</h2>
      <div className="field switch-field">
        <label className="check">
          <input
            type="checkbox"
            checked={autoUpdate}
            aria-describedby={hintId}
            onChange={(e) => {
              // A browser that keeps nothing still follows the switch, for this visit: say that, not "Saved".
              setStatus(t(lifecycle.setAutoUpdate(e.target.checked) ? 'settings.saved' : 'settings.autoUpdateNotKept'))
            }}
          />
          {t('settings.autoUpdate')}
        </label>
        <p className="note" id={hintId}>
          {t('settings.autoUpdateHint')}
        </p>
      </div>
      {installable !== null && (
        <>
          <p>{t(installable === 'ios' ? 'install.ios' : 'install.prompt')}</p>
          {installable === 'prompt' && (
            <button type="button" className="button" onClick={() => void lifecycle.install()}>
              {t('install.button')}
            </button>
          )}
        </>
      )}
      <p className="note" role="status">
        {status}
      </p>
    </section>
  )
}
