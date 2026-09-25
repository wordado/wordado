# CI and Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every pull request is typechecked, linted, tested and run end to end across the browser matrix. Each pull request gets a preview deployment with a smoke run, and each merge to `main` deploys the Worker and the web app together. Content reaches learners from R2 behind the CDN. The account-deletion and export identity gap from plan 6b is closed, and so are two WebKit bugs the matrix turned up.

**Architecture:** One Worker serves the API and the web app's static assets from the same origin, so session cookies, the CSRF check and "deploy the server before the client" all hold without CORS or ordering. Local development is unchanged (top-level `wrangler.jsonc`). Two Wrangler environments, `preview` and `production`, carry the deployed bindings. GitHub Actions has one `CI` workflow (static checks, suites, the e2e matrix, then a reusable `Deploy` workflow) and a manual `Publish content` workflow that uploads packs and audio to R2 and publishes the manifest last. A learner's packs come from `VITE_CONTENT_MANIFEST_URL`; the demo keeps the bundled sample.

**Tech Stack:** GitHub Actions (Ubuntu 24.04 runners), `cloudflare/wrangler-action@v4`, Wrangler 4 (`--secrets-file`, static assets with `run_worker_first`), Cloudflare Hyperdrive, Queues and R2, Neon Postgres (Frankfurt), oxlint 1.85, Playwright 1.63 (Chromium, Firefox, WebKit), the AWS CLI against R2's S3 API.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`. This plan implements §4.4 (build, deploy, preview deployments, secrets, the manually started content workflow), §9.3 (content from the CDN), §10 (the transport rate limit), §13 (automated WCAG checks in CI; client end to end across desktop Chrome, Firefox and Safari and mobile Chrome and Safari; storage cleared between sessions; the no-OPFS fallback) and §17 (vendors). Roadmap: `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, row 7.

## Global Constraints

- Node `>=24`, pnpm `12.4.2` (`packageManager`), TypeScript 7. Every package keeps `pnpm typecheck` and `pnpm test` green.
- **Nothing merges red** (§4.4). CI runs on every pull request and on every push to `main`.
- **Deploy on merge to `main`:** migrations first (forward-only), then the Worker and the web app's static assets, through Cloudflare's Wrangler action (§4.4, §17.1: `cloudflare/wrangler-action`, v4).
- **Pull requests get a preview deployment** (§4.4), and CPU-sensitive paths (replay on sync) run there before merge.
- **Secrets live in GitHub environment secrets, never in the repository. Production deploys use a protected environment** (§4.4).
- **The corpus workflow publishes the manifest only after every file it names is uploaded** (§4.4: "so a client can never see a version whose files are not all in place").
- **Local development needs no cloud account** (§4.4). `pnpm --filter @wordado/server dev`, `smoke` and both e2e suites keep working offline, exactly as today.
- **Rate limiting at the transport allows a full backlog flush** (§10).
- **Linux runners only** (§17.1). Private repository: 2,000 Actions minutes a month (§17.2), so pull requests run three browser projects and `main` runs all five (Decision 6).
- Interface strings go through `en.ts` and `bg.ts`. No raw `err.message` reaches the learner (plan 6b's `errorMessageKey`).
- Follow plan 6b's code style: comments say why, cite the spec section, and read as prose.

## Decisions (made while writing this plan, 2026-09-25)

1. **One Worker serves the app and the API.** Wrangler's `assets` with `run_worker_first: ["/api/*", "/v1/*", "/health"]` and `not_found_handling: "single-page-application"`. One deploy replaces both at once, so plan 5's "deploy the server before any client that raises the protocol" holds by construction: the server accepts older clients, and the new client only ever meets the new server. It also keeps plan 5's same-origin design (no CORS, `TRUSTED_ORIGINS` = the app's own origin). `assets` appears only in the deployed environments, so local `wrangler dev` does not need a web build.
2. **Wrangler environments.** Top level = local (renamed `wordado-local`, so a stray `wrangler deploy` without `--env` can never overwrite production). `env.production` = Worker `wordado` on the custom domain `wordado.com`. `env.preview` = Worker `wordado-preview` on `workers.dev`, with its own Hyperdrive (a Neon branch), its own queue and its own cron. The Hyperdrive ids only exist once the operator creates them (Task 12). Until then the zero id stays in the config, and the deploy workflow refuses to deploy it.
3. **One shared preview deployment.** Each pull request's green CI deploys `wordado-preview`, and the last one wins. Its origin is fixed, so it can be the one trusted origin. Per-PR version aliases would need wildcard trusted origins and a database per PR. The preview is serialised by a concurrency group.
4. **`BASE_URL` and `TRUSTED_ORIGINS` come from the GitHub environment variable `APP_ORIGIN`** through `--var`. `configFromEnv` now refuses an empty `BASE_URL`, so a manual deploy that forgets them fails loudly instead of running with `undefined`.
5. **Secrets travel with the deploy** through `wrangler deploy --secrets-file`, built by `server/scripts/write-secrets.ts` from the GitHub environment. It keeps only non-empty values and refuses half-pairs (Google, VAPID, Resend) and a short `BETTER_AUTH_SECRET`. Secrets a later deploy leaves out are not deleted (Wrangler's documented behaviour).
6. **Browser matrix (spec §13).** Playwright projects `chromium`, `firefox`, `webkit`, `mobile-chrome` (Pixel 7), `mobile-safari` (iPhone 15). `E2E_PROJECTS` picks them (default `chromium`, so local runs are unchanged). Pull requests run chromium, firefox and webkit (the OPFS path, Firefox's OPFS, and the IndexedDB fallback). `main` also runs both mobile projects. One job per project runs both suites.
7. **WebKit exercises the no-OPFS fallback.** Found while writing this plan: Playwright's WebKit contexts, like Safari's private windows, offer OPFS but fail `createSyncAccessHandle` with `UnknownError`. The app treated that as a real failure and showed "could not open its storage", so every WebKit test failed. Task 2 probes OPFS with a throwaway file when the learner has no OPFS database yet, and moves on to IndexedDB when the probe fails. With that, the WebKit projects are spec §13's "no-OPFS fallback" run.
8. **Sign-out and deletion never touch the push manager without notification permission.** Also found here: in WebKit, `pushManager.getSubscription()` never settled, so sign-out stayed on "Signing out…" forever. No subscription can exist without permission `granted`, so `ReminderService.stop` returns at once in that case.
9. **Offline navigation is skipped on WebKit only.** Playwright's WebKit fails `page.goto` while `context.setOffline(true)` ("WebKit encountered an internal error"), even with a service worker in control. The two offline tests are skipped on `webkit` and `mobile-safari`, and an offline pass in real Safari joins the release checklist (`docs/deploy.md`).
10. **Lint is oxlint** (1.85, exact). typescript-eslint cannot run on TypeScript 7, whose compiler has no JS API. oxlint's `correctness` category, with the typescript, unicorn, oxc and react plugins, flags three real problems today (Task 3). React's `exhaustive-deps` and `set-state-in-effect` are off: their dozen findings are deliberate effects reviewed in plans 6a and 6b, and "fixing" them would change behaviour.
11. **CI's Postgres is plan 5's Docker Compose file**, which the server's `test`, `smoke` and `dev` scripts already start (`postgres:18-alpine`, the image the spec asks CI to share). GitHub's Ubuntu runners have Docker, so CI runs the same commands as a developer. A separate service container would be a second path.
12. **Account deletion and export are identity-checked** (6b's handover). Both routes get plan 6b's `owner` middleware. The export becomes a `fetch` with `x-wordado-user` and a saved file, instead of a plain link that could not carry the header.
13. **Learner content.** `fetchManifest(url)` now resolves each pack's URL against the manifest once, so one `packFetcher()` serves any manifest. `BootDeps.fetchManifest`, `prepare` and `onReady` receive the account. `main.tsx` picks the manifest: the sample for the demo, `VITE_CONTENT_MANIFEST_URL` (falling back to the sample) for a learner. An `AudioSwitch` keeps one `AudioStore` per manifest behind the one `AudioPort` the screens hold. Fetching every clip ahead happens only for the bundled sample.
14. **R2 layout = the pipeline's output directory.** `manifest.json` goes at the bucket root, packs beside it and clips under `audio/`, exactly as `pipeline/samples/a1-bg/` is laid out, so the manifest's relative URLs need no rewriting. Packs are `immutable` (their names carry the version), audio is cached for a day, and the manifest is `no-cache`. `corpus publishable <dir>` checks every file the manifest reaches before anything is uploaded. Until plan 8, the published content is the sample itself.
15. **Plan 7 goes through a pull request.** Its own PR is the first CI run (Task 11). From then on, work goes through pull requests (the standing agreement until CI exists).

## Review Focus

1. **Safari with no usable OPFS** (private windows, and Playwright's WebKit): the app must open on IndexedDB and study normally, never show "could not open its storage". An existing OPFS database must never be abandoned for an empty IndexedDB one. Task 2: `opfsProbe.test.ts` covers probe failure with and without an existing file, and the WebKit e2e projects cover it end to end.
2. **Signing out or deleting on a browser whose push API hangs**: it must finish and show its notice. Task 2: `reminders.test.ts` "stops without asking the push manager when permission was never granted", and the accounts suite's sign-out test on WebKit.
3. **Export or deletion while the session cookie belongs to another learner**: refused with 409. No account is deleted, no file is saved, and the learner reads "sign in again". Task 1: server tests on both routes, `api.test.ts`, and `Settings.test.tsx` "says why the export failed and saves nothing".
4. **A deploy that would run with a placeholder Hyperdrive id, a missing or short `BETTER_AUTH_SECRET`, a half-set secret pair, or an empty `BASE_URL`**: it stops before production changes. Task 7: `secretsFile.test.ts` and `config.test.ts`, plus the workflow's dry-run guard in Task 9.
5. **A content publish with a missing, truncated or tampered file, or an absolute URL in the manifest**: nothing is uploaded, and the old manifest stays live. Task 6: `publishable.test.ts`, plus the workflow's order (check → packs and audio → manifest).

---

## File Structure

**Server (`server/`)**
- `src/app.ts`, `src/account/routes.ts`: deletion and export behind `owner` (Task 1).
- `src/http.test.ts`: the identity tests for both routes (Task 1).
- `src/config.ts` + `config.test.ts`: refuse an empty `BASE_URL` (Task 7).
- `wrangler.jsonc`: local top level renamed; `env.preview` and `env.production` (Task 7).
- `scripts/secretsFile.ts` + `scripts/secretsFile.test.ts`: the Worker's secrets from an environment (Task 7).
- `scripts/write-secrets.ts`: writes the secrets file a deploy uploads (Task 7).
- `scripts/smokeRun.ts`: the smoke steps, shared by the local and remote runs, with a full 500-event page (Task 8).
- `scripts/smoke.ts`: local runner, now a thin wrapper (Task 8).
- `scripts/smoke-remote.ts`: runs the steps against a deployment, reading codes through `wrangler tail` (Task 8).
- `vitest.config.ts`: include `scripts/**/*.test.ts` (Task 7).
- `package.json`: `deploy:check`, `smoke:remote` (Tasks 7, 8).
- `README.md`: deploying (Task 10).

**Web (`web/`)**
- `src/account/api.ts` + `api.test.ts`: `exportData()`; `deleteAccount` names the learner (Task 1).
- `src/download.ts`: `saveFile` (Task 1).
- `src/settings/AccountSettings.tsx`, `src/screens/Settings.test.tsx`, `src/test/fakeApi.ts`, `src/i18n/en.ts`, `src/i18n/bg.ts`: the export button (Task 1).
- `src/storage/opfsProbe.ts` + `opfsProbe.test.ts`: whether OPFS can open a file here (Task 2).
- `src/storage/waSqlite.ts`: `openOpfs` probes first (Task 2).
- `src/reminders/reminders.ts` + `reminders.test.ts`: `stop` without permission (Task 2).
- `e2e/projects.ts` + `e2e/projects.test.ts`: the browser matrix (Task 4).
- `playwright.config.ts`, `playwright.accounts.config.ts`, `vitest.config.ts`, `e2e/demo.spec.ts`, `e2e/accounts.spec.ts`: the matrix, the WebKit skips, and the storage-cleared test (Task 4).
- `src/content/packs.ts` + `packs.test.ts`: absolute pack URLs, `manifestUrlFor`, `CONTENT_MANIFEST_URL` (Task 5).
- `src/content/env.d.ts`: `VITE_CONTENT_MANIFEST_URL` (Task 5).
- `src/content/audioSwitch.ts` + `audioSwitch.test.ts`: one `AudioStore` per manifest (Task 5).
- `src/app/boot.ts` + `boot.test.ts`: the account reaches `fetchManifest`, `prepare` and `onReady` (Task 5).
- `src/main.tsx`: wiring (Task 5).
- `public/_headers` + `vite/headers.test.ts`: caching for the Worker's static assets (Task 7).
- `README.md`: the matrix and content (Tasks 4, 5).

**Pipeline (`pipeline/`)**
- `src/publishable.ts` + `src/publishable.test.ts`: what is wrong with serving a directory as the CDN root (Task 6).
- `src/cli.ts`: `corpus publishable <dir>` (Task 6).

**Client-data**: `src/client.ts`, `src/study.test.ts`: the lint findings (Task 3).

**Repository**
- `package.json`: `lint` and `oxlint` (Task 3).
- `.oxlintrc.json` (Task 3).
- `.gitignore`: `graphify-out/` (Task 3).
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/publish-content.yml` (Task 9).
- `docs/deploy.md`: provisioning, secrets, the rate-limit rule, rollback, the release checklist (Task 10).
- `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md` (Task 10).

---

### Task 1: Identity check on account deletion and export

Plan 6b's handover: a device holding learner A's record with B's session cookie could delete B's account and download B's data. Both routes get the same check as sync.

**Files:**
- Modify: `server/src/app.ts`, `server/src/account/routes.ts`
- Test: `server/src/http.test.ts`
- Modify: `web/src/account/api.ts`, `web/src/test/fakeApi.ts`, `web/src/settings/AccountSettings.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`
- Create: `web/src/download.ts`
- Test: `web/src/account/api.test.ts`, `web/src/screens/Settings.test.tsx`

**Interfaces:**
- Consumes: `sameUser()` and `EXPECTED_USER_HEADER` (`server/src/http.ts`); `expectedUserHeader(userId)` (`web/src/account/transport.ts`); `errorMessageKey(err)` (`web/src/errors.ts`), which already maps a 409 to `error.signIn`.
- Produces: `accountRoutes(app, deps, user, owner)`. `Api.exportData(): Promise<ExportFile>` with `interface ExportFile { readonly name: string; readonly json: string }`. `saveFile(name: string, text: string, type?: string): void`. New key `settings.exporting`. `EXPORT_URL` is removed.

- [ ] **Step 1: Write the failing server tests**

Append inside the `describe('x-wordado-user: …')` block of `server/src/http.test.ts`:

```ts
  it('refuses to delete another learner’s account, and deletes nothing', async () => {
    const h = harness()
    const s = await h.signIn()
    const wrong = await s.del('/v1/account', { confirm: true }, { 'x-wordado-user': 'someone-else' })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toEqual({ error: 'wrong_user' })
    expect((await s.get('/v1/me')).status).toBe(200)
    expect((await s.del('/v1/account', { confirm: true }, { 'x-wordado-user': s.userId })).status).toBe(200)
    expect((await s.get('/v1/me')).status).toBe(401)
  })

  it('refuses to export another learner’s data, and exports for the right one or an older client', async () => {
    const h = harness()
    const s = await h.signIn()
    const wrong = await s.get('/v1/export', { 'x-wordado-user': 'someone-else' })
    expect(wrong.status).toBe(409)
    expect(wrong.body).toEqual({ error: 'wrong_user' })
    const right = await s.get('/v1/export', { 'x-wordado-user': s.userId })
    expect(right.status).toBe(200)
    expect(right.body.account.userId).toBe(s.userId)
    expect((await s.get('/v1/export')).status).toBe(200)
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @wordado/server exec vitest run src/http.test.ts`
Expected: the two new tests FAIL (deletion answers 200 and export answers 200 despite the wrong header).

- [ ] **Step 3: Put deletion and export behind `owner`**

In `server/src/app.ts`, change the call to `accountRoutes(app, deps, user, owner)`.

In `server/src/account/routes.ts`, change the signature and the two routes (`/v1/me` and `/v1/country` are unchanged):

```ts
export function accountRoutes(
  app: Hono<AppEnv>,
  deps: ServerDeps,
  user: MiddlewareHandler<AppEnv>,
  /** The session user, who must be the one the client names (x-wordado-user): deletion and export act on a whole account. */
  owner: MiddlewareHandler<AppEnv>,
): void {
```

and use `owner` in place of `user` in `app.delete('/v1/account', owner, …)` and `app.get('/v1/export', owner, …)`.

- [ ] **Step 4: Run the server suite**

Run: `pnpm --filter @wordado/server test`
Expected: PASS.

- [ ] **Step 5: Write the failing web API tests**

In `web/src/account/api.test.ts`, extend `fakeFetch` so a route can carry response headers. Replace the function with:

```ts
/** A fetch that answers from a table of `METHOD path` → [status, body, headers?], and records every call. */
function fakeFetch(routes: Record<string, readonly [number, unknown, Record<string, string>?]>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes[`${init?.method ?? 'GET'} ${url}`]
    if (!route) throw new TypeError('Failed to fetch')
    const [status, body, headers = {}] = route
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
  }
  return { fetchFn, calls }
}
```

Then add these tests inside `describe('httpApi (plan 5 contract)', …)`:

```ts
  it('names the learner an account deletion is for, and reports a refusal', async () => {
    const { fetchFn, calls } = fakeFetch({ 'DELETE /v1/account': [200, { deleted: true }] })
    await httpApi(fetchFn, () => 'u1').deleteAccount()
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
    const refused = fakeFetch({ 'DELETE /v1/account': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').deleteAccount()).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
  })

  it('fetches the export for the recorded learner, with the server’s file name', async () => {
    const { fetchFn, calls } = fakeFetch({
      'GET /v1/export': [200, { format: 'wordado-export-1' }, { 'content-disposition': 'attachment; filename="wordado-export-2026-09-25.json"' }],
    })
    const file = await httpApi(fetchFn, () => 'u1').exportData()
    expect(file).toEqual({ name: 'wordado-export-2026-09-25.json', json: '{"format":"wordado-export-1"}' })
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).get('x-wordado-user')).toBe('u1')
  })

  it('names the export file itself when the server does not, and reports a refusal or no connection', async () => {
    const unnamed = fakeFetch({ 'GET /v1/export': [200, { format: 'wordado-export-1' }] })
    expect((await httpApi(unnamed.fetchFn).exportData()).name).toBe('wordado-export.json')
    const refused = fakeFetch({ 'GET /v1/export': [409, { error: 'wrong_user' }] })
    await expect(httpApi(refused.fetchFn, () => 'u1').exportData()).rejects.toMatchObject({ status: 409, code: 'wrong_user' })
    await expect(httpApi(fakeFetch({}).fetchFn).exportData()).rejects.toBeInstanceOf(OfflineError)
  })
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/api.test.ts`
Expected: FAIL. `exportData` is not a function, and the deletion carries no header.

- [ ] **Step 7: Implement `exportData`, and name the learner on deletion**

In `web/src/account/api.ts`:

1. Delete `EXPORT_URL` and its comment.
2. Add after `PushSubscriptionBody`:

```ts
/** `GET /v1/export` (spec §11): the learner's data, and the name the server gave the file. */
export interface ExportFile {
  readonly name: string
  readonly json: string
}
```

3. Add `exportData(): Promise<ExportFile>` to `Api`, after `deleteAccount(): Promise<void>`, with the doc comment `/** The data export, for the recorded learner only (409 when the session is someone else's). */`.
4. Replace the inner `call` function with a `request` that keeps the response, and a `call` over it:

```ts
  async function request(
    method: string,
    path: string,
    body?: unknown,
    extra: Record<string, string> = {},
  ): Promise<{ readonly response: Response; readonly text: string; readonly parsed: unknown }> {
    let response: Response
    try {
      response = await fetchFn(path, {
        method,
        credentials: 'include',
        headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...extra },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch (err) {
      throw new OfflineError(err)
    }
    const text = await response.text()
    let parsed: unknown = null
    try {
      parsed = text === '' ? null : JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok) throw new ApiError(response.status, codeOf(parsed))
    return { response, text, parsed }
  }

  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}): Promise<unknown> =>
    (await request(method, path, body, extra)).parsed
```

5. Change `deleteAccount` and add `exportData` in the returned object:

```ts
    deleteAccount: async () => {
      await call('DELETE', '/v1/account', { confirm: true }, expectedUserHeader(expectedUser()))
    },
    exportData: async () => {
      const { response, text } = await request('GET', '/v1/export', undefined, expectedUserHeader(expectedUser()))
      const name = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ?? 'wordado-export.json'
      return { name, json: text }
    },
```

6. Update the `httpApi` doc comment's last sentence to say: "`expectedUser` names the recorded learner on the push-subscription calls, the account deletion and the export, so a session that is someone else's is refused (409) rather than acted on."

In `web/src/test/fakeApi.ts`, add after `deleteAccount`:

```ts
    exportData: async () => {
      calls.push('exportData')
      return { name: 'wordado-export-2026-09-25.json', json: '{"format":"wordado-export-1"}' }
    },
```

- [ ] **Step 8: Run the API tests**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/api.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing settings tests**

In `web/src/screens/Settings.test.tsx`, add at the top, after the existing imports:

```ts
import { vi } from 'vitest'
import { ApiError } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { saveFile } from '../download'

vi.mock('../download', () => ({ saveFile: vi.fn() }))
```

(merge `vi` into the existing `vitest` import instead of a second import line). Replace the test `'downloads the export with the session'`, and the demo test's last assertion, with:

```ts
  it('offers an account from the demo, and no export or deletion', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.getByText(/without an account/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download your data (JSON)' })).toBeNull()
  })

  it('downloads the export for the recorded learner and saves it under the server’s name', async () => {
    vi.mocked(saveFile).mockClear()
    const ctx = await setup()
    const api = fakeApi()
    renderWith(<Settings />, { ...ctx, account: ana, api })
    expect(screen.getByText('Signed in as ana@example.com')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download your data (JSON)' })))
    expect(api.calls).toContain('exportData')
    expect(saveFile).toHaveBeenCalledWith('wordado-export-2026-09-25.json', '{"format":"wordado-export-1"}')
  })

  it('says why the export failed and saves nothing', async () => {
    vi.mocked(saveFile).mockClear()
    const ctx = await setup()
    const api = fakeApi({
      exportData: async () => {
        throw new ApiError(409, 'wrong_user')
      },
    })
    renderWith(<Settings />, { ...ctx, account: ana, api })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download your data (JSON)' })))
    expect(screen.getByRole('alert').textContent).toBe('Your sign-in has expired. Sign in again.')
    expect(saveFile).not.toHaveBeenCalled()
  })
```

- [ ] **Step 10: Run them and watch them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/screens/Settings.test.tsx`
Expected: FAIL. `../download` does not exist, and the export is still a link.

- [ ] **Step 11: Add `saveFile` and the export button**

Create `web/src/download.ts`:

```ts
/**
 * Hands the browser a file to save, as a download link would. The object
 * URL outlives the click by a minute: Safari starts the download after the
 * click returns, and revoking at once can cancel it.
 */
export function saveFile(name: string, text: string, type = 'application/json'): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
```

In `web/src/settings/AccountSettings.tsx`:
- Remove the `EXPORT_URL` import. Add `import { saveFile } from '../download'`.
- Read `api` from `useApp()` too: `const { account, accounts, api } = useApp()`.
- Add state beside the others: `const [exporting, setExporting] = useState(false)` and `const [exportError, setExportError] = useState<string | null>(null)`.
- Add, beside `signOutFromButton`:

```ts
  /** The export names the recorded learner (x-wordado-user), so a session that is someone else's is refused (spec §11). */
  const exportData = async () => {
    setExportError(null)
    setExporting(true)
    try {
      const file = await api.exportData()
      saveFile(file.name, file.json)
    } catch (err) {
      setExportError(t(errorMessageKey(err)))
    } finally {
      setExporting(false)
    }
  }
```

- Replace the export `<li>`'s online branch (the `<a href={EXPORT_URL} download>…</a>`) with:

```tsx
            <>
              <button type="button" className="button" disabled={exporting} onClick={() => void exportData()}>
                {t('settings.export')}
              </button>
              <p className="note" role="status">
                {exporting ? t('settings.exporting') : ''}
              </p>
              {exportError !== null && (
                <p className="field-error" role="alert">
                  {exportError}
                </p>
              )}
            </>
```

Add the key to `web/src/i18n/en.ts` after `'settings.exportOffline'`: `'settings.exporting': 'Preparing your data…',`. Add it to `web/src/i18n/bg.ts` in the same place: `'settings.exporting': 'Данните ви се подготвят…',`.

- [ ] **Step 12: Run the web suite and typecheck**

Run: `pnpm --filter @wordado/web test && pnpm --filter @wordado/web typecheck`
Expected: PASS. If `i18n.test.tsx` checks that both dictionaries have the same keys, it passes with the key in both.

- [ ] **Step 13: Commit**

```bash
git add server/src/app.ts server/src/account/routes.ts server/src/http.test.ts web/src/account/api.ts web/src/account/api.test.ts web/src/test/fakeApi.ts web/src/download.ts web/src/settings/AccountSettings.tsx web/src/screens/Settings.test.tsx web/src/i18n/en.ts web/src/i18n/bg.ts
git commit -m "fix: account deletion and export name the recorded learner; the server refuses another's (409)"
```

---

### Task 2: WebKit — the IndexedDB fallback, and a sign-out that finishes

**Files:**
- Create: `web/src/storage/opfsProbe.ts`
- Test: `web/src/storage/opfsProbe.test.ts`
- Modify: `web/src/storage/waSqlite.ts:38-48`
- Modify: `web/src/reminders/reminders.ts` (`stop`)
- Test: `web/src/reminders/reminders.test.ts`

**Interfaces:**
- Consumes: `StorageUnavailable` and `isUnsupportedError` (`web/src/storage/open.ts`).
- Produces: `interface ProbeDirectory`; `PROBE_FILE = '.wordado-probe'`; `checkOpfs(root: ProbeDirectory, file: string): Promise<void>`, which throws `StorageUnavailable` when OPFS cannot open a file here and the learner has no OPFS database yet.

- [ ] **Step 1: Write the failing probe tests**

Create `web/src/storage/opfsProbe.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { StorageUnavailable } from './open'
import { checkOpfs, PROBE_FILE, type ProbeDirectory } from './opfsProbe'

/** An OPFS root holding `files`, whose sync access handles fail with `failure` when given. */
function directory(files: string[], failure?: string) {
  const present = new Set(files)
  const removed: string[] = []
  const root: ProbeDirectory = {
    getFileHandle: async (name, options) => {
      if (!present.has(name)) {
        if (!options?.create) throw new DOMException('A requested file or directory could not be found', 'NotFoundError')
        present.add(name)
      }
      return {
        createSyncAccessHandle: async () => {
          if (failure) throw new DOMException('The operation failed for an unknown transient reason', failure)
          return { close: () => undefined }
        },
      }
    },
    removeEntry: async (name) => {
      present.delete(name)
      removed.push(name)
    },
  }
  return { root, present, removed }
}

describe('checkOpfs (spec §9.1: OPFS, then IndexedDB)', () => {
  it('passes where a file opens, and leaves no probe behind', async () => {
    const d = directory([])
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(d.present.has(PROBE_FILE)).toBe(false)
  })

  it('reports OPFS as unavailable when no file can be opened and the learner has none there (Safari private windows)', async () => {
    const d = directory([], 'UnknownError')
    const err = await checkOpfs(d.root, 'demo').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(StorageUnavailable)
    expect((err as Error).message).toContain('UnknownError')
    expect(d.present.has(PROBE_FILE)).toBe(false)
  })

  it('never gives up on an OPFS database that already exists: its own open reports the failure instead', async () => {
    const d = directory(['demo.sqlite'], 'UnknownError')
    await expect(checkOpfs(d.root, 'demo')).resolves.toBeUndefined()
    expect(d.removed).toEqual([])
  })

  it('probes for the learner’s own file, not another one', async () => {
    const d = directory(['demo.sqlite'], 'UnknownError')
    await expect(checkOpfs(d.root, 'user-u1')).rejects.toBeInstanceOf(StorageUnavailable)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/storage/opfsProbe.test.ts`
Expected: FAIL. `./opfsProbe` does not exist.

- [ ] **Step 3: Implement the probe**

Create `web/src/storage/opfsProbe.ts`:

```ts
import { StorageUnavailable } from './open'

/** The part of an OPFS directory handle the probe uses. */
export interface ProbeDirectory {
  getFileHandle(name: string, options?: { readonly create?: boolean }): Promise<{ createSyncAccessHandle(): Promise<{ close(): void }> }>
  removeEntry(name: string): Promise<void>
}

/** Created and removed again by every probe; not a `.sqlite` name, so `listDatabases` never sees it. */
export const PROBE_FILE = '.wordado-probe'

const describe = (err: unknown): string => (err instanceof Error ? `${err.name}: ${err.message}` : String(err))

/**
 * Whether OPFS can open a file here at all. Safari's private windows (and
 * Playwright's WebKit) offer OPFS but fail every `createSyncAccessHandle`
 * with `UnknownError`, which would otherwise read as a real failure and stop
 * the app (spec §9.1 wants IndexedDB then). Only probed while the learner has
 * no OPFS database: once one exists, falling back would open an empty second
 * database beside it, so its own open must report the failure instead.
 */
export async function checkOpfs(root: ProbeDirectory, file: string): Promise<void> {
  try {
    await root.getFileHandle(`${file}.sqlite`)
    return
  } catch {
    // Not there yet: probe.
  }
  try {
    const handle = await root.getFileHandle(PROBE_FILE, { create: true })
    const access = await handle.createSyncAccessHandle()
    access.close()
  } catch (err) {
    throw new StorageUnavailable(`OPFS cannot open files here (${describe(err)})`)
  } finally {
    await root.removeEntry(PROBE_FILE).catch(() => undefined)
  }
}
```

- [ ] **Step 4: Run the probe tests**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/storage/opfsProbe.test.ts`
Expected: PASS.

- [ ] **Step 5: Probe in `openOpfs`**

In `web/src/storage/waSqlite.ts`, import `checkOpfs` and `ProbeDirectory` from `./opfsProbe`. In `openOpfs`, after the three `StorageUnavailable` checks and before `SQLiteSyncFactory()`, add:

```ts
  let root: FileSystemDirectoryHandle
  try {
    root = await navigator.storage.getDirectory()
  } catch (err) {
    if (isUnsupportedError(err)) throw new StorageUnavailable(`OPFS: ${messageOf(err)}`)
    throw err
  }
  // The DOM lib in use does not type createSyncAccessHandle on the handle getFileHandle returns.
  await checkOpfs(root as unknown as ProbeDirectory, file)
```

- [ ] **Step 6: Write the failing reminders test**

In `web/src/reminders/reminders.test.ts`, add inside the top-level `describe`:

```ts
  it('stops without asking the push manager when permission was never granted (it can hang in WebKit)', async () => {
    const p = platform({
      subscription: () => new Promise<never>(() => undefined),
    })
    const { s, storage } = service({ platform: p })
    storage.setItem('wordado.reminder', JSON.stringify({ minute: 540, streakNudge: false }))
    await s.stop({ server: true })
    expect(s.prefs()).toBeNull()
  })
```

- [ ] **Step 7: Run it and watch it time out**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/reminders/reminders.test.ts`
Expected: the new test FAILS by timing out. The platform starts at `'default'` permission, and `stop` still awaits `subscription()`.

- [ ] **Step 8: Return early without permission**

In `ReminderService.stop` (`web/src/reminders/reminders.ts`), add as the first lines of the body:

```ts
    // A push subscription exists only with permission granted, and WebKit's
    // getSubscription() can hang forever: without permission there is nothing
    // to end, so sign-out and deletion must not wait on it.
    if (this.deps.platform.permission() !== 'granted') {
      this.save(null)
      return
    }
```

- [ ] **Step 9: Run the web suite**

Run: `pnpm --filter @wordado/web test`
Expected: PASS. The browser project runs `workerDriver.browser.test.ts` in Chromium, where the probe passes, and nothing there changes.

- [ ] **Step 10: See WebKit open the demo by hand**

Run: `pnpm --filter @wordado/web exec playwright install webkit`, then `pnpm --filter @wordado/web build` and `pnpm --filter @wordado/web preview` in one terminal. In another, run a Node one-liner from `web/`:

```bash
node -e "import('playwright').then(async ({ webkit }) => { const b = await webkit.launch(); const p = await b.newPage(); await p.goto('http://localhost:4173/'); await p.waitForTimeout(6000); console.log(await p.locator('h1').allTextContents()); await b.close() })"
```

Expected: `[ '10 нови думи' ]`, the demo's Today heading, not the storage error. Stop the preview server.

- [ ] **Step 11: Commit**

```bash
git add web/src/storage/opfsProbe.ts web/src/storage/opfsProbe.test.ts web/src/storage/waSqlite.ts web/src/reminders/reminders.ts web/src/reminders/reminders.test.ts
git commit -m "fix(web): fall back to IndexedDB where OPFS cannot open a file; sign-out never waits on the push manager without permission"
```

---

### Task 3: Lint

**Files:**
- Create: `.oxlintrc.json`
- Modify: `package.json`, `.gitignore`, `client-data/src/client.ts:201`, `client-data/src/study.test.ts:2`, `web/src/app/boot.test.ts:51-56`
- Lockfile: `pnpm-lock.yaml`

**Interfaces:**
- Produces: `pnpm lint` at the repository root (used by Task 9).

- [ ] **Step 1: Add oxlint and its configuration**

Run: `pnpm add -w -D oxlint@1.85.0 --save-exact`

Create `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "react"],
  "categories": { "correctness": "error" },
  "rules": {
    "react/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "off",
    "react/set-state-in-effect": "off"
  },
  "ignorePatterns": ["**/dist/**", "**/node_modules/**", "graphify-out/**", "**/test-results/**", "**/playwright-report/**", "**/.wrangler/**"]
}
```

`exhaustive-deps` and `set-state-in-effect` are off on purpose. Their findings (about a dozen, in `web/src`) are effects that plans 6a and 6b wrote and reviewed deliberately, such as run-once focus moves and draft resets. The rules would make them fire at other times. Say so in the commit message, since JSON has no comments.

In the root `package.json` `scripts`, add `"lint": "oxlint --deny-warnings"`.

Add `graphify-out/` to the root `.gitignore` (a local knowledge-graph tool's output that must never be committed).

- [ ] **Step 2: Run it and see the three findings**

Run: `pnpm lint`
Expected: FAIL with exactly these:
- `client-data/src/study.test.ts:2` — `'join' is imported but never used`
- `client-data/src/client.ts:201` — `no-useless-spread` on `Promise.allSettled([...this.inFlight])`
- `web/src/app/boot.test.ts:51` — `'owner' is assigned a value but never used`

- [ ] **Step 3: Fix them**

- `client-data/src/study.test.ts`: remove `join` from the import on line 2. Delete the line if it imports nothing else.
- `client-data/src/client.ts`: `while (this.inFlight.size > 0) await Promise.allSettled(this.inFlight)`. `allSettled` reads the set once, synchronously, as the spread did, so the loop still waits for writes that start meanwhile.
- `web/src/app/boot.test.ts`: in `boot()`, delete `let owner = false`, change `acquire: async () => (owner = free)` to `acquire: async () => free`, and change `takeOver: async () => { owner = true }` to `takeOver: async () => undefined`.

- [ ] **Step 4: Run lint, typecheck and the two suites**

Run: `pnpm lint && pnpm typecheck && pnpm --filter @wordado/client-data test && pnpm --filter @wordado/web test`
Expected: lint prints `Found 0 warnings and 0 errors`, and everything passes.

- [ ] **Step 5: Commit**

```bash
git add .oxlintrc.json package.json pnpm-lock.yaml .gitignore client-data/src/client.ts client-data/src/study.test.ts web/src/app/boot.test.ts
git commit -m "chore: lint with oxlint (correctness; React effect-dependency rules off: their findings are deliberate effects), fix its three findings"
```

---

### Task 4: The browser matrix for both end-to-end suites

**Files:**
- Create: `web/e2e/projects.ts`, `web/e2e/projects.test.ts`
- Modify: `web/playwright.config.ts`, `web/playwright.accounts.config.ts`, `web/vitest.config.ts`, `web/e2e/demo.spec.ts`, `web/e2e/accounts.spec.ts`, `web/README.md`

**Interfaces:**
- Produces: `BROWSER_PROJECTS: readonly Project[]` and `selectProjects(value: string | undefined, all?: readonly Project[]): Project[]`. Environment variable `E2E_PROJECTS` (comma-separated names, or `all`; default `chromium`). Task 9's CI jobs set it to one project each.

- [ ] **Step 1: Write the failing test for project selection**

Create `web/e2e/projects.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BROWSER_PROJECTS, selectProjects } from './projects'

const names = (value: string | undefined) => selectProjects(value).map((p) => p.name)

describe('the end-to-end browser matrix (spec §13)', () => {
  it('holds desktop Chrome, Firefox and Safari, and mobile Chrome and Safari', () => {
    expect(BROWSER_PROJECTS.map((p) => p.name)).toEqual(['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'])
  })

  it('runs Chromium alone unless told otherwise, as local runs always have', () => {
    expect(names(undefined)).toEqual(['chromium'])
    expect(names('')).toEqual(['chromium'])
  })

  it('runs the named projects, or all of them', () => {
    expect(names('webkit')).toEqual(['webkit'])
    expect(names(' firefox , webkit ')).toEqual(['firefox', 'webkit'])
    expect(names('all')).toEqual(['chromium', 'firefox', 'webkit', 'mobile-chrome', 'mobile-safari'])
  })

  it('refuses a name it does not know, rather than running nothing', () => {
    expect(() => selectProjects('safari')).toThrow(/Unknown E2E_PROJECTS: safari/)
  })
})
```

In `web/vitest.config.ts`, add `'e2e/**/*.test.ts'` to the `unit` project's `include`: `include: ['src/**/*.test.{ts,tsx}', 'vite/**/*.test.ts', 'e2e/**/*.test.ts']`.

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit e2e/projects.test.ts`
Expected: FAIL. `./projects` does not exist.

- [ ] **Step 3: Implement the projects**

Create `web/e2e/projects.ts`:

```ts
import type { Project } from '@playwright/test'
import { devices } from 'playwright'

/**
 * Spec §13's browser matrix: desktop Chrome, Firefox and Safari, and mobile
 * Chrome and Safari. WebKit's contexts cannot open OPFS files, so the two
 * WebKit projects run the IndexedDB fallback (spec §13's "no-OPFS" case).
 */
export const BROWSER_PROJECTS: readonly Project[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  { name: 'mobile-safari', use: { ...devices['iPhone 15'] } },
]

/** The projects `E2E_PROJECTS` names (comma-separated, or `all`); Chromium alone when it is unset, as local runs have always been. */
export function selectProjects(value: string | undefined, all: readonly Project[] = BROWSER_PROJECTS): Project[] {
  const names = (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '')
  if (names.length === 0) return all.filter((p) => p.name === 'chromium')
  if (names.includes('all')) return [...all]
  const unknown = names.filter((name) => !all.some((p) => p.name === name))
  if (unknown.length > 0) throw new Error(`Unknown E2E_PROJECTS: ${unknown.join(', ')} (known: ${all.map((p) => p.name).join(', ')}, all)`)
  return all.filter((p) => names.includes(p.name!))
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @wordado/web exec vitest run --project unit e2e/projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Use the projects in both Playwright configs**

In `web/playwright.config.ts`, import `selectProjects` from `./e2e/projects` and replace the `projects` line (and its "Chromium only" comment) with:

```ts
  // Spec §13's matrix; E2E_PROJECTS picks (CI runs one project per job, Chromium alone locally).
  projects: selectProjects(process.env['E2E_PROJECTS']),
```

Do the same in `web/playwright.accounts.config.ts` (drop the `devices` import from both files if nothing else uses it).

- [ ] **Step 6: Skip the two offline tests on WebKit, with the reason**

In `web/e2e/demo.spec.ts`, change the offline test's signature and add the skip as its first line:

```ts
test('keeps progress offline after the first visit, and after reconnecting', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'Playwright’s WebKit fails page.goto while offline ("WebKit encountered an internal error"); Safari offline is on the release checklist (docs/deploy.md)')
```

In `web/e2e/accounts.spec.ts`, find the test `'studies offline, then syncs on reconnecting (spec §13)'`. Destructure `browserName` beside its existing fixtures, and add the same `test.skip(...)` line with the same reason as its first statement.

- [ ] **Step 7: Add the storage-cleared test (spec §13)**

Append to `web/e2e/accounts.spec.ts`:

```ts
test('brings a learner’s progress back after the browser’s storage was cleared (spec §13)', async ({ browser }) => {
  const email = address('cleared')
  const first = await context(browser)
  const page = await first.newPage()
  await signIn(page, email)
  await studyNew(page, 3)
  await page.goto('/')
  await synced(page)
  await first.close()

  // A new context is a browser with nothing kept: no database, no account record, no cookie.
  const cleared = await context(browser)
  const again = await cleared.newPage()
  await again.goto('/')
  await expect(heading(again)).toHaveText('10 new words')
  await signIn(again, email)
  await expect(heading(again)).toHaveText('7 new words', { timeout: 15_000 })
  await again.goto('/path')
  await expect(again.getByText('3 of 20 started')).toBeVisible()
  await cleared.close()
})
```

- [ ] **Step 8: Run both suites across the whole matrix**

Run from `web/`:

```bash
pnpm exec playwright install firefox webkit
E2E_PROJECTS=all pnpm e2e
E2E_PROJECTS=all pnpm e2e:accounts
```

Expected: every test passes, except the two offline tests, which show as skipped on `webkit` and `mobile-safari`. (Before Task 2, every WebKit test failed at the first heading, and the WebKit sign-out stayed on "Signing out…".) `e2e:accounts` needs Docker running and port 8787 free.

If a test fails in only one project, fix the cause in the app or the test. Never add a skip without a named browser limitation in its reason. Record each such fix in the task report.

- [ ] **Step 9: Document the matrix**

In `web/README.md`, under the command block, add:

```markdown
## The browser matrix (spec §13)

Both suites run in Chromium by default. `E2E_PROJECTS` picks others: `chromium`, `firefox`,
`webkit`, `mobile-chrome`, `mobile-safari`, several separated by commas, or `all`. Install a
browser once with `pnpm --filter @wordado/web exec playwright install <chromium|firefox|webkit>`.

```bash
E2E_PROJECTS=all pnpm --filter @wordado/web e2e
E2E_PROJECTS=webkit pnpm --filter @wordado/web e2e:accounts
```

WebKit's contexts cannot open OPFS files, so the WebKit projects run the IndexedDB
fallback. Playwright's WebKit cannot load a page while offline, so the offline tests skip there,
and Safari offline is checked by hand before a release (`docs/deploy.md`).
```

- [ ] **Step 10: Run the unit suite and typecheck, then commit**

Run: `pnpm --filter @wordado/web test && pnpm --filter @wordado/web typecheck && pnpm lint`
Expected: PASS.

```bash
git add web/e2e web/playwright.config.ts web/playwright.accounts.config.ts web/vitest.config.ts web/README.md
git commit -m "test(web): both end-to-end suites across the browser matrix; storage cleared between sessions; WebKit skips only offline navigation"
```

---

### Task 5: A learner's content from the CDN manifest

**Files:**
- Create: `web/src/content/env.d.ts`, `web/src/content/audioSwitch.ts`, `web/src/content/audioSwitch.test.ts`
- Modify: `web/src/content/packs.ts`, `web/src/content/packs.test.ts`, `web/src/app/boot.ts`, `web/src/app/boot.test.ts`, `web/src/main.tsx`, `web/README.md`

**Interfaces:**
- Consumes: `AudioStore`, `AudioPort` (`web/src/content/audio.ts`); `AccountRecord` (`web/src/account/storage.ts`).
- Produces:
  - `fetchManifest(manifestUrl, fetchFn?)` returns descriptors whose `url` is absolute.
  - `packFetcher(fetchFn?): PackFetcher` fetches `descriptor.url` as given.
  - `CONTENT_MANIFEST_URL: string`; `manifestUrlFor(account: AccountRecord | null, learnerManifest?: string): string`.
  - `class AudioSwitch implements AudioPort` with `use(manifestUrl)`, `refresh(corpus)`, `manifestUrl`.
  - `BootDeps.fetchManifest(account: AccountRecord | null)`, `prepare?(client, account)`, `onReady?(client, account)`.

- [ ] **Step 1: Write the failing pack tests**

Read `web/src/content/packs.test.ts` first. Every existing call `packFetcher(<manifestUrl>, fetchFn)` becomes `packFetcher(fetchFn)`, and its descriptor gets an absolute `url` (the value `fetchManifest` would now give it, e.g. `'http://localhost/content/sample/corpus-v0-bg.pack'`). Then add:

```ts
describe('learner content (plan 7)', () => {
  it('resolves every pack against its manifest once, so one fetcher serves any manifest', async () => {
    const manifest = { schema_version: 1, corpus_version: 3, packs: [{ pack_id: 'corpus-bg', l1: 'bg', corpus_version: 3, schema_version: 1, url: 'corpus-v3-bg.pack', sha256: 'a'.repeat(64), bytes: 10 }] }
    const fetchFn = async () => new Response(JSON.stringify(manifest), { status: 200 })
    const got = await fetchManifest('https://content.wordado.com/manifest.json', fetchFn)
    expect(got.packs[0]!.url).toBe('https://content.wordado.com/corpus-v3-bg.pack')
    const asked: string[] = []
    const fetcher = packFetcher(async (url) => {
      asked.push(url)
      return new Response(new Uint8Array([1, 2, 3]))
    })
    await fetcher(got.packs[0]!)
    expect(asked).toEqual(['https://content.wordado.com/corpus-v3-bg.pack'])
  })

  it('gives the demo the bundled sample and a learner the CDN’s manifest, or the sample when none is configured', () => {
    expect(manifestUrlFor(null, 'https://content.wordado.com/manifest.json')).toBe(SAMPLE_MANIFEST_URL)
    expect(manifestUrlFor({ userId: 'u1', email: 'a@b.c' }, 'https://content.wordado.com/manifest.json')).toBe('https://content.wordado.com/manifest.json')
    expect(manifestUrlFor({ userId: 'u1', email: 'a@b.c' }, SAMPLE_MANIFEST_URL)).toBe(SAMPLE_MANIFEST_URL)
  })
})
```

(import `manifestUrlFor` and `SAMPLE_MANIFEST_URL` beside the existing imports).

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/content/packs.test.ts`
Expected: FAIL. The URL is not resolved, `packFetcher` takes a manifest URL, and `manifestUrlFor` does not exist.

- [ ] **Step 3: Implement**

Create `web/src/content/env.d.ts`:

```ts
interface ImportMetaEnv {
  /** The CDN's manifest for signed-in learners (plan 7). Unset in development and the end-to-end runs. */
  readonly VITE_CONTENT_MANIFEST_URL?: string
}
```

In `web/src/content/packs.ts`:
- Change the `SAMPLE_MANIFEST_URL` comment to `/** The bundled sample (spec §8.6): the demo's content, and a learner's where no CDN manifest is configured. */`.
- Add below it:

```ts
/** A learner's manifest (spec §9.3): the CDN's when the build names one (plan 7), otherwise the bundled sample. */
export const CONTENT_MANIFEST_URL: string = import.meta.env.VITE_CONTENT_MANIFEST_URL || SAMPLE_MANIFEST_URL

/** The demo always studies the bundled sample (spec §8.6); a signed-in learner studies the CDN's packs. */
export function manifestUrlFor(account: AccountRecord | null, learnerManifest: string = CONTENT_MANIFEST_URL): string {
  return account === null ? SAMPLE_MANIFEST_URL : learnerManifest
}
```

  (with `import type { AccountRecord } from '../account/storage'`).
- In `fetchManifest`, replace `if (result.status === 'ok') return result.manifest` with:

```ts
  if (result.status === 'ok') {
    // Each pack's URL is relative to its manifest (plan 3 contract): resolved here, once, so the fetcher needs no manifest.
    const base = manifestBase(manifestUrl)
    return { ...result.manifest, packs: result.manifest.packs.map((pack) => ({ ...pack, url: new URL(pack.url, base).href })) }
  }
```

- Replace `packFetcher` with:

```ts
/** client-data's PackFetcher on the web: the pack's URL as `fetchManifest` resolved it. Throws on any failure. */
export function packFetcher(fetchFn: Fetch = (i, init) => fetch(i, init)): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(descriptor.url)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
}
```

- [ ] **Step 4: Run the pack tests**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/content/packs.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing `AudioSwitch` test**

Create `web/src/content/audioSwitch.test.ts`:

```ts
import type { AudioClip, Corpus } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import type { AudioStore } from './audio'
import { AudioSwitch } from './audioSwitch'

/** A store that says which manifest it serves in every answer. */
function store(manifestUrl: string, log: string[]): AudioStore {
  return {
    cachedClips: () => new Set([manifestUrl]),
    streamable: () => manifestUrl.startsWith('https:'),
    play: async (clip: AudioClip) => void log.push(`play ${clip.clipId} from ${manifestUrl}`),
    prefetch: async (clips: readonly AudioClip[]) => clips.length,
    refresh: async () => void log.push(`refresh ${manifestUrl}`),
  } as unknown as AudioStore
}

const clip = { clipId: 'hello-1-uk', url: 'audio/hello-1-uk.m4a', sha256: 'x', bytes: 1, mime: 'audio/mp4' }

describe('AudioSwitch: one AudioStore per manifest (plan 7)', () => {
  it('answers from the manifest in use, and keeps one store per manifest', async () => {
    const log: string[] = []
    const made: string[] = []
    const audio = new AudioSwitch((url) => {
      made.push(url)
      return store(url, log)
    }, '/content/sample/manifest.json')
    expect([...audio.cachedClips()]).toEqual(['/content/sample/manifest.json'])
    expect(audio.streamable()).toBe(false)

    audio.use('https://content.wordado.com/manifest.json')
    expect(audio.manifestUrl).toBe('https://content.wordado.com/manifest.json')
    expect(audio.streamable()).toBe(true)
    await audio.play(clip)
    await audio.refresh({} as Corpus)
    expect(await audio.prefetch([clip, clip])).toBe(2)

    audio.use('/content/sample/manifest.json')
    audio.use('https://content.wordado.com/manifest.json')
    expect(made).toEqual(['/content/sample/manifest.json', 'https://content.wordado.com/manifest.json'])
    expect(log).toEqual(['play hello-1-uk from https://content.wordado.com/manifest.json', 'refresh https://content.wordado.com/manifest.json'])
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/content/audioSwitch.test.ts`
Expected: FAIL. `./audioSwitch` does not exist.

- [ ] **Step 7: Implement `AudioSwitch`**

Create `web/src/content/audioSwitch.ts`:

```ts
import type { AudioClip, Corpus } from '@wordado/core'
import type { AudioPort, AudioStore } from './audio'

/**
 * The one AudioPort the screens hold, over one AudioStore per manifest: a
 * clip's URL is relative to the manifest that listed its pack (plan 3), and
 * the demo (the bundled sample) and a learner (the CDN) use different ones.
 * Every store writes to the same cache, keyed by absolute URL.
 */
export class AudioSwitch implements AudioPort {
  private readonly stores = new Map<string, AudioStore>()
  private current: AudioStore
  private currentUrl: string

  constructor(
    private readonly make: (manifestUrl: string) => AudioStore,
    manifestUrl: string,
  ) {
    this.currentUrl = manifestUrl
    this.current = this.storeFor(manifestUrl)
  }

  private storeFor(manifestUrl: string): AudioStore {
    let store = this.stores.get(manifestUrl)
    if (!store) {
      store = this.make(manifestUrl)
      this.stores.set(manifestUrl, store)
    }
    return store
  }

  /** The manifest whose clips are answered for now. */
  get manifestUrl(): string {
    return this.currentUrl
  }

  /** Called before the app shows a Client (Boot's `prepare`): the demo's or the learner's manifest. */
  use(manifestUrl: string): void {
    this.currentUrl = manifestUrl
    this.current = this.storeFor(manifestUrl)
  }

  cachedClips(): ReadonlySet<string> {
    return this.current.cachedClips()
  }

  streamable(): boolean {
    return this.current.streamable()
  }

  play(clip: AudioClip): Promise<void> {
    return this.current.play(clip)
  }

  prefetch(clips: readonly AudioClip[]): Promise<number> {
    return this.current.prefetch(clips)
  }

  refresh(corpus: Corpus): Promise<void> {
    return this.current.refresh(corpus)
  }
}
```

- [ ] **Step 8: Run it**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/content/audioSwitch.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing Boot test**

In `web/src/app/boot.test.ts`, add inside the `describe` that holds the learner-file tests (the one with `'finishes a carry-over the last session could not…'`):

```ts
  it('installs from the demo’s manifest for the demo and the learner’s for a learner, and says whose it prepares (plan 7)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const asked: (string | null)[] = []
    const prepared: (string | null)[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      fetchManifest: async (account) => {
        asked.push(account?.userId ?? null)
        return sampleManifest
      },
      prepare: async (_client, account) => void prepared.push(account?.userId ?? null),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo({ deleteFiles: [DEMO_FILE] })
    expect(asked).toEqual([null, 'u1'])
    expect(prepared).toEqual([null, 'u1'])
  })

  it('fails with the content reason, and recovers on retry, when a new learner’s manifest cannot be fetched', async () => {
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    let online = false
    const { boot: b } = boot({
      accounts,
      transport: () => new FakeServer({ now: () => Date.now() }),
      fetchManifest: async () => {
        if (!online) throw new TypeError('Failed to fetch')
        return sampleManifest
      },
    })
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'Failed to fetch', reason: 'content' })
    online = true
    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })
```

- [ ] **Step 10: Run it and watch it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/boot.test.ts`
Expected: the first new test FAILS with `asked` equal to `[null, null]`, because Boot calls `fetchManifest()` and `prepare(client)` without the account. The second may already pass: it pins the existing behaviour for a learner.

- [ ] **Step 11: Pass the account through Boot**

In `web/src/app/boot.ts`, change `BootDeps`:

```ts
  /** The manifest to install from: the demo's (the bundled sample) or a learner's (the CDN, plan 7). */
  fetchManifest(account: AccountRecord | null): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  /** Quick work before the app shows, such as reading the audio cache's index. Its failure never fails the boot. */
  prepare?(client: Client, account: AccountRecord | null): Promise<void>
  /** Background work once ready, such as prefetching audio. Its failure never fails the boot. */
  onReady?(client: Client, account: AccountRecord | null): Promise<void>
```

In `open()`, pass `this.account` at the three call sites: `await this.deps.fetchManifest(this.account)`, `this.deps.prepare?.(client, this.account)`, `this.deps.onReady?.(client, this.account)`.

- [ ] **Step 12: Wire it in `main.tsx`**

In `web/src/main.tsx`:
- Import `AudioSwitch` from `./content/audioSwitch`, and `manifestUrlFor` beside `fetchManifest`, `packFetcher` and `SAMPLE_MANIFEST_URL`.
- Replace `const audio = new AudioStore({ manifestUrl: SAMPLE_MANIFEST_URL, sha256: env.sha256 })` with:

```ts
/** One AudioStore per manifest (a clip's URL is relative to it): the demo's sample and a learner's CDN manifest (plan 7). */
const audio = new AudioSwitch((manifestUrl) => new AudioStore({ manifestUrl, sha256: env.sha256 }), SAMPLE_MANIFEST_URL)
```

- In the `Boot` deps, replace `fetchManifest`, `fetchPack`, `prepare` and `onReady` with:

```ts
    fetchManifest: (account) => fetchManifest(manifestUrlFor(account)),
    fetchPack: packFetcher(),
    // Before the app shows, so the first session already knows which clips can play (spec §9.3).
    prepare: async (client, account) => {
      audio.use(manifestUrlFor(account))
      if (client.snapshot.corpus) await audio.refresh(client.snapshot.corpus)
    },
    onReady: async (client) => {
      // The bundled sample's ~60 clips are fetched into the audio cache at once (decision of plan 6b), so the
      // demo listens offline from the first online visit; a CDN pack's clips come ahead of need (spec §9.3).
      if (audio.manifestUrl === SAMPLE_MANIFEST_URL && navigator.onLine && client.snapshot.corpus) {
        await audio.prefetch([...client.snapshot.corpus.clips.values()])
      }
    },
```

- In `startPackChecks({...})`, replace `fetchManifest` and `fetchPack` with:

```ts
  // Whoever is studying now: the demo's sample, or the learner's CDN manifest.
  fetchManifest: () => {
    const state = boot.store.get()
    return fetchManifest(manifestUrlFor(state.status === 'ready' ? state.account : null))
  },
  fetchPack: packFetcher(),
```

- [ ] **Step 13: Run the web suite, typecheck and lint**

Run: `pnpm --filter @wordado/web test && pnpm --filter @wordado/web typecheck && pnpm lint`
Expected: PASS. If `Root.test.tsx`, `controller.test.ts` or `content.test.ts` built a `BootDeps` or called `packFetcher(url, fetch)`, update them the same way: `packFetcher(fetch)`, with absolute descriptor URLs.

- [ ] **Step 14: Check the build carries the variable**

Run: `VITE_CONTENT_MANIFEST_URL=https://content.example.test/manifest.json pnpm --filter @wordado/web build && grep -rl "content.example.test/manifest.json" web/dist/assets | head -1`
Expected: one `web/dist/assets/index-*.js` path is printed. Then rebuild without the variable, `pnpm --filter @wordado/web build`, so no stray URL stays in `dist/`.

- [ ] **Step 15: Document it and commit**

Add to `web/README.md`:

```markdown
## Content

The demo always studies the bundled sample (`/content/sample/`). A signed-in learner installs
from `VITE_CONTENT_MANIFEST_URL`, the CDN's manifest, which the deploy sets at build time
(`docs/deploy.md`). It falls back to the sample when the variable is unset, as it is in
development and in both end-to-end suites.
```

```bash
git add web/src/content web/src/app/boot.ts web/src/app/boot.test.ts web/src/main.tsx web/README.md
git add -u web/src
git commit -m "feat(web): learners install from the CDN manifest, the demo from the bundled sample; one AudioStore per manifest"
```

---

### Task 6: `corpus publishable` — check a directory before it becomes the CDN

**Files:**
- Create: `pipeline/src/publishable.ts`, `pipeline/src/publishable.test.ts`
- Modify: `pipeline/src/cli.ts`

**Interfaces:**
- Consumes: `validateManifest`, `validatePack` (`@wordado/core`); `sha256Hex` (`pipeline/src/checksum.ts`).
- Produces: `publishProblems(read: (path: string) => Uint8Array | null): string[]` and the CLI command `pnpm --filter @wordado/pipeline corpus publishable <dir>` (exit 1 and one line per problem, or `ok`). Task 9's publish workflow runs it.

- [ ] **Step 1: Write the failing tests**

Create `pipeline/src/publishable.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { publishProblems } from './publishable'

const DIR = fileURLToPath(new URL('../samples/a1-bg/', import.meta.url))

/** Reads the sample, with some files replaced (bytes) or removed (null). */
function sample(over: Record<string, Uint8Array | null> = {}) {
  return (path: string): Uint8Array | null => {
    if (path in over) return over[path]!
    const full = join(DIR, path)
    return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
  }
}

const manifest = () => JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))

describe('publishProblems (spec §4.4: never a manifest whose files are not all in place)', () => {
  it('finds nothing wrong with the sample', () => {
    expect(publishProblems(sample())).toEqual([])
  })

  it('names a missing manifest', () => {
    expect(publishProblems(sample({ 'manifest.json': null }))).toEqual(['manifest.json: missing'])
  })

  it('names a pack whose bytes differ from the manifest’s checksum', () => {
    const pack = readFileSync(join(DIR, 'corpus-v0-bg.pack'))
    const tampered = new Uint8Array(pack)
    tampered[10] = tampered[10]! ^ 1
    expect(publishProblems(sample({ 'corpus-v0-bg.pack': tampered }))).toEqual(['corpus-v0-bg.pack: sha256 does not match the manifest'])
  })

  it('names a missing or truncated clip', () => {
    const clip = new Uint8Array(readFileSync(join(DIR, 'audio/hello-1-uk.m4a')))
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': null }))).toEqual(['audio/hello-1-uk.m4a: missing'])
    expect(publishProblems(sample({ 'audio/hello-1-uk.m4a': clip.slice(0, 100) }))).toEqual([
      `audio/hello-1-uk.m4a: ${100} bytes, the pack says ${clip.length}`,
    ])
  })

  it('refuses a URL that is not relative to the manifest', () => {
    const m = manifest()
    m.packs[0].url = 'https://elsewhere.example/corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))).toEqual([
      'packs[0].url: must be relative to the manifest, not https://elsewhere.example/corpus-v0-bg.pack',
    ])
    m.packs[0].url = '../corpus-v0-bg.pack'
    expect(publishProblems(sample({ 'manifest.json': bytes(m) }))[0]).toMatch(/^packs\[0\]\.url: must be relative/)
  })

  it('names an invalid manifest by its validator’s errors', () => {
    expect(publishProblems(sample({ 'manifest.json': bytes({ schema_version: 1 }) })).length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/publishable.test.ts`
Expected: FAIL. `./publishable` does not exist.

- [ ] **Step 3: Implement**

Create `pipeline/src/publishable.ts`:

```ts
import { validateManifest, validatePack } from '@wordado/core'
import { sha256Hex } from './checksum'

/** A URL the CDN can serve from the directory itself: relative, with no scheme, no leading slash and no `..`. */
const relative = (url: string) => !/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('/') && !url.split('/').includes('..')

/**
 * What would be wrong with serving a directory as the CDN's root (spec §4.4):
 * `manifest.json`, every pack it lists and every clip those packs list, each
 * present with its size and checksum. Empty means it can be published. `read`
 * returns a file's bytes by its path relative to the directory, or null.
 */
export function publishProblems(read: (path: string) => Uint8Array | null): string[] {
  const raw = read('manifest.json')
  if (raw === null) return ['manifest.json: missing']
  let json: unknown
  try {
    json = JSON.parse(new TextDecoder().decode(raw))
  } catch {
    return ['manifest.json: not JSON']
  }
  const manifest = validateManifest(json)
  if (manifest.status === 'unsupported_schema') return [`manifest.json: schema ${manifest.schemaVersion} is not supported by this build`]
  if (manifest.status === 'invalid') return manifest.errors.map((e) => `manifest.json ${e.path}: ${e.message}`)

  const problems: string[] = []
  const check = (path: string, where: string, expected: { readonly sha256: string; readonly bytes: number }, source: string): Uint8Array | null => {
    if (!relative(path)) {
      problems.push(`${where}: must be relative to the manifest, not ${path}`)
      return null
    }
    const bytes = read(path)
    if (bytes === null) problems.push(`${path}: missing`)
    else if (bytes.length !== expected.bytes) problems.push(`${path}: ${bytes.length} bytes, ${source} says ${expected.bytes}`)
    else if (sha256Hex(bytes) !== expected.sha256) problems.push(`${path}: sha256 does not match ${source}`)
    else return bytes
    return null
  }

  manifest.manifest.packs.forEach((descriptor, i) => {
    const bytes = check(descriptor.url, `packs[${i}].url`, descriptor, 'the manifest')
    if (bytes === null) return
    const pack = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
    if (pack.status !== 'ok') {
      problems.push(`${descriptor.url}: ${pack.status === 'invalid' ? pack.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : `schema ${pack.schemaVersion} is not supported`}`)
      return
    }
    pack.pack.audio.forEach((clip, j) => check(clip.url, `${descriptor.url} audio[${j}].url`, clip, 'the pack'))
  })
  return problems
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/publishable.test.ts`
Expected: PASS. If the truncated-clip test's message differs only in wording, fix the test to the implementation's wording above (`N bytes, the pack says M`).

- [ ] **Step 5: Add the CLI command**

In `pipeline/src/cli.ts`, import `existsSync` beside `readFileSync`, `join` from `node:path`, and `publishProblems` from `./publishable`. Change `usage()` to print `usage: corpus build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack> | publishable <dir>`. Add this case before `default:`:

```ts
  case 'publishable': {
    if (!first) usage()
    const problems = publishProblems((path) => {
      const full = join(first, path)
      return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
    })
    for (const problem of problems) console.error(problem)
    if (problems.length > 0) process.exit(1)
    console.log('ok')
    break
  }
```

- [ ] **Step 6: Run it on the sample, and on a broken copy**

Run: `pnpm --filter @wordado/pipeline corpus publishable "$PWD/pipeline/samples/a1-bg"`
Expected: `ok`.

Run:

```bash
T=$(mktemp -d) && cp -R pipeline/samples/a1-bg/. "$T" && rm "$T/audio/hello-1-uk.m4a" && pnpm --filter @wordado/pipeline corpus publishable "$T"; echo "exit $?"
```

Expected: `audio/hello-1-uk.m4a: missing`, then `exit 1`.

- [ ] **Step 7: Run the pipeline suite and commit**

Run: `pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/pipeline typecheck && pnpm lint`
Expected: PASS.

```bash
git add pipeline/src/publishable.ts pipeline/src/publishable.test.ts pipeline/src/cli.ts
git commit -m "feat(pipeline): corpus publishable — every file a manifest reaches is present with its checksum"
```

---

### Task 7: The Worker serves the app, in two deployed environments

**Files:**
- Modify: `server/wrangler.jsonc`, `server/src/config.ts`, `server/src/config.test.ts`, `server/vitest.config.ts`, `server/package.json`
- Create: `server/scripts/secretsFile.ts`, `server/scripts/secretsFile.test.ts`, `server/scripts/write-secrets.ts`
- Create: `web/public/_headers`, `web/vite/headers.test.ts`

**Interfaces:**
- Produces:
  - `WORKER_SECRETS`; `workerSecrets(env: Readonly<Record<string, string | undefined>>): Record<string, string>`, which throws `Error` listing every problem.
  - `server/scripts/write-secrets.ts <out-file>`.
  - Script `pnpm --filter @wordado/server deploy:check`, which dry-runs both environments and needs `web/dist`.
  - Environments `preview` and `production`. `configFromEnv` throws on an empty `BASE_URL`.

- [ ] **Step 1: Write the failing config test**

In `server/src/config.test.ts`, add inside `describe('configFromEnv', …)`:

```ts
  it('refuses an empty BASE_URL: a deploy that forgot --var BASE_URL must fail, not run with undefined', () => {
    expect(() => configFromEnv(env({ BASE_URL: '' }))).toThrow('BASE_URL must be set')
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @wordado/server exec vitest run src/config.test.ts`
Expected: FAIL (no throw).

- [ ] **Step 3: Refuse it**

In `configFromEnv` (`server/src/config.ts`), add as the first line: `if (!env.BASE_URL) throw new Error('BASE_URL must be set')`. Also change the `Env` doc comment's "from the deploy in plan 7" to "from the deploy's `--secrets-file` (docs/deploy.md)".

- [ ] **Step 4: Write the failing secrets tests**

In `server/vitest.config.ts`, change `include` to `['src/**/*.test.ts', 'scripts/**/*.test.ts']`.

Create `server/scripts/secretsFile.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { WORKER_SECRETS, workerSecrets } from './secretsFile'

const secret = 's'.repeat(48)

describe('workerSecrets: what a deploy uploads (spec §4.4: secrets from the GitHub environment)', () => {
  it('names every secret the Worker reads', () => {
    expect(WORKER_SECRETS).toEqual([
      'BETTER_AUTH_SECRET',
      'RESEND_API_KEY',
      'EMAIL_FROM',
      'GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_SECRET',
      'VAPID_PUBLIC_KEY',
      'VAPID_PRIVATE_KEY',
      'VAPID_SUBJECT',
    ])
  })

  it('keeps only the secrets that are set, and nothing else from the environment', () => {
    expect(workerSecrets({ BETTER_AUTH_SECRET: secret, VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', GOOGLE_CLIENT_ID: '', PATH: '/usr/bin' })).toEqual({
      BETTER_AUTH_SECRET: secret,
      VAPID_PUBLIC_KEY: 'pub',
      VAPID_PRIVATE_KEY: 'priv',
    })
  })

  it('refuses a missing or short BETTER_AUTH_SECRET', () => {
    expect(() => workerSecrets({})).toThrow('BETTER_AUTH_SECRET must be at least 32 characters')
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: 'short' })).toThrow('BETTER_AUTH_SECRET must be at least 32 characters')
  })

  it('refuses half of a pair, naming every problem at once', () => {
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, GOOGLE_CLIENT_ID: 'id', VAPID_PRIVATE_KEY: 'priv' })).toThrow(
      'GOOGLE_CLIENT_ID is set without GOOGLE_CLIENT_SECRET; VAPID_PRIVATE_KEY is set without VAPID_PUBLIC_KEY',
    )
    expect(() => workerSecrets({ BETTER_AUTH_SECRET: secret, RESEND_API_KEY: 're_x' })).toThrow('RESEND_API_KEY is set without EMAIL_FROM')
  })
})
```

- [ ] **Step 5: Run them and watch them fail**

Run: `pnpm --filter @wordado/server exec vitest run scripts/secretsFile.test.ts`
Expected: FAIL. `./secretsFile` does not exist.

- [ ] **Step 6: Implement**

Create `server/scripts/secretsFile.ts`:

```ts
/** The Worker's secrets (server/src/config.ts `Env`). Everything else it reads is a plain variable. */
export const WORKER_SECRETS = [
  'BETTER_AUTH_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
] as const

/** Secrets that mean nothing alone: the Worker would quietly run without the feature. */
const PAIRS: readonly (readonly [string, string])[] = [
  ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
  ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY'],
  ['RESEND_API_KEY', 'EMAIL_FROM'],
]

/**
 * The secrets a deploy uploads with `wrangler deploy --secrets-file`, from
 * the GitHub environment (spec §4.4). An unset or empty one is left out, and
 * a deploy never deletes one it leaves out (Wrangler's rule). Throws, naming
 * every problem, when the Worker would refuse to start or would silently run
 * without a feature.
 */
export function workerSecrets(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of WORKER_SECRETS) {
    const value = env[name]
    if (value !== undefined && value !== '') out[name] = value
  }
  const problems: string[] = []
  if ((out['BETTER_AUTH_SECRET'] ?? '').length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters')
  for (const [a, b] of PAIRS) {
    if (a in out && !(b in out)) problems.push(`${a} is set without ${b}`)
    if (b in out && !(a in out)) problems.push(`${b} is set without ${a}`)
  }
  if (problems.length > 0) throw new Error(problems.join('; '))
  return out
}
```

Create `server/scripts/write-secrets.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { workerSecrets } from './secretsFile'

/** Writes the secrets file a deploy uploads (docs/deploy.md). Prints names only, never values. */
const out = process.argv[2]
if (!out) {
  console.error('usage: tsx scripts/write-secrets.ts <out-file>')
  process.exit(2)
}
const secrets = workerSecrets(process.env)
writeFileSync(out, JSON.stringify(secrets), { mode: 0o600 })
console.log(`Worker secrets: ${Object.keys(secrets).join(', ')}`)
```

- [ ] **Step 7: Run the server suite**

Run: `pnpm --filter @wordado/server test`
Expected: PASS.

- [ ] **Step 8: Split `wrangler.jsonc` into local, preview and production**

Replace `server/wrangler.jsonc` with:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  // The top level is local development only (`pnpm dev`, `smoke`, the e2e runs). Its own name means a
  // `wrangler deploy` without --env can never overwrite a deployed Worker (docs/deploy.md).
  "name": "wordado-local",
  "main": "src/worker.ts",
  "compatibility_date": "2026-09-01",
  // pg needs Node's net, tls and crypto shims: Cloudflare's supported path for Hyperdrive.
  "compatibility_flags": ["nodejs_compat"],
  "vars": {
    "BASE_URL": "http://localhost:8787",
    "MIN_PROTOCOL_VERSION": "1",
    // :5173 is the Vite dev server, :4173 the preview build the end-to-end runs use.
    "TRUSTED_ORIGINS": "http://localhost:5173,http://localhost:4173"
  },
  // Locally, the CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE environment variable points
  // this at the database; the dev and smoke scripts set it to the Docker one by default (spec §4.4).
  "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "00000000000000000000000000000000" }],
  "queues": {
    "producers": [{ "binding": "JOBS", "queue": "wordado-jobs" }],
    // One message per invocation: each is a whole learner's log re-derived, which must fit one consumer's CPU budget.
    "consumers": [{ "queue": "wordado-jobs", "max_batch_size": 1, "max_batch_timeout": 5, "max_retries": 5 }]
  },
  "triggers": { "crons": ["*/15 * * * *"] },
  "observability": { "enabled": true },

  // Deployed environments (plan 7). One Worker serves the API and the web app's build, so a deploy
  // replaces both at once and they share one origin (plan 5: no CORS). BASE_URL and TRUSTED_ORIGINS
  // come from the GitHub environment's APP_ORIGIN through --var (.github/workflows/deploy.yml).
  // The Hyperdrive ids are the operator's (docs/deploy.md, step 3); the deploy refuses the zero id.
  "env": {
    "preview": {
      "name": "wordado-preview",
      "workers_dev": true,
      "assets": {
        "directory": "../web/dist",
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*", "/v1/*", "/health"]
      },
      "vars": { "MIN_PROTOCOL_VERSION": "1" },
      "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "00000000000000000000000000000000" }],
      "queues": {
        "producers": [{ "binding": "JOBS", "queue": "wordado-jobs-preview" }],
        "consumers": [{ "queue": "wordado-jobs-preview", "max_batch_size": 1, "max_batch_timeout": 5, "max_retries": 5 }]
      },
      "triggers": { "crons": ["*/15 * * * *"] }
    },
    "production": {
      "name": "wordado",
      "workers_dev": false,
      "routes": [{ "pattern": "wordado.com", "custom_domain": true }],
      "assets": {
        "directory": "../web/dist",
        "not_found_handling": "single-page-application",
        "run_worker_first": ["/api/*", "/v1/*", "/health"]
      },
      "vars": { "MIN_PROTOCOL_VERSION": "1" },
      "hyperdrive": [{ "binding": "HYPERDRIVE", "id": "00000000000000000000000000000000" }],
      "queues": {
        "producers": [{ "binding": "JOBS", "queue": "wordado-jobs" }],
        "consumers": [{ "queue": "wordado-jobs", "max_batch_size": 1, "max_batch_timeout": 5, "max_retries": 5 }]
      },
      "triggers": { "crons": ["*/15 * * * *"] }
    }
  }
}
```

In `server/package.json` `scripts`, add:

```json
    "deploy:check": "wrangler deploy --dry-run --env preview --outdir dist/preview --var BASE_URL:https://preview.invalid && wrangler deploy --dry-run --env production --outdir dist/production --var BASE_URL:https://wordado.com",
```

- [ ] **Step 9: Cache headers for the static assets, with a guard test**

Create `web/public/_headers` (Workers static assets read it from the build's root and do not serve it):

```
/sw.js
  Cache-Control: no-cache
/manifest.webmanifest
  Cache-Control: no-cache
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```

Create `web/vite/headers.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const headers = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8')

/** The rule block for `path`: its header lines, trimmed. */
const rules = (path: string) => {
  const lines = headers.split('\n')
  const start = lines.indexOf(path)
  expect(start).toBeGreaterThanOrEqual(0)
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith(' ')) break
    out.push(line.trim())
  }
  return out
}

describe('static asset caching (plan 6a: the service worker and the manifest are never cached)', () => {
  it('revalidates the service worker and the web manifest on every load', () => {
    expect(rules('/sw.js')).toEqual(['Cache-Control: no-cache'])
    expect(rules('/manifest.webmanifest')).toEqual(['Cache-Control: no-cache'])
  })

  it('keeps hashed build files for a year', () => {
    expect(rules('/assets/*')).toEqual(['Cache-Control: public, max-age=31536000, immutable'])
  })
})
```

- [ ] **Step 10: Run the guard, the dry run and local development**

Run: `pnpm --filter @wordado/web exec vitest run --project unit vite/headers.test.ts`
Expected: PASS.

Run: `pnpm --filter @wordado/web build && pnpm --filter @wordado/server deploy:check`
Expected: each environment prints `Read NN files from the assets directory …/web/dist`, its bindings (`env.HYPERDRIVE (00000000000000000000000000000000)`, `env.JOBS (wordado-jobs-preview)` or `(wordado-jobs)`), and `--dry-run: exiting now.`

Run: `pnpm --filter @wordado/server smoke`
Expected: `smoke: ok`. The local top level still works without a web build.

- [ ] **Step 11: Typecheck, lint, commit**

Run: `pnpm typecheck && pnpm lint`
Expected: PASS.

```bash
git add server/wrangler.jsonc server/src/config.ts server/src/config.test.ts server/vitest.config.ts server/package.json server/scripts/secretsFile.ts server/scripts/secretsFile.test.ts server/scripts/write-secrets.ts web/public/_headers web/vite/headers.test.ts
git commit -m "feat(server): preview and production environments, the web build served by the Worker, secrets from the deploy's environment"
```

---

### Task 8: A smoke run against a deployment, with a full page

**Files:**
- Create: `server/scripts/smokeRun.ts`, `server/scripts/smoke-remote.ts`
- Modify: `server/scripts/smoke.ts`, `server/package.json`

**Interfaces:**
- Consumes: `SCHEDULER_VERSION`, `SYNC_PROTOCOL_VERSION`, `SYNC_PAGE_SIZE` (`@wordado/core`).
- Produces:
  - `runSmoke(options: SmokeOptions): Promise<void>` with `interface SmokeOptions { readonly base: string; readCode(email: string): Promise<string>; readonly runCron: boolean }`.
  - `codeIn(output: () => string, email: string, timeoutMs?: number): Promise<string>`.
  - `until<T>(what, probe, timeoutMs?)`.
  - Script `pnpm --filter @wordado/server smoke:remote <origin> <env>` (Task 9 runs it against the preview).

- [ ] **Step 1: Move the steps into `smokeRun.ts`**

Create `server/scripts/smokeRun.ts` from the body of today's `smoke.ts`: everything from `async function until` down to the end of the `try` block's steps. It becomes:

```ts
import { SCHEDULER_VERSION, SYNC_PAGE_SIZE, SYNC_PROTOCOL_VERSION } from '@wordado/core'

export interface SmokeOptions {
  /** Where the Worker answers: `http://localhost:8788` locally, the preview's origin remotely. */
  readonly base: string
  /** The newest sign-in code the Worker printed for `email` (plan 5's console mailer). */
  readCode(email: string): Promise<string>
  /** Only `wrangler dev --test-scheduled` has /__scheduled; a deployment's cron runs on its own. */
  readonly runCron: boolean
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function until<T>(what: string, probe: () => Promise<T | null>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe().catch(() => null)
    if (value !== null) return value
    await sleep(500)
  }
  throw new Error(`Timed out waiting for ${what}`)
}

/** The code printed for `email` in `output()`, waiting for it to appear. */
export function codeIn(output: () => string, email: string, timeoutMs = 15_000): Promise<string> {
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return until('the sign-in code in the Worker log', async () => new RegExp(`Sign-in code for ${escaped}: (\\d{6})`).exec(output())?.[1] ?? null, timeoutMs)
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/**
 * One learner's life against a running Worker: sign in by code, push, alias a
 * word so the queue re-derives, pull, push a full page (the heaviest request a
 * learner makes: spec §4.4 has it exercised on the preview before merge), run
 * the cron where possible, delete the account. Throws on the first failure.
 */
export async function runSmoke(options: SmokeOptions): Promise<void> {
  const { base } = options
  const email = `smoke-${Date.now()}@example.com`
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { origin: base, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const setCookie = response.headers.getSetCookie()
    if (setCookie.length > 0) cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
    const text = await response.text()
    try {
      return { status: response.status, body: JSON.parse(text) }
    } catch {
      return { status: response.status, body: text }
    }
  }
  const now = Date.now()
  const event = (seq: number, wordId: string, clientTs: number) => ({
    reviewId: `smoke-${now}-${seq}`,
    wordId,
    mode: 'multiple_choice',
    direction: 'en_to_l1',
    grade: 3,
    latencyMs: 1500,
    practice: false,
    clientTs,
    clientTzOffsetMin: 0,
    deviceId: 'smoke-device',
    deviceSeq: seq,
    schedulerVersion: SCHEDULER_VERSION,
  })
  const page = (pushId: string, events: unknown[], documents: unknown[] = []) => ({
    protocolVersion: SYNC_PROTOCOL_VERSION,
    pushId,
    clientNow: Date.now(),
    deviceId: 'smoke-device',
    page: 0,
    lastPage: true,
    events,
    dayComplete: [],
    documents,
  })
  const pull = () => call('POST', '/v1/sync/pull', { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'smoke-device', documentsSince: 0 })

  await until('the Worker to answer /health', async () => ((await fetch(`${base}/health`)).ok ? true : null))
  let reply = await call('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
  check(reply.status === 200, `send code: ${reply.status} ${JSON.stringify(reply.body)}`)
  reply = await call('POST', '/api/auth/sign-in/email-otp', { email, otp: await options.readCode(email) })
  check(reply.status === 200 && cookie !== '', `sign in: ${reply.status}`)

  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-1`, [event(1, 'c:hello-1', now - 120_000), event(2, 'u:smoke-mine', now - 60_000)]))
  check(reply.body?.status === 'ok', `push: ${JSON.stringify(reply.body)}`)
  // An alias marks the learner stale and queues a re-derivation (spec §6.1, §4.4).
  const alias = { type: 'word_alias', key: 'u:smoke-mine', patch: { baseVersion: 0, fields: { target: 'c:hello-1' } } }
  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-2`, [], [alias]))
  check(reply.body?.status === 'ok' && reply.body.rejected.length === 0, `alias: ${JSON.stringify(reply.body)}`)
  await until(
    'the queue to merge the aliased word',
    async () => {
      const states = (await pull()).body?.reviewStates ?? []
      return states.length === 1 && states[0].wordId === 'c:hello-1' && states[0].reps === 2 ? true : null
    },
    30_000,
  )

  // A full page over 100 words, answered after everything above, then a pull of them all.
  const start = Date.now() - 50_000
  const full = Array.from({ length: SYNC_PAGE_SIZE }, (_, i) => event(1_000 + i, `c:smoke-${i % 100}`, start + i * 100))
  let timer = Date.now()
  reply = await call('POST', '/v1/sync/push', page(`smoke-${now}-full`, full))
  check(reply.status === 200 && reply.body?.status === 'ok', `full page: ${reply.status} ${JSON.stringify(reply.body).slice(0, 300)}`)
  console.log(`smoke: a ${SYNC_PAGE_SIZE}-event page took ${Date.now() - timer} ms`)
  timer = Date.now()
  reply = await pull()
  check(reply.status === 200 && (reply.body?.reviewStates ?? []).length === 101, `pull after the full page: ${reply.status} ${(reply.body?.reviewStates ?? []).length} states`)
  console.log(`smoke: a pull of 101 words took ${Date.now() - timer} ms`)

  if (options.runCron) {
    reply = await call('GET', `/__scheduled?cron=${encodeURIComponent('*/15 * * * *')}`)
    check(reply.status === 200, `cron: ${reply.status} ${JSON.stringify(reply.body)}`)
  }

  reply = await call('DELETE', '/v1/account', { confirm: true })
  check(reply.body?.deleted === true, `delete: ${JSON.stringify(reply.body)}`)
  reply = await call('GET', '/v1/me')
  check(reply.status === 401, `after deletion /v1/me answered ${reply.status}`)
}
```

- [ ] **Step 2: Make `smoke.ts` the local runner over it**

Rewrite `server/scripts/smoke.ts`. Keep its header comment (reworded to "Drives the real Worker under `wrangler dev`… through `runSmoke`"), `PORT`, `BASE`, the `.dev.vars` copy, the `wrangler dev` spawn with its environment, `output`, `exited`, `signalGroup`, `stop` and the signal handlers exactly as they are. Delete everything that moved to `smokeRun.ts` (`until`, `call`, `check`, `event`, `page`, the steps). End the file with:

```ts
try {
  await runSmoke({ base: BASE, readCode: (email) => codeIn(() => output.join(''), email), runCron: true })
  console.log('smoke: ok')
} catch (error) {
  console.error(output.join('').split('\n').slice(-80).join('\n'))
  console.error('smoke: failed —', error)
  process.exitCode = 1
} finally {
  await stop()
}
```

with `import { codeIn, runSmoke } from './smokeRun'`. Drop the now-unused `sleep` and the `@wordado/core` import, unless something left still uses them.

- [ ] **Step 3: Run the local smoke**

Run: `pnpm --filter @wordado/server smoke`
Expected: two timing lines (`smoke: a 500-event page took … ms`, `smoke: a pull of 101 words took … ms`), then `smoke: ok`.

If the pull count is not 101, print the word ids the pull returned. The full page's 100 words plus `c:hello-1` should be exactly 101. Fix the step, not the count, if a word id is mistyped.

- [ ] **Step 4: Add the remote runner**

Create `server/scripts/smoke-remote.ts`:

```ts
import { spawn } from 'node:child_process'
import { codeIn, runSmoke, until } from './smokeRun'

/**
 * `runSmoke` against a deployment (spec §4.4: CPU-sensitive paths run on the
 * preview before merge). Sign-in codes are read from the Worker's own log
 * through `wrangler tail`: the preview has no mailer, so plan 5's console
 * mailer prints them there. Needs CLOUDFLARE_API_TOKEN and
 * CLOUDFLARE_ACCOUNT_ID. Usage, from server/: tsx scripts/smoke-remote.ts <origin> <env>
 */
const [origin, env] = process.argv.slice(2)
if (!origin || !env) {
  console.error('usage: tsx scripts/smoke-remote.ts <origin> <preview|production>')
  process.exit(2)
}

const output: string[] = []
const tail = spawn('pnpm', ['exec', 'wrangler', 'tail', '--env', env, '--format', 'pretty'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: true,
  env: { ...process.env, FORCE_COLOR: '0' },
})
tail.stdout.on('data', (chunk) => output.push(String(chunk)))
tail.stderr.on('data', (chunk) => output.push(String(chunk)))

const stop = () => {
  try {
    if (tail.pid !== undefined) process.kill(-tail.pid, 'SIGTERM')
  } catch {
    // Already gone.
  }
}

try {
  await until('wrangler tail to connect', async () => (/Connected to/i.test(output.join('')) ? true : null), 60_000)
  await runSmoke({ base: origin.replace(/\/$/, ''), readCode: (email) => codeIn(() => output.join(''), email, 30_000), runCron: false })
  console.log('smoke: ok')
} catch (error) {
  console.error(output.join('').split('\n').slice(-60).join('\n'))
  console.error('smoke: failed —', error)
  process.exitCode = 1
} finally {
  stop()
}
```

In `server/package.json` `scripts`, add `"smoke:remote": "tsx scripts/smoke-remote.ts"`.

- [ ] **Step 5: Typecheck, lint, commit**

Run: `pnpm --filter @wordado/server typecheck && pnpm lint && pnpm --filter @wordado/server smoke`
Expected: PASS, `smoke: ok`. The remote runner is first exercised by Task 12's preview deploy.

```bash
git add server/scripts/smokeRun.ts server/scripts/smoke.ts server/scripts/smoke-remote.ts server/package.json
git commit -m "test(server): the smoke run pushes a full page and pulls it; it runs against a deployment too, reading codes through wrangler tail"
```

---

### Task 9: GitHub Actions

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/publish-content.yml`

**Interfaces:**
- Consumes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm --filter @wordado/server smoke`, `deploy:check`, `smoke:remote`, `migrate`, `scripts/write-secrets.ts`; `pnpm --filter @wordado/web e2e` and `e2e:accounts` with `E2E_PROJECTS`; `pnpm --filter @wordado/pipeline corpus publishable`.
- Produces: the GitHub environments' contract, which Task 10 documents and Task 12 fills:
  - repository variables `CLOUDFLARE_ACCOUNT_ID` and `DEPLOY_ENABLED`;
  - per-environment variables `APP_ORIGIN`, `CONTENT_MANIFEST_URL` and (production) `CONTENT_BUCKET`;
  - per-environment secrets `CLOUDFLARE_API_TOKEN`, `DATABASE_URL` and `WORKER_SECRETS`' names; production also has `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

- [ ] **Step 1: Write `ci.yml`**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

# Spec §4.4: every pull request is checked, and nothing merges red; a merge to main deploys.
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  # A newer push to a pull request replaces its run; runs on main (which deploy) always finish.
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

env:
  CI: 'true'
  WRANGLER_SEND_METRICS: 'false'

jobs:
  static:
    name: Typecheck, lint, workflows, deploy config
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - name: Lint the workflows
        run: docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color
      - name: Build the web app
        run: pnpm --filter @wordado/web build
      - name: Dry-run both deployments
        run: pnpm --filter @wordado/server deploy:check

  test:
    name: Suites and the Worker smoke run
    runs-on: ubuntu-24.04
    timeout-minutes: 25
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Chromium, for the web suite's storage tests
        run: pnpm --filter @wordado/web exec playwright install --with-deps chromium
      # The server's scripts start plan 5's Postgres 18 container with Docker Compose, as they do locally.
      - run: pnpm test
      - run: pnpm --filter @wordado/server smoke

  e2e:
    name: End to end (${{ matrix.project }})
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    strategy:
      fail-fast: false
      matrix:
        # Spec §13's matrix. Pull requests run the three engines; main adds both mobile projects (Actions minutes, §17.2).
        project: ${{ fromJSON(github.event_name == 'pull_request' && '["chromium","firefox","webkit"]' || '["chromium","firefox","webkit","mobile-chrome","mobile-safari"]') }}
    env:
      E2E_PROJECTS: ${{ matrix.project }}
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Install the project's browser
        run: |
          case "$E2E_PROJECTS" in
            chromium|mobile-chrome) browser=chromium ;;
            firefox) browser=firefox ;;
            webkit|mobile-safari) browser=webkit ;;
            *) echo "::error::no browser for $E2E_PROJECTS"; exit 1 ;;
          esac
          pnpm --filter @wordado/web exec playwright install --with-deps "$browser"
      - name: The demo
        run: pnpm --filter @wordado/web e2e
      - name: Accounts, against the Worker and Postgres
        run: pnpm --filter @wordado/web e2e:accounts
      - name: Keep the traces of a failure
        if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-${{ matrix.project }}
          path: web/test-results/
          retention-days: 7

  deploy-preview:
    name: Preview deployment
    needs: [static, test, e2e]
    # Only once the operator has provisioned Cloudflare and Neon (docs/deploy.md), and never for a fork.
    if: github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && vars.DEPLOY_ENABLED == 'true'
    uses: ./.github/workflows/deploy.yml
    with:
      environment: preview
      smoke: true
    secrets: inherit

  deploy-production:
    name: Production deployment
    needs: [static, test, e2e]
    if: github.event_name == 'push' && github.ref == 'refs/heads/main' && vars.DEPLOY_ENABLED == 'true'
    uses: ./.github/workflows/deploy.yml
    with:
      environment: production
      smoke: false
    secrets: inherit
```

- [ ] **Step 2: Write `deploy.yml`**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

# Called by CI once every check is green (spec §4.4): migrations first (forward-only), then the Worker
# with the web app's build, through the Wrangler action. Secrets come from the GitHub environment.
on:
  workflow_call:
    inputs:
      environment:
        description: preview or production (the Wrangler environment and the GitHub one)
        type: string
        required: true
      smoke:
        description: Drive one learner's life against the deployment (preview only; production mails real codes)
        type: boolean
        default: false

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy (${{ inputs.environment }})
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    environment:
      name: ${{ inputs.environment }}
      url: ${{ vars.APP_ORIGIN }}
    concurrency:
      group: deploy-${{ inputs.environment }}
      cancel-in-progress: false
    env:
      DEPLOY_ENV: ${{ inputs.environment }}
      APP_ORIGIN: ${{ vars.APP_ORIGIN }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      WRANGLER_SEND_METRICS: 'false'
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Build the web app, with the learners' manifest
        run: pnpm --filter @wordado/web build
        env:
          VITE_CONTENT_MANIFEST_URL: ${{ vars.CONTENT_MANIFEST_URL }}
      - name: Refuse a Hyperdrive that was never created
        working-directory: server
        run: |
          if pnpm exec wrangler deploy --dry-run --env "$DEPLOY_ENV" --outdir "$RUNNER_TEMP/dry-run" --var "BASE_URL:$APP_ORIGIN" | grep -q '(00000000000000000000000000000000)'; then
            echo "::error::server/wrangler.jsonc still has the zero Hyperdrive id for $DEPLOY_ENV (docs/deploy.md, step 3)"
            exit 1
          fi
      - name: Migrate the database (forward-only, before the Worker)
        run: pnpm --filter @wordado/server migrate
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - name: Gather the Worker's secrets
        run: pnpm --filter @wordado/server exec tsx scripts/write-secrets.ts "$RUNNER_TEMP/worker-secrets.json"
        env:
          BETTER_AUTH_SECRET: ${{ secrets.BETTER_AUTH_SECRET }}
          RESEND_API_KEY: ${{ secrets.RESEND_API_KEY }}
          EMAIL_FROM: ${{ secrets.EMAIL_FROM }}
          GOOGLE_CLIENT_ID: ${{ secrets.GOOGLE_CLIENT_ID }}
          GOOGLE_CLIENT_SECRET: ${{ secrets.GOOGLE_CLIENT_SECRET }}
          VAPID_PUBLIC_KEY: ${{ secrets.VAPID_PUBLIC_KEY }}
          VAPID_PRIVATE_KEY: ${{ secrets.VAPID_PRIVATE_KEY }}
          VAPID_SUBJECT: ${{ secrets.VAPID_SUBJECT }}
      - name: Deploy the Worker and the web app
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: server
          packageManager: pnpm
          command: deploy --env ${{ inputs.environment }} --secrets-file ${{ runner.temp }}/worker-secrets.json --var BASE_URL:${{ vars.APP_ORIGIN }} --var TRUSTED_ORIGINS:${{ vars.APP_ORIGIN }}
      - name: Forget the secrets file
        if: always()
        run: rm -f "$RUNNER_TEMP/worker-secrets.json"
      - name: The deployment answers
        run: curl --fail --silent --show-error --retry 10 --retry-delay 3 --retry-all-errors "$APP_ORIGIN/health"
      - name: One learner's life against the deployment
        if: inputs.smoke
        run: pnpm --filter @wordado/server smoke:remote "$APP_ORIGIN" "$DEPLOY_ENV"
```

- [ ] **Step 3: Write `publish-content.yml`**

Create `.github/workflows/publish-content.yml`:

```yaml
name: Publish content

# Spec §4.4: packs and audio go up first, and the manifest only once every file it names is in place,
# so a client never sees a version whose files are missing. Plan 8 builds the corpus into a directory
# of this shape; until then the source is the A1 sample.
on:
  workflow_dispatch:
    inputs:
      source:
        description: A directory holding manifest.json, the packs it lists and their audio/
        required: true
        default: pipeline/samples/a1-bg

permissions:
  contents: read

concurrency:
  group: publish-content
  cancel-in-progress: false

jobs:
  publish:
    name: Publish ${{ inputs.source }}
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: production
    env:
      SOURCE: ${{ inputs.source }}
      BUCKET: s3://${{ vars.CONTENT_BUCKET }}
      R2: https://${{ vars.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      MANIFEST_URL: ${{ vars.CONTENT_MANIFEST_URL }}
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
      AWS_DEFAULT_REGION: auto
      # R2 does not take the AWS CLI's default integrity headers.
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Every file the manifest reaches is present, with its checksum
        run: pnpm --filter @wordado/pipeline corpus publishable "$GITHUB_WORKSPACE/$SOURCE"
      - name: Upload the packs and the audio (not the manifest)
        run: |
          aws s3 sync "$SOURCE" "$BUCKET" --endpoint-url "$R2" --exclude '*' --include '*.pack' \
            --content-type application/json --cache-control 'public, max-age=31536000, immutable'
          aws s3 sync "$SOURCE/audio" "$BUCKET/audio" --endpoint-url "$R2" \
            --content-type audio/mp4 --cache-control 'public, max-age=86400'
      - name: Publish the manifest, last
        run: |
          aws s3 cp "$SOURCE/manifest.json" "$BUCKET/manifest.json" --endpoint-url "$R2" \
            --content-type application/json --cache-control no-cache
      - name: The CDN serves the new manifest
        run: |
          expected=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).corpus_version)" "$SOURCE/manifest.json")
          served=$(curl --fail --silent --show-error -H 'cache-control: no-cache' "$MANIFEST_URL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).corpus_version))")
          echo "corpus version: published $expected, served $served"
          test "$expected" = "$served"
```

- [ ] **Step 4: Lint the workflows locally**

Run: `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color`
Expected: no output, exit 0. Fix anything it reports: actionlint runs shellcheck on every `run:` block. Every value that comes from an input or matrix already reaches the shell through `env:`, never as `${{ }}` inside a script.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows
git commit -m "ci: checks, suites and the e2e matrix on every pull request; preview and production deploys; the content publish"
```

---

### Task 10: The runbook, the roadmap and the READMEs

**Files:**
- Create: `docs/deploy.md`
- Modify: `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, `server/README.md`

- [ ] **Step 1: Write `docs/deploy.md`**

Create `docs/deploy.md` with these sections, in this order, using the exact commands given. The account-specific values (the Cloudflare account id, the workers.dev subdomain, Neon's connection strings) are written as `<cloudflare-account-id>`, `<subdomain>` and `<neon …>`, because each operator reads their own.

```markdown
# Deploying Wordado

The web app and the API are one Cloudflare Worker (`server/wrangler.jsonc`): `wordado` on
`https://wordado.com` (production) and `wordado-preview` on `https://wordado-preview.<subdomain>.workers.dev`
(preview). Every push to `main` deploys production once CI is green. Every pull request from this
repository deploys the preview and runs one learner's life against it (`smoke:remote`). Content (packs
and audio) lives in the R2 bucket `wordado-content`, served at `https://content.wordado.com`, and is
published by the manual **Publish content** workflow.

Nothing deploys until the repository variable `DEPLOY_ENABLED` is `true` (step 9).

## Provisioning, once

1. **Cloudflare.** `pnpm --filter @wordado/server exec wrangler login`, then `… wrangler whoami` for
   the account id. Create an API token from the "Edit Cloudflare Workers" template. Add
   *Account › Hyperdrive › Edit* and *Account › Queues › Edit*, and limit its zone to `wordado.com`.
   The workers.dev subdomain is on the dashboard's Workers overview.
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
7. **The transport rate limit** (spec §10). Dashboard › wordado.com › Security › WAF › Rate limiting
   rules: *URI Path starts with `/v1/sync/`*, 60 requests per 10 seconds per IP, block for 10 seconds.
   A week offline is a few 500-event pages and a pull, far below it. Sign-in has its own limits (plan 5).
8. **Content first.** Run **Publish content** (Actions › Publish content › Run workflow, source
   `pipeline/samples/a1-bg`). Then the first production build finds a manifest at `CONTENT_MANIFEST_URL`.
9. **Enable deploys.** `gh variable set DEPLOY_ENABLED --body true`. The next pull request deploys the
   preview, and the next merge deploys production.

## Everyday

- **Deploy:** merge a green pull request. CI migrates `DATABASE_URL`, then deploys the Worker with the web build.
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
```

- [ ] **Step 2: Update the roadmap**

In `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, change plan 7's cell to `**CI and deploy** — \`2026-09-25-ci-and-deploy.md\``. Append to its "Delivers" cell: `; oxlint; one Worker serving the app and the API; preview deployments with a remote smoke run; \`corpus publishable\` and the content publish workflow; the identity check on deletion and export (from 6b); WebKit's IndexedDB fallback`. Under "Blockers outside the code", add:

```markdown
- **Provisioning** (plan 7, `docs/deploy.md`). Cloudflare, Neon and R2 are created by hand once; deploys stay off until `DEPLOY_ENABLED` is set.
```

- [ ] **Step 3: Add a Deploying section to `server/README.md`**

Append:

```markdown
## Deploying

`wrangler.jsonc`'s top level is local only (`wordado-local`). `env.preview` and `env.production`
are the deployed Workers, which also serve the web build (`../web/dist`). CI deploys them
(`.github/workflows/deploy.yml`). Provisioning and secrets are in `docs/deploy.md`.

```bash
pnpm --filter @wordado/server deploy:check    # dry-runs both environments; needs a web build
pnpm --filter @wordado/server smoke:remote https://wordado-preview.<subdomain>.workers.dev preview
```
```

- [ ] **Step 4: Commit**

```bash
git add docs/deploy.md docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md server/README.md
git commit -m "docs: the deploy runbook, the release checklist, and the roadmap for plan 7"
```

---

### Task 11: The first pull request runs CI

**Files:** none (repository operations only)

- [ ] **Step 1: Everything green locally**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @wordado/server smoke && E2E_PROJECTS=chromium,firefox,webkit pnpm --filter @wordado/web e2e && E2E_PROJECTS=chromium,firefox,webkit pnpm --filter @wordado/web e2e:accounts`
Expected: PASS (offline tests skipped on WebKit only).

- [ ] **Step 2: Push the branch and open the pull request**

```bash
git push -u origin HEAD
gh pr create --title "Plan 7: CI and deploy" --body "$(cat <<'EOF'
Plan 7 (docs/superpowers/plans/2026-09-25-ci-and-deploy.md): CI with typecheck, lint, every suite, the Worker smoke run and the e2e browser matrix; preview and production deploys (off until docs/deploy.md's provisioning sets DEPLOY_ENABLED); the content publish workflow; the identity check on account deletion and export; WebKit's IndexedDB fallback and a sign-out that never waits on the push manager.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Watch CI**

Run: `gh pr checks --watch`
Expected: `Typecheck, lint, workflows, deploy config`, `Suites and the Worker smoke run`, and `End to end (chromium|firefox|webkit)` pass. Both deploy jobs show as skipped (`DEPLOY_ENABLED` is unset).

If a job fails only in CI, read its log (`gh run view --log-failed`) and the uploaded `e2e-<project>` traces (`gh run download`). Typical first-run causes are a missing system package for a browser, Docker Compose's port, or a runner timing difference. Fix the cause in a new commit on the branch. Never loosen an assertion or add a skip without a named platform limitation.

- [ ] **Step 4: Record the result**

Note the green run's URL in the task report. Merging is the human's decision (superpowers:finishing-a-development-branch).

---

### Task 12 (operator): Provision, then the first preview and production deploys

This task is done by the human, with an agent assisting where a command needs no credentials of the agent's own. Follow `docs/deploy.md`'s provisioning steps 1–9.

- [ ] **Step 1:** Steps 1–2 of the runbook (Cloudflare token, Neon project and branches).
- [ ] **Step 2:** Step 3: create both Hyperdrives, then open a pull request that puts their ids in `server/wrangler.jsonc`. Its CI runs, and the preview deploy stays skipped until step 9.
- [ ] **Step 3:** Steps 4–7 (queues, R2 with its domain, CORS and token, secrets and variables, the rate-limit rule).
- [ ] **Step 4:** Step 8. Run **Publish content** with `pipeline/samples/a1-bg`. Expected: its last step prints `corpus version: published 0, served 0`.
- [ ] **Step 5:** Step 9. Set `DEPLOY_ENABLED`, then push any commit to the pull request from Step 2 (or re-run its workflow). Expected: **Preview deployment** runs the migrations and deploys. `/health` answers, and `smoke:remote` prints its two timings and `smoke: ok`. Record the timings in the pull request.
- [ ] **Step 6:** Open the preview in a browser. The demo loads from `/content/sample/`. A sign-in whose code is read from `pnpm --filter @wordado/server exec wrangler tail --env preview` installs the pack from `https://content.wordado.com/manifest.json` (Network panel).
- [ ] **Step 7:** Merge the pull request. Expected: **Production deployment** passes, and `https://wordado.com/health` answers `{"ok":true}`.

---

## Contracts this plan hands to the later plans

- **Plan 8 (corpus pipeline):** build into a directory shaped like `pipeline/samples/a1-bg/` (`manifest.json`, `corpus-v<N>-<l1>.pack`, `audio/<clip>.m4a`). `corpus publishable <dir>` must print `ok`, and **Publish content** uploads it. Pack file names carry their version, because they are cached as immutable. A clip whose bytes change needs a new clip id, because clips are cached for a day. **Keep the sample's entry ids in the real corpus, or alias them.** A demo carried into an account keeps answers on `c:hello-1` and the others, and the learner's pack must know those words.
- **Before the beta:** Resend's verified domain and `RESEND_API_KEY`/`EMAIL_FROM`, Google OAuth for `https://wordado.com`, the legal review's age table, and a keyboard, screen-reader and Safari-offline pass (the release checklist in `docs/deploy.md`).
- **CPU:** if `smoke:remote`'s timings or the Workers metrics approach the free plan's 10 ms CPU cap, move to Workers Paid (spec §17.2) before the beta. Don't shrink `SYNC_PAGE_SIZE` for it: that's a protocol change.
- **Pull requests from now on.** Work lands through pull requests with green CI.

## Run it

- `pnpm typecheck`, `pnpm lint`, `pnpm test`: every package.
- `E2E_PROJECTS=all pnpm --filter @wordado/web e2e` and `… e2e:accounts`: the browser matrix (`playwright install` each browser once).
- `pnpm --filter @wordado/server deploy:check`: both deployments, dry-run (after a web build).
- `pnpm --filter @wordado/pipeline corpus publishable <dir>`: before any content upload.
