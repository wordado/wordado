# @wordado/server

The API: Hono on Cloudflare Workers over Postgres (spec §4.4). Every learning
rule comes from `@wordado/core`; this package stores, stamps and serves.

## Run it

Needs Docker running.

```bash
pnpm --filter @wordado/server dev     # Postgres in Docker, migrations, then wrangler dev on :8787
pnpm --filter @wordado/server test    # the suite, against a fresh wordado_test database
pnpm --filter @wordado/server smoke   # the real Worker under wrangler dev, end to end
```

`dev` creates `server/.dev.vars` (the Worker's local secrets) from
`.dev.vars.example` the first time. Hyperdrive's local connection string comes
from the `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` environment
variable, which the `dev` and `smoke` scripts set to the Docker database unless
it is already set. Sign-in codes are printed to the console. Reminders need a
VAPID pair in `.dev.vars` (`pnpm --filter @wordado/server vapid-keys`).

## Shape

- `src/app.ts` builds the Hono app from `ServerDeps`; `src/worker.ts` makes
  those from Worker bindings, and `test/harness.ts` from fakes.
- `src/sync/` is the sync protocol: `push.ts` and `pull.ts` are
  `client-data/src/testing/fakeServer.ts` made real, and `conformance.test.ts`
  holds them to it.
- Derived rows (`review_state`, `review_event.kind`, `review_event.xp_award`)
  are core's derivation kept for speed; `sync/derive.test.ts` holds them equal
  to core's full derivation.
- Migrations in `migrations/` are forward-only: add a file, never edit one.

## Deploying

`wrangler.jsonc`'s top level is local only (`wordado-local`). `env.preview` and `env.production`
are the deployed Workers, which also serve the web build (`../web/dist`). CI deploys them
(`.github/workflows/deploy.yml`). Provisioning and secrets are in `docs/deploy.md`.

```bash
pnpm --filter @wordado/server deploy:check    # dry-runs both environments; needs a web build
pnpm --filter @wordado/server smoke:remote https://wordado-preview.<subdomain>.workers.dev preview
```
