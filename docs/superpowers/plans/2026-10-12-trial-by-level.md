# The trial at the visitor's level — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Without an account, the app asks for a level or runs the placement test, then studies one unit of that
level from a small trial pack that every release publishes.

**Architecture:** A trial pack is an ordinary pack (the first unit of every level, entries as the course ships
them) with one optional field, `trial`, that holds the test's words (`probes`) and the course's sizes
(`course`). `core` reads the field into `Corpus.trial` and narrows two rules on it: the test draws from the
probes, and the path studies only the units of the declared level. The pipeline derives the trial pack from
each built pack at release. The web app picks the trial manifest for a visitor when the build names one.

**Tech Stack:** TypeScript, pnpm workspaces (`core`, `client-data`, `pipeline`, `web`), Vitest, React,
Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-trial-by-level-design.md` (issue #230)

## Global Constraints

- The course's packs do not change: `PACK_SCHEMA_VERSION` stays 1, and a pack without `trial` behaves exactly as
  today. Every existing test passes unchanged unless a task names it.
- A trial pack's `pack_id` is the course's (`corpus-<l1>`); its file is `trial-v<n>-<l1>.trial`; its manifest is
  `trial-manifest.json`. Clip URLs stay `audio/<clip>.m4a`, relative to the manifest.
- Probes per level: 40 (`trial.probes_per_level` in `pipeline.json`, default 40), drawn uniformly from the
  level's live entries with `seededRng`, seeded by corpus version and level.
- Test rules unchanged: `PLACEMENT_PROBE_SIZE = 8`, `PLACEMENT_PASS_MIN = 6`, `MIN_PLACEMENT_LEVELS = 2`.
- The repository is public: no corpus text in fixtures beyond the committed `pipeline/samples/a1` sample; test
  fixtures are built in code from it or from made-up words.
- New interface texts go in all four files `web/src/i18n/{en,bg,de,es}.ts`, with the same keys.
- Commit as `11029931+danchom@users.noreply.github.com`
  (`git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit`), each message
  ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Never bare `git stash`. To prove a test red, write the test first; or revert the edit by hand.
- Match the surrounding code: its comment density, naming and idiom. Comments say why, and cite the spec as
  `spec 2026-10-12 §n`.
- Before each commit: the touched package's tests, `pnpm -r typecheck`, `pnpm lint`.

## Review Focus

1. **A course pack that carries no `trial`** must load, study and test exactly as before (every rule branches on
   `corpus.trial === null`).
2. **A visitor who changes level mid-trial**: words started in the earlier unit still come up for review; new
   words come only from the new level's unit.
3. **A level with fewer live entries than 40, or with none**: the draw gives what there is; the release names a
   level that has a unit and no probes as a problem and writes nothing.
4. **A probe that is also a unit entry** (the draw includes the first unit): the test must use the full entry,
   and nothing must count the word twice.
5. **A device holding the old sample** when the trial manifest appears: the trial pack replaces the sample;
   answers on words the trial lacks are skipped by runs, not shown as due forever on the home screen.

---

### Task 1: `core` — the `trial` field of a pack, and `Corpus.trial`

**Files:**
- Modify: `core/src/pack.ts`, `core/src/packValidation.ts`, `core/src/corpus.ts`, `core/src/index.ts`
- Test: `core/src/packValidation.test.ts`, `core/src/corpus.test.ts`

**Interfaces — Produces:**

```ts
// pack.ts
/** A placement-test word of a trial pack: only what a question needs (spec 2026-10-12 §3.1). */
export interface PackProbe {
  readonly entry_id: string
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense: string
  readonly level: CefrLevel
  readonly translation: string
}
/** The whole course's size at one level, for the trial's invitation. */
export interface PackCourseSize { readonly units: number; readonly words: number }
export interface PackTrial {
  readonly probes: readonly PackProbe[]
  readonly course: Readonly<Partial<Record<CefrLevel, PackCourseSize>>>
}
export interface Pack { /* … */ readonly trial?: PackTrial }

// corpus.ts
export interface CorpusTrial {
  /** The test's words as entries: no unit (`unitId: ''`), no examples, clips or themes. */
  readonly probes: readonly CorpusEntry[]
  readonly course: Readonly<Partial<Record<CefrLevel, PackCourseSize>>>
}
export interface Corpus { /* … */ readonly trial: CorpusTrial | null }
```

- [ ] **Step 1: failing tests.** In `packValidation.test.ts` (use the file's existing valid-pack helper):
  - a pack without `trial` validates and the result has no `trial` key;
  - a pack with a valid `trial` validates and returns it;
  - errors, each with its path: `trial` not an object; `trial.probes[0].entry_id` not a valid word-id key;
    `trial.probes[0].level` not a CEFR level; `trial.probes[0].translation` empty; two probes with the same
    `entry_id`; `trial.course.B1.units` not an integer ≥ 1; `trial.course.X1` (unknown level);
  - a probe whose `entry_id` is also an entry of the pack is accepted only when its `headword`, `pos`, `sense`,
    `level` and `translation` equal the entry's (error path `trial.probes[i]`, message
    `differs from the entry of the same id`).

  In `corpus.test.ts`: `loadCorpus` of a pack without `trial` gives `trial: null`; with `trial` gives probes as
  `CorpusEntry` (`unitId: ''`, `translations: [translation]`, `examples: []`, `audio: {}`, `themes: []`,
  `variants: []`, `ipa: ''`, `retired: false`) and `course` as given; `offeredThemes` of a trial corpus is `[]`
  even when a theme has `MIN_THEME_SIZE` entries; two packs that both carry `trial` throw
  `More than one pack carries a trial`.
- [ ] **Step 2:** run `pnpm --filter @wordado/core test -- packValidation corpus`; expect the new tests to fail.
- [ ] **Step 3: implement.** `parseTrial(r, raw, 'trial')` in `packValidation.ts` with the helpers already
  imported (`text`, `oneOf`, `integer`, `records`, `isRecord`, `checkUnique`); call it only when
  `value['trial'] !== undefined`, and add `...(trial ? { trial } : {})` to the pack. The comparison with the
  entry of the same id goes in `crossCheck`. In `loadCorpus`, build `trial` from the one pack that has it. In
  `offeredThemes`, return `[]` first when `corpus.trial !== null`, with the reason as a comment (spec §4.4).
  Export the new types from `index.ts`.
- [ ] **Step 4:** the same test command passes; `pnpm -r typecheck` passes (every literal `Corpus` in tests of
  other packages now needs `trial: null`: fix them, changing nothing else).
- [ ] **Step 5:** commit `core: a pack's trial field and Corpus.trial (#230)`.

### Task 2: `core` — the test draws from the probes; the path keeps to the declared level

**Files:**
- Modify: `core/src/placement.ts`, `core/src/path.ts` (or a new `core/src/trial.ts`), `core/src/index.ts`
- Test: `core/src/placement.test.ts`, `core/src/trial.test.ts`

**Interfaces — Consumes:** `Corpus.trial` (Task 1). **Produces:**

```ts
// placement.ts
/**
 * The corpus a placement test asks from (spec 2026-10-12 §4.3): for a trial, the probes are the pool, and the
 * entries a question may show are the probes and the units' entries together (a unit's own entry wins over the
 * probe of the same id). For a course, the corpus itself.
 */
export function placementCorpus(corpus: Corpus): { readonly corpus: Corpus; readonly pool: Map<CefrLevel, WordId[]> }

// trial.ts
/** The units study and the path screen keep to: every unit of a course; of a trial, the declared level's (§4.4). */
export function studyUnits(corpus: Corpus, declaredLevel: CefrLevel): readonly Unit[]
/** A trial whose unit has no live word left to start, given the path's current unit (null: none). */
export function trialFinished(corpus: Corpus, currentUnitId: string | null): boolean
```

`placementCorpus` for a trial returns `{ corpus: { ...corpus, entries: new Map([...probes by id, ...corpus.entries]) }, pool: placementPool(corpus.trial.probes) }`;
for a course `{ corpus, pool: placementPool(corpus.entries.values()) }`. `trialFinished` is
`corpus.trial !== null && currentUnitId === null`.

- [ ] **Step 1: failing tests.**
  - `placementCorpus`: course → pool equals `placementPool(entries)` and the same corpus object; trial → pool
    holds only probe ids, by level; `corpus.entries` holds probes and unit entries; for an id in both, the entry
    with examples is kept.
  - `studyUnits`: course → all units, same order; trial with units A1…C1 and level B1 → the B1 unit only; trial
    whose declared level has no unit → `[]`.
  - With `studyUnits` fed to `pathNewWords`/`currentUnit`/`computeUnlocks` (build a `PathContext` by hand): at
    B1 the new words are the B1 unit's; once all are introduced, `currentUnit` is null, `pathNewWords` is `[]`,
    and `earnedUnlocks` is `[]` (no successor opens).
  - `trialFinished`: false for a course whatever the unit; true for a trial with null; false with a unit id.
- [ ] **Step 2:** run `pnpm --filter @wordado/core test -- placement trial`; expect failures.
- [ ] **Step 3:** implement as above; export from `index.ts`.
- [ ] **Step 4:** tests, typecheck, lint pass.
- [ ] **Step 5:** commit `core: the trial's test pool and its one unit (#230)`.

### Task 3: `client-data` — study and the test use them

**Files:**
- Modify: `client-data/src/study.ts` (`pathContext`), `client-data/src/placement.ts`, `client-data/src/client.ts`
  (the snapshot's path view), `client-data/src/index.ts`
- Test: `client-data/src/study.test.ts`, `client-data/src/placement.test.ts`, `client-data/src/client.test.ts`

**Interfaces — Consumes:** Task 2. **Produces:** `PathView.trialFinished: boolean` on the client snapshot (false
for a course), beside `currentUnitId`.

- [ ] **Step 1: failing tests.** Build a trial `Corpus` in a test helper from the suite's existing sample
  fixture: keep its units, relabel them one per level as the test needs, and add `trial` with ≥ 8 probes for two
  levels (made-up words are fine).
  - `study.test.ts`: in a trial at B1, `sessionPlan(...).newWords` are all of the B1 unit; a word of the A1 unit
    with a due state is still in `reviews` (reviews do not depend on the level).
  - `placement.test.ts`: `placementAvailable` is true for a trial whose **units** hold one level's worth but
    whose probes cover two levels, and false when the probes cover one; every question of a `PlacementRun` on a
    trial has a `wordId` from the probes; a run on a course is unchanged.
  - `client.test.ts`: `snapshot.path.trialFinished` turns true when the last word of the trial's unit is
    answered in a session, and the answer's `opened` is empty.
- [ ] **Step 2:** run `pnpm --filter @wordado/client-data test`; expect failures.
- [ ] **Step 3: implement.** `pathContext`: `units: studyUnits(ctx.corpus, ctx.settings.declaredLevel)`.
  `PlacementRun`: take `{ corpus, pool }` from `placementCorpus(source.corpus)` once in the constructor, use
  that corpus in `buildItem`; `placementAvailable` uses the same pool. The path view computes
  `trialFinished(corpus, currentUnitId)`.
- [ ] **Step 4:** tests, typecheck, lint pass.
- [ ] **Step 5:** commit `client-data: a trial studies one unit and tests from its probes (#230)`.

### Task 4: `pipeline` — derive the trial pack

**Files:**
- Create: `pipeline/src/trial.ts`, `pipeline/src/trial.test.ts`
- Modify: `pipeline/src/config.ts` (+ `config.test.ts`)

**Interfaces — Produces:**

```ts
export const TRIAL_PROBES_PER_LEVEL = 40
export const TRIAL_MANIFEST = 'trial-manifest.json'
export interface TrialOutput {
  readonly pack: Pack                 // with `trial`
  readonly packFile: string           // `trial-v<version>-<l1>.trial`
  readonly packBytes: Uint8Array      // canonicalJson(pack), UTF-8
  readonly descriptor: PackDescriptor // for the trial manifest
}
/** The trial pack of a built course pack (spec 2026-10-12 §3). Pure: the same pack gives the same bytes. */
export function buildTrial(pack: Pack, probesPerLevel: number): TrialOutput
/** What stands in the way: a level with a unit and no probes, an entry or clip that differs from the course's. */
export function trialProblems(course: Pack, trial: Pack): string[]
// config.ts — PipelineConfig gains:
readonly trial?: { readonly probes_per_level: number }   // an integer ≥ 8; absent: 40
```

Rules for `buildTrial`:
- For each level in `CEFR_LEVELS` order: the unit with the lowest `order` among that level's units that has at
  least one live entry; none → the level is left out. Its entries are copied whole, retired ones included.
- `themes`: the course's definitions of the themes those entries name. `audio`: the clips those entries name.
- `trial.probes`, per level: the level's live entries sorted by `entry_id`, shuffled with
  `seededRng(corpus_version * 100 + levelIndex(level))`, the first `probesPerLevel` taken, then sorted by
  `entry_id`; each as a `PackProbe`.
- `trial.course[level]`: the count of that level's units with a live entry, and of its live entries.
- Units sorted by `order`, entries and themes by id, as `buildPack` does; the result must pass `validatePack`
  (throw `BuildError` with its errors otherwise).

- [ ] **Step 1: failing tests** (`trial.test.ts`; build the course pack in code with a small helper
  `coursePack({ A1: [3 units × 30], A2: [2 × 30], B1: [1 × 5] })` of made-up words `w-<level>-<n>`):
  - the trial holds exactly the first unit of every level, entries deep-equal to the course's;
  - a level whose first unit is all retired gives its second unit;
  - 40 probes for A1 and A2, all 5 for B1; none retired; all of the right level;
  - the probes are not just the first unit: with 90 A1 words in 3 units, at least one probe is from another unit;
  - uniform: over versions 1…300, every A1 live entry is drawn between 90 and 180 times (expected 133);
  - the same pack twice gives equal `packBytes`; version n+1 gives another A1 probe set;
  - `course` counts match the course pack;
  - `validatePack(JSON.parse(text of packBytes))` is `ok` and `loadCorpus([pack]).trial.probes` has the probes;
  - `packFile` is `trial-v7-bg.trial`; `descriptor` has the course's `pack_id`, the `sha256` and `bytes` of
    `packBytes`, `url` equal to `packFile`;
  - `trialProblems`: `[]` for a `buildTrial` result; one line each for a trial entry edited to differ, a level
    with a unit and no probes, a clip whose `sha256` differs.
  - `config.test.ts`: `trial.probes_per_level` accepts 40, refuses 7, 1.5 and a string with
    `trial.probes_per_level: must be an integer of 8 or more`.
- [ ] **Step 2:** run `pnpm --filter @wordado/pipeline test -- trial config`; expect failures.
- [ ] **Step 3:** implement.
- [ ] **Step 4:** tests, typecheck, lint pass.
- [ ] **Step 5:** commit `pipeline: derive a trial pack from a built pack (#230)`.

### Task 5: `pipeline` — a release writes the trial files

**Files:**
- Modify: `pipeline/src/release.ts`, `pipeline/src/cli.ts` (the release summary), `pipeline/README.md`
- Test: `pipeline/src/release.test.ts`, `pipeline/src/e2e.test.ts`

**Interfaces — Consumes:** Task 4. **Produces:** `ReleasePlan.trials: readonly TrialOutput[]` and
`ReleasePlan.trialManifest: PackManifest` (`schema_version` and `corpus_version` as the course manifest's,
`packs` the descriptors sorted by `l1`).

- [ ] **Step 1: failing tests.**
  - `planRelease` on the reviewed fixture gives one trial per L1 and a manifest listing them;
  - `writeRelease` writes `trial-v1-bg.trial` and `trial-manifest.json`, returns them in its list with
    `trial-manifest.json` before `manifest.json` (the course's manifest stays last), and the bytes match the
    manifest's checksums;
  - `adoptRelease` leaves both out of `last-published/`, and `readLastPublished` still reads it;
  - a `trialProblems` line reaches `plan.problems` as `<l1>: trial: <line>` (force one by monkeypatching nothing:
    set `trial.probes_per_level` so a level… if no natural case exists in the fixture, test `trialProblems`
    wiring with a unit test of a small exported helper instead);
  - `e2e.test.ts`: after version 1 and version 2, both releases carry trial files, and version 2's trial units
    are version 2's first units.
- [ ] **Step 2:** run the pipeline suite; expect failures.
- [ ] **Step 3: implement.** In `planRelease`, after each `buildPack` succeeds:
  `const trial = buildTrial(out.pack, config.trial?.probes_per_level ?? TRIAL_PROBES_PER_LEVEL)` inside the same
  `try`, then `problems.push(...trialProblems(out.pack, trial.pack).map((p) => \`${l1}: trial: ${p}\`))`. In
  `writeRelease`, write each `packBytes` and `writeJson(join(outDir, TRIAL_MANIFEST), plan.trialManifest)`.
  The CLI's release summary gains one line: `trial: <n> packs, <bytes> bytes each at most`. The README's
  release section gains a paragraph on the trial files (what they are, the setting, that publishing must upload
  them with the rest).
- [ ] **Step 4:** the whole pipeline suite, typecheck, lint pass.
- [ ] **Step 5:** commit `pipeline: a release carries the trial packs and their manifest (#230)`.

### Task 6: `web` — a visitor installs from the trial manifest

**Files:**
- Modify: `web/src/content/packs.ts`, `web/src/content/env.d.ts`, `web/src/main.tsx` (only if a call needs it),
  `.github/workflows/deploy.yml`, `web/README.md`, `docs/deploy.md`
- Test: `web/src/content/packs.test.ts`

**Interfaces — Produces:**

```ts
/** A visitor's manifest (spec 2026-10-12 §4.1): the trial's when the build names one, otherwise the bundled sample. */
export const TRIAL_MANIFEST_URL: string = import.meta.env.VITE_TRIAL_MANIFEST_URL || SAMPLE_MANIFEST_URL
export function manifestUrlFor(account: AccountRecord | null, learnerManifest = CONTENT_MANIFEST_URL, visitorManifest = TRIAL_MANIFEST_URL): string
```

- [ ] **Step 1: failing tests:** `manifestUrlFor(null, x, y)` is `y`; with an account it is `x`; the defaults
  without the variable give the sample for a visitor (existing behaviour).
- [ ] **Step 2:** run `pnpm --filter @wordado/web test -- packs`; expect failures.
- [ ] **Step 3: implement.** `main.tsx` already fetches every clip ahead only when the manifest is the sample's,
  so a trial's clips come ahead of need like a learner's; confirm by reading, change nothing if so.
  `deploy.yml`: add `VITE_TRIAL_MANIFEST_URL: ${{ vars.TRIAL_MANIFEST_URL }}` to the build step's `env`; it is
  optional, so the "Refuse an environment without its variables" step does not list it. `docs/deploy.md` and
  `web/README.md`: one paragraph each on the variable and on what a visitor gets without it.
- [ ] **Step 4:** tests, typecheck, lint, and `pnpm --filter @wordado/web build` with
  `VITE_TRIAL_MANIFEST_URL=https://content.example.test/trial-manifest.json`, then
  `grep -rl "content.example.test/trial-manifest.json" web/dist/assets | head -1` prints a file.
- [ ] **Step 5:** commit `web: a visitor installs from the trial manifest when the build names one (#230)`.

### Task 7: `web` — the path shows one unit, and the trial says where it ends

**Files:**
- Modify: `web/src/screens/Path.tsx`, `web/src/screens/Home.tsx`, `web/src/study/RunView.tsx` (the done screen),
  `web/src/screens/Search.tsx` (text only, if the wording needs it), `web/src/i18n/{en,bg,de,es}.ts`,
  `web/src/styles.css` (only if the note needs a rule)
- Test: `web/src/screens/Path.test.tsx`, `web/src/screens/Home.test.tsx`, `web/src/study/RunView.test.tsx`,
  `web/src/test/fixtures.tsx` (a trial client beside the demo client)

**Interfaces — Consumes:** `studyUnits`, `Corpus.trial.course`, `snapshot.path.trialFinished`.

New texts (English; the other three languages translated in the same commit):

```ts
'trial.path': 'This is the trial: one unit of {level}.',
'trial.course': { one: 'The whole course has {count} unit at {level}.', other: 'The whole course has {count} units at {level}.' },
'trial.finished': 'You have started every word of the trial.',
'trial.invite': 'Create an account to go on with the whole course.',
```

The link is the existing `banner.demoCreate` ("Create an account") to `{ name: 'signin' }`.

- [ ] **Step 1: failing tests.**
  - `Path`: in a trial at B1, one unit is listed (the B1 unit), no other level's heading shows, and under it the
    note reads `trial.path` and `trial.course` with the count from `trial.course.B1.units`, with a link named
    "Create an account"; when `trial.course` has no entry for the level, only `trial.path` shows; a course
    (`trial: null`) renders exactly as before (existing tests untouched).
  - `Home`: with `path.trialFinished`, the screen shows `trial.finished`, `trial.invite` and the link, above the
    existing "Practise words you know"; reviews due are still offered first when there are any.
  - `RunView` done screen: after a session that ends the unit, the same two lines and the link show, and no
    "New unit open" line; a practice run's done screen does not show them.
- [ ] **Step 2:** run `pnpm --filter @wordado/web test -- Path Home RunView`; expect failures.
- [ ] **Step 3: implement.** In `Path.tsx`, build `levels` from
  `studyUnits(corpus, settings.declaredLevel)` instead of `corpus.units`; the note is a `<p className="note">`
  after the list, only when `corpus.trial !== null`. One small component `TrialInvite` (in
  `web/src/app/TrialInvite.tsx`) renders the finished lines and the link, used by Home and the done screen.
- [ ] **Step 4:** tests, typecheck, lint pass.
- [ ] **Step 5:** commit `web: the trial's one unit on the path, and the invitation at its end (#230)`.

### Task 8: `web` — the level into the account; browser tests

**Files:**
- Modify (only if the reading below finds a gap): `web/src/account/controller.ts`, `client-data/src/client.ts`
- Modify: `web/e2e/helpers.ts` (a trial fixture, `serveTrialSample`), `web/e2e/demo.spec.ts`,
  `web/e2e/accounts.spec.ts`, `web/playwright.config.ts` (only if the trial manifest variable is needed for the
  preview build), `web/src/setup/LevelAsk.tsx` (comment only: the sample is no longer the only reason)
- Test: `web/src/account/controller.test.ts`, the e2e files

- [ ] **Step 1: read.** Follow `carryOver` in `controller.ts` and `attachUser` in `client-data`: are the demo's
  settings (the declared level) written as the account's and pushed? Write the answer in the task report. If
  they are not, the fix is in this task: the settings document travels with the events.
- [ ] **Step 2: failing tests.**
  - `controller.test.ts`: after a carry-over from a demo whose declared level is B1, what is pushed for the
    account includes that level; `askLevel` is still set.
  - `helpers.ts`: `serveTrialSample(context)` routes the sample's manifest and pack URLs to a trial built in the
    helper from the committed sample: its three units relabelled A1, A2, B1 (entries' levels with them), and
    `trial.probes` of 8+ entries per level taken from those entries, `trial.course` with made-up sizes.
  - `demo.spec.ts`:
    1. *the trial at a level*: first screen → language → the level step shows → choose B1 → finish the setup →
       the first new word is one of the B1 unit; the path lists one unit and the trial's note.
    2. *the test in the trial*: from the level step, take the test with "I don't know" throughout → the result
       is A1 and comes back selected.
    3. *the end of the trial*: with a new-word limit that covers the unit, one session ends on the invitation,
       and the home screen shows it.
  - `accounts.spec.ts` (runs in CI only): sign-up from a trial at B1 → the level step shows once with B1
    selected → Continue → the path's current unit is the B1 unit with its started words.
- [ ] **Step 3:** run the unit tests, and the browser tests locally on a spare port:
  create an untracked `web/playwright.tmp4199.config.ts` that imports the base config and overrides `baseURL`
  and the web server command to `vite preview --port 4199 --strictPort` with `reuseExistingServer: false`; run
  `E2E_PROJECTS=chromium pnpm --filter @wordado/web exec playwright test -c playwright.tmp4199.config.ts demo`;
  delete the file afterwards. Never stop a server on port 4173: it belongs to another session.
- [ ] **Step 4:** implement what Step 1 found; make the tests pass.
- [ ] **Step 5:** commit `web: the trial's level reaches the account; browser tests for the trial (#230)`.

### Task 9: the main design

**Files:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`

- [ ] **Step 1:** §5.1: a paragraph on the trial pack and its manifest. §7.2: the test draws from the trial's
  probes where a pack has them; replace "A learner who came through the demo was never asked: its sample has one
  level" with what is true now (asked in the trial; asked once more after sign-up with that level selected).
  §8.6: the demo studies the trial pack, one unit of the declared level, the invitation; *Onboarding budget*:
  no account and no test needed, one small download. §9.3: the trial manifest and `VITE_TRIAL_MANIFEST_URL`.
  §16: a revision-log entry "2026-10-12 — the trial at the visitor's level", placed before "## 17.".
- [ ] **Step 2:** set the spec's status line to "approved 2026-10-12, built by plan 2026-10-12-trial-by-level".
- [ ] **Step 3:** commit `Design: the trial at the visitor's level in the main design (#230)`.

---

## After the tasks (not for a subagent)

- Whole-branch review, then: every touched package's tests, `pnpm -r typecheck`, `pnpm lint`, the browser run.
- Pull request `Closes #230`; a comment on #102 listing the new texts; a comment on #213 that the test can now
  run without an account.
- **Operator steps, each with the owner's go-ahead** (spec §8): the content repository moves to this pipeline
  version and publishes; read first whether its publish step uploads `*.trial` and `trial-manifest.json`. Then
  the owner sets `TRIAL_MANIFEST_URL` for the environment and deploys. Measure the trial pack's size on the
  first release and write it in spec §3.3.
