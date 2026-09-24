import '@fontsource-variable/golos-text'
import '@fontsource-variable/literata'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { dayToIsoDate, localDay } from '@wordado/core'
import { httpApi } from './account/api'
import { AccountController } from './account/controller'
import { accountStorage, browserStorage, pendingSignIn } from './account/storage'
import { httpTransport } from './account/transport'
import { Boot } from './app/boot'
import { noteInstallReport, refreshAudioOnActivation, startPackChecks } from './app/content'
import { AppLifecycle, watchUpdates, type InstallEvent } from './app/lifecycle'
import { Root } from './app/Root'
import { startSyncLoop } from './app/syncLoop'
import { AudioStore } from './content/audio'
import { fetchManifest, packFetcher, SAMPLE_MANIFEST_URL } from './content/packs'
import { webEnv } from './env'
import { I18nProvider } from './i18n/i18n'
import { writeInterfaceLanguage } from './reminders/prefs'
import { browserPushPlatform, ReminderService } from './reminders/reminders'
import { deleteDatabase, listDatabases } from './storage/erase'
import { TabLock } from './storage/tabLock'
import { openWorkerDriver } from './storage/workerDriver'

const env = webEnv()
const audio = new AudioStore({ manifestUrl: SAMPLE_MANIFEST_URL, sha256: env.sha256 })
const accounts = accountStorage()
/** The recorded learner: sync and reminders name them, so a session that is someone else's is refused (spec §8.6). */
const expectedUser = () => accounts.read()?.userId ?? null
const api = httpApi(undefined, expectedUser)
const reminders = new ReminderService({
  api,
  platform: browserPushPlatform(),
  storage: browserStorage('localStorage'),
  tzOffsetMin: env.tzOffsetMin,
  language: () => (document.documentElement.lang === 'en' ? 'en' : 'bg'),
})
let controller: AccountController | null = null
// A 401 from sync means the sign-in expired, a 409 that the session is another learner's (spec §8.6):
// either way the controller shows "sign in again" and the outbox waits.
const transport = httpTransport({ onUnauthorized: () => controller?.sessionExpired(), expectedUser })

const lifecycle = new AppLifecycle({ storage: browserStorage('localStorage'), reload: () => window.location.reload() })

const boot = new Boot(
  {
    env,
    l1: 'bg',
    accounts,
    openDriver: (file) => openWorkerDriver(file),
    deleteDatabase,
    listDatabases,
    transport: () => transport,
    startSync: (client, backend) => startSyncLoop(client, { everyAnswer: backend === 'memory', now: env.now }),
    fetchManifest: () => fetchManifest(SAMPLE_MANIFEST_URL),
    fetchPack: packFetcher(SAMPLE_MANIFEST_URL),
    // Before the app shows, so the first session already knows which clips can play (spec §9.3).
    prepare: async (client) => {
      if (client.snapshot.corpus) await audio.refresh(client.snapshot.corpus)
    },
    onReady: async (client) => {
      // The bundled sample's clips are fetched into the one audio cache (decision of plan 6b). Plan 7 narrows
      // this to the sample manifest once learners use the CDN's.
      if (navigator.onLine && client.snapshot.corpus) await audio.prefetch([...client.snapshot.corpus.clips.values()])
    },
    onInstallReport: (report) => noteInstallReport(report, lifecycle),
  },
  (release) => new TabLock({ release }),
)

// When a staged pack activates, re-read which clips are cached (6a contract).
let stopAudioWatch: (() => void) | null = null
boot.store.subscribe(() => {
  const state = boot.store.get()
  stopAudioWatch?.()
  stopAudioWatch = state.status === 'ready' ? refreshAudioOnActivation(state.client, audio) : null
  if (state.status === 'ready') lifecycle.recordVisit(dayToIsoDate(localDay(env.now(), env.tzOffsetMin())))
})

startPackChecks({
  client: () => {
    const state = boot.store.get()
    return state.status === 'ready' ? state.client : null
  },
  fetchManifest: () => fetchManifest(SAMPLE_MANIFEST_URL),
  fetchPack: packFetcher(SAMPLE_MANIFEST_URL),
  online: () => navigator.onLine,
  onReport: (report) => noteInstallReport(report, lifecycle),
})

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  lifecycle.installAvailable(event as unknown as InstallEvent)
})
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
if (ios && !standalone) lifecycle.iosInstallable()

controller = new AccountController({ api, boot, accounts, pending: pendingSignIn(), transport: () => transport, reminders })

// Back from Google (spec §8.6): finish the sign-in once the demo (or the learner's file) is open.
const returnUrl = new URL(window.location.href)
const signinResult = returnUrl.searchParams.get('signin')
if (signinResult === 'google' || signinResult === 'google-error') {
  returnUrl.searchParams.delete('signin')
  window.history.replaceState(null, '', `${returnUrl.pathname}${returnUrl.search}${returnUrl.hash}`)
  const unsubscribe = boot.store.subscribe(() => {
    if (boot.store.get().status !== 'ready') return
    unsubscribe()
    void controller?.resumeGoogle(signinResult === 'google' ? 'ok' : 'error').catch(() => undefined)
  })
}

let persistenceAsked = false

/** After a run: fetch ahead (spec §9.3), flush (spec §9.1), and ask once to keep storage (spec §9.1). */
function afterRun(): void {
  const state = boot.store.get()
  if (state.status === 'ready' && navigator.onLine) void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
  // A run is over: flush now (spec §9.1). The demo's Client has no transport, so this is a no-op there.
  if (state.status === 'ready') void state.client.sync().catch(() => undefined)
  if (!persistenceAsked) {
    persistenceAsked = true
    void navigator.storage?.persist?.().catch(() => false)
  }
}

window.addEventListener('online', () => {
  const state = boot.store.get()
  if (state.status === 'ready') void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
})

// At launch, once a signed-in learner is ready: resend the subscription (plan 5 contract).
const unsubscribeReminders = boot.store.subscribe(() => {
  const state = boot.store.get()
  if (state.status !== 'ready') return
  unsubscribeReminders()
  if (state.account) void reminders.refresh().catch(() => undefined)
})

// The provider calls this once on mount, with the language it just read: nothing changed yet, so
// nothing is resent then — boot may not even be ready, and `state.account` hasn't been checked.
let localeMounted = false

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider
      onLocale={(locale) => {
        void writeInterfaceLanguage(locale).catch(() => undefined)
        if (localeMounted) void reminders.refresh().catch(() => undefined)
        localeMounted = true
      }}
    >
      <Root boot={boot} services={{ env, audio, afterRun, api, accounts: controller!, reminders, lifecycle }} />
    </I18nProvider>
  </StrictMode>,
)

void boot.start()

// Offline after the first visit (spec §9.1), and "a new version is ready". Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(
    (registration) => watchUpdates(registration, navigator.serviceWorker, lifecycle),
    () => undefined,
  )
}
