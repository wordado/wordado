import '@fontsource-variable/golos-text'
import '@fontsource-variable/literata'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { httpApi } from './account/api'
import { AccountController } from './account/controller'
import { accountStorage, browserStorage, pendingSignIn } from './account/storage'
import { httpTransport } from './account/transport'
import { Boot } from './app/boot'
import { Root } from './app/Root'
import { startSyncLoop } from './app/syncLoop'
import { AudioStore } from './content/audio'
import { fetchManifest, packFetcher, SAMPLE_MANIFEST_URL } from './content/packs'
import { webEnv } from './env'
import { I18nProvider } from './i18n/i18n'
import { writeInterfaceLanguage } from './reminders/prefs'
import { browserPushPlatform, ReminderService } from './reminders/reminders'
import { deleteDatabase } from './storage/erase'
import { TabLock } from './storage/tabLock'
import { openWorkerDriver } from './storage/workerDriver'

const env = webEnv()
const audio = new AudioStore({ manifestUrl: SAMPLE_MANIFEST_URL, sha256: env.sha256 })
const accounts = accountStorage()
const api = httpApi()
const reminders = new ReminderService({
  api,
  platform: browserPushPlatform(),
  storage: browserStorage('localStorage'),
  tzOffsetMin: env.tzOffsetMin,
  language: () => (document.documentElement.lang === 'en' ? 'en' : 'bg'),
})
let controller: AccountController | null = null
// A 401 from sync means the sign-in expired (spec §8.6): the controller shows it and the outbox waits.
const transport = httpTransport({ onUnauthorized: () => controller?.sessionExpired() })

const boot = new Boot(
  {
    env,
    l1: 'bg',
    accounts,
    openDriver: (file) => openWorkerDriver(file),
    deleteDatabase,
    transport: () => transport,
    startSync: (client, backend) => startSyncLoop(client, { everyAnswer: backend === 'memory', now: env.now }),
    fetchManifest: () => fetchManifest(SAMPLE_MANIFEST_URL),
    fetchPack: packFetcher(SAMPLE_MANIFEST_URL),
    // Before the app shows, so the first session already knows which clips can play (spec §9.3).
    prepare: async (client) => {
      if (client.snapshot.corpus) await audio.refresh(client.snapshot.corpus)
    },
    onReady: async (client) => {
      if (navigator.onLine) await audio.prefetch(client.upcomingClips())
    },
  },
  (release) => new TabLock({ release }),
)

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider
      onLocale={(locale) => {
        void writeInterfaceLanguage(locale).catch(() => undefined)
        void reminders.refresh().catch(() => undefined)
      }}
    >
      <Root boot={boot} services={{ env, audio, afterRun, api, accounts: controller!, reminders }} />
    </I18nProvider>
  </StrictMode>,
)

void boot.start()

// Offline after the first visit (spec §9.1). Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}
