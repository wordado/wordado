# @wordado/web

The web client (spec §4.1): a Vite + React PWA over `client-data`, with SQLite in a Worker
(OPFS, then IndexedDB, then memory). Until plan 6b adds accounts, the app is the demo: it runs
on the bundled A1 Bulgarian sample, in its own `demo` database, and syncs nothing.

```bash
pnpm --filter @wordado/web dev        # http://localhost:5173, with /api and /v1 proxied to :8787
pnpm --filter @wordado/web test       # unit views (happy-dom) and storage (Chromium)
pnpm --filter @wordado/web e2e        # the built app in Chromium, with an axe scan
pnpm --filter @wordado/web e2e:accounts   # accounts end to end, against plan 5's Worker
pnpm --filter @wordado/web exec playwright install chromium   # once per machine
```

The service worker exists only in a build (`pnpm build && pnpm preview`, on :4173).

## Accounts end to end

`pnpm --filter @wordado/web e2e:accounts` starts plan 5's Worker (Docker must be running,
and port 8787 free), builds and previews the app, and signs learners in with codes read
from the Worker's own output — no real mailer is involved.

The demo run, `pnpm --filter @wordado/web e2e`, needs no server: it never reaches plan 5.

For local development with accounts, run `pnpm --filter @wordado/server dev` beside
`pnpm --filter @wordado/web dev`, and copy sign-in codes from the Worker's terminal.
