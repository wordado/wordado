# Web Client, Part B: Accounts and Settings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 6a demo into the whole Phase 1a web client. It adds passwordless sign-in behind the age gate, carrying the demo over into a new account (or discarding it), syncing with plan 5's server, settings, the placement test, known and suspended words, Web Push reminders, account deletion and export, and installation and update prompts. All of it is keyboard- and screen-reader-operable and scanned for WCAG 2.2 AA.

**Architecture:** A device holds at most two SQLite files: `demo`, and one per signed-in account (`user-<id>`). Which one opens is decided by one `localStorage` record, the signed-in account. `Boot` (6a) grows accounts. It opens the demo or the learner's file, gives a learner's `Client` a `SyncTransport`, finishes a pending demo carry-over before opening the learner's file, runs the sync loop, and on hand-over drains in-flight answers and flushes before closing. An `AccountController` owns what happens on sign-in, sign-out, deletion and leaving the demo, using `Boot.switchTo()`. The screens call the controller and the `Client`; every rule stays in `core` and `client-data`.

**Tech Stack:** As 6a — Node 24, pnpm 12, TypeScript 7, Vitest 5 (happy-dom and a Chromium browser project), Vite 8, React 19, `@journeyapps/wa-sqlite`, `vite-plugin-pwa` 1.3 with Workbox 7.4, Playwright 1.63 with `@axe-core/playwright`. New: none. Sign-in talks to Better Auth's HTTP endpoints with `fetch`; there is no `better-auth` client package.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`. This plan implements:

- §7.2: the placement test, and the declared level.
- §7.4: known and suspended words.
- §8.6: passwordless sign-in, demo carry-over and discard, and the optional onboarding question.
- §8.11: Web Push reminders.
- §9.1: flushing on hand-over and on `visibilitychange`, the online-only in-memory fallback, and the installation prompt.
- §9.2: the client side of sync.
- §9.3: the periodic pack check, the whole-level audio download, and "update the app".
- §11: the age gate, account deletion and data export.
- §11.1: latency grading as a setting, and the accessibility of every new screen.
- §11.2: the learner's interface language.

It is plan **6b** of the roadmap (`docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`). Plans 4, 5 and 6a hand this plan contracts, listed under "Contracts this plan honours" below.

## Global Constraints

- No learning rule in `web/` (spec §4.1). What is due, what grades, what unlocks, whether an account holds progress (`accountIsEmpty`), which bands a placement test probes (`placementLevels`), and what counts as unsynced (`Client.hasUnsynced`) all come from `core` or `client-data`. `web/` decides only *when* to sync, never *what*.
- No outbox or merge logic in `web/` (spec §4.1). `web/` calls `client.sync()`, `client.attachUser()` and `accountIsEmpty()`; it never reads or writes a table.
- `core` stays pure (spec §4.1).
- **Storage.** A device keeps the demo's file `demo` and at most one learner's file, `user-<id>`. The browser storage the app uses is exactly:
  - the SQLite files;
  - the audio cache `wordado-audio-v1`;
  - the service worker's precache;
  - the cache `wordado-prefs`, which holds the interface language for the service worker;
  - four `localStorage` keys: `wordado.locale`, `wordado.account`, `wordado.reminder` and `wordado.visits`;
  - one `sessionStorage` key, `wordado.signin`, which carries the age gate's country across a Google redirect.
- **What the age gate keeps.** Only the country is stored (spec §11). The birth year is used once, on the device, and is never stored or sent.
- **Leaving the demo.** The demo database never leaves the device unless an account is created from it (spec §8.6). Signing in to an account that already holds progress deletes the demo, and the sign-in screen says so before the code is requested.
- **Sync failures and statuses.** Every server failure has a learner-facing status. Offline, a failure, an expired sign-in, an out-of-date app and a malformed page each map to a message key in `syncMessage()`; no sync error leaves the learner without a status.
- **Accessibility (spec §11.1).** Every new screen is operable by keyboard. Every form field has a visible label, and errors are announced (`role="alert"`) and tied to their field with `aria-describedby`. Destructive actions (leave the demo, sign out with unsynced answers, delete the account) confirm in a modal `<dialog>` that returns focus to the button that opened it.
- **Interface strings.** They live in `web/src/i18n/en.ts` and `bg.ts`, and every task that adds a key adds it to both, or `pnpm typecheck` fails. Country names come from `Intl.DisplayNames`; no string table holds them.
- **Code style.** No semicolons, single quotes, 2-space indent, named exports only (the Vite and Playwright configs are the exceptions), and `readonly` on every interface field. Tests sit beside their module; browser-only tests are named `*.browser.test.ts`.
- **Every task ends green.** `pnpm test` and `pnpm typecheck` pass from the repository root. The web suite's browser project needs Chromium once per machine: `pnpm --filter @wordado/web exec playwright install chromium`. The server suite needs Docker running.

## Review Focus

- **The tab closes, or the network drops, between verifying the code and the demo reaching the server.** The demo keeps its answers, because it is already attached to the account. The next launch pushes them before opening the learner's file, then deletes the demo, and nothing is sent twice. Pinned in Task 6 (`Boot` carry-over) and Task 7 (`completeSignIn` with the transport failing).
- **Signing in from the demo to an account that already has progress.** Nothing from the demo is merged, the demo file is deleted, and the learner lands on their account's progress. The sign-in screen said this would happen before the code was requested. Pinned in Task 7 and Task 8.
- **A sign-in that expires while answers are waiting.** The outbox is kept, and the status says to sign in again. Signing in again as the same learner resumes syncing. Signing in as someone else is refused, and this device's learner's answers are never pushed into the other account. Pinned in Task 7 and Task 8.
- **Taking over or signing out while an answer is being written.** The answer finishes and is flushed before the database closes. An answer whose event was saved but whose follow-up work failed is never recorded twice. Pinned in Task 2 (`Client.idle`, `answer`) and Task 6 (`Boot.release`, `switchTo`).
- **Junk in a settings field or at the age gate.** An empty field, `45` new words, `-1`, `2.5`, a birth year of `20` or one in the future: each shows an inline error and never reaches `updateSettings` or the code request. A learner below their country's age is turned away before any request is made. Pinned in Task 4 (`oldEnough`), Task 8 (the gate) and Task 9 (`parseWholeNumber` and the fields).

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| Flush on hand-over before closing anyway | 3 seconds | `web/src/app/boot.ts` (`FLUSH_TIMEOUT_MS`) |
| Periodic sync while the app is visible | every 5 minutes | `web/src/app/syncLoop.ts` (`SYNC_INTERVAL_MS`) |
| One sync request's timeout | 30 seconds | `web/src/account/transport.ts` (`SYNC_REQUEST_TIMEOUT_MS`) |
| Periodic pack check | every 6 hours, and at launch | `web/src/app/content.ts` (`PACK_CHECK_INTERVAL_MS`) |
| Default reminder time | 19:00 local | `web/src/reminders/reminders.ts` (`DEFAULT_REMINDER_MINUTE`) |
| Installation prompt | from the second distinct local day of use | `web/src/app/install.ts` |
| Age of digital consent | per-country table, 16 for an unknown country, 13 outside the EEA | `web/src/account/ageGate.ts` |

## Decisions recorded here

- **No `better-auth` client in the browser.** Plan 5's contract names Better Auth's client, but the app needs five endpoints: send a code, verify it, start Google, update the user, sign out. `web/src/account/api.ts` calls them with `fetch` and turns failures into one `ApiError` the screens can explain. This keeps the bundle small, and the calls can be tested with a fake `fetch`. The endpoints are the ones plan 5's tests exercise:
  - `POST /api/auth/email-otp/send-verification-otp`
  - `POST /api/auth/sign-in/email-otp`
  - `POST /api/auth/sign-in/social`
  - `POST /api/auth/update-user`
  - `POST /api/auth/sign-out`
- **One file per account; the account record decides.** `localStorage['wordado.account']` holds `{ userId, email }` for the account this device is signed in to, and `Boot` opens `user-<id>` when it is set, `demo` otherwise. It is written only after the server has confirmed who signed in (`GET /v1/me`). The record is not a credential; the session cookie is. Offline, a signed-in learner opens their own file and studies; the first sync that meets a 401 marks the sign-in as expired.
- **An account "has progress" when the server holds anything the learner wrote.** That means a review state, a completed day, or a versioned document. Server-owned documents (the entitlement every account gets) do not count. `accountIsEmpty` in `client-data` decides it with one pull. This is spec §8.6's rule — carry over into a new account, discard when signing in to an existing one — made robust. An account created earlier but never used behaves as new, which is harmless because there is nothing to merge.
- **The demo is carried over through its own database.** The live demo `Client` is attached to the account together with a transport (`attachUser(userId, transport)`) and syncs, so the demo's answers reach the server from the demo's own device id. The server accepts them back to a day before the account existed (plan 5). The learner's file then opens empty and pulls. If the push did not finish, the demo file stays attached, and `Boot` finishes the push at the next open before deleting it. An in-memory demo that cannot finish is lost with the tab, which is what its banner already says.
- **The age gate runs before every sign-in, not only before sign-up.** With emailed codes and Google, the server creates the account at the first successful sign-in; the client cannot know beforehand whether the account is new. A separate "I already have an account" path would let anyone skip the gate. So the gate asks for country and birth year each time the sign-in flow starts. Only the country is kept.
- **The birth year is judged conservatively.** A learner's age is taken as the youngest they could be this year: current year − birth year − 1. Someone who turns 14 later this year is treated as 13. Asking only for the year (spec §11) cannot do better without asking for more.
- **The age-of-consent table is provisional.** Spec §15 lists the per-country table as a legal-review item that is still open. `ageGate.ts` implements the member-state ages of GDPR Article 8 as published by the member states, with Iceland, Liechtenstein and Norway for the EEA, 16 where the country is unknown, and 13 elsewhere. The file names the review as pending, and the table is the one place to change.
- **Signing out deletes the learner's file.** A browser may be shared, and everything that has been synced is on the server. Sign-out flushes first. If answers are still waiting (offline), it asks before deleting them. The app then opens a fresh demo.
- **Signing in as someone else while expired is refused.** If the sign-in has expired and the learner signs in with a different account, pushing this device's answers into it would be wrong, and so would deleting them. The new session is signed out again, and the screen says whose progress this device holds.
- **Placement probes only the bands the corpus ships.** `core`'s placement search now takes the list of bands. `placementLevels` gives the bands from A1 upward that have a probe's worth of live words, and the test is offered only when there are at least two. Phase 1a ships A1–B1, so a learner can be placed at A1, A2 or B1. The bundled sample is A1 only, so the demo does not offer the test. Placement answers are not review events: they test, they do not schedule.
- **Set-aside words are flagged where they are met.** A learner can set a word aside ("I know this", "Not now") on the study card, on a unit's word list in the path, and bring it back from settings. A flag is a versioned document (spec §7.4), so it syncs.
- **The onboarding question is a block on Today, not a step.** Spec §8.6 asks for one optional, skippable "What do you want English for?" that sets the first theme. It appears on Today only while nothing has been studied and no theme is chosen, lists the offered themes, and has "Skip". Answering sets `activeTheme`, and the first answer removes the block for good. No flag is stored.
- **The service worker learns the interface language from a cache entry.** A woken service worker has no `localStorage`. The page writes `{ "lang": "bg" | "en" }` to the cache `wordado-prefs` whenever the language changes, and the `push` handler reads it for `GET /v1/reminder?lang=…`.
- **Sample audio leaves the precache.** 6a precached the sample's clips, but `AudioStore` never looked there. The glob drops `m4a`, and on a boot from the bundled sample `AudioStore` fetches every sample clip once (about 60 small files). One cache holds all audio, and listening offline works from the first visit that was online.
- **The CDN manifest moves to plan 7.** 6a's contract put "packs beyond the sample" here. The CDN and its manifest do not exist until plan 7 puts packs in R2, and the real corpus arrives with plan 8. This plan builds everything that does not need them: the periodic check, "update the app" when a pack needs a newer build, refreshing `AudioStore` after a pack activates, and the whole-level audio download. Plan 7 adds `VITE_CONTENT_MANIFEST_URL` for learners, beside the sample for the demo, with an `AudioStore` per manifest. The roadmap is updated in Task 14.
- **Sign-up does not ask for the L1 in Phase 1a.** Spec §8.6 has sign-up ask for L1, credentials and the age check. Bulgarian is the only pack until Phase 1b, so the question would have one answer; it arrives with the second L1, and `Boot`'s `l1` stays `'bg'`.
- **Reminder preferences live on the device.** A subscription belongs to one browser (plan 5 keys it by endpoint), and the server has no read endpoint for it. `wordado.reminder` holds `{ minute, streakNudge }`, and every launch sends the subscription again with the current offset and language, as plan 5 asks.
- **Accounts run end to end against the real Worker.** A second Playwright config, `playwright.accounts.config.ts`, starts plan 5's Worker (`pnpm --filter @wordado/server dev`, with Postgres in Docker), reads sign-in codes from its log as plan 5's smoke run does, and serves the web build through `vite preview`, whose proxy forwards `/api` and `/v1`. The 6a demo run stays independent of the server.

## Contracts this plan honours

- **From 6a:**
  - `BootDeps` gains the account and the transport, with one file per learner (Task 6).
  - Letting go flushes, bounded by a timeout, after draining in-flight answers (Tasks 2 and 6).
  - The app flushes after every run and on `visibilitychange` (Task 6).
  - The in-memory fallback syncs after every answer and says study needs a connection (Tasks 6 and 8).
  - `latencyGrading` becomes a setting (Tasks 1, 2 and 9).
  - The settings screen and placement (Tasks 9 and 11).
  - The periodic pack check, `appUpdateNeeded`, the whole-level audio download, and audio refresh after activation (Tasks 9 and 13); the CDN manifest moves to plan 7 (decision above).
  - The service worker's `push` handler, its skip-waiting message, and PNG icons (Tasks 12 and 13).
  - Every new screen joins the accessibility scan (Task 14).
  - `client.close()` resolves only once the Worker has let go (Task 5).
  - A take-over request that arrives mid-switch is handled (Task 6).
  - Home's listening link follows connectivity (Task 10).
  - Known and suspended words on the card and the path, and the onboarding question (Task 10).
- **Parked by 6a's final review:**
  - `rate()`'s settle guard counts from the reveal, so a double tap on "Show answer" cannot land on a rating (Task 2).
  - An item advancing while the report dialog is open still loses its pause. It only shortens recorded latency, so it stays parked.
- **From plan 5:**
  - The transport: `credentials: 'include'`; any non-200 is thrown; `upgrade_required` arrives in a 200 body; a 400 is a bug the status names (Task 4).
  - Sign-in: codes, Google, the country through `update-user` pre-filled from `GET /v1/country`, the 429 `sign_in_email_limit` explained, and `GET /v1/me` (Tasks 4, 7 and 8).
  - Demo carry-over (Tasks 6 and 7).
  - Reminders: the public key, `PUT /v1/push/subscription` at each launch, and the `push` handler fetching `GET /v1/reminder` (Task 12).
  - `DELETE /v1/account` with `{ "confirm": true }` and then discarding the local file, and `GET /v1/export` (Tasks 7 and 9).
- **From plan 4:**
  - A demo `Client` has no transport; `attachUser` then a transport on sign-up; discard on sign-in to an existing account (Tasks 2 and 7).
  - `sync()` after every session and on `visibilitychange` (Task 6).
  - `installPacks` on a periodic check (Task 13).

---

## File Structure

```
core/src/
  settings.ts             latencyGrading in Settings, validated                         (modify)  §11.1
  placement.ts            placementLevels, placementPool; the search takes its bands    (modify)  §7.2
client-data/src/
  client.ts               idle, hasUnsynced, levelClips; answer never throws once saved;
                          close drains; attachUser takes a transport                   (modify)  §9.1, §8.6
  run.ts                  latency grading from settings; setAside; rate settles from the reveal (modify) §7.4, §11.1
  sync.ts                 accountIsEmpty, UpgradeRequiredError                          (modify)  §8.6
  study.ts                levelClips                                                    (modify)  §9.3
  placement.ts            PlacementRun: the placement test's state machine             (new)     §7.2
  testing/sample.ts       leveledCorpus (tests only)                                    (modify)
  index.ts                re-exports placement                                          (modify)
server/wrangler.jsonc     TRUSTED_ORIGINS gains the preview origin :4173                (modify)
web/
  vite.config.ts          preview proxy; no m4a in the precache; PNG icons              (modify)
  index.html              apple-touch-icon                                              (modify)
  public/apple-touch-icon.png, icon-192.png, icon-512.png   rendered from icon.svg     (new)
  scripts/icons.ts        renders the PNG icons with Playwright's Chromium              (new)
  playwright.accounts.config.ts, e2e/accounts.setup.ts, e2e/accounts.spec.ts          (new)
  package.json            e2e:accounts, icons scripts                                   (modify)
  src/
    account/api.ts        Api, httpApi, ApiError, Me                                    (new)     §8.6, §11
    account/transport.ts  httpTransport: SyncTransport over fetch                       (new)     §9.2
    account/ageGate.ts    CONSENT_AGE, consentAge, oldEnough                            (new)     §11
    account/countries.ts  COUNTRY_CODES, countryOptions                                 (new)     §11
    account/storage.ts    the account record, the pending sign-in, learnerFile, DEMO_FILE (new)
    account/controller.ts AccountController: sign-in, sign-out, delete, leave the demo, expiry (new) §8.6
    storage/erase.ts      deleteDatabase(file)                                          (new)     §8.6
    app/boot.ts           accounts, switchTo, carry-over, flush on release              (modify)  §9.1, §8.6
    app/syncLoop.ts       when to sync                                                  (new)     §9.1
    app/syncMessage.ts    the sync status as a message                                  (new)     §9.2
    app/content.ts        the periodic pack check, audio refresh after activation      (new)     §9.3
    app/install.ts        installation and new-version prompts                          (new)     §9.1
    app/context.tsx       AppServices gains account, api, reminders, install            (modify)
    app/App.tsx           settings in the nav, banners, notices, sync status            (modify)
    app/Banners.tsx       demo, memory, expiry, notices, update and install banners     (new)
    app/Confirm.tsx       ConfirmDialog: the modal every destructive action uses        (new)     §11.1
    app/Root.tsx          passes the controller                                         (modify)
    main.tsx              wires accounts, transport, sync, content, install, reminders  (modify)
    router.tsx            signin, settings, placement routes                            (modify)
    useOnline.ts          navigator.onLine as a hook                                    (new)
    screens/SignIn.tsx    the age gate, email and code, Google                          (new)     §8.6, §11
    screens/Settings.tsx  study settings, words set aside, reminders, account, app      (new)     §7.2, §7.4, §11
    screens/Placement.tsx the placement test                                            (new)     §7.2
    screens/Home.tsx      the onboarding question; listening follows connectivity       (modify)  §8.6, §9.3
    screens/Path.tsx      a unit's words, each can be set aside                         (modify)  §7.4
    settings/fields.ts    parseWholeNumber                                              (new)
    study/RunView.tsx     "I know this" and "Not now"                                   (modify)  §7.4
    reminders/reminders.ts ReminderService: subscribe, resend at launch, stop           (new)     §8.11
    reminders/prefs.ts    writes the interface language for the service worker          (new)
    sw.ts                 push, notificationclick, skip waiting                         (modify)  §8.11, §9.1
    i18n/en.ts, i18n/bg.ts                                                              (modify)
    styles.css            forms, dialogs, banners, the settings page                    (modify)
    test/fixtures.tsx     fakeApi, account-aware renderWith                             (modify)
docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md   6b done; the CDN manifest in plan 7 (modify)
```

---

### Task 1: `core`: latency grading as a setting, and placement over the bands a corpus ships

Spec §11.1 lets a learner switch latency-based grading off. Spec §7.2's placement test must search only bands that have words: Phase 1a ships A1–B1, and a probe of an empty band could never be decided.

**Files:**
- Modify: `core/src/settings.ts`
- Modify: `core/src/placement.ts`
- Test: `core/src/settings.test.ts`, `core/src/placement.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `Settings.latencyGrading: boolean` (default `true`), validated by `validateSettingsPatch` as a boolean.
  - `placementProgress(answers, levels?: readonly CefrLevel[])` and `nextPlacementWords(answers, pool, rng, levels?)`. `levels` defaults to `CEFR_LEVELS`, so existing callers are unchanged.
  - `placementPool(entries: Iterable<CorpusEntry>): Map<CefrLevel, WordId[]>`.
  - `placementLevels(pool): CefrLevel[]`.
  - `MIN_PLACEMENT_LEVELS = 2`.

- [ ] **Step 1: Write the failing settings tests**

Add to `core/src/settings.test.ts`, inside `describe('validateSettingsPatch', …)`:

```ts
  it('accepts latency grading on or off, and nothing else (spec §11.1)', () => {
    expect(validateSettingsPatch({ latencyGrading: false })).toEqual({ ok: true, fields: { latencyGrading: false } })
    expect(errorsOf({ latencyGrading: 'no' })).toEqual(['latencyGrading'])
    expect(errorsOf({ latencyGrading: 0 })).toEqual(['latencyGrading'])
  })
```

and a new block at the end of the file:

```ts
describe('latency grading', () => {
  it('is on by default, and a stored value that is not a boolean is ignored', () => {
    expect(DEFAULT_SETTINGS.latencyGrading).toBe(true)
    expect(settingsFromFields({ latencyGrading: false }).latencyGrading).toBe(false)
    expect(settingsFromFields({ latencyGrading: 'off' }).latencyGrading).toBe(true)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/core exec vitest run src/settings.test.ts`
Expected: FAIL — `latencyGrading` is an unknown field, and `DEFAULT_SETTINGS.latencyGrading` is `undefined`.

- [ ] **Step 3: Add the field**

In `core/src/settings.ts`, add to `Settings` after `audio`:

```ts
  /** Slow correct answers count as Hard (spec §7.3); off grades on correctness alone (spec §11.1). */
  readonly latencyGrading: boolean
```

add `latencyGrading: true,` to `DEFAULT_SETTINGS` after `audio: true,`, and extend the validation chain's last branch. Replace:

```ts
                  : key === 'audio'
                    ? typeof value === 'boolean'
                    : false
```

with:

```ts
                  : key === 'audio' || key === 'latencyGrading'
                    ? typeof value === 'boolean'
                    : false
```

- [ ] **Step 4: Run the settings tests**

Run: `pnpm --filter @wordado/core exec vitest run src/settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing placement tests**

Add to `core/src/placement.test.ts`. Extend the import to `import { MIN_PLACEMENT_LEVELS, nextPlacementWords, PLACEMENT_PASS_MIN, PLACEMENT_PROBE_SIZE, placementLevels, placementPool, placementProgress, type PlacementAnswer } from './placement'`, add `import type { CorpusEntry } from './types'`, and append:

```ts
describe('placement over the bands a corpus ships (spec §7.2)', () => {
  const shipped: readonly CefrLevel[] = ['A1', 'A2', 'B1']

  it('starts in the middle of the shipped bands', () => {
    expect(placementProgress([], shipped)).toEqual({ probing: 'A2', remainingInProbe: PLACEMENT_PROBE_SIZE, result: null })
  })

  it('places at the highest shipped band when every probe passes, and at A1 when the first probes fail', () => {
    const passA2 = probe('A2', 8)
    expect(placementProgress(passA2, shipped).probing).toBe('B1')
    const all = [...passA2, ...pool.get('B1')!.slice(0, PLACEMENT_PROBE_SIZE).map((wordId) => ({ wordId, level: 'B1' as const, correct: true }))]
    expect(placementProgress(all, shipped)).toEqual({ probing: null, remainingInProbe: 0, result: 'B1' })
    const failA2 = pool.get('A2')!.slice(0, 3).map((wordId) => ({ wordId, level: 'A2' as const, correct: false }))
    expect(placementProgress(failA2, shipped).probing).toBe('A1')
  })

  it('draws the next words from the shipped band being probed', () => {
    const words = nextPlacementWords([], pool, seededRng(3), shipped)
    expect(words).toHaveLength(PLACEMENT_PROBE_SIZE)
    for (const w of words) expect(pool.get('A2')).toContain(w)
  })

  it('has nothing to probe with one band: that band is the result', () => {
    expect(placementProgress([], ['A1'])).toEqual({ probing: null, remainingInProbe: 0, result: 'A1' })
    expect(nextPlacementWords([], pool, seededRng(3), ['A1'])).toEqual([])
  })

  it('refuses an empty list of bands', () => {
    expect(() => placementProgress([], [])).toThrow()
  })
})

const entry = (entryId: string, level: CefrLevel, retired = false): CorpusEntry => ({
  entryId,
  headword: entryId,
  variants: [],
  pos: 'noun',
  sense: '',
  level,
  ipa: '',
  unitId: 'u',
  themes: [],
  translations: ['x'],
  examples: [],
  audio: {},
  retired,
})

describe('placementPool and placementLevels', () => {
  it('groups live entries by band, leaving retired ones out', () => {
    const got = placementPool([entry('a', 'A1'), entry('b', 'A1', true), entry('c', 'B1')])
    expect(got.get('A1')).toEqual(['c:a'])
    expect(got.get('B1')).toEqual(['c:c'])
    expect(got.has('A2')).toBe(false)
  })

  it('offers bands from A1 upward while each has a probe’s worth of words', () => {
    const many = (level: CefrLevel, n: number) => Array.from({ length: n }, (_, i) => entry(`${level}-${i}`, level))
    const full = placementPool([...many('A1', 8), ...many('A2', 8), ...many('B1', 8)])
    expect(placementLevels(full)).toEqual(['A1', 'A2', 'B1'])
    // A gap stops the list: B1 cannot be probed as the neighbour of an empty A2.
    const gap = placementPool([...many('A1', 8), ...many('A2', 7), ...many('B1', 8)])
    expect(placementLevels(gap)).toEqual(['A1'])
    expect(MIN_PLACEMENT_LEVELS).toBe(2)
  })
})
```

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @wordado/core exec vitest run src/placement.test.ts`
Expected: FAIL — `placementLevels` and `placementPool` are not exported, and `placementProgress` ignores its second argument.

- [ ] **Step 7: Make the search take its bands**

Replace `core/src/placement.ts` from `export function placementProgress` to the end of the file with:

```ts
export function placementProgress(answers: readonly PlacementAnswer[], levels: readonly CefrLevel[] = CEFR_LEVELS): PlacementProgress {
  if (levels.length === 0) throw new Error('Placement needs at least one band')
  const maxWrong = PLACEMENT_PROBE_SIZE - PLACEMENT_PASS_MIN
  let lo = 0
  let hi = levels.length - 1
  let i = 0
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2)
    const band = levels[mid]!
    let right = 0
    let wrong = 0
    while (right < PLACEMENT_PASS_MIN && wrong <= maxWrong) {
      const answer = answers[i]
      if (!answer) return { probing: band, remainingInProbe: PLACEMENT_PROBE_SIZE - right - wrong, result: null }
      if (answer.level !== band) throw new Error(`Expected an answer from ${band}, got ${answer.level}`)
      i += 1
      if (answer.correct) right += 1
      else wrong += 1
    }
    if (right >= PLACEMENT_PASS_MIN) lo = mid + 1
    else hi = mid
  }
  return { probing: null, remainingInProbe: 0, result: levels[lo]! }
}

/**
 * Words to ask next, drawn at random from the band being probed, never one
 * already asked: at most `remainingInProbe`, fewer only if the band has no
 * more words to give, and none once the test is decided.
 */
export function nextPlacementWords(
  answers: readonly PlacementAnswer[],
  pool: ReadonlyMap<CefrLevel, readonly WordId[]>,
  rng: Rng,
  levels: readonly CefrLevel[] = CEFR_LEVELS,
): WordId[] {
  const progress = placementProgress(answers, levels)
  if (progress.probing === null) return []
  const asked = new Set(answers.map((a) => a.wordId))
  const candidates = (pool.get(progress.probing) ?? []).filter((id) => !asked.has(id))
  return shuffle(candidates, rng).slice(0, progress.remainingInProbe)
}

/** A test over fewer bands than this has nothing to decide (spec §7.2). */
export const MIN_PLACEMENT_LEVELS = 2

/** Live corpus words by band: what a placement test draws from. Retired entries are never asked. */
export function placementPool(entries: Iterable<CorpusEntry>): Map<CefrLevel, WordId[]> {
  const out = new Map<CefrLevel, WordId[]>()
  for (const entry of entries) {
    if (entry.retired) continue
    const list = out.get(entry.level) ?? []
    list.push(corpusWordId(entry.entryId))
    out.set(entry.level, list)
  }
  return out
}

/**
 * The bands a placement test searches: from A1 upward, each with a whole
 * probe's worth of words, stopping at the first that has not. A band cannot
 * be probed past a gap, because the search compares neighbours.
 */
export function placementLevels(pool: ReadonlyMap<CefrLevel, readonly WordId[]>): CefrLevel[] {
  const out: CefrLevel[] = []
  for (const level of CEFR_LEVELS) {
    if ((pool.get(level)?.length ?? 0) < PLACEMENT_PROBE_SIZE) break
    out.push(level)
  }
  return out
}
```

and change the imports at the top of the file to:

```ts
import { shuffle, type Rng } from './rng'
import { CEFR_LEVELS, type CefrLevel, type CorpusEntry } from './types'
import { corpusWordId, type WordId } from './wordId'
```

- [ ] **Step 8: Run the core suite and the whole repository**

Run: `pnpm --filter @wordado/core test`
Expected: PASS, including the existing placement tests, which use the default bands.

Run: `pnpm test && pnpm typecheck`
Expected: PASS. The server validates settings through `validateSettingsPatch`, so it accepts `latencyGrading` with no change of its own.

- [ ] **Step 9: Commit**

```bash
git add core/src/settings.ts core/src/settings.test.ts core/src/placement.ts core/src/placement.test.ts
git commit -m "feat(core): latency grading as a setting; placement over the bands a corpus ships"
```

---

### Task 2: `client-data`: a Client that can be handed over, runs that honour the settings, set-aside words, and carry-over rules

Spec §9.1 says the tab that loses ownership flushes and then closes. 6a's review found three gaps in the `Client` that `Boot` needs closed first:

- `close()` does not wait for an answer still being written.
- An answer whose event was saved can still throw, and a retry would record it twice.
- Nothing says whether anything is still unsynced.

This task also passes the latency-grading setting to runs, lets a run set a word aside (spec §7.4), and adds the rule for when an account can take a demo (spec §8.6).

**Files:**
- Modify: `client-data/src/client.ts`
- Modify: `client-data/src/run.ts`
- Modify: `client-data/src/sync.ts`
- Modify: `client-data/src/study.ts`
- Test: `client-data/src/client.test.ts`, `client-data/src/run.test.ts`

**Interfaces:**
- Consumes: `Settings.latencyGrading` (Task 1).
- Produces:
  - `Client.idle(): Promise<void>` resolves once no answer or document write is in flight.
  - `Client.close()` refuses new work with `ClientClosed`, waits for `idle()`, then closes the driver.
  - `Client.answer()` never throws after its event is stored.
  - `Client.hasUnsynced(): Promise<boolean>` covers events, completed days and document patches.
  - `Client.attachUser(userId: string, transport?: SyncTransport): Promise<void>` binds the database and, when given a transport, syncs through it from then on.
  - `Client.levelClips(level: CefrLevel): AudioClip[]`.
  - `class ClientClosed extends Error`.
  - `StudyRun.setAside(flag: WordFlag): Promise<void>`, and `RunSnapshot.setAside: number`.
  - `accountIsEmpty(transport: SyncTransport, deviceId: string): Promise<boolean>`, and `class UpgradeRequiredError extends Error`.
  - `levelClips(ctx: StudyContext, level: CefrLevel): AudioClip[]` in `study.ts`.

- [ ] **Step 1: Write the failing Client tests**

Append to `client-data/src/client.test.ts` (it already has `openClient`, `answer`, `manifest`, `fromDisk`, `FakeServer` and `testEnv`; add `import type { SqlDriver } from './driver'` and `import { ClientClosed } from './client'` to its imports):

```ts
/** A driver whose document writes can be made to fail, as a full disk would. */
function failingDocuments(driver: SqlDriver): { driver: SqlDriver; fail: { on: boolean } } {
  const fail = { on: false }
  return {
    fail,
    driver: {
      ...driver,
      run: async (sql, params) => {
        if (fail.on && /INSERT INTO document/.test(sql)) throw new Error('disk full')
        await driver.run(sql, params)
      },
    },
  }
}

describe('Client hand-over (spec §9.1)', () => {
  it('never throws once the answer is saved, so a retry cannot record it twice', async () => {
    const { driver, fail } = failingDocuments(nodeSqliteDriver())
    const client = await Client.open({ driver, env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    fail.on = true
    // The first answer unlocks the first unit: a document write, which fails here.
    const result = await client.answer(answer('c:hello-1'))
    expect(result.event.wordId).toBe('c:hello-1')
    expect(result.unlocked).toEqual([])
    expect(client.snapshot.states.get('c:hello-1')?.reps).toBe(1)
    fail.on = false
    // The unlock is not lost: the next answer finds it still owed and records it.
    const next = await client.answer(answer('c:goodbye-1'))
    expect(next.unlocked).toEqual(['a1-01'])
    expect(client.snapshot.sync.pendingEvents).toBe(2)
  })

  it('close waits for an answer being written, then refuses new work', async () => {
    const client = await openClient()
    const pending = client.answer(answer('c:hello-1'))
    const closing = client.close()
    await expect(pending).resolves.toMatchObject({ event: { wordId: 'c:hello-1' } })
    await closing
    await expect(client.answer(answer('c:goodbye-1'))).rejects.toBeInstanceOf(ClientClosed)
    await expect(client.updateSettings({ audio: false })).rejects.toBeInstanceOf(ClientClosed)
  })

  it('idle resolves at once when nothing is in flight, and after the work when something is', async () => {
    const client = await openClient()
    await client.idle()
    let done = false
    const pending = client.answer(answer('c:hello-1')).then(() => {
      done = true
    })
    await client.idle()
    expect(done).toBe(true)
    await pending
  })

  it('knows when answers, completed days or document writes are unsynced', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const client = await openClient(env, server)
    expect(await client.hasUnsynced()).toBe(false)
    await client.answer(answer('c:hello-1'))
    expect(await client.hasUnsynced()).toBe(true)
    expect(await client.sync()).toBe('synced')
    expect(await client.hasUnsynced()).toBe(false)
    await client.updateSettings({ newWordLimit: 5 })
    expect(await client.hasUnsynced()).toBe(true)
  })
})

describe('attaching a demo to an account (spec §8.6)', () => {
  it('syncs through the transport it is given from then on', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const demo = await openClient(env)
    await demo.answer(answer('c:hello-1'))
    expect(await demo.sync()).toBe('skipped')
    await demo.attachUser('user-1', server)
    expect(demo.snapshot.userId).toBe('user-1')
    expect(await demo.sync({ force: true })).toBe('synced')
    expect([...server.events.values()].map((e) => e.wordId)).toEqual(['c:hello-1'])
    expect(await demo.hasUnsynced()).toBe(false)
  })
})

describe('levelClips (spec §9.3)', () => {
  it('lists every clip of the live words of a level', async () => {
    const client = await openClient()
    const clips = client.levelClips('A1')
    expect(clips.length).toBeGreaterThan(0)
    expect(new Set(clips.map((c) => c.clipId)).size).toBe(clips.length)
    expect(client.levelClips('B2')).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/client-data exec vitest run src/client.test.ts`
Expected: FAIL — `ClientClosed`, `idle`, `hasUnsynced` and `levelClips` do not exist, `attachUser` takes no transport, and the failing document write makes `answer` throw.

- [ ] **Step 3: Add `levelClips` to `study.ts`**

In `client-data/src/study.ts`, add `type CefrLevel` to the `@wordado/core` import (`entryClips` is already imported, for `availableModes`), and append:

```ts
/** Every clip of the live words of one level: the whole-level download over Wi-Fi (spec §9.3). */
export function levelClips(ctx: StudyContext, level: CefrLevel): AudioClip[] {
  const seen = new Map<string, AudioClip>()
  for (const entry of ctx.corpus.entries.values()) {
    if (entry.level !== level || entry.retired) continue
    for (const clip of entryClips(ctx.corpus, entry)) seen.set(clip.clipId, clip)
  }
  return [...seen.values()]
}
```

- [ ] **Step 4: Make the Client hand-over safe**

In `client-data/src/client.ts`:

1. Extend the imports:
   - `@wordado/core`: add `type CefrLevel`.
   - `./study`: add `levelClips`.
   - `./learner`: add `pendingDayComplete` and `unpushedEvents`.
   - `./documents`: add `import { pendingDocumentWrites } from './documents'`.

2. Above `export class Client`, add:

```ts
/** Thrown by a Client that has been closed, or is closing, when asked for new work. */
export class ClientClosed extends Error {
  constructor() {
    super('The database is closed')
    this.name = 'ClientClosed'
  }
}
```

3. In the class, change `private readonly engine: SyncEngine | null` to `private engine: SyncEngine | null`, and add these fields after it:

```ts
  /** Answers and document writes still running: `close` waits for them (spec §9.1). */
  private readonly inFlight = new Set<Promise<unknown>>()
  private closing = false
```

4. Add these private and public methods after `refresh()`:

```ts
  /** Runs one piece of work that writes to the database, refusing it once the Client is closing. */
  private async guarded<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) throw new ClientClosed()
    const running = work()
    this.inFlight.add(running)
    try {
      return await running
    } finally {
      this.inFlight.delete(running)
    }
  }

  /** Resolves once no answer or document write is in flight. A sync is not waited for: it is safe to cut short. */
  async idle(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.allSettled([...this.inFlight])
  }

  /** Whether anything written here has not reached the server: answers, completed days, document patches. */
  async hasUnsynced(): Promise<boolean> {
    const driver = this.db.driver
    return (await unpushedEvents(driver)).length > 0 || (await pendingDayComplete(driver)).length > 0 || (await pendingDocumentWrites(driver)).length > 0
  }
```

5. Replace `answer`, `updateSettings`, `setFlag`, `report`, `attachUser` and `close` with:

```ts
  /**
   * Records one answer, persists any new unit unlock, and records the completed
   * day when it first becomes complete. Once the event is stored this never
   * throws: a caller that saw an error would answer again and record the word
   * twice. Unlocks and the completed day are recomputed at every answer, so a
   * write that fails here is made at the next one.
   */
  answer(input: AnswerInput): Promise<AnswerResult> {
    return this.guarded(async () => {
      const event = await appendAnswer(this.db, this.env, this.learner, input)
      let dayCompleted = false
      let unlocked: string[] = []
      try {
        const before = this.context()
        if (before) {
          const owed = newUnlocks(before)
          if (owed.length > 0) {
            await this.db.transaction((tx) => addUnlocks(tx, owed))
            this.unlocked = new Set([...this.unlocked, ...owed])
            unlocked = owed
          }
          const ctx = this.context()!
          dayCompleted = isDayComplete(dayCompleteInput(ctx, sessionPlan(ctx))) && (await recordDayComplete(this.db, this.learner, today(ctx), this.env.now()))
        }
      } catch {
        // The answer itself is saved; what failed is owed and is made at the next answer.
      }
      this.refresh()
      return { event, dayCompleted, unlocked }
    })
  }

  updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    return this.guarded(async () => {
      this.settings = await this.db.transaction((tx) => patchSettings(tx, patch))
      this.refresh()
      return this.settings
    })
  }

  setFlag(wordId: WordId, flag: WordFlag | null): Promise<void> {
    return this.guarded(async () => {
      await this.db.transaction((tx) => setFlag(tx, wordId, flag))
      this.flags = await readFlags(this.db.driver)
      this.refresh()
    })
  }

  /** Files a content report; it syncs like any document (spec §8.10). */
  report(input: ContentReportInput): Promise<string> {
    return this.guarded(() => this.db.transaction((tx) => addContentReport(tx, this.env, input)))
  }

  /**
   * Binds this database to an account (demo carry-over, spec §8.6). Every row
   * stays. With a transport, the Client syncs through it from now on: the
   * demo's answers then reach the account from the demo's own device.
   */
  attachUser(userId: string, transport?: SyncTransport): Promise<void> {
    return this.guarded(async () => {
      await this.db.transaction((tx) => setUserId(tx, userId))
      this.userId = userId
      if (transport && !this.engine) {
        this.engine = new SyncEngine({ db: this.db, env: this.env, learner: this.learner, transport })
        this.engine.onStatus = () => this.refresh()
      }
      this.refresh()
    })
  }

  /** Clips of one level's live words, for the whole-level download (spec §9.3); empty before a pack is active. */
  levelClips(level: CefrLevel): AudioClip[] {
    const ctx = this.context()
    return ctx ? levelClips(ctx, level) : []
  }

  /**
   * Refuses new work, waits for what is in flight, then closes the database.
   * Resolves only once the driver has let go of the file (spec §9.1: the tab
   * that takes over may open it the moment this resolves).
   */
  async close(): Promise<void> {
    this.closing = true
    await this.idle()
    await this.db.close()
  }
```

- [ ] **Step 5: Run the Client tests**

Run: `pnpm --filter @wordado/client-data exec vitest run src/client.test.ts`
Expected: PASS. If "records an answer, unlocks, completes the day" now fails, the new `answer` has changed the order of the unlock and the completed day; it must stay unlocks first, then the day.

- [ ] **Step 6: Write the failing run tests**

Append to `client-data/src/run.test.ts`, which already imports `Grade`, `ITEM_SETTLE_MS`, `StudyRun`, `openSampleClient`, `testEnv` and has the `options()` helper:

```ts
describe('runs follow the settings and the learner (spec §7.4, §11.1)', () => {
  it('grades a slow correct answer as Good when latency grading is off', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ latencyGrading: false })
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    env.advance(60_000)
    await run.choose(item.mode === 'flashcard' ? 0 : item.answerIndex)
    expect(run.snapshot.feedback).toMatchObject({ correct: true, grade: Grade.Good })
  })

  it('still grades a slow correct answer as Hard by default', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    env.advance(60_000)
    await run.choose(item.mode === 'flashcard' ? 0 : item.answerIndex)
    expect(run.snapshot.feedback).toMatchObject({ correct: true, grade: Grade.Hard })
  })

  it('sets the word on screen aside, records no answer for it, and moves on', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const first = run.snapshot.item!.wordId
    await run.setAside('known')
    expect(client.snapshot.flags.get(first)).toBe('known')
    expect(client.snapshot.states.has(first)).toBe(false)
    expect(run.snapshot.item!.wordId).not.toBe(first)
    expect(run.snapshot).toMatchObject({ answered: 0, setAside: 1, phase: 'prompt' })
    expect(client.snapshot.plan!.newWords).not.toContain(first)
  })

  it('sets a practice word aside and drops it from the practice queue', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    for (const wordId of client.snapshot.plan!.newWords.slice(0, 3)) {
      await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    }
    // An hour on: introduced today, not due, so practice may serve them.
    env.advance(3_600_000)
    const run = await StudyRun.start(client, env, options({ kind: 'practice', mode: 'flashcard' }))
    const first = run.snapshot.item!.wordId
    await run.setAside('suspended')
    expect(client.snapshot.flags.get(first)).toBe('suspended')
    expect(run.snapshot.item?.wordId ?? null).not.toBe(first)
  })

  it('ignores a rating that lands within the settle time of the reveal (a double tap on Show answer)', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    env.advance(2_000)
    run.reveal()
    await run.rate(Grade.Good)
    expect(run.snapshot).toMatchObject({ phase: 'revealed', answered: 0 })
    env.advance(ITEM_SETTLE_MS)
    await run.rate(Grade.Good)
    expect(run.snapshot.answered).toBe(1)
  })
})
```

- [ ] **Step 7: Run them to see them fail**

Run: `pnpm --filter @wordado/client-data exec vitest run src/run.test.ts`
Expected: FAIL. `setAside` does not exist. The latency-off test gets `Hard`, because the run hard-codes latency grading. The double-tap test records the rating, because the guard counts from the item.

- [ ] **Step 8: Change the run**

In `client-data/src/run.ts`:

1. Add `type WordFlag` to the `@wordado/core` import.
2. Add `readonly setAside: number` to `RunSnapshot`, after `answered`, with the comment `/** Words set aside ("I know this", "Not now") in this run (spec §7.4). */`, and `setAside: 0,` to `INITIAL` after `answered: 0,`.
3. Add a field after `feedbackAt`:

```ts
  /** When the current flashcard's answer was revealed: `rate()`'s own settle reference. */
  private revealedAt: number | null = null
```

4. In `advance()`, beside `this.feedbackAt = null`, add `this.revealedAt = null`.
5. In `reveal()`, replace `this.set({ phase: 'revealed' })` with:

```ts
    this.revealedAt = this.env.now()
    this.set({ phase: 'revealed' })
```

6. Replace `rate` with:

```ts
  /**
   * A flashcard's self-rating, passed through (spec §7.3). Ignored within the
   * settle time of the reveal, so a double tap on "Show answer" cannot land on
   * a rating. Moves straight on, unless `finish` ended the run meanwhile.
   */
  async rate(rating: Grade): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'revealed' || item?.mode !== 'flashcard') return
    if (!this.settled(this.revealedAt ?? this.shownAt)) return
    const grade = gradeAnswer('flashcard', { kind: 'self_rated', rating }, { latencyGrading: this.latencyGrading() })
    if ((await this.record(item, grade)) && !this.finished) this.advance()
  }
```

7. In `choose`, replace `{ latencyGrading: true }` with `{ latencyGrading: this.latencyGrading() }`.
8. Add after `latency()`:

```ts
  /** The learner's setting (spec §11.1), read per answer so a change mid-run applies at once. */
  private latencyGrading(): boolean {
    return this.client.snapshot.settings.latencyGrading
  }
```

9. Add after `next()`:

```ts
  /**
   * "I know this" or "Not now" for the word on screen (spec §7.4): flags it,
   * records no answer, and moves on. The flag leaves the word out of every
   * later plan and practice run until the learner brings it back.
   */
  async setAside(flag: WordFlag): Promise<void> {
    const { phase, item } = this.snapshot
    if (!item || (phase !== 'prompt' && phase !== 'revealed')) return
    if (this.busy) return
    this.busy = true
    try {
      await this.client.setFlag(item.wordId, flag)
    } catch (err) {
      this.set({ error: messageOf(err) })
      return
    } finally {
      this.busy = false
    }
    this.skipped.add(item.wordId)
    this.practiceQueue = this.practiceQueue.filter((w) => w !== item.wordId)
    this.set({ setAside: this.snapshot.setAside + 1, error: null })
    if (!this.finished) this.advance()
  }
```

- [ ] **Step 9: Run the run tests**

Run: `pnpm --filter @wordado/client-data exec vitest run src/run.test.ts`
Expected: PASS, including 6a's existing settle tests.

- [ ] **Step 10: Write the failing carry-over rule test**

Append to `client-data/src/client.test.ts`, which already has `openClient(env, server)`, `answer` and `FakeServer`; add `accountIsEmpty` and `UpgradeRequiredError` to its imports from `./sync`:

```ts
describe('accountIsEmpty (spec §8.6)', () => {
  it('is true for an account with nothing the learner wrote, and false once it has', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    expect(await accountIsEmpty(server, 'demo-device')).toBe(true)
    const other = await openClient(env, server)
    await other.answer(answer('c:hello-1'))
    await other.sync()
    expect(await accountIsEmpty(server, 'demo-device')).toBe(false)
  })

  it('counts a settings document as progress, but not a server-owned one', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    // The fake keys documents `${type}/${key}`, as its own push does.
    server.documents.set('entitlement/', {
      type: 'entitlement', key: '', class: 'server_owned', version: 1,
      fields: { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } },
      fieldVersions: {}, deleted: false, staleAfter: null,
    })
    expect(await accountIsEmpty(server, 'demo-device')).toBe(true)
    const other = await openClient(env, server)
    await other.updateSettings({ newWordLimit: 3 })
    await other.sync()
    expect(await accountIsEmpty(server, 'demo-device')).toBe(false)
  })

  it('throws UpgradeRequiredError when the server refuses this build', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now, minProtocolVersion: 99 })
    await expect(accountIsEmpty(server, 'demo-device')).rejects.toBeInstanceOf(UpgradeRequiredError)
  })
})
```

- [ ] **Step 11: Run it to see it fail**

Run: `pnpm --filter @wordado/client-data exec vitest run src/client.test.ts`
Expected: FAIL — `accountIsEmpty` is not exported.

- [ ] **Step 12: Add the rule**

Append to `client-data/src/sync.ts`:

```ts
/** The server refused this build (spec §4.3): nothing can be synced until the app is updated. */
export class UpgradeRequiredError extends Error {
  constructor() {
    super('This version of the app is too old to sync')
    this.name = 'UpgradeRequiredError'
  }
}

/**
 * Whether an account holds no progress (spec §8.6): no review state, no
 * completed day, no document the learner wrote. Server-owned documents (the
 * entitlement every account gets) do not count. Only such an account takes a
 * demo; any other would have to be merged, which the design rules out. One
 * pull, from the asking device, changing nothing.
 */
export async function accountIsEmpty(transport: SyncTransport, deviceId: string): Promise<boolean> {
  const response = await transport.pull({ protocolVersion: SYNC_PROTOCOL_VERSION, deviceId, documentsSince: 0 })
  if (response.status === 'upgrade_required') throw new UpgradeRequiredError()
  return response.reviewStates.length === 0 && response.dayComplete.length === 0 && response.documents.every((d) => d.class === 'server_owned')
}
```

- [ ] **Step 13: Run the package and the whole repository**

Run: `pnpm --filter @wordado/client-data test`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS. `web/` still compiles, because `attachUser`'s transport is optional and `RunSnapshot.setAside` is only added.

- [ ] **Step 14: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): a Client that drains before closing, runs that honour latency grading, set-aside words, accountIsEmpty"
```

---

### Task 3: `client-data`: the placement test's state machine

Spec §7.2's placement test is about 30 words that binary-search the bands and place the learner. It is a run like `StudyRun`: which word comes next and what it means are rules, so they live in `client-data`, where the mobile client will reuse them, and the web view only renders a snapshot.

**Files:**
- Create: `client-data/src/placement.ts`
- Modify: `client-data/src/testing/sample.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/placement.test.ts`

**Interfaces:**
- Consumes:
  - `placementProgress`, `nextPlacementWords`, `placementPool`, `placementLevels` and `MIN_PLACEMENT_LEVELS` (Task 1).
  - `buildItem` and `ChoiceItem` (6a), and `ITEM_SETTLE_MS` from `run.ts`.
- Produces:
  - `interface PlacementSource { readonly corpus: Corpus | null; setLevel(level: CefrLevel): Promise<void> }`, and `placementSource(client: Client): PlacementSource`.
  - `type PlacementPhase = 'unavailable' | 'question' | 'result' | 'accepted'`.
  - `interface PlacementSnapshot { phase; item: ChoiceItem | null; asked: number; levels: readonly CefrLevel[]; result: CefrLevel | null; error: string | null }`.
  - `class PlacementRun { static start(source, env): PlacementRun; store; snapshot; choose(index): void; dontKnow(): void; accept(): Promise<void> }`.
  - `placementAvailable(corpus: Corpus | null): boolean`.
  - Test-only: `leveledCorpus(corpus, levels)` in `testing/sample.ts`.

- [ ] **Step 1: Add the test corpus helper**

Append to `client-data/src/testing/sample.ts` (add `type CefrLevel` and `type Corpus` to its `@wordado/core` import):

```ts
/**
 * The sample with its entries spread across `levels` in equal runs, in the
 * order the corpus lists them. The sample is all A1; the placement test needs
 * bands, and nothing else about the entries changes.
 */
export function leveledCorpus(corpus: Corpus, levels: readonly CefrLevel[]): Corpus {
  const entries = [...corpus.entries.values()]
  const per = Math.ceil(entries.length / levels.length)
  return {
    ...corpus,
    entries: new Map(entries.map((entry, i) => [entry.entryId, { ...entry, level: levels[Math.floor(i / per)]! }])),
  }
}
```

- [ ] **Step 2: Write the failing tests**

Create `client-data/src/placement.test.ts`:

```ts
import { PLACEMENT_PROBE_SIZE, type CefrLevel, type Corpus } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { PlacementRun, placementAvailable, type PlacementSource } from './placement'
import { ITEM_SETTLE_MS } from './run'
import { leveledCorpus, openSampleClient } from './testing/sample'
import { testEnv, type TestEnv } from './testing/testEnv'

async function source(levels: readonly CefrLevel[]): Promise<PlacementSource & { chosen: CefrLevel[] }> {
  const client = await openSampleClient()
  const corpus: Corpus = leveledCorpus(client.snapshot.corpus!, levels)
  const chosen: CefrLevel[] = []
  return {
    corpus,
    chosen,
    setLevel: async (level) => {
      chosen.push(level)
    },
  }
}

/** Answers the question on screen, right or wrong, past the settle time. */
function answer(run: PlacementRun, env: TestEnv, right: boolean): void {
  env.advance(ITEM_SETTLE_MS + 500)
  const item = run.snapshot.item!
  if (right) run.choose(item.answerIndex)
  else run.dontKnow()
}

describe('PlacementRun (spec §7.2)', () => {
  it('is unavailable on the A1-only sample, so the demo does not offer it', async () => {
    const client = await openSampleClient()
    expect(placementAvailable(client.snapshot.corpus)).toBe(false)
    expect(placementAvailable(null)).toBe(false)
    const run = PlacementRun.start({ corpus: client.snapshot.corpus, setLevel: async () => undefined }, testEnv())
    expect(run.snapshot).toMatchObject({ phase: 'unavailable', item: null })
  })

  it('asks multiple-choice questions from the middle band first', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    expect(placementAvailable(src.corpus)).toBe(true)
    const run = PlacementRun.start(src, testEnv())
    expect(run.snapshot.phase).toBe('question')
    expect(run.snapshot.levels).toEqual(['A1', 'A2', 'B1'])
    expect(run.snapshot.item?.mode).toBe('multiple_choice')
    expect(run.snapshot.item?.entry.level).toBe('A2')
    expect(run.snapshot.item?.direction).toBe('en_to_l1')
  })

  it('places a learner who knows everything at the highest band, and records nothing until accepted', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, true)
    expect(run.snapshot).toMatchObject({ phase: 'result', result: 'B1' })
    expect(run.snapshot.asked).toBeLessThanOrEqual(2 * PLACEMENT_PROBE_SIZE)
    expect(src.chosen).toEqual([])
    await run.accept()
    expect(src.chosen).toEqual(['B1'])
    expect(run.snapshot.phase).toBe('accepted')
  })

  it('places a learner who knows nothing at A1', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, false)
    expect(run.snapshot.result).toBe('A1')
  })

  it('ignores an answer within the settle time, and one after the test is decided', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    run.choose(run.snapshot.item!.answerIndex)
    expect(run.snapshot.asked).toBe(0)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, false)
    const asked = run.snapshot.asked
    run.dontKnow()
    expect(run.snapshot.asked).toBe(asked)
  })

  it('never asks the same word twice', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start(src, env)
    const seen = new Set<string>()
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) {
      const id = run.snapshot.item!.wordId
      expect(seen.has(id)).toBe(false)
      seen.add(id)
      answer(run, env, i % 2 === 0)
    }
  })

  it('shows the error and stays on the result when saving the level fails', async () => {
    const src = await source(['A1', 'A2', 'B1'])
    const env = testEnv()
    const run = PlacementRun.start({ ...src, setLevel: async () => Promise.reject(new Error('disk full')) }, env)
    for (let i = 0; i < 40 && run.snapshot.phase === 'question'; i += 1) answer(run, env, true)
    await run.accept()
    expect(run.snapshot).toMatchObject({ phase: 'result', error: 'disk full' })
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/client-data exec vitest run src/placement.test.ts`
Expected: FAIL — `./placement` does not exist.

- [ ] **Step 4: Write the run**

Create `client-data/src/placement.ts`:

```ts
import {
  buildItem,
  MIN_PLACEMENT_LEVELS,
  nextPlacementWords,
  placementLevels,
  placementPool,
  placementProgress,
  type CefrLevel,
  type ChoiceItem,
  type Corpus,
  type PlacementAnswer,
  type WordId,
} from '@wordado/core'
import type { Client } from './client'
import { ITEM_SETTLE_MS, type RunEnv } from './run'
import { createStore, type Store } from './store'

/** What a placement test needs: the words, and where the result goes. */
export interface PlacementSource {
  readonly corpus: Corpus | null
  setLevel(level: CefrLevel): Promise<void>
}

/** A Client as a placement source: the result becomes the declared level (spec §7.2). */
export function placementSource(client: Client): PlacementSource {
  return {
    corpus: client.snapshot.corpus,
    setLevel: async (level) => {
      await client.updateSettings({ declaredLevel: level })
    },
  }
}

/** Whether the corpus has the bands a test needs (spec §7.2). The A1-only sample has not. */
export function placementAvailable(corpus: Corpus | null): boolean {
  return corpus !== null && placementLevels(placementPool(corpus.entries.values())).length >= MIN_PLACEMENT_LEVELS
}

/** unavailable → question → … → result → (accept) accepted. */
export type PlacementPhase = 'unavailable' | 'question' | 'result' | 'accepted'

export interface PlacementSnapshot {
  readonly phase: PlacementPhase
  readonly item: ChoiceItem | null
  readonly asked: number
  /** The bands this test searches. */
  readonly levels: readonly CefrLevel[]
  readonly result: CefrLevel | null
  readonly error: string | null
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * The optional placement test (spec §7.2): multiple-choice questions, drawn
 * by `core`'s binary search over the bands the corpus ships, and a result the
 * learner accepts or leaves. Answers are not review events: the test
 * measures, it does not schedule, so nothing is written until `accept`.
 */
export class PlacementRun {
  readonly store: Store<PlacementSnapshot>
  private readonly answers: PlacementAnswer[] = []
  /** Words that could not be asked as a choice (too few distractors): never offered again. */
  private readonly unusable = new Set<WordId>()
  private readonly pool: Map<CefrLevel, WordId[]>
  private readonly levels: CefrLevel[]
  private shownAt = 0

  private constructor(
    private readonly source: PlacementSource,
    private readonly env: RunEnv,
  ) {
    const corpus = source.corpus
    this.pool = corpus ? placementPool(corpus.entries.values()) : new Map()
    this.levels = placementLevels(this.pool)
    this.store = createStore<PlacementSnapshot>({ phase: 'unavailable', item: null, asked: 0, levels: this.levels, result: null, error: null })
  }

  static start(source: PlacementSource, env: RunEnv): PlacementRun {
    const run = new PlacementRun(source, env)
    if (run.levels.length >= MIN_PLACEMENT_LEVELS) run.advance()
    return run
  }

  get snapshot(): PlacementSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<PlacementSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  private advance(): void {
    const corpus = this.source.corpus!
    for (;;) {
      const progress = placementProgress(this.answers, this.levels)
      if (progress.probing === null) {
        this.set({ phase: 'result', item: null, result: progress.result })
        return
      }
      const pool = new Map([...this.pool].map(([level, ids]) => [level, ids.filter((id) => !this.unusable.has(id))]))
      const wordId = nextPlacementWords(this.answers, pool, this.env.rng, this.levels)[0]
      if (wordId === undefined) {
        // The band ran out of askable words before its probe was decided: place the learner there.
        this.set({ phase: 'result', item: null, result: progress.probing })
        return
      }
      const item = buildItem(wordId, {
        corpus,
        states: new Map(),
        available: new Set(['multiple_choice']),
        preferred: 'multiple_choice',
        rng: this.env.rng,
      })
      if (item === null || item.mode !== 'multiple_choice') {
        this.unusable.add(wordId)
        continue
      }
      // A placement question always shows the English word: it asks what the learner can read.
      const shown: ChoiceItem = item.direction === 'en_to_l1' ? item : { ...item, direction: 'en_to_l1' }
      this.shownAt = this.env.now()
      this.set({ phase: 'question', item: shown })
      return
    }
  }

  private record(correct: boolean): void {
    const { phase, item } = this.snapshot
    if (phase !== 'question' || !item) return
    if (this.env.now() - this.shownAt < ITEM_SETTLE_MS) return
    this.answers.push({ wordId: item.wordId, level: item.entry.level, correct })
    this.set({ asked: this.answers.length })
    this.advance()
  }

  choose(index: number): void {
    const item = this.snapshot.item
    if (!item || !Number.isInteger(index) || index < 0 || index >= item.options.length) return
    this.record(index === item.answerIndex)
  }

  /** "I don't know": a wrong answer, without the guess that would make the result lucky. */
  dontKnow(): void {
    this.record(false)
  }

  /** Makes the result the declared level; units below it become assumed known (spec §7.2). Nothing is deleted. */
  async accept(): Promise<void> {
    const { phase, result } = this.snapshot
    if (phase !== 'result' || result === null) return
    try {
      await this.source.setLevel(result)
      this.set({ phase: 'accepted', error: null })
    } catch (err) {
      this.set({ error: messageOf(err) })
    }
  }
}
```

Append `export * from './placement'` to `client-data/src/index.ts`.

A `ChoiceItem` whose direction is `l1_to_en` has its options as English headwords. Forcing `en_to_l1` shows the headword and offers translations; both directions share the same `options` and `answerIndex`, and only the rendering differs.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @wordado/client-data exec vitest run src/placement.test.ts`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add client-data/src/placement.ts client-data/src/placement.test.ts client-data/src/testing/sample.ts client-data/src/index.ts
git commit -m "feat(client-data): the placement test's state machine"
```

---

### Task 4: `web`: the server's endpoints, the sync transport, the account record and the age gate

These are the pieces every account screen stands on. None of them renders anything.

- `httpApi` wraps plan 5's endpoints and Better Auth's with `fetch`, turning every failure into an `ApiError` (the server answered) or an `OfflineError` (it did not).
- `httpTransport` is `client-data`'s `SyncTransport`, reporting a 401 so the app can say the sign-in expired.
- `storage.ts` holds the one record of which account this device is signed in to.
- `ageGate.ts` and `countries.ts` are spec §11's age check.

**Files:**
- Create: `web/src/account/api.ts`, `web/src/account/transport.ts`, `web/src/account/storage.ts`, `web/src/account/ageGate.ts`, `web/src/account/countries.ts`
- Test: `web/src/account/api.test.ts`, `web/src/account/transport.test.ts`, `web/src/account/storage.test.ts`, `web/src/account/ageGate.test.ts`, `web/src/account/countries.test.ts`

**Interfaces:**
- Consumes: `SyncTransport`, `PushPage`, `PullRequest` (plan 4, `core`); `Fetch` from `web/src/content/packs.ts`.
- Produces:
  - From `api.ts`:
    - `class ApiError extends Error { readonly status: number; readonly code: string | null }`.
    - `class OfflineError extends Error`.
    - `interface Me { userId; email; country: string | null; createdAt: number }`.
    - `interface PushSubscriptionBody { endpoint; keys: { p256dh; auth }; reminderMinute; tzOffsetMin; language: 'bg' | 'en'; streakNudge }`.
    - `interface Api { sendCode(email); verifyCode(email, code); googleUrl(callbackUrl, errorCallbackUrl): Promise<string>; me(): Promise<Me | null>; requestCountry(): Promise<string | null>; setCountry(country: string | null); signOut(); deleteAccount(); pushPublicKey(): Promise<string | null>; putSubscription(body); deleteSubscription(endpoint) }`. Every method not given a return type returns `Promise<void>`.
    - `httpApi(fetch?: Fetch): Api`, and `EXPORT_URL = '/v1/export'`.
  - From `transport.ts`: `httpTransport(options?: { fetch?; onUnauthorized?; timeoutMs? }): SyncTransport`, `SYNC_REQUEST_TIMEOUT_MS`, `class SyncHttpError extends Error { readonly status: number }`, and `httpStatusOf(lastError: string | null): number | null`.
  - From `storage.ts`:
    - `DEMO_FILE = 'demo'`, `ACCOUNT_KEY = 'wordado.account'`, `SIGNIN_KEY = 'wordado.signin'`.
    - `interface AccountRecord { userId; email; carryOver?: boolean }`.
    - `interface AccountStorage { read(): AccountRecord | null; save(record): void; clear(): void }`, and `accountStorage(storage?)`.
    - `interface PendingSignIn { country: string | null }`, and `pendingSignIn(storage?)` with the same three methods.
    - `learnerFile(userId): string`.
    - `memoryStorage(): KeyValue`, and `browserStorage(kind): KeyValue`, which falls back to memory when the browser refuses storage.
  - From `ageGate.ts`: `CONSENT_AGE`, `UNKNOWN_COUNTRY_AGE = 16`, `OUTSIDE_EEA_AGE = 13`, `MIN_BIRTH_YEAR = 1900`, `consentAge(country)`, and `checkBirthYear(text, country, now): { status: 'ok' } | { status: 'invalid' } | { status: 'too-young'; age: number }`.
  - From `countries.ts`: `COUNTRY_CODES`, and `countryOptions(locale): { code; name }[]`.

- [ ] **Step 1: Write the failing API tests**

Create `web/src/account/api.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ApiError, httpApi, OfflineError } from './api'

interface Call {
  readonly url: string
  readonly init: RequestInit | undefined
}

/** A fetch that answers from a table of `METHOD path` → [status, body], and records every call. */
function fakeFetch(routes: Record<string, readonly [number, unknown]>) {
  const calls: Call[] = []
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init })
    const route = routes[`${init?.method ?? 'GET'} ${url}`]
    if (!route) throw new TypeError('Failed to fetch')
    const [status, body] = route
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }
  return { fetchFn, calls }
}

const bodyOf = (call: Call) => JSON.parse(String(call.init?.body))

describe('httpApi (plan 5 contract)', () => {
  it('asks for a sign-in code with the session cookie', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/email-otp/send-verification-otp': [200, { success: true }] })
    await httpApi(fetchFn).sendCode('ana@example.com')
    expect(bodyOf(calls[0]!)).toEqual({ email: 'ana@example.com', type: 'sign-in' })
    expect(calls[0]!.init?.credentials).toBe('include')
    expect(new Headers(calls[0]!.init?.headers).get('content-type')).toBe('application/json')
  })

  it("names the server's limit on codes, and Better Auth's error codes", async () => {
    const limited = fakeFetch({ 'POST /api/auth/email-otp/send-verification-otp': [429, { error: 'sign_in_email_limit' }] })
    await expect(httpApi(limited.fetchFn).sendCode('a@b.c')).rejects.toMatchObject({ status: 429, code: 'sign_in_email_limit' })
    const wrong = fakeFetch({ 'POST /api/auth/sign-in/email-otp': [400, { code: 'INVALID_OTP', message: 'Invalid OTP' }] })
    const err = await httpApi(wrong.fetchFn).verifyCode('a@b.c', '000000').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 400, code: 'INVALID_OTP' })
  })

  it('reports no answer at all as OfflineError', async () => {
    const { fetchFn } = fakeFetch({})
    await expect(httpApi(fetchFn).sendCode('a@b.c')).rejects.toBeInstanceOf(OfflineError)
  })

  it('reads the signed-in learner, and null without a session', async () => {
    const me = { userId: 'u1', email: 'ana@example.com', country: 'BG', createdAt: 1 }
    expect(await httpApi(fakeFetch({ 'GET /v1/me': [200, me] }).fetchFn).me()).toEqual(me)
    expect(await httpApi(fakeFetch({ 'GET /v1/me': [401, { error: 'unauthorized' }] }).fetchFn).me()).toBeNull()
  })

  it('starts Google sign-in without following the redirect, returning where to go', async () => {
    const { fetchFn, calls } = fakeFetch({ 'POST /api/auth/sign-in/social': [200, { url: 'https://accounts.google.com/o/oauth2/auth?x=1', redirect: true }] })
    const url = await httpApi(fetchFn).googleUrl('http://localhost/?signin=google', 'http://localhost/?signin=google-error')
    expect(url).toBe('https://accounts.google.com/o/oauth2/auth?x=1')
    expect(bodyOf(calls[0]!)).toEqual({
      provider: 'google',
      callbackURL: 'http://localhost/?signin=google',
      errorCallbackURL: 'http://localhost/?signin=google-error',
      disableRedirect: true,
    })
  })

  it('pre-fills the country, sets it, signs out, deletes with confirmation', async () => {
    const { fetchFn, calls } = fakeFetch({
      'GET /v1/country': [200, { country: 'BG' }],
      'POST /api/auth/update-user': [200, { status: true }],
      'POST /api/auth/sign-out': [200, { success: true }],
      'DELETE /v1/account': [200, { deleted: true }],
    })
    const api = httpApi(fetchFn)
    expect(await api.requestCountry()).toBe('BG')
    await api.setCountry('DE')
    await api.signOut()
    await api.deleteAccount()
    expect(bodyOf(calls[1]!)).toEqual({ country: 'DE' })
    expect(bodyOf(calls[3]!)).toEqual({ confirm: true })
  })

  it('treats reminders as unavailable when the server has no key', async () => {
    expect(await httpApi(fakeFetch({ 'GET /v1/push/public-key': [404, { error: 'not_configured' }] }).fetchFn).pushPublicKey()).toBeNull()
    expect(await httpApi(fakeFetch({ 'GET /v1/push/public-key': [200, { publicKey: 'BPk' }] }).fetchFn).pushPublicKey()).toBe('BPk')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/api.test.ts`
Expected: FAIL — `./api` does not exist.

- [ ] **Step 3: Write the API**

Create `web/src/account/api.ts`:

```ts
import type { Fetch } from '../content/packs'

/** The server answered, with something other than success. `code` is the body's `error` or Better Auth's `code`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`The server answered ${status}${code ? ` (${code})` : ''}`)
    this.name = 'ApiError'
  }
}

/** The request got no answer at all: offline, or the server is unreachable. */
export class OfflineError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'OfflineError'
  }
}

/** `GET /v1/me` (plan 5). */
export interface Me {
  readonly userId: string
  readonly email: string
  readonly country: string | null
  readonly createdAt: number
}

/** `PUT /v1/push/subscription` (plan 5, spec §8.11). */
export interface PushSubscriptionBody {
  readonly endpoint: string
  readonly keys: { readonly p256dh: string; readonly auth: string }
  /** Minute of the local day, 0–1439. */
  readonly reminderMinute: number
  /** Minutes to add to UTC, as on every event. */
  readonly tzOffsetMin: number
  readonly language: 'bg' | 'en'
  readonly streakNudge: boolean
}

/** Everything the app asks of the server beside sync (spec §8.6, §8.11, §11). */
export interface Api {
  sendCode(email: string): Promise<void>
  verifyCode(email: string, code: string): Promise<void>
  /** Where to send the browser for Google sign-in; the server redirects back to one of the two URLs. */
  googleUrl(callbackUrl: string, errorCallbackUrl: string): Promise<string>
  /** The signed-in learner, or null without a valid session. */
  me(): Promise<Me | null>
  /** The request's country as the host reads it, to pre-fill the age gate; null when unknown. */
  requestCountry(): Promise<string | null>
  setCountry(country: string | null): Promise<void>
  signOut(): Promise<void>
  deleteAccount(): Promise<void>
  /** The VAPID key, or null when this server sends no reminders. */
  pushPublicKey(): Promise<string | null>
  putSubscription(body: PushSubscriptionBody): Promise<void>
  deleteSubscription(endpoint: string): Promise<void>
}

/** The data export: a download the browser makes with the session cookie (spec §11). */
export const EXPORT_URL = '/v1/export'

const codeOf = (body: unknown): string | null => {
  if (typeof body !== 'object' || body === null) return null
  const { error, code } = body as { error?: unknown; code?: unknown }
  return typeof error === 'string' ? error : typeof code === 'string' ? code : null
}

/** The app's calls to its own origin: `/api/auth` (Better Auth) and `/v1` (plan 5), with the session cookie. */
export function httpApi(fetchFn: Fetch = (input, init) => fetch(input, init)): Api {
  async function call(method: string, path: string, body?: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await fetchFn(path, {
        method,
        credentials: 'include',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
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
    return parsed
  }

  const unauthorizedAsNull = async <T>(work: Promise<T>): Promise<T | null> => {
    try {
      return await work
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return null
      throw err
    }
  }

  return {
    sendCode: async (email) => {
      await call('POST', '/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' })
    },
    verifyCode: async (email, code) => {
      await call('POST', '/api/auth/sign-in/email-otp', { email, otp: code })
    },
    googleUrl: async (callbackUrl, errorCallbackUrl) => {
      const body = await call('POST', '/api/auth/sign-in/social', { provider: 'google', callbackURL: callbackUrl, errorCallbackURL: errorCallbackUrl, disableRedirect: true })
      const url = (body as { url?: unknown } | null)?.url
      if (typeof url !== 'string') throw new ApiError(502, 'no_redirect')
      return url
    },
    me: () => unauthorizedAsNull(call('GET', '/v1/me') as Promise<Me>),
    requestCountry: async () => {
      const country = ((await call('GET', '/v1/country')) as { country?: unknown } | null)?.country
      return typeof country === 'string' ? country : null
    },
    setCountry: async (country) => {
      await call('POST', '/api/auth/update-user', { country })
    },
    signOut: async () => {
      await call('POST', '/api/auth/sign-out', {})
    },
    deleteAccount: async () => {
      await call('DELETE', '/v1/account', { confirm: true })
    },
    pushPublicKey: async () => {
      try {
        const key = ((await call('GET', '/v1/push/public-key')) as { publicKey?: unknown } | null)?.publicKey
        return typeof key === 'string' ? key : null
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null
        throw err
      }
    },
    putSubscription: async (body) => {
      await call('PUT', '/v1/push/subscription', body)
    },
    deleteSubscription: async (endpoint) => {
      await call('DELETE', '/v1/push/subscription', { endpoint })
    },
  }
}
```

- [ ] **Step 4: Run it**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/api.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing transport tests**

Create `web/src/account/transport.test.ts`:

```ts
import { SYNC_PROTOCOL_VERSION, type PullRequest } from '@wordado/core'
import { describe, expect, it, vi } from 'vitest'
import { httpStatusOf, httpTransport, SyncHttpError } from './transport'

const pull: PullRequest = { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: 'd1', documentsSince: 0 }

const answering = (status: number, body: unknown) =>
  vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

describe('httpTransport (plan 5 contract)', () => {
  it('posts JSON with the session cookie and returns the body', async () => {
    const fetchFn = answering(200, { status: 'upgrade_required', minProtocolVersion: 2 })
    const response = await httpTransport({ fetch: fetchFn }).pull(pull)
    expect(response).toEqual({ status: 'upgrade_required', minProtocolVersion: 2 })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('/v1/sync/pull')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('include')
    expect(JSON.parse(String(init?.body))).toEqual(pull)
    expect(init?.signal).toBeInstanceOf(AbortSignal)
  })

  it('throws on any other status, and reports a 401 as an expired sign-in', async () => {
    const onUnauthorized = vi.fn()
    const expired = httpTransport({ fetch: answering(401, { error: 'unauthorized' }), onUnauthorized })
    await expect(expired.pull(pull)).rejects.toMatchObject({ status: 401 })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    const malformed = httpTransport({ fetch: answering(400, { error: 'invalid' }), onUnauthorized })
    await expect(malformed.pull(pull)).rejects.toBeInstanceOf(SyncHttpError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('names the status in the message, so the sync status can read it back', () => {
    expect(new SyncHttpError(400).message).toBe('HTTP 400')
    expect(httpStatusOf('HTTP 400')).toBe(400)
    expect(httpStatusOf('Failed to fetch')).toBeNull()
    expect(httpStatusOf(null)).toBeNull()
  })
})
```

- [ ] **Step 6: Run it to see it fail, then write the transport**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/transport.test.ts`
Expected: FAIL — `./transport` does not exist.

Create `web/src/account/transport.ts`:

```ts
import type { SyncTransport } from '@wordado/client-data'
import type { PullRequest, PullResponse, PushPage, PushResponse } from '@wordado/core'
import type { Fetch } from '../content/packs'

/** One sync request's limit: a hung request must not hold the outbox or a hand-over forever. Tuning (§15). */
export const SYNC_REQUEST_TIMEOUT_MS = 30_000

/** A sync request the server answered with anything but 200. The message is what `SyncStatus.lastError` keeps. */
export class SyncHttpError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status}`)
    this.name = 'SyncHttpError'
  }
}

/** The status a sync failure carried, read back from `SyncStatus.lastError`; null for a network failure. */
export function httpStatusOf(lastError: string | null): number | null {
  const match = lastError === null ? null : /^HTTP (\d{3})$/.exec(lastError)
  return match ? Number(match[1]) : null
}

export interface TransportOptions {
  readonly fetch?: Fetch
  /** Called on a 401: the session has expired or was signed out elsewhere (spec §8.6). */
  readonly onUnauthorized?: () => void
  readonly timeoutMs?: number
}

/**
 * `client-data`'s transport on the web (plan 5 contract): two POSTs with the
 * session cookie. Anything but a 200 throws, and the sync engine treats every
 * throw as retryable; `upgrade_required` arrives inside a 200.
 */
export function httpTransport(options: TransportOptions = {}): SyncTransport {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init))
  const timeoutMs = options.timeoutMs ?? SYNC_REQUEST_TIMEOUT_MS
  async function post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetchFn(path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) options.onUnauthorized?.()
    if (response.status !== 200) throw new SyncHttpError(response.status)
    return (await response.json()) as T
  }
  return {
    push: (page: PushPage) => post<PushResponse>('/v1/sync/push', page),
    pull: (request: PullRequest) => post<PullResponse>('/v1/sync/pull', request),
  }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 7: Write the failing storage, age-gate and country tests**

Create `web/src/account/storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage, pendingSignIn } from './storage'

describe('the account record', () => {
  it('round-trips, and clears', () => {
    const store = accountStorage(memoryStorage())
    expect(store.read()).toBeNull()
    store.save({ userId: 'u1', email: 'ana@example.com' })
    expect(store.read()).toEqual({ userId: 'u1', email: 'ana@example.com' })
    store.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    expect(store.read()?.carryOver).toBe(true)
    store.clear()
    expect(store.read()).toBeNull()
  })

  it('reads a damaged record as signed out rather than crashing', () => {
    const raw = memoryStorage()
    raw.setItem('wordado.account', '{not json')
    expect(accountStorage(raw).read()).toBeNull()
    raw.setItem('wordado.account', JSON.stringify({ userId: 3 }))
    expect(accountStorage(raw).read()).toBeNull()
  })

  it('keeps working when the browser refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
      removeItem: () => {
        throw new DOMException('denied', 'SecurityError')
      },
    }
    const store = accountStorage(refusing)
    expect(store.read()).toBeNull()
    expect(() => store.save({ userId: 'u1', email: 'a@b.c' })).not.toThrow()
  })
})

describe('the pending sign-in', () => {
  it('carries the age gate’s country across a redirect', () => {
    const pending = pendingSignIn(memoryStorage())
    pending.save({ country: 'BG' })
    expect(pending.read()).toEqual({ country: 'BG' })
    pending.clear()
    expect(pending.read()).toBeNull()
  })
})

describe('file names', () => {
  it('gives each account its own file, safe as a file and database name', () => {
    expect(DEMO_FILE).toBe('demo')
    expect(learnerFile('AbC123')).toBe('user-AbC123')
    expect(learnerFile('a/b..c d')).toBe('user-a_b__c_d')
    expect(learnerFile('x'.repeat(200))).toHaveLength(69)
  })
})
```

Create `web/src/account/ageGate.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { checkBirthYear, consentAge, OUTSIDE_EEA_AGE, UNKNOWN_COUNTRY_AGE } from './ageGate'

const JUNE_2026 = new Date(2026, 5, 15).getTime()

describe('the age gate (spec §11)', () => {
  it('uses the member state’s age in the EEA, 16 when unknown, 13 elsewhere', () => {
    expect(consentAge('DE')).toBe(16)
    expect(consentAge('FR')).toBe(15)
    expect(consentAge('BG')).toBe(14)
    expect(consentAge('ES')).toBe(14)
    expect(consentAge('NO')).toBe(13)
    expect(consentAge(null)).toBe(UNKNOWN_COUNTRY_AGE)
    expect(consentAge('US')).toBe(OUTSIDE_EEA_AGE)
    expect(consentAge('GB')).toBe(13)
  })

  it('takes the youngest age a birth year allows', () => {
    // Born 2010: 15 or 16 in 2026. Germany needs 16, so the youngest possible age, 15, is turned away.
    expect(checkBirthYear('2010', 'DE', JUNE_2026)).toEqual({ status: 'too-young', age: 16 })
    expect(checkBirthYear('2009', 'DE', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2011', 'BG', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2012', 'BG', JUNE_2026)).toEqual({ status: 'too-young', age: 14 })
    expect(checkBirthYear('2012', 'US', JUNE_2026)).toEqual({ status: 'ok' })
    expect(checkBirthYear('2012', null, JUNE_2026)).toEqual({ status: 'too-young', age: 16 })
  })

  it('refuses a year that is not a plausible four-digit birth year', () => {
    for (const text of ['', '20', '19x0', '2027', '1899', '2026.5', ' 1990 1']) {
      expect(checkBirthYear(text, 'BG', JUNE_2026)).toEqual({ status: 'invalid' })
    }
    expect(checkBirthYear(' 1990 ', 'BG', JUNE_2026)).toEqual({ status: 'ok' })
  })
})
```

Create `web/src/account/countries.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CONSENT_AGE } from './ageGate'
import { COUNTRY_CODES, countryOptions } from './countries'

describe('countries', () => {
  it('lists every ISO 3166-1 alpha-2 code once', () => {
    expect(COUNTRY_CODES).toHaveLength(249)
    expect(new Set(COUNTRY_CODES).size).toBe(249)
    for (const code of COUNTRY_CODES) expect(code).toMatch(/^[A-Z]{2}$/)
    for (const code of Object.keys(CONSENT_AGE)) expect(COUNTRY_CODES).toContain(code)
  })

  it('names them in the interface language, in that language’s order', () => {
    const bg = countryOptions('bg')
    expect(bg.find((c) => c.code === 'BG')?.name).toBe('България')
    const en = countryOptions('en')
    expect(en.find((c) => c.code === 'DE')?.name).toBe('Germany')
    const names = en.map((c) => c.name)
    expect(names).toEqual([...names].sort(new Intl.Collator('en').compare))
  })
})
```

- [ ] **Step 8: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account`
Expected: FAIL — `storage`, `ageGate` and `countries` do not exist.

- [ ] **Step 9: Write the account record**

Create `web/src/account/storage.ts`:

```ts
/** The demo's database file (6a decision of 2026-09-24). */
export const DEMO_FILE = 'demo'
/** Which account this device is signed in to: the one record that decides which file opens. */
export const ACCOUNT_KEY = 'wordado.account'
/** The age gate's country, carried across the Google redirect in this tab only. */
export const SIGNIN_KEY = 'wordado.signin'

export type KeyValue = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface AccountRecord {
  readonly userId: string
  readonly email: string
  /**
   * The demo was attached to this account but not every answer reached the
   * server yet: `Boot` pushes it before opening the learner's file (spec §8.6).
   */
  readonly carryOver?: boolean
}

export interface AccountStorage {
  read(): AccountRecord | null
  save(record: AccountRecord): void
  clear(): void
}

/** Storage that lasts as long as the page, for a browser that refuses the real thing. */
export function memoryStorage(): KeyValue {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value)
    },
    removeItem: (key) => {
      values.delete(key)
    },
  }
}

/** A key of `storage` holding JSON; a refused or damaged value reads as absent. */
function jsonKey<T>(storage: KeyValue, key: string, valid: (value: unknown) => value is T) {
  return {
    read(): T | null {
      try {
        const raw = storage.getItem(key)
        if (raw === null) return null
        const value: unknown = JSON.parse(raw)
        return valid(value) ? value : null
      } catch {
        return null
      }
    },
    save(value: T): void {
      try {
        storage.setItem(key, JSON.stringify(value))
      } catch {
        // A private window may refuse storage: the sign-in then lasts for this visit.
      }
    },
    clear(): void {
      try {
        storage.removeItem(key)
      } catch {
        // Nothing was stored.
      }
    },
  }
}

const isRecord = (v: unknown): v is AccountRecord =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as AccountRecord).userId === 'string' &&
  typeof (v as AccountRecord).email === 'string' &&
  ['boolean', 'undefined'].includes(typeof (v as AccountRecord).carryOver)

/** The browser's storage of that kind, or page-lifetime storage when the browser refuses it. */
export function browserStorage(kind: 'localStorage' | 'sessionStorage'): KeyValue {
  try {
    return window[kind]
  } catch {
    return memoryStorage()
  }
}

export function accountStorage(storage: KeyValue = browserStorage('localStorage')): AccountStorage {
  return jsonKey(storage, ACCOUNT_KEY, isRecord)
}

export interface PendingSignIn {
  readonly country: string | null
}

const isPending = (v: unknown): v is PendingSignIn =>
  typeof v === 'object' && v !== null && ((v as PendingSignIn).country === null || typeof (v as PendingSignIn).country === 'string')

export function pendingSignIn(storage: KeyValue = browserStorage('sessionStorage')) {
  return jsonKey(storage, SIGNIN_KEY, isPending)
}

/** A learner's own database file: a name safe for OPFS and IndexedDB whatever the server's id looks like. */
export function learnerFile(userId: string): string {
  return `user-${userId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64)}`
}
```

- [ ] **Step 10: Write the age gate and the country list**

Create `web/src/account/ageGate.ts`:

```ts
/**
 * The age of digital consent per EEA country: the member states' choices
 * under GDPR Article 8, with Iceland, Liechtenstein and Norway (spec §11).
 *
 * PROVISIONAL: spec §15's legal review of this table is still open. This
 * file is the one place to change it.
 */
export const CONSENT_AGE: Readonly<Record<string, number>> = {
  AT: 14, BE: 13, BG: 14, CY: 14, CZ: 15, DE: 16, DK: 13, EE: 13, ES: 14, FI: 13,
  FR: 15, GR: 15, HR: 16, HU: 16, IE: 16, IS: 13, IT: 14, LI: 16, LT: 14, LU: 16,
  LV: 13, MT: 13, NL: 16, NO: 13, PL: 16, PT: 13, RO: 16, SE: 13, SI: 15, SK: 16,
}

/** When the learner does not say where they live: the highest EEA age (spec §11). */
export const UNKNOWN_COUNTRY_AGE = 16
/** Outside the EEA (spec §11). */
export const OUTSIDE_EEA_AGE = 13
export const MIN_BIRTH_YEAR = 1900

export function consentAge(country: string | null): number {
  if (country === null) return UNKNOWN_COUNTRY_AGE
  return CONSENT_AGE[country] ?? OUTSIDE_EEA_AGE
}

export type BirthYearCheck = { readonly status: 'ok' } | { readonly status: 'invalid' } | { readonly status: 'too-young'; readonly age: number }

/**
 * Whether a learner who gives `text` as their birth year may sign up where
 * they live (spec §11). Only the year is asked, so the youngest age it
 * allows is used: born in 2010, a learner is 15 until their birthday in 2026.
 * The year is never stored.
 */
export function checkBirthYear(text: string, country: string | null, now: number): BirthYearCheck {
  const trimmed = text.trim()
  if (!/^\d{4}$/.test(trimmed)) return { status: 'invalid' }
  const year = Number(trimmed)
  const current = new Date(now).getFullYear()
  if (year < MIN_BIRTH_YEAR || year > current) return { status: 'invalid' }
  const age = consentAge(country)
  return current - year - 1 >= age ? { status: 'ok' } : { status: 'too-young', age }
}
```

Create `web/src/account/countries.ts`:

```ts
/** ISO 3166-1 alpha-2, every officially assigned code. Names come from `Intl.DisplayNames`, never a table. */
export const COUNTRY_CODES: readonly string[] = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW'
).split(' ')

export interface CountryOption {
  readonly code: string
  readonly name: string
}

/** The countries named in `locale` and sorted as that language sorts (spec §11.2). */
export function countryOptions(locale: string): CountryOption[] {
  const names = new Intl.DisplayNames([locale], { type: 'region' })
  const collator = new Intl.Collator(locale)
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) => collator.compare(a.name, b.name))
}
```

- [ ] **Step 11: Run the web suite and the repository**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account`
Expected: PASS. If Node's ICU names Bulgaria differently in `bg`, print `countryOptions('bg').find((c) => c.code === 'BG')` and use the name it gives. Node 24 ships full ICU and names it «България».

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add web/src/account
git commit -m "feat(web): the server's endpoints, the sync transport, the account record and the age gate"
```

---

### Task 5: `web`: deleting a database file, and proving the hand-over contracts of the storage layer

Leaving the demo, finishing a carry-over, signing out and deleting the account all delete a file. This task proves three things in a real browser:

- Deleting a file leaves nothing behind, on OPFS or on IndexedDB, and touches no other file.
- A closed driver has let go of its file by the time `close()` resolves (6a contract).
- The demo and a learner's file can be open at once during a carry-over.

**Files:**
- Create: `web/src/storage/erase.ts`
- Test: `web/src/storage/erase.browser.test.ts`, `web/src/storage/workerDriver.browser.test.ts` (modify)

**Interfaces:**
- Consumes: `openWorkerDriver` (6a), `isUnsupportedError` (6a, `storage/open.ts`).
- Produces: `deleteDatabase(file: string): Promise<void>`, which is safe on a file that does not exist and must run with the file closed.

- [ ] **Step 1: Write the failing browser tests**

Create `web/src/storage/erase.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deleteDatabase } from './erase'
import { openWorkerDriver } from './workerDriver'

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

async function write(file: string, backend: 'opfs' | 'idb', value: string): Promise<void> {
  const { driver } = await openWorkerDriver(file, [backend])
  await driver.exec('CREATE TABLE t (v TEXT)')
  await driver.run('INSERT INTO t VALUES (?)', [value])
  await driver.close()
}

async function tables(file: string, backend: 'opfs' | 'idb'): Promise<unknown[]> {
  const { driver } = await openWorkerDriver(file, [backend])
  const rows = await driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
  await driver.close()
  return rows.map((r) => r.name)
}

describe('deleteDatabase (spec §8.6: leaving the demo deletes it)', () => {
  for (const backend of ['opfs', 'idb'] as const) {
    it(`leaves nothing of the file on ${backend}, and nothing else is touched`, async () => {
      const file = unique('erase')
      const neighbour = `${file}b`
      await write(file, backend, 'gone')
      await write(neighbour, backend, 'kept')
      await deleteDatabase(file)
      expect(await tables(file, backend)).toEqual([])
      const { driver } = await openWorkerDriver(neighbour, [backend])
      expect(await driver.all('SELECT v FROM t')).toEqual([{ v: 'kept' }])
      await driver.close()
    })
  }

  it('does nothing for a file that was never written', async () => {
    await expect(deleteDatabase(unique('never'))).resolves.toBeUndefined()
  })
})
```

Append to `web/src/storage/workerDriver.browser.test.ts`, inside `describe('openWorkerDriver', …)`:

```ts
  it('has let go of the OPFS file once close resolves: another opener gets it at once (6a contract)', async () => {
    const file = unique('handover')
    const first = await openWorkerDriver(file, ['opfs'])
    await first.driver.exec('CREATE TABLE t (v TEXT)')
    await first.driver.run('INSERT INTO t VALUES (?)', ['mine'])
    await first.driver.close()
    // No retry and no wait: if the access handles were still held, this open would fail.
    const second = await openWorkerDriver(file, ['opfs'])
    expect(second.backend).toBe('opfs')
    expect(await second.driver.all('SELECT v FROM t')).toEqual([{ v: 'mine' }])
    await second.driver.close()
  })

  it('opens two files at once, as a carry-over does (the demo and the learner’s)', async () => {
    const demo = await openWorkerDriver(unique('demo'), ['opfs'])
    const learner = await openWorkerDriver(unique('user'), ['opfs'])
    await demo.driver.exec('CREATE TABLE d (v TEXT)')
    await learner.driver.exec('CREATE TABLE l (v TEXT)')
    expect(await demo.driver.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: 'd' }])
    expect(await learner.driver.all("SELECT name FROM sqlite_master WHERE type = 'table'")).toEqual([{ name: 'l' }])
    await demo.driver.close()
    await learner.driver.close()
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project browser src/storage`
Expected: FAIL — `./erase` does not exist. The two new `openWorkerDriver` tests should already pass. If the hand-over test fails, the 6a contract is broken: `workerDriver.close()` must `await call({ op: 'close' })`, whose Worker-side `api.close` closes the VFS handles, before it resolves. Fix that before going on.

- [ ] **Step 3: Write `deleteDatabase`**

Create `web/src/storage/erase.ts`:

```ts
import { isUnsupportedError } from './open'

/** The OPFS entries one SQLite file leaves: `<file>.sqlite` and anything `<file>.sqlite-…` (journals). */
const belongsTo = (file: string, name: string) => name === `${file}.sqlite` || name.startsWith(`${file}.sqlite-`)

async function removeFromOpfs(file: string): Promise<void> {
  if (typeof navigator.storage?.getDirectory !== 'function') return
  let root: FileSystemDirectoryHandle
  try {
    root = await navigator.storage.getDirectory()
  } catch (err) {
    if (isUnsupportedError(err)) return
    throw err
  }
  const names: string[] = []
  // FileSystemDirectoryHandle is async-iterable; the DOM lib in use does not type `keys()` yet.
  for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) if (belongsTo(file, name)) names.push(name)
  for (const name of names) await root.removeEntry(name, { recursive: true })
}

function removeFromIdb(name: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(`${name} could not be deleted`))
    // `blocked` means a connection is still open. The Worker that held it is terminated on close,
    // so the deletion goes on to `success` once the browser notices; nothing to do but wait.
  })
}

/**
 * Deletes a database file wherever it may live (spec §8.6): OPFS and
 * IndexedDB (6a's `openIdb` names it `wordado-<file>`). Run it only with
 * the file closed: an open access handle makes OPFS refuse. Deleting a file
 * that does not exist does nothing.
 */
export async function deleteDatabase(file: string): Promise<void> {
  await removeFromOpfs(file)
  await removeFromIdb(`wordado-${file}`)
}
```

- [ ] **Step 4: Run the browser tests**

Run: `pnpm --filter @wordado/web exec vitest run --project browser src/storage`
Expected: PASS.

If the OPFS test still finds the table after deletion, `OPFSCoopSyncVFS` keeps the file somewhere other than `<file>.sqlite` at the root. To find it, log `for await (const n of root.keys()) console.log(n)` in the test after `write`, then widen `belongsTo` to match what it shows. Never widen the match to a prefix of `file` alone, which would delete `demo2` with `demo`.

- [ ] **Step 5: Run everything, and commit**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

```bash
git add web/src/storage
git commit -m "feat(web): delete a database file; prove close lets go and two files open at once"
```

---

### Task 6: `web`: `Boot` opens the demo or the learner's own file, finishes a carry-over, flushes on hand-over, and runs the sync loop

6a's `Boot` opens one file with no transport. It now works as follows.

- **Which file.** It reads the account record at every open, and opens `demo` or `user-<id>`, giving a learner's `Client` the transport.
- **Carry-over first.** Before opening a learner's file, it finishes a carry-over the last session could not.
- **Switching files.** It can switch files without giving up the tab lock: `switchTo`, which Task 7's controller uses for sign-in, sign-out, deletion and leaving the demo.
- **Hand-over.** It drains in-flight answers and flushes before closing (spec §9.1).
- **Sync loop.** `syncLoop.ts` decides *when* a learner syncs: at start, on `online`, on `visibilitychange`, every five minutes while visible, at the retry time the engine sets, and — on the in-memory fallback — after every answer.

**Files:**
- Modify: `web/src/app/boot.ts`
- Create: `web/src/app/syncLoop.ts`
- Modify: `web/src/main.tsx`
- Create: `web/src/test/disk.ts` (Node test helpers)
- Test: `web/src/app/boot.test.ts`, `web/src/app/syncLoop.test.ts`

**Interfaces:**
- Consumes:
  - `Client.idle`, `hasUnsynced`, `attachUser(userId, transport)` and `close` (Task 2).
  - `AccountStorage`, `AccountRecord`, `DEMO_FILE` and `learnerFile` (Task 4).
  - `deleteDatabase` (Task 5).
  - `httpTransport` (Task 4).
- Produces:
  - `BootDeps` gains optional fields, so 6a's tests and `Root.test.tsx` compile unchanged:
    - `accounts?: AccountStorage` — absent means always the demo.
    - `transport?(): SyncTransport`.
    - `deleteDatabase?(file): Promise<void>`.
    - `startSync?(client, backend): () => void`.
    - `flushTimeoutMs?: number`.
  - `openDriver(file: string)` now receives the file to open.
  - `BootState`'s `ready` gains `account: AccountRecord | null`.
  - `Boot.switchTo(options?: { deleteFile?: string }): Promise<void>`, and `FLUSH_TIMEOUT_MS`.
  - From `syncLoop.ts`: `SYNC_INTERVAL_MS`, `interface SyncLoopTarget { store; sync(options?) }`, and `startSyncLoop(target, { everyAnswer, now, window?, document? }): () => void`.

- [ ] **Step 1: Write the failing sync-loop tests**

Create `web/src/app/syncLoop.test.ts`:

```ts
import { createStore, INITIAL_SYNC_STATUS, type SyncStatus } from '@wordado/client-data'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startSyncLoop, SYNC_INTERVAL_MS, type SyncLoopTarget } from './syncLoop'

function target() {
  const store = createStore<{ readonly sync: SyncStatus }>({ sync: INITIAL_SYNC_STATUS })
  const calls: ({ force?: boolean } | undefined)[] = []
  const t: SyncLoopTarget = {
    store,
    sync: async (options) => {
      calls.push(options)
      return 'synced'
    },
  }
  const status = (patch: Partial<SyncStatus>) => store.set({ sync: { ...store.get().sync, ...patch } })
  return { t, calls, status }
}

const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})
afterEach(() => vi.useRealTimers())

describe('the sync loop (spec §9.1)', () => {
  it('syncs at once, on going online (forced past any backoff), and when the page is hidden', () => {
    const { t, calls } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    expect(calls).toHaveLength(1)
    window.dispatchEvent(new Event('online'))
    expect(calls[1]).toEqual({ force: true })
    setVisibility('hidden')
    expect(calls).toHaveLength(3)
    stop()
  })

  it('syncs every five minutes while visible, and not while hidden', () => {
    const { t, calls } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(2)
    stop()
  })

  it('tries again when the engine’s backoff runs out', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    status({ failures: 1, nextAttemptAt: Date.now() + 1_500 })
    vi.advanceTimersByTime(1_499)
    expect(calls).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(calls).toHaveLength(2)
    stop()
  })

  it('on the in-memory fallback, syncs after every answer (spec §9.1)', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: true, now: () => Date.now() })
    status({ pendingEvents: 1 })
    expect(calls).toHaveLength(2)
    status({ phase: 'pushing' })
    status({ pendingEvents: 2 })
    expect(calls).toHaveLength(2)
    // The push ends with an answer still waiting: it goes at once.
    status({ phase: 'idle', pendingEvents: 1 })
    expect(calls).toHaveLength(3)
    stop()
  })

  it('does not sync per answer on stored backends', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: false, now: () => Date.now() })
    status({ pendingEvents: 1 })
    expect(calls).toHaveLength(1)
    stop()
  })

  it('stops listening and timing when stopped', () => {
    const { t, calls, status } = target()
    const stop = startSyncLoop(t, { everyAnswer: true, now: () => Date.now() })
    stop()
    window.dispatchEvent(new Event('online'))
    setVisibility('hidden')
    status({ pendingEvents: 3, nextAttemptAt: Date.now() + 10 })
    vi.advanceTimersByTime(SYNC_INTERVAL_MS)
    expect(calls).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to see it fail, then write the loop**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/syncLoop.test.ts`
Expected: FAIL — `./syncLoop` does not exist.

Create `web/src/app/syncLoop.ts`:

```ts
import type { Store, SyncOutcome, SyncStatus } from '@wordado/client-data'

/** How often a visible app syncs on its own. Tuning (§15). */
export const SYNC_INTERVAL_MS = 5 * 60_000

/** What the loop needs of a Client. */
export interface SyncLoopTarget {
  readonly store: Store<{ readonly sync: SyncStatus }>
  sync(options?: { force?: boolean }): Promise<SyncOutcome>
}

export interface SyncLoopOptions {
  /** The in-memory fallback: nothing survives the tab, so each answer goes at once (spec §9.1). */
  readonly everyAnswer: boolean
  readonly now: () => number
  readonly window?: Window
  readonly document?: Document
}

/**
 * When a learner's Client syncs (spec §9.1, §9.2). What a sync does is
 * `client-data`'s. Here: at start; on `online`, past any backoff; when the
 * page is hidden, so an evicted or closed tab has flushed; when it is shown
 * again; every five minutes while visible; when the engine's backoff ends;
 * and on the in-memory fallback, after every answer. Returns `stop`.
 */
export function startSyncLoop(target: SyncLoopTarget, options: SyncLoopOptions): () => void {
  const win = options.window ?? window
  const doc = options.document ?? document
  let stopped = false
  const sync = (force = false) => {
    if (!stopped) void target.sync(force ? { force: true } : undefined).catch(() => undefined)
  }
  const onOnline = () => sync(true)
  const onVisibility = () => sync()
  win.addEventListener('online', onOnline)
  doc.addEventListener('visibilitychange', onVisibility)
  const interval = win.setInterval(() => {
    if (doc.visibilityState === 'visible') sync()
  }, SYNC_INTERVAL_MS)

  let retry: ReturnType<typeof setTimeout> | null = null
  let last = target.store.get().sync
  const unsubscribe = target.store.subscribe(() => {
    const status = target.store.get().sync
    if (retry !== null) {
      win.clearTimeout(retry)
      retry = null
    }
    if (status.phase === 'idle' && status.nextAttemptAt !== null) {
      retry = win.setTimeout(() => sync(), Math.max(0, status.nextAttemptAt - options.now()))
    } else if (
      options.everyAnswer &&
      status.phase === 'idle' &&
      status.pendingEvents > 0 &&
      (status.pendingEvents !== last.pendingEvents || last.phase !== 'idle')
    ) {
      sync()
    }
    last = status
  })

  sync()
  return () => {
    stopped = true
    win.removeEventListener('online', onOnline)
    doc.removeEventListener('visibilitychange', onVisibility)
    win.clearInterval(interval)
    if (retry !== null) win.clearTimeout(retry)
    unsubscribe()
  }
}
```

Run the test again. Expected: PASS.

- [ ] **Step 3: Write the failing Boot tests**

Create `web/src/test/disk.ts`, helpers for the Node suites that Task 7 reuses:

```ts
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SyncTransport } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import type { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import { Grade, type WordId } from '@wordado/core'

/** Database files on disk, one per name, as OPFS would keep them: they survive a close and a reopen. */
export function disk() {
  const dir = mkdtempSync(join(tmpdir(), 'wordado-web-'))
  const path = (file: string) => join(dir, `${file}.sqlite`)
  return {
    path,
    exists: (file: string) => existsSync(path(file)),
    openDriver: async (file: string) => ({ driver: nodeSqliteDriver(path(file)), backend: 'opfs' as const }),
    deleteDatabase: async (file: string) => rmSync(path(file), { force: true }),
  }
}

/** One answer to a word of the sample. */
export const answerTo = (wordId: string) => ({
  wordId: wordId as WordId,
  mode: 'flashcard' as const,
  direction: 'en_to_l1' as const,
  grade: Grade.Good,
  latencyMs: 2_000,
  practice: false,
})

/** A transport over `server` that fails while `online` is false, as a device offline would. */
export function flaky(server: FakeServer): SyncTransport & { online: boolean } {
  const t = {
    online: false,
    push: (page: Parameters<SyncTransport['push']>[0]) => (t.online ? server.push(page) : Promise.reject(new Error('offline'))),
    pull: (request: Parameters<SyncTransport['pull']>[0]) => (t.online ? server.pull(request) : Promise.reject(new Error('offline'))),
  }
  return t
}
```

Append to `web/src/app/boot.test.ts`, adding to its imports:

```ts
import type { SyncTransport } from '@wordado/client-data'
import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import type { WordId } from '@wordado/core'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage } from '../account/storage'
import { answerTo, disk, flaky } from '../test/disk'

const hello = answerTo('c:hello-1')
```

and then:

```ts
describe('Boot with accounts (spec §8.6, §9.1)', () => {
  it('opens the demo without an account, and the learner’s own file, with a transport, with one', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const { boot: b } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => server })
    await b.start()
    expect(b.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(await ready(b).sync()).toBe('skipped')

    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo({ deleteFile: DEMO_FILE })
    expect(b.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(d.exists(DEMO_FILE)).toBe(false)
    expect(d.exists(learnerFile('u1'))).toBe(true)
    const learner = ready(b)
    await learner.answer(hello)
    expect(await learner.sync()).toBe('synced')
    expect(server.events.size).toBe(1)
  })

  it('finishes a carry-over the last session could not, then deletes the demo (spec §8.6)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    const accounts = accountStorage(memoryStorage())
    const { boot: b } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => transport })
    await b.start()
    const demo = ready(b)
    await demo.answer(hello)
    // Signed in, but the push did not get through: the demo stays attached and flagged.
    await demo.attachUser('u1', transport)
    expect(await demo.sync({ force: true })).toBe('failed')
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    await b.switchTo()
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(accounts.read()?.carryOver).toBe(true)
    expect(server.events.size).toBe(0)

    // The next open, online: the demo's answer reaches the account from the demo's device, once.
    transport.online = true
    await b.switchTo()
    expect(server.events.size).toBe(1)
    expect([...server.events.values()][0]!.deviceId).toBe(demo.snapshot.deviceId)
    expect(d.exists(DEMO_FILE)).toBe(false)
    expect(accounts.read()).toEqual({ userId: 'u1', email: 'ana@example.com', carryOver: false })
    const learner = ready(b)
    expect(await learner.sync()).toBe('synced')
    expect(learner.snapshot.states.get('c:hello-1' as WordId)?.reps).toBe(1)
    await b.switchTo()
    expect(server.events.size).toBe(1)
  })

  it('leaves a demo attached to nobody alone, and does not open it when no carry-over is owed', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const opened: string[] = []
    const { boot: b } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        opened.push(file)
        return d.openDriver(file)
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
    })
    await b.start()
    await ready(b).answer(hello)
    accounts.save({ userId: 'u1', email: 'ana@example.com', carryOver: true })
    await b.switchTo()
    expect(d.exists(DEMO_FILE)).toBe(true)
    expect(server.events.size).toBe(0)
    expect(accounts.read()?.carryOver).toBe(false)
    opened.length = 0
    await b.switchTo()
    expect(opened).toEqual([learnerFile('u1')])
  })

  it('drains an answer being written and flushes it before letting go (spec §9.1)', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const { boot: b, release } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => server })
    await b.start()
    const client = ready(b)
    const answering = client.answer(hello)
    await release()
    await answering
    expect(b.store.get().status).toBe('elsewhere')
    expect(server.events.size).toBe(1)
  })

  it('lets go after the flush timeout when the server hangs', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const hanging: SyncTransport = { push: () => new Promise(() => undefined), pull: () => new Promise(() => undefined) }
    const { boot: b, release } = boot({ env, accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => hanging, flushTimeoutMs: 20 })
    await b.start()
    await ready(b).answer(hello)
    const started = Date.now()
    await release()
    expect(Date.now() - started).toBeLessThan(1_000)
    expect(b.store.get().status).toBe('elsewhere')
  })

  it('starts the sync loop for a learner only, and stops it on a switch and on release', async () => {
    const d = disk()
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const accounts = accountStorage(memoryStorage())
    const log: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: d.openDriver,
      deleteDatabase: d.deleteDatabase,
      transport: () => server,
      startSync: (_client, backend) => {
        log.push(`start ${backend}`)
        return () => log.push('stop')
      },
    })
    await b.start()
    expect(log).toEqual([])
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    await b.switchTo()
    await b.switchTo()
    await release()
    expect(log).toEqual(['start opfs', 'stop', 'start opfs', 'stop'])
  })

  it('hands over cleanly when a take-over lands in the middle of a switch', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const gate = deferred<void>()
    const reached = deferred<void>()
    const closes: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        if (file !== DEMO_FILE) {
          reached.resolve()
          await gate.promise
        }
        const { driver } = countingDriver(nodeSqliteDriver(d.path(file)))
        return { driver: { ...driver, close: async () => (closes.push(file), driver.close()) }, backend: 'opfs' }
      },
      deleteDatabase: d.deleteDatabase,
      transport: () => new FakeServer({ now: env.now }),
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const switching = b.switchTo()
    // The take-over lands while the learner's file is being opened: that open is closed again, never used.
    await reached.promise
    const releasing = release()
    gate.resolve()
    await Promise.all([switching, releasing])
    expect(b.store.get().status).toBe('elsewhere')
    expect(closes).toEqual([DEMO_FILE, learnerFile('u1')])
  })

  it('hands over only after a switch has closed the file it was closing', async () => {
    const d = disk()
    const env = testEnv()
    const accounts = accountStorage(memoryStorage())
    const closing = deferred<void>()
    const log: string[] = []
    const { boot: b, release } = boot({
      env,
      accounts,
      openDriver: async (file) => {
        const driver = nodeSqliteDriver(d.path(file))
        return {
          driver: {
            ...driver,
            close: async () => {
              if (file === DEMO_FILE) await closing.promise
              await driver.close()
              log.push(`closed ${file}`)
            },
          },
          backend: 'opfs',
        }
      },
      deleteDatabase: d.deleteDatabase,
    })
    await b.start()
    accounts.save({ userId: 'u1', email: 'ana@example.com' })
    const switching = b.switchTo()
    const releasing = release().then(() => log.push('released'))
    await new Promise((r) => setTimeout(r, 10))
    expect(log).toEqual([])
    closing.resolve()
    await Promise.all([switching, releasing])
    expect(log).toEqual([`closed ${DEMO_FILE}`, 'released'])
  })
})
```

- [ ] **Step 4: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/boot.test.ts`
Expected: FAIL. `accounts`, `transport`, `deleteDatabase`, `startSync` and `flushTimeoutMs` are not `BootDeps` fields, and `switchTo` does not exist. 6a's own tests still pass.

- [ ] **Step 5: Give `Boot` accounts**

In `web/src/app/boot.ts`:

1. Replace the imports with:

```ts
import { Client, createStore, type ClientEnv, type PackFetcher, type SqlDriver, type Store, type SyncTransport } from '@wordado/client-data'
import type { PackManifest } from '@wordado/core'
import { DEMO_FILE, learnerFile, type AccountRecord, type AccountStorage } from '../account/storage'
import type { Backend } from '../storage/protocol'

/** How long letting go waits for a last sync before closing anyway (spec §9.1). Tuning (§15). */
export const FLUSH_TIMEOUT_MS = 3_000
```

2. In `BootState`, change the `ready` member to:

```ts
  | { readonly status: 'ready'; readonly client: Client; readonly backend: Backend; readonly resumed: boolean; readonly account: AccountRecord | null }
```

3. Replace `BootDeps` with:

```ts
export interface BootDeps {
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. Bulgarian in Phase 1a. */
  readonly l1: string
  /** Which account this device is signed in to, read at every open. Absent: always the demo. */
  readonly accounts?: AccountStorage
  /** Opens one database file: `demo`, or a learner's `user-<id>`. */
  openDriver(file: string): Promise<{ readonly driver: SqlDriver; readonly backend: Backend }>
  /** Deletes a closed file: the demo after a carry-over or when left, a learner's after sign-out. */
  deleteDatabase?(file: string): Promise<void>
  /** A signed-in learner's transport (spec §9.2). The demo has none. */
  transport?(): SyncTransport
  /** Starts syncing a learner's Client (`startSyncLoop`); returns how to stop it. */
  startSync?(client: Client, backend: Backend): () => void
  /** Tests shorten FLUSH_TIMEOUT_MS. */
  readonly flushTimeoutMs?: number
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  /** Quick work before the app shows, such as reading the audio cache's index. Its failure never fails the boot. */
  prepare?(client: Client): Promise<void>
  /** Background work once ready, such as prefetching audio. Its failure never fails the boot. */
  onReady?(client: Client): Promise<void>
}

export interface SwitchOptions {
  /** A file to delete once the open one is closed and before the next opens. */
  readonly deleteFile?: string
}
```

4. Add these fields to `Boot`, beside `private backend`:

```ts
  private account: AccountRecord | null = null
  private stopSync: (() => void) | null = null
  /** The close in progress, if any; `closeClient` chains on it. */
  private closing: Promise<void> = Promise.resolve()
```

5. Replace `release()` with:

```ts
  /**
   * Called by the lock when another tab takes over (spec §9.1): say so, let
   * any answer being written finish, flush (for at most FLUSH_TIMEOUT_MS),
   * then close. Resolves once the file is let go, and only then does the
   * lock pass on.
   */
  async release(): Promise<void> {
    this.generation += 1
    this.lockHeld = false
    if (this.opening) await this.opening.catch(() => undefined)
    this.store.set({ status: 'elsewhere' })
    await this.closeClient(true)
  }

  /**
   * The account changed — sign-in, sign-out, deletion, leaving the demo
   * (spec §8.6): close what is open, delete `deleteFile` once nothing holds
   * it, and open the file of the account now recorded. Keeps the tab lock.
   * Does not flush: the caller has synced what should be synced, and after a
   * deletion there is no account to flush to.
   */
  async switchTo(options: SwitchOptions = {}): Promise<void> {
    if (!this.lockHeld) return
    this.generation += 1
    if (this.opening) await this.opening.catch(() => undefined)
    this.store.set({ status: 'starting' })
    await this.closeClient(false)
    if (options.deleteFile) await this.deps.deleteDatabase?.(options.deleteFile).catch(() => undefined)
    if (!this.lockHeld) return
    await this.open(true)
  }

  /**
   * Closes the open Client, one close at a time: a release that lands while a
   * switch is still closing waits for that close, so the lock never passes on
   * while this tab still holds a file.
   */
  private closeClient(flush: boolean): Promise<void> {
    const run = this.closing.then(() => this.closeNow(flush))
    this.closing = run.catch(() => undefined)
    return run
  }

  /** Stops syncing, waits for in-flight answers, optionally flushes, and closes the Client. */
  private async closeNow(flush: boolean): Promise<void> {
    this.stopSync?.()
    this.stopSync = null
    const client = this.client
    this.client = null
    if (!client) return
    await client.idle()
    if (flush) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.deps.flushTimeoutMs ?? FLUSH_TIMEOUT_MS)
      })
      await Promise.race([client.sync().catch(() => undefined), timeout])
      clearTimeout(timer)
    }
    // A sync cut short by the timeout fails on the closed database; its answers are pushed again next time, and the server drops duplicates.
    await client.close().catch(() => undefined)
  }
```

6. In `open()`, replace:

```ts
      this.store.set({ status: 'ready', client, backend: this.backend, resumed })
```

with:

```ts
      if (this.account && this.deps.startSync) this.stopSync = this.deps.startSync(client, this.backend)
      this.store.set({ status: 'ready', client, backend: this.backend, resumed, account: this.account })
```

7. Replace `acquireClient` with:

```ts
  /**
   * Opens the recorded account's file (or the demo's), after finishing any
   * owed carry-over, then the Client on it. Sets `this.client` only when the
   * lock is still held by the time each step finishes; otherwise closes
   * whatever was opened and leaves `this.client` untouched, so `release()`
   * need not know about either. Rethrows a `Client.open` failure after
   * closing the driver it was given.
   */
  private async acquireClient(generation: number): Promise<void> {
    const account = this.deps.accounts?.read() ?? null
    if (account?.carryOver) await this.carryOverDemo(account)
    if (generation !== this.generation) return
    const { driver, backend } = await this.deps.openDriver(account ? learnerFile(account.userId) : DEMO_FILE)
    if (generation !== this.generation) {
      await driver.close().catch(() => undefined)
      return
    }
    this.backend = backend
    let client: Client
    try {
      const transport = account ? this.deps.transport?.() : undefined
      client = await Client.open({ driver, env: this.deps.env, l1: this.deps.l1, ...(transport ? { transport } : {}) })
    } catch (err) {
      await driver.close().catch(() => undefined)
      throw err
    }
    if (generation !== this.generation) {
      await client.close()
      return
    }
    this.client = client
    this.account = account
  }

  /**
   * Finishes a carry-over the last session could not (spec §8.6): a demo
   * attached to this account is pushed from its own device and, once nothing
   * is left unsynced, deleted. A demo attached to nobody (or someone else) is
   * left alone. Never fails the boot: the flag stays, and the next open tries
   * again.
   */
  private async carryOverDemo(account: AccountRecord): Promise<void> {
    const transport = this.deps.transport?.()
    if (!transport) return
    let opened: { readonly driver: SqlDriver; readonly backend: Backend }
    try {
      opened = await this.deps.openDriver(DEMO_FILE)
    } catch {
      return
    }
    let demo: Client | null = null
    let finished = opened.backend === 'memory'
    let pushed = false
    try {
      if (!finished) {
        demo = await Client.open({ driver: opened.driver, env: this.deps.env, l1: this.deps.l1, transport })
        if (demo.snapshot.userId !== account.userId) finished = true
        else {
          await demo.sync({ force: true })
          pushed = !(await demo.hasUnsynced())
        }
      }
    } catch {
      // Offline, or the demo cannot be read: the next open tries again.
    } finally {
      if (demo) await demo.close().catch(() => undefined)
      else await opened.driver.close().catch(() => undefined)
    }
    if (pushed) await this.deps.deleteDatabase?.(DEMO_FILE).catch(() => undefined)
    if (pushed || finished) this.deps.accounts?.save({ ...account, carryOver: false })
  }
```

An in-memory "demo" found at boot is a fresh, empty database: nothing survived to carry over, so the flag is cleared (`finished`).

- [ ] **Step 6: Run the Boot tests**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app`
Expected: PASS, including every 6a Boot and Root test. The 6a tests pass `openDriver: async () => …`, which ignores the file argument and still type-checks.

- [ ] **Step 7: Wire the real dependencies**

In `web/src/main.tsx`:

1. Add the imports:

```ts
import { accountStorage } from './account/storage'
import { httpTransport } from './account/transport'
import { startSyncLoop } from './app/syncLoop'
import { deleteDatabase } from './storage/erase'
```

2. Before `const boot = …`, add:

```ts
const accounts = accountStorage()
// Task 7 routes a 401 to the account controller; until then an expired sign-in only shows as a failed sync.
const transport = httpTransport()
```

3. In the `Boot` dependencies, replace `openDriver: () => openWorkerDriver('demo'),` with:

```ts
    accounts,
    openDriver: (file) => openWorkerDriver(file),
    deleteDatabase,
    transport: () => transport,
    startSync: (client, backend) => startSyncLoop(client, { everyAnswer: backend === 'memory', now: env.now }),
```

4. In `afterRun`, add after the prefetch line:

```ts
  // A run is over: flush now (spec §9.1). The demo's Client has no transport, so this is a no-op there.
  if (state.status === 'ready') void state.client.sync().catch(() => undefined)
```

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/src/app/boot.ts web/src/app/boot.test.ts web/src/app/syncLoop.ts web/src/app/syncLoop.test.ts web/src/test/disk.ts web/src/main.tsx
git commit -m "feat(web): Boot opens the demo or the learner's file, finishes a carry-over, flushes on hand-over; the sync loop"
```

---

### Task 7: `web`: the account controller — what sign-in, sign-out, deletion and leaving the demo do

Spec §8.6's rules, and plan 5's account endpoints, in one place the screens call:

- Signing in from a demo with progress carries the demo over into an empty account, and discards it for an account that has progress.
- Signing in again after the sign-in expired resumes syncing, and signing in as someone else is refused.
- Signing out flushes, asks before losing unsynced answers, and deletes the learner's file.
- Deleting the account deletes it on the server, then here.
- Leaving the demo deletes the demo.

Each ends in `Boot.switchTo` and a notice the shell shows.

**Files:**
- Create: `web/src/account/controller.ts`
- Create: `web/src/test/fakeApi.ts`
- Modify: `web/src/main.tsx`
- Test: `web/src/account/controller.test.ts`

**Interfaces:**
- Consumes:
  - `Api` and `Me` (Task 4).
  - `AccountStorage`, `pendingSignIn`, `DEMO_FILE` and `learnerFile` (Task 4).
  - `Boot.switchTo` and `BootState` (Task 6).
  - `accountIsEmpty`, `Client.attachUser(userId, transport)` and `Client.hasUnsynced` (Task 2).
- Produces:
  - `type AccountNotice = 'carried-over' | 'demo-discarded' | 'signed-in' | 'signed-out' | 'deleted' | 'other-account' | 'google-failed' | 'demo-left'`.
  - `interface AccountState { expired: boolean; notice: AccountNotice | null }`.
  - `interface BootPort { store: Store<BootState>; switchTo(options?): Promise<void> }`.
  - `interface ReminderPort { stop(options: { server: boolean }): Promise<void> }`.
  - `type SignInOutcome = 'signed-in' | 'carried-over' | 'demo-discarded' | 'other-account'`.
  - `class AccountController`, with:
    - `store: Store<AccountState>`
    - `completeSignIn(country): Promise<SignInOutcome>`
    - `resumeGoogle(result: 'ok' | 'error'): Promise<SignInOutcome | null>`
    - `signOut(options?: { force?: boolean }): Promise<'signed-out' | 'unsynced'>`
    - `deleteAccount(): Promise<void>`
    - `leaveDemo(): Promise<void>`
    - `sessionExpired(): void`
    - `dismissNotice(): void`
  - `type AccountActions = Pick<AccountController, 'store' | 'completeSignIn' | 'resumeGoogle' | 'signOut' | 'deleteAccount' | 'leaveDemo' | 'dismissNotice'>`: what the screens use, so their tests can pass a fake.
  - From `test/fakeApi.ts`: `interface FakeApi extends Api { calls: string[]; session: Me | null }`, and `fakeApi(over?: Partial<Api>, session?: Me | null): FakeApi`.

- [ ] **Step 1: Write the fake API**

Create `web/src/test/fakeApi.ts`:

```ts
import type { Api, Me } from '../account/api'

export interface FakeApi extends Api {
  /** Every call, by name. */
  readonly calls: string[]
  /** Whom the "server" has a session for; null for none. Set it to sign in. */
  session: Me | null
}

/** The account endpoints as a test needs them. Override any method to make it fail. */
export function fakeApi(over: Partial<Api> = {}, session: Me | null = null): FakeApi {
  const calls: string[] = []
  const api: FakeApi = {
    calls,
    session,
    sendCode: async (email) => {
      calls.push(`sendCode ${email}`)
    },
    verifyCode: async (email, code) => {
      calls.push(`verifyCode ${email} ${code}`)
    },
    googleUrl: async () => {
      calls.push('googleUrl')
      return 'https://accounts.google.com/o/oauth2/auth'
    },
    me: async () => {
      calls.push('me')
      return api.session
    },
    requestCountry: async () => {
      calls.push('requestCountry')
      return 'BG'
    },
    setCountry: async (country) => {
      calls.push(`setCountry ${country}`)
    },
    signOut: async () => {
      calls.push('signOut')
    },
    deleteAccount: async () => {
      calls.push('deleteAccount')
    },
    pushPublicKey: async () => null,
    putSubscription: async () => {
      calls.push('putSubscription')
    },
    deleteSubscription: async (endpoint) => {
      calls.push(`deleteSubscription ${endpoint}`)
    },
  }
  return Object.assign(api, over)
}
```

- [ ] **Step 2: Write the failing controller tests**

Create `web/src/account/controller.test.ts`:

```ts
import { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { Client, type SyncTransport } from '@wordado/client-data'
import type { WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Boot, type LockPort } from '../app/boot'
import { answerTo, disk, flaky } from '../test/disk'
import { fakeApi } from '../test/fakeApi'
import type { Me } from './api'
import { AccountController } from './controller'
import { accountStorage, DEMO_FILE, learnerFile, memoryStorage, pendingSignIn } from './storage'

const ANA: Me = { userId: 'u1', email: 'ana@example.com', country: null, createdAt: 0 }

/** A booted app on disk over a fake server, and its controller. */
async function app(options: { env?: TestEnv; server?: FakeServer; transport?: SyncTransport; session?: Me | null } = {}) {
  const env = options.env ?? testEnv()
  const server = options.server ?? new FakeServer({ now: env.now })
  const transport = options.transport ?? server
  const d = disk()
  const accounts = accountStorage(memoryStorage())
  const pending = pendingSignIn(memoryStorage())
  const api = fakeApi({}, options.session === undefined ? ANA : options.session)
  const stops: boolean[] = []
  const lock: LockPort = { acquire: async () => true, takeOver: async () => undefined }
  const boot = new Boot(
    { env, l1: 'bg', accounts, openDriver: d.openDriver, deleteDatabase: d.deleteDatabase, transport: () => transport, fetchManifest: async () => sampleManifest, fetchPack: sampleFetcher },
    () => lock,
  )
  await boot.start()
  const controller = new AccountController({
    api,
    boot,
    accounts,
    pending,
    transport: () => transport,
    reminders: {
      stop: async ({ server: s }) => {
        stops.push(s)
      },
    },
  })
  const client = () => {
    const state = boot.store.get()
    if (state.status !== 'ready') throw new Error(`not ready: ${state.status}`)
    return state.client
  }
  return { env, server, d, accounts, pending, api, boot, controller, client, stops }
}

/** Another device of the same account, with progress on the server. */
async function progressElsewhere(env: TestEnv, server: FakeServer): Promise<void> {
  const other = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', transport: server })
  await other.installPacks(sampleManifest, sampleFetcher)
  await other.startSession()
  await other.answer(answerTo('c:goodbye-1'))
  await other.sync()
  await other.close()
}

describe('signing in from the demo (spec §8.6)', () => {
  it('carries the demo over into a new account, from the demo’s own device, and deletes the demo', async () => {
    const a = await app()
    const demoDevice = a.client().snapshot.deviceId
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn('BG')).toBe('carried-over')
    expect([...a.server.events.values()].map((e) => [e.wordId, e.deviceId])).toEqual([['c:hello-1', demoDevice]])
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(a.accounts.read()).toEqual({ userId: 'u1', email: 'ana@example.com', carryOver: false })
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
    expect(await a.client().sync()).toBe('synced')
    expect(a.client().snapshot.states.get('c:hello-1' as WordId)?.reps).toBe(1)
    expect(a.controller.store.get()).toEqual({ expired: false, notice: 'carried-over' })
    expect(a.api.calls).toContain('setCountry BG')
  })

  it('discards the demo when the account already has progress, and merges nothing', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    await progressElsewhere(env, server)
    const a = await app({ env, server })
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn(null)).toBe('demo-discarded')
    expect([...server.events.values()].map((e) => e.wordId)).toEqual(['c:goodbye-1'])
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(await a.client().sync()).toBe('synced')
    expect([...a.client().snapshot.states.keys()]).toEqual(['c:goodbye-1'])
    expect(a.api.calls).not.toContain('setCountry null')
  })

  it('deletes an untouched demo and simply signs in', async () => {
    const a = await app()
    expect(await a.controller.completeSignIn('BG')).toBe('signed-in')
    expect(a.d.exists(DEMO_FILE)).toBe(false)
    expect(a.server.events.size).toBe(0)
  })

  it('keeps the demo attached when its push fails, and says the carry-over is owed', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    const a = await app({ env, server, transport })
    await a.client().answer(answerTo('c:hello-1'))
    // Online for the emptiness check, offline for the push: the tab loses its connection at the worst moment.
    transport.online = true
    const push = transport.push
    transport.push = () => Promise.reject(new Error('offline'))
    expect(await a.controller.completeSignIn('BG')).toBe('carried-over')
    expect(a.accounts.read()?.carryOver).toBe(true)
    expect(a.d.exists(DEMO_FILE)).toBe(true)
    transport.push = push
    await a.boot.switchTo()
    expect(server.events.size).toBe(1)
    expect(a.d.exists(DEMO_FILE)).toBe(false)
  })

  it('changes nothing when the account cannot be checked (offline)', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const a = await app({ env, server, transport: flaky(server) })
    await a.client().answer(answerTo('c:hello-1'))
    await expect(a.controller.completeSignIn('BG')).rejects.toThrow('offline')
    expect(a.accounts.read()).toBeNull()
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
  })

  it('does nothing without a session', async () => {
    const a = await app({ session: null })
    await expect(a.controller.completeSignIn('BG')).rejects.toThrow()
    expect(a.accounts.read()).toBeNull()
  })
})

describe('signing in again (spec §8.6)', () => {
  it('clears an expired sign-in for the same learner and syncs at once', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.controller.sessionExpired()
    expect(a.controller.store.get().expired).toBe(true)
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.completeSignIn(null)).toBe('signed-in')
    expect(a.controller.store.get()).toEqual({ expired: false, notice: 'signed-in' })
    await a.client().idle()
    await a.client().sync()
    expect(a.server.events.size).toBe(1)
  })

  it('refuses another account on a device that holds a learner’s progress, and signs that session out', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.api.session = { ...ANA, userId: 'u2', email: 'bo@example.com' }
    expect(await a.controller.completeSignIn('BG')).toBe('other-account')
    expect(a.api.calls.at(-1)).toBe('signOut')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: { userId: 'u1' } })
  })

  it('marks the sign-in as expired only when signed in', async () => {
    const a = await app()
    a.controller.sessionExpired()
    expect(a.controller.store.get().expired).toBe(false)
  })
})

describe('Google’s return (spec §8.6)', () => {
  it('completes with the age gate’s country carried across the redirect', async () => {
    const a = await app()
    a.pending.save({ country: 'DE' })
    expect(await a.controller.resumeGoogle('ok')).toBe('signed-in')
    expect(a.api.calls).toContain('setCountry DE')
    expect(a.pending.read()).toBeNull()
  })

  it('does not complete a sign-in whose age gate was not passed in this tab', async () => {
    const a = await app()
    expect(await a.controller.resumeGoogle('ok')).toBeNull()
    expect(a.api.calls).toContain('signOut')
    expect(a.accounts.read()).toBeNull()
    expect(a.controller.store.get().notice).toBe('google-failed')
  })

  it('says so when Google sent the learner back with an error', async () => {
    const a = await app()
    a.pending.save({ country: 'BG' })
    expect(await a.controller.resumeGoogle('error')).toBeNull()
    expect(a.controller.store.get().notice).toBe('google-failed')
  })
})

describe('signing out, deleting, leaving the demo (spec §8.6, §11)', () => {
  it('asks before losing answers that could not be flushed, then signs out and deletes the learner’s file', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: env.now })
    const transport = flaky(server)
    transport.online = true
    const a = await app({ env, server, transport })
    await a.controller.completeSignIn('BG')
    transport.online = false
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.signOut()).toBe('unsynced')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(await a.controller.signOut({ force: true })).toBe('signed-out')
    expect(a.accounts.read()).toBeNull()
    expect(a.d.exists(learnerFile('u1'))).toBe(false)
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(a.client().snapshot.states.size).toBe(0)
    expect(a.stops).toEqual([true])
    expect(a.api.calls).toContain('signOut')
  })

  it('signs out without asking when everything is synced', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    await a.client().answer(answerTo('c:hello-1'))
    expect(await a.controller.signOut()).toBe('signed-out')
    expect(a.server.events.size).toBe(1)
  })

  it('deletes the account on the server first, and changes nothing here when that fails', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    a.api.deleteAccount = async () => Promise.reject(new Error('offline'))
    await expect(a.controller.deleteAccount()).rejects.toThrow('offline')
    expect(a.accounts.read()?.userId).toBe('u1')
    expect(a.d.exists(learnerFile('u1'))).toBe(true)
  })

  it('deletes the account, then the learner’s file, and opens a fresh demo', async () => {
    const a = await app()
    await a.controller.completeSignIn('BG')
    await a.controller.deleteAccount()
    expect(a.accounts.read()).toBeNull()
    expect(a.d.exists(learnerFile('u1'))).toBe(false)
    expect(a.boot.store.get()).toMatchObject({ status: 'ready', account: null })
    expect(a.controller.store.get().notice).toBe('deleted')
    expect(a.stops).toEqual([false])
  })

  it('leaves the demo: its progress is deleted and a fresh one opens', async () => {
    const a = await app()
    await a.client().answer(answerTo('c:hello-1'))
    await a.controller.leaveDemo()
    expect(a.client().snapshot.states.size).toBe(0)
    expect(a.controller.store.get().notice).toBe('demo-left')
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/controller.test.ts`
Expected: FAIL — `./controller` does not exist.

- [ ] **Step 4: Write the controller**

Create `web/src/account/controller.ts`:

```ts
import { accountIsEmpty, createStore, type Client, type Store, type SyncTransport } from '@wordado/client-data'
import type { BootState, SwitchOptions } from '../app/boot'
import type { Api } from './api'
import { DEMO_FILE, learnerFile, type AccountStorage, type PendingSignIn } from './storage'

/** What the shell tells the learner after an account change (spec §8.6: the demo's fate is stated plainly). */
export type AccountNotice = 'carried-over' | 'demo-discarded' | 'signed-in' | 'signed-out' | 'deleted' | 'other-account' | 'google-failed' | 'demo-left'

export interface AccountState {
  /** The server refused the session (a 401): syncing waits for the learner to sign in again. */
  readonly expired: boolean
  readonly notice: AccountNotice | null
}

/** What the controller needs of `Boot`. */
export interface BootPort {
  readonly store: Store<BootState>
  switchTo(options?: SwitchOptions): Promise<void>
}

/** Reminders on this device (Task 12): stopped when the account goes, on the server too unless it is already gone. */
export interface ReminderPort {
  stop(options: { readonly server: boolean }): Promise<void>
}

export interface PendingStore {
  read(): PendingSignIn | null
  clear(): void
}

export interface AccountDeps {
  readonly api: Api
  readonly boot: BootPort
  readonly accounts: AccountStorage
  readonly pending: PendingStore
  transport(): SyncTransport
  readonly reminders?: ReminderPort
}

export type SignInOutcome = 'signed-in' | 'carried-over' | 'demo-discarded' | 'other-account'

/**
 * Accounts on this device (spec §8.6, §11): what a sign-in does to the demo,
 * what signing out and deleting leave behind. Every rule about data is
 * `client-data`'s (`accountIsEmpty`, `attachUser`, `hasUnsynced`); this
 * class sequences them and switches files through `Boot`.
 */
export class AccountController {
  readonly store: Store<AccountState> = createStore<AccountState>({ expired: false, notice: null })

  constructor(private readonly deps: AccountDeps) {}

  private client(): Client | null {
    const state = this.deps.boot.store.get()
    return state.status === 'ready' ? state.client : null
  }

  private set(patch: Partial<AccountState>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  /** From the transport: the server answered 401. Only a signed-in learner can have an expired sign-in. */
  sessionExpired(): void {
    if (this.deps.accounts.read() !== null && !this.store.get().expired) this.set({ expired: true })
  }

  dismissNotice(): void {
    this.set({ notice: null })
  }

  /**
   * Runs once the server holds a session for this browser: after a verified
   * code, or back from Google. `country` is the age gate's (spec §11), the
   * only thing kept of it.
   *
   * - Already signed in as the same learner (an expired sign-in): resume syncing.
   * - Signed in as someone else: refuse, and sign the new session out — this
   *   device's answers belong to its learner, and are neither pushed nor deleted.
   * - From the demo into an account with no progress: attach the demo, push it
   *   from its own device, delete it once everything is up (spec §8.6).
   * - From the demo into an account with progress: delete the demo.
   *
   * Throws, changing nothing, when the account cannot be checked (offline).
   */
  async completeSignIn(country: string | null): Promise<SignInOutcome> {
    const { api, accounts, boot } = this.deps
    const me = await api.me()
    if (!me) throw new Error('The sign-in did not complete')
    if (country !== null && me.country !== country) await api.setCountry(country).catch(() => undefined)

    const current = accounts.read()
    if (current) {
      if (current.userId === me.userId) {
        this.set({ expired: false, notice: 'signed-in' })
        void this.client()?.sync({ force: true }).catch(() => undefined)
        return 'signed-in'
      }
      await api.signOut().catch(() => undefined)
      this.set({ notice: 'other-account' })
      return 'other-account'
    }

    const demo = this.client()
    const record = { userId: me.userId, email: me.email }
    const hasProgress = demo !== null && (await demo.hasUnsynced())
    if (demo && hasProgress) {
      const transport = this.deps.transport()
      if (await accountIsEmpty(transport, demo.snapshot.deviceId)) {
        await demo.attachUser(me.userId, transport)
        await demo.sync({ force: true })
        const carryOver = await demo.hasUnsynced()
        accounts.save({ ...record, carryOver })
        await boot.switchTo(carryOver ? {} : { deleteFile: DEMO_FILE })
        this.set({ expired: false, notice: 'carried-over' })
        return 'carried-over'
      }
    }
    accounts.save(record)
    await boot.switchTo({ deleteFile: DEMO_FILE })
    const outcome: SignInOutcome = hasProgress ? 'demo-discarded' : 'signed-in'
    this.set({ expired: false, notice: outcome })
    return outcome
  }

  /**
   * Back from Google (spec §8.6). The age gate's country crossed the
   * redirect in this tab's session storage; without it the gate was not
   * passed here, so the session is signed out rather than used.
   */
  async resumeGoogle(result: 'ok' | 'error'): Promise<SignInOutcome | null> {
    const pending = this.deps.pending.read()
    this.deps.pending.clear()
    if (result === 'error' || pending === null) {
      if (result === 'ok') await this.deps.api.signOut().catch(() => undefined)
      this.set({ notice: 'google-failed' })
      return null
    }
    return this.completeSignIn(pending.country)
  }

  /**
   * Flushes, then signs out and deletes this learner's file (a shared browser
   * keeps nothing). Answers that could not be flushed are lost by signing
   * out, so without `force` it returns 'unsynced' and changes nothing.
   */
  async signOut(options: { readonly force?: boolean } = {}): Promise<'signed-out' | 'unsynced'> {
    const { api, accounts, boot } = this.deps
    const account = accounts.read()
    if (!account) return 'signed-out'
    const client = this.client()
    if (client) {
      await client.sync({ force: true }).catch(() => undefined)
      if (!options.force && (await client.hasUnsynced())) return 'unsynced'
    }
    await this.deps.reminders?.stop({ server: true }).catch(() => undefined)
    await api.signOut().catch(() => undefined)
    accounts.clear()
    await boot.switchTo({ deleteFile: learnerFile(account.userId) })
    this.set({ expired: false, notice: 'signed-out' })
    return 'signed-out'
  }

  /** Self-service erasure (spec §11): the server first — if that fails, nothing here changes — then this device. */
  async deleteAccount(): Promise<void> {
    const { api, accounts, boot } = this.deps
    const account = accounts.read()
    if (!account) return
    await api.deleteAccount()
    await this.deps.reminders?.stop({ server: false }).catch(() => undefined)
    accounts.clear()
    await boot.switchTo({ deleteFile: learnerFile(account.userId) })
    this.set({ expired: false, notice: 'deleted' })
  }

  /** Leaving the demo deletes it (spec §8.6); a fresh one opens. */
  async leaveDemo(): Promise<void> {
    if (this.deps.accounts.read() !== null) return
    await this.deps.boot.switchTo({ deleteFile: DEMO_FILE })
    this.set({ notice: 'demo-left' })
  }
}
```

Append to the same file:

```ts
/** What the screens use of the controller; their tests pass a fake. */
export type AccountActions = Pick<AccountController, 'store' | 'completeSignIn' | 'resumeGoogle' | 'signOut' | 'deleteAccount' | 'leaveDemo' | 'dismissNotice'>
```

`pendingSignIn(…)` from Task 4 returns `{ read, save, clear }`, which satisfies `PendingStore`.

- [ ] **Step 5: Run the controller tests**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/account/controller.test.ts`
Expected: PASS.

In "keeps the demo attached when its push fails", `completeSignIn` calls `boot.switchTo({})`, and Boot's `carryOverDemo` runs at once with the same failing push. The demo therefore stays, with the flag set, until the test restores `push` and switches again. If the demo was deleted instead, `Boot` deleted it without checking `hasUnsynced`.

- [ ] **Step 6: Wire the controller in `main.tsx`**

In `web/src/main.tsx`:

1. Add the imports `import { httpApi } from './account/api'`, `import { AccountController } from './account/controller'`, and `pendingSignIn` from `./account/storage`.
2. Replace the Task 6 transport lines with:

```ts
const accounts = accountStorage()
const api = httpApi()
let controller: AccountController | null = null
// A 401 from sync means the sign-in expired (spec §8.6): the controller shows it and the outbox waits.
const transport = httpTransport({ onUnauthorized: () => controller?.sessionExpired() })
```

3. After `const boot = new Boot(…)`, add:

```ts
controller = new AccountController({ api, boot, accounts, pending: pendingSignIn(), transport: () => transport })

// Back from Google (spec §8.6): finish the sign-in once the demo (or the learner's file) is open.
const signinResult = new URLSearchParams(window.location.search).get('signin')
if (signinResult === 'google' || signinResult === 'google-error') {
  window.history.replaceState(null, '', window.location.pathname)
  const unsubscribe = boot.store.subscribe(() => {
    if (boot.store.get().status !== 'ready') return
    unsubscribe()
    void controller?.resumeGoogle(signinResult === 'google' ? 'ok' : 'error').catch(() => undefined)
  })
}
```

Task 8 passes `controller` and `api` to `Root`; until then they are only created.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src/account/controller.ts web/src/account/controller.test.ts web/src/test/fakeApi.ts web/src/main.tsx
git commit -m "feat(web): the account controller — carry the demo over or discard it, sign in again, sign out, delete, leave the demo"
```

---

### Task 8: `web`: signing in — the age gate, a code or Google — and the shell's banners, notices and sync status

The learner-facing half of Tasks 4–7:

- **The sign-in screen.** The age gate first (spec §11), then an emailed code or Google (spec §8.6). Before a code is requested, it says plainly what signing in does to the demo.
- **Banners.** The shell's banners replace 6a's single line:
  - the demo, with "Create an account" and "Leave the demo";
  - the in-memory fallback, which for a learner is online-only (spec §9.1);
  - an expired sign-in;
  - the controller's notices.
- **Sync status.** A status line in the masthead names what sync is doing (spec §9.2). Every failure has a message, including the 400 plan 5 says must be surfaced.
- **Confirmation.** Destructive actions confirm through one accessible dialog.

**Files:**
- Create: `web/src/app/syncMessage.ts`, `web/src/app/Banners.tsx`, `web/src/app/Confirm.tsx`, `web/src/useOnline.ts`, `web/src/screens/SignIn.tsx`
- Modify: `web/src/app/context.tsx`, `web/src/app/App.tsx`, `web/src/app/Root.tsx`, `web/src/router.tsx`, `web/src/main.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`, `web/src/styles.css`, `web/src/test/fixtures.tsx`
- Test: `web/src/app/syncMessage.test.ts`, `web/src/app/Banners.test.tsx`, `web/src/screens/SignIn.test.tsx`, `web/src/app/Root.test.tsx` (modify), `web/src/router.test.tsx` (modify)

**Interfaces:**
- Consumes:
  - `Api`, `ApiError` and `OfflineError` (Task 4).
  - `checkBirthYear` and `countryOptions` (Task 4).
  - `pendingSignIn` (Task 4).
  - `AccountActions`, `AccountNotice` and `AccountState` (Task 7).
  - `httpStatusOf` (Task 4).
  - `SyncStatus` (plan 4).
- Produces:
  - `AppServices` gains `api: Api`, `accounts: AccountActions` and `account: AccountRecord | null`.
  - `Route` gains `{ name: 'signin' }` (`/signin`).
  - `syncMessage(status, { online, expired, signedIn }): { key: MessageKey; vars?: Vars; tone: 'quiet' | 'warning' } | null`.
  - `ConfirmDialog` props: `{ title; body: ReactNode; confirmLabel; onConfirm(): Promise<void> | void; onClose(): void; confirmDisabled?; children? }`.
  - `useOnline(): boolean`.
  - `SignIn` props: `{ redirect?: (url: string) => void; pending?: { save(p: PendingSignIn): void } }`.
  - From `test/fixtures.tsx`: `fakeAccounts(over?): AccountActions & { calls: string[] }`. `renderWith`'s context gains `api?`, `accounts?` and `account?`.

- [ ] **Step 1: Write the failing sync-message tests**

Create `web/src/app/syncMessage.test.ts`:

```ts
import { INITIAL_SYNC_STATUS, type SyncStatus } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { syncMessage } from './syncMessage'

const status = (patch: Partial<SyncStatus> = {}): SyncStatus => ({ ...INITIAL_SYNC_STATUS, ...patch })
const ctx = { online: true, expired: false, signedIn: true }

describe('syncMessage (spec §9.2): every state has words', () => {
  it('says nothing in the demo, which does not sync', () => {
    expect(syncMessage(status({ pendingEvents: 3 }), { ...ctx, signedIn: false })).toBeNull()
  })

  it.each([
    ['an expired sign-in first', status({ failures: 2, lastError: 'HTTP 401' }), { ...ctx, expired: true }, 'sync.expired', 'warning'],
    ['an app too old to sync', status({ upgradeRequired: true }), ctx, 'sync.upgrade', 'warning'],
    ['a sync under way', status({ phase: 'pushing' }), ctx, 'sync.syncing', 'quiet'],
    ['a page the server refused as malformed', status({ failures: 1, lastError: 'HTTP 400', pendingEvents: 2 }), ctx, 'sync.rejected', 'warning'],
    ['offline with answers waiting', status({ pendingEvents: 2 }), { ...ctx, online: false }, 'sync.offlinePending', 'quiet'],
    ['offline with nothing waiting', status(), { ...ctx, online: false }, 'sync.offline', 'quiet'],
    ['a failure online', status({ failures: 1, lastError: 'Failed to fetch', pendingEvents: 2 }), ctx, 'sync.failed', 'warning'],
    ['answers not yet sent', status({ pendingEvents: 1, lastSyncAt: 5 }), ctx, 'sync.pending', 'quiet'],
    ['everything sent', status({ lastSyncAt: 5 }), ctx, 'sync.synced', 'quiet'],
  ] as const)('%s', (_, s, c, key, tone) => {
    expect(syncMessage(s, c)).toMatchObject({ key, tone })
  })

  it('counts what is waiting', () => {
    expect(syncMessage(status({ pendingEvents: 4 }), { ...ctx, online: false })?.vars).toEqual({ count: 4 })
  })

  it('says nothing before the first sync of a learner with nothing to send', () => {
    expect(syncMessage(status(), ctx)).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail, then write it**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/syncMessage.test.ts`
Expected: FAIL — `./syncMessage` does not exist, and none of the `sync.*` keys exist yet.

Create `web/src/app/syncMessage.ts`:

```ts
import type { SyncStatus } from '@wordado/client-data'
import { httpStatusOf } from '../account/transport'
import type { MessageKey, Vars } from '../i18n/i18n'

export interface SyncMessage {
  readonly key: MessageKey
  readonly vars?: Vars
  /** A warning is shown so it is noticed; a quiet line is there when looked for. */
  readonly tone: 'quiet' | 'warning'
}

export interface SyncContext {
  readonly online: boolean
  readonly expired: boolean
  readonly signedIn: boolean
}

/**
 * What the masthead says about sync (spec §9.2). The first matching state
 * wins, most urgent first. A 400 is a page the server refused as malformed:
 * a fault in the app, not the network, and retrying cannot fix it (plan 5).
 */
export function syncMessage(status: SyncStatus, ctx: SyncContext): SyncMessage | null {
  if (!ctx.signedIn) return null
  const count = status.pendingEvents
  if (ctx.expired) return { key: 'sync.expired', tone: 'warning' }
  if (status.upgradeRequired) return { key: 'sync.upgrade', tone: 'warning' }
  if (status.phase !== 'idle') return { key: 'sync.syncing', tone: 'quiet' }
  if (status.failures > 0 && httpStatusOf(status.lastError) === 400) return { key: 'sync.rejected', tone: 'warning' }
  if (!ctx.online) return count > 0 ? { key: 'sync.offlinePending', vars: { count }, tone: 'quiet' } : { key: 'sync.offline', tone: 'quiet' }
  if (status.failures > 0) return { key: 'sync.failed', tone: 'warning' }
  if (count > 0) return { key: 'sync.pending', vars: { count }, tone: 'quiet' }
  if (status.lastSyncAt !== null) return { key: 'sync.synced', tone: 'quiet' }
  return null
}
```

- [ ] **Step 3: Add this task's interface strings**

Add to `web/src/i18n/en.ts`, after the `banner.memory` line:

```ts
  'banner.memoryOnline': 'This browser can’t keep your progress on the device. Each answer is sent to your account as you go, so study while you are online.',
  'banner.demoCreate': 'Create an account',
  'banner.demoLeave': 'Leave the demo',
  'banner.expired': 'Your sign-in has expired. Your progress is safe on this device and syncs once you sign in again.',
  'banner.signInAgain': 'Sign in again',
  'leave.title': 'Leave the demo?',
  'leave.body': 'The words you studied in the demo are deleted from this device. This can’t be undone.',
  'leave.confirm': 'Delete the demo',
  'confirm.cancel': 'Cancel',
  'confirm.failed': 'That didn’t work: {message}',

  'notice.carried-over': 'Your account is ready, and the words you studied in the demo are in it.',
  'notice.demo-discarded': 'You are signed in. This email already had an account, so the demo was deleted and your account’s progress is here.',
  'notice.demo-left': 'The demo was deleted. You can start again whenever you like.',
  'notice.signed-in': 'You are signed in.',
  'notice.signed-out': 'You are signed out. Nothing of your account is left on this device.',
  'notice.deleted': 'Your account and everything in it has been deleted.',
  'notice.other-account': 'This device holds the progress of {email}. Sign out of that account in settings before using another.',
  'notice.google-failed': 'Google sign-in didn’t complete. Try again, or use a code by email.',
  'notice.dismiss': 'Dismiss',

  'sync.syncing': 'Syncing…',
  'sync.synced': 'All progress saved to your account',
  'sync.pending': { one: '{count} answer waiting to sync', other: '{count} answers waiting to sync' },
  'sync.offline': 'Offline. Your progress is kept on this device.',
  'sync.offlinePending': { one: 'Offline: {count} answer syncs when you are back online', other: 'Offline: {count} answers sync when you are back online' },
  'sync.failed': 'Couldn’t reach Wordado. Trying again soon.',
  'sync.expired': 'Sign in again to sync',
  'sync.upgrade': 'Update Wordado to keep syncing. Your progress is kept on this device.',
  'sync.rejected': 'Your progress couldn’t be saved to your account because of a fault in Wordado. It is kept on this device.',

  'signin.title': 'Create an account or sign in',
  'signin.againTitle': 'Sign in again',
  'signin.gateIntro': 'First, two questions the law asks us. Only your country is kept.',
  'signin.country': 'Country where you live',
  'signin.countryUnknown': 'I’d rather not say',
  'signin.birthYear': 'Year of birth',
  'signin.birthYearHint': 'Four digits, for example 1994. It is not stored.',
  'signin.birthYearInvalid': 'Enter the year you were born, as four digits.',
  'signin.continue': 'Continue',
  'signin.tooYoungTitle': 'Sorry, you can’t create an account yet',
  'signin.tooYoung': 'Where you live, you need to be at least {age} to use Wordado with an account. You can keep trying the demo.',
  'signin.backToDemo': 'Back to the demo',
  'signin.demoNote': 'If this email already has a Wordado account, the words you studied in the demo are deleted. A new account keeps them.',
  'signin.email': 'Email',
  'signin.emailInvalid': 'Enter an email address, like name@example.com.',
  'signin.sendCode': 'Email me a code',
  'signin.or': 'or',
  'signin.google': 'Continue with Google',
  'signin.codeSent': 'We sent a six-digit code to {email}. It works for five minutes.',
  'signin.code': 'Code',
  'signin.codeInvalid': 'The code is six digits.',
  'signin.verify': 'Sign in',
  'signin.resend': 'Send a new code',
  'signin.resent': 'A new code is on its way.',
  'signin.otherEmail': 'Use another email',
  'signin.codeWrong': 'That code is wrong or has expired.',
  'signin.limit': 'No code was sent: this address has had too many codes. Try again in an hour.',
  'signin.tooMany': 'Too many attempts. Wait a minute and try again.',
  'signin.offline': 'Signing in needs a connection. You can keep studying offline.',
  'signin.googleFailed': 'Google sign-in isn’t available right now. Use a code by email.',
  'signin.failed': 'Something went wrong. Try again.',
  'signin.otherAccount': 'This device holds the progress of {email}. Sign out of that account in settings before signing in with another.',
  'signin.working': 'Signing you in…',
```

Add to `web/src/i18n/bg.ts`, after its `banner.memory` line, the same keys in Bulgarian:

```ts
  'banner.memoryOnline': 'Този браузър не може да пази напредъка ви на устройството. Всеки отговор се изпраща към профила ви веднага, затова учете, докато сте онлайн.',
  'banner.demoCreate': 'Създайте профил',
  'banner.demoLeave': 'Излезте от пробата',
  'banner.expired': 'Входът ви е изтекъл. Напредъкът ви е запазен на това устройство и ще се синхронизира, щом влезете отново.',
  'banner.signInAgain': 'Влезте отново',
  'leave.title': 'Да излезете от пробата?',
  'leave.body': 'Думите, които учихте в пробата, се изтриват от това устройство. Това не може да се отмени.',
  'leave.confirm': 'Изтрийте пробата',
  'confirm.cancel': 'Отказ',
  'confirm.failed': 'Не се получи: {message}',

  'notice.carried-over': 'Профилът ви е готов и думите, които учихте в пробата, са в него.',
  'notice.demo-discarded': 'Влязохте. Този имейл вече имаше профил, затова пробата беше изтрита и тук е напредъкът на профила ви.',
  'notice.demo-left': 'Пробата беше изтрита. Можете да започнете отново, когато пожелаете.',
  'notice.signed-in': 'Влязохте.',
  'notice.signed-out': 'Излязохте. На това устройство не е останало нищо от профила ви.',
  'notice.deleted': 'Профилът ви и всичко в него бяха изтрити.',
  'notice.other-account': 'Това устройство пази напредъка на {email}. Излезте от този профил от настройките, преди да използвате друг.',
  'notice.google-failed': 'Входът с Google не завърши. Опитайте отново или използвайте код по имейл.',
  'notice.dismiss': 'Затвори',

  'sync.syncing': 'Синхронизиране…',
  'sync.synced': 'Целият напредък е запазен в профила ви',
  'sync.pending': { one: '{count} отговор чака синхронизиране', other: '{count} отговора чакат синхронизиране' },
  'sync.offline': 'Няма връзка. Напредъкът ви се пази на това устройство.',
  'sync.offlinePending': { one: 'Няма връзка: {count} отговор ще се синхронизира, щом се свържете', other: 'Няма връзка: {count} отговора ще се синхронизират, щом се свържете' },
  'sync.failed': 'Не успяхме да се свържем с Wordado. Ще опитаме отново скоро.',
  'sync.expired': 'Влезте отново, за да синхронизирате',
  'sync.upgrade': 'Обновете Wordado, за да продължи синхронизирането. Напредъкът ви се пази на това устройство.',
  'sync.rejected': 'Напредъкът ви не можа да се запише в профила поради грешка в Wordado. Пази се на това устройство.',

  'signin.title': 'Създайте профил или влезте',
  'signin.againTitle': 'Влезте отново',
  'signin.gateIntro': 'Първо два въпроса, които законът изисква. Пазим само държавата ви.',
  'signin.country': 'Държава, в която живеете',
  'signin.countryUnknown': 'Предпочитам да не казвам',
  'signin.birthYear': 'Година на раждане',
  'signin.birthYearHint': 'Четири цифри, например 1994. Не се пази.',
  'signin.birthYearInvalid': 'Въведете годината, в която сте родени, с четири цифри.',
  'signin.continue': 'Напред',
  'signin.tooYoungTitle': 'За съжаление все още не можете да създадете профил',
  'signin.tooYoung': 'Там, където живеете, трябва да сте поне на {age}, за да използвате Wordado с профил. Можете да продължите с пробата.',
  'signin.backToDemo': 'Обратно към пробата',
  'signin.demoNote': 'Ако този имейл вече има профил в Wordado, думите, които учихте в пробата, се изтриват. Нов профил ги запазва.',
  'signin.email': 'Имейл',
  'signin.emailInvalid': 'Въведете имейл адрес, например name@example.com.',
  'signin.sendCode': 'Изпратете ми код',
  'signin.or': 'или',
  'signin.google': 'Продължете с Google',
  'signin.codeSent': 'Изпратихме шестцифрен код на {email}. Валиден е пет минути.',
  'signin.code': 'Код',
  'signin.codeInvalid': 'Кодът е от шест цифри.',
  'signin.verify': 'Вход',
  'signin.resend': 'Изпратете нов код',
  'signin.resent': 'Нов код е на път.',
  'signin.otherEmail': 'Използвайте друг имейл',
  'signin.codeWrong': 'Кодът е грешен или е изтекъл.',
  'signin.limit': 'Не беше изпратен код: този адрес получи твърде много кодове. Опитайте отново след час.',
  'signin.tooMany': 'Твърде много опити. Изчакайте минута и опитайте отново.',
  'signin.offline': 'За вход е нужна връзка. Можете да продължите да учите офлайн.',
  'signin.googleFailed': 'Входът с Google не е достъпен в момента. Използвайте код по имейл.',
  'signin.failed': 'Нещо се обърка. Опитайте отново.',
  'signin.otherAccount': 'Това устройство пази напредъка на {email}. Излезте от този профил от настройките, преди да влезете с друг.',
  'signin.working': 'Влизате…',
```

Run the sync-message test again. Expected: PASS.

- [ ] **Step 4: Extend the services, the fixture and the router**

Replace `AppServices` in `web/src/app/context.tsx` with:

```ts
/** What the screens need beside the Client. */
export interface AppServices {
  readonly env: ClientEnv
  readonly audio: AudioPort
  /** Which storage the database opened on (spec §9.1): memory shows a banner. */
  readonly backend: Backend
  /** The signed-in learner, or null in the demo. */
  readonly account: AccountRecord | null
  /** Sign-in, sign-out, deletion, leaving the demo (spec §8.6). */
  readonly accounts: AccountActions
  /** The server's endpoints beside sync. */
  readonly api: Api
  /**
   * Called when a run ends: fetches the clips of the words about to be met
   * (spec §9.3), flushes the outbox (spec §9.1), and asks once for persistent
   * storage (spec §9.1) — after the learner has studied, because some
   * browsers ask the learner to allow it.
   */
  afterRun(): void
}
```

with the imports `import type { Api } from '../account/api'`, `import type { AccountActions } from '../account/controller'` and `import type { AccountRecord } from '../account/storage'`.

In `web/src/test/fixtures.tsx`, add:

```ts
import { createStore } from '@wordado/client-data'
import type { Api } from '../account/api'
import type { AccountActions, AccountState } from '../account/controller'
import type { AccountRecord } from '../account/storage'
import { fakeApi } from './fakeApi'

/** The account controller as the screens see it: every call is logged, and each can be overridden. */
export function fakeAccounts(over: Partial<AccountActions> = {}): AccountActions & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    store: createStore<AccountState>({ expired: false, notice: null }),
    completeSignIn: async (country) => {
      calls.push(`completeSignIn ${country}`)
      return 'signed-in'
    },
    resumeGoogle: async () => null,
    signOut: async (options) => {
      calls.push(`signOut${options?.force ? ' force' : ''}`)
      return 'signed-out'
    },
    deleteAccount: async () => {
      calls.push('deleteAccount')
    },
    leaveDemo: async () => {
      calls.push('leaveDemo')
    },
    dismissNotice: () => {
      calls.push('dismissNotice')
    },
    ...over,
  }
}
```

extend `RenderContext` with:

```ts
  readonly api?: Api
  readonly accounts?: AccountActions
  readonly account?: AccountRecord | null
```

and change `renderWith`'s `AppProvider` value to:

```ts
{
  env: ctx.env,
  audio: ctx.audio,
  backend: ctx.backend ?? 'opfs',
  afterRun: ctx.afterRun ?? (() => undefined),
  api: ctx.api ?? fakeApi(),
  accounts: ctx.accounts ?? fakeAccounts(),
  account: ctx.account ?? null,
}
```

In `web/src/router.tsx`:

1. Add `| { readonly name: 'signin' }` to `Route`.
2. Add `case '/signin': return { name: 'signin' }` to `parseRoute`.

`routeHref`'s default already gives `/signin`. Add to `web/src/router.test.tsx`:

```ts
  it('routes the sign-in screen', () => {
    expect(parseRoute('/signin', '')).toEqual({ name: 'signin' })
    expect(routeHref({ name: 'signin' })).toBe('/signin')
  })
```

In `web/src/app/Root.tsx`:

1. Change the `services` prop type to `Omit<AppServices, 'backend' | 'account'>`.
2. Change the provider's value to `{ ...props.services, backend: state.backend, account: state.account }`.

In `web/src/app/Root.test.tsx`, add `api: fakeApi(), accounts: fakeAccounts()` to the `services` it passes, importing `fakeAccounts` from `../test/fixtures` and `fakeApi` from `../test/fakeApi`.

Create `web/src/useOnline.ts`:

```ts
import { useSyncExternalStore } from 'react'

function subscribe(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Whether the browser believes it is online, following `online` and `offline` events (6a contract). */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true)
}
```

Run: `pnpm --filter @wordado/web exec vitest run --project unit && pnpm --filter @wordado/web typecheck`
Expected: PASS once `main.tsx` passes the new services. In `main.tsx`, change `services={{ env, audio, afterRun }}` to `services={{ env, audio, afterRun, api, accounts: controller! }}`. `controller` is assigned before the render, so the non-null assertion holds; restructure to `const controller = new AccountController(…)` above `createRoot` if the `let` makes that unclear.

- [ ] **Step 5: Write the failing banner tests**

Create `web/src/app/Banners.test.tsx`:

```ts
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeAccounts, renderWith, setup } from '../test/fixtures'
import { Banners, SyncLine } from './Banners'

afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }

describe('Banners', () => {
  it('offers an account from the demo, and leaving it after a confirmation', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    renderWith(<Banners />, { ...ctx, accounts })
    expect(screen.getByRole('link', { name: 'Create an account' }).getAttribute('href')).toBe('/signin')
    const leave = screen.getByRole('button', { name: 'Leave the demo' })
    leave.focus()
    fireEvent.click(leave)
    const dialog = screen.getByRole('dialog', { name: 'Leave the demo?' })
    expect(dialog.textContent).toContain('can’t be undone')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Leave the demo' }))
    expect(accounts.calls).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(accounts.calls).toEqual(['leaveDemo'])
  })

  it('shows why leaving failed, in the dialog', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts({ leaveDemo: async () => Promise.reject(new Error('disk full')) })
    renderWith(<Banners />, { ...ctx, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Leave the demo' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Delete the demo' })))
    expect(screen.getByRole('alert').textContent).toBe('That didn’t work: disk full')
  })

  it('says a learner on the in-memory fallback must stay online (spec §9.1)', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, backend: 'memory', account: ana })
    expect(screen.getByText(/Each answer is sent to your account as you go/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Create an account' })).toBeNull()
  })

  it('keeps 6a’s warning for a demo on the in-memory fallback', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, backend: 'memory' })
    expect(screen.getByText(/can’t keep your progress. Everything you study here is lost/)).toBeTruthy()
  })

  it('says an expired sign-in keeps progress, with a way to sign in again', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: true, notice: null })
    renderWith(<Banners />, { ...ctx, accounts, account: ana })
    expect(screen.getByText(/Your sign-in has expired/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in again' }).getAttribute('href')).toBe('/signin')
  })

  it('announces a notice and dismisses it', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: false, notice: 'other-account' })
    renderWith(<Banners />, { ...ctx, accounts, account: ana })
    expect(screen.getByRole('status').textContent).toContain('This device holds the progress of ana@example.com')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(accounts.calls).toEqual(['dismissNotice'])
  })

  it('shows the sync status to a learner and nothing in the demo', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<SyncLine />, { ...ctx })
    expect(screen.queryByText(/sync/i)).toBeNull()
    unmount()
    const accounts = fakeAccounts()
    accounts.store.set({ expired: true, notice: null })
    renderWith(<SyncLine />, { ...ctx, accounts, account: ana })
    expect(screen.getByText('Sign in again to sync')).toBeTruthy()
  })
})
```

- [ ] **Step 6: Run it to see it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/Banners.test.tsx`
Expected: FAIL — `./Banners` does not exist.

- [ ] **Step 7: Write the dialog and the banners**

Create `web/src/app/Confirm.tsx`:

```tsx
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useT } from '../i18n/i18n'

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

export interface ConfirmDialogProps {
  readonly title: string
  readonly body: ReactNode
  readonly confirmLabel: string
  onConfirm(): Promise<void> | void
  onClose(): void
  readonly confirmDisabled?: boolean
  /** Extra content between the text and the buttons, such as an "I understand" checkbox. */
  readonly children?: ReactNode
}

/**
 * The modal every destructive action confirms through (spec §11.1): a
 * native `<dialog>`, named by its title and described by its text, Escape
 * cancels, and focus returns to what opened it. A failure is shown inside it.
 */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { t } = useT()
  const dialog = useRef<HTMLDialogElement>(null)
  const opener = useRef<HTMLElement | null>(null)
  const titleId = useId()
  const bodyId = useId()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => {
      if (opener.current?.isConnected) opener.current.focus()
    }
  }, [])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      await props.onConfirm()
      dialog.current?.close()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <dialog ref={dialog} className="confirm" aria-labelledby={titleId} aria-describedby={bodyId} onClose={props.onClose}>
      <h2 id={titleId}>{props.title}</h2>
      <div id={bodyId}>{props.body}</div>
      {props.children}
      {error !== null && <p role="alert">{t('confirm.failed', { message: error })}</p>}
      <div className="actions">
        <button type="button" className="button" onClick={() => dialog.current?.close()}>
          {t('confirm.cancel')}
        </button>
        <button type="button" className="button danger" disabled={busy || props.confirmDisabled === true} onClick={() => void confirm()}>
          {props.confirmLabel}
        </button>
      </div>
    </dialog>
  )
}
```

happy-dom does not fire `close` when `close()` is called in every version. If the Cancel test still finds the dialog, call `props.onClose()` right after `dialog.current?.close()` in both places. The `onClose` handler is idempotent in every caller, because it only sets state to closed.

Create `web/src/app/Banners.tsx`:

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import { useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link } from '../router'
import { useStore } from '../useStore'
import { useOnline } from '../useOnline'
import { ConfirmDialog } from './Confirm'
import { useApp } from './context'
import { syncMessage } from './syncMessage'
import type { AccountNotice } from '../account/controller'

const NOTICE: Readonly<Record<AccountNotice, MessageKey>> = {
  'carried-over': 'notice.carried-over',
  'demo-discarded': 'notice.demo-discarded',
  'demo-left': 'notice.demo-left',
  'signed-in': 'notice.signed-in',
  'signed-out': 'notice.signed-out',
  deleted: 'notice.deleted',
  'other-account': 'notice.other-account',
  'google-failed': 'notice.google-failed',
}

/** The shell's banners (spec §8.6, §9.1): the demo, storage, an expired sign-in, and the last account notice. */
export function Banners() {
  const { t } = useT()
  const { backend, account, accounts } = useApp()
  const { expired, notice } = useStore(accounts.store)
  const [leaving, setLeaving] = useState(false)
  return (
    <div className="banners">
      {notice !== null && (
        <div className="banner notice-line" role="status">
          <p>{t(NOTICE[notice], { email: account?.email ?? '' })}</p>
          <button type="button" className="link-button" onClick={() => accounts.dismissNotice()}>
            {t('notice.dismiss')}
          </button>
        </div>
      )}
      {account === null ? (
        <div className={`banner${backend === 'memory' ? ' warning' : ''}`}>
          <p>{t(backend === 'memory' ? 'banner.memory' : 'banner.demo')}</p>
          <p className="banner-actions">
            <Link to={{ name: 'signin' }}>{t('banner.demoCreate')}</Link>
            <button type="button" className="link-button" onClick={() => setLeaving(true)}>
              {t('banner.demoLeave')}
            </button>
          </p>
        </div>
      ) : (
        backend === 'memory' && <p className="banner warning">{t('banner.memoryOnline')}</p>
      )}
      {account !== null && expired && (
        <div className="banner warning">
          <p>{t('banner.expired')}</p>
          <p className="banner-actions">
            <Link to={{ name: 'signin' }}>{t('banner.signInAgain')}</Link>
          </p>
        </div>
      )}
      {leaving && (
        <ConfirmDialog
          title={t('leave.title')}
          body={<p>{t('leave.body')}</p>}
          confirmLabel={t('leave.confirm')}
          onConfirm={() => accounts.leaveDemo()}
          onClose={() => setLeaving(false)}
        />
      )}
    </div>
  )
}

/** One line in the masthead saying what sync is doing (spec §9.2); nothing in the demo. */
export function SyncLine() {
  const { t } = useT()
  const { account, accounts } = useApp()
  const { expired } = useStore(accounts.store)
  const { sync } = useClientSnapshot()
  const online = useOnline()
  const message = syncMessage(sync, { online, expired, signedIn: account !== null })
  if (!message) return null
  return (
    <p className={`sync-line${message.tone === 'warning' ? ' warning' : ''}`} role="status">
      {t(message.key, message.vars)}
    </p>
  )
}
```

Run the banner tests. Expected: PASS.

- [ ] **Step 8: Put the banners and the status in the shell**

In `web/src/app/App.tsx`:

1. Import `{ Banners, SyncLine }` from `./Banners` and `{ SignIn }` from `../screens/SignIn`.
2. Add `case 'signin': return <SignIn />` to `Screen`.
3. Put `<SyncLine />` after `<LanguageSwitch />` in the masthead.
4. Replace the line:

```tsx
      {backend === 'memory' ? <p className="banner warning">{t('banner.memory')}</p> : <p className="banner">{t('banner.demo')}</p>}
```

with `<Banners />`, and drop the now-unused `backend` from `useApp()`.

The banners stay outside `<main>` as 6a had them. To satisfy axe's `region` rule, wrap `<Banners />` in `<aside aria-label={t('banner.label')}>`, adding `'banner.label': 'Notices'` to `en.ts` and `'banner.label': 'Известия'` to `bg.ts`. This also clears 6a's deferred minor about the banner sitting outside any landmark.

- [ ] **Step 9: Write the failing sign-in tests**

Create `web/src/screens/SignIn.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiError, OfflineError } from '../account/api'
import { fakeApi } from '../test/fakeApi'
import { answerNew, fakeAccounts, renderWith, setup } from '../test/fixtures'
import { SignIn } from './SignIn'

beforeEach(() => window.history.replaceState(null, '', '/signin'))
afterEach(cleanup)

const THIS_YEAR = new Date().getFullYear()

async function render(options: Parameters<typeof fakeAccounts>[0] = {}, apiOver: Parameters<typeof fakeApi>[0] = {}) {
  const ctx = await setup()
  const api = fakeApi(apiOver)
  const accounts = fakeAccounts(options)
  const redirects: string[] = []
  const pending: { country: string | null }[] = []
  renderWith(<SignIn redirect={(url) => redirects.push(url)} pending={{ save: (p) => pending.push(p) }} />, { ...ctx, api, accounts })
  // The country pre-fill arrives from the server.
  await act(async () => undefined)
  return { ...ctx, api, accounts, redirects, pending }
}

async function passGate(country: string, year: number) {
  fireEvent.change(screen.getByLabelText('Country where you live'), { target: { value: country } })
  fireEvent.change(screen.getByLabelText('Year of birth'), { target: { value: String(year) } })
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
}

describe('SignIn: the age gate (spec §11)', () => {
  it('pre-fills the country from the server', async () => {
    await render()
    expect((screen.getByLabelText('Country where you live') as HTMLSelectElement).value).toBe('BG')
  })

  it('refuses a birth year that is not four digits, tied to the field', async () => {
    const { api } = await render()
    await passGate('BG', 20)
    const field = screen.getByLabelText('Year of birth')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('Enter the year you were born, as four digits.')
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    expect(api.calls.filter((c) => c.startsWith('sendCode'))).toEqual([])
  })

  it('turns away a learner below their country’s age before anything is sent or stored', async () => {
    const { api, pending } = await render()
    await passGate('DE', THIS_YEAR - 15)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sorry, you can’t create an account yet')
    expect(screen.getByText(/at least 16/)).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect(api.calls).toEqual(['requestCountry'])
    expect(pending).toEqual([])
  })

  it('uses 16 when the learner would rather not say where they live', async () => {
    await render()
    await passGate('', THIS_YEAR - 15)
    expect(screen.getByText(/at least 16/)).toBeTruthy()
  })
})

describe('SignIn: a code by email (spec §8.6)', () => {
  it('sends a code, verifies it, and completes the sign-in with the gate’s country', async () => {
    const { api, accounts } = await render()
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(api.calls).toContain('sendCode ana@example.com')
    expect(screen.getByText(/We sent a six-digit code to ana@example.com/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '12345' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toBe('The code is six digits.')
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(api.calls).toContain('verifyCode ana@example.com 123456')
    expect(accounts.calls).toEqual(['completeSignIn BG'])
    expect(window.location.pathname).toBe('/')
  })

  it('says what signing in does to the demo before a code is asked for', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 1)
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, { ...ctx, api: fakeApi(), accounts: fakeAccounts() })
    await act(async () => undefined)
    await passGate('BG', 1990)
    expect(screen.getByText(/the words you studied in the demo are deleted. A new account keeps them/)).toBeTruthy()
  })

  it.each([
    ['the address limit', new ApiError(429, 'sign_in_email_limit'), 'No code was sent: this address has had too many codes. Try again in an hour.'],
    ['too many requests', new ApiError(429, null), 'Too many attempts. Wait a minute and try again.'],
    ['no connection', new OfflineError(new TypeError('Failed to fetch')), 'Signing in needs a connection. You can keep studying offline.'],
    ['anything else', new ApiError(500, 'internal'), 'Something went wrong. Try again.'],
  ])('explains %s when asking for a code', async (_, error, message) => {
    await render({}, { sendCode: async () => Promise.reject(error) })
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(screen.getByRole('alert').textContent).toBe(message)
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('refuses an email that is not one', async () => {
    const { api } = await render()
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    expect(screen.getByRole('alert').textContent).toBe('Enter an email address, like name@example.com.')
    expect(api.calls.some((c) => c.startsWith('sendCode'))).toBe(false)
  })

  it('says a wrong code is wrong, and keeps the learner on the code', async () => {
    const { accounts } = await render({}, { verifyCode: async () => Promise.reject(new ApiError(400, 'INVALID_OTP')) })
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'ana@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '000000' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toBe('That code is wrong or has expired.')
    expect(accounts.calls).toEqual([])
  })

  it('refuses a second account on a device that holds a learner’s progress', async () => {
    const ctx = await setup()
    renderWith(<SignIn redirect={() => undefined} pending={{ save: () => undefined }} />, {
      ...ctx,
      api: fakeApi(),
      accounts: fakeAccounts({ completeSignIn: async () => 'other-account' }),
      account: { userId: 'u1', email: 'ana@example.com' },
    })
    await act(async () => undefined)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Sign in again')
    await passGate('BG', 1990)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'bo@example.com' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Email me a code' })))
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: '123456' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign in' })))
    expect(screen.getByRole('alert').textContent).toContain('This device holds the progress of ana@example.com')
  })
})

describe('SignIn: Google (spec §8.6)', () => {
  it('keeps the gate’s country for the return, then goes to Google', async () => {
    const { redirects, pending } = await render()
    await passGate('BG', 1990)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })))
    expect(pending).toEqual([{ country: 'BG' }])
    expect(redirects).toEqual(['https://accounts.google.com/o/oauth2/auth'])
  })

  it('says so when Google is not available', async () => {
    const { redirects } = await render({}, { googleUrl: async () => Promise.reject(new ApiError(404, 'PROVIDER_NOT_FOUND')) })
    await passGate('BG', 1990)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue with Google' })))
    expect(screen.getByRole('alert').textContent).toBe('Google sign-in isn’t available right now. Use a code by email.')
    expect(redirects).toEqual([])
  })
})
```

- [ ] **Step 10: Run it to see it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/screens/SignIn.test.tsx`
Expected: FAIL — `./SignIn` does not exist.

- [ ] **Step 11: Write the sign-in screen**

Create `web/src/screens/SignIn.tsx`:

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, OfflineError } from '../account/api'
import { checkBirthYear } from '../account/ageGate'
import { countryOptions } from '../account/countries'
import { pendingSignIn, type PendingSignIn } from '../account/storage'
import { useApp } from '../app/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

type Step =
  | { readonly kind: 'gate' }
  | { readonly kind: 'too-young'; readonly age: number }
  | { readonly kind: 'method' }
  | { readonly kind: 'code'; readonly email: string }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** A failure from the server, as the learner reads it (plan 5: a 429 with `sign_in_email_limit` sent no code). */
function failureKey(err: unknown, fallback: MessageKey): MessageKey {
  if (err instanceof OfflineError) return 'signin.offline'
  if (err instanceof ApiError && err.status === 429) return err.code === 'sign_in_email_limit' ? 'signin.limit' : 'signin.tooMany'
  return fallback
}

/** One labelled field with its hint and its error tied to it (spec §11.1). */
function Field(props: {
  readonly label: string
  readonly hint?: string
  readonly error: string | null
  readonly children: (ids: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy = [props.hint ? hintId : null, props.error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      {props.hint && (
        <p className="note" id={hintId}>
          {props.hint}
        </p>
      )}
      {props.children({ id, describedBy, invalid: props.error !== null })}
      {props.error && (
        <p className="field-error" role="alert" id={errorId}>
          {props.error}
        </p>
      )}
    </div>
  )
}

/**
 * Sign-in and sign-up are one flow (spec §8.6): the age gate (spec §11),
 * then a code by email or Google. The server creates the account at the
 * first sign-in, so the gate comes first every time. Only the country is
 * kept; the birth year is checked here and forgotten.
 */
export function SignIn(props: { readonly redirect?: (url: string) => void; readonly pending?: { save(p: PendingSignIn): void } }) {
  const { t, locale } = useT()
  const { api, accounts, account, env } = useApp()
  const { states } = useClientSnapshot()
  const online = useOnline()
  const [step, setStep] = useState<Step>({ kind: 'gate' })
  const [country, setCountry] = useState<string | null>(null)
  const [countryTouched, setCountryTouched] = useState(false)
  const [year, setYear] = useState('')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [fieldError, setFieldError] = useState<MessageKey | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [info, setInfo] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const countries = useMemo(() => countryOptions(locale), [locale])
  const redirect = props.redirect ?? ((url: string) => window.location.assign(url))
  const pending = props.pending ?? pendingSignIn()

  // Pre-filled from the request's country (spec §11), unless the learner has already chosen.
  useEffect(() => {
    let live = true
    api.requestCountry().then(
      (found) => {
        if (live && !countryTouched && found !== null) setCountry(found)
      },
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [api])

  // Each step's heading takes focus, as a new page would (spec §11.1).
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    heading.current?.focus()
  }, [step.kind])

  const reset = () => {
    setFieldError(null)
    setFormError(null)
    setInfo(null)
  }

  const submitGate = (event: FormEvent) => {
    event.preventDefault()
    reset()
    const result = checkBirthYear(year, country, env.now())
    if (result.status === 'invalid') setFieldError('signin.birthYearInvalid')
    else if (result.status === 'too-young') setStep({ kind: 'too-young', age: result.age })
    else setStep({ kind: 'method' })
  }

  const requestCode = async (address: string): Promise<boolean> => {
    setBusy(true)
    try {
      await api.sendCode(address)
      return true
    } catch (err) {
      setFormError(t(failureKey(err, 'signin.failed')))
      return false
    } finally {
      setBusy(false)
    }
  }

  const submitEmail = async (event: FormEvent) => {
    event.preventDefault()
    reset()
    const address = email.trim()
    if (!EMAIL.test(address)) {
      setFieldError('signin.emailInvalid')
      return
    }
    if (await requestCode(address)) setStep({ kind: 'code', email: address })
  }

  const google = async () => {
    reset()
    setBusy(true)
    try {
      pending.save({ country })
      const origin = window.location.origin
      redirect(await api.googleUrl(`${origin}/?signin=google`, `${origin}/?signin=google-error`))
    } catch (err) {
      setFormError(t(err instanceof OfflineError ? 'signin.offline' : 'signin.googleFailed'))
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    if (step.kind !== 'code') return
    reset()
    const digits = code.replace(/\s/g, '')
    if (!/^\d{6}$/.test(digits)) {
      setFieldError('signin.codeInvalid')
      return
    }
    setBusy(true)
    try {
      await api.verifyCode(step.email, digits)
    } catch (err) {
      setFormError(t(err instanceof ApiError && err.status !== 429 ? 'signin.codeWrong' : failureKey(err, 'signin.failed')))
      setBusy(false)
      return
    }
    try {
      const outcome = await accounts.completeSignIn(country)
      if (outcome === 'other-account') {
        setFormError(t('signin.otherAccount', { email: account?.email ?? '' }))
        setBusy(false)
        return
      }
      navigate({ name: 'home' }, { replace: true })
    } catch (err) {
      setFormError(t(failureKey(err, 'signin.failed')))
      setBusy(false)
    }
  }

  const resend = async () => {
    if (step.kind !== 'code') return
    reset()
    if (await requestCode(step.email)) setInfo('signin.resent')
  }

  const title = account !== null ? t('signin.againTitle') : t('signin.title')
  const formAlert = formError !== null && (
    <p className="form-error" role="alert">
      {formError}
    </p>
  )

  if (step.kind === 'too-young') {
    return (
      <section className="signin" aria-labelledby="signin-title">
        <h1 id="signin-title" ref={heading} tabIndex={-1}>
          {t('signin.tooYoungTitle')}
        </h1>
        <p>{t('signin.tooYoung', { age: step.age })}</p>
        <Link className="button" to={{ name: 'home' }}>
          {t('signin.backToDemo')}
        </Link>
      </section>
    )
  }

  return (
    <section className="signin" aria-labelledby="signin-title">
      <h1 id="signin-title" ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {!online && <p className="note">{t('signin.offline')}</p>}

      {step.kind === 'gate' && (
        <form onSubmit={submitGate} noValidate>
          <p className="lede">{t('signin.gateIntro')}</p>
          <Field label={t('signin.country')} error={null}>
            {({ id }) => (
              <select
                id={id}
                value={country ?? ''}
                onChange={(e) => {
                  setCountryTouched(true)
                  setCountry(e.target.value === '' ? null : e.target.value)
                }}
              >
                <option value="">{t('signin.countryUnknown')}</option>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t('signin.birthYear')} hint={t('signin.birthYearHint')} error={fieldError === 'signin.birthYearInvalid' ? t(fieldError) : null}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                inputMode="numeric"
                autoComplete="bday-year"
                maxLength={4}
                value={year}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(e) => setYear(e.target.value)}
              />
            )}
          </Field>
          <button type="submit" className="button primary">
            {t('signin.continue')}
          </button>
        </form>
      )}

      {step.kind === 'method' && (
        <>
          {account === null && states.size > 0 && <p className="note demo-note">{t('signin.demoNote')}</p>}
          <form onSubmit={(e) => void submitEmail(e)} noValidate>
            <Field label={t('signin.email')} error={fieldError === 'signin.emailInvalid' ? t(fieldError) : null}>
              {({ id, describedBy, invalid }) => (
                <input
                  id={id}
                  type="email"
                  autoComplete="email"
                  value={email}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
            {formAlert}
            <button type="submit" className="button primary" disabled={busy || !online}>
              {t('signin.sendCode')}
            </button>
          </form>
          <p className="or">{t('signin.or')}</p>
          <button type="button" className="button" disabled={busy || !online} onClick={() => void google()}>
            {t('signin.google')}
          </button>
        </>
      )}

      {step.kind === 'code' && (
        <form onSubmit={(e) => void submitCode(e)} noValidate>
          <p>{t('signin.codeSent', { email: step.email })}</p>
          <Field label={t('signin.code')} error={fieldError === 'signin.codeInvalid' ? t(fieldError) : null}>
            {({ id, describedBy, invalid }) => (
              <input
                id={id}
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                onChange={(e) => setCode(e.target.value)}
              />
            )}
          </Field>
          {formAlert}
          {info !== null && <p role="status">{t(info)}</p>}
          {busy && <p role="status">{t('signin.working')}</p>}
          <button type="submit" className="button primary" disabled={busy}>
            {t('signin.verify')}
          </button>
          <p className="actions">
            <button type="button" className="link-button" disabled={busy} onClick={() => void resend()}>
              {t('signin.resend')}
            </button>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                reset()
                setCode('')
                setStep({ kind: 'method' })
              }}
            >
              {t('signin.otherEmail')}
            </button>
          </p>
        </form>
      )}
    </section>
  )
}
```

- [ ] **Step 12: Style the new pieces**

Append to `web/src/styles.css`:

```css
/* Forms (spec §11.1: every field labelled, errors tied to it) */

.field {
  display: grid;
  gap: var(--space-1);
  margin-bottom: var(--space-4);
}

.field label {
  font-weight: 600;
}

.field input,
.field select {
  min-height: 2.75rem;
  max-width: 24rem;
  padding: var(--space-2) var(--space-3);
  font: inherit;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--ink-soft);
  border-radius: var(--radius);
}

.field input[aria-invalid='true'] {
  border-color: var(--rose);
  border-width: 2px;
}

.field-error,
.form-error {
  margin: 0;
  color: var(--rose);
  font-weight: 600;
}

.field-error::before,
.form-error::before {
  content: '⚠ ';
}

.signin {
  max-width: var(--measure);
}

.signin h1:focus {
  outline: none;
}

.signin .or {
  margin: var(--space-4) 0 var(--space-2);
  color: var(--ink-soft);
}

.demo-note {
  padding: var(--space-3);
  background: var(--amber-soft);
  color: var(--ink);
  border-radius: var(--radius);
}

.button.danger {
  color: var(--rose-ink);
  background: var(--rose);
  border-color: var(--rose);
}

.button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Banners and the sync line */

.banners .banner p {
  margin: 0;
}

.banner-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-1);
}

.notice-line {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) var(--space-3);
  color: var(--ink);
  background: var(--leaf-soft);
  border-radius: var(--radius);
}

.sync-line {
  margin: 0;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.sync-line.warning {
  color: var(--amber);
}

dialog.confirm {
  max-width: min(32rem, calc(100vw - 2rem));
  padding: var(--space-5);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

dialog.confirm::backdrop {
  background: rgb(20 28 51 / 0.45);
}
```

The field borders use `--ink-soft`, not 6a's `--rule`, so that a text field's boundary meets WCAG 1.4.11's 3:1. Unlike a labelled button, an empty input has no text to identify it.

- [ ] **Step 13: Run everything**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS. If a 6a test looked for the demo banner's exact text inside a `<p className="banner">`, it still finds it by text.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 14: Look at it**

Run the app against the Worker: in one terminal `pnpm --filter @wordado/server dev`, in another `pnpm --filter @wordado/web dev`. Open `http://localhost:5173` and check the following.

1. Study one word in the demo.
2. Choose "Create an account".
3. Pass the gate, enter any email, and copy the code from the Worker's terminal (`Sign-in code for …`).
4. After signing in, the notice says the demo's words are in the account.
5. The masthead reads "All progress saved to your account" within a moment.
6. Check the screen at 390 px and at 1280 px, in light and dark.

- [ ] **Step 15: Commit**

```bash
git add web/src
git commit -m "feat(web): sign-in behind the age gate, by code or Google; banners, notices and the sync status"
```

---

### Task 9: `web`: the settings screen — studying, audio, language and the account

Spec §7.1–§7.4 and §11.1 settings, every field already validated by `core`'s `validateSettingsPatch`, now get a screen. It also holds the whole-level audio download (spec §9.3), the interface language (spec §11.2), and the account: export, sign out, delete (spec §11). Each section is its own component under `web/src/settings/`, so Tasks 10, 12 and 13 add theirs without touching the others.

**Files:**
- Create: `web/src/settings/fields.ts`, `web/src/settings/StudySettings.tsx`, `web/src/settings/AudioDownload.tsx`, `web/src/settings/LanguageSettings.tsx`, `web/src/settings/AccountSettings.tsx`, `web/src/screens/Settings.tsx`
- Modify: `web/src/content/audio.ts` (`AudioPort.prefetch`), `web/src/test/fixtures.tsx` (`fakeAudio`), `web/src/router.tsx`, `web/src/app/App.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`, `web/src/styles.css`
- Test: `web/src/settings/fields.test.ts`, `web/src/screens/Settings.test.tsx`, `web/src/router.test.tsx` (modify)

**Interfaces:**
- Consumes:
  - `Client.updateSettings` and `Client.levelClips` (Task 2).
  - `AccountActions` (Task 7).
  - `ConfirmDialog` (Task 8), and `EXPORT_URL` (Task 4).
  - `RETENTION_TARGETS`, `MAX_NEW_WORD_LIMIT`, `MAX_REVIEW_CAP` and `CEFR_LEVELS` (`core`).
- Produces:
  - `parseWholeNumber(text, min, max): number | null`.
  - `Route` gains `{ name: 'settings' }` (`/settings`).
  - `AudioPort.prefetch(clips): Promise<number>`.
  - `Settings` renders its sections in this order: `StudySettings`, `AudioDownload`, `LanguageSettings`, `AccountSettings`. Tasks 10, 12 and 13 insert `SetAsideWords`, `ReminderSettings` and `AppSettings`.

- [ ] **Step 1: Write the failing field tests**

Create `web/src/settings/fields.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseWholeNumber } from './fields'

describe('parseWholeNumber', () => {
  it('accepts a whole number within the bounds, around spaces', () => {
    expect(parseWholeNumber('15', 0, 30)).toBe(15)
    expect(parseWholeNumber(' 0 ', 0, 30)).toBe(0)
    expect(parseWholeNumber('30', 0, 30)).toBe(30)
  })

  it('refuses everything else, so junk never reaches updateSettings', () => {
    for (const text of ['', ' ', '45', '-1', '2.5', '1e1', '0x10', 'ten', '１５', '15 words']) {
      expect(parseWholeNumber(text, 0, 30)).toBeNull()
    }
  })
})
```

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/settings/fields.test.ts`
Expected: FAIL — `./fields` does not exist.

Create `web/src/settings/fields.ts`:

```ts
/**
 * A whole number typed by the learner, within `min`–`max`; null for
 * anything else. Only ASCII digits: `Number()` alone would accept '1e1',
 * '0x10' and full-width digits.
 */
export function parseWholeNumber(text: string, min: number, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d{1,6}$/.test(trimmed)) return null
  const value = Number(trimmed)
  return value >= min && value <= max ? value : null
}
```

Run it again. Expected: PASS.

- [ ] **Step 2: Add `prefetch` to `AudioPort`**

In `web/src/content/audio.ts`, add to `AudioPort`:

```ts
  /** Fetches, verifies and caches clips ahead of need (spec §9.3); resolves with how many were added. */
  prefetch(clips: readonly AudioClip[]): Promise<number>
```

`AudioStore` already implements it. In `web/src/test/fixtures.tsx`, give `fakeAudio` a default that records what it was asked for:

```ts
export function fakeAudio(over: Partial<AudioPort> = {}): AudioPort & { played: AudioClip[]; fetched: AudioClip[] } {
  const played: AudioClip[] = []
  const fetched: AudioClip[] = []
  return {
    played,
    fetched,
    cachedClips: () => new Set(),
    streamable: () => false,
    play: async (clip) => {
      played.push(clip)
    },
    prefetch: async (clips) => {
      fetched.push(...clips)
      return clips.length
    },
    ...over,
  }
}
```

- [ ] **Step 3: Add the route and the strings**

In `web/src/router.tsx`, add `| { readonly name: 'settings' }` to `Route` and `case '/settings': return { name: 'settings' }` to `parseRoute`. Add to `router.test.tsx`:

```ts
  it('routes settings', () => {
    expect(parseRoute('/settings', '')).toEqual({ name: 'settings' })
    expect(routeHref({ name: 'settings' })).toBe('/settings')
  })
```

In `web/src/app/App.tsx`:

1. Add `{ route: { name: 'settings' }, label: 'nav.settings' }` to `NAV`, after progress.
2. Add `case 'settings': return <Settings />` to `Screen`, importing `Settings` from `../screens/Settings`.

Add to `web/src/i18n/en.ts`, after `'nav.progress'`:

```ts
  'nav.settings': 'Settings',
```

and after the `sync.*` block:

```ts
  'settings.title': 'Settings',
  'settings.saved': 'Saved',
  'settings.study': 'Studying',
  'settings.level': 'Your level',
  'settings.levelHint': 'Words below your level count as known and are not taught. Changing it deletes nothing.',
  'level.A1': 'A1 · Beginner',
  'level.A2': 'A2 · Elementary',
  'level.B1': 'B1 · Intermediate',
  'level.B2': 'B2 · Upper intermediate',
  'level.C1': 'C1 · Advanced',
  'settings.newWords': 'New words a day',
  'settings.newWordsHint': 'From 0 to {max}. With 0 you only review.',
  'settings.newWordsInvalid': 'Enter a whole number from 0 to {max}.',
  'settings.reviewCap': 'Reviews a day, at most',
  'settings.reviewCapHint': 'From 0 to {max}. When more are due, new words wait until the backlog is under it.',
  'settings.reviewCapInvalid': 'Enter a whole number from 0 to {max}.',
  'settings.retention': 'How firmly to remember',
  'settings.retention.relaxed': 'Relaxed',
  'settings.retention.relaxedHint': 'Fewer reviews; you forget a little more.',
  'settings.retention.standard': 'Standard',
  'settings.retention.standardHint': 'The balance most learners want.',
  'settings.retention.intensive': 'Intensive',
  'settings.retention.intensiveHint': 'More reviews; you forget less.',
  'settings.goal': 'Set a daily goal',
  'settings.goalHint': 'A day also counts toward your streak once you answer this many.',
  'settings.goalAnswers': 'Answers a day',
  'settings.goalInvalid': 'Enter a whole number from 1 to {max}.',
  'settings.audio': 'Play audio, and include listening exercises',
  'settings.latency': 'Count slow answers as “hard”',
  'settings.latencyHint': 'Switch this off to be graded on whether you are right, not how quickly.',
  'settings.saveFailed': 'Your change wasn’t saved: {message}',

  'settings.audioDownload': 'Audio for offline study',
  'settings.audioDownloadHint': 'Download the audio of every {level} word now, for example on Wi-Fi.',
  'settings.audioDownloadButton': 'Download {level} audio',
  'settings.audioDownloaded': '{done} of {total} clips on this device',
  'settings.audioOffline': 'Connect to download audio.',

  'settings.language': 'Interface language',
  'settings.languageHint': 'The words are always English; this changes the menus and messages.',

  'settings.account': 'Account',
  'settings.signedInAs': 'Signed in as {email}',
  'settings.export': 'Download your data (JSON)',
  'settings.exportOffline': 'Connect to download your data.',
  'settings.signOut': 'Sign out',
  'settings.unsyncedTitle': 'Some answers haven’t synced',
  'settings.unsyncedBody': 'This device couldn’t reach Wordado. Signing out now deletes the answers that haven’t synced.',
  'settings.unsyncedConfirm': 'Sign out and delete them',
  'settings.delete': 'Delete your account',
  'settings.deleteTitle': 'Delete your account?',
  'settings.deleteBody': 'Your account, every answer and every setting are deleted from Wordado’s servers and from this device. This can’t be undone.',
  'settings.deleteUnderstand': 'I understand that my progress is deleted for good',
  'settings.deleteConfirm': 'Delete my account',
  'settings.deleteOffline': 'Connect to delete your account.',
  'settings.demo': 'You are trying Wordado without an account. Your progress stays on this device.',
```

and the same keys to `web/src/i18n/bg.ts`:

```ts
  'nav.settings': 'Настройки',
```

```ts
  'settings.title': 'Настройки',
  'settings.saved': 'Запазено',
  'settings.study': 'Учене',
  'settings.level': 'Вашето ниво',
  'settings.levelHint': 'Думите под вашето ниво се смятат за известни и не се преподават. Промяната не изтрива нищо.',
  'level.A1': 'A1 · Начинаещи',
  'level.A2': 'A2 · Основно ниво',
  'level.B1': 'B1 · Средно ниво',
  'level.B2': 'B2 · Над средното',
  'level.C1': 'C1 · Напреднали',
  'settings.newWords': 'Нови думи на ден',
  'settings.newWordsHint': 'От 0 до {max}. С 0 само преговаряте.',
  'settings.newWordsInvalid': 'Въведете цяло число от 0 до {max}.',
  'settings.reviewCap': 'Прегледи на ден, най-много',
  'settings.reviewCapHint': 'От 0 до {max}. Когато чакат повече, новите думи изчакват, докато изостаналите паднат под този брой.',
  'settings.reviewCapInvalid': 'Въведете цяло число от 0 до {max}.',
  'settings.retention': 'Колко здраво да помните',
  'settings.retention.relaxed': 'Спокойно',
  'settings.retention.relaxedHint': 'По-малко прегледи; забравяте малко повече.',
  'settings.retention.standard': 'Стандартно',
  'settings.retention.standardHint': 'Балансът, който искат повечето.',
  'settings.retention.intensive': 'Интензивно',
  'settings.retention.intensiveHint': 'Повече прегледи; забравяте по-малко.',
  'settings.goal': 'Дневна цел',
  'settings.goalHint': 'Денят се брои за поредицата ви и когато дадете толкова отговора.',
  'settings.goalAnswers': 'Отговори на ден',
  'settings.goalInvalid': 'Въведете цяло число от 1 до {max}.',
  'settings.audio': 'Звук и упражнения за слушане',
  'settings.latency': 'Бавните отговори да се броят за „трудно“',
  'settings.latencyHint': 'Изключете, за да се оценява само дали отговорът е верен, а не колко бързо е даден.',
  'settings.saveFailed': 'Промяната не беше запазена: {message}',

  'settings.audioDownload': 'Звук за учене офлайн',
  'settings.audioDownloadHint': 'Изтеглете звука на всички думи от ниво {level} сега, например през Wi-Fi.',
  'settings.audioDownloadButton': 'Изтеглете звука за {level}',
  'settings.audioDownloaded': '{done} от {total} записа са на това устройство',
  'settings.audioOffline': 'Свържете се, за да изтеглите звука.',

  'settings.language': 'Език на интерфейса',
  'settings.languageHint': 'Думите винаги са на английски; това сменя менютата и съобщенията.',

  'settings.account': 'Профил',
  'settings.signedInAs': 'Влезли сте като {email}',
  'settings.export': 'Изтеглете данните си (JSON)',
  'settings.exportOffline': 'Свържете се, за да изтеглите данните си.',
  'settings.signOut': 'Изход',
  'settings.unsyncedTitle': 'Някои отговори не са синхронизирани',
  'settings.unsyncedBody': 'Това устройство не успя да се свърже с Wordado. Ако излезете сега, несинхронизираните отговори ще бъдат изтрити.',
  'settings.unsyncedConfirm': 'Изход и изтриване',
  'settings.delete': 'Изтрийте профила си',
  'settings.deleteTitle': 'Да изтриете профила си?',
  'settings.deleteBody': 'Профилът ви, всеки отговор и всяка настройка се изтриват от сървърите на Wordado и от това устройство. Това не може да се отмени.',
  'settings.deleteUnderstand': 'Разбирам, че напредъкът ми се изтрива завинаги',
  'settings.deleteConfirm': 'Изтрийте профила ми',
  'settings.deleteOffline': 'Свържете се, за да изтриете профила си.',
  'settings.demo': 'Пробвате Wordado без профил. Напредъкът ви остава на това устройство.',
```

- [ ] **Step 4: Write the failing screen tests**

Create `web/src/screens/Settings.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { MAX_NEW_WORD_LIMIT } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeAccounts, fakeAudio, renderWith, setup } from '../test/fixtures'
import { Settings } from './Settings'

beforeEach(() => window.history.replaceState(null, '', '/settings'))
afterEach(cleanup)

const ana = { userId: 'u1', email: 'ana@example.com' }

/** Types into a number field and leaves it, as a learner does; the value is saved on leaving. */
async function typeAndLeave(label: string, value: string) {
  const field = screen.getByLabelText(label)
  fireEvent.change(field, { target: { value } })
  await act(async () => fireEvent.blur(field))
}

describe('Settings: studying (spec §7.1, §7.4, §11.1)', () => {
  it('shows the current settings', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect((screen.getByLabelText('New words a day') as HTMLInputElement).value).toBe('10')
    expect((screen.getByLabelText('Reviews a day, at most') as HTMLInputElement).value).toBe('100')
    expect((screen.getByRole('radio', { name: /Standard/ }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('radio', { name: 'A1 · Beginner' }) as HTMLInputElement).checked).toBe(true)
  })

  it('saves a valid number when the field is left', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await typeAndLeave('New words a day', '15')
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(15)
  })

  it.each(['', '45', '-1', '2.5', 'ten'])('refuses %j, says why at the field, and saves nothing', async (value) => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await typeAndLeave('New words a day', value)
    const field = screen.getByLabelText('New words a day')
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe(`Enter a whole number from 0 to ${MAX_NEW_WORD_LIMIT}.`)
    expect(field.getAttribute('aria-describedby')).toContain(alert.id)
    expect(ctx.client.snapshot.settings.newWordLimit).toBe(10)
  })

  it('saves retention, audio and latency grading as they change', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: /Intensive/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Play audio, and include listening exercises' })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Count slow answers as “hard”' })))
    expect(ctx.client.snapshot.settings).toMatchObject({ retention: 'intensive', audio: false, latencyGrading: false })
  })

  it('sets and clears a daily goal', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.queryByLabelText('Answers a day')).toBeNull()
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Set a daily goal' })))
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(20)
    await typeAndLeave('Answers a day', '35')
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(35)
    await typeAndLeave('Answers a day', '0')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(ctx.client.snapshot.settings.dailyGoal).toBe(35)
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Set a daily goal' })))
    expect(ctx.client.snapshot.settings.dailyGoal).toBeNull()
  })

  it('offers only the levels the words come in', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    const levels = within(screen.getByRole('group', { name: 'Your level' })).getAllByRole('radio')
    // The bundled sample is A1 only.
    expect(levels.map((r) => r.getAttribute('value'))).toEqual(['A1'])
  })
})

describe('Settings: audio for offline study (spec §9.3)', () => {
  it('downloads every clip of the learner’s level', async () => {
    const ctx = await setup()
    const audio = fakeAudio()
    renderWith(<Settings />, { ...ctx, audio })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Download A1 audio' })))
    expect(audio.fetched.map((c) => c.clipId).sort()).toEqual(ctx.client.levelClips('A1').map((c) => c.clipId).sort())
  })
})

describe('Settings: the account (spec §11)', () => {
  it('offers an account from the demo, and no export or deletion', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.getByText(/without an account/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Create an account' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Download your data (JSON)' })).toBeNull()
  })

  it('downloads the export with the session', async () => {
    const ctx = await setup()
    renderWith(<Settings />, { ...ctx, account: ana })
    expect(screen.getByText('Signed in as ana@example.com')).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Download your data (JSON)' })
    expect(link.getAttribute('href')).toBe('/v1/export')
    expect(link.hasAttribute('download')).toBe(true)
  })

  it('signs out, and asks first when answers could not be synced', async () => {
    const ctx = await setup()
    let first = true
    const accounts = fakeAccounts({
      signOut: async (options) => {
        accounts.calls.push(`signOut${options?.force ? ' force' : ''}`)
        if (first && !options?.force) {
          first = false
          return 'unsynced'
        }
        return 'signed-out'
      },
    })
    renderWith(<Settings />, { ...ctx, account: ana, accounts })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out' })))
    expect(screen.getByRole('dialog', { name: 'Some answers haven’t synced' })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Sign out and delete them' })))
    expect(accounts.calls).toEqual(['signOut', 'signOut force'])
  })

  it('deletes the account only once the learner says they understand', async () => {
    const ctx = await setup()
    const accounts = fakeAccounts()
    renderWith(<Settings />, { ...ctx, account: ana, accounts })
    fireEvent.click(screen.getByRole('button', { name: 'Delete your account' }))
    const confirm = screen.getByRole('button', { name: 'Delete my account' }) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }))
    expect(confirm.disabled).toBe(false)
    await act(async () => fireEvent.click(confirm))
    expect(accounts.calls).toEqual(['deleteAccount'])
  })
})
```

- [ ] **Step 5: Run it to see it fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/screens/Settings.test.tsx`
Expected: FAIL — `./Settings` does not exist.

- [ ] **Step 6: Write the sections**

Create `web/src/settings/StudySettings.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { CEFR_LEVELS, MAX_NEW_WORD_LIMIT, MAX_REVIEW_CAP, RETENTION_TARGETS, type CefrLevel, type RetentionSetting, type Settings } from '@wordado/core'
import { useEffect, useId, useState } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'
import { parseWholeNumber } from './fields'

/** The highest daily goal the screen offers; `core` allows any positive whole number. */
const MAX_DAILY_GOAL = 1000
/** What "Set a daily goal" starts from. */
const DEFAULT_DAILY_GOAL = 20

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Saves one settings field, and says so or says why not (spec §11.1: the result is announced). */
function useSave(): { save(patch: Partial<Settings>): Promise<void>; status: string | null } {
  const { t } = useT()
  const client = useClient()
  const [status, setStatus] = useState<string | null>(null)
  return {
    status,
    save: async (patch) => {
      try {
        await client.updateSettings(patch)
        setStatus(t('settings.saved'))
      } catch (err) {
        setStatus(t('settings.saveFailed', { message: messageOf(err) }))
      }
    },
  }
}

/**
 * A number field saved when it is left or Enter is pressed. What the
 * learner types stays in the field until it is valid; an invalid value is
 * explained at the field and never reaches `updateSettings`.
 */
function NumberSetting(props: {
  readonly label: string
  readonly hint: string
  readonly invalid: string
  readonly value: number
  readonly min: number
  readonly max: number
  onSave(value: number): Promise<void>
}) {
  const id = useId()
  const hintId = useId()
  const errorId = useId()
  const [text, setText] = useState(String(props.value))
  const [error, setError] = useState(false)
  // A value changed elsewhere (a pull, another field) replaces the text unless the learner is mid-edit with an error.
  useEffect(() => {
    if (!error) setText(String(props.value))
  }, [props.value])
  const commit = async () => {
    const value = parseWholeNumber(text, props.min, props.max)
    setError(value === null)
    if (value !== null && value !== props.value) await props.onSave(value)
  }
  return (
    <div className="field">
      <label htmlFor={id}>{props.label}</label>
      <p className="note" id={hintId}>
        {props.hint}
      </p>
      <input
        id={id}
        inputMode="numeric"
        value={text}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error || undefined}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit()
        }}
      />
      {error && (
        <p className="field-error" role="alert" id={errorId}>
          {props.invalid}
        </p>
      )}
    </div>
  )
}

const RETENTIONS = Object.keys(RETENTION_TARGETS) as RetentionSetting[]

/** Level, limits, retention, goal, audio and latency grading (spec §7.1, §7.2, §7.4, §8.4, §11.1). */
export function StudySettings() {
  const { t } = useT()
  const { settings, corpus } = useClientSnapshot()
  const { save, status } = useSave()
  // The levels the installed words come in, and the learner's own: a level with no words would teach nothing.
  const shipped = new Set<CefrLevel>(corpus?.units.map((u) => u.level) ?? [])
  shipped.add(settings.declaredLevel)
  const levels = CEFR_LEVELS.filter((l) => shipped.has(l))
  return (
    <section aria-labelledby="settings-study">
      <h2 id="settings-study">{t('settings.study')}</h2>
      <fieldset className="choices">
        <legend>{t('settings.level')}</legend>
        <p className="note">{t('settings.levelHint')}</p>
        {levels.map((level) => (
          <label key={level}>
            <input type="radio" name="level" value={level} checked={settings.declaredLevel === level} onChange={() => void save({ declaredLevel: level })} />
            {t(`level.${level}` as MessageKey)}
          </label>
        ))}
      </fieldset>
      <NumberSetting
        label={t('settings.newWords')}
        hint={t('settings.newWordsHint', { max: MAX_NEW_WORD_LIMIT })}
        invalid={t('settings.newWordsInvalid', { max: MAX_NEW_WORD_LIMIT })}
        value={settings.newWordLimit}
        min={0}
        max={MAX_NEW_WORD_LIMIT}
        onSave={(newWordLimit) => save({ newWordLimit })}
      />
      <NumberSetting
        label={t('settings.reviewCap')}
        hint={t('settings.reviewCapHint', { max: MAX_REVIEW_CAP })}
        invalid={t('settings.reviewCapInvalid', { max: MAX_REVIEW_CAP })}
        value={settings.reviewCap}
        min={0}
        max={MAX_REVIEW_CAP}
        onSave={(reviewCap) => save({ reviewCap })}
      />
      <fieldset className="choices">
        <legend>{t('settings.retention')}</legend>
        {RETENTIONS.map((r) => (
          <label key={r}>
            <input type="radio" name="retention" value={r} checked={settings.retention === r} onChange={() => void save({ retention: r })} />
            <span>
              {t(`settings.retention.${r}` as MessageKey)} <span className="note">— {t(`settings.retention.${r}Hint` as MessageKey)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="check">
          <input
            type="checkbox"
            checked={settings.dailyGoal !== null}
            onChange={(e) => void save({ dailyGoal: e.target.checked ? DEFAULT_DAILY_GOAL : null })}
          />
          {t('settings.goal')}
        </label>
        <p className="note">{t('settings.goalHint')}</p>
      </div>
      {settings.dailyGoal !== null && (
        <NumberSetting
          label={t('settings.goalAnswers')}
          hint=""
          invalid={t('settings.goalInvalid', { max: MAX_DAILY_GOAL })}
          value={settings.dailyGoal}
          min={1}
          max={MAX_DAILY_GOAL}
          onSave={(dailyGoal) => save({ dailyGoal })}
        />
      )}
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={settings.audio} onChange={(e) => void save({ audio: e.target.checked })} />
          {t('settings.audio')}
        </label>
      </div>
      <div className="field">
        <label className="check">
          <input type="checkbox" checked={settings.latencyGrading} onChange={(e) => void save({ latencyGrading: e.target.checked })} />
          {t('settings.latency')}
        </label>
        <p className="note">{t('settings.latencyHint')}</p>
      </div>
      <p className="note" role="status">
        {status}
      </p>
    </section>
  )
}
```

The keys `level.${level}` and `settings.retention.${r}` are built at run time. The cast is safe because `en.ts` has a key for every CEFR level and every retention setting, and the settings test renders them. `NumberSetting` with an empty `hint` renders an empty note, which is harmless.

Create `web/src/settings/AudioDownload.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useOnline } from '../useOnline'

/** The whole-level audio download (spec §9.3): the learner chooses when, for example on Wi-Fi. */
export function AudioDownload() {
  const { t } = useT()
  const client = useClient()
  const { settings } = useClientSnapshot()
  const { audio } = useApp()
  const online = useOnline()
  const [busy, setBusy] = useState(false)
  const [, rerender] = useState(0)
  const level = settings.declaredLevel
  const clips = client.levelClips(level)
  if (!settings.audio || clips.length === 0) return null
  const cached = audio.cachedClips()
  const done = clips.filter((c) => cached.has(c.clipId)).length
  const download = async () => {
    setBusy(true)
    try {
      await audio.prefetch(clips)
    } finally {
      setBusy(false)
      rerender((n) => n + 1)
    }
  }
  return (
    <section aria-labelledby="settings-audio">
      <h2 id="settings-audio">{t('settings.audioDownload')}</h2>
      <p className="note">{t('settings.audioDownloadHint', { level })}</p>
      <button type="button" className="button" disabled={!online || busy || done === clips.length} onClick={() => void download()}>
        {t('settings.audioDownloadButton', { level })}
      </button>
      <p className="note" role="status">
        {online ? t('settings.audioDownloaded', { done, total: clips.length }) : t('settings.audioOffline')}
      </p>
    </section>
  )
}
```

The test's `fakeAudio` reports no cached clips, and happy-dom reports `navigator.onLine` as true, so the button is enabled.

Create `web/src/settings/LanguageSettings.tsx`:

```tsx
import { LOCALES, useT, type Locale } from '../i18n/i18n'

const ENDONYM: Readonly<Record<Locale, string>> = { bg: 'Български', en: 'English' }

/** The interface language (spec §11.2), also in the masthead. */
export function LanguageSettings() {
  const { t, locale, setLocale } = useT()
  return (
    <section aria-labelledby="settings-language">
      <h2 id="settings-language">{t('settings.language')}</h2>
      <fieldset className="choices">
        <legend className="visually-hidden">{t('settings.language')}</legend>
        <p className="note">{t('settings.languageHint')}</p>
        {LOCALES.map((l) => (
          <label key={l} lang={l}>
            <input type="radio" name="locale" value={l} checked={locale === l} onChange={() => setLocale(l)} />
            {ENDONYM[l]}
          </label>
        ))}
      </fieldset>
    </section>
  )
}
```

Move `ENDONYM` out of `App.tsx` into `web/src/i18n/i18n.tsx` as an exported constant, and import it in both files so there is one copy.

Create `web/src/settings/AccountSettings.tsx`:

```tsx
import { useState } from 'react'
import { EXPORT_URL } from '../account/api'
import { ConfirmDialog } from '../app/Confirm'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link, navigate } from '../router'
import { useOnline } from '../useOnline'

/** The account (spec §11): the export, signing out, and self-service deletion. The demo gets the way in. */
export function AccountSettings() {
  const { t } = useT()
  const { account, accounts } = useApp()
  const online = useOnline()
  const [dialog, setDialog] = useState<'unsynced' | 'delete' | null>(null)
  const [understood, setUnderstood] = useState(false)

  if (account === null) {
    return (
      <section aria-labelledby="settings-account">
        <h2 id="settings-account">{t('settings.account')}</h2>
        <p>{t('settings.demo')}</p>
        <Link className="button primary" to={{ name: 'signin' }}>
          {t('banner.demoCreate')}
        </Link>
      </section>
    )
  }

  const signOut = async (force: boolean) => {
    const outcome = await accounts.signOut({ force })
    if (outcome === 'unsynced') setDialog('unsynced')
    else navigate({ name: 'home' }, { replace: true })
  }

  return (
    <section aria-labelledby="settings-account">
      <h2 id="settings-account">{t('settings.account')}</h2>
      <p>{t('settings.signedInAs', { email: account.email })}</p>
      <ul className="settings-actions">
        <li>
          {online ? (
            <a href={EXPORT_URL} download>
              {t('settings.export')}
            </a>
          ) : (
            <span className="note">{t('settings.exportOffline')}</span>
          )}
        </li>
        <li>
          <button type="button" className="button" onClick={() => void signOut(false)}>
            {t('settings.signOut')}
          </button>
        </li>
        <li>
          <button type="button" className="button" disabled={!online} onClick={() => setDialog('delete')}>
            {t('settings.delete')}
          </button>
          {!online && <p className="note">{t('settings.deleteOffline')}</p>}
        </li>
      </ul>
      {dialog === 'unsynced' && (
        <ConfirmDialog
          title={t('settings.unsyncedTitle')}
          body={<p>{t('settings.unsyncedBody')}</p>}
          confirmLabel={t('settings.unsyncedConfirm')}
          onConfirm={() => signOut(true)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'delete' && (
        <ConfirmDialog
          title={t('settings.deleteTitle')}
          body={<p>{t('settings.deleteBody')}</p>}
          confirmLabel={t('settings.deleteConfirm')}
          confirmDisabled={!understood}
          onConfirm={async () => {
            await accounts.deleteAccount()
            navigate({ name: 'home' }, { replace: true })
          }}
          onClose={() => {
            setDialog(null)
            setUnderstood(false)
          }}
        >
          <label className="check">
            <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
            {t('settings.deleteUnderstand')}
          </label>
        </ConfirmDialog>
      )}
    </section>
  )
}
```

Create `web/src/screens/Settings.tsx`:

```tsx
import { useT } from '../i18n/i18n'
import { AccountSettings } from '../settings/AccountSettings'
import { AudioDownload } from '../settings/AudioDownload'
import { LanguageSettings } from '../settings/LanguageSettings'
import { StudySettings } from '../settings/StudySettings'

/** Settings (spec §7, §9.3, §11): each section is its own component. */
export function Settings() {
  const { t } = useT()
  return (
    <div className="settings">
      <h1>{t('settings.title')}</h1>
      <StudySettings />
      <AudioDownload />
      <LanguageSettings />
      <AccountSettings />
    </div>
  )
}
```

- [ ] **Step 7: Style the settings page**

Append to `web/src/styles.css`:

```css
/* Settings */

.settings {
  max-width: var(--measure);
}

.settings > section {
  padding: var(--space-4) 0;
  border-top: 1px solid var(--rule);
}

.choices {
  display: grid;
  gap: var(--space-2);
  margin: 0 0 var(--space-4);
  padding: 0;
  border: none;
}

.choices legend {
  margin-bottom: var(--space-1);
  font-weight: 600;
}

.choices label,
label.check {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  min-height: 2.75rem;
}

.choices input,
label.check input {
  width: 1.25rem;
  height: 1.25rem;
  accent-color: var(--rose);
}

.settings-actions {
  display: grid;
  gap: var(--space-3);
  margin: var(--space-3) 0 0;
  padding: 0;
  list-style: none;
}
```

- [ ] **Step 8: Run everything**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/src
git commit -m "feat(web): settings — level, limits, retention, goal, audio, latency grading, the level's audio, language, and the account"
```

---

### Task 10: `web`: known and suspended words on the card, the path and in settings; the onboarding question; listening that follows the connection

Spec §7.4 lets a learner flag any word *known* ("I don't need this") or *suspended* ("not now"). Either removes it from new words and review, keeps its state, and can be undone. This task puts the flag where the learner meets the word:

- on the study card (`StudyRun.setAside`, Task 2);
- on each unit's word list in the path, including words not reached yet;
- as a list in settings to bring words back.

It also adds spec §8.6's optional "What do you want English for?" on Today. And it fixes 6a's deferred item: Home's listening link now follows `online`/`offline` events and the audio setting.

**Files:**
- Create: `web/src/study/FlagControls.tsx`, `web/src/settings/SetAsideWords.tsx`
- Modify: `web/src/study/RunView.tsx`, `web/src/screens/Path.tsx`, `web/src/screens/Home.tsx`, `web/src/screens/Settings.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`, `web/src/styles.css`
- Test: `web/src/study/RunView.test.tsx`, `web/src/screens/Path.test.tsx`, `web/src/screens/Home.test.tsx`, `web/src/screens/Settings.test.tsx` (all modify)

**Interfaces:**
- Consumes:
  - `StudyRun.setAside` and `RunSnapshot.setAside` (Task 2).
  - `Client.setFlag`, `ClientSnapshot.flags` and `offeredThemes` (6a).
  - `useOnline` (Task 8).
- Produces: `FlagControls` props `{ wordId: WordId; headword: string }`, which renders the flag and the buttons to change it. Nothing later depends on it but settings.

- [ ] **Step 1: Add the strings**

Add to `web/src/i18n/en.ts` (the study keys after `'study.aboveLevel'`, the others at the end of their groups):

```ts
  'study.setAsideLabel': 'Skip this word',
  'study.known': 'I know this word',
  'study.notNow': 'Not now',
  'done.setAside': { one: '{count} word set aside. You can bring it back in settings.', other: '{count} words set aside. You can bring them back in settings.' },

  'path.words': { one: '{count} word', other: '{count} words' },
  'path.wordNew': 'Not started',

  'flag.known': 'Known',
  'flag.suspended': 'Not now',
  'flag.markKnown': 'I know it',
  'flag.markLater': 'Not now',
  'flag.bringBack': 'Bring back',
  'flag.action': '{action}: {word}',

  'settings.setAside': 'Words set aside',
  'settings.setAsideHint': 'Words you know or put off are never taught or reviewed. Bring one back and it returns with its progress.',
  'settings.setAsideNone': 'No words are set aside.',

  'onboard.title': 'What do you want English for?',
  'onboard.hint': 'Pick one and its words come first. You can change it any time under Themes.',
  'onboard.skip': 'Skip',
```

and to `web/src/i18n/bg.ts`:

```ts
  'study.setAsideLabel': 'Пропуснете тази дума',
  'study.known': 'Знам тази дума',
  'study.notNow': 'Не сега',
  'done.setAside': { one: '{count} дума е оставена настрана. Можете да я върнете от настройките.', other: '{count} думи са оставени настрана. Можете да ги върнете от настройките.' },

  'path.words': { one: '{count} дума', other: '{count} думи' },
  'path.wordNew': 'Незапочната',

  'flag.known': 'Известна',
  'flag.suspended': 'Не сега',
  'flag.markKnown': 'Знам я',
  'flag.markLater': 'Не сега',
  'flag.bringBack': 'Върнете',
  'flag.action': '{action}: {word}',

  'settings.setAside': 'Оставени настрана думи',
  'settings.setAsideHint': 'Думите, които знаете или отлагате, не се преподават и не се преговарят. Върнете дума и тя се връща с напредъка си.',
  'settings.setAsideNone': 'Няма оставени настрана думи.',

  'onboard.title': 'За какво ви е английският?',
  'onboard.hint': 'Изберете и думите от темата ще са първи. Можете да го промените по всяко време в „Теми“.',
  'onboard.skip': 'Пропусни',
```

- [ ] **Step 2: Write the failing tests**

Append to `web/src/study/RunView.test.tsx`, adding `StudyRun` to its `@wordado/client-data` import and `act`, `fireEvent` and `screen` to its testing-library import if they are missing:

```tsx
describe('setting a word aside (spec §7.4)', () => {
  it('flags the word on the card, records no answer, and shows the next word', async () => {
    const ctx = await setup()
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'session', mode: 'flashcard', cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="session" />, ctx)
    const first = run.snapshot.item!.entry.headword
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I know this word' })))
    expect(screen.getByText(/^0 done/)).toBeTruthy()
    expect(document.querySelector('.hw-word')?.textContent).not.toBe(first)
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
  })

  it('says how many words were set aside when the run ends', async () => {
    const ctx = await setup()
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'session', mode: 'flashcard', cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="session" />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(screen.getByText('1 word set aside. You can bring it back in settings.')).toBeTruthy()
  })
})
```

Append to `web/src/screens/Path.test.tsx`, inside `describe('Path', …)`:

```tsx
  it('lists a unit’s words, and sets one aside before it is ever taught (spec §7.4)', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    const food = unit('Food and drink')
    food.querySelector('details')!.open = true
    const words = within(food).getAllByRole('listitem')
    expect(words).toHaveLength(20)
    const first = words[0]!
    const headword = first.querySelector('[lang="en"]')!.textContent!
    expect(within(first).getByText('Not started')).toBeTruthy()
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `I know it: ${headword}` })))
    expect(within(first).getByText('Known')).toBeTruthy()
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
    await act(async () => fireEvent.click(within(first).getByRole('button', { name: `Bring back: ${headword}` })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
  })
```

Add `fireEvent` to that file's testing-library import.

Append to `web/src/screens/Home.test.tsx`, adding `fireEvent` to its imports:

```tsx
describe('Home: the onboarding question (spec §8.6)', () => {
  it('asks what English is for, once nothing is studied, and makes the chosen theme come first', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    const question = screen.getByRole('group', { name: 'What do you want English for?' })
    await act(async () => fireEvent.click(within(question).getByRole('button', { name: 'Daily life' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
  })

  it('can be skipped, and is gone once a word is studied', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<Home />, ctx)
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
    unmount()
    await answerNew(ctx.client, ctx.env, 1)
    renderWith(<Home />, ctx)
    expect(screen.queryByRole('group', { name: 'What do you want English for?' })).toBeNull()
  })
})

describe('Home: listening follows the connection and the audio setting (spec §9.3, §11.1)', () => {
  it('drops listening when the device goes offline with nothing cached, and offers it again online', async () => {
    const ctx = await setup()
    const online = { value: true }
    Object.defineProperty(navigator, 'onLine', { get: () => online.value, configurable: true })
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => navigator.onLine }) })
    expect(screen.getByRole('link', { name: 'Listening' })).toBeTruthy()
    online.value = false
    act(() => {
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
    online.value = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.getByRole('link', { name: 'Listening' })).toBeTruthy()
  })

  it('never offers listening with audio switched off', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ audio: false })
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => true }) })
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
  })
})
```

Add `within` to that file's testing-library import.

Append to `web/src/screens/Settings.test.tsx`:

```tsx
describe('Settings: words set aside (spec §7.4)', () => {
  it('lists them and brings one back', async () => {
    const ctx = await setup()
    await ctx.client.setFlag('c:hello-1' as WordId, 'suspended')
    renderWith(<Settings />, ctx)
    const list = screen.getByRole('region', { name: 'Words set aside' })
    expect(within(list).getByText('hello')).toBeTruthy()
    expect(within(list).getByText('Not now')).toBeTruthy()
    await act(async () => fireEvent.click(within(list).getByRole('button', { name: 'Bring back: hello' })))
    expect(ctx.client.snapshot.flags.size).toBe(0)
    expect(within(list).getByText('No words are set aside.')).toBeTruthy()
  })
})
```

Add `import type { WordId } from '@wordado/core'` to that file.

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/study src/screens`
Expected: FAIL — no set-aside buttons, no word lists, no onboarding group, and the listening link does not follow `offline`.

- [ ] **Step 4: The shared flag controls**

Create `web/src/study/FlagControls.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { masteryTier, type WordId } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

/**
 * A word's standing and the buttons that change it (spec §7.4): set aside as
 * known or for later, or brought back. Each button's name says which word it
 * acts on, beginning with its visible text (WCAG 2.5.3).
 */
export function FlagControls(props: { readonly wordId: WordId; readonly headword: string }) {
  const { t } = useT()
  const client = useClient()
  const { flags, states } = useClientSnapshot()
  const flag = flags.get(props.wordId)
  const state = states.get(props.wordId)
  const status = flag === 'known' ? t('flag.known') : flag === 'suspended' ? t('flag.suspended') : state ? t(TIER_LABEL[masteryTier(state)]) : t('path.wordNew')
  const button = (label: string, next: 'known' | 'suspended' | null) => (
    <button type="button" className="link-button" aria-label={t('flag.action', { action: label, word: props.headword })} onClick={() => void client.setFlag(props.wordId, next)}>
      {label}
    </button>
  )
  return (
    <>
      <span className="word-status">{status}</span>
      <span className="word-actions">
        {flag ? (
          button(t('flag.bringBack'), null)
        ) : (
          <>
            {button(t('flag.markKnown'), 'known')}
            {button(t('flag.markLater'), 'suspended')}
          </>
        )}
      </span>
    </>
  )
}
```

- [ ] **Step 5: On the card**

In `web/src/study/RunView.tsx`, inside the `.card` div, after the report button, add:

```tsx
        {(snapshot.phase === 'prompt' || snapshot.phase === 'revealed') && (
          <div className="set-aside" role="group" aria-label={t('study.setAsideLabel')}>
            <button type="button" className="link-button" onClick={() => void run.setAside('known')}>
              {t('study.known')}
            </button>
            <button type="button" className="link-button" onClick={() => void run.setAside('suspended')}>
              {t('study.notNow')}
            </button>
          </div>
        )}
```

In `Done`, after the `unlocked` paragraphs, add:

```tsx
      {snapshot.setAside > 0 && <p>{t('done.setAside', { count: snapshot.setAside })}</p>}
```

The next item takes focus through the existing effect on `item`, so a keyboard learner who sets a word aside lands on the next prompt.

- [ ] **Step 6: On the path**

In `web/src/screens/Path.tsx`:

1. Import `FlagControls` from `../study/FlagControls` and `useClient` from `@wordado/client-data`.
2. Inside each unit's `<li>`, after the introduced-count note, add:

```tsx
                      <details className="unit-words">
                        <summary>{t('path.words', { count: unit.wordIds.length })}</summary>
                        <ul>
                          {unit.wordIds.map((wordId) => {
                            const entry = client.entry(wordId)
                            if (!entry) return null
                            return (
                              <li key={wordId}>
                                <span lang="en" className="word-head">
                                  {entry.headword}
                                </span>
                                <FlagControls wordId={wordId} headword={entry.headword} />
                              </li>
                            )
                          })}
                        </ul>
                      </details>
```

with `const client = useClient()` at the top of `Path`. The list is there for locked units too: a learner may set aside a word they already know before the path reaches it.

- [ ] **Step 7: In settings**

Create `web/src/settings/SetAsideWords.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { useT } from '../i18n/i18n'
import { FlagControls } from '../study/FlagControls'

/** Every word set aside, to bring back (spec §7.4). A labelled section is a region, found by its name. */
export function SetAsideWords() {
  const { t } = useT()
  const client = useClient()
  const { flags } = useClientSnapshot()
  const words = [...flags.keys()].map((wordId) => ({ wordId, entry: client.entry(wordId) })).filter((w) => w.entry !== null)
  return (
    <section aria-labelledby="settings-set-aside">
      <h2 id="settings-set-aside">{t('settings.setAside')}</h2>
      <p className="note">{t('settings.setAsideHint')}</p>
      {words.length === 0 ? (
        <p>{t('settings.setAsideNone')}</p>
      ) : (
        <ul className="unit-words">
          {words.map(({ wordId, entry }) => (
            <li key={wordId}>
              <span lang="en" className="word-head">
                {entry!.headword}
              </span>
              <FlagControls wordId={wordId} headword={entry!.headword} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

In `web/src/screens/Settings.tsx`, render `<SetAsideWords />` after `<StudySettings />`.

- [ ] **Step 8: On Today**

In `web/src/screens/Home.tsx`:

1. Import `useState` from `react`, `useClient` from `@wordado/client-data`, `offeredThemes` from `@wordado/core`, `localized` from `../i18n/i18n`, and `useOnline` from `../useOnline`.
2. Read `states` and `settings` from `useClientSnapshot()` beside `plan`, `progress` and `xp`, and add `const client = useClient()`, `const { t, locale } = useT()`, `useOnline()` (called for its subscription) and `const [skipped, setSkipped] = useState(false)`.
3. Replace the `canListen` line with:

```ts
  // Re-evaluated on every `online`/`offline` event (useOnline re-renders), and never with audio off (spec §11.1).
  const canListen = settings.audio && (audio.streamable() || audio.cachedClips().size > 0)
```

4. Right after the `<h1>`, add:

```tsx
      {!skipped && states.size === 0 && settings.activeTheme === null && corpus && offeredThemes(corpus).length > 0 && (
        <div className="onboard" role="group" aria-labelledby="onboard-title">
          <h2 id="onboard-title">{t('onboard.title')}</h2>
          <p className="note">{t('onboard.hint')}</p>
          <ul className="onboard-themes">
            {offeredThemes(corpus).map((theme) => (
              <li key={theme.themeId}>
                <button type="button" className="button" onClick={() => void client.updateSettings({ activeTheme: theme.themeId })}>
                  {localized(theme.name, locale)}
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="link-button" onClick={() => setSkipped(true)}>
            {t('onboard.skip')}
          </button>
        </div>
      )}
```

with `corpus` also read from `useClientSnapshot()`.

The question costs one tap and needs no storage. It shows only while nothing has been studied and no theme is chosen, so the first answer ends it for good.

- [ ] **Step 9: Style it**

Append to `web/src/styles.css`:

```css
/* Set-aside words and the onboarding question */

.set-aside {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  margin-top: var(--space-3);
}

.unit-words ul,
ul.unit-words {
  margin: var(--space-2) 0 0;
  padding: 0;
  list-style: none;
}

.unit-words li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-1) 0;
  border-bottom: 1px solid var(--rule);
}

.word-head {
  font-family: var(--font-entry);
  font-weight: 600;
}

.word-status {
  color: var(--ink-soft);
  font-size: var(--step--1);
}

.word-actions {
  display: flex;
  gap: var(--space-3);
  margin-left: auto;
}

.unit-words summary {
  min-height: 2.75rem;
  padding: var(--space-2) 0;
  cursor: pointer;
}

.onboard {
  margin: var(--space-4) 0;
  padding: var(--space-4);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

.onboard-themes {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
}
```

- [ ] **Step 10: Run everything**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS. 6a's `Path` test finds a unit by `closest('li')` of its heading, which still resolves to the unit, because the word items sit below the heading's own `<li>`.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add web/src
git commit -m "feat(web): known and suspended words on the card, the path and in settings; the onboarding question; listening follows the connection"
```

---

### Task 11: `web`: the placement test

Spec §7.2's optional test, offered from settings and never a step anyone must take. It is the view of Task 3's `PlacementRun`:

- a question at a time, with "I don't know" beside the options;
- digits 1–4 answer, and 0 says "I don't know";
- no right-or-wrong feedback, because the test measures rather than teaches;
- a result the learner can take or leave.

On the A1-only sample the link is replaced by a note saying why.

**Files:**
- Create: `web/src/screens/Placement.tsx`
- Modify: `web/src/router.tsx`, `web/src/app/App.tsx`, `web/src/settings/StudySettings.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`
- Test: `web/src/screens/Placement.test.tsx`, `web/src/router.test.tsx` (modify), `web/src/screens/Settings.test.tsx` (modify)

**Interfaces:**
- Consumes: `PlacementRun`, `PlacementSource`, `placementSource` and `placementAvailable` (Task 3); `Headword` and `Translation` (6a).
- Produces:
  - `Route` gains `{ name: 'placement' }` at `/settings/placement`.
  - `Placement` props `{ source?: PlacementSource }`, so tests can give it a corpus with several bands.

- [ ] **Step 1: Route and strings**

In `web/src/router.tsx`:

1. Add `| { readonly name: 'placement' }` to `Route`.
2. Add `case '/settings/placement': return { name: 'placement' }` to `parseRoute`.
3. Add `case 'placement': return '/settings/placement'` to `routeHref`.

Add to `router.test.tsx`:

```ts
  it('routes the placement test under settings', () => {
    expect(parseRoute('/settings/placement', '')).toEqual({ name: 'placement' })
    expect(routeHref({ name: 'placement' })).toBe('/settings/placement')
  })
```

In `web/src/app/App.tsx`, add `case 'placement': return <Placement />`. Mark the Settings nav item current for the placement route too: `aria-current={item.route.name === route.name || (item.route.name === 'settings' && route.name === 'placement') ? 'page' : undefined}`.

Add to `en.ts`:

```ts
  'placement.link': 'Find your level with a short test',
  'placement.unavailableNote': 'A placement test opens once words of more than one level are installed.',
  'placement.title': 'Find your level',
  'placement.intro': 'About twenty words. Pick the translation, or say you don’t know: a guess only makes the result less useful.',
  'placement.progress': { one: '{count} word answered', other: '{count} words answered' },
  'placement.dontKnow': 'I don’t know',
  'placement.keysHint': 'Keys: 1 to 4 answer, 0 for I don’t know.',
  'placement.resultTitle': 'Your level: {level}',
  'placement.resultBody': 'Words below {level} will count as known. Nothing you have studied is deleted, and you can change your level in settings at any time.',
  'placement.accept': 'Use {level}',
  'placement.keep': 'Keep {level}',
  'placement.acceptedTitle': 'Your level is now {level}',
  'placement.unavailableTitle': 'The placement test isn’t available yet',
  'placement.back': 'Back to settings',
  'placement.home': 'Back to today',
```

and to `bg.ts`:

```ts
  'placement.link': 'Намерете нивото си с кратък тест',
  'placement.unavailableNote': 'Тестът за ниво се отваря, когато са инсталирани думи от повече от едно ниво.',
  'placement.title': 'Намерете нивото си',
  'placement.intro': 'Около двадесет думи. Изберете превода или кажете, че не знаете: предположението само прави резултата по-малко полезен.',
  'placement.progress': { one: '{count} отговорена дума', other: '{count} отговорени думи' },
  'placement.dontKnow': 'Не знам',
  'placement.keysHint': 'Клавиши: от 1 до 4 за отговор, 0 за „Не знам“.',
  'placement.resultTitle': 'Вашето ниво: {level}',
  'placement.resultBody': 'Думите под ниво {level} ще се смятат за известни. Нищо научено не се изтрива и можете да смените нивото си от настройките по всяко време.',
  'placement.accept': 'Изберете {level}',
  'placement.keep': 'Запазете {level}',
  'placement.acceptedTitle': 'Нивото ви вече е {level}',
  'placement.unavailableTitle': 'Тестът за ниво още не е достъпен',
  'placement.back': 'Обратно към настройките',
  'placement.home': 'Обратно към днес',
```

- [ ] **Step 2: Write the failing tests**

Create `web/src/screens/Placement.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { ITEM_SETTLE_MS, type PlacementSource } from '@wordado/client-data'
import { leveledCorpus } from '@wordado/client-data/src/testing/sample'
import type { CefrLevel, Corpus } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Placement } from './Placement'

afterEach(cleanup)

async function withBands() {
  const ctx = await setup()
  const corpus: Corpus = leveledCorpus(ctx.client.snapshot.corpus!, ['A1', 'A2', 'B1'])
  const source: PlacementSource = {
    corpus,
    setLevel: async (level: CefrLevel) => {
      await ctx.client.updateSettings({ declaredLevel: level })
    },
  }
  renderWith(<Placement source={source} />, ctx)
  return { ...ctx, corpus }
}

/** The shown word's primary translation, from the corpus the test was given. */
function rightAnswer(corpus: Corpus): string {
  const headword = document.querySelector('.hw-word')!.textContent
  return [...corpus.entries.values()].find((e) => e.headword === headword)!.translations[0]!
}

describe('Placement (spec §7.2)', () => {
  it('explains why it is not offered on the A1-only sample', async () => {
    const ctx = await setup()
    renderWith(<Placement />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('The placement test isn’t available yet')
    expect(screen.getByRole('link', { name: 'Back to settings' }).getAttribute('href')).toBe('/settings')
  })

  it('places a learner who knows every word at the highest band, and uses it once accepted', async () => {
    const { env, client, corpus } = await withBands()
    for (let i = 0; i < 40 && document.querySelector('.hw-word'); i += 1) {
      env.advance(ITEM_SETTLE_MS + 1_000)
      const answer = rightAnswer(corpus)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: (name) => name.includes(answer) })))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level: B1')
    expect(client.snapshot.settings.declaredLevel).toBe('A1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use B1' })))
    expect(client.snapshot.settings.declaredLevel).toBe('B1')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level is now B1')
  })

  it('answers “I don’t know” with 0 on the keyboard, and places at A1', async () => {
    const { env } = await withBands()
    for (let i = 0; i < 40 && document.querySelector('.hw-word'); i += 1) {
      env.advance(ITEM_SETTLE_MS + 1_000)
      await act(async () => fireEvent.keyDown(window, { key: '0' }))
    }
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your level: A1')
  })

  it('ignores a held key', async () => {
    const { env } = await withBands()
    env.advance(ITEM_SETTLE_MS + 1_000)
    await act(async () => fireEvent.keyDown(window, { key: '0', repeat: true }))
    expect(screen.getByText('0 words answered')).toBeTruthy()
  })

  it('moves focus to each new question', async () => {
    const { env } = await withBands()
    env.advance(ITEM_SETTLE_MS + 1_000)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I don’t know' })))
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })
})
```

Append to `web/src/screens/Settings.test.tsx`:

```tsx
describe('Settings: the placement test (spec §7.2)', () => {
  it('says why there is no test on the A1-only sample', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.queryByRole('link', { name: 'Find your level with a short test' })).toBeNull()
    expect(screen.getByText('A placement test opens once words of more than one level are installed.')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/screens/Placement.test.tsx src/screens/Settings.test.tsx`
Expected: FAIL — `./Placement` does not exist, and settings has no placement note.

- [ ] **Step 4: Write the screen**

Create `web/src/screens/Placement.tsx`:

```tsx
import { PlacementRun, placementSource, useClient, useClientSnapshot, type PlacementSource } from '@wordado/client-data'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { Headword, Translation } from '../study/Headword'
import { useStore } from '../useStore'

/**
 * The optional placement test (spec §7.2). Questions carry no feedback, since
 * the test measures rather than teaches. Nothing changes until the learner
 * takes the result.
 */
export function Placement(props: { readonly source?: PlacementSource }) {
  const { t } = useT()
  const client = useClient()
  const { env } = useApp()
  const { corpus, settings } = useClientSnapshot()
  const [run] = useState(() => PlacementRun.start(props.source ?? placementSource(client), env))
  const s = useStore(run.store)
  const card = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)

  // 1–4 answer, 0 is "I don't know" (spec §11.1); a held key answers nothing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea, select')) return
      if (run.snapshot.phase !== 'question') return
      if (event.key === '0') {
        event.preventDefault()
        run.dontKnow()
      } else if (/^[1-9]$/.test(event.key)) {
        event.preventDefault()
        run.choose(Number(event.key) - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run])

  // Each question takes focus, so a screen reader reads it; the result's heading likewise.
  useEffect(() => {
    if (s.phase === 'question') card.current?.focus()
    else heading.current?.focus()
  }, [s.item, s.phase])

  if (s.phase === 'unavailable') {
    return (
      <section aria-labelledby="placement-title">
        <h1 id="placement-title">{t('placement.unavailableTitle')}</h1>
        <p>{t('placement.unavailableNote')}</p>
        <Link className="button" to={{ name: 'settings' }}>
          {t('placement.back')}
        </Link>
      </section>
    )
  }

  if (s.phase === 'result' || s.phase === 'accepted') {
    const level = s.result!
    return (
      <section className="done" aria-labelledby="placement-title">
        <h1 id="placement-title" ref={heading} tabIndex={-1}>
          {s.phase === 'accepted' ? t('placement.acceptedTitle', { level }) : t('placement.resultTitle', { level })}
        </h1>
        {s.phase === 'result' ? (
          <>
            <p>{t('placement.resultBody', { level })}</p>
            {s.error !== null && <p role="alert">{t('settings.saveFailed', { message: s.error })}</p>}
            <div className="actions">
              <button type="button" className="button primary" onClick={() => void run.accept()}>
                {t('placement.accept', { level })}
              </button>
              <Link className="button" to={{ name: 'settings' }}>
                {t('placement.keep', { level: settings.declaredLevel })}
              </Link>
            </div>
          </>
        ) : (
          <Link className="button primary" to={{ name: 'home' }}>
            {t('placement.home')}
          </Link>
        )}
      </section>
    )
  }

  const item = s.item!
  const l1 = (props.source?.corpus ?? corpus)?.l1 ?? 'bg'
  return (
    <section className="study" aria-labelledby="placement-title">
      <h1 id="placement-title">{t('placement.title')}</h1>
      <p className="note">{t('placement.intro')}</p>
      <div className="study-bar">
        <p>{t('placement.progress', { count: s.asked })}</p>
      </div>
      <div className="card" ref={card} tabIndex={-1} data-mode="placement">
        <Headword entry={item.entry} />
        <p className="instruction">{t('study.chooseTranslation')}</p>
        <ol className="options">
          {item.options.map((option, index) => (
            <li key={option.entryId}>
              <button type="button" className="option" onClick={() => run.choose(index)}>
                <span className="option-key" aria-hidden="true">
                  {index + 1}
                </span>{' '}
                <Translation entry={option} lang={l1} />
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="button" onClick={() => run.dontKnow()}>
          <span className="option-key" aria-hidden="true">
            0
          </span>{' '}
          {t('placement.dontKnow')}
        </button>
      </div>
      <p className="note keys-hint">{t('placement.keysHint')}</p>
    </section>
  )
}
```

- [ ] **Step 5: Offer it from settings**

In `web/src/settings/StudySettings.tsx`, import `placementAvailable` from `@wordado/client-data` and `Link` from `../router`. After the level fieldset, add:

```tsx
      {placementAvailable(corpus) ? (
        <p>
          <Link to={{ name: 'placement' }}>{t('placement.link')}</Link>
        </p>
      ) : (
        <p className="note">{t('placement.unavailableNote')}</p>
      )}
```

- [ ] **Step 6: Run everything**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web/src
git commit -m "feat(web): the placement test, offered from settings when the words span two levels"
```

---

### Task 12: `web`: opt-in Web Push reminders

Spec §8.11 calls for one reminder a day at a time the learner chooses, and an optional evening nudge when a streak is at risk. It is opt-in, and the server does the sending (plan 5). This task wires the client side:

- **`ReminderService`** subscribes the browser with the server's VAPID key and sends the subscription with the reminder minute, the device's current offset and the interface language. It sends it again at every launch and whenever the language changes, and stops it on sign-out and deletion (Task 7's `ReminderPort`).
- **The service worker** answers a push by asking `GET /v1/reminder` what to show. It always shows something, because a push that shows nothing is penalised by browsers.
- **The settings section** explains what cannot work: no account, no browser support, iOS not installed, or permission refused.

**Files:**
- Create: `web/src/reminders/reminders.ts`, `web/src/reminders/prefs.ts`, `web/src/reminders/notification.ts`, `web/src/settings/ReminderSettings.tsx`
- Modify: `web/src/sw.ts`, `web/src/app/context.tsx`, `web/src/screens/Settings.tsx`, `web/src/i18n/i18n.tsx` (`onLocale`), `web/src/main.tsx`, `web/src/test/fixtures.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`
- Test: `web/src/reminders/reminders.test.ts`, `web/src/reminders/notification.test.ts`, `web/src/screens/Settings.test.tsx` (modify)

**Interfaces:**
- Consumes: `Api.pushPublicKey`, `putSubscription` and `deleteSubscription` (Task 4); `ReminderPort` (Task 7); `KeyValue` and `memoryStorage` (Task 4).
- Produces:
  - `REMINDER_KEY = 'wordado.reminder'` and `DEFAULT_REMINDER_MINUTE = 1140`.
  - `interface ReminderPrefs { minute: number; streakNudge: boolean }`.
  - `type ReminderSupport = 'supported' | 'needs-install' | 'unsupported' | 'denied'`.
  - `interface PushPlatform { supported(); needsInstall(); permission(); requestPermission(); subscription(); subscribe(key) }`.
  - `class ReminderService implements ReminderPort`, with `prefs()`, `support()`, `enable(prefs): Promise<'on' | 'denied' | 'unavailable'>`, `disable()`, `refresh()` and `stop({ server })`.
  - `type ReminderActions = Pick<ReminderService, 'prefs' | 'support' | 'enable' | 'disable'>`.
  - `AppServices.reminders: ReminderActions`.
  - `reminderNotification(fetch, lang, tzOffsetMin): Promise<{ title; body }>`.
  - `writeInterfaceLanguage(locale, caches?)`, `readInterfaceLanguage(caches?)` and `PREFS_CACHE = 'wordado-prefs'`.
  - `I18nProvider` gains `onLocale?(locale)`.

- [ ] **Step 1: Write the failing service tests**

Create `web/src/reminders/reminders.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { fakeApi } from '../test/fakeApi'
import { DEFAULT_REMINDER_MINUTE, ReminderService, type PushPlatform, type PushSub } from './reminders'

/** A browser's push machinery, as far as the service uses it. */
function platform(over: Partial<PushPlatform> = {}) {
  let permission: NotificationPermission = 'default'
  let current: PushSub | null = null
  const log: string[] = []
  const p: PushPlatform & { log: string[] } = {
    log,
    supported: () => true,
    needsInstall: () => false,
    permission: () => permission,
    requestPermission: async () => {
      permission = 'granted'
      return permission
    },
    subscription: async () => current,
    subscribe: async (key) => {
      log.push(`subscribe ${key.length}`)
      current = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        toJSON: () => ({ keys: { p256dh: 'p', auth: 'a' } }),
        unsubscribe: async () => {
          log.push('unsubscribe')
          current = null
          return true
        },
      }
      return current
    },
    ...over,
  }
  return p
}

function service(options: { platform?: PushPlatform; key?: string | null; language?: 'bg' | 'en'; offset?: number } = {}) {
  const puts: unknown[] = []
  const api = fakeApi({
    pushPublicKey: async () => (options.key === undefined ? 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U' : options.key),
    putSubscription: async (body) => {
      puts.push(body)
    },
  })
  const storage = memoryStorage()
  const s = new ReminderService({
    api,
    platform: options.platform ?? platform(),
    storage,
    tzOffsetMin: () => options.offset ?? 180,
    language: () => options.language ?? 'bg',
  })
  return { s, api, puts, storage }
}

describe('ReminderService (spec §8.11, plan 5 contract)', () => {
  it('is off until the learner turns it on', () => {
    expect(service().s.prefs()).toBeNull()
  })

  it('asks permission, subscribes with the server’s key, and sends the minute, offset and language', async () => {
    const { s, puts } = service()
    expect(await s.enable({ minute: 7 * 60 + 30, streakNudge: true })).toBe('on')
    expect(puts).toEqual([
      {
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'p', auth: 'a' },
        reminderMinute: 450,
        tzOffsetMin: 180,
        language: 'bg',
        streakNudge: true,
      },
    ])
    expect(s.prefs()).toEqual({ minute: 450, streakNudge: true })
  })

  it('says so and keeps nothing when permission is refused', async () => {
    const { s, puts } = service({ platform: platform({ requestPermission: async () => 'denied' }) })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('denied')
    expect(puts).toEqual([])
    expect(s.prefs()).toBeNull()
  })

  it('is unavailable when the server sends no reminders', async () => {
    const { s } = service({ key: null })
    expect(await s.enable({ minute: DEFAULT_REMINDER_MINUTE, streakNudge: false })).toBe('unavailable')
  })

  it('sends the subscription again at launch, with the offset and language of now', async () => {
    const p = platform()
    const first = service({ platform: p })
    await first.s.enable({ minute: 600, streakNudge: false })
    const later = new ReminderService({
      api: first.api,
      platform: p,
      storage: first.storage,
      tzOffsetMin: () => 120,
      language: () => 'en',
    })
    await later.refresh()
    expect(first.puts.at(-1)).toMatchObject({ reminderMinute: 600, tzOffsetMin: 120, language: 'en' })
  })

  it('does nothing at launch when reminders are off or permission was withdrawn', async () => {
    const { s, puts } = service({ platform: platform({ permission: () => 'denied' }) })
    await s.refresh()
    expect(puts).toEqual([])
  })

  it('turns off: forgets the subscription on the server and in the browser', async () => {
    const p = platform()
    const { s, api } = service({ platform: p })
    await s.enable({ minute: 600, streakNudge: false })
    await s.disable()
    expect(api.calls).toContain('deleteSubscription https://fcm.googleapis.com/fcm/send/abc')
    expect(p.log).toContain('unsubscribe')
    expect(s.prefs()).toBeNull()
  })

  it('stops for a deleted account without asking the server', async () => {
    const p = platform()
    const { s, api } = service({ platform: p })
    await s.enable({ minute: 600, streakNudge: false })
    await s.stop({ server: false })
    expect(api.calls.some((c) => c.startsWith('deleteSubscription'))).toBe(false)
    expect(p.log).toContain('unsubscribe')
  })

  it('names what stands in the way', () => {
    expect(service({ platform: platform({ supported: () => false }) }).s.support()).toBe('unsupported')
    expect(service({ platform: platform({ needsInstall: () => true }) }).s.support()).toBe('needs-install')
    expect(service({ platform: platform({ permission: () => 'denied' }) }).s.support()).toBe('denied')
    expect(service().s.support()).toBe('supported')
  })
})
```

Create `web/src/reminders/notification.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reminderNotification } from './notification'

describe('reminderNotification (plan 5 contract)', () => {
  it('shows what the server says, asking with the device’s offset and language', async () => {
    const asked: string[] = []
    const got = await reminderNotification(
      async (url, init) => {
        asked.push(`${url} ${init?.credentials}`)
        return new Response(JSON.stringify({ title: 'Wordado', body: 'Имате 3 думи за преговор днес.' }), { status: 200 })
      },
      'bg',
      120,
    )
    expect(asked).toEqual(['/v1/reminder?tz=120&lang=bg include'])
    expect(got).toEqual({ title: 'Wordado', body: 'Имате 3 думи за преговор днес.' })
  })

  it('still shows a reminder when the server cannot be asked', async () => {
    const offline = await reminderNotification(async () => Promise.reject(new TypeError('Failed to fetch')), 'en', 0)
    expect(offline).toEqual({ title: 'Wordado', body: 'Time for your words.' })
    const refused = await reminderNotification(async () => new Response('{}', { status: 401 }), 'bg', 0)
    expect(refused.body).toBe('Време е за думите ви.')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/reminders`
Expected: FAIL — the modules do not exist.

- [ ] **Step 3: Write the service and the notification**

Create `web/src/reminders/reminders.ts`:

```ts
import type { Api } from '../account/api'
import type { ReminderPort } from '../account/controller'
import type { KeyValue } from '../account/storage'

/** The learner's reminder choices on this browser (a subscription belongs to one browser). */
export const REMINDER_KEY = 'wordado.reminder'
/** 19:00 local. Tuning (§15). */
export const DEFAULT_REMINDER_MINUTE = 19 * 60

export interface ReminderPrefs {
  /** Minute of the local day, 0–1439. */
  readonly minute: number
  /** The evening nudge when the streak needs today (spec §8.11). */
  readonly streakNudge: boolean
}

export type ReminderSupport = 'supported' | 'needs-install' | 'unsupported' | 'denied'

/** A push subscription, as far as the service uses it. */
export interface PushSub {
  readonly endpoint: string
  toJSON(): { keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

/** The browser's push machinery; `browserPushPlatform()` is the real one. */
export interface PushPlatform {
  supported(): boolean
  /** iOS delivers Web Push only to an installed app (spec §8.11). */
  needsInstall(): boolean
  permission(): NotificationPermission
  requestPermission(): Promise<NotificationPermission>
  subscription(): Promise<PushSub | null>
  subscribe(applicationServerKey: string): Promise<PushSub>
}

export interface ReminderDeps {
  readonly api: Api
  readonly platform: PushPlatform
  readonly storage: KeyValue
  tzOffsetMin(): number
  language(): 'bg' | 'en'
}

const isPrefs = (v: unknown): v is ReminderPrefs =>
  typeof v === 'object' &&
  v !== null &&
  Number.isInteger((v as ReminderPrefs).minute) &&
  (v as ReminderPrefs).minute >= 0 &&
  (v as ReminderPrefs).minute <= 1439 &&
  typeof (v as ReminderPrefs).streakNudge === 'boolean'

/**
 * Opt-in reminders (spec §8.11). The server sends them (plan 5); this
 * subscribes the browser and keeps the server's copy current: the offset and
 * language travel with every send, so a trip or a change of language follows
 * the learner.
 */
export class ReminderService implements ReminderPort {
  constructor(private readonly deps: ReminderDeps) {}

  prefs(): ReminderPrefs | null {
    try {
      const raw = this.deps.storage.getItem(REMINDER_KEY)
      const value: unknown = raw === null ? null : JSON.parse(raw)
      return isPrefs(value) ? value : null
    } catch {
      return null
    }
  }

  private save(prefs: ReminderPrefs | null): void {
    try {
      if (prefs === null) this.deps.storage.removeItem(REMINDER_KEY)
      else this.deps.storage.setItem(REMINDER_KEY, JSON.stringify(prefs))
    } catch {
      // Refused storage: reminders then last until the page closes.
    }
  }

  support(): ReminderSupport {
    const { platform } = this.deps
    if (!platform.supported()) return platform.needsInstall() ? 'needs-install' : 'unsupported'
    if (platform.needsInstall()) return 'needs-install'
    return platform.permission() === 'denied' ? 'denied' : 'supported'
  }

  private async send(sub: PushSub, prefs: ReminderPrefs): Promise<void> {
    const keys = sub.toJSON().keys ?? {}
    await this.deps.api.putSubscription({
      endpoint: sub.endpoint,
      keys: { p256dh: keys.p256dh ?? '', auth: keys.auth ?? '' },
      reminderMinute: prefs.minute,
      tzOffsetMin: this.deps.tzOffsetMin(),
      language: this.deps.language(),
      streakNudge: prefs.streakNudge,
    })
  }

  /** Turns reminders on, or changes their time or nudge. Needs a gesture: it may ask for permission. */
  async enable(prefs: ReminderPrefs): Promise<'on' | 'denied' | 'unavailable'> {
    const { api, platform } = this.deps
    const key = await api.pushPublicKey()
    if (key === null) return 'unavailable'
    const permission = platform.permission() === 'granted' ? 'granted' : await platform.requestPermission()
    if (permission !== 'granted') return 'denied'
    const sub = (await platform.subscription()) ?? (await platform.subscribe(key))
    await this.send(sub, prefs)
    this.save(prefs)
    return 'on'
  }

  /** At launch and when the language changes (plan 5 contract). Quiet: nothing is asked of the learner. */
  async refresh(): Promise<void> {
    const prefs = this.prefs()
    if (prefs === null || this.deps.platform.permission() !== 'granted') return
    const sub = await this.deps.platform.subscription()
    if (sub) await this.send(sub, prefs)
  }

  async disable(): Promise<void> {
    await this.stop({ server: true })
  }

  /** Task 7's ReminderPort: on sign-out the server is told; after deletion it has nothing left to forget. */
  async stop(options: { readonly server: boolean }): Promise<void> {
    const sub = await this.deps.platform.subscription().catch(() => null)
    if (sub) {
      if (options.server) await this.deps.api.deleteSubscription(sub.endpoint).catch(() => undefined)
      await sub.unsubscribe().catch(() => false)
    }
    this.save(null)
  }
}

/** What settings uses; its tests pass a fake. */
export type ReminderActions = Pick<ReminderService, 'prefs' | 'support' | 'enable' | 'disable'>

/** The VAPID key, from base64url to the bytes `PushManager.subscribe` takes. */
export function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(base64url.length / 4) * 4, '=')
  const binary = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(binary.length))
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/** The real browser, through the registered service worker. */
export function browserPushPlatform(): PushPlatform {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
  const registration = () => navigator.serviceWorker.ready
  return {
    supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
    needsInstall: () => ios && !standalone,
    permission: () => ('Notification' in window ? Notification.permission : 'denied'),
    requestPermission: () => Notification.requestPermission(),
    subscription: async () => (await registration()).pushManager.getSubscription(),
    subscribe: async (key) => (await registration()).pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) }),
  }
}
```

Create `web/src/reminders/notification.ts`:

```ts
export interface ReminderText {
  readonly title: string
  readonly body: string
}

/** Shown when the server cannot be asked: a push must always show something (spec §8.11). */
const FALLBACK: Readonly<Record<'bg' | 'en', ReminderText>> = {
  bg: { title: 'Wordado', body: 'Време е за думите ви.' },
  en: { title: 'Wordado', body: 'Time for your words.' },
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * What a woken service worker shows (plan 5 contract): `GET /v1/reminder`
 * with the device's offset now and the interface language, with the session
 * cookie; a fixed text if that fails.
 */
export async function reminderNotification(fetchFn: Fetch, lang: 'bg' | 'en', tzOffsetMin: number): Promise<ReminderText> {
  try {
    const response = await fetchFn(`/v1/reminder?tz=${tzOffsetMin}&lang=${lang}`, { credentials: 'include' })
    if (!response.ok) return FALLBACK[lang]
    const body = (await response.json()) as Partial<ReminderText>
    return typeof body.title === 'string' && typeof body.body === 'string' ? { title: body.title, body: body.body } : FALLBACK[lang]
  } catch {
    return FALLBACK[lang]
  }
}
```

Create `web/src/reminders/prefs.ts`:

```ts
/** A cache the service worker can read: it has no localStorage (decision recorded in this plan). */
export const PREFS_CACHE = 'wordado-prefs'
const PREFS_URL = '/__wordado/prefs'

export async function writeInterfaceLanguage(lang: 'bg' | 'en', cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<void> {
  if (!cacheStorage) return
  const cache = await cacheStorage.open(PREFS_CACHE)
  await cache.put(PREFS_URL, new Response(JSON.stringify({ lang }), { headers: { 'content-type': 'application/json' } }))
}

export async function readInterfaceLanguage(cacheStorage: CacheStorage | undefined = globalThis.caches): Promise<'bg' | 'en'> {
  try {
    const response = await (await cacheStorage!.open(PREFS_CACHE)).match(PREFS_URL)
    const lang = response ? ((await response.json()) as { lang?: unknown }).lang : null
    return lang === 'en' ? 'en' : 'bg'
  } catch {
    return 'bg'
  }
}
```

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/reminders`
Expected: PASS.

- [ ] **Step 4: The service worker answers a push**

Append to `web/src/sw.ts`:

```ts
import { reminderNotification } from './reminders/notification'
import { readInterfaceLanguage } from './reminders/prefs'

const sw = self as unknown as ServiceWorkerGlobalScope

// A reminder (spec §8.11): the push is empty; ask the server what to say (plan 5).
sw.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      const lang = await readInterfaceLanguage(sw.caches)
      const { title, body } = await reminderNotification((input, init) => fetch(input, init), lang, 0 - new Date().getTimezoneOffset())
      await sw.registration.showNotification(title, { body, lang, icon: '/icon-192.png', tag: 'wordado-reminder' })
    })(),
  )
})

// Opening a reminder brings Wordado forward, or opens it.
sw.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const windows = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows[0]
      if (open) await open.focus()
      else await sw.clients.openWindow('/')
    })(),
  )
})
```

Move the two new `import` lines to the top of the file beside the Workbox imports. Run `pnpm --filter @wordado/web build` and check that it succeeds: the service worker is built as a classic script, and the imports are bundled into it.

- [ ] **Step 5: Keep the service worker's language current**

In `web/src/i18n/i18n.tsx`, add to `I18nProvider`'s props `readonly onLocale?: (locale: Locale) => void`, and call it in the existing effect:

```ts
  useEffect(() => {
    document.documentElement.lang = locale
    props.onLocale?.(locale)
  }, [locale])
```

- [ ] **Step 6: The settings section**

Add to `en.ts`:

```ts
  'reminders.title': 'Reminders',
  'reminders.needAccount': 'Reminders come with an account.',
  'reminders.unsupported': 'This browser can’t show reminders.',
  'reminders.needsInstall': 'On iPhone and iPad, reminders work once Wordado is on your home screen: tap Share, then Add to Home Screen.',
  'reminders.denied': 'Notifications are blocked for Wordado. Allow them in your browser’s site settings to get reminders.',
  'reminders.unavailable': 'Reminders aren’t available right now.',
  'reminders.on': 'Remind me to study',
  'reminders.time': 'At',
  'reminders.nudge': 'Also remind me in the evening when my streak needs today',
  'reminders.hint': 'One reminder a day, skipped once you have studied. They stop by themselves if you ignore several in a row.',
  'reminders.saved': 'Reminders are on.',
  'reminders.off': 'Reminders are off.',
```

and to `bg.ts`:

```ts
  'reminders.title': 'Напомняния',
  'reminders.needAccount': 'Напомнянията идват с профил.',
  'reminders.unsupported': 'Този браузър не може да показва напомняния.',
  'reminders.needsInstall': 'На iPhone и iPad напомнянията работят, щом Wordado е на началния екран: докоснете „Сподели“, после „Добави към началния екран“.',
  'reminders.denied': 'Известията за Wordado са блокирани. Разрешете ги в настройките на браузъра за сайта, за да получавате напомняния.',
  'reminders.unavailable': 'Напомнянията не са достъпни в момента.',
  'reminders.on': 'Напомняйте ми да уча',
  'reminders.time': 'В',
  'reminders.nudge': 'Напомняйте ми и вечер, когато поредицата ми има нужда от днешния ден',
  'reminders.hint': 'Едно напомняне на ден, пропуснато, ако вече сте учили. Спират сами, ако пренебрегнете няколко поред.',
  'reminders.saved': 'Напомнянията са включени.',
  'reminders.off': 'Напомнянията са изключени.',
```

Add `readonly reminders: ReminderActions` to `AppServices` (import the type from `../reminders/reminders`). In `test/fixtures.tsx`, import `type ReminderActions` and `type ReminderPrefs` from `../reminders/reminders`, and add:

```ts
/** Reminders as settings sees them; `support` and the answer to `enable` are the test's to choose. */
export function fakeReminders(over: Partial<ReminderActions> = {}): ReminderActions & { calls: string[] } {
  const calls: string[] = []
  let prefs: ReminderPrefs | null = null
  return {
    calls,
    prefs: () => prefs,
    support: () => 'supported',
    enable: async (p) => {
      calls.push(`enable ${p.minute} ${p.streakNudge}`)
      prefs = p
      return 'on'
    },
    disable: async () => {
      calls.push('disable')
      prefs = null
    },
    ...over,
  }
}
```

Give `RenderContext` a `reminders?: ReminderActions`, defaulting to `fakeReminders()` in `renderWith`. In `Root.test.tsx`, add `reminders: fakeReminders()` to the services.

Create `web/src/settings/ReminderSettings.tsx`:

```tsx
import { useId, useState } from 'react'
import { useApp } from '../app/context'
import { useT, type MessageKey } from '../i18n/i18n'
import { DEFAULT_REMINDER_MINUTE, type ReminderPrefs } from '../reminders/reminders'

const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const fromTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const minute = Number(match[1]) * 60 + Number(match[2])
  return minute >= 0 && minute <= 1439 ? minute : null
}

/** Opt-in reminders (spec §8.11); says plainly what stands in the way when they cannot work. */
export function ReminderSettings() {
  const { t } = useT()
  const { account, reminders } = useApp()
  const timeId = useId()
  const [prefs, setPrefs] = useState<ReminderPrefs | null>(() => reminders.prefs())
  const [status, setStatus] = useState<MessageKey | null>(null)
  const [busy, setBusy] = useState(false)
  const support = reminders.support()

  const blocked: MessageKey | null =
    account === null
      ? 'reminders.needAccount'
      : support === 'unsupported'
        ? 'reminders.unsupported'
        : support === 'needs-install'
          ? 'reminders.needsInstall'
          : support === 'denied'
            ? 'reminders.denied'
            : null

  const apply = async (next: ReminderPrefs | null) => {
    setBusy(true)
    try {
      if (next === null) {
        await reminders.disable()
        setPrefs(null)
        setStatus('reminders.off')
      } else {
        const outcome = await reminders.enable(next)
        if (outcome === 'on') {
          setPrefs(next)
          setStatus('reminders.saved')
        } else setStatus(outcome === 'denied' ? 'reminders.denied' : 'reminders.unavailable')
      }
    } catch {
      setStatus('reminders.unavailable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-labelledby="settings-reminders">
      <h2 id="settings-reminders">{t('reminders.title')}</h2>
      {blocked !== null ? (
        <p>{t(blocked)}</p>
      ) : (
        <>
          <p className="note">{t('reminders.hint')}</p>
          <div className="field">
            <label className="check">
              <input
                type="checkbox"
                checked={prefs !== null}
                disabled={busy}
                onChange={(e) => void apply(e.target.checked ? { minute: DEFAULT_REMINDER_MINUTE, streakNudge: false } : null)}
              />
              {t('reminders.on')}
            </label>
          </div>
          {prefs !== null && (
            <>
              <div className="field">
                <label htmlFor={timeId}>{t('reminders.time')}</label>
                <input
                  id={timeId}
                  type="time"
                  value={toTime(prefs.minute)}
                  disabled={busy}
                  onChange={(e) => {
                    const minute = fromTime(e.target.value)
                    if (minute !== null) void apply({ ...prefs, minute })
                  }}
                />
              </div>
              <div className="field">
                <label className="check">
                  <input type="checkbox" checked={prefs.streakNudge} disabled={busy} onChange={(e) => void apply({ ...prefs, streakNudge: e.target.checked })} />
                  {t('reminders.nudge')}
                </label>
              </div>
            </>
          )}
          <p className="note" role="status">
            {status !== null ? t(status) : null}
          </p>
        </>
      )}
    </section>
  )
}
```

In `web/src/screens/Settings.tsx`, render `<ReminderSettings />` after `<AudioDownload />`.

Append to `web/src/screens/Settings.test.tsx` (import `fakeReminders` from the fixtures):

```tsx
describe('Settings: reminders (spec §8.11)', () => {
  const ana = { userId: 'u1', email: 'ana@example.com' }

  it('needs an account', async () => {
    const ctx = await setup()
    renderWith(<Settings />, ctx)
    expect(screen.getByText('Reminders come with an account.')).toBeTruthy()
  })

  it('turns on at 19:00, changes the time and the nudge, and turns off', async () => {
    const ctx = await setup()
    const reminders = fakeReminders()
    renderWith(<Settings />, { ...ctx, account: ana, reminders })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect((screen.getByLabelText('At') as HTMLInputElement).value).toBe('19:00')
    await act(async () => fireEvent.change(screen.getByLabelText('At'), { target: { value: '07:30' } }))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: /streak needs today/ })))
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(reminders.calls).toEqual(['enable 1140 false', 'enable 450 false', 'enable 450 true', 'disable'])
    expect(screen.getByText('Reminders are off.')).toBeTruthy()
  })

  it('says plainly why reminders cannot work here', async () => {
    const ctx = await setup()
    renderWith(<Settings />, { ...ctx, account: ana, reminders: fakeReminders({ support: () => 'needs-install' }) })
    expect(screen.getByText(/once Wordado is on your home screen/)).toBeTruthy()
    cleanup()
    renderWith(<Settings />, { ...ctx, account: ana, reminders: fakeReminders({ enable: async () => 'denied' }) })
    await act(async () => fireEvent.click(screen.getByRole('checkbox', { name: 'Remind me to study' })))
    expect(screen.getByText(/Notifications are blocked/)).toBeTruthy()
    expect((screen.getByRole('checkbox', { name: 'Remind me to study' }) as HTMLInputElement).checked).toBe(false)
  })
})
```

- [ ] **Step 7: Wire it in `main.tsx`**

In `web/src/main.tsx`:

1. Import `ReminderService`, `browserPushPlatform` and `writeInterfaceLanguage`.
2. Create the service before the controller, reading the language from the same place the i18n provider writes it (`<html lang>`):

```ts
const reminders = new ReminderService({
  api,
  platform: browserPushPlatform(),
  storage: browserStorage('localStorage'),
  tzOffsetMin: env.tzOffsetMin,
  language: () => (document.documentElement.lang === 'en' ? 'en' : 'bg'),
})
```

   Import `browserStorage` from `./account/storage`.
3. Pass `reminders` to the `AccountController` and in `services`.
4. Pass `onLocale` to `<I18nProvider>`:

```tsx
    <I18nProvider
      onLocale={(locale) => {
        void writeInterfaceLanguage(locale).catch(() => undefined)
        void reminders.refresh().catch(() => undefined)
      }}
    >
```

5. At launch, once a signed-in learner is ready, send the subscription again (plan 5 contract). Inside the Task 7 subscription that waits for `ready`, or in a new one-shot `boot.store.subscribe`, add: `if (state.account) void reminders.refresh().catch(() => undefined)`.

- [ ] **Step 8: Run everything, and commit**

Run: `pnpm --filter @wordado/web exec vitest run --project unit && pnpm --filter @wordado/web build`
Expected: PASS, and the build succeeds.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

```bash
git add web/src
git commit -m "feat(web): opt-in Web Push reminders — subscribe, resend at launch, the push handler, and their settings"
```

---

### Task 13: `web`: installing and updating the app, the periodic pack check, and one cache for audio

The app's lifecycle around the learner:

- **Installation prompt.** It appears from the second day of use (spec §9.1). On Chromium it is the browser's own prompt; on iOS it is the "Share → Add to Home Screen" instruction, which is also what keeps Safari from evicting the data and what lets reminders work.
- **New version.** "A new version is ready" is offered when a new service worker is waiting. Updating posts skip-waiting and reloads.
- **Too old.** "This version is too old" appears when a pack needs a newer app (`InstallReport.appUpdateNeeded`) or the server refuses this build (`upgradeRequired`).
- **Pack check.** The periodic check runs every six hours (spec §9.3).
- **Audio.** `AudioStore` re-reads its index when a new pack activates, and the bundled sample's clips move out of the precache into the one audio cache (decision above).
- **Icons.** PNG icons for iOS and the manifest.

**Files:**
- Create: `web/src/app/lifecycle.ts`, `web/src/app/content.ts`, `web/src/settings/AppSettings.tsx`, `web/scripts/icons.ts`, `web/public/apple-touch-icon.png`, `web/public/icon-192.png`, `web/public/icon-512.png`
- Modify: `web/src/app/boot.ts` (`onInstallReport`), `web/src/app/Banners.tsx`, `web/src/app/App.tsx`, `web/src/app/context.tsx`, `web/src/screens/Settings.tsx`, `web/src/sw.ts`, `web/src/main.tsx`, `web/vite.config.ts`, `web/index.html`, `web/package.json`, `web/src/test/fixtures.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`
- Test: `web/src/app/lifecycle.test.ts`, `web/src/app/content.test.ts`, `web/src/app/Banners.test.tsx` (modify), `web/src/app/boot.test.ts` (modify)

**Interfaces:**
- Consumes: `InstallReport` (plan 4), `SyncStatus.upgradeRequired` (plan 4), `AudioStore.refresh` and `prefetch` (6a), and `KeyValue` and `browserStorage` (Task 4).
- Produces:
  - From `lifecycle.ts`:
    - `VISITS_KEY = 'wordado.visits'`.
    - `interface LifecycleState { updateReady; appTooOld; installable: 'prompt' | 'ios' | null; installOffer: 'prompt' | 'ios' | null }`.
    - `interface InstallEvent { prompt(); userChoice }`.
    - `class AppLifecycle`, with `store`, `recordVisit(day)`, `updateFound(worker)`, `applyUpdate()`, `markAppTooOld()`, `installAvailable(event)`, `iosInstallable()`, `install()` and `dismissInstall()`.
    - `type LifecyclePort = Pick<AppLifecycle, 'store' | 'applyUpdate' | 'install' | 'dismissInstall'>`.
    - `watchUpdates(registration, container, lifecycle)`.
  - From `content.ts`: `PACK_CHECK_INTERVAL_MS`, `noteInstallReport(report, lifecycle)`, `startPackChecks(options): () => void` and `refreshAudioOnActivation(target, audio): () => void`.
  - `BootDeps.onInstallReport?(report)`.
  - `AppServices.lifecycle: LifecyclePort`.

- [ ] **Step 1: Write the failing lifecycle tests**

Create `web/src/app/lifecycle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { AppLifecycle, watchUpdates, type InstallEvent } from './lifecycle'

function lifecycle(storage = memoryStorage()) {
  let reloads = 0
  const l = new AppLifecycle({ storage, reload: () => (reloads += 1) })
  return { l, storage, reloads: () => reloads }
}

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted'): InstallEvent & { prompted: number } {
  const e = {
    prompted: 0,
    prompt: async () => {
      e.prompted += 1
    },
    userChoice: Promise.resolve({ outcome }),
  }
  return e
}

describe('the installation prompt (spec §9.1)', () => {
  it('waits for the second distinct day of use', () => {
    const { l } = lifecycle()
    l.installAvailable(installEvent())
    l.recordVisit('2026-09-24')
    l.recordVisit('2026-09-24')
    expect(l.store.get()).toMatchObject({ installable: 'prompt', installOffer: null })
    l.recordVisit('2026-09-25')
    expect(l.store.get().installOffer).toBe('prompt')
  })

  it('remembers the days across launches', () => {
    const storage = memoryStorage()
    lifecycle(storage).l.recordVisit('2026-09-24')
    const { l } = lifecycle(storage)
    l.iosInstallable()
    l.recordVisit('2026-09-26')
    expect(l.store.get().installOffer).toBe('ios')
  })

  it('shows the browser’s prompt once, then offers nothing', async () => {
    const { l } = lifecycle()
    const event = installEvent()
    l.installAvailable(event)
    l.recordVisit('2026-09-24')
    l.recordVisit('2026-09-25')
    await l.install()
    expect(event.prompted).toBe(1)
    expect(l.store.get()).toMatchObject({ installable: null, installOffer: null })
  })

  it('stays dismissed after "Not now", across launches', () => {
    const storage = memoryStorage()
    const first = lifecycle(storage).l
    first.iosInstallable()
    first.recordVisit('2026-09-24')
    first.recordVisit('2026-09-25')
    first.dismissInstall()
    expect(first.store.get().installOffer).toBeNull()
    const again = lifecycle(storage).l
    again.iosInstallable()
    again.recordVisit('2026-09-27')
    expect(again.store.get()).toMatchObject({ installable: 'ios', installOffer: null })
  })
})

describe('updates (spec §9.1, §4.3)', () => {
  it('offers a waiting version, and moves to it on request', () => {
    const { l, reloads } = lifecycle()
    const posted: unknown[] = []
    l.updateFound({ postMessage: (m) => posted.push(m) })
    expect(l.store.get().updateReady).toBe(true)
    l.applyUpdate()
    expect(posted).toEqual([{ type: 'SKIP_WAITING' }])
    expect(reloads()).toBe(0)
  })

  it('reloads to fetch a newer app when nothing is waiting yet', () => {
    const { l, reloads } = lifecycle()
    l.markAppTooOld()
    expect(l.store.get().appTooOld).toBe(true)
    l.applyUpdate()
    expect(reloads()).toBe(1)
  })

  it('watches a registration: a waiting worker, a newly installed one, and the switch', () => {
    const { l, reloads } = lifecycle()
    const listeners = new Map<string, () => void>()
    const installing = {
      state: 'installing',
      postMessage: () => undefined,
      addEventListener: (_: 'statechange', f: () => void) => listeners.set('statechange', f),
    }
    const registration = {
      waiting: null,
      installing,
      addEventListener: (_: 'updatefound', f: () => void) => listeners.set('updatefound', f),
    }
    const container = {
      controller: {},
      addEventListener: (_: 'controllerchange', f: () => void) => listeners.set('controllerchange', f),
    }
    watchUpdates(registration, container, l)
    // A controllerchange nobody asked for (the first install) must not reload.
    listeners.get('controllerchange')!()
    expect(reloads()).toBe(0)
    listeners.get('updatefound')!()
    installing.state = 'installed'
    listeners.get('statechange')!()
    expect(l.store.get().updateReady).toBe(true)
    l.applyUpdate()
    listeners.get('controllerchange')!()
    listeners.get('controllerchange')!()
    expect(reloads()).toBe(1)
  })
})
```

- [ ] **Step 2: Run it to see it fail, then write the lifecycle**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/lifecycle.test.ts`
Expected: FAIL — `./lifecycle` does not exist.

Create `web/src/app/lifecycle.ts`:

```ts
import { createStore, type Store } from '@wordado/client-data'
import type { KeyValue } from '../account/storage'

/** Distinct days of use (the first two), and whether the install offer was declined. */
export const VISITS_KEY = 'wordado.visits'

export interface LifecycleState {
  /** A new version's service worker is installed and waiting. */
  readonly updateReady: boolean
  /** A pack or the server needs a newer app (spec §4.3, §9.3). */
  readonly appTooOld: boolean
  /** How this browser installs: its own prompt, iOS's Add to Home Screen, or not at all (already installed, or unsupported). */
  readonly installable: 'prompt' | 'ios' | null
  /** `installable`, once the learner has come back a second day and has not declined (spec §9.1). */
  readonly installOffer: 'prompt' | 'ios' | null
}

/** The `beforeinstallprompt` event, as far as the app uses it. */
export interface InstallEvent {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ readonly outcome: 'accepted' | 'dismissed' }>
}

interface Visits {
  readonly days: readonly string[]
  readonly dismissed: boolean
}

export interface LifecycleDeps {
  readonly storage: KeyValue
  reload(): void
}

/** Installation and updates (spec §9.1): what the banners and settings offer. */
export class AppLifecycle {
  readonly store: Store<LifecycleState> = createStore<LifecycleState>({ updateReady: false, appTooOld: false, installable: null, installOffer: null })
  private waiting: { postMessage(message: unknown): void } | null = null
  private deferred: InstallEvent | null = null
  /** Set once the learner asked to update: only then does a controller change reload the page. */
  updateRequested = false

  constructor(private readonly deps: LifecycleDeps) {}

  private visits(): Visits {
    try {
      const raw = this.deps.storage.getItem(VISITS_KEY)
      const v = raw === null ? null : (JSON.parse(raw) as Partial<Visits>)
      return { days: Array.isArray(v?.days) ? v.days.filter((d): d is string => typeof d === 'string') : [], dismissed: v?.dismissed === true }
    } catch {
      return { days: [], dismissed: false }
    }
  }

  private saveVisits(v: Visits): void {
    try {
      this.deps.storage.setItem(VISITS_KEY, JSON.stringify(v))
    } catch {
      // Refused storage: the prompt then waits for a second day of this page, which never comes. Acceptable.
    }
  }

  private set(patch: Partial<LifecycleState>): void {
    const next = { ...this.store.get(), ...patch }
    const v = this.visits()
    this.store.set({ ...next, installOffer: v.days.length >= 2 && !v.dismissed ? next.installable : null })
  }

  /** Records today (a local date, YYYY-MM-DD); two distinct days are all that is kept. */
  recordVisit(day: string): void {
    const v = this.visits()
    if (!v.days.includes(day) && v.days.length < 2) this.saveVisits({ ...v, days: [...v.days, day] })
    this.set({})
  }

  updateFound(worker: { postMessage(message: unknown): void }): void {
    this.waiting = worker
    this.set({ updateReady: true })
  }

  markAppTooOld(): void {
    this.set({ appTooOld: true })
  }

  /** Moves to the waiting version; with none waiting, reloads, which fetches the newest app. */
  applyUpdate(): void {
    this.updateRequested = true
    if (this.waiting) this.waiting.postMessage({ type: 'SKIP_WAITING' })
    else this.reloadPage()
  }

  reloadPage(): void {
    this.deps.reload()
  }

  installAvailable(event: InstallEvent): void {
    this.deferred = event
    this.set({ installable: 'prompt' })
  }

  iosInstallable(): void {
    if (this.store.get().installable === null) this.set({ installable: 'ios' })
  }

  async install(): Promise<void> {
    const event = this.deferred
    if (!event) return
    this.deferred = null
    await event.prompt()
    await event.userChoice.catch(() => undefined)
    // The browser's prompt is usable once; after it, the browser decides.
    this.set({ installable: null })
  }

  dismissInstall(): void {
    this.saveVisits({ ...this.visits(), dismissed: true })
    this.set({})
  }
}

/** What the banners and settings use; their tests pass a fake. */
export type LifecyclePort = Pick<AppLifecycle, 'store' | 'applyUpdate' | 'install' | 'dismissInstall'>

interface WorkerLike {
  state: string
  postMessage(message: unknown): void
  addEventListener(type: 'statechange', listener: () => void): void
}

/**
 * Follows the service worker (spec §9.1): a version already waiting, or one
 * that finishes installing while a page is open, is offered; once the
 * learner asks to update, the new version taking control reloads the page,
 * once. A new worker waits for every old tab by default (6a), so nothing
 * swaps under a session unless the learner asks.
 */
export function watchUpdates(
  registration: { readonly waiting: WorkerLike | null; readonly installing: WorkerLike | null; addEventListener(type: 'updatefound', listener: () => void): void },
  container: { readonly controller: unknown; addEventListener(type: 'controllerchange', listener: () => void): void },
  lifecycle: AppLifecycle,
  reload: () => void = () => lifecycle.reloadPage(),
): void {
  if (registration.waiting && container.controller) lifecycle.updateFound(registration.waiting)
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) lifecycle.updateFound(worker)
    })
  })
  let reloaded = false
  container.addEventListener('controllerchange', () => {
    if (!lifecycle.updateRequested || reloaded) return
    reloaded = true
    reload()
  })
}
```

Run it again. Expected: PASS.

- [ ] **Step 3: Write the failing content tests**

Create `web/src/app/content.test.ts`:

```ts
import { createStore } from '@wordado/client-data'
import { openSampleClient, sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import type { Corpus, PackDescriptor } from '@wordado/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { memoryStorage } from '../account/storage'
import { noteInstallReport, PACK_CHECK_INTERVAL_MS, refreshAudioOnActivation, startPackChecks } from './content'
import { AppLifecycle } from './lifecycle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('content (spec §9.3)', () => {
  it('says the app is too old when a pack needs a newer one', () => {
    const l = new AppLifecycle({ storage: memoryStorage(), reload: () => undefined })
    noteInstallReport({ staged: [], appUpdateNeeded: [], rejected: [] }, l)
    expect(l.store.get().appTooOld).toBe(false)
    const newer: PackDescriptor = { pack_id: 'corpus-bg', l1: 'bg', corpus_version: 2, schema_version: 99, url: 'corpus-v2-bg.pack', sha256: '', bytes: 0 }
    noteInstallReport({ staged: [], appUpdateNeeded: [newer], rejected: [] }, l)
    expect(l.store.get().appTooOld).toBe(true)
  })

  it('checks for newer packs every six hours while online, and reports each check', async () => {
    const client = await openSampleClient()
    const reports: unknown[] = []
    let online = true
    const stop = startPackChecks({
      client: () => client,
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
      online: () => online,
      onReport: (r) => reports.push(r),
    })
    await vi.advanceTimersByTimeAsync(PACK_CHECK_INTERVAL_MS)
    expect(reports).toHaveLength(1)
    online = false
    await vi.advanceTimersByTimeAsync(PACK_CHECK_INTERVAL_MS)
    expect(reports).toHaveLength(1)
    stop()
  })

  it('re-reads the audio index when a new pack becomes active, not before', async () => {
    const store = createStore<{ packVersion: number | null; corpus: Corpus | null }>({ packVersion: 1, corpus: null })
    const refreshed: (Corpus | null)[] = []
    const corpus = {} as Corpus
    const stop = refreshAudioOnActivation({ store }, { refresh: async (c) => void refreshed.push(c) })
    store.set({ packVersion: 1, corpus })
    expect(refreshed).toEqual([])
    store.set({ packVersion: 2, corpus })
    expect(refreshed).toEqual([corpus])
    stop()
    store.set({ packVersion: 3, corpus })
    expect(refreshed).toEqual([corpus])
  })
})
```

- [ ] **Step 4: Run it to see it fail, then write the content checks**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/app/content.test.ts`
Expected: FAIL — `./content` does not exist.

Create `web/src/app/content.ts`:

```ts
import type { Client, InstallReport, PackFetcher, Store } from '@wordado/client-data'
import type { Corpus, PackManifest } from '@wordado/core'
import type { AppLifecycle } from './lifecycle'

/** How often a running app looks for newer packs (spec §9.3). Tuning (§15). */
export const PACK_CHECK_INTERVAL_MS = 6 * 60 * 60_000

/** A pack this build cannot read means the app needs updating (spec §9.3); the installed pack stays meanwhile. */
export function noteInstallReport(report: InstallReport, lifecycle: Pick<AppLifecycle, 'markAppTooOld'>): void {
  if (report.appUpdateNeeded.length > 0) lifecycle.markAppTooOld()
}

export interface PackCheckOptions {
  client(): Client | null
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  online(): boolean
  onReport(report: InstallReport): void
}

/** The periodic check (spec §9.3). A newer pack is staged and swaps in at the next session's start. */
export function startPackChecks(options: PackCheckOptions): () => void {
  const timer = setInterval(() => {
    const client = options.client()
    if (!client || !options.online()) return
    void options
      .fetchManifest()
      .then((manifest) => client.installPacks(manifest, options.fetchPack))
      .then(options.onReport)
      .catch(() => undefined)
  }, PACK_CHECK_INTERVAL_MS)
  return () => clearInterval(timer)
}

/**
 * When a staged pack becomes active (at a session's start), the clips it
 * lists may differ: `AudioStore` re-reads which are cached (6a contract),
 * so listening is offered exactly when it can play.
 */
export function refreshAudioOnActivation(
  target: { readonly store: Store<{ readonly packVersion: number | null; readonly corpus: Corpus | null }> },
  audio: { refresh(corpus: Corpus): Promise<void> },
): () => void {
  let version = target.store.get().packVersion
  return target.store.subscribe(() => {
    const { packVersion, corpus } = target.store.get()
    if (packVersion === version) return
    version = packVersion
    if (corpus) void audio.refresh(corpus).catch(() => undefined)
  })
}
```

Run it again. Expected: PASS.

- [ ] **Step 5: `Boot` reports its launch install**

Add to `BootDeps` in `web/src/app/boot.ts`:

```ts
  /** The launch install's report: a pack may need a newer app (spec §9.3). */
  onInstallReport?(report: InstallReport): void
```

(import `type InstallReport` from `@wordado/client-data`), and in `open()` replace:

```ts
        await client.installPacks(await this.deps.fetchManifest(), this.deps.fetchPack)
```

with:

```ts
        this.deps.onInstallReport?.(await client.installPacks(await this.deps.fetchManifest(), this.deps.fetchPack))
```

Add to `boot.test.ts`:

```ts
  it('hands the launch install’s report on', async () => {
    const reports: unknown[] = []
    const { boot: b } = boot({ onInstallReport: (r) => reports.push(r) })
    await b.start()
    expect(reports).toEqual([{ staged: ['corpus-bg'], appUpdateNeeded: [], rejected: [] }])
  })
```

The sample's pack is `corpus-bg` (6a's Boot test sees `startSession()` activate it under that id).

- [ ] **Step 6: Banners and settings**

Add to `en.ts`:

```ts
  'update.ready': 'A new version of Wordado is ready.',
  'update.needed': 'This version of Wordado is too old for the newest words or for syncing. Update to carry on.',
  'update.now': 'Update now',
  'install.prompt': 'Install Wordado: it opens like an app, works offline, and keeps your progress safer on this device.',
  'install.ios': 'Install Wordado: tap Share, then Add to Home Screen. On iPhone and iPad this keeps your progress on the device.',
  'install.button': 'Install',
  'install.later': 'Not now',
  'settings.app': 'The app',
```

and to `bg.ts`:

```ts
  'update.ready': 'Има нова версия на Wordado.',
  'update.needed': 'Тази версия на Wordado е твърде стара за най-новите думи или за синхронизиране. Обновете, за да продължите.',
  'update.now': 'Обновете сега',
  'install.prompt': 'Инсталирайте Wordado: отваря се като приложение, работи офлайн и пази напредъка ви по-сигурно на това устройство.',
  'install.ios': 'Инсталирайте Wordado: докоснете „Сподели“, после „Добави към началния екран“. На iPhone и iPad така напредъкът ви остава на устройството.',
  'install.button': 'Инсталирайте',
  'install.later': 'Не сега',
  'settings.app': 'Приложението',
```

Add `readonly lifecycle: LifecyclePort` to `AppServices`. In `test/fixtures.tsx`, add a default:

```ts
export function fakeLifecycle(state: Partial<LifecycleState> = {}): LifecyclePort & { calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    store: createStore<LifecycleState>({ updateReady: false, appTooOld: false, installable: null, installOffer: null, ...state }),
    applyUpdate: () => void calls.push('applyUpdate'),
    install: async () => void calls.push('install'),
    dismissInstall: () => void calls.push('dismissInstall'),
  }
}
```

give `RenderContext` a `lifecycle?: LifecyclePort` defaulting to `fakeLifecycle()`, and add `lifecycle: fakeLifecycle()` to `Root.test.tsx`'s services.

In `web/src/app/Banners.tsx`, add inside `Banners`, before the notice:

```tsx
      <UpdateBanner />
      <InstallBanner />
```

and in the same file:

```tsx
/** A newer version is waiting, or this one is too old for the packs or the server (spec §4.3, §9.3). */
function UpdateBanner() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { updateReady, appTooOld } = useStore(lifecycle.store)
  const { sync } = useClientSnapshot()
  if (!updateReady && !appTooOld && !sync.upgradeRequired) return null
  return (
    <div className="banner warning">
      <p>{t(updateReady ? 'update.ready' : 'update.needed')}</p>
      <p className="banner-actions">
        <button type="button" className="link-button" onClick={() => lifecycle.applyUpdate()}>
          {t('update.now')}
        </button>
      </p>
    </div>
  )
}

/** The installation prompt, from the second day of use (spec §9.1). */
function InstallBanner() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { installOffer } = useStore(lifecycle.store)
  if (installOffer === null) return null
  return (
    <div className="banner">
      <p>{t(installOffer === 'ios' ? 'install.ios' : 'install.prompt')}</p>
      <p className="banner-actions">
        {installOffer === 'prompt' && (
          <button type="button" className="link-button" onClick={() => void lifecycle.install()}>
            {t('install.button')}
          </button>
        )}
        <button type="button" className="link-button" onClick={() => lifecycle.dismissInstall()}>
          {t('install.later')}
        </button>
      </p>
    </div>
  )
}
```

Create `web/src/settings/AppSettings.tsx`, where installation stays available after the banner is dismissed:

```tsx
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'

/** Installing from settings, whatever the day (spec §9.1). Hidden when there is nothing to offer. */
export function AppSettings() {
  const { t } = useT()
  const { lifecycle } = useApp()
  const { installable } = useStore(lifecycle.store)
  if (installable === null) return null
  return (
    <section aria-labelledby="settings-app">
      <h2 id="settings-app">{t('settings.app')}</h2>
      <p>{t(installable === 'ios' ? 'install.ios' : 'install.prompt')}</p>
      {installable === 'prompt' && (
        <button type="button" className="button" onClick={() => void lifecycle.install()}>
          {t('install.button')}
        </button>
      )}
    </section>
  )
}
```

and render `<AppSettings />` last in `web/src/screens/Settings.tsx`.

Append to `web/src/app/Banners.test.tsx` (import `fakeLifecycle`):

```tsx
describe('update and install banners (spec §9.1)', () => {
  it('offers a waiting version', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ updateReady: true })
    renderWith(<Banners />, { ...ctx, lifecycle })
    expect(screen.getByText('A new version of Wordado is ready.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }))
    expect(lifecycle.calls).toEqual(['applyUpdate'])
  })

  it('says the app is too old when the server refuses this build', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle({ appTooOld: true }) })
    expect(screen.getByText(/too old for the newest words or for syncing/)).toBeTruthy()
  })

  it('offers installation, and "Not now"', async () => {
    const ctx = await setup()
    const lifecycle = fakeLifecycle({ installable: 'prompt', installOffer: 'prompt' })
    renderWith(<Banners />, { ...ctx, lifecycle })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Install' })))
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(lifecycle.calls).toEqual(['install', 'dismissInstall'])
  })

  it('tells iOS how to install', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, lifecycle: fakeLifecycle({ installable: 'ios', installOffer: 'ios' }) })
    expect(screen.getByText(/tap Share, then Add to Home Screen/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })
})
```

- [ ] **Step 7: The service worker moves on request; audio leaves the precache; PNG icons**

Append to `web/src/sw.ts`:

```ts
// "Update now" (spec §9.1): the waiting version takes over only when the learner asks.
sw.addEventListener('message', (event) => {
  if ((event.data as { type?: unknown } | null)?.type === 'SKIP_WAITING') void sw.skipWaiting()
})
```

In `web/vite.config.ts`:

1. Change the glob to `'**/*.{js,css,html,wasm,woff2,svg,png,json,pack,webmanifest}'`, dropping `m4a`, with the comment `// Audio lives in one cache, AudioStore's (decision of plan 6b); the sample's clips are fetched into it on the first online visit.`
2. Replace `icons` with:

```ts
        icons: [
          { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        ],
```

3. Give the preview server the dev proxy, which Task 14 needs: `preview: { port: 4173, strictPort: true, proxy: { '/api': API, '/v1': API } },`.

In `web/index.html`, add after the icon link:

```html
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
```

Create `web/scripts/icons.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

/** Renders public/icon.svg to the PNGs iOS and the manifest need (6a contract). Run: pnpm --filter @wordado/web icons */
const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8')
const browser = await chromium.launch()
for (const [name, size] of [['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]] as const) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  // iOS shows a transparent icon on black: the paper colour sits behind it.
  await page.setContent(`<html><body style="margin:0;background:#f6f7fb">${svg.replace('<svg', `<svg width="${size}" height="${size}"`)}</body></html>`)
  writeFileSync(new URL(`../public/${name}`, import.meta.url), await page.screenshot({ type: 'png' }))
  await page.close()
}
await browser.close()
```

Add `"icons": "node scripts/icons.ts"` to `web/package.json`'s scripts. Node 24 runs TypeScript by stripping types. Then run:

Run: `pnpm --filter @wordado/web icons && file web/public/*.png`
Expected: three PNGs, 180×180, 192×192 and 512×512. Open `apple-touch-icon.png` and check that it shows the icon on the paper colour.

- [ ] **Step 8: Wire it in `main.tsx`**

In `web/src/main.tsx`:

1. Create the lifecycle before `Boot`: `const lifecycle = new AppLifecycle({ storage: browserStorage('localStorage'), reload: () => window.location.reload() })`.
2. Give `Boot` `onInstallReport: (report) => noteInstallReport(report, lifecycle)`.
3. Replace `onReady` with:

```ts
    onReady: async (client) => {
      // The bundled sample's clips are fetched into the one audio cache (decision of plan 6b). Plan 7 narrows
      // this to the sample manifest once learners use the CDN's.
      if (navigator.onLine && client.snapshot.corpus) await audio.prefetch([...client.snapshot.corpus.clips.values()])
    },
```

4. After `boot` is created, add:

```ts
// When a staged pack activates, re-read which clips are cached (6a contract).
let stopAudioWatch: (() => void) | null = null
boot.store.subscribe(() => {
  const state = boot.store.get()
  stopAudioWatch?.()
  stopAudioWatch = state.status === 'ready' ? refreshAudioOnActivation(state.client, audio) : null
  if (state.status === 'ready') lifecycle.recordVisit(dayToIsoDate(localDay(env.now(), env.tzOffsetMin())))
})

startPackChecks({
  client: () => {
    const state = boot.store.get()
    return state.status === 'ready' ? state.client : null
  },
  fetchManifest: () => fetchManifest(SAMPLE_MANIFEST_URL),
  fetchPack: packFetcher(SAMPLE_MANIFEST_URL),
  online: () => navigator.onLine,
  onReport: (report) => noteInstallReport(report, lifecycle),
})

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault()
  lifecycle.installAvailable(event as unknown as InstallEvent)
})
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
if (ios && !standalone) lifecycle.iosInstallable()
```

   Import `dayToIsoDate` and `localDay` from `@wordado/core` (the local day of spec §8.4, and its ISO date). The `store.subscribe` fires on every boot state change, and re-creating the audio watch on each is cheap.
5. Replace the service worker registration at the end with:

```ts
// Offline after the first visit (spec §9.1), and "a new version is ready". Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').then(
    (registration) => watchUpdates(registration, navigator.serviceWorker, lifecycle),
    () => undefined,
  )
}
```

   A real `ServiceWorkerRegistration` and `ServiceWorkerContainer` fit `watchUpdates`'s parameter shapes structurally (`ServiceWorker` has `state`, `postMessage` and `addEventListener`), so no cast is needed. If `pnpm typecheck` disagrees on the `addEventListener` overloads, widen the parameter types in `lifecycle.ts` to `Pick<ServiceWorkerRegistration, 'waiting' | 'installing' | 'addEventListener'>` and `Pick<ServiceWorkerContainer, 'controller' | 'addEventListener'>`, and make the test's fakes cast to those.
6. Add `lifecycle` to `services`.

- [ ] **Step 9: Run everything, and commit**

Run: `pnpm --filter @wordado/web exec vitest run && pnpm --filter @wordado/web build`
Expected: PASS, and the build's precache list (printed by `vite-plugin-pwa`) no longer contains `.m4a` files.

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

Run the 6a demo end to end, which must still pass with the sample's audio no longer precached: `pnpm --filter @wordado/web e2e`. Its offline test reloads after a first online visit, by which time `onReady` has fetched the clips.

```bash
git add web
git commit -m "feat(web): install and update prompts, the periodic pack check, one audio cache, and PNG icons"
```

---

### Task 14: accounts end to end against the real Worker, every new screen scanned, and the roadmap

The whole plan in a real Chromium against plan 5's Worker and Postgres, as a learner meets it:

- a demo carried into a new account;
- study offline, then reconnect: the sync half of spec §13's airplane-mode scenario, which 6a left to this plan;
- a learner below the age turned away;
- the demo discarded for an account that has progress;
- settings that follow the learner to another device;
- sign-out and deletion;
- an axe scan of every new screen, in light and dark.

**Files:**
- Create: `web/playwright.accounts.config.ts`, `web/e2e/accounts.setup.ts`, `web/e2e/accounts.spec.ts`, `web/e2e/helpers.ts`
- Modify: `web/e2e/demo.spec.ts`, `web/playwright.config.ts`, `web/package.json`, `server/wrangler.jsonc`, `web/README.md`, `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`

**Interfaces:**
- Consumes: everything above; plan 5's `pnpm --filter @wordado/server dev`, which prints `Sign-in code for <email>: <code>`.
- Produces:
  - `pnpm --filter @wordado/web e2e:accounts` (needs Docker running and port 8787 free).
  - `e2e/helpers.ts`, with `heading`, `answer`, `studyNew`, `expectAccessible(page, { dark? })`.
  - Plan 7 runs both e2e suites in CI.

- [ ] **Step 1: Let the preview origin sign in**

In `server/wrangler.jsonc`, change `"TRUSTED_ORIGINS": "http://localhost:5173"` to `"TRUSTED_ORIGINS": "http://localhost:5173,http://localhost:4173"`, with the comment `// :5173 is the Vite dev server, :4173 the preview build the end-to-end runs use.` Better Auth checks the `Origin` of sign-in requests, and `csrf()` checks `/v1`, against this list. The Vite proxy passes the browser's origin through.

- [ ] **Step 2: Share the demo run's helpers**

Create `web/e2e/helpers.ts` by moving `heading`, `answer`, `studyNew` and `expectAccessible` out of `web/e2e/demo.spec.ts`, exported. Import them back into `demo.spec.ts`. Extend `expectAccessible` to scan a dark rendering too:

```ts
/** Scans the page for WCAG 2.2 A and AA (spec §11.1); `dark` repeats the scan in the dark theme. */
export async function expectAccessible(page: Page, options: { readonly dark?: boolean } = {}): Promise<void> {
  for (const colorScheme of options.dark ? (['light', 'dark'] as const) : (['light'] as const)) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
    expect(results.violations.map((v) => `${colorScheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: null })
}
```

Emulating reduced motion replaces 6a's fixed 250 ms wait for the card's animation, which was a deferred minor.

In `web/e2e/demo.spec.ts`'s accessibility test, add the new screens a demo can reach, before its end:

```ts
  for (const path of ['/settings', '/signin', '/settings/placement']) {
    await page.goto(path)
    await expect(heading(page)).toBeVisible()
    await expectAccessible(page, { dark: true })
  }
```

In `web/playwright.config.ts`, add `testMatch: 'demo.spec.ts'`, so the demo run never needs the server.

- [ ] **Step 3: Start the Worker for the accounts run**

Create `web/e2e/accounts.setup.ts`. Playwright's global setup must be a default export, like the configs.

```ts
import { spawn } from 'node:child_process'
import { createWriteStream, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Where the Worker's output goes: the sign-in codes are read from it (plan 5 prints them in development). */
export const WORKER_LOG = fileURLToPath(new URL('../test-results/worker.log', import.meta.url))
const HEALTH = 'http://localhost:8787/health'

const up = async () => {
  try {
    return (await fetch(HEALTH)).ok
  } catch {
    return false
  }
}

/** Starts plan 5's Worker, with Postgres in Docker, and stops it afterwards. */
export default async function setup(): Promise<() => Promise<void>> {
  if (await up()) throw new Error('A Worker is already running on :8787. Stop it: this run reads sign-in codes from its own Worker’s output.')
  mkdirSync(fileURLToPath(new URL('../test-results/', import.meta.url)), { recursive: true })
  const log = createWriteStream(WORKER_LOG)
  const worker = spawn('pnpm', ['--filter', '@wordado/server', 'dev'], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  worker.stdout.pipe(log)
  worker.stderr.pipe(log)
  const deadline = Date.now() + 180_000
  while (!(await up())) {
    if (worker.exitCode !== null) throw new Error(`The Worker exited (${worker.exitCode}); see ${WORKER_LOG}`)
    if (Date.now() > deadline) throw new Error(`The Worker did not answer ${HEALTH}; see ${WORKER_LOG}`)
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return async () => {
    try {
      process.kill(-worker.pid!, 'SIGTERM')
    } catch {
      // Already gone.
    }
  }
}
```

Create `web/playwright.accounts.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

/** Accounts end to end: the preview build, proxying /api and /v1 to plan 5's Worker, which global setup starts. */
export default defineConfig({
  testDir: 'e2e',
  testMatch: 'accounts.spec.ts',
  globalSetup: './e2e/accounts.setup.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
```

Add to `web/package.json`'s scripts: `"e2e:accounts": "playwright test -c playwright.accounts.config.ts"`. Add `playwright.accounts.config.ts` to `web/tsconfig.json`'s `include`.

- [ ] **Step 4: Write the accounts run**

Create `web/e2e/accounts.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { WORKER_LOG } from './accounts.setup'
import { expectAccessible, heading, studyNew } from './helpers'

let clientIp = 0

/** A context in English, with its own client address: Better Auth limits code requests per address (plan 5). */
async function context(browser: Browser): Promise<BrowserContext> {
  clientIp += 1
  const ctx = await browser.newContext()
  await ctx.setExtraHTTPHeaders({ 'cf-connecting-ip': `10.77.${Math.floor(clientIp / 250)}.${(clientIp % 250) + 1}` })
  await ctx.addInitScript(() => {
    if (localStorage.getItem('wordado.locale') === null) localStorage.setItem('wordado.locale', 'en')
  })
  return ctx
}

const address = (tag: string) => `e2e-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`

/** The code the Worker printed for `email`, the newest one (plan 5's console mailer). */
async function codeFor(email: string): Promise<string> {
  const pattern = new RegExp(`Sign-in code for ${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: (\\d{6})`, 'g')
  const deadline = Date.now() + 15_000
  for (;;) {
    const matches = [...readFileSync(WORKER_LOG, 'utf8').matchAll(pattern)]
    const last = matches.at(-1)?.[1]
    if (last) return last
    if (Date.now() > deadline) throw new Error(`No sign-in code for ${email} in ${WORKER_LOG}`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/** Through the age gate and an emailed code, as a learner would (spec §8.6, §11). */
async function signIn(page: Page, email: string, gate: { country?: string; year?: number } = {}): Promise<void> {
  await page.goto('/signin')
  await page.getByLabel('Country where you live').selectOption(gate.country ?? 'BG')
  await page.getByLabel('Year of birth').fill(String(gate.year ?? 1990))
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
}

const synced = (page: Page) => expect(page.getByText('All progress saved to your account')).toBeVisible({ timeout: 15_000 })

async function exported(page: Page): Promise<{ reviewEvents: { wordId: string; deviceId: string }[]; documents: { type: string; fields: Record<string, unknown> }[] }> {
  const response = await page.request.get('/v1/export')
  expect(response.status()).toBe(200)
  return response.json()
}

test('carries the demo into a new account, from the demo’s own device, and syncs it (spec §8.6)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/')
  await studyNew(page, 2)
  const email = address('carry')
  await signIn(page, email)
  await expect(page.getByText('Your account is ready, and the words you studied in the demo are in it.')).toBeVisible()
  await synced(page)
  const carried = (await exported(page)).reviewEvents
  expect(carried).toHaveLength(2)
  // Both answers came from one device, the demo's, and the learner's own file is another.
  expect(new Set(carried.map((e) => e.deviceId)).size).toBe(1)
  await page.reload()
  await page.goto('/settings')
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible()
  await ctx.close()
})

test('studies offline, then syncs on reconnecting (spec §13)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await signIn(page, address('offline'))
  await ctx.setOffline(true)
  await studyNew(page, 1)
  await page.goto('/')
  await expect(page.getByText('Offline: 1 answer syncs when you are back online')).toBeVisible()
  await ctx.setOffline(false)
  await synced(page)
  expect((await exported(page)).reviewEvents).toHaveLength(1)
  await ctx.close()
})

test('turns away a learner below their country’s age, before any code is sent (spec §11)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  await page.goto('/signin')
  await page.getByLabel('Country where you live').selectOption('DE')
  await page.getByLabel('Year of birth').fill(String(new Date().getFullYear() - 15))
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(heading(page)).toHaveText('Sorry, you can’t create an account yet')
  await expect(page.getByLabel('Email')).toHaveCount(0)
  await ctx.close()
})

test('deletes the demo when signing in to an account that has progress, and merges nothing (spec §8.6)', async ({ browser }) => {
  const email = address('existing')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await studyNew(a, 1)
  await a.goto('/')
  await synced(a)

  const second = await context(browser)
  const b = await second.newPage()
  await b.goto('/')
  await studyNew(b, 3)
  await b.goto('/signin')
  await b.getByLabel('Year of birth').fill('1990')
  await b.getByRole('button', { name: 'Continue' }).click()
  await expect(b.getByText(/the words you studied in the demo are deleted/)).toBeVisible()
  await signIn(b, email)
  await expect(b.getByText(/This email already had an account, so the demo was deleted/)).toBeVisible()
  await synced(b)
  expect((await exported(b)).reviewEvents).toHaveLength(1)
  await first.close()
  await second.close()
})

test('settings follow the learner to another device (spec §9.2)', async ({ browser }) => {
  const email = address('settings')
  const first = await context(browser)
  const a = await first.newPage()
  await signIn(a, email)
  await a.goto('/settings')
  await a.getByLabel('New words a day').fill('5')
  await a.getByLabel('New words a day').press('Enter')
  await a.getByRole('checkbox', { name: 'Count slow answers as “hard”' }).uncheck()
  await a.goto('/')
  await synced(a)

  const second = await context(browser)
  const b = await second.newPage()
  await signIn(b, email)
  await synced(b)
  await expect(heading(b)).toHaveText('5 new words')
  await b.goto('/settings')
  await expect(b.getByRole('checkbox', { name: 'Count slow answers as “hard”' })).not.toBeChecked()
  await first.close()
  await second.close()
})

test('signs out leaving nothing behind, then deletes the account (spec §11)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('leave')
  await signIn(page, email)
  await studyNew(page, 1)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByText('You are signed out. Nothing of your account is left on this device.')).toBeVisible()
  await expect(heading(page)).toHaveText('10 new words')

  await signIn(page, email)
  await page.goto('/settings')
  await page.getByRole('button', { name: 'Delete your account' }).click()
  await page.getByRole('checkbox', { name: 'I understand that my progress is deleted for good' }).check()
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByText('Your account and everything in it has been deleted.')).toBeVisible()
  expect((await page.request.get('/v1/me')).status()).toBe(401)
  await ctx.close()
})

test('meets WCAG 2.2 A and AA on the account screens, light and dark (spec §11.1)', async ({ browser }) => {
  const ctx = await context(browser)
  const page = await ctx.newPage()
  const email = address('a11y')
  await page.goto('/signin')
  await expectAccessible(page, { dark: true })
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Year of birth').fill('1990')
  await page.getByRole('button', { name: 'Continue' }).click()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Email me a code' }).click()
  await expect(page.getByLabel('Code')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.getByLabel('Code').fill(await codeFor(email))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL('/')
  await expectAccessible(page, { dark: true })
  await page.goto('/settings')
  await expectAccessible(page, { dark: true })
  await page.getByRole('button', { name: 'Delete your account' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectAccessible(page, { dark: true })
  await page.keyboard.press('Escape')
  await page.goto('/path')
  await page.locator('details.unit-words').first().evaluate((d) => ((d as HTMLDetailsElement).open = true))
  await expectAccessible(page, { dark: true })
  await ctx.close()
})
```

- [ ] **Step 5: Run it**

Make sure Docker is running and nothing listens on :8787, then:

Run: `pnpm --filter @wordado/web e2e:accounts`
Expected: 7 passed.

If a code request answers 429, the `cf-connecting-ip` header did not reach Better Auth. Check `vite preview` forwards custom headers through its proxy (it does by default), and that the Worker reads `cf-connecting-ip` (plan 5's `advanced.ipAddress`).

Run it a second time. It must pass again, because every run uses new addresses.

Run: `pnpm --filter @wordado/web e2e`
Expected: the demo run passes, with the new screens in its scan.

- [ ] **Step 6: Document it, and update the roadmap**

In `web/README.md`, add a section "Accounts end to end", saying:

- `pnpm --filter @wordado/web e2e:accounts` starts plan 5's Worker (Docker must be running, port 8787 free), builds and previews the app, and signs in with codes read from the Worker's output;
- the demo run, `pnpm --filter @wordado/web e2e`, needs no server;
- for local development with accounts, run `pnpm --filter @wordado/server dev` beside `pnpm --filter @wordado/web dev`, and copy sign-in codes from the Worker's terminal.

In `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`:

1. Bold plan 6b's title in the table and give it its file name: `**Web client: accounts and settings** — \`2026-09-24-web-accounts-and-settings.md\``.
2. In plan 7's "Delivers" cell, add: `; the CDN manifest for learners (\`VITE_CONTENT_MANIFEST_URL\`) beside the bundled sample for the demo, with an \`AudioStore\` per manifest (moved from 6b); both end-to-end suites (\`e2e\`, \`e2e:accounts\`) in the browser matrix`.
3. Under "Blockers outside the code", in the legal-review bullet, add: `The age gate ships with a provisional table (\`web/src/account/ageGate.ts\`) that the review must confirm before the beta opens.`

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add web server/wrangler.jsonc docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md
git commit -m "test(web): accounts end to end against the Worker, every new screen scanned light and dark; roadmap"
```

---

## Run it

- `pnpm test`, `pnpm typecheck`: every package.
- `pnpm --filter @wordado/web e2e`: the demo, no server.
- `pnpm --filter @wordado/web e2e:accounts`: accounts against plan 5's Worker; Docker running, :8787 free.
- By hand: `pnpm --filter @wordado/server dev` and `pnpm --filter @wordado/web dev`, then `http://localhost:5173`. Sign-in codes appear in the Worker's terminal. Reminders need VAPID keys in `server/.dev.vars` (`pnpm --filter @wordado/server vapid-keys`).

## Contracts this plan hands to the later plans

- **Deploy order** (plan 7). The server must accept `latencyGrading` in a settings patch before a client that sends it ships. Plan 5's server validates with `core`'s `validateSettingsPatch`, so deploying the server built from this commit first is enough. An older server rejects the whole write as `invalid`, and the client then drops it and resets its cursor (plan 4), losing the change.
- **Trusted origins** (plan 7). Every deployed origin that serves the app — production, and each preview deployment — must be in `TRUSTED_ORIGINS`, or sign-in and `/v1` writes are refused. The Google callback URLs the app sends (`<origin>/?signin=google` and `?signin=google-error`) must be allowed by Better Auth for the same origins.
- **The CDN manifest** (plan 7). Learners install from `VITE_CONTENT_MANIFEST_URL` while the demo keeps the bundled sample. `AudioStore` gets one instance per manifest (or keys its cache by manifest URL). `main.tsx`'s "fetch every sample clip" narrows to the sample's manifest. `startPackChecks` checks the learner's manifest.
- **Both end-to-end suites in CI** (plan 7). `e2e` needs nothing; `e2e:accounts` needs Postgres and the Worker, which its global setup starts with `pnpm --filter @wordado/server dev`. Run it across spec §13's browser matrix. On WebKit, Web Push and `beforeinstallprompt` do not exist, so the reminder and install sections show their explanations, and those are what to assert there.
- **Identity check on account deletion and export** (next plan to touch the server; before the beta). Sync and push-subscription requests carry `x-wordado-user` and the server answers 409 `wrong_user` on a mismatch (final review, 2026-09-25). `DELETE /v1/account` and `GET /v1/export` are not yet checked. A device holding learner A's record with B's session cookie (a sign-in as B followed by a failed sign-out) would delete B's server account, then A's local file, and export B's data. Put the same header check on both routes; the export then needs a fetch (or a query parameter) instead of a plain link.
- **The age-of-consent table** (legal review, before the beta). `web/src/account/ageGate.ts` holds the provisional table and names the review as pending.
- **Bulgarian copy** (plan 8's native review). Every string this plan adds to `bg.ts` awaits the same review as 6a's.

Left for later plans: telling a reporter their report was fixed (plan 8); leaderboards, friends and league standings (Phase 2); personal words and their capture paths (Phase 2); a "new words from a theme" onboarding question in the mobile client (with the mobile client).
