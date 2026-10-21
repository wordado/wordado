import '@fontsource-variable/golos-text'
import '@fontsource-variable/literata'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createStore } from '@wordado/client-data'
import { dayToIsoDate, localDay, validateCredits, validateFixes } from '@wordado/core'
import { httpApi } from './account/api'
import { AccountController } from './account/controller'
import { InterfaceLanguageReport } from './account/interfaceLanguage'
import { accountStorage, browserStorage } from './account/storage'
import { httpTransport } from './account/transport'
import { Boot, defaultL1 } from './app/boot'
import { noteInstallReport, refreshAudioOnActivation, startPackChecks } from './app/content'
import { watchContentFiles } from './app/contentFiles'
import { watchCourse } from './app/courseWatch'
import { Credits } from './app/credits'
import { FixNotices } from './app/fixNotices'
import { fetchLegalDates, LegalNotice } from './app/legalNotice'
import { AppLifecycle, AUTO_UPDATE_KEY, watchUpdates, type InstallEvent } from './app/lifecycle'
import { PackSwitcher } from './app/packSwitch'
import { Root, type OpeningDownload } from './app/Root'
import { startSyncLoop } from './app/syncLoop'
import { startUpdateChecks } from './app/updateChecks'
import { AudioStore } from './content/audio'
import { AudioSwitch } from './content/audioSwitch'
import { allowOnTap, sharedPlayer } from './content/player'
import { fetchManifest, manifestUrlFor, packFetcher, SAMPLE_MANIFEST_URL } from './content/packs'
import { fetchSibling } from './content/siblings'
import { webEnv } from './env'
import { I18nProvider, initialLocale, LOCALES, type Locale } from './i18n/i18n'
import { writeInterfaceLanguage } from './reminders/prefs'
import { browserPushPlatform, ReminderService } from './reminders/reminders'
import { deleteDatabase, listDatabases } from './storage/erase'
import { TabLock } from './storage/tabLock'
import { openWorkerDriver, terminateWorkerDrivers } from './storage/workerDriver'

const env = webEnv()
/** One AudioStore per manifest (a clip's URL is relative to it): a visitor's (the trial manifest when the build names one, the bundled sample otherwise) and a learner's CDN manifest (plan 7). */
/** Every clip plays on one element, which the learner's first tap starts: a phone lets no other play by itself (issue 266). */
const player = sharedPlayer()
allowOnTap(player)
const audio = new AudioSwitch((manifestUrl) => new AudioStore({ manifestUrl, sha256: env.sha256, player }), SAMPLE_MANIFEST_URL)
const accounts = accountStorage()
/** The recorded learner: sync and reminders name them, so a session that is someone else's is refused (spec §8.6). */
const expectedUser = () => accounts.read()?.userId ?? null
const api = httpApi(undefined, expectedUser)
const reminders = new ReminderService({
  api,
  platform: browserPushPlatform(),
  storage: browserStorage('localStorage'),
  tzOffsetMin: env.tzOffsetMin,
  // <html lang> is set from the interface locale (I18nProvider); an unrecognized value falls
  // back to English, consistent with English now being the default interface language.
  language: () => LOCALES.find((x) => x === document.documentElement.lang) ?? 'en',
})
/** The interface language once the interface has one (I18nProvider): what the server is told of (#199). */
let interfaceLanguage: Locale | null = null
const languageReport = new InterfaceLanguageReport({ api, storage: browserStorage('localStorage'), account: expectedUser, language: () => interfaceLanguage })
const sayLanguage = () => void languageReport.check()
let controller: AccountController | null = null
// A 401 from sync means the sign-in expired, a 409 that the session is another learner's (spec §8.6):
// either way the controller shows "sign in again" and the outbox waits.
const transport = httpTransport({ onUnauthorized: () => controller?.sessionExpired(), expectedUser })

const lifecycle = new AppLifecycle({
  storage: browserStorage('localStorage'),
  // "Wordado was updated." has to outlive the reload that updated it, in this tab only.
  session: browserStorage('sessionStorage'),
  reload: () => window.location.reload(),
  visible: () => document.visibilityState === 'visible',
  reloaded: () => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload',
})
// A hidden page does not ask whether it may update; it asks again when it is back.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') lifecycle.becameVisible()
})
// "Update automatically" switched in another tab of this browser.
window.addEventListener('storage', (event) => {
  if (event.key === AUTO_UPDATE_KEY || event.key === null) lifecycle.autoUpdateChanged()
})
/** The pack an opening app waits for (spec §9.3), for the starting screen's bar; cleared once the app is open. */
const openingDownload = createStore<OpeningDownload | null>(null)
/** The word data's attributions (plan 8b), for Settings › About. */
const credits = new Credits({
  storage: browserStorage('localStorage'),
  fetch: (url) => fetchSibling(url, 'credits.json', validateCredits),
})
/** What the learner reported that is fixed now (spec §8.10). */
const fixNotices = new FixNotices({ storage: browserStorage('localStorage'), fetchFixes: (url) => fetchSibling(url, 'fixes.json', validateFixes) })
/** The terms or the privacy policy changed since the learner last saw them (#184). */
const legalNotice = new LegalNotice({ storage: browserStorage('localStorage'), fetch: () => fetchLegalDates(), now: env.now, online: () => navigator.onLine })
/** The one place that installs a course's pack (plan 11, spec §8.6): the course watcher, the setup's Language step and Settings. */
const packs = new PackSwitcher({
  fetchManifest: (account, target) => fetchManifest(manifestUrlFor(account, target)),
  fetcher: (onProgress) => packFetcher(undefined, onProgress),
})

const boot = new Boot(
  {
    env,
    // Read at every open: the demo follows the interface's language, an account starts in Bulgarian (plan 10).
    l1: (account) => defaultL1(account, initialLocale(browserStorage('localStorage'))),
    accounts,
    openDriver: (file, signal) => openWorkerDriver(file, undefined, undefined, signal),
    terminateDrivers: terminateWorkerDrivers,
    deleteDatabase,
    listDatabases,
    transport: () => transport,
    startSync: (client, backend) => startSyncLoop(client, { everyAnswer: backend === 'memory', now: env.now }),
    fetchManifest: (account, target) => fetchManifest(manifestUrlFor(account, target)),
    // The app cannot open until this pack is in: its download is shown. The periodic check's is not (below).
    fetchPack: packFetcher(undefined, (received, total) => openingDownload.set({ received, total })),
    // Before the app shows, so the first session already knows which clips can play (spec §9.3).
    prepare: async (client, account) => {
      // The installed course's manifest: a clip's URL is relative to the manifest that listed its pack.
      audio.use(manifestUrlFor(account, client.course.target))
      if (client.snapshot.corpus) await audio.refresh(client.snapshot.corpus)
    },
    onReady: async (client) => {
      // The bundled sample's ~60 clips are fetched into the audio cache at once (decision of plan 6b), so the
      // demo listens offline from the first online visit; a CDN pack's clips come ahead of need (spec §9.3).
      if (audio.manifestUrl === SAMPLE_MANIFEST_URL && navigator.onLine && client.snapshot.corpus) {
        await audio.prefetch([...client.snapshot.corpus.clips.values()])
      }
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
  stopAudioWatch =
    state.status === 'ready'
      ? refreshAudioOnActivation(state.client, {
          // Another course's pack lists its clips relative to its own manifest (spec §5.1): the audio follows it.
          refresh: (corpus) => {
            audio.use(manifestUrlFor(state.account, corpus.target))
            return audio.refresh(corpus)
          },
        })
      : null
  if (state.status === 'ready') lifecycle.recordVisit(dayToIsoDate(localDay(env.now(), env.tzOffsetMin())))
})

// The starting screen's bar is for the pack that open is waiting on, and goes with it.
boot.store.subscribe(() => {
  if (boot.store.get().status !== 'starting' && openingDownload.get() !== null) openingDownload.set(null)
})

// The credits and "your report was fixed" follow the pack the learner has (plan 8b, Decision 6).
let stopContentWatch: (() => void) | null = null
boot.store.subscribe(() => {
  const state = boot.store.get()
  stopContentWatch?.()
  if (state.status === 'ready') {
    stopContentWatch = watchContentFiles(state.client, () => {
      const manifestUrl = manifestUrlFor(state.account, state.client.course.target)
      void credits.refresh(manifestUrl).catch(() => undefined)
      void fixNotices.check(state.client, manifestUrl).catch(() => undefined)
    })
  } else {
    // A sign-out or account switch: the previous account's notice must never linger under the demo or the next
    // account, and any check still in flight for it must be discarded (plan 8b review fix).
    stopContentWatch = null
    fixNotices.reset()
  }
})

// The one place that switches packs (plan 10, Decision 2; spec §8.6): whenever the learner's course setting (its
// target and its L1) differs from the installed course.
let stopCourseWatch: (() => void) | null = null
boot.store.subscribe(() => {
  const state = boot.store.get()
  stopCourseWatch?.()
  stopCourseWatch =
    state.status === 'ready'
      ? watchCourse(
          state.client,
          (course) => packs.install(state.client, state.account, course),
          () => navigator.onLine,
          (retry) => {
            window.addEventListener('online', retry)
            return () => window.removeEventListener('online', retry)
          },
        )
      : null
})

startPackChecks({
  client: () => {
    const state = boot.store.get()
    return state.status === 'ready' ? state.client : null
  },
  // Whoever is studying now: a visitor's trial manifest or the bundled sample, or the learner's CDN manifest; the
  // installed course's, whose newer packs `installPacks` looks for.
  fetchManifest: () => {
    const state = boot.store.get()
    return state.status === 'ready'
      ? fetchManifest(manifestUrlFor(state.account, state.client.course.target))
      : fetchManifest(manifestUrlFor(null, 'en'))
  },
  // Staged behind the open app, to swap in at the next session's start: no bar for it.
  fetchPack: packFetcher(),
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

controller = new AccountController({ api, boot, accounts, transport: () => transport, reminders })

// The server is told the account's interface language (#199) when it is not what this device last told it: after a
// sign-in (the app opens the learner's file), after a sign-in that had expired, and when the device is back online
// or the app back in front, for a change made offline. A sign-out makes it forget what it said.
boot.store.subscribe(() => {
  if (boot.store.get().status === 'ready') sayLanguage()
})
controller.store.subscribe(sayLanguage)
window.addEventListener('online', sayLanguage)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sayLanguage()
})

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
        // At the start too, unlike the reminders: an account signed in before the app said its language says it now.
        interfaceLanguage = locale
        sayLanguage()
        if (localeMounted) void reminders.refresh().catch(() => undefined)
        localeMounted = true
      }}
    >
      <Root boot={boot} download={openingDownload} services={{ env, audio, afterRun, api, accounts: controller!, reminders, lifecycle, credits, fixNotices, legalNotice, packs }} />
    </I18nProvider>
  </StrictMode>,
)

void boot.start()

// The legal pages' dates (#184): looked at as the app starts and whenever it comes back, at most once a day. Beside
// the start, never in its way: nothing waits for it, and a look that fails, or a device that is offline, says nothing.
const checkLegal = () => void legalNotice.check()
checkLegal()
window.addEventListener('online', checkLegal)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkLegal()
})

// iOS keeps a page left for another frozen in its back-forward cache, where its database Worker
// would hold the file and its lock from the next page for good: let go as the page is hidden, open again if it returns
// — from the cache, or because it never went (`resume()` does nothing unless the page let go).
window.addEventListener('pagehide', () => boot.suspend())
window.addEventListener('pageshow', () => void boot.resume())
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void boot.resume()
})

// Offline after the first visit (spec §9.1), and "a new version is ready": looked for when the app comes back to
// the foreground and about hourly, and moved to at a safe moment. Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(
    (registration) => {
      watchUpdates(registration, navigator.serviceWorker, lifecycle)
      lifecycle.attachChecker(startUpdateChecks(registration))
    },
    () => undefined,
  )
}
