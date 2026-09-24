# @wordado/web

The web client (spec §4.1): a Vite + React PWA over `client-data`, with SQLite in a Worker
(OPFS, then IndexedDB, then memory). Until plan 6b adds accounts, the app is the demo: it runs
on the bundled A1 Bulgarian sample, in its own `demo` database, and syncs nothing.

```bash
pnpm --filter @wordado/web dev        # http://localhost:5173, with /api and /v1 proxied to :8787
pnpm --filter @wordado/web test       # unit views (happy-dom) and storage (Chromium)
pnpm --filter @wordado/web e2e        # the built app in Chromium, with an axe scan
pnpm --filter @wordado/web exec playwright install chromium   # once per machine
```

The service worker exists only in a build (`pnpm build && pnpm preview`, on :4173).
