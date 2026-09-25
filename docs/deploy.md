# Deploying Wordado

The web app and the API are one Cloudflare Worker (`server/wrangler.jsonc`): `wordado` on
`https://wordado.com` (production) and `wordado-preview` on `https://wordado-preview.<subdomain>.workers.dev`
(preview). Every push to `main` deploys production once CI is green. Every pull request from this
repository deploys the preview and runs one learner's life against it (`smoke:remote`). Content (packs
and audio) lives in the R2 bucket `wordado-content`, served at `https://content.wordado.com`, and is
published by the manual **Publish content** workflow.

Nothing deploys until the repository variable `DEPLOY_ENABLED` is `true` (step 10).

## Provisioning, once

### Before you start

Checked 2026-09-25: the `wordado` organisation is on GitHub Free, and the repository is private. On
Free, a private repository gets no environment secrets, no deployment branch policies (the
environments of step 6) and no branch protection (step 7). There are three ways forward:

- **GitHub Team** for the organisation.
- **Make the repository public.** Actions minutes then become free as well.
- **Repository-level secrets**, with preview and production told apart by name, accepting that `main`
  is unprotected.

The workflows as written assume the first or the second.

### Steps

1. **Cloudflare.** `pnpm --filter @wordado/server exec wrangler login`, then `… wrangler whoami` for
   the account id. Create an API token from the "Edit Cloudflare Workers" template. Add
   *Account › Hyperdrive › Edit* and *Account › Queues › Edit*, and limit its zone to `wordado.com`.
   The workers.dev subdomain is on the dashboard's Workers overview.
   *Accepted risk:* this one account-wide token sits in both environments, so any branch in this
   repository that can run the preview deploy could deploy production with it. That is accepted for a
   solo private repository. The remedy is a separate Cloudflare account for the preview.
2. **Neon.** Create the project `wordado` in *AWS Europe Central 1 (Frankfurt)* (spec §17.1), on
   Postgres 18 (or 17 if 18 is not offered; the schema uses nothing 18-only). Keep the default branch
   for production. Create a branch `preview` from it. Copy each branch's **direct** connection
   string (not `-pooler`), one per branch: Hyperdrive pools, and migrations need a session.
3. **Hyperdrive.** From `server/`:
   `pnpm exec wrangler hyperdrive create wordado --connection-string "<neon production direct URL>"`
   and `pnpm exec wrangler hyperdrive create wordado-preview --connection-string "<neon preview direct URL>"`.
   Put each id in its `env` block in `server/wrangler.jsonc`, replacing the zero id, in a pull request.
   Until then, the deploy refuses to run.
4. **Queues.** `pnpm exec wrangler queues create wordado-jobs` and `pnpm exec wrangler queues create wordado-jobs-preview`.
5. **R2.** `pnpm exec wrangler r2 bucket create wordado-content --location weur`. Connect the
   custom domain `content.wordado.com` to it on the dashboard (R2 › wordado-content › Settings ›
   Custom Domains). Allow the app's origins to read it. Write `cors.json`:
   `{"rules":[{"allowed":{"origins":["https://wordado.com","https://wordado-preview.<subdomain>.workers.dev"],"methods":["GET","HEAD"]},"maxAgeSeconds":86400}]}`
   and run `pnpm exec wrangler r2 bucket cors set wordado-content --file cors.json`. Create an R2 API
   token with *Object Read & Write* on `wordado-content` only, and keep its access key id and secret.
6. **Secrets and variables** (`gh` from the repository root). Create the environments, with production limited to `main`:
   `gh api -X PUT repos/wordado/wordado/environments/preview`,
   `gh api -X PUT repos/wordado/wordado/environments/production -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"`,
   then `gh api -X POST repos/wordado/wordado/environments/production/deployment-branch-policies -f name=main`.
   - Repository: `gh variable set CLOUDFLARE_ACCOUNT_ID --body <cloudflare-account-id>`.
   - Both environments (`--env preview`, `--env production`): `gh secret set CLOUDFLARE_API_TOKEN`,
     `gh secret set DATABASE_URL` (that branch's direct URL), and `gh secret set BETTER_AUTH_SECRET`
     (`openssl rand -base64 48`, a different one per environment). Also
     `gh variable set CONTENT_MANIFEST_URL --body https://content.wordado.com/manifest.json`.
   - `APP_ORIGIN`: `https://wordado-preview.<subdomain>.workers.dev` for preview, `https://wordado.com` for production.
   - Production only: `gh variable set CONTENT_BUCKET --body wordado-content --env production`,
     `gh secret set R2_ACCESS_KEY_ID --env production`, `gh secret set R2_SECRET_ACCESS_KEY --env production`.
   - Reminders, per environment: a pair from `pnpm --filter @wordado/server vapid-keys` as
     `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:…`).
   - Production, before the beta (roadmap blockers): `RESEND_API_KEY` with `EMAIL_FROM`
     (`Wordado <codes@wordado.com>`, once Resend has verified the domain), and `GOOGLE_CLIENT_ID` with
     `GOOGLE_CLIENT_SECRET` (redirect `https://wordado.com/api/auth/callback/google`). Without Resend,
     production prints sign-in codes to its log, as development does. The preview has no mailer on
     purpose: its codes are only in its log, which `smoke:remote` reads.
   A deploy refuses half of a pair, and a `BETTER_AUTH_SECRET` under 32 characters (`server/scripts/secretsFile.ts`).
7. **Protect `main`.**
   `gh api -X PUT repos/wordado/wordado/branches/main/protection -F "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=Typecheck, lint, workflows, deploy config" -f "required_status_checks[contexts][]=Suites and the Worker smoke run" -f "required_status_checks[contexts][]=End to end (chromium)" -f "required_status_checks[contexts][]=End to end (firefox)" -f "required_status_checks[contexts][]=End to end (webkit)" -F enforce_admins=false -F "required_pull_request_reviews=null" -F "restrictions=null"`
   Those names are the CI jobs' names (`.github/workflows/ci.yml`), and a check must have run once on a pull request before GitHub offers it.
8. **The transport rate limit** (spec §10). Dashboard › wordado.com › Security › WAF › Rate limiting
   rules: *URI Path starts with `/v1/sync/`*, 60 requests per 10 seconds per IP, block for 10 seconds.
   A week offline is a few 500-event pages and a pull, far below it. Sign-in has its own limits (plan 5).
9. **Content first.** Run **Publish content** (Actions › Publish content › Run workflow, source
   `pipeline/samples/a1-bg`). Then the first production build finds a manifest at `CONTENT_MANIFEST_URL`.
10. **Enable deploys.** First confirm that `cloudflare/wrangler-action@v4` exists (its releases on
    GitHub): the first real deploy is its first use. Then `gh variable set DEPLOY_ENABLED --body true`.
    The next pull request deploys the preview, and the next merge deploys production. Once deploys are
    on, consider adding "Preview deployment / Deploy (preview)" to `main`'s required checks (step 7).

## Everyday

- **Deploy:** merge a green pull request. CI migrates `DATABASE_URL`, then deploys the Worker with the web build.
  Migrations run while the previous Worker still serves, and `wrangler rollback` restores a Worker that
  runs against the new schema, so every migration must work with the previous Worker too: expand first,
  contract in a later release.
- **Rollback:** `pnpm --filter @wordado/server exec wrangler rollback --env production` restores the previous
  Worker and its assets together. Migrations are forward-only: never roll the schema back; write a new migration.
- **The preview's database** gets every pull request's migrations. After closing a pull request whose
  migration never merged, reset the Neon `preview` branch from its parent.
- **CPU** (spec §4.4, §17.2): `smoke:remote` prints how long a 500-event page and a 101-word pull took.
  Workers › wordado-preview › Metrics shows CPU time per request. The free plan's 10 ms is the first
  ceiling. When it binds, move to Workers Paid ($5 a month).
- **Content:** Publish content with a directory of the pipeline's shape (plan 8 builds it). The manifest goes last.

## Before each release (spec §13)

- A keyboard-only pass and a screen-reader pass (VoiceOver on Safari, NVDA on Firefox) through every game mode.
- Offline in Safari (macOS and iOS): study, go offline, reload, study, reconnect, and see the answers sync.
  Playwright's WebKit cannot load a page offline, so CI skips this there.
- On an iPhone, install the app to the home screen, turn reminders on, and receive one.
