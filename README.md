# Wordado

Learn English words, a few minutes a day, online or off. An installable web app (PWA) with
spaced repetition (FSRS), a level path, and sync across devices.

## Packages

| Package | What it is |
|---|---|
| `core` | The learning rules: scheduling, sessions, streaks, XP, sync reconciliation. Pure TypeScript. |
| `client-data` | The client's local database, outbox and sync engine, over a SQL driver. |
| `web` | The web app: Vite + React, SQLite in a Worker (OPFS, then IndexedDB). |
| `server` | The API: Hono on Cloudflare Workers, Postgres through Hyperdrive. |
| `pipeline` | Builds and checks corpus packs. |

## Run it

Needs Node 24, pnpm 12 and Docker.

```bash
pnpm install
pnpm test                               # every package
pnpm --filter @wordado/server dev       # the API on :8787, with Postgres in Docker
pnpm --filter @wordado/web dev          # the app on http://localhost:5173
```

More in each package's README, and deployment in `docs/deploy.md`.

## Licence

The **code** in this repository is licensed under the MIT licence (`LICENSE`).

The **content** is not: the word lists, translations, example sentences and audio under
`pipeline/samples/` are not covered by the MIT licence. See
[`pipeline/samples/README.md`](pipeline/samples/README.md) for their terms. The same applies
to the corpus packs and audio that Wordado serves to learners.
