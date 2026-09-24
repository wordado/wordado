import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// Workbox injects the precache list at the literal `self.__WB_MANIFEST`; the cast compiles away and leaves it intact.
const manifest = (self as unknown as { __WB_MANIFEST: (string | PrecacheEntry)[] }).__WB_MANIFEST

cleanupOutdatedCaches()
// The shell, both SQLite builds, the fonts and the bundled sample with its audio (spec §8.6, §9.1).
precacheAndRoute(manifest)
// Every in-app URL is the shell; the router takes it from there. The API is never the shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/v1\//] }))
