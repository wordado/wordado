import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'

/** Installing from settings, whatever the day (spec §9.1). Hidden when there is nothing to offer. */
export function AppSettings() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { installable } = useStore(lifecycle.store)
  if (installable === null) return null
  return (
    <section aria-labelledby="settings-app">
      <h2 id="settings-app">{t('settings.app')}</h2>
      <p>{t(installable === 'ios' ? 'install.ios' : 'install.prompt')}</p>
      {installable === 'prompt' && (
        <button type="button" className="button" onClick={() => void lifecycle.install()}>
          {t('install.button')}
        </button>
      )}
    </section>
  )
}
