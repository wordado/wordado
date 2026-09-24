import { ClientProvider } from '@wordado/client-data'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'
import { App } from './App'
import type { Boot } from './boot'
import { AppProvider, type AppServices } from './context'

/** Renders the boot state: starting, open in another tab, failed, or the app. */
export function Root(props: { readonly boot: Boot; readonly services: Omit<AppServices, 'backend'> }) {
  const { t } = useT()
  const state = useStore(props.boot.store)
  switch (state.status) {
    case 'ready':
      return (
        <ClientProvider client={state.client}>
          <AppProvider value={{ ...props.services, backend: state.backend }}>
            <App />
          </AppProvider>
        </ClientProvider>
      )
    case 'elsewhere':
      return (
        <main className="notice">
          <h1>{t('tab.elsewhere')}</h1>
          <p>{t('tab.elsewhereHint')}</p>
          <button type="button" className="button primary" onClick={() => void props.boot.takeOver()}>
            {t('tab.takeOver')}
          </button>
        </main>
      )
    case 'failed':
      return (
        <main className="notice">
          <h1>{t('boot.failed')}</h1>
          <button type="button" className="button primary" onClick={() => void props.boot.retry()}>
            {t('boot.retry')}
          </button>
        </main>
      )
    default:
      return (
        <main className="notice">
          <p role="status">{t('boot.starting')}</p>
        </main>
      )
  }
}
