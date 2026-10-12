import { ClientProvider, useClientSnapshot, type Store } from '@wordado/client-data'
import { useState } from 'react'
import { trialLevelMark, type TrialLevelMark } from '../account/storage'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'
import { App } from './App'
import type { Boot, BootState } from './boot'
import { AppProvider, type AppServices } from './context'
import { ProgressBar } from './ProgressBar'

/** A pack the app is waiting for before it can open (spec §9.3): bytes read of the size its manifest states. */
export interface OpeningDownload {
  readonly received: number
  readonly total: number
}

const NO_DOWNLOAD: Store<OpeningDownload | null> = { get: () => null, set: () => undefined, subscribe: () => () => undefined }

/**
 * The open app, and who is asked for a level on the home screen (`LevelAsk`), once: a learner whose demo was carried
 * into the account, and a visitor whose device got the trial pack after it had finished its setup on the bundled
 * sample (spec 2026-10-12 §4.6). The device remembers the second in `mark`; a setup that finishes sets it too, since
 * its own level step has asked.
 */
function Opened(props: { readonly boot: Boot; readonly state: Extract<BootState, { status: 'ready' }>; readonly mark: TrialLevelMark }) {
  const { boot, state, mark } = props
  const { corpus } = useClientSnapshot()
  const [asked, setAsked] = useState(() => mark.read())
  const remember = () => {
    mark.set()
    setAsked(true)
  }
  const carried = state.account?.askLevel === true
  const visitor = state.account === null && corpus !== null && corpus.trial !== null && !asked
  return (
    <App
      resumed={state.resumed}
      setup={state.setup}
      onFinishSetup={() => {
        remember()
        boot.finishSetup()
      }}
      askLevel={carried || visitor}
      onLevelAsked={() => (carried ? boot.levelAsked() : remember())}
    />
  )
}

/** Renders the boot state: starting (with the pack it is fetching, if any), open in another tab, failed, or the app. */
export function Root(props: {
  readonly boot: Boot
  readonly services: Omit<AppServices, 'backend' | 'account'>
  /** Set while the opening app downloads a pack; a pack fetched behind an open app is never here. */
  readonly download?: Store<OpeningDownload | null>
  /** Where the device keeps that it asked a visitor for a level; the browser's own storage unless a test says otherwise. */
  readonly trialLevel?: TrialLevelMark
}) {
  const { t } = useT()
  const state = useStore(props.boot.store)
  const download = useStore(props.download ?? NO_DOWNLOAD)
  const [mark] = useState(() => props.trialLevel ?? trialLevelMark())
  switch (state.status) {
    case 'ready':
      return (
        <ClientProvider client={state.client}>
          <AppProvider value={{ ...props.services, backend: state.backend, account: state.account }}>
            <Opened boot={props.boot} state={state} mark={mark} />
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
