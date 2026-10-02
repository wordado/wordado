# Deploying Wordado

The web app and the API are one Cloudflare Worker (`server/wrangler.jsonc`): `wordado` on
`https://app.wordado.com` (production) and `wordado-preview` on `https://wordado-preview.<subdomain>.workers.dev`
(preview). Every push to `main` deploys production once CI is green and a reviewer approves it (the
`production` environment's required reviewer). Every pull request from this
repository deploys the preview and runs one learner's life against it (`smoke:remote`). Content (packs
and audio) lives in the R2 bucket `wordado-content`, served at `https://content.wordado.com`, and is
published by the **Corpus** workflow of the private `wordado/wordado-content` repository (`pipeline/README.md`).

The public website at `https://wordado.com` is a separate Worker from the private repo
`wordado/wordado-site`; it serves the privacy policy and redirects the app's old paths here.

Nothing deploys until the repository variable `DEPLOY_ENABLED` is `true` (step 10).

## What is provisioned

Set up on 2026-09-27 by following the steps below. Names and addresses only: every secret lives in the
GitHub environments or with Cloudflare.

| What | Preview | Production |
|---|---|---|
| Worker and address | `wordado-preview`, `https://wordado-preview.danchom.workers.dev` | `wordado`, `https://app.wordado.com` |
| Neon branch (project `wordado`, Frankfurt, Postgres 18) | `preview` | the project's main branch |
| Hyperdrive | `wordado-preview` | `wordado` |
| Queue | `wordado-jobs-preview` | `wordado-jobs` |
| GitHub environment | `preview` | `production` (deploys from `main` only) |

Shared: the R2 bucket `wordado-content` (Western Europe) at `https://content.wordado.com`, readable from
both addresses, with the sample pack published; the rate-limit rule on `/v1/sync/*`; `main` protected.
Sign-in, since 2026-09-27: Resend sends codes from `codes@wordado.com` (a sending-only key limited to
wordado.com), and Google's app (redirect `https://app.wordado.com/api/auth/callback/google`) is in **Testing**: only its listed test users can sign in with Google, until the privacy policy is final (roadmap).
Mail DNS, since 2026-09-27: DMARC is `v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net;`, its
reports read on the dashboard (wordado.com › Email › DMARC Management). Once a week or two of reports show every
real sender passing, tighten it to `p=quarantine`. The apex MX, `10 inbound-smtp.eu-west-1.amazonaws.com`, is
Resend's receiving record, but receiving is not enabled, so mail to `@wordado.com` is refused at once. Keep it
until the support address below decides how wordado.com receives: no MX would leave senders retrying for days,
and a null MX (`0 .`) can make some providers distrust mail *from* wordado.com, the sign-in codes included.
Since 2026-10-02, `www.wordado.com` redirects to `https://wordado.com`, which is the website: a proxied
`AAAA www 100::` record and a Redirect Rule (*Redirect from WWW to root*: 301, path and query string kept).
Never serve the app on `www` too, nor on the main domain: its local data, sign-in cookie and installed app would
be separate from `app.wordado.com`'s. The app is only ever on `app.wordado.com`.
Not yet: a public support address, such as `support@wordado.com`
(before Google's app is published): either Resend receiving (enable wordado.com under Receiving; it uses the
present MX) or Cloudflare Email Routing, which replaces the MX with its own and forwards to a personal inbox. Google's **User support email** (Branding) is a dropdown of the signed-in account and the Google Groups it
manages, so it needs a Google Group or a Google account for that address; until then it shows the personal
address to test users only. The same address can fill the privacy policy's `[Contact email]`
(the website's, `https://wordado.com/<lang>/privacy/`).

## Provisioning, once

### Before you start

Since 2026-09-25 `wordado/wordado` is public, on GitHub Free: its code under the MIT licence, and its
content under its own terms (`pipeline/samples/README.md`). A public repository on Free gets everything
the workflows need, with nothing to buy:
- environment secrets and deployment branch policies (step 6);
- branch protection (step 7);
- Actions minutes at no cost.

Pull-request workflows from outside contributors wait for approval (Settings › Actions), and a fork's
runs never receive the environments' secrets.

The private history before that date lives in `wordado/wordado-archive`, and the product research in the
private `wordado/wordado-research`, cloned into `docs/research/` and ignored here.

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
   `{"rules":[{"allowed":{"origins":["https://app.wordado.com","https://wordado-preview.<subdomain>.workers.dev"],"methods":["GET","HEAD"]},"maxAgeSeconds":86400}]}`
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
   - `APP_ORIGIN`: `https://wordado-preview.<subdomain>.workers.dev` for preview, `https://app.wordado.com` for production.
   - Production only: `gh variable set CONTENT_BUCKET --body wordado-content --env production`,
     `gh secret set R2_ACCESS_KEY_ID --env production`, `gh secret set R2_SECRET_ACCESS_KEY --env production`.
     The Worker does not use them, but they stay here and are removed only after the first corpus release
     proves the content repository's copies work.
   - Reminders, per environment: a pair from `pnpm --filter @wordado/server vapid-keys` as
     `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:…`).
   - Production only (*done 2026-09-27*): `RESEND_API_KEY` with `EMAIL_FROM`
     (`Wordado <codes@wordado.com>`, once Resend has verified the domain), and `GOOGLE_CLIENT_ID` with
     `GOOGLE_CLIENT_SECRET` (redirect `https://app.wordado.com/api/auth/callback/google`). Without Resend,
     production prints sign-in codes to its log, as development does. The preview has no mailer on
     purpose: its codes are only in its log, which `smoke:remote` reads.
   A deploy refuses half of a pair, and a `BETTER_AUTH_SECRET` under 32 characters (`server/scripts/secretsFile.ts`).
7. **Protect `main`.** *Done 2026-09-25*: the five checks below are required, a pull request must be
   up to date with `main` before it merges, and force pushes to `main` and its deletion are refused.
   Admins can still override. A history rewrite of `main` therefore needs this protection lifted for
   the push and restored straight after. To set it up again:
   `gh api -X PUT repos/wordado/wordado/branches/main/protection -F "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=Typecheck, lint, workflows, deploy config" -f "required_status_checks[contexts][]=Suites and the Worker smoke run" -f "required_status_checks[contexts][]=End to end (chromium)" -f "required_status_checks[contexts][]=End to end (firefox)" -f "required_status_checks[contexts][]=End to end (webkit)" -F enforce_admins=false -F "required_pull_request_reviews=null" -F "restrictions=null"`
   Those names are the CI jobs' names (`.github/workflows/ci.yml`), and a check must have run once on a pull request before GitHub offers it.
8. **The transport rate limit** (spec §10). Dashboard › wordado.com › Security › WAF › Rate limiting
   rules: *URI Path starts with `/v1/sync/`*, 60 requests per 10 seconds per IP, block for 10 seconds.
   A week offline is a few 500-event pages and a pull, far below it. Sign-in has its own limits (plan 5).
9. **Content first.** *Done 2026-09-27*, with the sample (v0), by the Publish content workflow that plan 8
   replaced. The first corpus version is published by the content repository's **Corpus** workflow
   (`pipeline/README.md`).
10. **Enable deploys.** `gh variable set DEPLOY_ENABLED --body true`. The next pull request deploys
    the preview, and the next merge deploys production. `cloudflare/wrangler-action@v4` exists (its
    `v4` tag was checked on 2026-09-25), but that first deploy is its first real use, so watch it. Once deploys are
    on, consider adding "Preview deployment / Deploy (preview)" to `main`'s required checks (step 7).

## Everyday

- **Release:**
  1. Open a pull request. Once its checks pass, CI deploys it to the preview and runs `smoke:remote` there.
  2. Try it on `https://wordado-preview.danchom.workers.dev`. Sign-in codes appear in
     `pnpm --filter @wordado/server exec wrangler tail --env preview`, since the preview has no mailer. The
     preview is shared, so with several pull requests open it shows the one deployed last.
  3. Merge. `main`'s CI runs, and its **Production deployment** job waits for review.
  4. Open that run under Actions: **Review deployments** › tick `production` › **Approve and deploy**.
     CI migrates `DATABASE_URL`, then deploys the Worker with the web build. A run left unapproved
     expires after 30 days, and nothing is deployed.

  The reviewer is set on the `production` environment (Settings › Environments › production). The content
  repository is private on GitHub Free, which has no required reviewers there: its **Corpus** release runs
  only for the users in its `RELEASE_ACTORS` variable, who type `release` to confirm (`pipeline/README.md`).
- **Migrations:** they run while the previous Worker still serves, and `wrangler rollback` restores a
  Worker that runs against the new schema, so every migration must work with the previous Worker too: expand first,
  contract in a later release.
- **Rollback:** `pnpm --filter @wordado/server exec wrangler rollback --env production` restores the previous
  Worker and its assets together. Migrations are forward-only: never roll the schema back; write a new migration.
  Never roll production back to a version from before the move (2026-10): a rollback restores a version's
  plain-text variables but not its route, so `app.wordado.com` would get `BASE_URL` `https://wordado.com` and
  sign-in would break. Redeploy a fix instead.
- **The preview's database** gets every pull request's migrations. After closing a pull request whose
  migration never merged, reset the Neon `preview` branch from its parent.
- **CPU** (spec §4.4, §17.2): `smoke:remote` prints how long a 500-event page and a 101-word pull took.
  Workers › wordado-preview › Metrics shows CPU time per request. The free plan's 10 ms is the first
  ceiling. When it binds, move to Workers Paid ($5 a month).
- **Content:** see `pipeline/README.md`. Its release job uploads packs, audio and `fixes.json`, and the manifest last.

## Before each release (spec §13)

- A keyboard-only pass and a screen-reader pass (VoiceOver on Safari, NVDA on Firefox) through every game mode.
- Offline in Safari (macOS and iOS): study, go offline, reload, study, reconnect, and see the answers sync.
  Playwright's WebKit cannot load a page offline, so CI skips this there.
- On an iPhone, install the app to the home screen, turn reminders on, and receive one.

## Moving the app to app.wordado.com (2026-10)

Done once, in one sitting, in this order. The website must already be built and checked on its preview
address (wordado-site `docs/deploy.md`). Its legal pages need not be final yet: until its launch check passes,
it deploys with `noindex` on every page, so it is reachable but kept out of search engines (decided
2026-10-01: the app moves before the legal review).

What is lost: the app's local data and installed copies are per origin, so they stay on the old address.
Synced progress comes back on signing in at the new one. Reminders are per origin too: test users who had them on
turn them on again at `app.wordado.com`. Events never synced on the old origin are out of reach, so ask the test
users to open the app online and let it sync before the day.

Before step 1, be merge-ready: bring the pull request up to date and let its CI pass, so that the window between
steps 3 and 4 stays short.

1. **Google Auth Platform › Clients › the web client:** add the authorised JavaScript origin
   `https://app.wordado.com` and the redirect URI `https://app.wordado.com/api/auth/callback/google`.
   Keep the old ones for now.
2. **R2 › `wordado-content` › Settings › CORS policy:** add `https://app.wordado.com` to `AllowedOrigins`.
   Keep `https://wordado.com` for now.
3. **GitHub › Settings › Environments › `production`:** set `APP_ORIGIN` to `https://app.wordado.com`.
   Between steps 3 and 4, deploy nothing else to production: a deploy in that window would give the old
   route the new BASE_URL.
4. **Merge the move's pull request** and approve its production deploy. Wrangler attaches the custom domain
   `app.wordado.com` (it creates the DNS record itself). Until step 7, `wordado.com` serves nothing (or the
   app), so do steps 5 to 7 promptly.
5. **Check the app:** `curl -fsS https://app.wordado.com/health`, then open `https://app.wordado.com`, sign in
   by emailed code and by Google, study one card, and see it sync. Do not run `smoke:remote` against
   production: it reads the code from `wrangler tail`, which works only with the console mailer, so it would
   time out, mail a real address and leave a stray account. Also confirm that the `/v1/sync/` rate-limit rule's
   expression (Security › WAF › Rate limiting) has no hostname condition, so it still applies on
   `app.wordado.com`.

   **If step 5 fails:** before step 7, the way back is to revert the move's pull request on `main`, set
   `APP_ORIGIN` back to `https://wordado.com`, and redeploy (Wrangler moves the custom domain back; Google's and
   R2's old values are still in place because step 9 has not run). After step 7 the only way is forward: fix and
   redeploy.
6. **Free the main domain:** Cloudflare › Workers & Pages › `wordado` › Settings › Domains & Routes: remove
   `wordado.com` if it is still listed.
7. **Deploy the website** to `wordado.com` (wordado-site: set `PRODUCTION_ENABLED`, run Deploy).
8. **Check the redirects:** `curl -sI https://wordado.com/` (302 to a language), `curl -sI https://wordado.com/study`
   (301 to `https://app.wordado.com/study`), `curl -sI https://wordado.com/privacy` (302 to `/<lang>/privacy/`).
9. **Remove the old values:** `https://wordado.com` from Google's origins and redirects, and from R2's CORS.
   Also update Google Auth Platform › Branding: the privacy-policy link to `https://wordado.com/en/privacy/` and
   the home page to `https://wordado.com` (Google's verification dislikes redirecting policy URLs).
