# First-Run Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A short setup the first time someone opens Wordado (the demo, or a new account). It asks for the native language and shows its download, then offers a level, a first theme, and a daily goal with reminders, each skippable. A returning learner never sees it. Changing the native language later reuses the language-and-download screen.

**Architecture:**
- **When setup runs.** `Boot` decides at open time. The opened file has no pack, the learner's settings name no L1 and nothing has been studied; for an account, this holds after a short first pull. When it decides setup is needed, it skips the install and goes `ready` with `setup: true`. `App` then shows the setup screens in place of the routed screens; Sign in stays reachable.
- **One installer.** `PackSwitcher` is the one place that installs a language's pack, with progress. The watcher (`watchL1`), the setup and Settings all use it.
- **Finishing.** The setup ends with `boot.finishSetup()`.

**Tech Stack:** pnpm monorepo, TypeScript 7 (`exactOptionalPropertyTypes`), React, Vitest with happy-dom, Playwright, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`. The relevant sections:
- §2 Goal 1: zero to studying in under two minutes.
- §7.2: placement is optional, never a blocking onboarding step.
- §8.6: the onboarding budget. Sign-up asks for L1, credentials and the age check; there is one optional theme question; the demo needs no download; changing the L1 keeps progress.
- §8.9: themes.
- §8.11: reminders.
- §11.1: accessibility.
- §11.2: the interface in each L1 and English.

Plan 10, `docs/superpowers/plans/2026-09-30-l1-choice-and-german.md`, built what this plan builds on:
- `Client.changeL1`;
- `watchL1`;
- the sign-in language choice, which this plan replaces.

## Decisions

1. **Who sees the setup.** The setup runs when all three of these hold for the file just opened:
   - no pack is active;
   - `settings.l1` is null;
   - no word has review state.

   For an account, the check runs only after a first pull completes, bounded by `SETUP_PULL_TIMEOUT_MS = 5000`. This is so a returning learner's own settings and progress count. When that pull fails or times out, the open takes the existing path: install the default L1 and go `ready` without setup. As a result:
   - **The demo's first launch** and **a brand-new account** get the setup.
   - **A returning learner on a new device** does not. Their pulled `settings.l1` also makes the first install fetch their language, once. This fixes plan 10's "a new device downloads the Bulgarian pack first".
   - **An account from before plan 10** (no `l1`, but progress) never gets it.
2. **Boot state.** The `ready` state gains `setup: boolean`, and `Boot.finishSetup()` sets it false. A separate status would have broken every `status === 'ready'` check, such as the account controller's sign-in and the sync loop. Those checks must keep working during setup: a learner can sign in from the setup, and an account's choices must sync.
3. **Steps, in order.**
   - **Language** is required, and preselected from the interface language (German interface → Deutsch, else Български). Choosing it writes `settings.l1` and installs the pack:
     - the demo's pack is bundled, so it is instant (spec §8.6: the demo needs no download);
     - an account's pack downloads with a progress bar;
     - a failure says so and offers "Try again".
   - **Level** shows only when the installed pack has more than one level, so the demo's A1-only sample skips it. A1 is preselected. A note says the placement test can be taken later in Settings, because spec §7.2 says placement never blocks onboarding.
   - **Theme** is the spec's one optional question, "What do you want English for?". It moves here from Home.
   - **Daily goal and reminders.** The goal is optional. Reminders appear only for an account whose browser supports them, reusing `ReminderSettings`.

   Every step after Language has **Skip** and **Start studying**. Start studying ends the setup at once, which keeps Goal 1's two minutes.
4. **The spec's onboarding budget.** Spec §8.6 asks for a single optional question; the product owner asked for a goal and reminders as well. Both stay, as one optional, skippable screen, and Start studying is on every step. *Product owner: strike step 4 at plan review if the budget should hold strictly.*
5. **No resume.** The setup is not resumed half-way. Once a language is installed, a reload or a closed tab opens the app with the defaults for the remaining steps. If the setup is left before the language is installed, the next launch shows it again.
6. **Sign in from the setup.** The setup's first screen links to Sign in, for a returning learner on a new device. `App` renders the `signin` route even during setup.
7. **The sign-in language choice goes.** Plan 10's gate radio and `AccountController.saveL1` are removed, because the setup asks after sign-up instead.
   - `PendingSignIn` keeps reading an old stored `l1` and ignores it.
   - `completeSignIn` loses its `l1` parameter.
8. **One installer: `PackSwitcher`.** It runs one install at a time and publishes `{ phase, l1, received, total }`. `watchL1`, the setup's Language step and the Settings language page all install through it, so they never race.
   - Progress counts the bytes received against the manifest's `bytes`, which is exactly what a pack's integrity check requires.
   - `packFetcher` gains an optional `onProgress`.
9. **Changing the language later** (Settings › Languages) opens `/settings/native-language`. That page is the Language step in a page:
   - It asks for confirmation: "Your progress stays."
   - It writes `settings.l1` and shows the download.
   - Offline, it says the switch will happen once online, and `watchL1` finishes it.
   - Plan 10's in-place confirm dialog goes. The pending note stays in Settings, for a change synced from another device.
10. **Home's onboarding theme block is removed**, because the setup asks the question.
11. **`Client.changeL1` installs a first pack too.** Its early return compares against the active corpus's L1, not `Client.l1`. Without a pack, `Client.l1` follows the setting, so the old comparison returned `ok` with nothing installed.
12. **Pack checks skip a client with no corpus.** Otherwise a setup left open for six hours would stage the default L1's pack.

## Global Constraints

- **Commits:** the author is always `11029931+danchom@users.noreply.github.com`. Write the message to a file, then run `git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -F <file>`.
- **Dependencies:** none are added. The pnpm minimum-release-age gate stays as it is.
- **Root checks:** `pnpm typecheck` and `pnpm lint` (`oxlint --deny-warnings`) pass at the repository root.
- **Strings:** every interface string exists in `web/src/i18n/en.ts`, `bg.ts` and `de.ts` with the same keys, shapes and placeholders. German uses the informal "du" and „…“ quotes. Bulgarian uses the formal register of the existing table.
- **Accessibility (spec §11.1):** every step has a heading that takes focus when the step appears. Every control works by keyboard. The progress bar is a `role="progressbar"` with values. Results and errors are announced (`role="status"` / `role="alert"`).
- **Business strategy** (prices, business model, payment providers, market or competitor reasoning) never goes into this public repository: not in code, comments or commit messages.

## Review Focus

1. **A returning learner on a slow or failing network.** When the first pull times out on a fresh device, the open must take the old path (default install, no setup). It must never show a setup that would overwrite their account. Pinned in Task 4.
2. **An account from before plan 10.** It has progress and `settings.l1` null, and it must never see the setup. Pinned in Task 4.
3. **The tab closed during the download.** The next launch has `settings.l1` set and no pack, so it installs that L1 without setup and does not ask again. Pinned in Task 4.
4. **Offline at the Language step for an account.** The learner gets a clear failure with Try again, and Sign in is still reachable; it is never a dead end. Pinned in Task 6.
5. **Sign in from the setup.** It must work: the controller needs `ready`, which the setup is. Afterwards a returning learner lands in the app, and a new account gets the setup. Pinned in Tasks 4 and 9.

---

### Task 1: client-data — `changeL1` installs a first pack

**Files:**
- Modify: `client-data/src/client.ts` (`changeL1`)
- Test: `client-data/src/client.test.ts`

**Interfaces:**
- Produces: `Client.changeL1(l1, manifest, fetchPack)` installs and activates the pack when no pack is active, even when `l1` equals `Client.l1`. It returns `{ ok: true }` without fetching only when the active corpus is already in `l1`.

- [ ] **Step 1: Write the failing tests** (use `client.test.ts`'s `openClient()` pattern and the two-language sample manifest)
  - **First pack, the default L1.** A client opened with `l1: 'bg'` and nothing installed; `changeL1('bg', manifest, fetchPack)` returns `{ ok: true }`. Afterwards `snapshot.corpus?.l1 === 'bg'`, and `fetchPack` was called once.
  - **First pack, the setting's L1.** After `updateSettings({ l1: 'de' })`, `changeL1('de', …)` installs German: `snapshot.corpus?.l1 === 'de'`.
  - **Same L1 already active.** With `corpus-bg` active, `changeL1('bg', …)` returns `{ ok: true }` and never calls `fetchPack`.
- [ ] **Step 2: Run them and see them fail**

Run: `cd client-data && npx vitest run src/client.test.ts`
Expected: FAIL, because the first two return `ok` with `corpus` still null.

- [ ] **Step 3: Implement.** In `changeL1`, replace the early return:

```ts
      // Compared with the active corpus, not `this.l1`: with no pack yet, `this.l1` follows the setting, and the first
      // install (the setup's Language step) must still fetch.
      if (this.corpus !== null && l1 === this.corpus.l1) return { ok: true }
```

Update the doc comment to say that `changeL1` also installs the first pack.

- [ ] **Step 4: Run and see them pass**

Run: `cd client-data && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(client-data): changeL1 installs the first pack too`.

---

### Task 2: web — pack downloads report their progress

**Files:**
- Modify: `web/src/content/packs.ts` (`packFetcher`)
- Test: `web/src/content/packs.test.ts`

**Interfaces:**
- Produces: `packFetcher(fetchFn?, onProgress?: (received: number, total: number) => void): PackFetcher`.
  - `total` is the descriptor's `bytes`.
  - `received` grows as chunks arrive.
  - It is called once with `(0, total)` before the first chunk and once with `(total, total)` at the end.
  - When the response has no readable body, it falls back to `arrayBuffer()` and reports only the start and the end.

- [ ] **Step 1: Write the failing tests**
  - **Chunks.** A fake `fetchFn` returns `new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(3)); c.enqueue(new Uint8Array(2)); c.close() } }))`. With descriptor `bytes: 5`, the fetcher resolves 5 bytes, and `onProgress` saw `[0,5]`, `[3,5]`, `[5,5]` in order.
  - **No body.** A response built with `new Response(null)`, wrapped so that `body` is null, resolves through `arrayBuffer()` and reports `[0,n]` and `[n,n]`.
  - **Not ok.** A 404 still throws "The pack could not be fetched (404)".
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/content/packs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
/** client-data's PackFetcher on the web: the pack's URL as `fetchManifest` resolved it. Throws on any failure. */
export function packFetcher(fetchFn: Fetch = (i, init) => fetch(i, init), onProgress?: (received: number, total: number) => void): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(descriptor.url)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    const total = descriptor.bytes
    onProgress?.(0, total)
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer())
      onProgress?.(bytes.byteLength, total)
      return bytes
    }
    // Read in chunks so the setup can show how far the download is (plan 11, Decision 8); the integrity check that
    // follows (`installPacks`) still compares the size and checksum with the manifest.
    const chunks: Uint8Array[] = []
    let received = 0
    const reader = response.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      received += value.byteLength
      onProgress?.(received, total)
    }
    const bytes = new Uint8Array(received)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    if (received !== total) onProgress?.(received, total)
    return bytes
  }
}
```

Adjust it so the reported sequence is exactly as the tests specify. There must be one report at the end, so do not report `(total, total)` twice when the last chunk already brought `received` to `total`.

- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run src/content && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(web): pack downloads report how far they are`.

---

### Task 3: web — `PackSwitcher`, the one place that installs a language

**Files:**
- Create: `web/src/app/packSwitch.ts`, `web/src/app/packSwitch.test.ts`
- Modify:
  - `web/src/main.tsx`: create one switcher; `watchL1`'s install calls it.
  - `web/src/app/content.ts`: `startPackChecks` skips a client with no corpus.
  - `web/src/app/context.tsx`: `AppServices` gains `packs: PackSwitcher`.
- Test: `web/src/app/content.test.ts`

**Interfaces:**
- Consumes:
  - Task 1's `Client.changeL1`, which installs a first pack too.
  - Task 2's `packFetcher(fetchFn, onProgress)`.
- Produces:

```ts
export type PackSwitchState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'downloading'; readonly l1: L1; readonly received: number; readonly total: number }
  | { readonly phase: 'failed'; readonly l1: L1 }

export interface PackSwitchDeps {
  fetchManifest(account: AccountRecord | null): Promise<PackManifest>
  /** A fetcher that reports its progress: `packFetcher(undefined, onProgress)` in the app. */
  fetcher(onProgress: (received: number, total: number) => void): PackFetcher
}

export class PackSwitcher {
  readonly store: Store<PackSwitchState>
  constructor(deps: PackSwitchDeps)
  /**
   * Installs `l1`'s pack on `client` and makes it active (`Client.changeL1`). One install runs at a time: a call for the
   * L1 already being installed returns that install's promise; a call for another L1 waits for it, then runs.
   * Never throws: a failure is `{ ok: false, reason: 'unavailable' }`, and the store says `failed`.
   */
  install(client: Client, account: AccountRecord | null, l1: L1): Promise<ChangeL1Outcome>
  /** Back to idle (the setup's "Try again" first clears a failure). */
  reset(): void
}
```

- [ ] **Step 1: Write the failing tests** (`packSwitch.test.ts`, with a fake client whose `changeL1` calls the `fetchPack` it is given, and a fake `fetcher`)
  - **Progress, then idle.** `install` publishes `downloading` with the progress the fetcher reports, then `idle` on success; it resolves `{ ok: true }`.
  - **Joining.** Two `install(c, null, 'de')` calls while the first runs: `changeL1` is called once, and both resolve with the same outcome.
  - **Queueing.** `install(c, null, 'bg')` while a `'de'` install runs waits for it, then runs; `changeL1` is called twice, in order.
  - **Failure.** A failing manifest fetch resolves `{ ok: false, reason: 'unavailable' }` and leaves the store `failed` with `l1`; `reset()` returns it to `idle`.
  - **`content.test.ts`.** `startPackChecks` does not call `installPacks` for a client whose `snapshot.corpus` is null. Use fake timers and advance by `PACK_CHECK_INTERVAL_MS`.
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/app/packSwitch.test.ts src/app/content.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`packSwitch.ts`.** A small class around `createStore` from `@wordado/client-data`.
    - Keep `running: { l1, promise } | null` and a promise chain for queued calls.
    - Map a thrown error to `{ ok: false, reason: 'unavailable' }`.
    - Set `failed` on any `ok: false`.
  - **`main.tsx`.**
    - Create `const packs = new PackSwitcher({ fetchManifest: (account) => fetchManifest(manifestUrlFor(account)), fetcher: (onProgress) => packFetcher(undefined, onProgress) })`.
    - `watchL1`'s install becomes `(l1) => packs.install(state.client, state.account, l1)`.
    - Pass `packs` into `Root`'s services.
  - **`content.ts`.** In `startPackChecks`, `if (!client || !client.snapshot.corpus || !options.online()) return`.
- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(web): one pack switcher with progress for every language install`.

---

### Task 4: web — `Boot` decides on the setup

**Files:**
- Modify: `web/src/app/boot.ts`, `web/src/app/Root.tsx` (it passes `setup` on)
- Test: `web/src/app/boot.test.ts`

**Interfaces:**
- Produces:
  - `BootState`'s `ready` has `readonly setup: boolean`.
  - `Boot.finishSetup(): void` sets `setup: false` on a `ready` state holding the same client. It does nothing otherwise.
  - `export const SETUP_PULL_TIMEOUT_MS = 5_000`.
  - `BootDeps.setupPullTimeoutMs?: number`, which tests shorten.

- [ ] **Step 1: Write the failing tests** (`boot.test.ts`, the file's fake deps; the sample manifest; a fake transport whose pull you control)
  - **The demo's first launch.**
    - It goes `ready` with `setup: true`.
    - No pack was fetched, and `client.snapshot.corpus` is null.
    - `finishSetup()` then sets `setup: false`.
  - **The demo with a pack installed** (open, install, close, reopen) goes `ready` with `setup: false`.
  - **Tab closed during the download (Review Focus 3).** A demo whose `settings.l1` is `'de'` and which has no pack installs German and goes `ready` with `setup: false`.
  - **A new account.** The pull completes with empty settings and no events, so the account gets `setup: true`, and no pack is fetched.
  - **A returning learner on a new device.** The pull brings `settings.l1: 'de'`, so German is installed (the fetcher saw `corpus-de`, never `corpus-bg`), with `setup: false`.
  - **An account from before plan 10 (Review Focus 2).** The pull brings review events and no `l1`, so Bulgarian is installed with `setup: false`.
  - **The pull times out (Review Focus 1).** The pull never resolves (`setupPullTimeoutMs: 20`), so the open installs the default L1 and goes `ready` with `setup: false`.
  - **`switchTo` during setup (Review Focus 5).** From a demo in setup, `switchTo()` to a recorded account works like any other switch.
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/app/boot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `Boot.open`, after the Client is acquired and before the install:

```ts
      if (await this.needsSetup(client, generation)) {
        if (generation !== this.generation) return
        await client.startSession()
        if (this.account && this.deps.startSync) this.stopSync = this.deps.startSync(client, this.backend)
        this.store.set({ status: 'ready', client, backend: this.backend, resumed, account: this.account, setup: true })
        return
      }
```

Then add these members to `Boot`:

```ts
  /**
   * The first-run setup (plan 11, Decision 1): this file has no pack, its settings name no L1, and nothing has been
   * studied. For an account those facts count only after a pull completes, so a returning learner's own settings and
   * progress decide. A pull that fails or times out takes the ordinary path. Even without the setup, a completed pull
   * has done its other job: `settings.l1` now chooses the first install.
   */
  private async needsSetup(client: Client, generation: number): Promise<boolean> {
    if (client.snapshot.corpus !== null) return false
    if (this.account) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), this.deps.setupPullTimeoutMs ?? SETUP_PULL_TIMEOUT_MS)
      })
      const outcome = await Promise.race([client.sync({ force: true }).catch(() => 'failed' as const), timeout])
      clearTimeout(timer)
      if (generation !== this.generation || outcome !== 'synced') return false
    }
    const { settings, states } = client.snapshot
    return settings.l1 === null && states.size === 0
  }

  /** The setup is over (plan 11): the app's own screens take over. */
  finishSetup(): void {
    const state = this.store.get()
    if (state.status === 'ready' && state.setup) this.store.set({ ...state, setup: false })
  }
```

  - Every other `ready` the boot sets carries `setup: false`.
  - Check `SyncOutcome` in `client-data/src/sync.ts` for the exact value of a completed sync, and adjust the comparison to match.
  - `Root` and `App` are unchanged in this task, apart from passing the state through. Task 6 renders the setup.
- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. The tests that build a `ready` state by hand gain `setup: false`.

- [ ] **Step 5: Commit.** Subject: `feat(web): the boot opens a first-run setup for a new demo or account`.

---

### Task 5: web — the Language step

**Files:**
- Create: `web/src/setup/LanguageStep.tsx`, `web/src/setup/LanguageStep.test.tsx`
- Modify: `web/src/i18n/{en,bg,de}.ts`

**Interfaces:**
- Consumes:
  - Task 3's `PackSwitcher` (`useApp().packs`).
  - `languageName`, `useT` and `initialLocale` from `web/src/i18n/i18n.tsx`.
- Produces: `LanguageStep(props: { readonly mode: 'setup' | 'change'; onDone(): void })`.
  - **`setup` mode:**
    - A radio per `SUPPORTED_L1S`, labelled with endonyms through `languageName(l1, l1)`. The preselection is `settings.l1 ?? (locale === 'de' ? 'de' : 'bg')`.
    - A primary button, "Continue".
    - A link to Sign in (`{ name: 'signin' }`), labelled "I already have an account".
  - **`change` mode:**
    - The same radios, preselected with the installed L1.
    - Choosing another L1 shows "Your progress stays. The words switch to {language} translations." with a "Change" button.
    - A "Back" link goes to `/settings/languages`.
  - **On go:**
    - `await client.updateSettings({ l1 })`. If the interface was in the old L1 and the mode is `change`, the interface follows with `setLocale(l1)`, as plan 10 did.
    - Then `await packs.install(client, account, l1)`.
    - While downloading, show a `role="progressbar"` labelled "Getting your words ready" with `aria-valuenow={received}` and `aria-valuemax={total}`, plus a percentage. The demo's bundled pack finishes before this is visible, which is fine.
    - **On `ok`:** call `onDone()`.
    - **On failure, account:**
      - Show `role="alert"`: "The words could not be downloaded. Check your connection and try again."
      - Offer a "Try again" button that calls `packs.reset()`, then installs again.
      - In `change` mode, also: "Your choice is saved: the words switch as soon as you are online." Then `watchL1` finishes the switch.
    - **On failure, demo:** the same alert. A demo failure means a broken bundle, so the retry is the only remedy.
  - **Strings, in all three tables:**
    - `setup.language.title` ("Which language do you speak?")
    - `setup.language.hint` ("Words are explained in this language. You can change it later in Settings.")
    - `setup.continue` ("Continue")
    - `setup.haveAccount` ("I already have an account")
    - `setup.downloading` ("Getting your words ready")
    - `setup.downloadFailed` (above)
    - `setup.retry` ("Try again")
    - `setup.savedOffline` (above)

    Reuse `settings.nativeLanguageConfirm` and `settings.nativeLanguageChange` from plan 10.

- [ ] **Step 1: Write the failing tests** (the screen-test pattern of `web/src/settings/NativeLanguageSettings.test.tsx`: a real Client over the two-language sample, the providers, and a fake `PackSwitcher` or a real one with a fake fetcher)
  - **Setup preselection.** A German interface preselects Deutsch; an English one preselects Български.
  - **Continue installs the pack.** Continue writes `settings.l1: 'de'`, calls `packs.install(…, 'de')`, and calls `onDone` after `ok`.
  - **The progress bar.** It shows while the install is pending: drive the fake switcher's store to `downloading` with received 50 of total 100, and expect `aria-valuenow="50"`.
  - **Failure (Review Focus 4).** On failure the alert shows; "Try again" resets and installs again. The Sign-in link is still there.
  - **Change mode.** Choosing the other language asks for confirmation. On Change it writes the setting, installs, then calls `onDone`. When the interface spoke the old L1, the interface follows.
  - **Focus.** The step's heading has focus when it mounts.
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/setup/LanguageStep.test.tsx src/i18n`
Expected: FAIL.

- [ ] **Step 3: Implement** the component as specified, following `NativeLanguageSettings.tsx` for the radios and `StudySettings.tsx` for announced status. Add the strings.
- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(web): the language step, with its download shown`.

---

### Task 6: web — the setup flow and its other steps

**Files:**
- Create:
  - `web/src/setup/Setup.tsx`, `web/src/setup/Setup.test.tsx`
  - `web/src/setup/LevelStep.tsx`
  - `web/src/setup/ThemeStep.tsx`
  - `web/src/setup/GoalStep.tsx`
- Modify:
  - `web/src/app/App.tsx`: during setup, render `Setup` except on the `signin` route.
  - `web/src/app/Root.tsx`: pass `setup` and `boot.finishSetup` down.
  - `web/src/screens/Home.tsx`: remove the onboarding theme block and its state.
  - `web/src/i18n/{en,bg,de}.ts`
- Test: `web/src/screens/Home.test.tsx`, `web/src/app/Root.test.tsx`

**Interfaces:**
- Consumes:
  - Task 4's `ready.setup` and `Boot.finishSetup()`.
  - Task 5's `LanguageStep`.
- Produces: `Setup(props: { onFinish(): void })`. It runs the steps Language → Level → Theme → Goal:
  - It skips Level when the corpus's units span one level only.
  - It skips Theme when `offeredThemes(corpus)` is empty.
  - Goal is always shown; its reminders part shows only for an account whose `reminders.support()` allows them, by rendering `ReminderSettings`.
  - Every step after Language has **Skip** (to the next step) and **Start studying** (`onFinish`). The last step's primary button is **Start studying**.
  - **Level step:** a radio per level the corpus ships (as `StudySettings` builds `levels`), A1 preselected. Choosing writes `declaredLevel`. Note: `setup.level.later` ("Not sure? You can take a short placement test later in Settings.").
  - **Theme step:** the onboarding question moved from Home (`onboard.title`, `onboard.hint`). Choosing writes `activeTheme` and moves on.
  - **Goal step:** "Set a daily goal", a switch and a number, reusing `StudySettings`' goal pattern with `DEFAULT_DAILY_GOAL = 20`. Below it, `ReminderSettings` when allowed.
  - **Strings, in all three tables:**
    - `setup.title` ("Set up Wordado")
    - `setup.step` ("Step {n} of {count}")
    - `setup.skip` ("Skip")
    - `setup.start` ("Start studying")
    - `setup.level.title` ("Your English level")
    - `setup.level.later` (above)
    - `setup.goal.title` ("A daily goal")
    - `setup.goal.hint` ("Optional. You can set it or change it any time in Settings.")

    Keep `onboard.*` for the theme step. Remove `onboard.skip` if only Home used it, in favour of `setup.skip`.

- [ ] **Step 1: Write the failing tests**
  - **`Setup.test.tsx`, the demo** (the A1 sample, which has themes):
    - Language → Continue lands on Theme; Level is skipped.
    - Choosing a theme writes `activeTheme` and lands on Goal.
    - Start studying calls `onFinish`.
    - The step counter says "Step 2 of 3" on Theme.
  - **`Setup.test.tsx`, a corpus with two levels:**
    - Level shows with A1 preselected.
    - Choosing B1 writes `declaredLevel: 'B1'`.
    - Skip leaves `A1`.
  - **`Setup.test.tsx`, Start studying from the Level step** calls `onFinish` with nothing else written.
  - **`Setup.test.tsx`, Goal for an account with reminders supported** shows the reminder switch; the demo's Goal step does not.
  - **`Root.test.tsx` / `App`:**
    - A `ready` state with `setup: true` renders the setup's Language heading, not Home.
    - With the route `/signin`, it renders Sign in.
    - After `finishSetup()`, it renders Home.
  - **`Home.test.tsx`:** the onboarding block is gone. Remove its tests, and add one that a fresh learner's Home shows no "What do you want English for?".
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/setup src/app/Root.test.tsx src/screens/Home.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement.**
  - `Setup` keeps the current step in state.
  - Each step's heading takes focus when it mounts (spec §11.1).
  - `App` reads `setup` from its props. `Root` passes `state.setup` and `() => props.boot.finishSetup()`.
  - Hide the navigation while the setup shows, the way focus mode hides it, but keep the wordmark, the language menu and the account menu.
- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(web): first-run setup — level, a first theme and a daily goal, each skippable`.

---

### Task 7: web — changing the language later uses the language page; the sign-in choice goes

**Files:**
- Modify:
  - `web/src/router.tsx`: add the route `{ name: 'native-language' }` at `/settings/native-language`.
  - `web/src/app/App.tsx`: render `<LanguageStep mode="change" onDone={() => navigate('/settings/languages')} />` for it, and mark Settings current in the navigation.
  - `web/src/settings/NativeLanguageSettings.tsx`:
    - It shows the current native language, the pending note (kept), and a "Change" link to the new route.
    - Remove the radios and the `ConfirmDialog`.
  - `web/src/screens/SignIn.tsx`: remove the native-language fieldset, its state and its `pending.save` field.
  - `web/src/account/storage.ts`:
    - `PendingSignIn` loses `l1` in what it saves.
    - Its parser still accepts, and ignores, a stored `l1`.
  - `web/src/account/controller.ts`:
    - Remove `saveL1`.
    - `completeSignIn(country)` loses the `l1` parameter.
    - `resumeGoogle` passes `pending.country` only.
  - `web/src/i18n/{en,bg,de}.ts`: remove `signin.nativeLanguage`. Restore `signin.gateIntro` to its pre-plan-10 wording, without the native-language clause.
- Test: `web/src/router.test.tsx`, `web/src/settings/NativeLanguageSettings.test.tsx`, `web/src/screens/SignIn.test.tsx`, `web/src/account/controller.test.ts`, `web/src/account/storage.test.ts`

**Interfaces:**
- Consumes: Task 5's `LanguageStep` (`mode: 'change'`).

- [ ] **Step 1: Write and update the tests**
  - **Router.** `parseRoute('/settings/native-language', '')` gives `{ name: 'native-language' }`, and the route links back to the same path.
  - **NativeLanguageSettings:**
    - It shows "Deutsch" when German is installed.
    - "Change" links to `/settings/native-language`.
    - The pending note still shows when `settings.l1` differs from the installed L1.
  - **SignIn.** The gate step has no native-language fieldset. Remove plan 10's tests of it.
  - **Controller.** `completeSignIn(country)` writes no `settings.l1`. Remove plan 10's `saveL1` tests.
  - **Storage.** A pending sign-in stored with `l1` (from plan 10) still parses.
- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/router.test.tsx src/settings src/screens/SignIn.test.tsx src/account`
Expected: FAIL.

- [ ] **Step 3: Implement** as listed. `grep -rn "saveL1\|signin.nativeLanguage\|completeSignIn(" web/src` must show no stale use.
- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `feat(web): change the native language on the language page; the setup asks at sign-up`.

---

### Task 7a: web — the setup in the Settings look

Added at plan review, after the product owner's direction: "all the pages that you made for the wizard should be styled in same way" as Settings (PR #48: a menu of sections, steppers, segments and switches).

**Files:**
- Modify:
  - `web/src/styles.css`
  - `web/src/setup/Setup.tsx`, `LanguageStep.tsx`, `LevelStep.tsx`, `ThemeStep.tsx`, `GoalStep.tsx`, `step.tsx`
- Test: `web/src/setup/*.test.tsx`

**Interfaces:**
- Consumes: Settings' existing classes and components:
  - `panel`, `.settings-section` (its `h2`, `h3`, `.field` and `.choices` rules);
  - `choices segmented-field` + `segmented` (the level control in `StudySettings`);
  - `switch-field`, and `NumberSetting` / `DailyGoalSetting`;
  - `settings-row` (an icon, a title and a note).

- [ ] **Step 1: Share the section styles, don't copy them.** The `.settings-section …` rules for headings, fields and choices also apply to a new class, `.form-section`. Do this either by adding `.form-section` to those selectors or by renaming them to a shared class used by both. Settings looks exactly as before.
- [ ] **Step 2: The setup's layout.**
  - The setup is one `panel form-section` card, with the same width as a Settings section page.
  - Its title (`h1`) and step counter (the `eyebrow`) sit above the card, as Settings' title sits above its page.
  - On a phone it fills the width with the 16 px gutter, as Settings does.
- [ ] **Step 3: Each step uses the Settings controls.**
  - **Language:** the native-language choice looks like Settings › Languages' choices (`.choices` inside the shared section style). The download bar and its note sit under it, and the buttons are in `.actions`.
  - **Level:** a segmented control exactly like `StudySettings`' level (`choices segmented-field` + `segmented`, the code shown and the full name as the label), with its note under it.
  - **Theme:** each theme is a row in the `settings-row` style: the theme's icon (as on the Themes page's cards), its name, and its description as the note. Activating a row chooses the theme. These are real buttons with the theme's name as their accessible name.
  - **Goal:** `DailyGoalSetting` (switch and stepper) and `ReminderSettings`, inside the shared section style.
  - **The step actions:**
    - Start studying is `button primary`, Skip is `link-button`, and they are right-aligned on wide screens as Settings' actions are.
    - On a phone they stack, with the primary button first.
- [ ] **Step 4: The change-mode language page** (Task 7's `/settings/native-language`) renders inside the Settings page layout:
  - `settings-page`, with the `settings-back` link to Languages in place of the step's own Back link;
  - a `panel settings-section` around `LanguageStep`.

  If Task 7 already did this, check it.
- [ ] **Step 5: Tests.**
  - The behaviour tests stay green.
  - Add assertions that hold the look in place:
    - the Level step renders radios inside a `.segmented` group;
    - the Theme step's choices are buttons inside a `settings-row`-styled list;
    - the setup card has the `panel` class.
  - The e2e accessibility checks in Task 8 cover contrast and names.
- [ ] **Step 6: Run and commit.**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

Commit subject: `style(web): the first-run setup in the Settings look`.

---

### Task 8: e2e — the setup end to end, and every existing spec through it

**Files:**
- Modify:
  - `web/e2e/helpers.ts`: add `finishSetup(page, l1 = 'Български')`.
  - `web/e2e/demo.spec.ts`
  - `web/e2e/accounts.spec.ts`
  - `web/e2e/accounts.setup.ts` (if it opens the app)

**Interfaces:**
- Produces: `finishSetup(page, l1)`, which:
  1. waits for the setup's Language heading;
  2. chooses `l1` and presses Continue;
  3. presses Start studying on the next step;
  4. waits for Today's heading.

- [ ] **Step 1: Update the existing specs.** Every test that opens a fresh demo or a new account first calls `finishSetup(page)`. Before this plan they landed straight on Home. The demo spec's German-browser test now passes Deutsch.
- [ ] **Step 2: Add the tests**
  - **Demo, first visit (English browser).**
    1. The setup shows "Which language do you speak?" with Български preselected.
    2. Choose Deutsch, then Continue.
    3. The Theme step shows.
    4. Start studying lands on Home.
    5. A flashcard's translation is German (`hallo` for the first word).
  - **Reload after setup.** A reload lands on Home, not the setup.
  - **Sign in from the setup.** "I already have an account" opens Sign in. Sign-in itself is covered in the accounts spec.
  - **Accessibility.** Run `expectAccessible(page)` on the Language step and on the Theme step.
  - **Change later.**
    1. Settings › Languages › Change opens the language page.
    2. Choose Deutsch and confirm.
    3. The page returns to Settings.
    4. The next flashcard is German, and earlier progress is kept (as plan 10's test does).
  - **Accounts spec, a new account.** After sign-up, the setup shows, the Language step downloads with progress, and Home follows.
  - **Accounts spec, a returning account** signing in on a fresh browser context lands on Home without the setup.
- [ ] **Step 3: Run them**

Run: `pnpm --filter @wordado/web e2e && pnpm --filter @wordado/web e2e:accounts`
Expected: PASS. The accounts run needs the local server: follow `docs/development.md`.

- [ ] **Step 4: Full check**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @wordado/web e2e`
Expected: PASS.

- [ ] **Step 5: Commit.** Subject: `test(web): the first-run setup end to end, and every spec through it`.

---

## Self-review

- **Spec coverage:**
  - Goal 1 and §8.6's onboarding budget: Start studying on every step after Language, the demo with no download, and Decision 4 flagged for the product owner.
  - §7.2, placement never blocks: Task 6's Level step only points to Settings.
  - §8.6, "sign-up asks for L1": the setup asks right after sign-up (Tasks 4–6), and Task 7 removes the duplicate at the gate.
  - §8.6, changing the L1 keeps progress: Tasks 1, 5 and 7, and the e2e in Task 8.
  - §8.9, the theme question: Task 6, moved from Home.
  - §8.11, reminders: Task 6, accounts only.
  - §11.1: focus, the progress bar, alerts, and the e2e accessibility checks in Task 8.
  - §11.2: strings in three tables, in every task that adds them.
- **Types across tasks:**
  - `PackSwitcher` and `PackSwitchState` (Task 3) are used in Tasks 5 and 7.
  - `ready.setup` and `finishSetup` (Task 4) are used in Task 6.
  - `LanguageStep` (Task 5) is used in Tasks 6 and 7.
  - `packFetcher(fetchFn, onProgress)` (Task 2) is used in Task 3.
  - `completeSignIn(country)` (Task 7) is called by `SignIn` and `resumeGoogle`.
- **Deliberate latitude.** Three choices are left to the implementer, who says which in the report:
  - The exact fake for `PackSwitcher` in screen tests.
  - Whether `NativeLanguageSettings`' "Change" is a link or a button that navigates.
  - How `App` hides the navigation during setup (a class or a condition), keeping the masthead's wordmark, language menu and account menu.
