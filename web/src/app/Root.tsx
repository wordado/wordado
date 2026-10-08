import { ClientProvider, type Store } from '@wordado/client-data'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'
import { App } from './App'
import type { Boot } from './boot'
import { AppProvider, type AppServices } from './context'
import { ProgressBar } from './ProgressBar'

/** A pack the app is waiting for before it can open (spec §9.3): bytes read of the size its manifest states. */
export interface OpeningDownload {
  readonly received: number
  readonly total: number
}

const NO_DOWNLOAD: Store<OpeningDownload | null> = { get: () => null, set: () => undefined, subscribe: () => () => undefined }

/** Renders the boot state: starting (with the pack it is fetching, if any), open in another tab, failed, or the app. */
export function Root(props: {
  readonly boot: Boot
  readonly services: Omit<AppServices, 'backend' | 'account'>
  /** Set while the opening app downloads a pack; a pack fetched behind an open app is never here. */
  readonly download?: Store<OpeningDownload | null>
}) {
  const { t } = useT()
  const state = useStore(props.boot.store)
  const download = useStore(props.download ?? NO_DOWNLOAD)
  switch (state.status) {
    case 'ready':
      return (
        <ClientProvider client={state.client}>
          <AppProvider value={{ ...props.services, backend: state.backend, account: state.account }}>
            <App resumed={state.resumed} setup={state.setup} onFinishSetup={() => props.boot.finishSetup()} />
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
    case 'failed': {
      const key = state.reason === 'lock' ? 'boot.failedLock' : state.reason === 'storage' ? 'boot.failedStorage' : 'boot.failed'
      return (
        <main className="notice">
          <h1>{t(key)}</h1>
          <button type="button" className="button primary" onClick={() => void props.boot.retry()}>
            {t('boot.retry')}
          </button>
        </main>
      )
    }
    default:
      return (
        <main className="notice">
          <p role="status">{t(download ? 'boot.downloading' : 'boot.starting')}</p>
          {download ? <ProgressBar label={t('boot.downloading')} value={download.received} max={download.total} /> : <ProgressBar label={t('boot.starting')} />}
        </main>
      )
  }
}
