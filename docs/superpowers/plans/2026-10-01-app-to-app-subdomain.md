# Moving the App to app.wordado.com Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app and its API are served at `https://app.wordado.com`, and its privacy links point to the public website at `https://wordado.com`, which takes over the main domain.

**Architecture:** Nothing inside the Worker changes. Its production route moves to `app.wordado.com`; the GitHub `production` environment's `APP_ORIGIN` follows, which sets `BASE_URL` and `TRUSTED_ORIGINS`. The app's own privacy page goes: the website in the private repo `wordado/wordado-site` serves it in each language, and redirects the old `wordado.com/privacy` and the app's old paths. The code lands in one pull request that is merged **on the day of the move**, in the order of Task 3.

**Tech Stack:** TypeScript 7, React 19, Vitest, Playwright, Wrangler, Cloudflare custom domains, Google Auth Platform, R2 CORS.

**Spec:** the website's design, `wordado/wordado-site` › `docs/specs/2026-10-01-site-design.md`, §3 (addresses) and §4 (moving the app). That repo is private; its §4 is restated in Decisions below so this plan stands on its own.

## Decisions

1. **The app's address is `https://app.wordado.com`.** The main domain is the website's (better for search, and moving the app is nearly free before the beta).
2. **The privacy policy lives on the website,** at `https://wordado.com/<lang>/privacy/` for `bg`, `de` and `en`. The app links to it in its interface language. `web/public/privacy.html` is deleted.
3. **The website redirects the old addresses:** `wordado.com/privacy` → `/<lang>/privacy/` (302, by `Accept-Language`) and the app's routes (`/study`, `/practice…`, `/path`, `/themes`, `/progress`, `/signin`, `/settings…`) → the same path on `app.wordado.com` (301). That is the website's Worker; nothing here.
4. **What is lost:** demo progress and installed copies of the app on the old origin, which before the beta means the Google app's test users and the owner. Synced progress comes back on signing in at the new address.
5. **Mail does not change:** sign-in emails carry codes, not links, and the VAPID subject is a `mailto:`.

## Global Constraints

- Work on the branch `plan/app-subdomain` (it holds this plan's commit).
- The website's address is `https://wordado.com`; its privacy pages are `https://wordado.com/bg/privacy/`, `/de/privacy/`, `/en/privacy/`, with the trailing slash.
- The app's interface languages are `bg`, `de`, `en` (`LOCALES` in `web/src/i18n/i18n.tsx`), the same three as the website's.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A learner whose interface language is German opens the privacy link from Sign in.** They should land on `/de/privacy/`, not the English page. *(Task 1 tests every locale.)*
2. **The installed app (standalone window) opens the privacy link.** It is another origin, so it opens in the browser, and the app must not intercept it in its service worker. *(Task 1's e2e checks the link is absolute; the service worker's navigation route only handles its own origin.)*
3. **A deploy of this branch before the day.** It would point production at `app.wordado.com` while `wordado.com` still serves the app. *(Task 3: the pull request is merged only on the day; Task 2 records why in the PR body.)*

---

### Task 1: Privacy links point to the website

**Files:**
- Create: `web/src/app/site.ts`, `web/src/app/site.test.ts`
- Modify: `web/src/screens/Settings.tsx:118-140` (`SectionPage`), `web/src/screens/SignIn.tsx:322-324`, `web/src/screens/Settings.test.tsx:328-334`, `web/src/screens/SignIn.test.tsx:271-277`, `web/src/sw.ts:13-14`, `web/e2e/demo.spec.ts:84-96`
- Delete: `web/public/privacy.html`

**Interfaces:**
- Produces: `web/src/app/site.ts` exports `SITE_URL = 'https://wordado.com'` and `privacyUrl(locale: Locale): string`.

- [ ] **Step 1: Write the failing test `web/src/app/site.test.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { LOCALES } from '../i18n/i18n'
import { privacyUrl, SITE_URL } from './site'

describe('privacyUrl', () => {
  it('is the website’s privacy page in the interface language', () => {
    expect(SITE_URL).toBe('https://wordado.com')
    expect(LOCALES.map((l) => privacyUrl(l))).toEqual([
      'https://wordado.com/bg/privacy/',
      'https://wordado.com/de/privacy/',
      'https://wordado.com/en/privacy/',
    ])
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `pnpm --filter @wordado/web exec vitest run src/app/site.test.ts`
Expected: FAIL, cannot resolve `./site`.

- [ ] **Step 3: Implement `web/src/app/site.ts`**

```ts
import type { Locale } from '../i18n/i18n'

/** The public website (wordado/wordado-site). The app is at app.wordado.com; the site holds the legal pages. */
export const SITE_URL = 'https://wordado.com'

/** The privacy policy in the interface language. The website has every interface language (LOCALES). */
export function privacyUrl(locale: Locale): string {
  return `${SITE_URL}/${locale}/privacy/`
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `pnpm --filter @wordado/web exec vitest run src/app/site.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the screen tests first**

In `web/src/screens/Settings.test.tsx`, the test `links to the policy` expects:
```ts
    expect(screen.getByRole('link', { name: 'Privacy policy' }).getAttribute('href')).toBe('https://wordado.com/en/privacy/')
```
In `web/src/screens/SignIn.test.tsx`, the test `links to the policy where the email address is asked for` expects the same value.

Run: `pnpm --filter @wordado/web exec vitest run src/screens/Settings.test.tsx src/screens/SignIn.test.tsx -t "privacy"`
Expected: both FAIL with `expected '/privacy' to be 'https://wordado.com/en/privacy/'`.

- [ ] **Step 6: Point both links at the website**

`web/src/screens/Settings.tsx`, in `SectionPage`: change `const { t } = useT()` to `const { t, locale } = useT()`, and the link to:
```tsx
          <a href={privacyUrl(locale)}>{t('privacy.link')}</a>
```
`web/src/screens/SignIn.tsx` (it already has `locale` from `useT()`):
```tsx
            <a href={privacyUrl(locale)}>{t('privacy.link')}</a>
```
Add `import { privacyUrl } from '../app/site'` to both files.

Run: `pnpm --filter @wordado/web exec vitest run src/screens/Settings.test.tsx src/screens/SignIn.test.tsx`
Expected: PASS.

- [ ] **Step 7: Delete the app's privacy page and its comment**

```bash
git rm web/public/privacy.html
```
In `web/src/sw.ts`, replace the two comment lines above `registerRoute(new NavigationRoute(...))` with:
```ts
// Every in-app URL is the shell; the router takes it from there. The API is never the shell. The privacy
// policy is on the website (wordado.com), another origin this route never sees.
```

- [ ] **Step 8: Replace the e2e test**

In `web/e2e/demo.spec.ts`, replace the test `serves the privacy policy, not the app, once the service worker controls the page` with:
```ts
test('Settings › About links to the privacy policy on the website, in the interface language', async ({ page }) => {
  await page.goto('/')
  await finishSetup(page)
  await page.goto('/settings/about')
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', 'https://wordado.com/en/privacy/')
})
```

- [ ] **Step 9: Check nothing else points at the old page**

Run: `git grep -n "privacy.html\|href=\"/privacy\"\|'/privacy'" -- web server docs/development.md`
Expected: no output.

- [ ] **Step 10: Run the web suites**

Run: `pnpm --filter @wordado/web test && pnpm --filter @wordado/web typecheck && pnpm lint && pnpm --filter @wordado/web build && pnpm --filter @wordado/web e2e -g "privacy policy"`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add -A web
git commit -m "feat(web): the privacy links open the website's policy in the interface language

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Production on app.wordado.com, and the docs

**Files:**
- Modify: `server/wrangler.jsonc` (production `routes`), `server/package.json` (`deploy:check`), `docs/deploy.md`, `docs/development.md:161`, `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md:35-40`

- [ ] **Step 1: Move the route**

In `server/wrangler.jsonc`, `env.production.routes` becomes:
```jsonc
      "routes": [{ "pattern": "app.wordado.com", "custom_domain": true }],
```

In `server/package.json`, the `deploy:check` script's production dry run uses `--var BASE_URL:https://app.wordado.com` in place of `--var BASE_URL:https://wordado.com`.

- [ ] **Step 2: Check the dry runs**

Run: `pnpm --filter @wordado/server deploy:check`
Expected: both dry runs succeed, and the production one lists the route `app.wordado.com (custom domain)`.

- [ ] **Step 3: Update `docs/deploy.md`**

1. The opening paragraph: `wordado` on `https://app.wordado.com` (production). Add after it: "The public website at `https://wordado.com` is a separate Worker from the private repo `wordado/wordado-site`; it serves the privacy policy and redirects the app's old paths here."
2. The "What is provisioned" table: `wordado`, `https://app.wordado.com`.
3. The Google sign-in line: redirect `https://app.wordado.com/api/auth/callback/google`.
4. The `www` paragraph: `www.wordado.com` redirects to `https://wordado.com`, which is the website; "Never serve the app on `www` too" stays true and now also covers the main domain: the app is only ever on `app.wordado.com`.
5. Add a section at the end:

```markdown
## Moving the app to app.wordado.com (2026-10)

Done once, in one sitting, in this order. The website must already be built and checked on its preview
address (wordado-site `docs/deploy.md`). Its legal pages need not be final yet: until its launch check passes,
it deploys with `noindex` on every page, so it is reachable but kept out of search engines (decided
2026-10-01: the app moves before the legal review).

1. **Google Auth Platform › Clients › the web client:** add the authorised JavaScript origin
   `https://app.wordado.com` and the redirect URI `https://app.wordado.com/api/auth/callback/google`.
   Keep the old ones for now.
2. **R2 › `wordado-content` › Settings › CORS policy:** add `https://app.wordado.com` to `AllowedOrigins`.
   Keep `https://wordado.com` for now.
3. **GitHub › Settings › Environments › `production`:** set `APP_ORIGIN` to `https://app.wordado.com`.
4. **Merge the move's pull request** and approve its production deploy. Wrangler attaches the custom domain
   `app.wordado.com` (it creates the DNS record itself).
5. **Check the app:** open `https://app.wordado.com`, sign in by emailed code and by Google, study one card,
   and see it sync (`pnpm --filter @wordado/server smoke:remote https://app.wordado.com production`).
6. **Free the main domain:** Cloudflare › Workers & Pages › `wordado` › Settings › Domains & Routes: remove
   `wordado.com` if it is still listed.
7. **Deploy the website** to `wordado.com` (wordado-site: set `PRODUCTION_ENABLED`, run Deploy).
8. **Check the redirects:** `curl -sI https://wordado.com/` (302 to a language), `curl -sI https://wordado.com/study`
   (301 to `https://app.wordado.com/study`), `curl -sI https://wordado.com/privacy` (302 to `/<lang>/privacy/`).
9. **Remove the old values:** `https://wordado.com` from Google's origins and redirects, and from R2's CORS.
```

- [ ] **Step 4: Update `docs/development.md` and the roadmap**

`docs/development.md:161`: `https://app.wordado.com` updates a few minutes later.

In `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, the privacy sentence of "Blockers outside the code" becomes:
```markdown
  The privacy policy now lives on the website (`wordado/wordado-site`, `src/content/<lang>/privacy.md`, served at
  `https://wordado.com/<lang>/privacy/`) with the terms and the Impressum; all three name the controller as
  `[Controller name]`, `[Address]` and `[Contact email]`, and the website stays out of search engines (`noindex`)
  until the review has filled them in (`pnpm launch-check`).
```
Leave the rest of that bullet (Google's app in Testing, the order before the beta) as it is.

- [ ] **Step 5: Commit**

```bash
git add server/wrangler.jsonc server/package.json docs/deploy.md docs/development.md docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md
git commit -m "chore(deploy): production moves to app.wordado.com; the website takes wordado.com

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Push and open the pull request, marked not to merge yet**

Pushing publishes to GitHub: ask the human partner first.
```bash
git push -u origin plan/app-subdomain
gh pr create --draft --title "Move the app to app.wordado.com" --body "The app and API move to https://app.wordado.com, and the privacy links point to the website at https://wordado.com/<lang>/privacy/.

**Do not merge before the day of the move** (docs/deploy.md, \"Moving the app to app.wordado.com\"): a production deploy of this branch points the Worker at app.wordado.com, and the APP_ORIGIN variable, Google's client and R2's CORS must change first.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

### Task 3: The day of the move (the operator, by hand)

Not code: the human partner follows `docs/deploy.md` › "Moving the app to app.wordado.com", steps 1–9, with the draft pull request from Task 2 merged at step 4. Preconditions, all true before starting:

- [ ] The website builds and passes its checks on its preview address.
- [ ] The website's Cloudflare secrets are set, so its production deploy can run (hidden with `noindex` until its
      legal pages are final; the legal review and the native read gate indexing and the beta announcement, not the move).
- [ ] Steps 1–9 done; the checks of steps 5 and 8 pass.
- [ ] Update the memory and roadmap: the app is at `app.wordado.com`.

---

## Self-review

- **Spec coverage (site spec §4):** route and `deploy:check` (Task 2); `APP_ORIGIN`, Google origins and redirect, R2 CORS, and the order of the day (Task 2's runbook, Task 3); privacy link and `privacy.html` (Task 1); `docs/deploy.md` and the roadmap (Task 2); mail unchanged (Decision 5). The website's redirects belong to `wordado-site`.
- **No placeholders:** every edit names its file, and each code change shows its code.
- **Types:** `privacyUrl(locale: Locale)` uses the app's own `Locale`, so a fourth interface language is a type-level reminder that the website needs that page too.
