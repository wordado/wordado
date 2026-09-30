# Choosing and Changing the L1, and German in the App Implementation Plan (plan 10)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner studies English from Bulgarian or from German, chooses that language when signing in (or in the demo), can change it at any time with all progress kept, and sees the app itself in Bulgarian, German or English.

**Architecture:** The learner's L1 is a field of the synced settings document (`l1`, null until chosen), so every device of a learner follows it. A small watcher in the web app is the only thing that switches packs: whenever `settings.l1` differs from the L1 the client has installed, it installs the other language's pack beside the current one and swaps it in atomically, never deleting the old pack before the new one is staged. Sign-in, the Settings screen and a change pulled from another device all just write `settings.l1`. Reports now carry the L1, the server keeps it, and triage reopens only that language's translations. The bundled demo sample holds both languages in one manifest, sharing the English audio.

**Tech Stack:** TypeScript 7 (strict, `exactOptionalPropertyTypes`), pnpm workspaces (`@wordado/core`, `@wordado/client-data`, `@wordado/server`, `@wordado/web`, `@wordado/pipeline`), React 19, Vitest (happy-dom + Testing Library), Playwright, Postgres migrations, oxlint.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`
- §6.2: `user` holds "L1, UI language, declared level".
- §8.6: "A learner may change their L1 at any time: the client fetches the other pack, and because review state is keyed by entry, not by translation, all progress carries over"; "a small A1 sample for each L1 ships inside the app bundle"; "Sign-up itself asks only for L1, credentials, and the age check".
- §8.10: reports.
- §8.11: reminders.
- §11.2: "The app's own interface is localised into each supported L1 and English … the learner's UI language defaults to their L1 and can be changed independently of it".

Plan 9, `docs/superpowers/plans/2026-09-30-second-l1-pipeline.md`, built the German pack. This plan takes plan 9's three **handover notes** (its last section).

## Decisions

1. **The L1 lives in the settings document**, as `l1: 'bg' | 'de' | null`. `null` means not chosen yet.
   - A signed-in account with no `l1` studies Bulgarian: every account made before this plan is Bulgarian.
   - The demo with no `l1` follows the interface language: German for a German interface, otherwise Bulgarian.
   - `SUPPORTED_L1S = ['bg', 'de']` in core is the one list of learner languages.
2. **One path switches packs:** the web watcher `watchL1`, reacting to `settings.l1` against the installed L1.
   - The Settings screen, sign-in and a sync from another device only write `settings.l1`.
   - The watcher calls `Client.changeL1(l1, manifest, fetchPack)`. That installs the new language's pack as `staged` beside the active one, then activates it and removes the other language's pack in one transaction.
   - If the new pack cannot be fetched (offline), nothing changes, and the watcher tries again when the app is next online or opened.
   - Progress needs no migration: review state, unlocks and flags are keyed by entry and unit, and units are the same in every language.
3. **Sign-in asks for the native language** on the age-gate step (spec §8.6), preselected with the language the device studies now.
   - After sign-in, the choice is written only to an account whose settings have no `l1` yet (a new account, or one from before this plan). Returning learners keep theirs.
   - The choice survives the Google redirect beside the country, in `PendingSignIn`.
4. **The interface defaults to the browser's language:** the first of `navigator.languages` that the app supports (Bulgarian, German, English), otherwise English (the product owner, 2026-09-30). A saved choice always wins.
   - When the learner changes their native language in Settings while the interface is in the old one, the interface follows to the new one (spec §11.2: the interface defaults to the L1).
5. **German interface copy uses "du"**, the usual register of learning apps; typographic quotes „…“; placeholders kept exactly. A native German check of the copy is a follow-up, like the corpus review.
6. **Pack text follows the interface language only when it is the pack's language.** Unit titles and theme names show their L1 text when the interface language is the pack's L1, and their English otherwise (a German interface on a Bulgarian pack shows English, not Bulgarian).
7. **Reports carry the L1** the learner studied when reporting, as an optional `l1` field of `content_report`, stored by the server in a new nullable column.
   - Triage reopens only that language's translation queue; a report without an L1 still reopens every language's (plan 9, Decision 7).
   - Fix notices match by it (plan 9's `ReportRecord.l1`).
8. **Server texts in German:** reminders gain German. The sign-in email, sent before the learner's choice is known, gains a German line beside the English and Bulgarian ones.
9. **The bundled sample holds both languages.** `pipeline/samples/a1-bg/` becomes `pipeline/samples/a1/`, with `corpus-v0-bg.pack`, `corpus-v0-de.pack`, one `manifest.json` listing both, and the shared `audio/`.
   - The German sample's text is `source-de.json`, committed with this plan: 60 words curated by hand from the German draft, with unit titles and theme names.
   - `corpus build` builds every `source*.json` in the folder.
   - `corpus init` still seeds `last-published/` with the Bulgarian v0 alone.
10. **Plan 9's handover.**
    - Every L1's pack shows the lead L1's English unit title, as reviewed or published.
    - Old web builds that ignore a fix's `l1` are a timing note for German's first reviewed release (Task 9).
    - Reports carry the L1 (Decision 7).
11. **Out of scope:**
    - The privacy page's Bulgaria-specific wording (the supervisory authority, the age of consent). It is a legal-review item (roadmap, *Blockers*).
    - Adding Spanish, French or Russian. After this plan, each is a pipeline run plus entries in `SUPPORTED_L1S`, `LOCALES` and the translation tables.

## Global Constraints

- Commits use the author email `11029931+danchom@users.noreply.github.com`, never a personal address. The subject goes on its own first line, and trailers go in the body after a blank line: `git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -F <message file>`.
- No new dependencies. The pnpm minimum-release-age gate stays as it is.
- `pnpm typecheck` and `pnpm lint` (`oxlint --deny-warnings`) pass at the repository root after every task.
- Every interface string exists in `web/src/i18n/en.ts`, `bg.ts` and `de.ts` with the same placeholders (`web/src/i18n/i18n.test.tsx` checks it).
- Word IDs of corpus words are `c:<entry_id>`; review state is keyed by word ID and never by translation.
- Server schema changes are forward-only migrations in `server/migrations/`, numbered after `0002_sign_in_code_sends.sql`.
- Business strategy (prices, the business model, payment providers, market or competitor reasoning) never goes into this public repository, including plans, READMEs, commit messages and pull request descriptions.
- Anything that touches `wordado/wordado-content`, moves `PIPELINE_REF`, runs a workflow or publishes needs the product owner's go-ahead at the time.

## Review Focus

1. **Changing the language offline, or a pack that fails to download:** the learner keeps studying the old language, nothing is deleted, and the switch happens later by itself. Tests: Task 4 (`changeL1` fails cleanly and keeps the old pack), Task 7 (`watchL1` retries).
2. **Progress after a change of language:** every review state, unlocked unit and known or suspended flag is kept, and the next session continues where the learner was. Test: Task 4.
3. **A returning learner signing in on a new device** must keep their language even when the sign-in form preselected another. The form's choice applies only to an account without one. Test: Task 7 (controller).
4. **A German interface on a Bulgarian pack, or the other way round:** no Bulgarian text leaks into a German interface. Unit titles and theme names fall back to English, and the matching column says which language it is. Test: Task 6 (`localized`, the Matching label).
5. **Existing data:** accounts from before this plan (no `l1`), reports without an L1, reminders subscribed with `bg` or `en`. All keep working unchanged. Tests: Tasks 1, 2, 3.

---

### Task 1: Core: the learner's L1 in settings, and on reports

**Files:**
- Modify: `core/src/settings.ts`, `core/src/documentRules.ts` (the `contentReport` case, lines ~82-93)
- Test: `core/src/settings.test.ts`, `core/src/documentRules.test.ts`

**Interfaces:**
- Produces:
  - `SUPPORTED_L1S = ['bg', 'de'] as const`, `type L1 = (typeof SUPPORTED_L1S)[number]`, `isSupportedL1(v: unknown): v is L1` (in `core/src/settings.ts`).
  - `Settings.l1: L1 | null`, with the default `null`.
  - `content_report` accepts an optional `l1` field (a supported L1).

- [ ] **Step 1: Write the failing tests**

In `core/src/settings.test.ts`:

```ts
it('holds the learner’s L1: a supported language, or null until chosen', () => {
  expect(DEFAULT_SETTINGS.l1).toBeNull()
  expect(validateSettingsPatch({ l1: 'de' })).toEqual({ ok: true, fields: { l1: 'de' } })
  expect(validateSettingsPatch({ l1: null })).toEqual({ ok: true, fields: { l1: null } })
  expect(validateSettingsPatch({ l1: 'fr' })).toEqual({ ok: false, errors: ['l1'] })
  expect(settingsFromFields({ l1: 'xx' }).l1).toBeNull()
  expect(isSupportedL1('bg')).toBe(true)
  expect(isSupportedL1('en')).toBe(false)
})
```

In `core/src/documentRules.test.ts`, next to the existing content-report tests (reuse the file's helper that builds a valid report write):

```ts
it('accepts a report’s L1 when it is a supported language, and still accepts a report without one', () => {
  // `report(fields)` stands for the file's own valid content_report write helper; use it with these fields.
  expect(checkDocumentWrite(report({ l1: 'de' })).ok).toBe(true)
  expect(checkDocumentWrite(report({})).ok).toBe(true)
  expect(checkDocumentWrite(report({ l1: 'xx' })).ok).toBe(false)
})
```

If the file names its check function or its helper differently, use its names. The three cases are what matters.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd core && npx vitest run src/settings.test.ts src/documentRules.test.ts`
Expected: FAIL. `l1` is an unknown setting and an unknown report field.

- [ ] **Step 3: Implement**

In `core/src/settings.ts`:

```ts
/** The learners' native languages (spec §3): one pack per L1. A new L1 adds its code here. */
export const SUPPORTED_L1S = ['bg', 'de'] as const
export type L1 = (typeof SUPPORTED_L1S)[number]
export const isSupportedL1 = (v: unknown): v is L1 => typeof v === 'string' && (SUPPORTED_L1S as readonly string[]).includes(v)
```

- Add `readonly l1: L1 | null` to `Settings`, documented: "The learner's L1 (spec §6.2, §8.6); null until chosen. An account without one studies Bulgarian, the only L1 before plan 10."
- Add `l1: null` to `DEFAULT_SETTINGS`.
- In `validateSettingsPatch`, add a branch before the final `false`: `key === 'l1' ? value === null || isSupportedL1(value) : …`.

In `core/src/documentRules.ts`, the `contentReport` case: read `l1` from `fields`, add `...(l1 === undefined || isSupportedL1(l1) ? [] : ['l1 must be a supported L1'])`, and add `'l1'` to the allowed list of `unknownFields`. Import `isSupportedL1` from `./settings`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd core && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. Other packages that build `Settings` literals by hand may now fail to typecheck (a missing `l1`). Fix each with `l1: null`, and list them in the report.

- [ ] **Step 5: Commit**

Subject: `feat(core): the learner's L1 in settings and on reports`.

---

### Task 2: Server: reports keep the L1; German reminders and sign-in email

**Files:**
- Create: `server/migrations/0003_second_l1.sql`
- Modify: `server/src/sync/documents.ts` (`saveReport`, lines ~45-54), `server/src/reminders/text.ts`, `server/src/reminders/routes.ts` (lines 33 and 90), `server/src/mail.ts`
- Test: the server's existing tests for these files (`server/src/sync/*.test.ts`, `server/src/reminders/*.test.ts`, `server/src/mail.test.ts`; find them with `ls server/src/**/*.test.ts`)

**Interfaces:**
- Consumes: Task 1's `content_report.l1`.
- Produces:
  - The column `content_report.l1 text null`.
  - `push_subscription.language` accepting `'de'`.
  - `REMINDER_LANGUAGES = ['bg', 'de', 'en']`.

- [ ] **Step 1: Write the failing tests** (in the style of each file's neighbours)
  - **sync:** a `content_report` write with `l1: 'de'` stores `'de'` in `content_report.l1`; one without `l1` stores `null`.
  - **reminders text:** `reminderText('de', { kind: 'due', count: 3 }).body === 'Du hast heute 3 Wörter zu wiederholen.'`; `count: 1` gives `'Du hast heute 1 Wort zu wiederholen.'`; `count: 0` gives `'Ein paar Minuten mit neuen Wörtern heute?'`; streak `days: 1` gives `'Deine Serie von 1 Tag braucht die heutige Übung.'` and `days: 5` gives `'Deine Serie von 5 Tagen braucht die heutige Übung.'`.
  - **reminder routes:** a subscription with `language: 'de'` is accepted and stored; `GET /v1/reminder?lang=de` answers German; `lang=xx` answers English.
  - **mail:** the Resend body contains `Dein Wordado-Anmeldecode ist ${code}. Er ist 5 Minuten gültig.` beside the English and Bulgarian lines.

- [ ] **Step 2: Run them and see them fail**

Run the server tests the way the package does (`cd server && npx vitest run <files>`; the database tests need Postgres, as in `server/README.md`).
Expected: FAIL.

- [ ] **Step 3: Implement**

`server/migrations/0003_second_l1.sql`:

```sql
-- 0003_second_l1: a second learner language (plan 10). Reports keep the L1 the
-- learner studied, so triage reopens only that language's translations; older
-- reports have none. Reminders may be sent in German.
alter table content_report add column l1 text;
alter table push_subscription drop constraint push_subscription_language_check;
alter table push_subscription add constraint push_subscription_language_check check (language in ('bg', 'de', 'en'));
```

If Postgres named the original check differently, the migration fails on `drop constraint`. Look the name up with `select conname from pg_constraint where conrelid = 'push_subscription'::regclass` and use it.

- In `saveReport`, add `l1` to the insert and to `on conflict … do update set` (`l1 = excluded.l1`), with the value `typeof fields['l1'] === 'string' ? fields['l1'] : null`.
- In `server/src/reminders/text.ts`, make `REMINDER_LANGUAGES = ['bg', 'de', 'en'] as const` and add:

```ts
function german(reminder: Reminder): string {
  if (reminder.kind === 'streak') {
    return reminder.days === 1 ? 'Deine Serie von 1 Tag braucht die heutige Übung.' : `Deine Serie von ${reminder.days} Tagen braucht die heutige Übung.`
  }
  if (reminder.count === 0) return 'Ein paar Minuten mit neuen Wörtern heute?'
  return reminder.count === 1 ? 'Du hast heute 1 Wort zu wiederholen.' : `Du hast heute ${reminder.count} Wörter zu wiederholen.`
}
```

  `reminderText` picks `german` for `'de'`, `bulgarian` for `'bg'`, and `english` otherwise.
- In `routes.ts`, the validation message becomes `language must be one of ${REMINDER_LANGUAGES.join(', ')}`. The `lang` query is `REMINDER_LANGUAGES.find((l) => l === c.req.query('lang')) ?? 'en'`.
- In `mail.ts`, append `\n\nDein Wordado-Anmeldecode ist ${code}. Er ist 5 Minuten gültig.` to the text, and change the doc comment to "in each interface language".

- [ ] **Step 4: Run and see them pass**

Run: `cd server && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(server): reports keep the learner's L1; German reminders and sign-in email`.

---

### Task 3: Pipeline: triage by the report's L1, the shared English unit title, and the two-language sample

**Files:**
- Modify:
  - `pipeline/src/reports.ts` (`REPORTS_SQL`, `ReportRow`, `pullReports`, `routes`, `triage`)
  - `pipeline/src/assemble.ts` (unit titles, lines ~118-135)
  - `pipeline/src/fs.ts` (`readSourceDir`, `writeArtifacts`)
  - `pipeline/src/cli.ts` (`build`)
  - `pipeline/src/init.ts`
- Move: `pipeline/samples/a1-bg/` to `pipeline/samples/a1/` (`git mv`). Update every reference: `web/vite.config.ts:10`, `client-data/src/client.test.ts:17`, `client-data/src/packs.test.ts:12`, `client-data/src/study.test.ts:13`, `pipeline/src/init.ts:9`, `pipeline/src/sample.test.ts:18`, `pipeline/src/publishable.test.ts:7`, `pipeline/src/registry.test.ts:8`, `client-data/src/testing/sample.ts`, `pipeline/samples/README.md`. Run `grep -rn "samples/a1-bg" --exclude-dir=node_modules .` afterwards: nothing may remain.
- Modify: `web/vite/samplePack.ts` (`sampleFiles`: leave out every `source*.json`, not only `source.json`)
- Test: `pipeline/src/reports.test.ts`, `pipeline/src/assemble.test.ts` (or `draft.test.ts`, where the plan-9 tests have `publishedV1`), `pipeline/src/sample.test.ts`, `web/vite/samplePack.test.ts`

**Interfaces:**
- Consumes:
  - Task 2's `content_report.l1` column.
  - `pipeline/samples/a1-bg/source-de.json`, committed with this plan: the German sample.
- Produces:
  - `ReportRow.l1: string | null`.
  - `corpus build <dir>` builds every `source*.json` and writes one `manifest.json` listing every pack.
  - The sample folder `pipeline/samples/a1/` with both packs.

- [ ] **Step 1: Write the failing tests**
  - **`reports.test.ts`** (follow its `r(…)` helper, adding `l1`):
    - With `l1s: ['bg', 'de']`, German translation reports (`l1: 'de'`) reaching the threshold reopen `translation-de` and not `translation-bg`.
    - Reports with `l1: null` still reopen both.
    - `pullReports` reads an `l1` column (`'de'`, or `null` when the row has none).
  - **Unit titles** (a plan-9-style test with `publishedV1`, `nameThemesInGerman` and `editConfig` in `pipeline/src/draft.test.ts`):
    - After adding `de`, a `title-bg` fix that changes `title_en` (a `fix` decision on unit `a1-01` in `QUEUES.title('bg')` with a new `en`) is followed by a redraft and `planRelease`.
    - The German pack's unit `a1-01` has the same `title.en` as the Bulgarian pack's.
  - **`sample.test.ts`:**
    - `pipeline/samples/a1/manifest.json` lists `corpus-bg` and `corpus-de`, both at version 0.
    - Both packs validate.
    - Their entries have the same IDs, units and audio; the German `hello-1` translates as `hallo`.
    - Rebuilding the folder (`buildSourceDir` or the `build` CLI on a copy) reproduces both packs byte for byte.
  - **`samplePack.test.ts`:** `sampleFiles` leaves out `source.json` and `source-de.json`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd pipeline && npx vitest run src/reports.test.ts src/draft.test.ts src/sample.test.ts; cd ../web && npx vitest run vite/samplePack.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`reports.ts`:**
    - `REPORTS_SQL` also selects `l1`.
    - `ReportRow` gains `readonly l1: string | null`, and `pullReports` reads `row['l1']` as a string or `null`.
    - `routes(field, l1s, reportL1)`: for a translation report, `const own = reportL1 !== null && l1s.includes(reportL1) ? [reportL1] : l1s`, and a route for each of `own`.
    - Update the comment: "a report names the L1 it was made in; one from before plan 10 names none and reopens every L1's translation".
  - **`assemble.ts`:** after the title is decided for this L1, when `l1 !== config.l1s[0]` and the unit has a lead-L1 title, set `title = { en: leadTitle.en, l1: title.l1 }`.
    - `leadTitle` is the lead's folded draft title (`foldField(draftUnits.get(id)?.titles[lead], decisions.for(QUEUES.title(lead), id)).value`) when the unit is live, else the lead's published title (the previous lead pack's unit title, from `input.previous`).
    - If `assemble` does not receive the lead's previous pack, pass the lead's published units in through `AssembleInput` (`previousLeadUnits`, from `last.packs.get(lead)` in `planRelease`). Say which you did in the report.
  - **`fs.ts`:**
    - `readSourceDir(dir)` returns `{ sources: unknown[]; clips }`, with every `source*.json` in name order.
    - `writeArtifacts(dir, outs: BuildOutput[])` writes each pack, then one `manifest.json` whose `packs` are every output's descriptors, sorted by L1, at the shared `schema_version` and `corpus_version`.
    - `cli.ts` `build` builds each source and prints one line per pack.
  - **Move** the sample folder with `git mv pipeline/samples/a1-bg pipeline/samples/a1`, update every reference listed under *Files*, and run `pnpm --filter @wordado/pipeline corpus build "$PWD/pipeline/samples/a1"`. That writes `corpus-v0-de.pack` and the two-pack `manifest.json`. The Bulgarian pack's bytes must not change: check with `git diff --stat` that `corpus-v0-bg.pack` is unchanged.
  - **`init.ts`:** the new content directory's `last-published/manifest.json` lists only the Bulgarian pack (filter the sample's manifest to `l1 === 'bg'`), and only `corpus-v0-bg.pack` is copied.
  - **`samplePack.ts`:** `sampleFiles` filters out every file matching `/^source.*\.json$/`.

- [ ] **Step 4: Run and see them pass**

Run: `cd pipeline && npx vitest run && cd ../client-data && npx vitest run && cd ../web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(pipeline): triage by the report's L1, one English unit title, and a two-language sample`.

---

### Task 4: Client-data: the learner's L1, changing it, and reports that carry it

**Files:**
- Modify: `client-data/src/client.ts`, `client-data/src/packs.ts` (`installPacks`, `activateStagedPacks`), `client-data/src/documentTypes.ts` (`addContentReport`, `readReports`)
- Test: `client-data/src/client.test.ts`, `client-data/src/packs.test.ts`

**Interfaces:**
- Consumes: Task 1 (`Settings.l1`, `L1`, `isSupportedL1`); Task 3's two-language sample (`pipeline/samples/a1/manifest.json`).
- Produces:
  - `ClientOptions.l1` is now the **default** L1, used when `settings.l1` is null. `Client.l1` (read-only) is the installed L1: `settings.l1 ?? options.l1`.
  - `ClientSnapshot.l1: string`.
  - `Client.changeL1(l1: L1, manifest: PackManifest, fetchPack: PackFetcher): Promise<ChangeL1Outcome>`, with `type ChangeL1Outcome = { readonly ok: true } | { readonly ok: false; readonly reason: 'unsupported' | 'unavailable' }`.
  - `installPacks(db, env, manifest, l1, fetchPack)` checks a new pack against the active packs **of the same L1** only.
  - `activateStagedPacks(db)` removes the active packs of other L1s once a staged pack takes over.
  - `ReportRecord`s from `Client.reports()` carry `l1`.
  - `Client.report` stores `l1: this.l1`.

- [ ] **Step 1: Write the failing tests** (in `client.test.ts`, with the file's `openClient()` pattern over the two-language sample manifest)
  - **Change:**
    - Open with `l1: 'bg'`, install and start a session, answer three words, flag one known, and note the review states and unlocks.
    - `await client.updateSettings({ l1: 'de' })`, then `await client.changeL1('de', manifest, fetchPack)` returns `{ ok: true }`.
    - The snapshot's `l1` is `'de'`, and `corpus.l1` is `'de'`.
    - The three review states, the unlocks and the flag are unchanged.
    - The first entry's translations are German.
    - The database has no `corpus-bg` pack row.
  - **Offline:** `changeL1('de', manifest, () => Promise.reject(new Error('offline')))` returns `{ ok: false, reason: 'unavailable' }`. The corpus is still Bulgarian, and the `corpus-bg` pack row is still active.
  - **Default:** a client opened with `l1: 'de'` and no stored setting installs the German pack. Once `settings.l1` is `'bg'`, reopening installs Bulgarian whatever `l1` it is given.
  - **Reports:** `client.report(…)` on the German client stores `l1: 'de'`, and `client.reports()` returns it.
  - **`packs.test.ts`:**
    - With a Bulgarian pack active, `installPacks(…, 'de', …)` stages `corpus-de` without the "does not merge" rejection.
    - `activateStagedPacks` then leaves only `corpus-de` active.

- [ ] **Step 2: Run them and see them fail**

Run: `cd client-data && npx vitest run src/client.test.ts src/packs.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`packs.ts`:**
    - In `installPacks`, `others = (await activePacks(db.driver)).filter((p) => p.l1 === l1)`.
    - In `activateStagedPacks`, inside the transaction and after the swap loop, if anything was staged, read the L1s of the now-active staged packs and `DELETE FROM pack WHERE status = 'active'` for every row whose JSON `l1` is not one of them. Read `json` and parse it: the table has no `l1` column.
  - **`client.ts`:**
    - Store `defaultL1` from the options. After `readSettings`, set `this.l1 = this.settings.l1 ?? defaultL1` (make `l1` a private mutable field with a public getter), and add `l1` to the snapshot.
    - `installPacks(manifest, fetchPack)` uses `this.l1`.
    - `changeL1`:

```ts
  /**
   * Switches the installed L1 (spec §8.6): stages the new language's pack beside the current one, then swaps it in
   * and removes the other language's pack in one transaction. Review state is keyed by entry, so all progress
   * carries over. Nothing changes when the pack cannot be had (offline): the caller tries again later.
   */
  changeL1(l1: L1, manifest: PackManifest, fetchPack: PackFetcher): Promise<ChangeL1Outcome> {
    return this.guarded(async () => {
      if (!isSupportedL1(l1)) return { ok: false, reason: 'unsupported' }
      if (l1 === this.l1) return { ok: true }
      const report = await installPacks(this.db, this.env, manifest, l1, fetchPack)
      const installed = await installedPacks(this.db)
      const has = report.staged.length > 0 || installed.some((p) => p.pack_id === `corpus-${l1}`)
      if (!has) return { ok: false, reason: 'unavailable' }
      await activateStagedPacks(this.db)
      this.l1 = l1
      // Reload what `open` loads from the active packs (corpus, pack version, session plan), as `startSession` does.
      await this.reloadCorpus()
      this.refresh()
      return { ok: true }
    })
  }
```

    `reloadCorpus` is the part of `startSession` that loads the active corpus and pack version. Extract it into a private method that both use, rather than copying it. If a staged `corpus-<l1>` already exists from an earlier attempt, `activateStagedPacks` picks it up.
  - **`documentTypes.ts`:** `ContentReportInput` gains an optional `l1`. `Client.report` passes `l1: this.l1`. `readReports` reads `l1` (only a supported L1) into the `ReportRecord`.

- [ ] **Step 4: Run and see them pass**

Run: `cd client-data && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(client-data): change the learner's L1 with every bit of progress kept, and reports that carry it`.

---

### Task 5: Web: the German interface and the browser-language default

**Files:**
- Create: `web/src/i18n/de.ts`
- Modify:
  - `web/src/i18n/i18n.tsx` (`LOCALES`, `ENDONYM`, `DEFAULT_LOCALE`, `readLocale`, `MESSAGES`)
  - `web/src/reminders/prefs.ts`, `web/src/reminders/notification.ts` (`FALLBACK`), `web/src/reminders/reminders.ts` (`language()` type), `web/src/account/api.ts` (`PushSubscriptionBody.language`)
  - `web/src/main.tsx` (the reminders `language`)
- Test: `web/src/i18n/i18n.test.tsx`, `web/src/reminders/*.test.ts`

**Interfaces:**
- Produces:
  - `LOCALES = ['bg', 'de', 'en']`.
  - `ENDONYM.de = 'Deutsch'`.
  - `initialLocale(storage, languages)`: a saved choice, else the first supported browser language, else `'en'`.
  - German messages in `de.ts`.
  - The interface-language type used by reminders is `Locale`.

- [ ] **Step 1: Write the failing tests**

In `i18n.test.tsx`:
- The `de` table has the same keys, shapes and placeholders as `en` (extend the existing comparison loop to every locale).
- `initialLocale(null, ['de-AT', 'en'])` gives `'de'`; `initialLocale(null, ['fr-FR', 'bg'])` gives `'bg'`; `initialLocale(null, ['fr'])` gives `'en'`; a saved `'bg'` wins over `['de']`.
- The German plural picks `one` for 1 and `other` for 2.
- Update the tests that expect the Bulgarian default. With no saved value and no browser languages, the default is now English.

In the reminders tests: `readInterfaceLanguage` gives back `'de'` after `writeInterfaceLanguage('de')`, and the German fallback text is `Zeit für deine Wörter.`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/i18n src/reminders`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`de.ts`:** `export const de: Messages = { … }`, a German translation of every key in `en.ts`, grouped and ordered as in `en.ts`. Rules:
    - informal "du" throughout;
    - typographic quotes „…“;
    - placeholders (`{name}`) exactly as in English;
    - plurals as `{ one, other }`;
    - the app's name "Wordado" unchanged;
    - language names as endonyms where `en.ts` uses endonyms.
    - The Matching column label becomes language-neutral in Task 6: translate it for now, and Task 6 replaces it.
    - Where English has a term of art (CEFR levels "A1", "B1"), keep it.
  - **`i18n.tsx`:**
    - `LOCALES = ['bg', 'de', 'en']`, `ENDONYM.de = 'Deutsch'`, `MESSAGES = { bg, de, en }`.
    - Replace `DEFAULT_LOCALE` with:

```ts
/** The interface language to start with (plan 10, Decision 4): a saved choice, else the browser's first supported language, else English. */
export function initialLocale(storage: LocaleStorage | null, languages: readonly string[] = globalThis.navigator?.languages ?? []): Locale {
  try {
    const saved = storage?.getItem(LOCALE_KEY)
    const found = LOCALES.find((l) => l === saved)
    if (found) return found
  } catch {
    // Storage refused: fall through to the browser's languages.
  }
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0]
    const match = LOCALES.find((l) => l === base)
    if (match) return match
  }
  return 'en'
}
```

    `I18nProvider` uses `initialLocale(storage)`.
  - **Reminders:**
    - `writeInterfaceLanguage(lang: Locale)`.
    - `readInterfaceLanguage` returns the saved `Locale` (`'bg'`, `'de'` or `'en'`), falling back to `'en'`.
    - `FALLBACK.de = { title: 'Wordado', body: 'Zeit für deine Wörter.' }`.
    - `reminders.ts` `language(): Locale`, and `api.ts` `PushSubscriptionBody.language: Locale` (import the type from `../i18n/i18n`).
    - `main.tsx` reminders `language: () => { const l = document.documentElement.lang; return l === 'de' || l === 'en' ? l : 'bg' }`, since `<html lang>` is set from the locale.

- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(web): the German interface, and the browser's language by default`.

---

### Task 6: Web: pack text follows the pack's language

**Files:**
- Modify: `web/src/i18n/i18n.tsx` (`localized`), every caller of `localized` (`grep -rn "localized(" web/src`), `web/src/screens/Matching.tsx` (the `matching.translation` heading), `web/src/i18n/{en,bg,de}.ts` (`matching.translation`)
- Test: `web/src/i18n/i18n.test.tsx`, `web/src/screens/Matching.test.tsx`

**Interfaces:**
- Consumes: `Corpus.l1`.
- Produces:
  - `localized(text: LocalizedText, locale: Locale, packL1: string): string`: `text.l1` when `locale === packL1`, else `text.en`.
  - `languageName(code: string, locale: Locale): string`, from `Intl.DisplayNames`, with its first letter capitalised.

- [ ] **Step 1: Write the failing tests**
  - `localized({ en: 'Food', l1: 'Храна' }, 'de', 'bg') === 'Food'`
  - `localized({ en: 'Food', l1: 'Храна' }, 'bg', 'bg') === 'Храна'`
  - `localized({ en: 'Food', l1: 'Essen' }, 'de', 'de') === 'Essen'`
  - `languageName('de', 'bg') === 'Немски'`, `languageName('bg', 'en') === 'Bulgarian'`
  - The Matching screen's translation column is headed with the pack's language: "Bulgarian" in English on the Bulgarian sample. Use the file's existing render, and query the heading.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/i18n src/screens/Matching.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - `localized` takes `packL1`, and every caller passes `corpus.l1` (from `useClientSnapshot().corpus`).
  - `languageName` uses `new Intl.DisplayNames([locale], { type: 'language' }).of(code)`, with its first letter upper-cased for the current locale.
  - `matching.translation` becomes `'{language}'` in all three tables. Matching passes `language: languageName(corpus.l1, locale)`. If a message that is only a placeholder is odd in the table, drop the key and call `languageName` directly, and say so in the report.

- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(web): unit and theme names in the pack's language only when the interface speaks it`.

---

### Task 7: Web: choosing and changing the L1

**Files:**
- Create: `web/src/app/l1Watch.ts`, `web/src/app/l1Watch.test.ts`, `web/src/settings/NativeLanguageSettings.tsx`, `web/src/settings/NativeLanguageSettings.test.tsx`
- Modify:
  - `web/src/app/boot.ts` and `web/src/main.tsx` (the default L1)
  - `web/src/account/storage.ts` (`PendingSignIn.l1`)
  - `web/src/screens/SignIn.tsx` (the gate step)
  - `web/src/account/controller.ts` (`completeSignIn`)
  - `web/src/screens/Settings.tsx`
  - `web/src/i18n/{en,bg,de}.ts`
- Test: `web/src/account/controller.test.ts`, `web/src/screens/SignIn.test.tsx`, `web/src/app/boot.test.ts`

**Interfaces:**
- Consumes: Task 4 (`Client.l1`, `snapshot.l1`, `changeL1`, `settings.l1`), Task 5 (`initialLocale`, `Locale`), `fetchManifest`, `manifestUrlFor` and `packFetcher` from `web/src/content/packs.ts`.
- Produces:
  - `defaultL1(account: AccountRecord | null, locale: Locale): L1`: `'bg'` for an account, else `locale === 'de' ? 'de' : 'bg'`.
  - `watchL1(client, install: (l1: L1) => Promise<ChangeL1Outcome>, online: () => boolean, onOnline: (retry: () => void) => () => void): () => void`.
  - `PendingSignIn { country; l1: L1 | null }`.
  - `completeSignIn(country, l1)`.

- [ ] **Step 1: Write the failing tests**
  - **`l1Watch.test.ts`**, with a fake client store (`{ settings: { l1 }, l1 }`) and a fake `install`:
    - No call while `settings.l1` is null, or equals the installed `l1`.
    - One call when `settings.l1` becomes `'de'`.
    - After `{ ok: false, reason: 'unavailable' }`, it calls again when the fake `onOnline` fires.
    - It never runs two installs at once.
  - **`controller.test.ts`** (the file's fake API and boot):
    - After `completeSignIn(null, 'de')`, a learner whose settings have no `l1` gets `settings.l1 === 'de'`.
    - A learner whose settings already say `'bg'` keeps `'bg'` (Review Focus 3).
  - **`SignIn.test.tsx`:**
    - The gate step shows a native-language choice (Български, Deutsch), preselected with the device's current L1.
    - Choosing Deutsch and continuing saves `l1: 'de'` in the pending sign-in.
  - **`NativeLanguageSettings.test.tsx`:**
    - The section shows the current native language.
    - Choosing the other asks for confirmation ("Your progress stays"), then writes `settings.l1`.
    - When the interface was in the old language, the interface switches to the new one.
  - **`boot.test.ts`:** a demo boot with a German interface opens the client with `l1: 'de'`; a signed-in boot opens it with `'bg'`.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/app/l1Watch.test.ts src/account/controller.test.ts src/screens/SignIn.test.tsx src/settings/NativeLanguageSettings.test.tsx src/app/boot.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**
  - **`l1Watch.ts`:**

```ts
import type { ChangeL1Outcome, Store } from '@wordado/client-data'
import type { L1 } from '@wordado/core'

interface Watched {
  readonly store: Store<{ readonly l1: string; readonly settings: { readonly l1: L1 | null } }>
}

/**
 * The one place that switches packs (plan 10, Decision 2): when the learner's L1 setting differs from the installed
 * L1 (chosen in Settings, at sign-in, or on another device and synced here), install the other language. A failed
 * install (offline) is tried again when the device comes back online, or at the next launch.
 */
export function watchL1(client: Watched, install: (l1: L1) => Promise<ChangeL1Outcome>, online: () => boolean, onOnline: (retry: () => void) => () => void): () => void {
  let running = false
  const check = () => {
    const { l1, settings } = client.store.get()
    if (running || settings.l1 === null || settings.l1 === l1 || !online()) return
    running = true
    void install(settings.l1)
      .catch(() => ({ ok: false as const, reason: 'unavailable' as const }))
      .finally(() => {
        running = false
      })
  }
  check()
  const unsubscribe = client.store.subscribe(check)
  const stopOnline = onOnline(check)
  return () => {
    unsubscribe()
    stopOnline()
  }
}
```

  - **`main.tsx`:**
    - `Boot`'s `l1` becomes a function of the account: `l1: (account) => defaultL1(account, initialLocale(browserStorage('localStorage')))`. Change `BootDeps.l1` to `(account: AccountRecord | null) => string`, and have `boot.ts` call it where it opens a client.
    - In the `boot.store.subscribe` block, start `watchL1` when the boot is ready, with:
      - `install: async (l1) => state.client.changeL1(l1, await fetchManifest(manifestUrlFor(state.account)), packFetcher())`;
      - `online: () => navigator.onLine`;
      - `onOnline: (retry) => { window.addEventListener('online', retry); return () => window.removeEventListener('online', retry) }`.
    - Stop it when the boot leaves ready, like `stopContentWatch`.
  - **Sign-in:**
    - `PendingSignIn` gains `l1: L1 | null`. `isPending` accepts a missing `l1` as null, for a pending sign-in saved before this plan.
    - The gate step shows a `<fieldset>` of radio buttons, one per `SUPPORTED_L1S`, labelled with `languageName(l1, l1)` (endonyms: Български, Deutsch), under the heading `signin.nativeLanguage`. It is preselected with `useClientSnapshot().l1`.
    - The choice is saved with the country in `pending.save({ country, l1 })` and passed to `accounts.completeSignIn(country, l1)`.
  - **`completeSignIn(country, l1)`**, at every path that ends with a ready learner client: once `boot.switchTo` or the carry-over is done, take the ready client, `await client.sync().catch(() => undefined)`, then `if (l1 !== null && client.snapshot.settings.l1 === null) await client.updateSettings({ l1 })`. The watcher switches the pack. The Google path passes `pending.l1`.
  - **`NativeLanguageSettings.tsx`:** a section like `LanguageSettings`.
    - It has a radio per supported L1 (endonyms).
    - Choosing another opens `ConfirmDialog` (`web/src/app/Confirm.tsx`) with `settings.nativeLanguageConfirm` ("Your progress stays. The words switch to {language} translations.").
    - On confirm: `await client.updateSettings({ l1 })`, and `if (locale === current) setLocale(l1)`, where `l1` is a `Locale` too.
    - Render it in `Settings.tsx` before `LanguageSettings`.
  - **Strings, in all three tables:**
    - `signin.nativeLanguage` ("Your native language"),
    - `settings.nativeLanguage` ("Native language"),
    - `settings.nativeLanguageHint` ("The language the words are translated into."),
    - `settings.nativeLanguageConfirm` (above, with `{language}`),
    - `settings.nativeLanguageChange` ("Change").

- [ ] **Step 4: Run and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

Subject: `feat(web): choose the native language at sign-in, change it in Settings, and follow it everywhere`.

---

### Task 8: End to end: the German demo and a change of language

**Files:**
- Modify: `web/e2e/demo.spec.ts`

- [ ] **Step 1: Write the tests** (in the file's style; its first lines force English, so override the storage per test)
  - **A German browser:** a new page context with `locale: 'de-DE'` and no saved locale opens the demo in German. The home heading is in German (from `de.ts`), and a study card's translation is German: studying the first new word, the answer options or the reveal include `hallo`.
  - **A change of native language in Settings:** in the English demo:
    1. Open Settings, choose Deutsch under Native language, and confirm.
    2. The first card now shows German translations.
    3. Progress stays: a word studied before the change is still counted on Progress.

- [ ] **Step 2: Run them**

Run: `pnpm --filter @wordado/web e2e`
Expected: PASS, including the existing tests.

- [ ] **Step 3: Full check and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test && pnpm --filter @wordado/web e2e`
Expected: PASS.

Subject: `test(web): the German demo and a change of native language, end to end`.

---

### Task 9: Publish German (after the pull request is merged and deployed; the product owner's go-ahead for each step)

- [ ] **Step 1: The migration.** The production deploy applies `0003_second_l1.sql` (check `docs/deploy.md` for how migrations run in production). Confirm it is applied before the web build that sends `l1` on reports reaches learners.
- [ ] **Step 2: Release v2** (Actions › Corpus › `release`, typing `release`). It publishes the Bulgarian pack unchanged and the German pack beside it.
- [ ] **Step 3: Check.** `https://content.wordado.com/manifest.json` lists `corpus-bg` and `corpus-de` at v2. On wordado.com, the demo in a German browser studies German. A signed-in learner who switches Settings › Native language to Deutsch gets German translations with their progress intact.
- [ ] **Step 4: German's first reviewed release** (later): plan 9's second handover note. Web builds from before plan 9 ignore a fix's `l1`. By then every learner runs a build from after plan 9 (the service worker updates within a day of a visit), so no action is needed beyond releasing after this plan's web build has been live for a few days.

---

## Self-review

- **Spec coverage.**
  - §6.2 (user holds the L1) is the synced settings document: Task 1.
  - §8.6: changing L1 at any time with progress carried over is Tasks 4 and 7; a sample per L1 in the bundle is Task 3; sign-up asks for L1 is Task 7.
  - §11.2: the interface is localised into each L1 and English, and defaults to the L1, in Tasks 5–7.
  - §8.10: reports carry the L1, and triage and fixes follow it, in Tasks 1–4.
  - §8.11: German reminders are Tasks 2 and 5.
  - Plan 9's handover: the English title is Task 3, reports' L1 is Tasks 1–4, and old builds are Task 9.
- **Types across tasks.**
  - `L1`, `SUPPORTED_L1S`, `isSupportedL1` and `Settings.l1` are defined in Task 1 and used in Tasks 4 and 7.
  - `ChangeL1Outcome` and `changeL1` are defined in Task 4 and used in Task 7.
  - `Locale` and `initialLocale` are defined in Task 5 and used in Tasks 6 and 7.
  - `localized(text, locale, packL1)` and `languageName` are defined in Task 6 and used in Task 7.
  - `ReportRow.l1` is defined in Task 3. `ReportRecord.l1` is plan 9's, filled by Task 4.
- **Deliberate latitude.** Three spots name the goal and leave one mechanical choice to the implementer, who says which in the report:
  - the name of a test helper in an existing file;
  - how `assemble` gets the lead's published titles;
  - whether a placeholder-only message stays in the tables.
