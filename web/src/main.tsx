import '@fontsource-variable/golos-text'
import '@fontsource-variable/literata'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Boot } from './app/boot'
import { Root } from './app/Root'
import { AudioStore } from './content/audio'
import { fetchManifest, packFetcher, SAMPLE_MANIFEST_URL } from './content/packs'
import { webEnv } from './env'
import { I18nProvider } from './i18n/i18n'
import { TabLock } from './storage/tabLock'
import { openWorkerDriver } from './storage/workerDriver'

const env = webEnv()
const audio = new AudioStore({ manifestUrl: SAMPLE_MANIFEST_URL, sha256: env.sha256 })

const boot = new Boot(
  {
    env,
    l1: 'bg',
    // The demo's own database (decision of 2026-09-24); 6b adds the learner's.
    openDriver: () => openWorkerDriver('demo'),
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

let persistenceAsked = false

/** After a run: fetch ahead (spec §9.3), and ask once to keep storage (spec §9.1). */
function afterRun(): void {
  const state = boot.store.get()
  if (state.status === 'ready' && navigator.onLine) void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
  if (!persistenceAsked) {
    persistenceAsked = true
    void navigator.storage?.persist?.().catch(() => false)
  }
}

window.addEventListener('online', () => {
  const state = boot.store.get()
  if (state.status === 'ready') void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Root boot={boot} services={{ env, audio, afterRun }} />
    </I18nProvider>
  </StrictMode>,
)

void boot.start()
