import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { reminderNotification } from './reminders/notification'
import { readInterfaceLanguage } from './reminders/prefs'

// Workbox injects the precache list at the literal `self.__WB_MANIFEST`; the cast compiles away and leaves it intact.
const manifest = (self as unknown as { __WB_MANIFEST: (string | PrecacheEntry)[] }).__WB_MANIFEST

cleanupOutdatedCaches()
// The shell, both SQLite builds, the fonts and the bundled sample's manifest and pack (spec §8.6, §9.1). Its audio
// is not precached: the app fetches the clips into the one audio cache, `wordado-audio-v1` (decision of plan 6b).
precacheAndRoute(manifest)
// Every in-app URL is the shell; the router takes it from there. The API is never the shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/v1\//] }))

const sw = self as unknown as ServiceWorkerGlobalScope

// A reminder (spec §8.11): the push is empty; ask the server what to say (plan 5).
sw.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const lang = await readInterfaceLanguage(sw.caches)
      const { title, body } = await reminderNotification((input, init) => fetch(input, init), lang, 0 - new Date().getTimezoneOffset())
      await sw.registration.showNotification(title, { body, lang, icon: '/icon-192.png', tag: 'wordado-reminder' })
    })(),
  )
})

// Opening a reminder brings Wordado forward, or opens it.
sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) await open.focus()
      else await sw.clients.openWindow('/')
    })(),
  )
})

// "Update now" (spec §9.1): the waiting version takes over only when the learner asks.
sw.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting()
})
