# Credits and "Your Report Was Fixed" Implementation Plan (plan 8b)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app shows the word-data sources' attributions, which their licences require now that corpus v1 is public, and tells a learner when something they reported has been fixed (spec §8.10).

**Architecture:** Two small JSON files sit beside `manifest.json` on the CDN. `credits.json` is new: the pipeline writes it at every release from the licence register, and a one-off `credits` workflow action publishes it for v1. `fixes.json` already exists. Core owns both files' types and validators, and the pure rule that matches a learner's reports to fixes. The web app fetches both files whenever a corpus version becomes active. It shows the credits in a new Settings › About section, from a local copy when offline, and shows fixes in a banner that the learner dismisses once.

**Tech Stack:** TypeScript 7 (strict, `exactOptionalPropertyTypes`), pnpm workspaces (`@wordado/core`, `@wordado/client-data`, `@wordado/web`, `@wordado/pipeline`), React 19, Vitest (happy-dom + Testing Library), Playwright, oxlint, GitHub Actions, Cloudflare R2.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`
- §8.10 covers reporting an error ("The reporter is told, in the app, when something they reported has been fixed").
- §5.4 covers sourcing and licensing.
- §9.3 covers content sync.
- §11.2 covers interface strings in Bulgarian and English.

The roadmap `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md:24` defines plan 8b. Plan 8, `docs/superpowers/plans/2026-09-27-corpus-pipeline.md`, left two handovers:
- Decision 3: "the app's about page" shows the attributions.
- Decision 16: 8b shows `fixes.json`.

## Decisions

1. **Credits travel as `credits.json`, beside the manifest.** The format is `{ "schema_version": 1, "corpus_version": N, "sources": [{ "source": title, "attribution": text }] }`, one row per cleared source with a non-empty `attribution`.
   - Not in the pack: attributions are not per-L1, and adding a pack field needs a pack schema bump.
   - Not `release.json`: it carries internal fields (`draft`, `unreviewed`), and it is not uploaded.
   - The release uploads `credits.json` before the manifest, with `no-cache`.
2. **v1 is already public, so its credits go out at once.** The command `corpus credits <content> <out.json>` writes the file from `sources.json` at the last published version. A `credits` action in the Corpus workflow uploads that file alone, for release actors only. From v2 on, `release` writes and uploads it itself.
3. **Attributions are shown verbatim, in English.** The licence's wording is the obligation, so the text is never translated. The section heading and the lead-in sentence are localised.
4. **A report is fixed** when a fix has the same `word_id` and `field`, `fixed_in > report.packVersion` (the fix came after the report), and `fixed_in <= installed corpus version` (the learner already has it). `other` reports are never matched, because `fixes.json` never lists `other`.
5. **"Told" is remembered per device** under localStorage `wordado.fixes-seen`, as a list of report keys capped at the newest 500. Reports sync, so each of a learner's devices tells them once. That's acceptable, and it needs no new synced document type (the `content_report` fields are closed in `core/src/documentRules.ts:82-93`).
6. **When the app checks:** once a Client is ready, and whenever the active corpus version changes.
   - Any fetch failure (offline, 404, malformed JSON, another schema) keeps the current state, and the next trigger retries.
   - The bundled sample gets an empty `credits.json` and `fixes.json`, so the demo makes no failing requests.
7. **One banner.** One fixed report with a known word: "You reported the translation of “bank”. It is fixed now. Thank you!" Several, or a word no longer in the corpus: "We fixed 3 things you reported. Thank you!" **Dismiss** marks every shown report as told.

## Global Constraints

- Commits use the author email `11029931+danchom@users.noreply.github.com`, never a personal address: `git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit …`.
- No new dependencies. The pnpm minimum-release-age gate stays as it is.
- `pnpm typecheck` and `pnpm lint` (`oxlint --deny-warnings`) pass at the repository root after every task.
- Every interface string exists in both `web/src/i18n/en.ts` and `web/src/i18n/bg.ts` with the same placeholders (`web/src/i18n/i18n.test.tsx` checks this).
- Word IDs of corpus words are `c:<entry_id>` (`core/src/wordId.ts:5,11-13`).
- Run a package's tests from its directory with `npx vitest run <file>`, and all of them with `npx vitest run`. The web e2e demo suite is `pnpm --filter @wordado/web e2e`.

## Review Focus

1. **Offline, or the CDN is unreachable, when the app checks.** No error is shown and no notice appears. The About section shows the last credits this device saw, or "shown once the app has been online". The next activation or launch retries. Tests are in Task 5 (`Credits` keeps the cached copy on a failed fetch) and Task 6 (`FixNotices.check` keeps its state on a failed fetch).
2. **A fix older than the report, or newer than the installed pack.** A report filed on v2 about a v1 fix is never announced. A v3 fix is announced only once v3 is active. Tests are in Task 1 (`fixedReports`).
3. **A malformed `fixes.json` or `credits.json`, or one with a future `schema_version`.** It is ignored and doesn't crash. Tests are in Task 1 (the validators return null) and Task 4 (`fetchSibling` returns null).
4. **An `other` report, or a fixed word that is no longer in the corpus.** `other` is never announced. A word missing from the corpus falls back to the counted message. Tests are in Task 1 (`other`) and Task 6 (a null headword gives the counted message).
5. **A dismissed notice after a reload.** It never comes back, while a later fix of another report still appears. Test in Task 6.

---

### Task 1: Core: the credits and fixes files, and matching reports to fixes

**Files:**
- Create: `core/src/credits.ts`, `core/src/credits.test.ts`, `core/src/fixes.ts`, `core/src/fixes.test.ts`
- Modify: `core/src/index.ts` (export both), `pipeline/src/lastPublished.ts:9-19` (use core's types), `pipeline/src/fixes.ts:4` (the field list's type)

**Interfaces:**
- Consumes: `REPORT_FIELDS`, `ReportField` from `core/src/documentRules.ts:21-22`.
- Produces:
  - `CREDITS_SCHEMA_VERSION = 1`, `interface Credit { readonly source: string; readonly attribution: string }`, `interface CreditsFile { readonly schema_version: 1; readonly corpus_version: number; readonly sources: readonly Credit[] }`, `validateCredits(value: unknown): CreditsFile | null`
  - `FIXES_SCHEMA_VERSION = 1`, `type FixedField = Exclude<ReportField, 'other'>`, `interface Fix { readonly word_id: string; readonly field: FixedField; readonly fixed_in: number }`, `interface FixesFile { readonly schema_version: 1; readonly corpus_version: number; readonly fixes: readonly Fix[] }`, `validateFixes(value: unknown): FixesFile | null`
  - `interface ReportRecord { readonly key: string; readonly wordId: string; readonly field: ReportField; readonly packVersion: number }`, `interface FixedReport { readonly report: ReportRecord; readonly fix: Fix }`, `fixedReports(reports: readonly ReportRecord[], fixes: FixesFile, installed: number | null): FixedReport[]`

- [ ] **Step 1: Write the failing tests**

`core/src/credits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { validateCredits } from './credits'

describe('validateCredits', () => {
  it('accepts the published shape and keeps only its known fields', () => {
    const file = { schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb (ODC-By 1.0).', extra: 1 }] }
    expect(validateCredits(file)).toEqual({ schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb (ODC-By 1.0).' }] })
    expect(validateCredits({ schema_version: 1, corpus_version: 0, sources: [] })).toEqual({ schema_version: 1, corpus_version: 0, sources: [] })
  })

  it('refuses another schema, a missing field, or an empty attribution', () => {
    expect(validateCredits({ schema_version: 2, corpus_version: 1, sources: [] })).toBeNull()
    expect(validateCredits({ schema_version: 1, sources: [] })).toBeNull()
    expect(validateCredits({ schema_version: 1, corpus_version: 1, sources: [{ source: 'x', attribution: ' ' }] })).toBeNull()
    expect(validateCredits('nope')).toBeNull()
    expect(validateCredits(null)).toBeNull()
  })
})
```

`core/src/fixes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fixedReports, validateFixes, type FixesFile, type ReportRecord } from './fixes'

const fixes: FixesFile = {
  schema_version: 1,
  corpus_version: 3,
  fixes: [
    { word_id: 'c:bank-1', field: 'translation', fixed_in: 2 },
    { word_id: 'c:bank-1', field: 'translation', fixed_in: 3 },
    { word_id: 'c:go-1', field: 'audio', fixed_in: 3 },
  ],
}
const report = (key: string, wordId: string, field: ReportRecord['field'], packVersion: number): ReportRecord => ({ key, wordId, field, packVersion })

describe('validateFixes', () => {
  it('accepts the published shape, and refuses another schema or a malformed fix', () => {
    expect(validateFixes(fixes)).toEqual(fixes)
    expect(validateFixes({ ...fixes, schema_version: 2 })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'c:bank-1', field: 'other', fixed_in: 2 }] })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'bank-1', field: 'audio', fixed_in: 2 }] })).toBeNull()
    expect(validateFixes({ ...fixes, fixes: [{ word_id: 'c:bank-1', field: 'audio', fixed_in: 0 }] })).toBeNull()
    expect(validateFixes([])).toBeNull()
  })
})

describe('fixedReports', () => {
  it('matches a report to the first fix of its word and field that came after it and is installed', () => {
    const r = report('k1', 'c:bank-1', 'translation', 1)
    expect(fixedReports([r], fixes, 3)).toEqual([{ report: r, fix: fixes.fixes[0] }])
  })

  it('never announces a fix older than the report, or one the learner has not installed yet', () => {
    expect(fixedReports([report('k1', 'c:bank-1', 'translation', 3)], fixes, 3)).toEqual([])
    expect(fixedReports([report('k2', 'c:go-1', 'audio', 1)], fixes, 2)).toEqual([])
    expect(fixedReports([report('k2', 'c:go-1', 'audio', 1)], fixes, null)).toEqual([])
  })

  it('never matches another field, another word, or an "other" report', () => {
    expect(fixedReports([report('k3', 'c:bank-1', 'audio', 1), report('k4', 'c:river-1', 'translation', 1), report('k5', 'c:bank-1', 'other', 1)], fixes, 3)).toEqual([])
  })
})
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd core && npx vitest run src/credits.test.ts src/fixes.test.ts`
Expected: FAIL. The modules `./credits` and `./fixes` cannot be resolved.

- [ ] **Step 3: Implement**

`core/src/credits.ts`:

```ts
/** `credits.json` beside the manifest (plan 8b, Decision 1): the attributions the word-data sources' licences require. */
export const CREDITS_SCHEMA_VERSION = 1

export interface Credit {
  /** The source's title, as the licence register names it. */
  readonly source: string
  /** The licence's attribution, shown verbatim. */
  readonly attribution: string
}

export interface CreditsFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly sources: readonly Credit[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim() !== ''

/** The file with only its known fields, or null for anything else (another schema included): the app then keeps what it had. */
export function validateCredits(value: unknown): CreditsFile | null {
  if (!isRecord(value) || value['schema_version'] !== CREDITS_SCHEMA_VERSION) return null
  const version = value['corpus_version']
  const sources = value['sources']
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0 || !Array.isArray(sources)) return null
  const out: Credit[] = []
  for (const s of sources) {
    if (!isRecord(s) || !text(s['source']) || !text(s['attribution'])) return null
    out.push({ source: s['source'], attribution: s['attribution'] })
  }
  return { schema_version: CREDITS_SCHEMA_VERSION, corpus_version: version, sources: out }
}
```

`core/src/fixes.ts`:

```ts
import { REPORT_FIELDS, type ReportField } from './documentRules'
import { isWordId } from './wordId'

/** `fixes.json` beside the manifest (plan 8, Decision 16): every entry field a corpus version changed, cumulative. */
export const FIXES_SCHEMA_VERSION = 1

/** A report field a new corpus version can fix; "other" names nothing a pack carries. */
export type FixedField = Exclude<ReportField, 'other'>
const FIXED_FIELDS: readonly string[] = REPORT_FIELDS.filter((f) => f !== 'other')

export interface Fix {
  readonly word_id: string
  readonly field: FixedField
  readonly fixed_in: number
}

export interface FixesFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly fixes: readonly Fix[]
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const version = (v: unknown, min: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min

/** The file with only its known fields, or null for anything else (another schema included): the app then keeps what it had. */
export function validateFixes(value: unknown): FixesFile | null {
  if (!isRecord(value) || value['schema_version'] !== FIXES_SCHEMA_VERSION) return null
  const corpusVersion = value['corpus_version']
  const list = value['fixes']
  if (!version(corpusVersion, 0) || !Array.isArray(list)) return null
  const out: Fix[] = []
  for (const f of list) {
    if (!isRecord(f)) return null
    const wordId = f['word_id']
    const field = f['field']
    const fixedIn = f['fixed_in']
    if (typeof wordId !== 'string' || !isWordId(wordId) || typeof field !== 'string' || !FIXED_FIELDS.includes(field) || !version(fixedIn, 1)) return null
    out.push({ word_id: wordId, field: field as FixedField, fixed_in: fixedIn })
  }
  return { schema_version: FIXES_SCHEMA_VERSION, corpus_version: corpusVersion, fixes: out }
}

/** A learner's content report, as the client holds it (spec §8.10). */
export interface ReportRecord {
  readonly key: string
  readonly wordId: string
  readonly field: ReportField
  /** The corpus version the learner had when reporting. */
  readonly packVersion: number
}

export interface FixedReport {
  readonly report: ReportRecord
  readonly fix: Fix
}

/**
 * The reports a fix answers (plan 8b, Decision 4): same word and field, a fix
 * that came after the report, in a version the learner has installed. Each
 * report is matched to its first such fix.
 */
export function fixedReports(reports: readonly ReportRecord[], fixes: FixesFile, installed: number | null): FixedReport[] {
  if (installed === null) return []
  const out: FixedReport[] = []
  for (const report of reports) {
    const fix = fixes.fixes
      .filter((f) => f.word_id === report.wordId && f.field === report.field && f.fixed_in > report.packVersion && f.fixed_in <= installed)
      .sort((a, b) => a.fixed_in - b.fixed_in)[0]
    if (fix) out.push({ report, fix })
  }
  return out
}
```

In `core/src/index.ts`, after `export * from './documentRules'`, add:

```ts
export * from './credits'
export * from './fixes'
```

In `pipeline/src/lastPublished.ts`, delete the local `Fix` and `FixesFile` interfaces (lines 9-19) and their doc comment. Import the types from core instead, and re-export them for the pipeline's other modules:

```ts
import { validateManifest, validatePack, type FixesFile, type Pack, type PackManifest } from '@wordado/core'
export type { Fix, FixesFile } from '@wordado/core'
```

Remove `ReportField` from that import if it is no longer used. In `pipeline/src/fixes.ts:4`, type the field list with core's narrower type:

```ts
import { canonicalJson, type FixedField, type Pack, type PackEntry } from '@wordado/core'
const FIELDS: readonly [FixedField, (e: PackEntry) => unknown][] = [
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd core && npx vitest run src/credits.test.ts src/fixes.test.ts && cd ../pipeline && npx vitest run src/fixes.test.ts src/release.test.ts && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS, and no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add core/src/credits.ts core/src/credits.test.ts core/src/fixes.ts core/src/fixes.test.ts core/src/index.ts pipeline/src/lastPublished.ts pipeline/src/fixes.ts
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(core): the credits and fixes files, and matching reports to fixes"
```

---

### Task 2: Pipeline: `credits.json` at every release, `corpus credits`, and the workflow

**Files:**
- Create: `pipeline/src/credits.ts`, `pipeline/src/credits.test.ts`, `pipeline/samples/a1-bg/credits.json`, `pipeline/samples/a1-bg/fixes.json`
- Modify:
  - `pipeline/src/release.ts`: `ReleasePlan.credits`, and `writeRelease` writes the file.
  - `pipeline/src/publishable.ts`: a release directory needs a valid `credits.json`.
  - `pipeline/src/cli.ts`: the `credits` command.
  - `pipeline/template/.github/workflows/corpus.yml`: the upload, and the `credits` action.
  - `pipeline/README.md`.
- Test: `pipeline/src/credits.test.ts`, `pipeline/src/release.test.ts`, `pipeline/src/publishable.test.ts`

**Interfaces:**
- Consumes: `CreditsFile`, `CREDITS_SCHEMA_VERSION`, `validateCredits` from Task 1. `readClearedSources(dir): { record: SourceRecord; text: string }[]` from `pipeline/src/sources.ts:54`. `readLastPublished(dir).manifest.corpus_version`.
- Produces:
  - `creditsFile(sources: readonly { readonly record: SourceRecord }[], corpusVersion: number): CreditsFile`
  - `ReleasePlan.credits: CreditsFile`
  - `credits.json` in every release directory.
  - The CLI command `corpus credits <dir> <out.json>`.

- [ ] **Step 1: Write the failing tests**

`pipeline/src/credits.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { creditsFile } from './credits'
import type { SourceRecord } from './sources'

const record = (title: string, attribution: string): { record: SourceRecord } => ({
  record: { id: title, file: `${title}.tsv`, title, url: '', licence: 'CC BY 3.0', commercial_use: true, share_alike: false, attribution, cleared_by: 'x', cleared_on: '2026-09-28', notes: '' },
})

describe('creditsFile', () => {
  it('lists every source that needs an attribution, in register order, at the given version', () => {
    expect(creditsFile([record('FineWeb', 'From FineWeb (ODC-By 1.0).'), record('Invented', ' '), record('Google Books', 'From Google Books (CC BY 3.0).')], 1)).toEqual({
      schema_version: 1,
      corpus_version: 1,
      sources: [
        { source: 'FineWeb', attribution: 'From FineWeb (ODC-By 1.0).' },
        { source: 'Google Books', attribution: 'From Google Books (CC BY 3.0).' },
      ],
    })
  })
})
```

In `pipeline/src/release.test.ts`, first check that `'lists a source’s required attribution in release.json'` still passes. Then add this test after it:

```ts
  it('writes credits.json beside the manifest, from the same attributions', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8')) as unknown[]
    writeJson(join(dir, 'sources.json'), [{ ...(sources[0] as object), attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }])
    const o = out()
    writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))
    expect(JSON.parse(readFileSync(join(o, 'credits.json'), 'utf8'))).toEqual({
      schema_version: 1,
      corpus_version: 1,
      sources: [{ source: 'Invented test list', attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }],
    })
    expect(publishProblems(reader(o))).toEqual([])
  })
```

In the first release test (line ~38), update the expected directory listing to `['audio', 'corpus-v1-bg.pack', 'credits.json', 'fixes.json', 'manifest.json', 'release.json']`.

In `pipeline/src/publishable.test.ts`, add a test in the file's style. Build a release directory with the same helper the file already uses for a valid one, then check that deleting `credits.json` gives `['credits.json: missing']` and that a file with `schema_version: 2` gives `['credits.json: not a credits file']`. If the file has no helper that writes `release.json`, add `release.json` with `{ "draft": false }` to the valid directory built there.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd pipeline && npx vitest run src/credits.test.ts src/release.test.ts src/publishable.test.ts`
Expected: FAIL. `./credits` is missing, there is no `credits.json` in the release directory, and publishable does not check it.

- [ ] **Step 3: Implement**

`pipeline/src/credits.ts`:

```ts
import { CREDITS_SCHEMA_VERSION, type CreditsFile } from '@wordado/core'
import type { SourceRecord } from './sources'

/** `credits.json` (plan 8b, Decision 1): each cleared source whose licence requires an attribution, in register order. */
export function creditsFile(sources: readonly { readonly record: SourceRecord }[], corpusVersion: number): CreditsFile {
  return {
    schema_version: CREDITS_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    sources: sources.filter((s) => s.record.attribution.trim() !== '').map((s) => ({ source: s.record.title, attribution: s.record.attribution })),
  }
}
```

In `pipeline/src/release.ts`:
- Import `creditsFile` from `./credits` and `type CreditsFile` from `@wordado/core`.
- Add `readonly credits: CreditsFile` to `ReleasePlan`.
- In `planRelease`, build `const credits = creditsFile(sources, corpusVersion)`, derive `releaseInfo.attributions` from it (`attributions: credits.sources`), and return `credits`.
- In `writeRelease`, write the file before the manifest and list it:

```ts
  writeJson(join(outDir, 'fixes.json'), plan.fixes)
  writeJson(join(outDir, 'credits.json'), plan.credits)
  writeJson(join(outDir, 'release.json'), plan.releaseInfo)
  writeJson(join(outDir, 'manifest.json'), plan.manifest)
  return [...files, 'fixes.json', 'credits.json', 'release.json', 'manifest.json']
```

In `pipeline/src/publishable.ts`, import `validateCredits` from `@wordado/core`. Inside the `if (release !== null)` block, after the draft check, add:

```ts
    const credits = read('credits.json')
    if (credits === null) return ['credits.json: missing']
    try {
      if (validateCredits(JSON.parse(new TextDecoder().decode(credits))) === null) return ['credits.json: not a credits file']
    } catch {
      return ['credits.json: not a credits file']
    }
```

Update the doc comment to say that a release directory (one with `release.json`) also needs a valid `credits.json`.

In `pipeline/src/cli.ts`:
- Import `creditsFile` from `./credits`, `readClearedSources` from `./sources`, and `writeJson` from `./files` (if not imported yet).
- Add this line to `USAGE` after `release`: `    credits <dir> <out.json>       the sources' attributions at the last published version (credits.json)`.
- Add the case:

```ts
    case 'credits': {
      const dir = arg(first)
      const file = arg(second)
      const credits = creditsFile(readClearedSources(dir), readLastPublished(dir).manifest.corpus_version)
      writeJson(file, credits)
      console.log(`wrote ${file}: ${credits.sources.length} sources at corpus v${credits.corpus_version}`)
      break
    }
```

Create `pipeline/samples/a1-bg/credits.json`. The bundled sample was written in-house and cites no source:

```json
{
  "schema_version": 1,
  "corpus_version": 0,
  "sources": []
}
```

Create `pipeline/samples/a1-bg/fixes.json`:

```json
{
  "schema_version": 1,
  "corpus_version": 0,
  "fixes": []
}
```

In `pipeline/template/.github/workflows/corpus.yml`:
- Add `credits` to the action choices: `options: [draft, audio, triage, release, credits]`.
- Change the `work` job's condition to `if: inputs.action != 'release' && inputs.action != 'credits'`.
- In the release job's "Upload the packs and the audio (not the manifest)" step, after the `fixes.json` copy, add:

```yaml
          aws s3 cp "$OUT/credits.json" "$BUCKET/credits.json" --endpoint-url "$R2" \
            --content-type application/json --cache-control no-cache
```

Add a job after `release`:

```yaml
  credits:
    name: credits
    if: inputs.action == 'credits'
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    env:
      OUT: ${{ github.workspace }}/out
      BUCKET: s3://${{ vars.CONTENT_BUCKET }}
      R2: https://${{ vars.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      AWS_DEFAULT_REGION: auto
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
    steps:
      # credits.json is public and says who made the word data: only a release actor publishes it.
      - name: Only a release actor can publish the credits
        env:
          RELEASE_ACTORS: ${{ vars.RELEASE_ACTORS }}
        run: |
          case " $(echo "$RELEASE_ACTORS" | tr ',' ' ') " in
            *" $GITHUB_TRIGGERING_ACTOR "*) echo "$GITHUB_TRIGGERING_ACTOR may publish the credits." ;;
            *)
              echo "::error::$GITHUB_TRIGGERING_ACTOR is not in the repository variable RELEASE_ACTORS."
              exit 1
              ;;
          esac
      - uses: actions/checkout@v5
        with:
          path: content
      - uses: actions/checkout@v5
        with:
          repository: wordado/wordado
          ref: ${{ vars.PIPELINE_REF }}
          path: wordado
      - uses: pnpm/action-setup@v4
        with:
          package_json_file: wordado/package.json
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: wordado/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
        working-directory: wordado
      - name: Write credits.json from the licence register
        run: $CORPUS credits "$GITHUB_WORKSPACE/content" "$OUT/credits.json"
      - name: Upload credits.json
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
        run: |
          aws s3 cp "$OUT/credits.json" "$BUCKET/credits.json" --endpoint-url "$R2" \
            --content-type application/json --cache-control no-cache
```

In `pipeline/README.md`:
- Add `credits <dir> <out.json>` to the commands table, as "the sources' attributions at the last published version (`credits.json`)".
- In *Running a version*, step 7 (Release), add "`credits.json`" to the list of uploaded files.
- Add a paragraph to the legal-gate section: "**Attributions reach the app** as `credits.json` beside the manifest, from each cleared source's `attribution`. Every release writes and uploads it. After changing an attribution without a release (or for a version published before 8b), run Actions › Corpus › `credits`."

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd pipeline && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. Also check any other test that lists a release directory's files, or the sample directory's files (`sample.test.ts`, `e2e.test.ts`), and update its expected list with `credits.json` (and, for the sample, `fixes.json`).

- [ ] **Step 5: Commit**

```bash
git add pipeline
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(pipeline): credits.json at every release, corpus credits, and the credits workflow action"
```

---

### Task 3: Client-data: reading the learner's reports

**Files:**
- Modify: `client-data/src/documentTypes.ts` (add `readReports`), `client-data/src/client.ts` (add `reports()` near `report()` at line ~303)
- Test: `client-data/src/documentTypes.test.ts` (create it if absent; otherwise add to the file that tests `addContentReport`; find it with `grep -rln addContentReport client-data/src`)

**Interfaces:**
- Consumes: `listDocuments(driver, type)` from `client-data/src/documents.ts:74`, `DOC.contentReport`, `REPORT_FIELDS` and `ReportRecord` (Task 1) from `@wordado/core`.
- Produces: `readReports(driver: SqlDriver): Promise<ReportRecord[]>` and `Client.reports(): Promise<ReportRecord[]>`.

- [ ] **Step 1: Write the failing test**

Follow the existing client-data test style: `openSampleClient(testEnv())` from `client-data/src/testing/sample.ts`.

```ts
import { describe, expect, it } from 'vitest'
import { openSampleClient } from './testing/sample'
import { testEnv } from './testing/testEnv'

describe('Client.reports', () => {
  it('returns every report this learner filed, with the corpus version they had', async () => {
    const client = await openSampleClient(testEnv())
    const key = await client.report({ wordId: 'c:hello-1', field: 'translation', note: 'odd', packVersion: 0 })
    await client.report({ wordId: 'c:bread-1', field: 'other', note: '', packVersion: 0 })
    const reports = await client.reports()
    expect(reports).toHaveLength(2)
    expect(reports.find((r) => r.key === key)).toEqual({ key, wordId: 'c:hello-1', field: 'translation', packVersion: 0 })
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd client-data && npx vitest run <the test file>`
Expected: FAIL: `client.reports is not a function`.

- [ ] **Step 3: Implement**

In `client-data/src/documentTypes.ts`, next to `addContentReport` (lines 103-115). Add the import of `REPORT_FIELDS` and `type ReportRecord` from `@wordado/core` beside the existing core import.

```ts
/** The learner's content reports, as this device holds them (they sync from the learner's other devices too). */
export async function readReports(driver: SqlDriver): Promise<ReportRecord[]> {
  const out: ReportRecord[] = []
  for (const doc of await listDocuments(driver, DOC.contentReport)) {
    const { wordId, field, packVersion } = doc.fields
    if (doc.deleted || typeof wordId !== 'string' || !isWordId(wordId)) continue
    if (typeof field !== 'string' || !(REPORT_FIELDS as readonly string[]).includes(field)) continue
    out.push({ key: doc.key, wordId, field: field as ReportRecord['field'], packVersion: typeof packVersion === 'number' ? packVersion : 0 })
  }
  return out
}
```

(`isWordId` is already imported there for `readFlags`; if not, import it from `@wordado/core`.)

In `client-data/src/client.ts`, after `report(…)`, add the method. Import `readReports`, and the `ReportRecord` type from `@wordado/core`.

```ts
  /** The learner's content reports, for telling them what has been fixed (spec §8.10, plan 8b). */
  reports(): Promise<ReportRecord[]> {
    return this.guarded(() => readReports(this.db.driver))
  }
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd client-data && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client-data
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(client-data): read the learner's content reports"
```

---

### Task 4: Web: fetching the files beside the manifest

**Files:**
- Create: `web/src/content/siblings.ts`, `web/src/content/siblings.test.ts`

**Interfaces:**
- Consumes: `manifestBase(manifestUrl, page?)` and `type Fetch` from `web/src/content/packs.ts:16,21`.
- Produces:
  - `type SiblingFile = 'credits.json' | 'fixes.json'`
  - `siblingUrl(manifestUrl: string, name: SiblingFile, page?: string): string`
  - `fetchSibling<T>(manifestUrl: string, name: SiblingFile, validate: (value: unknown) => T | null, fetchFn?: Fetch): Promise<T | null>`

- [ ] **Step 1: Write the failing test**

```ts
import { validateFixes } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { fetchSibling, siblingUrl } from './siblings'

const PAGE = 'https://wordado.com/study'
const ok = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 })

describe('siblingUrl', () => {
  it('resolves beside the manifest, on the CDN or in the bundled sample', () => {
    expect(siblingUrl('https://content.wordado.com/manifest.json', 'fixes.json', PAGE)).toBe('https://content.wordado.com/fixes.json')
    expect(siblingUrl('/content/sample/manifest.json', 'credits.json', PAGE)).toBe('https://wordado.com/content/sample/credits.json')
  })
})

describe('fetchSibling', () => {
  const file = { schema_version: 1, corpus_version: 1, fixes: [] }

  it('returns the validated file, fetched without the browser cache', async () => {
    const seen: RequestInit[] = []
    const fetchFn = async (_: string, init?: RequestInit) => {
      seen.push(init ?? {})
      return new Response(JSON.stringify(file))
    }
    expect(await fetchSibling('https://content.wordado.com/manifest.json', 'fixes.json', validateFixes, fetchFn)).toEqual(file)
    expect(seen[0]).toMatchObject({ cache: 'no-cache' })
  })

  it('returns null, never throws, when offline, missing, not JSON, or not the file', async () => {
    const url = 'https://content.wordado.com/manifest.json'
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => Promise.reject(new TypeError('offline')))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => new Response('', { status: 404 }))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, async () => new Response('<html>'))).toBeNull()
    expect(await fetchSibling(url, 'fixes.json', validateFixes, ok({ ...file, schema_version: 2 }))).toBeNull()
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd web && npx vitest run src/content/siblings.test.ts`
Expected: FAIL: the module cannot be resolved.

- [ ] **Step 3: Implement**

`web/src/content/siblings.ts`:

```ts
import { manifestBase, type Fetch } from './packs'

/** The small files the CDN serves beside the manifest (plan 8b). */
export type SiblingFile = 'credits.json' | 'fixes.json'

/** Where `name` is: beside the manifest, so the demo's sample and a learner's CDN each have their own. */
export function siblingUrl(manifestUrl: string, name: SiblingFile, page?: string): string {
  // manifestBase's page defaults to the current location when undefined.
  return new URL(name, manifestBase(manifestUrl, page)).href
}

/**
 * The validated file, or null for anything else: offline, missing, not JSON, another schema. Never throws; the
 * caller keeps what it had and asks again at the next trigger (plan 8b, Decision 6).
 */
export async function fetchSibling<T>(
  manifestUrl: string,
  name: SiblingFile,
  validate: (value: unknown) => T | null,
  fetchFn: Fetch = (input, init) => fetch(input, init),
): Promise<T | null> {
  try {
    const response = await fetchFn(siblingUrl(manifestUrl, name), { cache: 'no-cache' })
    if (!response.ok) return null
    return validate(await response.json())
  } catch {
    return null
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd web && npx vitest run src/content/siblings.test.ts && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/src/content/siblings.ts web/src/content/siblings.test.ts
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(web): fetch the files beside the manifest"
```

---

### Task 5: Web: the credits, and Settings › About

**Files:**
- Create: `web/src/app/credits.ts`, `web/src/app/credits.test.ts`, `web/src/settings/AboutSettings.tsx`, `web/src/settings/AboutSettings.test.tsx`
- Modify: `web/src/app/context.tsx` (`AppServices.credits`), `web/src/test/fixtures.tsx` (`fakeCredits`, `RenderContext.credits`), `web/src/screens/Settings.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`

**Interfaces:**
- Consumes: `CreditsFile`, `validateCredits` (Task 1), `fetchSibling` (Task 4), `KeyValue` from `web/src/account/storage.ts:8`, and `createStore`/`Store` from `@wordado/client-data`.
- Produces:
  - `CREDITS_KEY = 'wordado.credits'`
  - `class Credits { readonly store: Store<CreditsView>; constructor(deps: CreditsDeps); refresh(manifestUrl: string): Promise<void> }`
  - `interface CreditsView { readonly manifestUrl: string | null; readonly credits: CreditsFile | null }`
  - `interface CreditsDeps { readonly storage: KeyValue; fetch(manifestUrl: string): Promise<CreditsFile | null> }`
  - `type CreditsPort = Pick<Credits, 'store'>`
  - `AppServices.credits: CreditsPort`
  - `fakeCredits(view?: Partial<CreditsView>): CreditsPort`

- [ ] **Step 1: Write the failing tests**

`web/src/app/credits.test.ts`:

```ts
import type { CreditsFile } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { Credits, CREDITS_KEY } from './credits'

const CDN = 'https://content.wordado.com/manifest.json'
const v1: CreditsFile = { schema_version: 1, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'From FineWeb (ODC-By 1.0).' }] }

describe('Credits', () => {
  it('shows what it fetched for this manifest, and remembers it', async () => {
    const storage = memoryStorage()
    const credits = new Credits({ storage, fetch: async () => v1 })
    await credits.refresh(CDN)
    expect(credits.store.get()).toEqual({ manifestUrl: CDN, credits: v1 })
    expect(JSON.parse(storage.getItem(CREDITS_KEY)!)).toEqual({ [CDN]: v1 })
  })

  it('offline, shows the copy this device saw last for the same manifest, and nothing for another', async () => {
    const storage = memoryStorage()
    await new Credits({ storage, fetch: async () => v1 }).refresh(CDN)
    const offline = new Credits({ storage, fetch: async () => null })
    await offline.refresh(CDN)
    expect(offline.store.get().credits).toEqual(v1)
    await offline.refresh('/content/sample/manifest.json')
    expect(offline.store.get()).toEqual({ manifestUrl: '/content/sample/manifest.json', credits: null })
  })

  it('reads a damaged stored copy as absent', async () => {
    const storage = memoryStorage()
    storage.setItem(CREDITS_KEY, '{not json')
    const credits = new Credits({ storage, fetch: async () => null })
    await credits.refresh(CDN)
    expect(credits.store.get().credits).toBeNull()
  })
})
```

`web/src/settings/AboutSettings.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { fakeCredits, renderWith, setup } from '../test/fixtures'
import { AboutSettings } from './AboutSettings'

const credits = { schema_version: 1 as const, corpus_version: 1, sources: [{ source: 'FineWeb', attribution: 'Word frequencies counted from FineWeb by Hugging Face (ODC-By 1.0).' }] }

describe('AboutSettings', () => {
  it('lists each source’s attribution verbatim, in English, under a localised heading', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, locale: 'bg', credits: fakeCredits({ manifestUrl: 'x', credits }) })
    expect(screen.getByRole('heading', { name: 'За приложението' })).toBeTruthy()
    const item = screen.getByText('Word frequencies counted from FineWeb by Hugging Face (ODC-By 1.0).')
    expect(item.closest('[lang]')?.getAttribute('lang')).toBe('en')
  })

  it('says the word list is Wordado’s own when no source needs an attribution', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, credits: fakeCredits({ manifestUrl: 'x', credits: { ...credits, sources: [] } }) })
    expect(screen.getByText('This word list was prepared by Wordado.')).toBeTruthy()
  })

  it('before it has ever been online, says the sources appear once it has', async () => {
    const ctx = await setup()
    renderWith(<AboutSettings />, { ...ctx, credits: fakeCredits() })
    expect(screen.getByText('The word data’s sources appear here once the app has been online.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/app/credits.test.ts src/settings/AboutSettings.test.tsx`
Expected: FAIL: the modules and `fakeCredits` do not exist.

- [ ] **Step 3: Implement**

`web/src/app/credits.ts`:

```ts
import { createStore, type Store } from '@wordado/client-data'
import { validateCredits, type CreditsFile } from '@wordado/core'
import type { KeyValue } from '../account/storage'

/** The last credits this device saw, by manifest URL: the About section works offline (plan 8b, Decision 6). */
export const CREDITS_KEY = 'wordado.credits'

export interface CreditsView {
  readonly manifestUrl: string | null
  readonly credits: CreditsFile | null
}

export interface CreditsDeps {
  readonly storage: KeyValue
  fetch(manifestUrl: string): Promise<CreditsFile | null>
}

/** The word data's attributions (plan 8b, Decision 1), for Settings › About. */
export class Credits {
  readonly store: Store<CreditsView> = createStore<CreditsView>({ manifestUrl: null, credits: null })

  constructor(private readonly deps: CreditsDeps) {}

  private saved(): Record<string, CreditsFile> {
    try {
      const raw = this.deps.storage.getItem(CREDITS_KEY)
      const value: unknown = raw === null ? {} : JSON.parse(raw)
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
      const out: Record<string, CreditsFile> = {}
      for (const [url, file] of Object.entries(value)) {
        const valid = validateCredits(file)
        if (valid) out[url] = valid
      }
      return out
    } catch {
      return {}
    }
  }

  /** Shows the stored copy for `manifestUrl` at once, then the CDN's when it answers. */
  async refresh(manifestUrl: string): Promise<void> {
    const saved = this.saved()
    this.store.set({ manifestUrl, credits: saved[manifestUrl] ?? null })
    const fetched = await this.deps.fetch(manifestUrl)
    if (fetched === null || this.store.get().manifestUrl !== manifestUrl) return
    this.store.set({ manifestUrl, credits: fetched })
    try {
      this.deps.storage.setItem(CREDITS_KEY, JSON.stringify({ ...saved, [manifestUrl]: fetched }))
    } catch {
      // A private window may refuse storage: the credits then show while online.
    }
  }
}

export type CreditsPort = Pick<Credits, 'store'>
```

`web/src/settings/AboutSettings.tsx`:

```tsx
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'

/** About (plan 8b): the attributions the word data's licences require, shown verbatim in English (Decision 3). */
export function AboutSettings() {
  const { t } = useT()
  const { credits } = useApp()
  const view = useStore(credits.store)
  const sources = view.credits?.sources ?? null
  return (
    <section aria-labelledby="settings-about">
      <h2 id="settings-about">{t('settings.about')}</h2>
      {sources === null ? (
        <p className="note">{t('about.unavailable')}</p>
      ) : sources.length === 0 ? (
        <p>{t('about.ownList')}</p>
      ) : (
        <>
          <p>{t('about.sources')}</p>
          <ul className="credits" lang="en">
            {sources.map((s) => (
              <li key={s.source}>{s.attribution}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
```

In `web/src/screens/Settings.tsx`, import `AboutSettings` and render `<AboutSettings />` after `<AppSettings />`, before the privacy link.

In `web/src/app/context.tsx`, import `type CreditsPort` from `./credits` and add this to `AppServices`:

```ts
  /** The word data's attributions (plan 8b), for Settings › About. */
  readonly credits: CreditsPort
```

In `web/src/test/fixtures.tsx`:
- Add `readonly credits?: CreditsPort` to `RenderContext`.
- Add `credits: ctx.credits ?? fakeCredits(),` to `renderWith`'s value.
- Add:

```ts
/** Credits as Settings › About sees them: none yet, unless a test says so. */
export function fakeCredits(view: Partial<CreditsView> = {}): CreditsPort {
  return { store: createStore<CreditsView>({ manifestUrl: null, credits: null, ...view }) }
}
```

Import `type CreditsPort, type CreditsView` from `../app/credits` (`createStore` is already imported there).

Strings. In `web/src/i18n/en.ts`, next to `'settings.app'`:

```ts
  'settings.about': 'About',
  'about.sources': 'The word list is built from these sources:',
  'about.ownList': 'This word list was prepared by Wordado.',
  'about.unavailable': 'The word data’s sources appear here once the app has been online.',
```

In `web/src/i18n/bg.ts`, at the same place:

```ts
  'settings.about': 'За приложението',
  'about.sources': 'Речникът е съставен по данни от тези източници:',
  'about.ownList': 'Този речник е съставен от Wordado.',
  'about.unavailable': 'Източниците на речника се показват тук, след като приложението е било онлайн.',
```

In `web/src/styles.css`, next to the settings styles, add `.credits { padding-inline-start: 1.25rem; }`, or reuse an existing list class if the settings already style lists.

- [ ] **Step 4: Run them and see them pass**

Run: `cd web && npx vitest run src/app/credits.test.ts src/settings/AboutSettings.test.tsx src/screens/Settings.test.tsx src/i18n && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. `pnpm typecheck` also fails in `web/src/main.tsx`, because `Root`'s services now need `credits`. That wiring is Task 6's step 3; to keep this task green, add the minimal wiring now:

```ts
import { Credits } from './app/credits'
import { fetchSibling } from './content/siblings'
import { validateCredits } from '@wordado/core'
const credits = new Credits({ storage: browserStorage('localStorage'), fetch: (url) => fetchSibling(url, 'credits.json', validateCredits) })
```

Also pass `credits` in `<Root services={{ …, credits }} />`. Task 6 adds the trigger that calls `credits.refresh`.

- [ ] **Step 5: Commit**

```bash
git add web
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(web): Settings › About shows the word data's attributions"
```

---

### Task 6: Web: telling the learner what they reported is fixed

**Files:**
- Create: `web/src/app/fixNotices.ts`, `web/src/app/fixNotices.test.ts`, `web/src/app/contentFiles.ts`, `web/src/app/contentFiles.test.ts`
- Modify: `web/src/app/Banners.tsx`, `web/src/app/Banners.test.tsx`, `web/src/app/context.tsx`, `web/src/test/fixtures.tsx`, `web/src/main.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`

**Interfaces:**
- Consumes: `fixedReports`, `FixesFile`, `ReportRecord`, `FixedField`, `parseWordId`, `Corpus` from `@wordado/core`. `Client.reports()` (Task 3). `fetchSibling` (Task 4). `Credits` (Task 5). `KeyValue`. `manifestUrlFor` from `web/src/content/packs.ts:12`.
- Produces:
  - `FIXES_SEEN_KEY = 'wordado.fixes-seen'`
  - `interface FixNotice { readonly reportKey: string; readonly field: FixedField; readonly headword: string | null }`
  - `interface FixSource { reports(): Promise<readonly ReportRecord[]>; readonly snapshot: { readonly packVersion: number | null; readonly corpus: Corpus | null } }`
  - `class FixNotices { readonly store: Store<readonly FixNotice[]>; constructor(deps: { storage: KeyValue; fetchFixes(manifestUrl: string): Promise<FixesFile | null> }); check(source: FixSource, manifestUrl: string): Promise<void>; dismiss(): void }`
  - `type FixNoticesPort = Pick<FixNotices, 'store' | 'dismiss'>`, `AppServices.fixNotices`
  - `watchContentFiles(target: { readonly store: Store<{ readonly packVersion: number | null }> }, run: () => void): () => void`
  - `fakeFixNotices(notices?: readonly FixNotice[]): FixNoticesPort & { dismissed: number }`

- [ ] **Step 1: Write the failing tests**

`web/src/app/fixNotices.test.ts`:

```ts
import type { Corpus, CorpusEntry, FixesFile, ReportRecord } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { memoryStorage } from '../account/storage'
import { FIXES_SEEN_KEY, FixNotices, type FixSource } from './fixNotices'

const URL_ = 'https://content.wordado.com/manifest.json'
const fixes: FixesFile = { schema_version: 1, corpus_version: 2, fixes: [{ word_id: 'c:bank-1', field: 'translation', fixed_in: 2 }, { word_id: 'c:gone-1', field: 'audio', fixed_in: 2 }] }
const bank = { entryId: 'bank-1', headword: 'bank' } as CorpusEntry
const corpus = { entries: new Map([['bank-1', bank]]) } as unknown as Corpus
const source = (reports: ReportRecord[], packVersion: number | null = 2): FixSource => ({ reports: async () => reports, snapshot: { packVersion, corpus } })
const r = (key: string, wordId: string, field: ReportRecord['field']): ReportRecord => ({ key, wordId, field, packVersion: 1 })

describe('FixNotices', () => {
  it('lists each fixed report with its word, or no word when the corpus no longer has it', async () => {
    const notices = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation'), r('k2', 'c:gone-1', 'audio'), r('k3', 'c:bank-1', 'other')]), URL_)
    expect(notices.store.get()).toEqual([
      { reportKey: 'k1', field: 'translation', headword: 'bank' },
      { reportKey: 'k2', field: 'audio', headword: null },
    ])
  })

  it('once dismissed, never tells the same report again, even after a reload; a new fix still shows', async () => {
    const storage = memoryStorage()
    const first = new FixNotices({ storage, fetchFixes: async () => fixes })
    await first.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    first.dismiss()
    expect(first.store.get()).toEqual([])
    expect(JSON.parse(storage.getItem(FIXES_SEEN_KEY)!)).toEqual(['k1'])
    const reloaded = new FixNotices({ storage, fetchFixes: async () => fixes })
    await reloaded.check(source([r('k1', 'c:bank-1', 'translation'), r('k2', 'c:gone-1', 'audio')]), URL_)
    expect(reloaded.store.get().map((n) => n.reportKey)).toEqual(['k2'])
  })

  it('keeps what it shows when fixes.json cannot be fetched, and shows nothing before a pack is active', async () => {
    const notices = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    const offline = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => null })
    await offline.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    expect(offline.store.get()).toEqual([])
    const early = new FixNotices({ storage: memoryStorage(), fetchFixes: async () => fixes })
    await early.check(source([r('k1', 'c:bank-1', 'translation')], null), URL_)
    expect(early.store.get()).toEqual([])
  })

  it('remembers at most the newest 500 told reports', async () => {
    const storage = memoryStorage()
    storage.setItem(FIXES_SEEN_KEY, JSON.stringify(Array.from({ length: 500 }, (_, i) => `old${i}`)))
    const notices = new FixNotices({ storage, fetchFixes: async () => fixes })
    await notices.check(source([r('k1', 'c:bank-1', 'translation')]), URL_)
    notices.dismiss()
    const seen = JSON.parse(storage.getItem(FIXES_SEEN_KEY)!) as string[]
    expect(seen).toHaveLength(500)
    expect(seen.at(-1)).toBe('k1')
    expect(seen[0]).toBe('old1')
  })
})
```

`web/src/app/contentFiles.test.ts`:

```ts
import { createStore } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { watchContentFiles } from './contentFiles'

describe('watchContentFiles', () => {
  it('runs at once, then each time the active corpus version changes, until stopped', () => {
    const store = createStore<{ packVersion: number | null }>({ packVersion: 1 })
    let runs = 0
    const stop = watchContentFiles({ store }, () => (runs += 1))
    expect(runs).toBe(1)
    store.set({ packVersion: 1 })
    expect(runs).toBe(1)
    store.set({ packVersion: 2 })
    expect(runs).toBe(2)
    stop()
    store.set({ packVersion: 3 })
    expect(runs).toBe(2)
  })
})
```

In `web/src/app/Banners.test.tsx`, add these in its existing style (it renders `<Banners />` with `renderWith`):

```tsx
  it('tells the learner that the one thing they reported is fixed, naming the word, and dismisses it', async () => {
    const ctx = await setup()
    const fixNotices = fakeFixNotices([{ reportKey: 'k1', field: 'translation', headword: 'bank' }])
    renderWith(<Banners />, { ...ctx, fixNotices })
    expect(screen.getByText('You reported the translation of “bank”. It is fixed now. Thank you!')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(fixNotices.dismissed).toBe(1)
  })

  it('counts several fixed reports, or one whose word is gone', async () => {
    const ctx = await setup()
    renderWith(<Banners />, { ...ctx, fixNotices: fakeFixNotices([{ reportKey: 'k1', field: 'audio', headword: null }]) })
    expect(screen.getByText('We fixed 1 thing you reported. Thank you!')).toBeTruthy()
  })
```

Import `fireEvent` and `screen` from `@testing-library/react`, and `fakeFixNotices` from `../test/fixtures`, if the file does not already.

- [ ] **Step 2: Run them and see them fail**

Run: `cd web && npx vitest run src/app/fixNotices.test.ts src/app/contentFiles.test.ts src/app/Banners.test.tsx`
Expected: FAIL: the modules and `fakeFixNotices` do not exist.

- [ ] **Step 3: Implement**

`web/src/app/fixNotices.ts`:

```ts
import { createStore, type Store } from '@wordado/client-data'
import { fixedReports, isWordId, parseWordId, type Corpus, type FixedField, type FixesFile, type ReportRecord } from '@wordado/core'
import type { KeyValue } from '../account/storage'

/** The reports this device has already told the learner are fixed (plan 8b, Decision 5). */
export const FIXES_SEEN_KEY = 'wordado.fixes-seen'
const MAX_SEEN = 500

export interface FixNotice {
  readonly reportKey: string
  readonly field: FixedField
  /** The word as the active corpus names it, or null when it no longer has it. */
  readonly headword: string | null
}

export interface FixSource {
  reports(): Promise<readonly ReportRecord[]>
  readonly snapshot: { readonly packVersion: number | null; readonly corpus: Corpus | null }
}

export interface FixNoticesDeps {
  readonly storage: KeyValue
  fetchFixes(manifestUrl: string): Promise<FixesFile | null>
}

/** "Something you reported has been fixed" (spec §8.10). */
export class FixNotices {
  readonly store: Store<readonly FixNotice[]> = createStore<readonly FixNotice[]>([])

  constructor(private readonly deps: FixNoticesDeps) {}

  private seen(): string[] {
    try {
      const raw = this.deps.storage.getItem(FIXES_SEEN_KEY)
      const value: unknown = raw === null ? [] : JSON.parse(raw)
      return Array.isArray(value) ? value.filter((k): k is string => typeof k === 'string') : []
    } catch {
      return []
    }
  }

  /** Fetches fixes.json beside `manifestUrl` and lists the learner's fixed reports not yet told; keeps its state on a failed fetch. */
  async check(source: FixSource, manifestUrl: string): Promise<void> {
    const fixes = await this.deps.fetchFixes(manifestUrl)
    if (fixes === null) return
    const told = new Set(this.seen())
    const { packVersion, corpus } = source.snapshot
    const matched = fixedReports(await source.reports(), fixes, packVersion).filter((m) => !told.has(m.report.key))
    this.store.set(
      matched.map(({ report, fix }) => {
        // Corpus entries are keyed by entry ID, without the `c:` prefix (core/src/types.ts:49).
        const parsed = isWordId(report.wordId) ? parseWordId(report.wordId) : null
        const entry = parsed?.kind === 'corpus' ? corpus?.entries.get(parsed.key) : undefined
        return { reportKey: report.key, field: fix.field, headword: entry?.headword ?? null }
      }),
    )
  }

  /** The learner saw them: never tell these again on this device. */
  dismiss(): void {
    const shown = this.store.get().map((n) => n.reportKey)
    if (shown.length === 0) return
    const kept = [...this.seen().filter((k) => !shown.includes(k)), ...shown].slice(-MAX_SEEN)
    try {
      this.deps.storage.setItem(FIXES_SEEN_KEY, JSON.stringify(kept))
    } catch {
      // A private window may refuse storage: the notice may then come back next visit.
    }
    this.store.set([])
  }
}

export type FixNoticesPort = Pick<FixNotices, 'store' | 'dismiss'>
```

`web/src/app/contentFiles.ts`:

```ts
import type { Store } from '@wordado/client-data'

/**
 * Runs `run` now, and whenever the active corpus version changes (plan 8b, Decision 6): the credits and the
 * fixes follow the pack the learner has, like the audio cache does (`refreshAudioOnActivation`).
 */
export function watchContentFiles(target: { readonly store: Store<{ readonly packVersion: number | null }> }, run: () => void): () => void {
  let version = target.store.get().packVersion
  run()
  return target.store.subscribe(() => {
    const { packVersion } = target.store.get()
    if (packVersion === version) return
    version = packVersion
    run()
  })
}
```

In `web/src/app/Banners.tsx`, render `<FixBanner />` right after the account notice block, and add:

```tsx
/** "Something you reported has been fixed" (spec §8.10): one banner, dismissed once. */
function FixBanner() {
  const { t } = useT()
  const { fixNotices } = useApp()
  const notices = useStore(fixNotices.store)
  if (notices.length === 0) return null
  const only = notices.length === 1 ? notices[0]! : null
  return (
    <div className="banner notice-line" role="status">
      <p>
        {only?.headword
          ? t('fixed.one', { field: t(FIELD[only.field]), word: only.headword })
          : t('fixed.some', { count: notices.length })}
      </p>
      <button type="button" className="link-button" onClick={() => fixNotices.dismiss()}>
        {t('notice.dismiss')}
      </button>
    </div>
  )
}

const FIELD: Readonly<Record<FixedField, MessageKey>> = {
  translation: 'fixed.field.translation',
  example: 'fixed.field.example',
  audio: 'fixed.field.audio',
  level: 'fixed.field.level',
}
```

Import `type FixedField` from `@wordado/core`.

In `web/src/app/context.tsx`, import `type FixNoticesPort` from `./fixNotices` and add this to `AppServices`:

```ts
  /** What the learner reported that is fixed now (spec §8.10). */
  readonly fixNotices: FixNoticesPort
```

In `web/src/test/fixtures.tsx`:
- Add `readonly fixNotices?: FixNoticesPort` to `RenderContext`.
- Add `fixNotices: ctx.fixNotices ?? fakeFixNotices(),` to `renderWith`'s value.
- Add:

```ts
/** Fix notices as the banner sees them; counts dismissals. */
export function fakeFixNotices(notices: readonly FixNotice[] = []): FixNoticesPort & { dismissed: number } {
  const store = createStore<readonly FixNotice[]>(notices)
  const port = {
    store,
    dismissed: 0,
    dismiss() {
      port.dismissed += 1
      store.set([])
    },
  }
  return port
}
```

Strings. In `web/src/i18n/en.ts`, next to `'notice.dismiss'`:

```ts
  'fixed.one': 'You reported the {field} of “{word}”. It is fixed now. Thank you!',
  'fixed.some': { one: 'We fixed {count} thing you reported. Thank you!', other: 'We fixed {count} things you reported. Thank you!' },
  'fixed.field.translation': 'translation',
  'fixed.field.example': 'example sentence',
  'fixed.field.audio': 'pronunciation',
  'fixed.field.level': 'level',
```

In `web/src/i18n/bg.ts`:

```ts
  'fixed.one': 'Съобщихте за проблем с {field} на „{word}“. Вече е поправен. Благодарим!',
  'fixed.some': { one: 'Поправихме {count} проблем, за който съобщихте. Благодарим!', other: 'Поправихме {count} проблема, за които съобщихте. Благодарим!' },
  'fixed.field.translation': 'превода',
  'fixed.field.example': 'примерното изречение',
  'fixed.field.audio': 'произношението',
  'fixed.field.level': 'нивото',
```

In `web/src/main.tsx`:
- Import `validateFixes` from `@wordado/core`, `FixNotices` from `./app/fixNotices`, and `watchContentFiles` from `./app/contentFiles`.
- Next to the `credits` created in Task 5, add:

```ts
const fixNotices = new FixNotices({ storage: browserStorage('localStorage'), fetchFixes: (url) => fetchSibling(url, 'fixes.json', validateFixes) })

// The credits and "your report was fixed" follow the pack the learner has (plan 8b, Decision 6).
let stopContentWatch: (() => void) | null = null
boot.store.subscribe(() => {
  const state = boot.store.get()
  stopContentWatch?.()
  stopContentWatch =
    state.status === 'ready'
      ? watchContentFiles(state.client, () => {
          const manifestUrl = manifestUrlFor(state.account)
          void credits.refresh(manifestUrl).catch(() => undefined)
          void fixNotices.check(state.client, manifestUrl).catch(() => undefined)
        })
      : null
})
```

- Pass `fixNotices` in `<Root services={{ …, credits, fixNotices }} />`.

- [ ] **Step 4: Run them and see them pass**

Run: `cd web && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS, including `i18n.test.tsx` (same keys and placeholders in both languages).

- [ ] **Step 5: Commit**

```bash
git add web
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "feat(web): tell the learner when something they reported is fixed"
```

---

### Task 7: End to end, and publishing v1's credits

**Files:**
- Modify: `web/e2e/demo.spec.ts`
- Operations: the content repository `wordado/wordado-content` (its workflow copy), and one run of Actions › Corpus › `credits`.

- [ ] **Step 1: Write the failing e2e test**

In `web/e2e/demo.spec.ts`, next to the privacy-page test (~line 77), in its style:

```ts
test('Settings › About says the demo’s word list is Wordado’s own, from the bundled sample’s credits', async ({ page }) => {
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
  await expect(page.getByText('This word list was prepared by Wordado.')).toBeVisible()
})
```

If the demo spec needs a step to open the demo before visiting `/settings`, use the same helper the other settings tests in that file use. If the app starts in Bulgarian there, match `За приложението` and `Този речник е съставен от Wordado.` instead.

- [ ] **Step 2: Run it**

Run: `pnpm --filter @wordado/web e2e`
Expected: PASS once Tasks 2 and 5 are in, because the sample now serves `credits.json`. If it fails because `credits.json` is not served, check that `web/vite/samplePack.ts` copies every sample file except `source.json`.

- [ ] **Step 3: Full check and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

```bash
git add web/e2e/demo.spec.ts
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "test(web): the demo's About section, end to end"
```

Open the pull request, and merge it after CI passes (and after the product owner's approval).

- [ ] **Step 4: Publish v1's credits (after the merge; the product owner runs or approves each step)**

1. Move `PIPELINE_REF` to the merge: `gh variable set PIPELINE_REF -R wordado/wordado-content --body "$(git rev-parse origin/main)"`.
2. Copy the new workflow into the content repository. It is a copy of `pipeline/template/.github/workflows/corpus.yml`:
   ```bash
   cd ~/code/projects/cc/wordado/content && git checkout -b workflow/credits origin/main
   cp ../pipeline/template/.github/workflows/corpus.yml .github/workflows/corpus.yml
   git add .github/workflows/corpus.yml
   git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -m "workflow: the credits action, and credits.json at every release"
   git push -u origin workflow/credits && gh pr create --fill
   ```
   Merge it.
3. Run it: `gh workflow run corpus.yml -R wordado/wordado-content -f action=credits`, and watch it pass.
4. Check: `curl -s https://content.wordado.com/credits.json` shows `corpus_version: 1` and the FineWeb and Google Books attributions from `content/sources.json`.
5. After the web deploy, sign in on wordado.com and open Settings. **About** lists both attributions.

---

## Self-review

- **Spec coverage.**
  - §8.10 ("the reporter is told … when something they reported has been fixed") is Tasks 1, 3, 4 and 6.
  - The attributions required by the sources' licences (plan 8 Decision 3's handover, the roadmap's plan 8b line) are Tasks 1, 2, 5 and 7.
  - §11.2 (both languages) is the strings in Tasks 5 and 6, checked by `i18n.test.tsx`.
  - §9.1 (offline) is the cached credits in Task 5, and fetch failures that keep state in Tasks 4 and 6.
- **Types across tasks.**
  - `CreditsFile`, `validateCredits`, `FixesFile`, `validateFixes`, `FixedField`, `ReportRecord` and `fixedReports` are defined in Task 1 and used under those names in Tasks 2–6.
  - `fetchSibling(manifestUrl, name, validate, fetchFn?)` is defined in Task 4 and used in Tasks 5 and 6.
  - `Client.reports()` is defined in Task 3 and used through `FixSource.reports()` in Task 6.
  - `CreditsPort` and `FixNoticesPort` are defined in Tasks 5 and 6 and added to `AppServices` and `renderWith`.
- **Checked against the code.**
  - `parseWordId` returns `{ kind: 'corpus' | 'user'; key }` and throws on an invalid ID, so Task 6 checks `isWordId` first.
  - `createStore` has `get`, `set` and `subscribe`.
  - `manifestBase`'s `page` defaults when undefined.
  - `Plural` is `{ one, other }`.
  - `memoryStorage()` is exported from `web/src/account/storage.ts:27`.
