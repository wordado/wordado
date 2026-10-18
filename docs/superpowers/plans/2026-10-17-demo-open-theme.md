# One Open Theme in the Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The demo's trial pack carries one whole theme (daily life), and the demo lets a visitor choose,
study and practise it as in an account, while every other theme stays closed.

**Architecture:**
- **The trial pack** gains a marker, `trial.open_theme`, plus that theme's entries. Their units are not
  included, and validation makes a narrow exception for exactly those entries.
- **Core** reads the marker into `Corpus.trial.openTheme`. `offeredThemes` returns that one theme in a trial,
  and `trialFinished` waits for it only while it is chosen.
- **The web screens** mostly reuse the course's theme code; the few explicit "not in a trial" checks are
  relaxed for the open theme.

**Tech Stack:** TypeScript, pnpm workspace (`core`, `client-data`, `web`, `pipeline`), Vitest, React,
Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-demo-open-theme-design.md` (issue #290). The parent is
`docs/superpowers/specs/2026-10-12-trial-by-level-design.md`.

## Global Constraints

- **The field name** is `trial.open_theme`, in `pipeline.json` and in the pack (snake_case, like the rest of the
  pack). In the corpus it is `CorpusTrial.openTheme: string | null`.
- **The whole theme ships, with no cap.** Every live (`!retired`), taught (`taught !== false`) entry tagged with
  the theme, equal to the course's entry. Retired entries of the theme are not added.
- **No unit is added for these entries.** `schema_version` is not raised.
- **A pack without `trial.open_theme`** builds, validates and behaves exactly as before. The bytes of a trial
  built without the field are unchanged.
- **The one new text,** in en, de, es and bg, key `trial.openTheme`: *Try a theme too: {name} is open in the
  demo.* The name links to the theme's page.
- **Commits** use `git -c user.email=11029931+danchom@users.noreply.github.com commit` and end with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- **The repository is public.** No corpus text in code, tests or commits. Use the bundled sample
  (`pipeline/samples/a1`) and the made-up packs the tests already build.
- **Run from** `.worktrees/demo-theme`. Package tests run with `pnpm --filter @wordado/<pkg> test`, or with
  `npx vitest run <file>` inside the package.

## Review Focus

1. **A setting left over from the sample.** Settings name another theme (for example `food`) on a trial with an
   open theme. Nothing of that theme is served, and the Themes screen shows it closed. Covered in Task 2.
2. **A setting left over that names the open theme itself.** It counts as chosen, its words come first, and
   nothing is cleared. Covered in Task 2.
3. **A trial pack from before this change** (no marker), and the built-in sample (`corpus.trial === null`).
   Themes, setup, search and the end of the demo behave as today. Covered in Tasks 1, 2 and 4.
4. **The open theme chosen, with all its words started but the unit not done.** The session serves the unit,
   because `composeSession` falls back to the path when the collection is empty. The demo does not end. Covered
   in Task 2.
5. **An unknown `unit_id` on an entry of another theme, or on an untagged entry,** in a pack with the marker. It
   is still refused. Covered in Task 1.

---

### Task 1: Core: the marker in the pack, its validation, the corpus and the offered themes

**Files:**
- Modify: `core/src/pack.ts` (`PackTrial`)
- Modify: `core/src/packValidation.ts` (`parseTrial`, `crossCheck`)
- Modify: `core/src/corpus.ts` (`CorpusTrial`, `loadCorpus` trial mapping, `offeredThemes`, `trialThemes`)
- Test: `core/src/packValidation.test.ts`, `core/src/corpus.test.ts`

**Interfaces:**
- Produces:
  - `PackTrial.open_theme?: string`
  - `CorpusTrial.openTheme: string | null`
  - `offeredThemes(corpus): Theme[]`: in a trial, `[the open theme]` or `[]`.
  - `trialThemes(corpus)`: leaves the open theme out.

- [ ] **Step 1: Write the failing tests**

  In `packValidation.test.ts`, build from the existing trial-pack helper there (or a minimal pack). Add:
  - `'accepts entries of the open theme whose unit is not in the pack'`: a pack with
    `trial.open_theme: 'daily-life'` and an entry tagged `daily-life` whose `unit_id` is absent → `status: 'ok'`.
  - `'still refuses a unit-less entry that is not of the open theme'`: the same pack plus an untagged entry with
    an absent unit → `invalid`, with error path `entries[<i>].unit_id` and message `unknown unit "<id>"`.
  - `'refuses an open theme the pack does not define'`: `open_theme: 'nope'` → an error at `trial.open_theme`,
    message `unknown theme "nope"`.
  - `'refuses a unit-less entry when the pack has no open theme'`: today's rule, kept.

  In `corpus.test.ts`, extend the trial parsing test (it uses `toEqual` on `corpus.trial`, so add
  `openTheme: null` there). Add:
  - `'loads the open theme'`: `corpus.trial.openTheme === 'daily-life'`.
  - `'offers the open theme alone in a trial'`: `offeredThemes(corpus).map(t => t.themeId)` equals
    `['daily-life']`. Without the marker it equals `[]`. For a course it is unchanged.
  - `'leaves the open theme out of the closed themes'`: `trialThemes(corpus)` does not contain `daily-life` when
    it is open, even if `trial.themes` names it.

- [ ] **Step 2: Run the tests and see them fail**

  Run: `pnpm --filter @wordado/core test -- packValidation corpus`
  Expected: the new tests fail, and the rest pass.

- [ ] **Step 3: Implement**

  - `pack.ts`: add `readonly open_theme?: string` to `PackTrial`, with a doc line pointing to #290.
  - `parseTrial`: read an optional non-empty string `open_theme`, and keep it in the returned object only when
    present. Today the function returns early when `themes` is absent; restructure it so `open_theme` is read
    either way.
  - `crossCheck`, the unknown-unit branch: skip the error when
    `pack.trial?.open_theme !== undefined && e.themes.includes(pack.trial.open_theme)`. The level/`entry_ids`
    checks only apply when the unit exists, so they need no change.
  - Next to the `trial.themes` loop, check that `open_theme` is in `themes`.
  - `corpus.ts`: add `openTheme: string | null` to `CorpusTrial`, mapped from `pack.trial.open_theme ?? null`.
  - `offeredThemes`, in a trial: `corpus.themes.filter((t) => t.themeId === corpus.trial.openTheme)`, with no
    size check, since the pipeline checked it. Update its comment.
  - `trialThemes`: filter out `corpus.trial?.openTheme`.

- [ ] **Step 4: Run the core tests and see them pass**

  Run: `pnpm --filter @wordado/core test`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `feat(core): a trial pack may open one theme, whose entries need no unit (#290)`

---

### Task 2: Client data: study, progress and the end of the demo with an open theme

**Files:**
- Modify: `core/src/trial.ts` (`trialFinished`, new `openThemeLeft`)
- Modify: `client-data/src/study.ts` (`sessionPlan`, `progressView`, `PathView`, `pathView`)
- Modify: `client-data/src/testing/sample.ts` (an open-theme trial fixture)
- Test: `core/src/trial.test.ts`, `client-data/src/study.test.ts`

**Interfaces:**
- Consumes: from Task 1, `CorpusTrial.openTheme` and `offeredThemes`.
- Produces:
  - `openThemeLeft(corpus: Corpus, introduced: ReadonlySet<WordId> | ReadonlyMap<WordId, unknown>): boolean`:
    the open theme has a taught, live word not yet started. False when there is no open theme.
  - `trialFinished(corpus: Corpus, currentUnitId: string | null, activeTheme: string | null, introduced: ReadonlySet<WordId> | ReadonlyMap<WordId, unknown>): boolean`:
    true when it is a trial, `currentUnitId === null`, and not (`activeTheme === openTheme` and
    `openThemeLeft`).
  - `PathView.trialOpenTheme: string | null`: the open theme's ID when `trialFinished` holds, the theme is not
    chosen, and `openThemeLeft` holds; otherwise null. Task 5 reads it.
  - Fixtures, in `sample.ts`:
    - `trialPack(unitLevels, probeLevels?, options?: { readonly openTheme?: string; readonly declared?: CefrLevel })`.
      With `openTheme`, the pack keeps only the unit of `declared` (default: the last of `unitLevels`). It
      keeps that unit's entries plus every entry tagged `openTheme`, with their own `unit_id`s. It keeps the
      clips those entries name, and sets `trial.open_theme`. The sample's `daily-life` tag spans its three
      units.
    - `openTrialClient(unitLevels, env?, declaredLevel?, options?: { readonly openTheme?: string })`, passing
      `{ openTheme, declared: declaredLevel }` through.
    - `trialCorpus(unitLevels, probeLevels?, options?)`, the same.

- [ ] **Step 1: Write the failing tests**

  In `core/src/trial.test.ts`:
  - `'a chosen open theme with words left holds the end back'`
  - `'an unchosen open theme does not hold the end back'`
  - `'a chosen open theme with every word started lets the demo end'`
  - `'a course is never finished'` (kept)

  In `client-data/src/study.test.ts`, using `openTrialClient(['A1','A2','B1'], env, 'B1', { openTheme: 'daily-life' })`.
  Replace the test "serves no theme collection, whatever theme the settings name" with:
  - `'serves the open theme first when it is chosen'`: after `updateSettings({ activeTheme: 'daily-life' })`,
    every new word of the plan is tagged `daily-life`, and the first is not of the B1 unit (since
    `themeEntries` sorts by level, the first is an A1 theme word).
  - `'ignores another theme the settings name'`: `activeTheme: 'food'`. The new words are the B1 unit's, as
    today.
  - `'falls back to the unit once the chosen theme is all started'`. This is Review Focus 4: start every
    daily-life word, and the next plan's new words are the unit's.
  - `'counts the open theme in the progress tiers'`: after one theme word is answered,
    `progressView(...).tiers` total equals the unit's live words plus the theme's live taught words not in the
    unit. `levels` and `units` keep to the unit.
  - `'path view points to the unchosen open theme at the end'`: finish the unit (as `finishTrial` does) without
    choosing the theme. Then `pathView.trialFinished === true` and `trialOpenTheme === 'daily-life'`. With the
    theme chosen and words left, `trialFinished === false`.

- [ ] **Step 2: Run them and see them fail**

  Run: `pnpm --filter @wordado/core test -- trial` and `pnpm --filter @wordado/client-data test -- study`
  Expected: the new tests fail.

- [ ] **Step 3: Implement**

  - In `core/src/trial.ts`, write `openThemeLeft` and the new `trialFinished` signature. `openThemeLeft` uses
    `themeEntries(corpus, openTheme).filter(e => e.taught)` and checks each against `introduced` through
    `corpusWordId`.
  - Update every caller of `trialFinished`. `grep -rn "trialFinished(" core client-data web/src` should show only
    `pathView`.
  - `sessionPlan`: `const theme = ctx.corpus.trial === null || ctx.settings.activeTheme === ctx.corpus.trial.openTheme ? ctx.settings.activeTheme : null`.
    Update the comment.
  - `progressView`: in a trial, `words` is the unit's word IDs plus the open theme's entries
    (`themeEntries(...)`, mapped to `corpusWordId`), de-duplicated.
  - `pathView`: pass `ctx.settings.activeTheme` and `ctx.learner.states`, and fill `trialOpenTheme`.

- [ ] **Step 4: Run the tests of core, client-data and web**

  Run: `pnpm --filter @wordado/core test && pnpm --filter @wordado/client-data test && pnpm --filter @wordado/web exec vitest run`
  Expected: all pass. Web tests that construct a `PathView` by hand (for example `Path.test.tsx`
  `{ unlocked, currentUnitId, trialFinished }`) need `trialOpenTheme: null` added. That is the only web change
  in this task.

- [ ] **Step 5: Commit**

  `feat(client-data): study and finish the demo with its open theme (#290)`

---

### Task 3: Pipeline: `trial.open_theme` in the configuration and the trial pack

**Files:**
- Modify: `pipeline/src/config.ts` (type and checks)
- Modify: `pipeline/src/trial.ts` (`buildTrial`, `planTrial`)
- Modify: `pipeline/src/release.ts:106`
- Modify: `pipeline/README.md` (the `trial` settings)
- Test: `pipeline/src/config.test.ts`, `pipeline/src/trial.test.ts`

**Interfaces:**
- Consumes: from Task 1, `PackTrial.open_theme` and the validation exception.
- Produces:
  - `export interface TrialOptions { readonly probesPerLevel: number; readonly openTheme: string | null }`
  - `buildTrial(pack: Pack, options: TrialOptions): TrialOutput`
  - `planTrial(pack: Pack, options: TrialOptions)`
  - Config type: `trial?: { readonly probes_per_level?: number; readonly open_theme?: string }`

- [ ] **Step 1: Write the failing tests**

  In `config.test.ts`:
  - `'trial may name only an open theme'`: `{ trial: { open_theme: 'home' } }` → no problem.
  - `'refuses an empty open theme'`: `open_theme: ''` → `trial.open_theme: must be a theme ID`.
  - Keep the `probes_per_level` checks, which now apply only when the field is present.

  In `trial.test.ts`, change existing calls from `buildTrial(x, 40)` to
  `buildTrial(x, { probesPerLevel: 40, openTheme: null })`. Use the existing `coursePack`, where every
  non-first-unit word is `home`. Add:
  - `'adds every live taught entry of the open theme, equal to the course, and no unit'`. With
    `openTheme: 'home'`:
    - the entry IDs equal the first units' plus every live `home` entry;
    - each added entry `toEqual`s the course's;
    - `pack.units` is the same as without the option;
    - `pack.trial.open_theme === 'home'`;
    - every clip of an added entry is in `pack.audio`;
    - `validatePack` gives `ok`.
  - `'leaves retired entries of the open theme out'`: use `coursePack`'s `retiredUnits` argument.
  - `'is byte for byte the same without an open theme'`: compare against bytes produced by `main`'s
    `buildTrial(course, 40)`. Snapshot the `sha256` of today's output in the test before changing the code, then
    assert it is unchanged.
  - `'fails when the open theme is not defined or too small'`:
    - `planTrial` with `openTheme: 'nope'` gives a problem `trial.open_theme: unknown theme "nope"`;
    - with a theme under `MIN_THEME_SIZE` live taught words, a problem
      `trial.open_theme: the course does not offer "<id>"`.
    - Both produce `trial: null`, through `BuildError`.

- [ ] **Step 2: Run them and see them fail**

  Run: `pnpm --filter @wordado/pipeline test -- trial config`

- [ ] **Step 3: Implement**

  - Config: make `probes_per_level` optional and check it only when present. Check `open_theme` as a non-empty
    string.
  - `buildTrial`: after the first units, when `openTheme` is set:
    - throw `BuildError` (path `trial.open_theme`) if the course does not define the theme, or if fewer than
      `MIN_THEME_SIZE` live taught entries carry it;
    - else add those entries, de-duplicated against the first units' entries;
    - include their clips and their themes, through the existing `clipIds`/`themeIds` sets;
    - set `trial.open_theme`.

    Leave out the key entirely when it is null, which keeps the bytes unchanged.
  - `release.ts`: pass `{ probesPerLevel: config.trial?.probes_per_level ?? TRIAL_PROBES_PER_LEVEL, openTheme: config.trial?.open_theme ?? null }`.
  - README: document `trial.open_theme` beside `probes_per_level` in one short paragraph: what it adds, that
    its units are not added, and the deploy order (the app first).

- [ ] **Step 4: Run all pipeline tests**

  Run: `pnpm --filter @wordado/pipeline test`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `feat(pipeline): trial.open_theme adds one whole theme to the trial pack (#290)`

---

### Task 4: Web: the open theme on Themes, its page, search, and no Theme step in a trial's setup

**Files:**
- Modify: `web/src/screens/Themes.tsx` (`Themes`, `TrialThemes`)
- Modify: `web/src/screens/Search.tsx:72-74` (`onPath`)
- Modify: `web/src/setup/Setup.tsx:19` (`stepsFor`)
- Modify: `web/src/test/fixtures.tsx` (`setupTrial` option `openTheme`)
- Test: `web/src/screens/Themes.test.tsx`, `web/src/screens/Theme.test.tsx`, `web/src/screens/Search.test.tsx`,
  `web/src/setup/Setup.test.tsx` (or wherever `stepsFor` is tested; grep `'theme'` steps)

**Interfaces:**
- Consumes: Task 1's `offeredThemes`/`trialThemes`, and Task 2's fixtures (`openTrialClient` options).
- Produces: `setupTrial({ ..., openTheme?: string })`.

- [ ] **Step 1: Write the failing tests**

  Use `setupTrial({ openTheme: 'daily-life' })`.
  - `Themes.test.tsx`:
    - `'shows the open theme as a course card first, then the closed cards'`:
      - the first card's heading is `Daily life`, and it has a button `Study this next`;
      - the closed cards (from `trial.themes`, minus daily-life) have no button and the tag
        `With an account`;
      - there is no `search` role.
    - `'chooses the open theme'`: click `Study this next`, and `settings.activeTheme === 'daily-life'`.
    - The existing "#244" tests still pass unchanged on a trial without the option.
  - `Theme.test.tsx`: `'opens the open theme's page in a trial'`: `<Theme themeId="daily-life" />` shows its
    words. `<Theme themeId="food" />` in the same trial falls back to the Themes screen.
  - `Search.test.tsx`: `'shows a word of the open theme with its theme, no unit, and Learn this word'`. Pick a
    daily-life entry whose unit is not loaded. Its result links the theme chip to `/themes/daily-life`, names
    no unit, and has a `Learn this word` button.
  - Setup: `'has no Theme step in a trial with an open theme'`. The step list is language → level → goal.

- [ ] **Step 2: Run them and see them fail**

  Run: `cd web && npx vitest run src/screens/Themes.test.tsx src/screens/Theme.test.tsx src/screens/Search.test.tsx src/setup`

- [ ] **Step 3: Implement**

  - `Themes`: in a trial, do not return early. Render the trial head (title, the `trial.themes` lede and link,
    as `TrialThemes` does now). Then render the offered themes (the open one) through the same `section(...)`
    and `ThemeCard` path, without the search form. Then the closed grid (`TrialThemes`' list, which no longer
    renders its own head). Restructure `TrialThemes` into the closed list only. The hooks order must stay
    unconditional: today's early return comes after the hooks, so keep that.
  - `Search.tsx`: `onPath = (entry) => corpus.trial === null || studied.has(entry.unitId) || entry.themes.includes(corpus.trial.openTheme ?? '')`.
    The theme chip links already for offered themes. A unit missing from `places.units` already renders no
    unit; check that and keep it.
  - `Setup.tsx` `stepsFor`: the Theme step only when `corpus.trial === null` and themes are offered.
  - `fixtures.tsx`: pass `openTheme` to `openTrialClient`.

- [ ] **Step 4: Run all web unit tests, typecheck and lint**

  Run: `cd web && npx vitest run`, then from the root `pnpm -r typecheck && pnpm lint`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `feat(web): the demo's open theme can be chosen, opened, practised and searched (#290)`

---

### Task 5: Web: the end of the demo points to an unchosen open theme

**Files:**
- Modify: `web/src/app/TrialInvite.tsx`
- Modify: `web/src/i18n/en.ts`, `de.ts`, `es.ts`, `bg.ts` (key `trial.openTheme`)
- Test: `web/src/screens/Home.test.tsx`, `web/src/study/RunView.test.tsx`

**Interfaces:**
- Consumes: Task 2's `PathView.trialOpenTheme`.

- [ ] **Step 1: Write the failing tests**

  In `Home.test.tsx`, "at the end of a trial", with `setupTrial({ openTheme: 'daily-life' })` and `finishTrial`:
  - `'points to the open theme when it was not chosen'`: the text
    `Try a theme too: Daily life is open in the demo.` is shown. Its link `Daily life` has href
    `/themes/daily-life`. It comes before the `With an account` list.
  - `'does not point to it when the demo has no open theme'`: the existing fixture, no such text.

  In `RunView.test.tsx`: the done screen of the session that finishes the unit shows the same line.

- [ ] **Step 2: Run them and see them fail**

  Run: `cd web && npx vitest run src/screens/Home.test.tsx src/study/RunView.test.tsx`

- [ ] **Step 3: Implement**

  - Strings: `trial.openTheme` takes `{name}`. Write it the way the app's other strings with a link are built:
    look at how `trial.invite` puts the link after the text. If a link inside the sentence is needed, split
    the sentence the same way the codebase already does elsewhere (grep for a string rendered with an inline
    `Link`).
    - en: `Try a theme too: {name} is open in the demo.`
    - de: `Probier auch ein Thema aus: {name} ist in der Demo offen.`
    - es: `Prueba también un tema: {name} está abierto en la demo.`
    - bg: `Опитайте и тема: {name} е отворена в демото.`
  - `TrialInvite`: read `path.trialOpenTheme` from `useClientSnapshot()`. When it is set, render the line, with
    the theme's localized name linking to `{ name: 'theme', themeId }`, between `trial.finished` and
    `<AccountGives />`.

- [ ] **Step 4: Run all web unit tests**

  Run: `cd web && npx vitest run`
  Expected: all pass.

- [ ] **Step 5: Commit**

  `feat(web): the demo's end points to its open theme when it was not chosen (#290)`

---

### Task 6: Browser tests, the old-app check, and the specs

**Files:**
- Modify: `web/e2e/helpers.ts` (`serveTrialSample` option)
- Modify: `web/e2e/demo.spec.ts`
- Modify: `docs/superpowers/specs/2026-10-17-demo-open-theme-design.md` (status, the old-app finding)
- Modify: `docs/superpowers/specs/2026-10-12-trial-by-level-design.md` (§3.1, §4.4 themes bullet, §4.5)

- [ ] **Step 1: Extend `serveTrialSample(context, options?: { readonly openTheme?: string; readonly declared?: 'A1' | 'A2' | 'B1' })`**

  With `openTheme`, apply the transformation of `trialPack` (Task 2): keep the declared level's unit (default
  B1), its entries, the theme's entries, and their clips; set `trial.open_theme`; recompute the checksum as
  today.

- [ ] **Step 2: Write the browser test**

  In `demo.spec.ts`, describe "the trial at the visitor's level", add `'the open theme can be chosen and studied
  in the demo (#290)'`:
  - with `serveTrialSample(context, { openTheme: 'daily-life' })` and setup at B1, there is no Theme step;
  - on `/themes`, the `Daily life` card has `Study this next`, and the other cards have no button;
  - `expectAccessible(page, { dark: true })`;
  - click `Study this next`, go to `/study?mode=flashcard`; the first card's word is a daily-life entry (use
    the returned entries, extended to say which carry the theme).

- [ ] **Step 3: Run the browser suite**

  Run: `cd web && npx playwright test`
  Expected: all pass.

- [ ] **Step 4: The old-app check**

  Read `client-data/src/packs.ts` and its caller (`installPacks`), and say what an app from before this change
  does when the new trial pack is refused (`invalid: entries[i].unit_id: unknown unit`). Does it keep the
  installed pack and the demo, and report the failure? Or does it lose the demo? Write the answer, with
  `file:line`, into the design's §4 "Schema version" paragraph. If it loses the demo, stop and report it: the
  rollout of §8 then needs a decision from the owner.

- [ ] **Step 5: Update the specs**

  - **The design:** `**Status:** approved 2026-10-17, built by plan 2026-10-17-demo-open-theme`.
  - **The parent spec:**
    - §3.1: one bullet for `trial.open_theme` and its entries.
    - §4.4: the themes bullet says one theme may be open (link the new design).
    - §4.5: one sentence: the chosen theme travels with the settings.

- [ ] **Step 6: Commit**

  `test(web): the demo's open theme in the browser; specs follow (#290)`

---

## After the tasks

- **Whole-branch review,** then a pull request with `Closes #290`. The pull request lists what was checked,
  and says that `accounts.spec.ts` runs only in CI.
- **Not part of this plan; it needs the owner's go-ahead.** Moving the content repository's pinned pipeline
  commit and setting `"trial": { "open_theme": "daily-life" }` in its `pipeline.json`. This happens only after
  the app with this change is deployed.
