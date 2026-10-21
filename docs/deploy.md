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
both addresses, with the corpus published by the content repository's **Corpus** workflow (version 6 on 2026-10-08,
packs for bg, de and es); the rate-limit rule on `/v1/sync/*`; `main` protected.
Sign-in, since 2026-09-27: Resend sends codes from `codes@wordado.com` (a sending-only key limited to
wordado.com). Sign-in with Google was removed on 2026-10-10 (#170); the settings it leaves behind are listed in step 6.
Mail DNS, since 2026-09-27: DMARC is `v=DMARC1; p=none; rua=mailto:<id>@dmarc-reports.cloudflare.net;`, its
reports read on the dashboard (wordado.com › Email › DMARC Management). Once a week or two of reports show every
real sender passing, tighten it to `p=quarantine`. Since 2026-10-10 the apex MX records are Cloudflare Email
Routing's (`route1/2/3.mx.cloudflare.net`, with `include:_spf.mx.cloudflare.net` in the SPF record); Resend's
receiving record is gone. Never leave the apex without an MX: no MX leaves senders retrying for days, and a null
MX (`0 .`) can make some providers distrust mail *from* wordado.com, the sign-in codes included.
Since 2026-10-02, `www.wordado.com` redirects to `https://wordado.com`, which is the website: a proxied
`AAAA www 100::` record and a Redirect Rule (*Redirect from WWW to root*: 301, path and query string kept).
Never serve the app on `www` too, nor on the main domain: its local data, sign-in cookie and installed app would
be separate from `app.wordado.com`'s. The app is only ever on `app.wordado.com`.
The public contact address, since 2026-10-10: `privacy@wordado.com`, a Cloudflare Email Routing address with no
mailbox, forwarded to the owner's inbox (wordado.com › Email › Email Routing). It is the one on the website's
legal pages (`https://wordado.com/<lang>/privacy/`). A second address, such as `support@`, is one more routing
rule.

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
   Mark the `preview` branch as the preview, once, in its SQL editor:
   `create schema wordado_env; create table wordado_env.environment (name text not null); insert into wordado_env.environment values ('preview');`
   Every preview deploy empties that database (#205) and refuses one without this mark. Never run it on production.
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
6. **Secrets and variables** (`gh` from the repository root). Every `gh secret` and `gh variable` command names the
   repository with `--repo wordado/wordado`: in a checkout with more than one git remote `gh` refuses with
   "multiple remotes" and sets nothing. `gh secret list --repo wordado/wordado --env production` shows what an
   environment has, by name and date. Create the environments, with production limited to `main`:
   `gh api -X PUT repos/wordado/wordado/environments/preview`,
   `gh api -X PUT repos/wordado/wordado/environments/production -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"`,
   then `gh api -X POST repos/wordado/wordado/environments/production/deployment-branch-policies -f name=main`.
   - Repository: `gh variable set CLOUDFLARE_ACCOUNT_ID --repo wordado/wordado --body <cloudflare-account-id>`.
   - Both environments (`--env preview`, `--env production`): `gh secret set CLOUDFLARE_API_TOKEN --repo wordado/wordado`,
     `gh secret set DATABASE_URL --repo wordado/wordado` (that branch's direct URL), and
     `gh secret set BETTER_AUTH_SECRET --repo wordado/wordado`
     (`openssl rand -base64 48`, a different one per environment). Also
     `gh variable set CONTENT_MANIFEST_URL --repo wordado/wordado --body https://content.wordado.com/manifest.json`.
   - Optional, per environment: `TRIAL_MANIFEST_URL`, the manifest a visitor without an account installs from
     (built in as `VITE_TRIAL_MANIFEST_URL`, e.g. `https://content.example.test/trial-manifest.json`). Without it a
     visitor studies the bundled sample, as before; the deploy does not refuse an environment that lacks it.
   - `APP_ORIGIN`: `https://wordado-preview.<subdomain>.workers.dev` for preview, `https://app.wordado.com` for production.
   - `PASSKEY_RP_ID`, the passkeys' relying party (#287): not a GitHub variable but a var in `server/wrangler.jsonc`.
     `APP_ORIGIN`'s host must be that domain or on it (#304): a production deploy refuses one that is not, before
     anything is built (`scripts/check-route-host.ts`), and the Worker refuses to start with it.
     Production has `wordado.com` there; the preview and local runs leave it unset, and it falls back to `BASE_URL`'s
     hostname (the preview's `workers.dev` name, `localhost`). Production uses the registrable domain rather than
     `app.wordado.com` because a passkey made for `wordado.com` works on every subdomain: it survives a move of the
     app (the section on `app.wordado.com` below), and the native apps can later share the passkeys through
     associated domains served by the site at `wordado.com/.well-known/`. The origins a passkey is accepted from are
     still only `BASE_URL` and `TRUSTED_ORIGINS`. Changing the RP ID later strands every passkey made under the old
     one (the learner signs in with a code and adds a new one), so it is set before the first passkey deployment and
     left alone. Passkeys made on the preview never work on production, nor the reverse.
   - The R2 token pair is the content repository's secret (`pipeline/README.md`), not this one's: the copies
     kept here during the first corpus releases were removed on 2026-10-10.
   - Reminders, per environment: a pair from `pnpm --filter @wordado/server vapid-keys` as
     `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT` (`mailto:…`).
   - Production only (*done 2026-09-27*): `RESEND_API_KEY` with `EMAIL_FROM`
     (`Wordado <codes@wordado.com>`, once Resend has verified the domain). Without Resend,
     production prints sign-in codes to its log, as development does. The preview has no mailer on
     purpose: its codes are only in its log, which `smoke:remote` reads.
   - Production only, optional: `FEEDBACK_READ_TOKEN`, which lets the review app's Feedback tab read
     feedback from this server (`GET /v1/admin/feedback`, spec §8.12). One random value, the same in both
     deployments, made and set without ever being shown:
     `t=$(openssl rand -hex 32)`, then `printf %s "$t" | gh secret set FEEDBACK_READ_TOKEN --repo wordado/wordado --env production`
     here and `printf %s "$t" | pnpm --filter @wordado/review-app exec wrangler secret put FEEDBACK_READ_TOKEN --env production`
     for the review app (`review-app/README.md`, "Hosted", step 8), then `unset t`. Without it the route
     answers 404 and the tab says feedback is not connected. To change the token, set a new value in both
     places and deploy this server; until both agree the tab says the app's server answered 404.
   - Production only, optional: `ADMIN_WRITE_TOKEN`, which lets the review app's Accounts tab look an account
     up by its address, delete it, and read the counts of the sweep of inactive accounts and of accounts and
     their use, with what is behind them over time and by language (`/v1/admin/accounts/*`, #187, #206, #209). A second random value, made and set the same way as the one above
     (`t=$(openssl rand -hex 32)`, `printf %s "$t" | gh secret set ADMIN_WRITE_TOKEN --repo wordado/wordado --env production` here,
     `printf %s "$t" | pnpm --filter @wordado/review-app exec wrangler secret put ADMIN_WRITE_TOKEN --env production`
     for the review app, `unset t`). **It must not be the value of `FEEDBACK_READ_TOKEN`**: what can read
     learners' messages must not be able to delete an account, and a deploy refuses the two being equal.
     Without it the routes answer 404 and the tab says accounts are not connected. This server takes the value
     at its next production deploy, so after setting or changing it the tab says the app's server answered 404
     until that deploy has run; the routes answer 404 to a wrong token and to none alike, so they cannot be
     probed from outside. The sweep itself needs no
     setting: it runs with the cron whether or not the tab is connected.
   - Announcements (#185) need **no new secret**: the review app's Mail tab uses `ADMIN_WRITE_TOKEN`
     as the Accounts tab does, and the mails go through the mailer already in place (`RESEND_API_KEY`,
     `EMAIL_FROM`). One optional variable, `ANNOUNCEMENT_MAILS_PER_DAY`: the announcement mails sent in one UTC
     day at most, 50 when unset, which is half of the 100 a day of the mail provider's free plan, the rest being
     the sign-in codes'. On a plan without a daily limit, raise it by adding it to `vars` of the `production`
     block in `server/wrangler.jsonc`, in a pull request. `0` holds every send. See "Announcements" under
     Everyday.
   - This server mails no feedback. The notice that feedback came is the review app's weekly mail to its
     admins (`review-app/README.md`, "Hosted", step 8): a count and a link to the tab, sent on Monday for
     the week before. It needs the review app's `RESEND_API_KEY`, `FEEDBACK_READ_TOKEN` and
     `LEARNER_APP_URL`, and no setting of its own here.
   - Settings that can be deleted: since #170 (2026-10-10) nothing reads the production secrets
     `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (sign-in with Google) and `FEEDBACK_EMAIL` (the daily feedback
     mail), and the deploy no longer passes them to the Worker. Delete them with
     `gh secret delete <name> --repo wordado/wordado --env production`; `gh secret list --repo wordado/wordado --env production`
     shows whether any is left. The web client under Google Auth Platform › Clients served only that sign-in and
     can be deleted too; the service account of the review app's AI help is a different credential and stays.
     `REVIEW_APP_URL` went with the code, from `server/wrangler.jsonc`, and needs nothing.
   - AI help on the review app's Feedback tab is set up in the review app alone (`review-app/README.md`,
     "Hosted", step 9): its secret `FEEDBACK_AI_KEY`, and its variables `FEEDBACK_AI_AUTH` (how it signs in:
     `key`, the default, or `google-service-account`), `FEEDBACK_AI_URL` (the address of the service the model
     is reached through: https; by `key` OpenRouter's by default and any service that takes the same request; by
     `google-service-account` an address on `googleapis.com`, with no default), `FEEDBACK_AI_MODEL`,
     `FEEDBACK_AI_DAILY_CALLS` and `FEEDBACK_READS`. By `google-service-account` the secret is the content of
     the account's JSON key file. Learners' feedback is meant to go that way, to Google's endpoint for the
     European Union. Nothing is set here, and this server sends feedback to nobody but the review app. Before
     the switch in the tab is turned on, the privacy policy must name the AI service, and the transfer of the
     text to it must be covered (the EU–US Data Privacy Framework or standard contractual clauses).
   - **Order, for topics on the Feedback tab (#158, stage C): this server first, then the review app.** The
     review app opens a topic by asking this server for messages by id (`ids` on `GET /v1/admin/feedback`).
     A server from before that ignores `ids` and gives its newest page: nothing breaks and nothing is
     deleted, but a topic then opens with messages missing, and says so, until this server is deployed.
     The other way round is safe as well: the new server answers the old review app as before.
   A deploy refuses half of a pair, a `BETTER_AUTH_SECRET`, a `FEEDBACK_READ_TOKEN` or an `ADMIN_WRITE_TOKEN` under 32 characters, and an `ADMIN_WRITE_TOKEN` equal to the `FEEDBACK_READ_TOKEN` (`server/scripts/secretsFile.ts`).
7. **Protect `main`.** *Done 2026-09-25*: the five checks below are required, a pull request must be
   up to date with `main` before it merges, and force pushes to `main` and its deletion are refused.
   Admins can still override. A history rewrite of `main` therefore needs this protection lifted for
   the push and restored straight after. To set it up again:
   `gh api -X PUT repos/wordado/wordado/branches/main/protection -F "required_status_checks[strict]=true" -f "required_status_checks[contexts][]=Typecheck, lint, workflows, deploy config" -f "required_status_checks[contexts][]=Suites and the Worker smoke run" -f "required_status_checks[contexts][]=End to end (chromium)" -f "required_status_checks[contexts][]=End to end (firefox)" -f "required_status_checks[contexts][]=End to end (webkit)" -F enforce_admins=false -F "required_pull_request_reviews=null" -F "restrictions=null"`
   Those names are the CI jobs' names (`.github/workflows/ci.yml`), and a check must have run once on a pull request before GitHub offers it.
   The three `End to end` jobs are summaries: the browsers run in the `Browser tests (…)` jobs, in parts side by side, and each
   summary passes when all of them passed or none was needed (#239).
8. **The transport rate limit** (spec §10). Dashboard › wordado.com › Security › WAF › Rate limiting
   rules: *URI Path starts with `/v1/sync/`*, 60 requests per 10 seconds per IP, block for 10 seconds.
   A week offline is a few 500-event pages and a pull, far below it. Sign-in has its own limits (plan 5).
9. **Content first.** *Done 2026-09-27*, with the sample (v0), by the Publish content workflow that plan 8
   replaced. The first corpus version is published by the content repository's **Corpus** workflow
   (`pipeline/README.md`).
10. **Enable deploys.** `gh variable set DEPLOY_ENABLED --repo wordado/wordado --body true`. The next pull request deploys
    the preview, and the next merge deploys production. `cloudflare/wrangler-action@v4` exists (its
    `v4` tag was checked on 2026-09-25), but that first deploy is its first real use, so watch it. Once deploys are
    on, consider adding "Preview deployment / Deploy (preview)" to `main`'s required checks (step 7).

## Everyday

- **Release:**
  1. Open a pull request. Once its checks pass, CI deploys it to the preview and runs `smoke:remote` there.
     CI runs what the change can affect (#239, `.github/scripts/changes.sh`): a change to `review-app/`, `docs/` or
     top-level Markdown alone skips the learner app's browser tests and both of its deployments, documents alone skip
     the suites too, and anything else runs everything. On `main` the comparison is with the last commit deployed, so
     a run that failed leaves nothing behind: the next merge deploys its changes as well.
  2. Try it on `https://wordado-preview.danchom.workers.dev`. Sign-in codes appear in
     `pnpm --filter @wordado/server exec wrangler tail --env preview`, since the preview has no mailer. The
     preview is shared, so with several pull requests open it shows the one deployed last. Each deploy starts
     its database empty (#205), so accounts made there last only until the next one.
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
- **Inactive accounts (#187):** the cron deletes accounts not signed in to for 24 months
  (`server/src/account/sweep.ts`): once a UTC day, at most 50 accounts a run, the longest away first, with the
  learner's own deletion and no mail first. Its log line is a count (`account sweep: N inactive account(s)
  deleted`); the review app's Accounts tab shows what it would take next and what it took. Migration
  `0010_last_sign_in.sql` starts the record of the last sign-in: **every account that exists when it runs is
  dated from that day**, since nothing kept says when it last signed in, so the first deletions come 24 months
  after that deploy at the earliest. From then on the date moves at each sign-in and each time a session is
  extended (once a day of use). An account with no date is never deleted; the tab counts such accounts, and
  the number should stay 0.
- **Announcements (#185):** written and sent from the review app's Mail tab
  (`review-app/README.md`, "Hosted", step 11; the design is §18 of
  `docs/superpowers/specs/2026-10-05-hosted-review-app-design.md`). A service notice goes to every account
  holder, news only to accounts that consented, with an unsubscribe link. What to know when one is sent:
  - **The text of a notice (#215)** can be taken from the notice prepared with the change, and the empty
    languages translated by the review app's AI help: both are the review app's alone and need nothing of this
    server (`review-app/README.md`, "Hosted", step 12, and "Prepared notices" for the file's format). A
    translation is a machine's: read each one, and the test send, before sending.
  - **Order of deploys:** this server first (migration `0011_announcements.sql` adds three tables and changes
    none), then the review app. Until the server has the routes the tab says the app's server answered 404.
  - **Nothing is mailed by the press.** The cron sends: at most 20 mails every 15 minutes and
    `ANNOUNCEMENT_MAILS_PER_DAY` (50) a UTC day, test sends counted. On the free mail plan 500 accounts take ten
    days; the tab shows how far a send is and what holds it, and **Stop sending** halts it. The first change of
    the terms should be sent that many days before it has to have reached everyone, or after the limit is raised.
  - **The mails come from `EMAIL_FROM`**, the address of the sign-in codes, with `Reply-To` the public contact
    address (`privacy@wordado.com`), so an answer reaches a mailbox. A sending address of its own for
    announcements would be one more setting; there is none yet.
  - **Without a mailer** (the preview, local development) a send runs the same way and each mail is one log line
    with its subject and no address: a way to rehearse a send, not to deliver one.
  - **The log** says `announcements: N sent, N failed, N skipped` for a run that did something, and never an
    address or an account.
  - **Before the first mail** the privacy policy has to say that the address is used for service notices, and for
    news with consent (it lives in the site repository).
- **Rollback:** `pnpm --filter @wordado/server exec wrangler rollback --env production` restores the previous
  Worker and its assets together. Migrations are forward-only: never roll the schema back; write a new migration.
  Never roll production back to a version from before the move (2026-10): a rollback restores a version's
  plain-text variables but not its route, so `app.wordado.com` would get `BASE_URL` `https://wordado.com` and
  sign-in would break. Redeploy a fix instead.
- **The preview's database** is emptied by every preview deploy before the migrations run (#205): every table in
  `public` is dropped, the migration record too, and the pull request's own migrations run from the start. So
  another pull request's migration, or one edited during review, never stops a deploy. It refuses a database
  without the mark from step 2; if a deploy says so, the preview's `DATABASE_URL` points at the wrong branch.
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

*Done.* Kept as the record of how; the Google steps are moot since sign-in with Google was removed (2026-10-10).

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
