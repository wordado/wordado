# Developing Wordado

How to build a new feature and test it on your own machine, then take it through a pull request to
production. Deploying and the cloud setup are in [`deploy.md`](deploy.md).

## 1. Set up once

Needs **Node 24**, **pnpm 12** and **Docker** (running). No cloud account is needed for any of this.

```bash
git clone https://github.com/wordado/wordado.git && cd wordado
pnpm install
pnpm --filter @wordado/web exec playwright install chromium   # for the web suite's browser tests
```

For the end-to-end runs in other browsers, install those too (`… playwright install firefox webkit`).

Check that everything is green before you change anything:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

`pnpm test` starts Postgres in Docker for the server suite (port 54329) and leaves it running.

## 2. Run the app locally

Two terminals:

```bash
pnpm --filter @wordado/server dev   # the API on :8787, with Postgres in Docker and its migrations
pnpm --filter @wordado/web dev      # the app on http://localhost:5173
```

- The app proxies `/api` and `/v1` to the Worker, so both share one origin, as in production.
- **Sign-in codes** appear in the server terminal (`Sign-in code for you@example.com: 123456`): no mail is sent locally.
- The first `dev` run creates `server/.dev.vars` (the Worker's local secrets) from `.dev.vars.example`. For
  reminders, add a key pair from `pnpm --filter @wordado/server vapid-keys`.
- The demo needs no server: without the Worker, only sign-in and sync fail.
- The service worker (offline mode, install prompt) only exists in a build:
  `pnpm --filter @wordado/web build && pnpm --filter @wordado/web preview` (http://localhost:4173).

## 3. Build the feature

### Start a branch

```bash
git switch main && git pull
git switch -c feat/<short-name>
```

`main` is protected: every change reaches it through a pull request with green checks.

### Find where it belongs

| Package | What goes there |
|---|---|
| `core` | Learning rules: scheduling, sessions, streaks, XP, sync reconciliation. Pure TypeScript: no I/O, no browser, no Node APIs. |
| `client-data` | The client's database, outbox and sync engine, and the React hooks over them. |
| `web` | Screens and browser platform code. No learning rules: ask `core` or `client-data`. |
| `server` | The API (Hono on Workers): stores, stamps and serves. Its rules come from `core` too. |
| `pipeline` | Building and checking corpus packs. |

The design is in `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`; a feature that
changes behaviour should agree with it (or change it on purpose).

### Write the test first

1. Add a test beside the module (`thing.ts` → `thing.test.ts`; browser-only tests are `*.browser.test.ts`).
2. Run it and watch it fail for the reason you expect.
3. Write the smallest code that makes it pass, then tidy.

Run one file while you work:

```bash
pnpm --filter @wordado/core exec vitest run src/<file>.test.ts
pnpm --filter @wordado/web exec vitest run --project unit src/<path>.test.tsx
pnpm --filter @wordado/web exec vitest run --project browser src/<path>.browser.test.ts
pnpm --filter @wordado/server exec vitest run src/<path>.test.ts    # needs Docker
```

### Rules that bite

- **Interface text** goes in both `web/src/i18n/en.ts` and `bg.ts`, or typecheck fails. The learner never
  sees a raw `err.message`: map errors through `web/src/errors.ts`.
- **Database changes** are a new file in `server/migrations/` (`0003_<name>.sql`, …). Never edit one that
  has shipped. Migrations run while the previous Worker still serves, so each must work with it too:
  add first, remove in a later release.
- **Local database changes** (the client's SQLite) are a new entry in `MIGRATIONS` in
  `client-data/src/schema.ts`, and must upgrade a database from every shipped version.
- **Sync protocol changes** bump `SYNC_PROTOCOL_VERSION` in `core/src/syncProtocol.ts`, and the server must accept the old
  version until clients have updated (spec §4.3).
- **Sample content**: after editing `pipeline/samples/a1/source.json`, rebuild with `pnpm sample-pack`
  and commit the pack and manifest it writes.
- **The corpus pipeline** (`pipeline/README.md`) is tested on fixtures: `pnpm --filter @wordado/pipeline test`.
  Its encoder tests need ffmpeg (`brew install ffmpeg`) and are skipped without it; CI installs it. Real runs need the
  private content repository, cloned into `content/`.
- **Style**: no semicolons, single quotes, named exports, `readonly` interface fields, comments that say why.
  `pnpm lint` enforces the rest.

## 4. Test it locally

In order, from quickest to slowest:

```bash
pnpm typecheck                     # every package
pnpm lint                          # oxlint
pnpm test                          # every suite; the server's needs Docker
pnpm --filter @wordado/server smoke   # the real Worker under wrangler dev, one learner's life
pnpm --filter @wordado/web e2e        # the demo in a real browser (Chromium), with an accessibility scan
pnpm --filter @wordado/web e2e:accounts   # accounts against the local Worker (Docker; ports 8787 and 4173 free)
```

The end-to-end suites run Chromium by default. CI also runs Firefox and WebKit on every pull request, so try
them if your change touches the browser:

```bash
E2E_PROJECTS=firefox,webkit pnpm --filter @wordado/web e2e
E2E_PROJECTS=all pnpm --filter @wordado/web e2e:accounts   # adds mobile Chrome and Safari
```

Then try the feature by hand in the running app (section 2), in both languages and in the dark theme, and
with the keyboard alone if it adds a screen.

### When a local run fails for no reason

- **Port in use** (8787, 4173, 5173): stop the old `wrangler dev` or `vite preview` (`lsof -iTCP:8787 -sTCP:LISTEN`).
- **429 on sign-in codes** after many local runs: the server allows 100 codes a day. Clear the test rows:
  `docker exec wordado-postgres-1 psql -U wordado -d wordado -c 'delete from sign_in_code_send; delete from "rateLimit";'`
- **Postgres not reachable**: start Docker, then `pnpm --filter @wordado/server db:up`.

## 5. Open a pull request

```bash
git add <files> && git commit -m "feat(web): <what the learner gets>"
git push -u origin feat/<short-name>
gh pr create --fill
```

Commit messages say what changed for the user, prefixed with a type and the package (`feat`, `fix`, `test`,
`docs`, `chore`, `ci`). Commit with your GitHub noreply address if you keep your email private
(`git config user.email <id>+<login>@users.noreply.github.com`).

CI then runs, and each must pass before the pull request can merge:

1. Typecheck, lint, workflows and the deploy configuration.
2. Every suite and the Worker smoke run.
3. End to end in Chromium, Firefox and WebKit.
4. **The preview deployment**: your branch goes live at `https://wordado-preview.danchom.workers.dev`,
   with its own database, and a smoke run is made against it.

If `main` has moved on, GitHub asks you to **Update branch** before merging.

## 6. Check it on the preview, then release

1. Open `https://wordado-preview.danchom.workers.dev` and try the feature as a learner. Sign-in codes are in
   the preview's log: `pnpm --filter @wordado/server exec wrangler tail --env preview` (needs `wrangler login`).
   The preview is shared, so with several pull requests open it shows the last one deployed.
2. Merge the pull request. `main`'s CI runs again, across all five browsers.
3. **Approve the production deploy**: Actions › the run › **Review deployments** › `production` ›
   **Approve and deploy**. `https://app.wordado.com` updates a few minutes later.

If a release goes wrong, see *Everyday* in [`deploy.md`](deploy.md) for the rollback.
