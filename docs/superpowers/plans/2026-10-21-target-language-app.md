# A second target language: the learner app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A learner's course is a target language and an L1: the app can teach German beside English, switch between the two courses keeping each one's state, show a German entry's grammar, and never say "English" where it means the course's language.

**Architecture:** `settings` keeps today's per-course fields (`l1`, `declaredLevel`, `activeTheme`) as **the current course's** values and gains `course` (the current target). A new `course` document, keyed by target, **parks** another course's three fields while the learner studies elsewhere; switching course parks the current values and restores the other's in one write. Every screen keeps reading `settings` as today. Entry and unit IDs of German start with `de.` (plan 1), so review state, flags, words to learn and unit unlocks need no namespacing. Each target has its own manifest (`manifest.json` for English, `de/manifest.json` beside it); the client installs one course's packs at a time, as it installs one L1's today. Which targets the build offers is a build variable, so German appears when its corpus is published.

**Tech Stack:** TypeScript, React, vitest (unit, happy-dom, browser), Playwright, `@wordado/core`, `@wordado/client-data`, `@wordado/web`, `@wordado/server` (tests only).

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` §1, §3, §5.1, §5.2, §5.5, §8.6 ("The course."), §11.2. Plan 1 (`2026-10-21-target-language-pipeline.md`) must be merged first: this plan uses its `TARGETS`, `coursePackId`, `Corpus.target`, `CorpusEntry.grammar` and `GRAMMAR_SCHEMAS`.

## Global Constraints

- **Courses offered:** English always; German when the build variable `VITE_COURSE_TARGETS` lists it (`en,de`). Default `en`. With one target the setup's course question is skipped and Settings shows no course page.
- **L1s per course** (`COURSE_L1S`): English: `bg`, `de`, `es`. German: `bg`, `es`, `en`. English becomes a supported L1 (`SUPPORTED_L1S = ['bg','de','es','en']`).
- **Per course:** `l1`, `declaredLevel`, `activeTheme` (in `settings` for the current course, in a `course` document for the others). Unit unlocks are one grow-only set; German unit IDs are prefixed, so they never collide. **Per learner:** everything else (streak, XP, goal, reminders, retention, audio, review state, flags).
- **Manifests:** a target's manifest is the English manifest's URL with `<target>/` before its file name (`…/manifest.json` → `…/de/manifest.json`; `…/trial-manifest.json` → `…/de/trial-manifest.json`). The bundled sample: `/content/sample/de/manifest.json`.
- **Pack IDs:** `coursePackId(target, l1)` (plan 1): `corpus-bg`, `corpus-de-bg`.
- **No literal language in the interface:** every string that named English takes `{language}`, the course's language as `Intl.DisplayNames` names it in the interface language mid-sentence (English, German / английски, немски / Englisch, Deutsch / inglés, alemán). Headwords, examples and clips carry `lang={corpus.target}`.
- **Grammar display (German):** a noun shows its article before the headword (`m`→`der`, `f`→`die`, `n`→`das`) and its plural after it (`die Häuser`); a verb with `auxiliary: 'sein'` shows `(+ sein)`. Nothing else is shown. An unknown field shows nothing.
- **Unchanged for English learners:** with `VITE_COURSE_TARGETS` unset, every screen, string (in English, `{language}` renders "English"), document and request is what it is today, except the wording changes listed in Task 5.
- **This repository is public:** no corpus text beyond the hand-written sample, no prices or dates.
- Commits as `11029931+danchom@users.noreply.github.com`, branch `feat/target-language-app` in `.worktrees/target-language-app`. Before the PR: `pnpm --filter @wordado/core test`, `pnpm --filter @wordado/client-data test`, `pnpm --filter @wordado/web test`, `pnpm --filter @wordado/server test` (needs Docker), `pnpm -r typecheck`, `pnpm lint`, `pnpm --filter @wordado/web e2e`. `web/e2e/accounts.spec.ts` runs only in CI: read its setup and native-language tests (`:546`, `:594`, `:234`) against Task 7's changes.

## Review Focus

1. **Two devices, one switches course** — device B, still on English, receives `settings.course = 'de'` with `l1 = 'bg'` by sync: it must install the German pack (the watcher) and not show English words under the German setting. Pinned in Task 4.
2. **Switching to a course never started, then reloading mid-setup** — the reload must come back to the setup for the new course, not open the old course's words. Pinned in Task 4 (`setupNeeded`) and Task 8 (e2e).
3. **Switching back** — English → German → English restores the English L1, level and theme exactly, and the English review state is untouched. Pinned in Task 2 and Task 8.
4. **An English learner whose build offers only English** — no course question, no course page, no `course` document written, and an account's export unchanged. Pinned in Task 7.
5. **A German noun with an empty plural, a verb with `haben`, and an adjective** — shows the article only, nothing, and nothing. Pinned in Task 6.

---

### Task 1: Core — the course in settings, English as an L1, and the `course` document

**Files:**
- Modify: `core/src/settings.ts` (`SUPPORTED_L1S`, `COURSE_L1S`, `Settings.course`)
- Modify: `core/src/documentRules.ts` (`DOCUMENT_TYPES.course`, its checks)
- Create: `core/src/course.ts`, `core/src/course.test.ts`
- Test: `core/src/settings.test.ts`, `core/src/documentRules.test.ts`

**Interfaces:**
- Consumes: `Target`, `isTarget`, `TARGETS` (plan 1).
- Produces:
  - `SUPPORTED_L1S = ['bg','de','es','en'] as const`, `type L1`, `isSupportedL1`
  - `COURSE_L1S: Readonly<Record<Target, readonly L1[]>>`, `isCourseL1(target: string, l1: unknown): l1 is L1`
  - `Settings.course: Target` (default `'en'`)
  - `interface Course { readonly target: Target; readonly l1: L1 }`
  - `interface ParkedCourse { readonly l1: L1 | null; readonly declaredLevel: CefrLevel; readonly activeTheme: string | null }`
  - `DOCUMENT_TYPES.course = 'course'` (key: a target; fields: `l1`, `declaredLevel`, `activeTheme`)
  - `courseSwitchPatch(settings: Settings, parked: ParkedCourse | null, to: Target): { park: ParkedCourse | null; settings: Partial<Settings> }`

- [ ] **Step 1: Write the failing tests**

`core/src/course.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { courseSwitchPatch } from './course'
import { COURSE_L1S, DEFAULT_SETTINGS, isCourseL1 } from './settings'

describe('courses', () => {
  it('offers each course its own L1s, never the target itself', () => {
    expect(COURSE_L1S.en).toEqual(['bg', 'de', 'es'])
    expect(COURSE_L1S.de).toEqual(['bg', 'es', 'en'])
    expect(isCourseL1('de', 'de')).toBe(false)
    expect(isCourseL1('de', 'en')).toBe(true)
    expect(isCourseL1('en', 'en')).toBe(false)
  })
})

describe('courseSwitchPatch', () => {
  const english = { ...DEFAULT_SETTINGS, course: 'en' as const, l1: 'bg' as const, declaredLevel: 'B1' as const, activeTheme: 'food' }
  it('parks the current course and starts a new one empty', () => {
    expect(courseSwitchPatch(english, null, 'de')).toEqual({
      park: { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' },
      settings: { course: 'de', l1: null, declaredLevel: 'A1', activeTheme: null },
    })
  })
  it('restores a parked course', () => {
    const german = { ...english, course: 'de' as const, l1: 'en' as const, declaredLevel: 'A2' as const, activeTheme: null }
    expect(courseSwitchPatch(german, { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' }, 'en')).toEqual({
      park: { l1: 'en', declaredLevel: 'A2', activeTheme: null },
      settings: { course: 'en', l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' },
    })
  })
  it('parks nothing for a course whose language was never chosen', () => {
    expect(courseSwitchPatch({ ...english, l1: null }, null, 'de').park).toBeNull()
  })
  it('does nothing when the course is the current one', () => {
    expect(courseSwitchPatch(english, null, 'en')).toEqual({ park: null, settings: {} })
  })
})
```

`core/src/settings.test.ts`, add:
```ts
it('validates the course and accepts English as an L1', () => {
  expect(validateSettingsPatch({ course: 'de' })).toEqual({ ok: true, fields: { course: 'de' } })
  expect(validateSettingsPatch({ course: 'fr' })).toEqual({ ok: false, errors: ['course'] })
  expect(validateSettingsPatch({ l1: 'en' })).toEqual({ ok: true, fields: { l1: 'en' } })
  expect(DEFAULT_SETTINGS.course).toBe('en')
})
```

`core/src/documentRules.test.ts`, add (use the file's `write(...)` helper shape):
```ts
describe('course documents', () => {
  it('accepts a parked course keyed by a target', () => {
    expect(checkDocumentWrite(write('course', 'en', { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' }))).toEqual({ ok: true })
  })
  it('refuses a key that is not a target, an L1 the course does not offer, and unknown fields', () => {
    expect(checkDocumentWrite(write('course', 'fr', { l1: 'bg' }))).toMatchObject({ ok: false, errors: ['a course key must be a target language'] })
    expect(checkDocumentWrite(write('course', 'de', { l1: 'de' }))).toMatchObject({ ok: false, errors: ['l1 must be a language the course is taught from'] })
    expect(checkDocumentWrite(write('course', 'en', { level: 'B1' }))).toMatchObject({ ok: false, errors: ['unknown field level'] })
  })
  it('accepts a report made in English as the L1', () => {
    expect(checkDocumentWrite(write('content_report', 'r1', { wordId: 'c:de.haus-1', field: 'translation', note: '', packVersion: 1, createdAt: 1, l1: 'en' }))).toEqual({ ok: true })
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/core test`
Expected: FAIL (no `./course`, `course` not a setting, no `course` document type).

- [ ] **Step 3: Implement**

`core/src/settings.ts`:
```ts
/** The learners' native languages (spec §3): a course is taught from one of them. A new L1 adds its code here. */
export const SUPPORTED_L1S = ['bg', 'de', 'es', 'en'] as const
export type L1 = (typeof SUPPORTED_L1S)[number]
export const isSupportedL1 = (v: unknown): v is L1 => typeof v === 'string' && (SUPPORTED_L1S as readonly string[]).includes(v)

/** The L1s each course is taught from (spec §3, §5.5), in the order the setup lists them. */
export const COURSE_L1S: Readonly<Record<Target, readonly L1[]>> = { en: ['bg', 'de', 'es'], de: ['bg', 'es', 'en'] }
export const isCourseL1 = (target: string, l1: unknown): l1 is L1 =>
  isTarget(target) && typeof l1 === 'string' && (COURSE_L1S[target] as readonly string[]).includes(l1)
```
`Settings` gains, after `l1`:
```ts
  /** The course being studied (spec §8.6): its target. `l1`, `declaredLevel` and `activeTheme` are that course's; another course's wait in its `course` document. */
  readonly course: Target
```
`DEFAULT_SETTINGS.course = 'en'`; `validateSettingsPatch` gains `: key === 'course' ? isTarget(value)` in the chain. Update the `l1` field's comment (it no longer says only Bulgarian before plan 10).

`core/src/course.ts`:
```ts
import type { CefrLevel } from './types'
import type { L1, Settings } from './settings'
import type { Target } from './target'

export interface Course { readonly target: Target; readonly l1: L1 }

/** A course the learner is not studying now (spec §8.6): its own three settings, waiting in its `course` document. */
export interface ParkedCourse {
  readonly l1: L1 | null
  readonly declaredLevel: CefrLevel
  readonly activeTheme: string | null
}

/**
 * Switching course: the current course's three settings are parked (unless its language was never chosen), and the
 * other's are restored, or reset for a course never started. One settings patch, so a second device follows at once.
 */
export function courseSwitchPatch(settings: Settings, parked: ParkedCourse | null, to: Target): { park: ParkedCourse | null; settings: Partial<Settings> } {
  if (to === settings.course) return { park: null, settings: {} }
  const park = settings.l1 === null ? null : { l1: settings.l1, declaredLevel: settings.declaredLevel, activeTheme: settings.activeTheme }
  const next = parked ?? { l1: null, declaredLevel: 'A1' as const, activeTheme: null }
  return { park, settings: { course: to, l1: next.l1, declaredLevel: next.declaredLevel, activeTheme: next.activeTheme } }
}
```

`core/src/documentRules.ts`: add `course: 'course'` to `DOCUMENT_TYPES` (comment: "Another course's level, theme and L1 (spec §8.6), keyed by its target.") and:
```ts
    case DOCUMENT_TYPES.course: {
      const { l1, declaredLevel, activeTheme } = fields
      return [
        ...(isTarget(key) ? [] : ['a course key must be a target language']),
        ...(l1 === undefined || l1 === null || isCourseL1(key, l1) ? [] : ['l1 must be a language the course is taught from']),
        ...(declaredLevel === undefined || (CEFR_LEVELS as readonly unknown[]).includes(declaredLevel) ? [] : ['declaredLevel must be a level']),
        ...(activeTheme === undefined || activeTheme === null || (typeof activeTheme === 'string' && activeTheme !== '') ? [] : ['activeTheme must be a theme ID or null']),
        ...unknownFields(fields, ['l1', 'declaredLevel', 'activeTheme']),
      ]
    }
```
Export `./course` from `core/src/index.ts`.

- [ ] **Step 4: Run them, and the typecheck**

Run: `pnpm --filter @wordado/core test && pnpm -r typecheck`
Expected: core PASS. The typecheck fails where code builds a full `Settings` literal or iterates `SUPPORTED_L1S` expecting three: add `course: 'en'` to those literals; leave the iterations for Tasks 4–7 if they still compile.

- [ ] **Step 5: Commit**

```bash
git add core client-data web server
git commit -m "feat(core): the course in settings, English as an L1, and parked course documents (#313)"
```

---

### Task 2: client-data — install and switch by course

**Files:**
- Modify: `client-data/src/packs.ts` (`installPacks`, `checkFetched`, `activateStagedPacks` by course)
- Modify: `client-data/src/client.ts` (`course` getter, `changeCourse`, `switchCourse`)
- Modify: `client-data/src/documentTypes.ts` (`readParkedCourse`, `writeParkedCourse`)
- Test: `client-data/src/packs.test.ts`, `client-data/src/client.test.ts`

**Interfaces:**
- Consumes: Task 1; plan 1's `coursePackId`, `Corpus.target`, `PackDescriptor.target`.
- Produces:
  - `installPacks(db, env, manifest, course: Course, fetchPack)`; `activateStagedPacks(db, course: Course)`
  - `Client.course: Course` (the installed course; before any pack, `{ target: settings.course, l1: settings.l1 ?? defaultL1 }`); `Client.l1` stays (= `course.l1`)
  - `Client.changeCourse(course: Course, manifest, fetchPack): Promise<ChangeL1Outcome>` (replaces `changeL1`; `ChangeL1Outcome` keeps its name)
  - `Client.switchCourse(to: Target): Promise<{ needsSetup: boolean }>`
  - `ClientSnapshot.course: Course`
  - `readParkedCourse(driver, target): Promise<ParkedCourse | null>`, `writeParkedCourse(tx, target, parked: ParkedCourse): Promise<void>`

- [ ] **Step 1: Write the failing tests**

`packs.test.ts` (use the file's pack and manifest builders; give a builder variant for a German pack: `target: 'de'`, `pack_id: 'corpus-de-bg'`, entry IDs `de.…`, descriptor `target: 'de'`):
```ts
it('activates one course at a time: German Bulgarian replaces English Bulgarian', async () => {
  await installPacks(db, env, englishManifest, { target: 'en', l1: 'bg' }, fetch)
  await activateStagedPacks(db, { target: 'en', l1: 'bg' })
  await installPacks(db, env, germanManifest, { target: 'de', l1: 'bg' }, fetch)
  await activateStagedPacks(db, { target: 'de', l1: 'bg' })
  expect((await loadActiveCorpus(db))!.target).toBe('de')
  expect((await installedPacks(db)).map((p) => p.pack_id)).toEqual(['corpus-de-bg'])
})
it('refuses a pack whose target differs from its descriptor', async () => {
  const report = await installPacks(db, env, manifestClaimingTarget('de', englishPackBytes), { target: 'de', l1: 'bg' }, fetch)
  expect(report.rejected[0]!.reason).toBe('the pack describes itself differently from the manifest')
})
```
`client.test.ts`:
```ts
it('switches course and back, keeping each course its own settings and every review', async () => {
  // open a client on the English Bulgarian sample, set declaredLevel B1 and activeTheme 'food', answer one card
  const first = await client.switchCourse('de')
  expect(first).toEqual({ needsSetup: true })
  expect(client.snapshot.settings).toMatchObject({ course: 'de', l1: null, declaredLevel: 'A1', activeTheme: null })
  await client.updateSettings({ l1: 'bg' })
  await client.changeCourse({ target: 'de', l1: 'bg' }, germanManifest, fetch)
  expect(client.course).toEqual({ target: 'de', l1: 'bg' })
  const back = await client.switchCourse('en')
  expect(back).toEqual({ needsSetup: false })
  expect(client.snapshot.settings).toMatchObject({ course: 'en', l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' })
  await client.changeCourse({ target: 'en', l1: 'bg' }, englishManifest, fetch)
  expect(client.snapshot.states.size).toBe(1) // the English review state survived both switches
})
it('writes no course document for a learner who never switches', async () => {
  // open, study, change level: no row of type 'course' in the document table
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/client-data test`
Expected: FAIL (signatures take an L1; no `switchCourse`).

- [ ] **Step 3: Implement**

- `packs.ts`:
  - `checkFetched`: add `|| pack.target !== (descriptor.target ?? 'en')` to the "describes itself differently" condition.
  - `installPacks(db, env, manifest, course, fetchPack)`: `selectPacks({ manifest, l1: course.l1, ... })`, then keep only descriptors with `(d.target ?? 'en') === course.target`; `others` are active packs with `p.l1 === course.l1 && p.target === course.target`.
  - `activateStagedPacks(db, course)`: replace each `(JSON.parse(row.json) as Pack).l1 === l1` with `sameCourse(JSON.parse(row.json) as Pack, course)` where `const sameCourse = (p: Pack, c: Course) => p.l1 === c.l1 && p.target === c.target`. Update the doc comment ("one course at a time").
- `documentTypes.ts`:
```ts
export async function readParkedCourse(driver: SqlDriver, target: Target): Promise<ParkedCourse | null> {
  const doc = await getDocument(driver, DOC.course, target)
  if (!doc || doc.deleted) return null
  const f = doc.fields
  return {
    l1: isCourseL1(target, f['l1']) ? f['l1'] : null,
    declaredLevel: (CEFR_LEVELS as readonly unknown[]).includes(f['declaredLevel']) ? (f['declaredLevel'] as CefrLevel) : 'A1',
    activeTheme: typeof f['activeTheme'] === 'string' && f['activeTheme'] !== '' ? f['activeTheme'] : null,
  }
}
export async function writeParkedCourse(tx: SqlDriver, target: Target, parked: ParkedCourse): Promise<void> {
  await writeLocalPatch(tx, DOC.course, target, { l1: parked.l1, declaredLevel: parked.declaredLevel, activeTheme: parked.activeTheme } as Fields)
}
```
  (match `getDocument`'s real return shape: read how `readSettings` does it.)
- `client.ts`:
  - `get course(): Course` — `this.corpus ? { target: this.corpus.target as Target, l1: this.corpus.l1 as L1 } : { target: this.settings?.course ?? 'en', l1: (this.settings?.l1 ?? this.defaultL1) as L1 }`; `get l1()` returns `this.course.l1`. Add `course` to `ClientSnapshot` beside `l1`.
  - `changeL1` becomes `changeCourse(course, manifest, fetchPack)`: `if (!isCourseL1(course.target, course.l1)) return { ok: false, reason: 'unsupported' }`; the early return compares `this.corpus.target === course.target && this.corpus.l1 === course.l1`; `installPacks(..., course, ...)`; the installed check uses `coursePackId(course.target, course.l1)`; `activateStagedPacks(this.db, course)`.
  - `switchCourse(to)`:
```ts
  switchCourse(to: Target): Promise<{ needsSetup: boolean }> {
    return this.guarded(async () => {
      this.settings = await this.db.transaction(async (tx) => {
        const current = await readSettings(tx)
        const { park, settings } = courseSwitchPatch(current, await readParkedCourse(tx, to), to)
        if (park) await writeParkedCourse(tx, current.course, park)
        return Object.keys(settings).length === 0 ? current : patchSettings(tx, settings)
      })
      this.refresh()
      return { needsSetup: this.settings.l1 === null }
    })
  }
```
  - Update every caller of `changeL1` (web `packSwitch.ts`, tests) to `changeCourse`; Task 4 does the web side, so here only fix the compile in client-data and leave web for Task 4 (or make the web call `changeCourse({ target: 'en', l1 }, …)` to compile until then).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/client-data test`
Expected: PASS, including the existing L1-change tests (now English courses).

- [ ] **Step 5: Commit**

```bash
git add client-data web
git commit -m "feat(client-data): install, activate and switch packs by course (#313)"
```

---

### Task 3: A German sample corpus for the demo and the tests

**Files:**
- Create: `pipeline/samples/a1/de/source-bg.json`, `pipeline/samples/a1/de/source-en.json`, the built `corpus-v0-bg.pack`, `corpus-v0-en.pack`, `manifest.json`, `fixes.json`, `credits.json` under `pipeline/samples/a1/de/`
- Modify: `pipeline/src/sample.test.ts` (a German describe)
- Modify: `web/vite/samplePack.ts` only if it does not already serve and precache subdirectories (read its walker first)

**Interfaces:**
- Produces: `/content/sample/de/manifest.json` listing `corpus-de-bg` and `corpus-de-en` (`target: 'de'`), each with 40 A1 entries in two units of 20, no audio.

- [ ] **Step 1: Write the failing test**

`pipeline/src/sample.test.ts`, add (mirroring the existing German-L1 describe at `:84`):
```ts
describe('the A1 German course sample (#313)', () => {
  for (const l1 of ['bg', 'en']) {
    it(`is committed byte for byte as the build produces it (${l1})`, () => {
      // build pipeline/samples/a1/de/source-<l1>.json exactly as the existing tests build source.json, and compare
      // with the committed de/corpus-v0-<l1>.pack and de/manifest.json
    })
  }
  it('is a German course: prefixed IDs, grammar on every noun and verb, two units of 20', () => {
    const pack = readPack('de/corpus-v0-bg.pack')
    expect(pack.target).toBe('de')
    expect(pack.pack_id).toBe('corpus-de-bg')
    expect(pack.entries).toHaveLength(40)
    expect(pack.entries.every((e) => e.entry_id.startsWith('de.'))).toBe(true)
    expect(pack.units.map((u) => [u.unit_id, u.entry_ids.length])).toEqual([['de.a1-01', 20], ['de.a1-02', 20]])
    expect(pack.entries.filter((e) => e.pos === 'noun' || e.pos === 'verb').every((e) => e.grammar !== undefined)).toBe(true)
  })
  it('gives every entry three distractors and fills a matching board', () => { /* as the Bulgarian sample's test at :74 */ })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/sample.test.ts`
Expected: FAIL (no `de/` sample).

- [ ] **Step 3: Write the sample**

Hand-write `source-bg.json` in the shape of `pipeline/samples/a1/source.json` (no `audio`, no `schema_version`): `target: 'de'`, `pack_id: 'corpus-de-bg'`, `l1: 'bg'`, `corpus_version: 0`, the same 24 themes as the English sample with their `en`/`l1` names, two units (`de.a1-01` "Alltag" / "Ежедневие" in the `{ en, l1 }` title shape, `de.a1-02` "Essen und Trinken"), and 40 everyday A1 entries: 24 nouns with `gender` and `plural` (e.g. `Haus` n `Häuser`, `Frau` f `Frauen`, `Tisch` m `Tische`, `Milch` f `''`), 10 verbs with `separable`/`irregular`/`auxiliary` (e.g. `gehen` irregular `sein`, `aufstehen` separable irregular `sein`, `kaufen` `haben`), 6 others (adjectives, `hallo`, `danke`), each with IPA, one German example sentence, a Bulgarian translation, no two entries sharing a translation. `source-en.json`: the same entries with English translations. IDs follow plan 1's slug rule (`de.haus-1`, `de.maedchen-1`). Build each with the pipeline's `build` exactly as the existing samples are built (read `sample.test.ts` for the call) and write a `manifest.json` with both descriptors (`target: 'de'`), plus empty `fixes.json` and the English sample's `credits.json`.

Ask the owner to read the 40 German words and their grammar before the PR (they read German); write that in the PR description.

- [ ] **Step 4: Run the sample tests, and check the dev server serves it**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/sample.test.ts` → PASS. Then `pnpm --filter @wordado/web dev` and fetch `http://localhost:5173/content/sample/de/manifest.json` → 200. If not, extend `samplePack.ts`'s walker to include `de/` and its precache list.

- [ ] **Step 5: Commit**

```bash
git add pipeline/samples/a1/de pipeline/src/sample.test.ts web/vite
git commit -m "feat(content): a German A1 sample course for the demo and the tests (#313)"
```

---

### Task 4: The web app installs the current course, and follows a course change

**Files:**
- Modify: `web/src/content/packs.ts` (`targetManifestUrl`, `manifestUrlFor(account, target, …)`, `OFFERED_TARGETS`)
- Modify: `web/src/content/env.d.ts` (`VITE_COURSE_TARGETS`)
- Modify: `web/src/app/packSwitch.ts` (installs a `Course`)
- Rename: `web/src/app/l1Watch.ts` → `web/src/app/courseWatch.ts` (`watchCourse`), its test likewise
- Modify: `web/src/app/boot.ts` (manifest of the settings' course; `setupNeeded`), `web/src/main.tsx` (wiring)
- Test: `web/src/content/packs.test.ts`, `web/src/app/packSwitch.test.ts`, `web/src/app/courseWatch.test.ts`, `web/src/app/boot.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `targetManifestUrl(manifestUrl: string, target: string): string`
  - `manifestUrlFor(account, target, learnerManifest?, visitorManifest?)`
  - `OFFERED_TARGETS: readonly Target[]` and `parseTargets(value: string | undefined): readonly Target[]`
  - `PackSwitcher.install(client, account, course: Course)`; `PackSwitchState` carries `course` instead of `l1`; `PackSwitchDeps.fetchManifest(account, target)`
  - `watchCourse(client, install: (course: Course) => Promise<ChangeL1Outcome>, online, onOnline)`
  - `setupNeeded(snapshot: { corpus: Corpus | null; settings: Settings; states: ReadonlyMap<unknown, unknown> }): boolean`

- [ ] **Step 1: Write the failing tests**

`packs.test.ts`:
```ts
it('puts a target before the manifest file name', () => {
  expect(targetManifestUrl('https://cdn.example/manifest.json', 'en')).toBe('https://cdn.example/manifest.json')
  expect(targetManifestUrl('https://cdn.example/manifest.json', 'de')).toBe('https://cdn.example/de/manifest.json')
  expect(targetManifestUrl('/content/sample/manifest.json', 'de')).toBe('/content/sample/de/manifest.json')
  expect(targetManifestUrl('https://cdn.example/trial-manifest.json', 'de')).toBe('https://cdn.example/de/trial-manifest.json')
})
it('offers English always, and the targets the build names', () => {
  expect(parseTargets(undefined)).toEqual(['en'])
  expect(parseTargets('en,de')).toEqual(['en', 'de'])
  expect(parseTargets('de')).toEqual(['en', 'de'])
  expect(parseTargets('de, fr ,en')).toEqual(['en', 'de'])
})
```
`courseWatch.test.ts`: port each `l1Watch.test.ts` test to courses, and add:
```ts
it('installs the other course when the setting names it (Review Focus 1)', () => {
  // store: installed course { en, bg }, settings { course: 'de', l1: 'bg' } → install called with { target: 'de', l1: 'bg' }
})
it('waits while the new course has no language yet', () => {
  // settings { course: 'de', l1: null } → install not called
})
```
`boot.test.ts`:
```ts
describe('setupNeeded', () => {
  const s = (over: Partial<Settings>) => ({ ...DEFAULT_SETTINGS, ...over })
  it('is the first run: no words, no language, nothing studied', () => {
    expect(setupNeeded({ corpus: null, settings: s({}), states: new Map() })).toBe(true)
    expect(setupNeeded({ corpus: null, settings: s({}), states: new Map([['c:apple-1', {}]]) })).toBe(false)
  })
  it('is a new course: the installed words are another course and its language is not chosen (Review Focus 2)', () => {
    expect(setupNeeded({ corpus: englishCorpus, settings: s({ course: 'de', l1: null }), states: new Map([['c:apple-1', {}]]) })).toBe(true)
    expect(setupNeeded({ corpus: englishCorpus, settings: s({ course: 'en', l1: 'bg' }), states: new Map() })).toBe(false)
  })
})
```
and a Boot test that, with settings `course: 'de'`, fetches `targetManifestUrl(manifest, 'de')`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/content src/app`
Expected: FAIL.

- [ ] **Step 3: Implement**

`packs.ts`:
```ts
/** A target's manifest sits beside English's, in a folder named after the target (spec §5.1). */
export function targetManifestUrl(manifestUrl: string, target: string): string {
  if (target === 'en') return manifestUrl
  const slash = manifestUrl.lastIndexOf('/')
  return `${manifestUrl.slice(0, slash + 1)}${target}/${manifestUrl.slice(slash + 1)}`
}

/** The courses this build offers (spec §5.5): English always, then what `VITE_COURSE_TARGETS` adds, in `TARGETS` order. */
export function parseTargets(value: string | undefined): readonly Target[] {
  const named = new Set((value ?? '').split(',').map((s) => s.trim()))
  return TARGETS.filter((t) => t === 'en' || named.has(t))
}
export const OFFERED_TARGETS = parseTargets(import.meta.env.VITE_COURSE_TARGETS)

export function manifestUrlFor(account, target: string, learnerManifest = CONTENT_MANIFEST_URL, visitorManifest = TRIAL_MANIFEST_URL): string {
  return targetManifestUrl(account === null ? visitorManifest : learnerManifest, target)
}
```
`env.d.ts`: `readonly VITE_COURSE_TARGETS?: string`.

`packSwitch.ts`: replace `l1: L1` with `course: Course` in the state, `running` and `install`; the join compares `sameCourse(joining.course, course)`; `run` calls `this.deps.fetchManifest(account, course.target)` and `client.changeCourse(course, manifest, fetchPack)`.

`courseWatch.ts` (from `l1Watch.ts`): the watched store gives `{ course: Course; settings: { course: Target; l1: L1 | null } }`; `const wanted = settings.l1 === null ? null : { target: settings.course, l1: settings.l1 }`; it installs when `wanted !== null && !sameCourse(wanted, course)`; `failed` remembers a `Course`. Keep every comment's reasoning.

`boot.ts`: export `setupNeeded`:
```ts
/** The first-run setup, or a new course's (spec §8.6): its language is not chosen and its words are not installed. */
export function setupNeeded(s: { corpus: Corpus | null; settings: Settings; states: ReadonlyMap<unknown, unknown> }): boolean {
  if (s.settings.l1 !== null) return false
  if (s.corpus === null) return s.states.size === 0
  return s.corpus.target !== s.settings.course
}
```
`needsSetup` keeps its account pull, but its first line becomes `if (client.snapshot.corpus !== null && client.snapshot.corpus.target === client.snapshot.settings.course) return false` and its last returns `setupNeeded(client.snapshot)`. The ordinary open fetches `this.deps.fetchManifest(this.account, client.snapshot.settings.course)`; `deps.fetchManifest` gains the target parameter (wire it in `main.tsx` as `(account, target) => fetchManifest(manifestUrlFor(account, target))`). Wire `watchCourse` where `watchL1` was (`main.tsx:95-121`), and `refreshAudioOnActivation` reacts to a `course` change as it did to `l1`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): install the current course's packs and follow a course change (#313)"
```

---

### Task 5: The interface names the course's language

**Files:**
- Modify: `web/src/i18n/en.ts`, `bg.ts`, `de.ts`, `es.ts` (seven keys)
- Modify: `web/src/i18n/i18n.tsx` (`languageInSentence`)
- Modify: the users of those keys: `settings/LanguageSettings.tsx:13`, `setup/LevelStep.tsx:36,40`, `screens/Placement.tsx:146,152`, `setup/ThemeStep.tsx:47`, `study/RunView.tsx:407`, `screens/Matching.tsx:133,147`
- Modify: every `lang="en"` on a headword, example or clip: `study/Headword.tsx:12`, `WordRow.tsx:24`, `study/RunView.tsx:275,428`, `screens/Placement.tsx:162`, `screens/Matching.tsx:98`, `screens/Themes.tsx:245`, `settings/SetAsideWords.tsx:47` (leave `AboutSettings.tsx:29`: credits are English)
- Test: `web/src/i18n/i18n.test.tsx`, and the components' existing tests

**Interfaces:**
- Produces: `languageInSentence(code: string, locale: Locale): string`; message keys `settings.languageHint`, `setup.level.title`, `placement.intro`, `onboard.title`, `study.chooseWord`, `matching.instructions` take `{language}`; `matching.english` is removed.

- [ ] **Step 1: Write the failing tests**

`i18n.test.tsx`:
```ts
it('names a course language mid-sentence in each interface language', () => {
  expect(['en', 'bg', 'de', 'es'].map((l) => languageInSentence('de', l as Locale))).toEqual(['German', 'немски', 'Deutsch', 'alemán'])
  expect(translate('en', 'study.chooseWord', { language: 'German' })).toBe('Choose the word in German')
  expect(translate('bg', 'setup.level.title', { language: 'английски' })).toBe('Вашето ниво по английски')
})
it('leaves no message naming English', () => {
  for (const locale of LOCALES) for (const [key, value] of Object.entries(MESSAGES_FOR_TEST[locale]))
    if (key !== 'settings.interfaceEnglish' /* keep any key that is about the interface language itself */) expect(JSON.stringify(value)).not.toMatch(/English|английск|Englisch|englisch|inglés/)
})
```
(Export the messages table for the test, or import the four tables directly. Before writing the second test, list the keys that legitimately name English — the interface-language choice, the About credits — with `grep -n "English\|английск\|nglisch\|inglés" web/src/i18n/*.ts` and exclude exactly those, with a comment each.)

Update the component tests that assert today's texts ("Your English level", "Choose the English word", the Matching column "English") to the new ones.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/i18n`
Expected: FAIL.

- [ ] **Step 3: Implement**

`i18n.tsx`:
```ts
/** A language's name as it sits mid-sentence in `locale` ("German", "немски", "Deutsch", "alemán"). */
export function languageInSentence(code: string, locale: Locale): string {
  return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
}
```
The messages (en / bg / de / es):

| key | en | bg | de | es |
|---|---|---|---|---|
| `settings.languageHint` | The words are always in {language}; this changes the menus and messages. | Думите винаги са на {language}; това сменя менютата и съобщенията. | Die Wörter sind immer auf {language}; das ändert nur die Menüs und Meldungen. | Las palabras siempre están en {language}; esto cambia los menús y los mensajes. |
| `setup.level.title` | Your level in {language} | Вашето ниво по {language} | Dein Niveau in {language} | Tu nivel de {language} |
| `placement.intro` | About twenty words. Pick the word in {language}, or say you don’t know: a guess only makes the result less useful. | Около двадесет думи. Изберете думата на {language} или кажете, че не знаете: предположението само прави резултата по-малко полезен. | Etwa zwanzig Wörter. Wähl das Wort auf {language}, oder sag, dass du es nicht kennst: Ein Rateversuch macht das Ergebnis nur weniger nützlich. | Unas veinte palabras. Elige la palabra en {language} o di que no la sabes: adivinar solo hace que el resultado sea menos útil. |
| `onboard.title` | What do you want {language} for? | Защо учите {language}? | Wofür möchtest du {language} lernen? | ¿Para qué quieres aprender {language}? |
| `study.chooseWord` | Choose the word in {language} | Изберете думата на {language} | Wähl das Wort auf {language} | Elige la palabra en {language} |
| `matching.instructions` | Pick a word in {language}, then its translation. | Изберете дума на {language}, после превода ѝ. | Wähl ein Wort auf {language}, dann seine Übersetzung. | Elige una palabra en {language} y luego su traducción. |

Each user passes `{ language: languageInSentence(corpus.target, locale) }` (the corpus from `useClientSnapshot()`; in the setup's level step before a pack exists, `settings.course`). Matching's first column heading becomes `languageName(corpus.target, locale)`, like its translation column. Each `lang="en"` above becomes `lang={corpus.target}` (thread the target down as a prop where the component has no snapshot, as `Translation` takes `lang`).

The Bulgarian, German and Spanish texts join the native check of issue #102: add a comment on #102 listing the six keys.

- [ ] **Step 4: Run the web unit suite**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): the interface names the course's language, and words carry its lang (#313)"
```

---

### Task 6: A German entry shows its grammar

**Files:**
- Create: `core/src/headwordForm.ts`, `core/src/headwordForm.test.ts`
- Modify: `web/src/study/Headword.tsx`, `web/src/WordRow.tsx`, `web/src/screens/Matching.tsx` (tiles), and the multiple-choice options in `web/src/study/RunView.tsx`
- Test: `web/src/study/Headword.test.tsx` (create if absent)

**Interfaces:**
- Consumes: `CorpusEntry.grammar`, `Corpus.target` (plan 1).
- Produces: `headwordForm(target: string, entry: Pick<CorpusEntry, 'headword' | 'pos' | 'grammar'>): { readonly lead: string; readonly after: string }` — `lead` is what replaces the bare headword, `after` is shown smaller after it (empty when nothing).

- [ ] **Step 1: Write the failing tests**

`core/src/headwordForm.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { headwordForm } from './headwordForm'

describe('headwordForm', () => {
  it('gives a German noun its article and plural', () => {
    expect(headwordForm('de', { headword: 'Haus', pos: 'noun', grammar: { gender: 'n', plural: 'Häuser' } })).toEqual({ lead: 'das Haus', after: 'die Häuser' })
    expect(headwordForm('de', { headword: 'Frau', pos: 'noun', grammar: { gender: 'f', plural: 'Frauen' } })).toEqual({ lead: 'die Frau', after: 'die Frauen' })
    expect(headwordForm('de', { headword: 'Tisch', pos: 'noun', grammar: { gender: 'm', plural: 'Tische' } })).toEqual({ lead: 'der Tisch', after: 'die Tische' })
  })
  it('shows the article only for a noun with no plural (Review Focus 5)', () => {
    expect(headwordForm('de', { headword: 'Milch', pos: 'noun', grammar: { gender: 'f', plural: '' } })).toEqual({ lead: 'die Milch', after: '' })
  })
  it('marks a verb that takes sein, and nothing for haben', () => {
    expect(headwordForm('de', { headword: 'gehen', pos: 'verb', grammar: { separable: false, irregular: true, auxiliary: 'sein' } })).toEqual({ lead: 'gehen', after: '(+ sein)' })
    expect(headwordForm('de', { headword: 'kaufen', pos: 'verb', grammar: { separable: false, irregular: false, auxiliary: 'haben' } })).toEqual({ lead: 'kaufen', after: '' })
  })
  it('leaves English, an adjective and an unknown field alone', () => {
    expect(headwordForm('en', { headword: 'apple', pos: 'noun', grammar: null })).toEqual({ lead: 'apple', after: '' })
    expect(headwordForm('de', { headword: 'groß', pos: 'adj', grammar: null })).toEqual({ lead: 'groß', after: '' })
    expect(headwordForm('de', { headword: 'Haus', pos: 'noun', grammar: { gender: 'n', plural: 'Häuser', case: 'x' } })).toEqual({ lead: 'das Haus', after: 'die Häuser' })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/core exec vitest run src/headwordForm.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`core/src/headwordForm.ts`:
```ts
import type { CorpusEntry } from './types'

const GERMAN_ARTICLE: Readonly<Record<string, string>> = { m: 'der', f: 'die', n: 'das' }

/** How a headword is shown with its grammar (spec §5.2): German nouns with article and plural, `sein` verbs marked. */
export function headwordForm(target: string, entry: Pick<CorpusEntry, 'headword' | 'pos' | 'grammar'>): { readonly lead: string; readonly after: string } {
  const g = entry.grammar
  if (target !== 'de' || g === null) return { lead: entry.headword, after: '' }
  if (entry.pos === 'noun') {
    const article = typeof g['gender'] === 'string' ? GERMAN_ARTICLE[g['gender']] : undefined
    const plural = typeof g['plural'] === 'string' && g['plural'] !== '' ? `die ${g['plural']}` : ''
    return { lead: article ? `${article} ${entry.headword}` : entry.headword, after: plural }
  }
  if (entry.pos === 'verb' && g['auxiliary'] === 'sein') return { lead: entry.headword, after: '(+ sein)' }
  return { lead: entry.headword, after: '' }
}
```
Export it from `core/src/index.ts`.

`Headword.tsx` takes `target: string` and renders `form.lead` in `.hw-word`, and when `form.after !== ''` a `<span className="hw-after">{form.after}</span>` inside `.hw-meta` before the IPA, with `lang={target}`. `WordRow`, the Matching tiles and the multiple-choice options in `RunView` show `form.lead` where they show `entry.headword` (the plural stays on the card only). Add `.hw-after` to `styles.css` beside `.hw-ipa`, same size and colour.

Add `web/src/study/Headword.test.tsx`: renders a German noun as "das Haus" with "die Häuser", and an English entry exactly as before.

- [ ] **Step 4: Run the core and web suites**

Run: `pnpm --filter @wordado/core test && pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add core web
git commit -m "feat(web): a German headword shows its article, plural and auxiliary (#313)"
```

---

### Task 7: Choosing a course — the setup's first question and Settings' course page

**Files:**
- Create: `web/src/setup/CourseStep.tsx`, `web/src/setup/CourseStep.test.tsx`
- Create: `web/src/settings/CourseSettings.tsx`, `web/src/settings/CourseSettings.test.tsx`
- Modify: `web/src/setup/Setup.tsx` (`StepName` gains `'course'`; `stepsFor`)
- Modify: `web/src/setup/LanguageStep.tsx` (lists `COURSE_L1S[settings.course]`; installs a `Course`)
- Modify: `web/src/settings/NativeLanguageSettings.tsx` (fallback from `COURSE_L1S`)
- Modify: `web/src/router.tsx` (route `course` at `/settings/course`), `web/src/screens/Settings.tsx` (a row in the languages section when `OFFERED_TARGETS.length > 1`)
- Modify: `web/src/app/boot.ts` or the shell (`Root.tsx`/`App.tsx`): a way to open the setup for the current client (`startSetup()`), used after switching to a course with no language
- Modify: `web/src/i18n/*.ts` (new keys below)
- Test: `web/src/setup/Setup.test.tsx`, `web/src/setup/LanguageStep.test.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 4, 5.
- Produces: `CourseStep(props: { onDone(): void })`; route `{ name: 'course' }`; `Boot.startSetup(): void` (sets the ready state with `setup: true` for the current client, as the first-run path does).
- New message keys (en / bg / de / es):
  - `setup.course.title`: What do you want to learn? / Какво искате да учите? / Was möchtest du lernen? / ¿Qué quieres aprender?
  - `settings.course`: Course / Курс / Kurs / Curso
  - `settings.courseHint`: Each course keeps its own level, theme and native language; your streak and goal are shared. / Всеки курс пази свое ниво, тема и роден език; поредицата и целта ви са общи. / Jeder Kurs behält sein eigenes Niveau, Thema und seine Muttersprache; Serie und Ziel teilen sie sich. / Cada curso guarda su propio nivel, tema e idioma materno; tu racha y tu objetivo son comunes.
  - `settings.courseSwitch`: Switch to {language} / Превключи на {language} / Zu {language} wechseln / Cambiar a {language}

- [ ] **Step 1: Write the failing tests**

`Setup.test.tsx`, add:
```ts
it('asks the course first when the build offers two (en,de)', () => { /* OFFERED_TARGETS mocked to ['en','de']: first heading is setup.course.title */ })
it('skips the course question when the build offers one (Review Focus 4)', () => { /* default: first step is the language */ })
```
`LanguageStep.test.tsx`, add:
```ts
it('lists the languages the course is taught from', () => {
  // settings.course 'de' → radios bg, es, en (in that order); 'en' → bg, de, es
})
```
`CourseStep.test.tsx`:
```ts
it('switches to the chosen course and goes on', async () => {
  // choose German → client.switchCourse('de') called, then onDone
})
```
`CourseSettings.test.tsx`:
```ts
it('switching to a course already started installs it and stays in the app', async () => { /* switchCourse resolves { needsSetup: false } → no startSetup */ })
it('switching to a new course opens its setup at the language', async () => { /* { needsSetup: true } → startSetup called */ })
it('writes nothing when the current course is chosen again', async () => {})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/web exec vitest run --project unit src/setup src/settings`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `Setup.tsx`: `type StepName = 'course' | 'language' | 'level' | 'theme' | 'goal'`; `stepsFor(corpus, offered = OFFERED_TARGETS, newCourse = false)` puts `'course'` first when `offered.length > 1 && !newCourse` (a setup opened by a course switch starts at the language: the course is already chosen). The `resumeAt` and `onStep` handling accepts `'course'` like the other steps.
- `CourseStep.tsx`: a radio list of `OFFERED_TARGETS` named with `languageName(target, locale)` in `lang={locale}`, default `settings.course`, a Continue button that awaits `client.switchCourse(chosen)` then `onDone()`. Modelled on `LanguageStep`'s structure (h2 focused on mount, `fieldset.choices`, `form-section`).
- `LanguageStep.tsx`: `const offered = COURSE_L1S[settings.course]`; radios over `offered`; the default choice is `settings.l1 ?? (offered.includes(locale) ? locale : offered[0])`; `install(l1)` calls `packs.install(client, account, { target: settings.course, l1 })`; the download progress compares `download.course`.
- `NativeLanguageSettings.tsx`: the fallback is `COURSE_L1S[settings.course][0]` instead of `'bg'`.
- `CourseSettings.tsx` at `/settings/course`: the current course ("German, from Bulgarian": `languageName(target)` and `languageInSentence(l1)`), the hint, and one button per other offered course (`settings.courseSwitch`). A button awaits `client.switchCourse(target)`; when `needsSetup`, it calls `startSetup()`; otherwise the course watcher installs the course and the page shows the `PackSwitcher` progress as `NativeLanguageSettings` does.
- `Settings.tsx`: in the languages section, when `OFFERED_TARGETS.length > 1`, a row linking to `/settings/course` showing the current course.
- `boot.ts`: `startSetup()` sets `{ status: 'ready', client, backend, resumed: false, account, setup: true }` for the current client; the shell's existing setup rendering does the rest, starting at the language step (pass `newCourse` to `Setup`).

- [ ] **Step 4: Run the web unit suite**

Run: `pnpm --filter @wordado/web exec vitest run --project unit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web
git commit -m "feat(web): choose a course in the setup and switch course in Settings (#313)"
```

---

### Task 8: End to end, the server, and the deploy notes

**Files:**
- Modify: `web/playwright.config.ts` (a project or env that builds with `VITE_COURSE_TARGETS=en,de`), `web/e2e/demo.spec.ts` (new describe)
- Modify: `web/e2e/helpers.ts:132-240` (helpers that hard-code `corpus-bg` take a course)
- Test: `server/src/sync/conformance.test.ts` (a `course` document round-trips), `server/src/account/export.test.ts` (it is in the export)
- Modify: `docs/deploy.md` (`COURSE_TARGETS` variable), `.github/workflows/deploy.yml` (`VITE_COURSE_TARGETS: ${{ vars.COURSE_TARGETS }}` beside the manifest variables)

- [ ] **Step 1: Write the end-to-end tests**

`web/e2e/demo.spec.ts`:
```ts
test.describe('a second course (#313)', () => {
  test('a first visit chooses German from Bulgarian and studies German words with their articles', async ({ page }) => {
    // open with the two-course build; setup: course German → language Bulgarian → level → … → study:
    // a card shows "das Haus" (or the sample's first noun with its article); no text on the page says "English"
  })
  test('switching to English and back keeps each course its level, and the reload mid-setup comes back to the setup (Review Focus 2, 3)', async ({ page }) => {
    // finish German setup at A1; Settings › Course › Switch to English → setup at the language (bg) → level B1 → study one card;
    // reload during the English setup first, and expect the setup again, not German words;
    // Settings › Course › Switch to German → German words at once, level A1; switch to English → level B1, the studied card's review kept
  })
})
```
Add an axe check of `CourseStep` and `CourseSettings` beside the setup's (`demo.spec.ts:1528`).

- [ ] **Step 2: Write the server tests**

In `conformance.test.ts`, following the file's document round-trip tests: a push of `{ type: 'course', key: 'en', fields: { l1: 'bg', declaredLevel: 'B1', activeTheme: 'food' } }` is merged and pulled back; `{ key: 'fr' }` is refused as invalid. In the export test: the account's `course` document appears in the export. (The server validates with core's `checkDocumentWrite`, so no server code should need to change; if a test fails, find where the server lists document types and add `course`.)

- [ ] **Step 3: Run everything**

Run: `pnpm --filter @wordado/server test && pnpm --filter @wordado/web e2e && pnpm -r typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 4: Deploy notes**

`docs/deploy.md`, in the variables section: "`COURSE_TARGETS` — the courses the app offers, as target codes separated by commas (`en,de`). Unset offers English only. Set it to `en,de` once the German corpus is published under `de/` beside the English manifest, then deploy." Add the variable to `deploy.yml`'s build env.

- [ ] **Step 5: Commit**

```bash
git add web server docs .github
git commit -m "test(web): a second course end to end; the COURSE_TARGETS variable (#313)"
```

---

## After this plan

- Set `COURSE_TARGETS=en,de` in the repository variables when the German corpus is published (wordado-content#78), and deploy.
- The marketing site names German when it is in the beta (its own repository).
- The hosted review app's German queues (a follow-up issue).
