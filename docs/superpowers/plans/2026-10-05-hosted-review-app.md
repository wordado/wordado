# Hosted Review App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the review app online at `review.wordado.com`: invited native reviewers sign in by email, review the
rows assigned to them, and each Submit opens a pull request in wordado-content.

**Architecture:** A snapshot builder (Node, reusing the local app's row model) turns the content repository's open
review files into JSON that a content-repo workflow uploads to a private R2 bucket. A separate Worker
(`wordado-review`, Hono) serves the existing React UI plus hosted screens, checks the Cloudflare Access JWT, keeps
reviewers, assignments, decisions and submissions in D1, writes decisions into review files with the same pure
function the local app uses, and commits them through a GitHub App. Resend sends invites and submit notices.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7 (strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`verbatimModuleSyntax`), Vitest 5, React 19, Vite 8, Playwright 1.63, Hono 4.13, Wrangler 4.136 (D1, R2, static
assets, `getPlatformProxy` for tests), WebCrypto for RS256 and HMAC, oxlint `--deny-warnings`.

**Spec:** `docs/superpowers/specs/2026-10-05-hosted-review-app-design.md` (builds on
`docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`).

## Global Constraints

- All new code lives in `review-app/` (package `@wordado/review-app`), except the CI/deploy workflows in
  `.github/workflows/` and the content-repo workflow templates in `pipeline/template/.github/workflows/`.
- New dependencies: `hono` (^4.13.8) as a dependency and `wrangler` (^4.136.3) as a dev dependency of
  `@wordado/review-app`. Nothing else: no JWT, GitHub or Resend SDKs (WebCrypto and `fetch` only).
- Worker code (`review-app/worker/**`, `review-app/shared/**`) must not import `node:*` modules or any module that
  does (`@wordado/pipeline/csv` and `@wordado/core` are fine; `@wordado/pipeline/aiReview/store`, `queues`, `files`,
  `checksum` are not).
- The local review app keeps working unchanged: its unit tests and `review-app/e2e/review.spec.ts` stay green.
- No real email addresses in the repository. Test and fixture addresses use `example.com`. The production admin
  email is a Worker **secret** (`ADMIN_EMAIL`), never in `wrangler.jsonc`.
- No corpus content in the repository: fixtures come from `@wordado/pipeline/testing/fixture`.
- Secrets (`GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ADMIN_EMAIL`) are set by the
  operator in the Cloudflare dashboard; R2 keys for the content repo in its GitHub settings. Never in code or chat.
- Mail sender: `Wordado Review <review@wordado.com>`. Production origin: `https://review.wordado.com`.
- Commits use `11029931+danchom@users.noreply.github.com`.
- New screens use the web app's Settings look (panel sections, settings rows, segmented controls).
- Run `pnpm lint` and `pnpm --filter @wordado/review-app typecheck` before every commit; both must be clean.

## Review Focus

1. **The file on `main` changed between snapshot and Submit** (another pull request merged): only the changed rows
   are left out as `changed`; the rest go into the pull request. Test in Task 10.
2. **A reviewer name that is not ASCII** (`Анна Петрова`) or has quotes: the branch slug falls back to the email's
   local part, the commit author keeps the real name, and the import workflow passes it quoted. Tests in Task 10
   and Task 15.
3. **A new snapshot arrives mid-session:** a decision whose row changed is shown as changed (not silently kept); a
   decision whose row disappeared is discarded and named in `discarded`. Test in Task 5.
4. **Cells and notes with commas, quotes, newlines and Cyrillic** survive `applyDecisions` byte-for-byte through
   the CSV round trip. Test in Task 1.
5. **Email case:** an invite for `Anna@Example.com` and an Access token for `anna@example.com` are the same
   reviewer. Test in Task 4.

---

## File structure

```
review-app/
  shared/                       pure, Worker-safe
    apply.ts        applyDecisions, invalidDecision, ACTIONS, QueueRules, CsvDecision
    rowHash.ts      rowHash (WebCrypto) == pipeline's rowContent
    snapshot.ts     snapshot types and R2 key helpers
    hosted.ts       hosted API types (Me, AssignmentView, HostedRow, ...), LANGUAGES, languageOf
  server/
    snapshot.ts     buildSnapshot (Node)          server/snapshotMain.ts  CLI
    model.ts        + rowHash on RowView, + allRows(dir, queue)
    decisions.ts    saveDecision writes through applyDecisions
  worker/
    index.ts        Worker entry
    bindings.ts     Env and the D1/R2 shapes we use
    app.ts          createApp(deps): request rules, auth, routes
    b64.ts          base64url helpers
    access.ts       Access JWT verification, key source
    db.ts           D1 data layer
    snapshotStore.ts current snapshot from R2, cached
    rows.ts         assignment rows, progress
    assign.ts       overlap, split (pure)
    mail.ts         Resend / log mailer
    github.ts       GitHub App client, webhook signature
    submit.ts       Submit
    routes/{me,reviewer,decision,admin,reviewers,submit}.ts
    test/{platform,jwt,fakeGitHub}.ts
  migrations/0001_init.sql
  wrangler.jsonc
  scripts/check-config.ts
  src/
    ReviewScreen.tsx   extracted from App.tsx (shared by local and hosted)
    Root.tsx           local or hosted, from GET /api/me
    hosted/{HostedApp,Assignments,AssignmentReview,Admin,AdminReviewers,AdminAssignments,AdminSubmissions}.tsx
    hostedApi.ts
  e2e/hosted/{start.ts,hosted.spec.ts}   playwright.hosted.config.ts
.github/workflows/{ci.yml,deploy-review.yml}
pipeline/template/.github/workflows/{review-snapshot.yml,review-import.yml}
```

---

### Task 1: Shared pure modules and the decision-writing split

**Files:**
- Create: `review-app/shared/apply.ts`, `review-app/shared/rowHash.ts`, `review-app/shared/snapshot.ts`,
  `review-app/shared/hosted.ts`
- Create: `review-app/shared/apply.test.ts`, `review-app/shared/rowHash.test.ts`, `review-app/shared/hosted.test.ts`
- Modify: `review-app/server/decisions.ts` (write through `applyDecisions`)
- Modify: `review-app/vitest.config.ts` (a `shared` project), `review-app/tsconfig.json` (include `shared`)

**Interfaces:**
- Produces:
  - `applyDecisions(text: string, rules: QueueRules, decisions: readonly CsvDecision[]): { text: string; applied: string[]; missing: string[] }`
  - `invalidDecision(rules: QueueRules, action: unknown): string | null`; `ACTIONS: readonly Action[]`
  - `interface QueueRules { columns: readonly string[]; verdicts: readonly string[] }`
  - `interface CsvDecision { key: string; action: Action; cells?: Readonly<Record<string, string>> | undefined; note?: string | undefined }`
  - `rowHash(queue: string, proposed: unknown, reopened: string): Promise<string>`
  - snapshot types `SnapshotPointer`, `SnapshotIndex`, `SnapshotQueue`, `SnapshotFileInfo`, `SnapshotFile`;
    `snapshotFileKey(id, file)`, `snapshotIndexKey(id)`, `CURRENT_KEY`
  - hosted types (below), `LANGUAGES`, `LANGUAGE_NAMES`, `languageOf(queue)`

- [ ] **Step 1: Write the failing tests**

`review-app/shared/apply.test.ts`:

```ts
import { formatCsv, csvRecords } from '@wordado/pipeline/csv'
import { describe, expect, it } from 'vitest'
import { applyDecisions, invalidDecision } from './apply'

const rules = { columns: ['translation', 'alternates', 'sense'], verdicts: ['ok', 'drop'] }
const csv = formatCsv([
  ['key', 'verdict', 'translation', 'alternates', 'sense', 'headword', 'note'],
  ['bank-1', '', 'банка', '', 'финансова институция', 'bank', ''],
  ['bank-2', '', 'банка', '', '', 'bank', 'old note'],
])

describe('applyDecisions', () => {
  it('writes cells, verdict and note for each decision, and leaves other rows alone', () => {
    const out = applyDecisions(csv, rules, [
      { key: 'bank-2', action: 'accept', cells: { translation: 'бряг' }, note: '' },
      { key: 'bank-1', action: 'drop', note: 'duplicate' },
    ])
    const rows = csvRecords(out.text).rows
    expect(rows[0]).toMatchObject({ key: 'bank-1', verdict: 'drop', translation: 'банка', note: 'duplicate' })
    expect(rows[1]).toMatchObject({ key: 'bank-2', verdict: 'ok', translation: 'бряг', note: 'old note' })
    expect(out.applied).toEqual(['bank-2', 'bank-1'])
    expect(out.missing).toEqual([])
  })

  it('ignores cells outside the queue columns', () => {
    const out = applyDecisions(csv, rules, [{ key: 'bank-1', action: 'edit', cells: { headword: 'BANK', sense: 'пари' } }])
    expect(csvRecords(out.text).rows[0]).toMatchObject({ headword: 'bank', sense: 'пари', verdict: 'ok' })
  })

  it('reports keys with no row and returns the text unchanged when nothing applied', () => {
    const out = applyDecisions(csv, rules, [{ key: 'nope-1', action: 'keep' }])
    expect(out).toEqual({ text: csv, applied: [], missing: ['nope-1'] })
  })

  it('round-trips commas, quotes, newlines and Cyrillic exactly', () => {
    const tricky = 'а, "б"\nв'
    const out = applyDecisions(csv, rules, [{ key: 'bank-1', action: 'edit', cells: { alternates: tricky }, note: tricky }])
    const row = csvRecords(out.text).rows[0]!
    expect(row['alternates']).toBe(tricky)
    expect(row['note']).toBe(tricky)
  })
})

describe('invalidDecision', () => {
  it('refuses unknown actions and drop where the queue has none', () => {
    expect(invalidDecision(rules, 'keep')).toBeNull()
    expect(invalidDecision(rules, 'zap')).toMatch(/not accept, keep, edit or drop/)
    expect(invalidDecision({ columns: [], verdicts: ['ok'] }, 'drop')).toMatch(/no drop/)
  })
})
```

`review-app/shared/rowHash.test.ts`:

```ts
import { rowContent } from '@wordado/pipeline/aiReview/store'
import { describe, expect, it } from 'vitest'
import { rowHash } from './rowHash'

describe('rowHash', () => {
  it('equals the AI-review store key for the same row', async () => {
    const proposed = { translation: 'бряг', alternates: ['брегът'], sense: 'на река' }
    expect(await rowHash('translation-bg', proposed, '1 report: odd')).toBe(rowContent('translation-bg', proposed, '1 report: odd'))
    expect(await rowHash('level', 'B2', '')).toBe(rowContent('level', 'B2', ''))
  })
})
```

`review-app/shared/hosted.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { languageOf } from './hosted'
import { snapshotFileKey } from './snapshot'

describe('languageOf', () => {
  it('maps queues to the language a reviewer needs', () => {
    expect(languageOf('translation-bg')).toBe('bg')
    expect(languageOf('title-es')).toBe('es')
    expect(languageOf('level')).toBe('en')
    expect(languageOf('english')).toBeNull()
    expect(languageOf('translation-fr')).toBeNull()
  })
})

describe('snapshotFileKey', () => {
  it('maps a review file to its JSON under the snapshot', () => {
    expect(snapshotFileKey('abc', 'review/translation-de/2026-10-03-01.csv')).toBe('snapshots/abc/translation-de/2026-10-03-01.json')
  })
})
```

- [ ] **Step 2: Add the `shared` test project and run the tests to see them fail**

In `review-app/vitest.config.ts` add `{ test: { name: 'shared', include: ['shared/**/*.test.ts'], environment: 'node' } }`
to `projects`; in `review-app/tsconfig.json` add `"shared"` to `include`.

Run: `pnpm --filter @wordado/review-app test -- --project shared`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`review-app/shared/apply.ts`:

```ts
import { csvRecords, formatCsv } from '@wordado/pipeline/csv'
import type { Action } from '../server/types'

export const ACTIONS: readonly Action[] = ['accept', 'keep', 'edit', 'drop']

/** What one queue lets a reviewer write (queueSpecs; the snapshot index carries the same values). */
export interface QueueRules {
  readonly columns: readonly string[]
  readonly verdicts: readonly string[]
}

export interface CsvDecision {
  readonly key: string
  readonly action: Action
  readonly cells?: Readonly<Record<string, string>> | undefined
  readonly note?: string | undefined
}

/**
 * Writes decisions into a review file's text as a reviewer editing the CSV would: the queue's editable cells, the
 * verdict (`drop` or `ok`) and the note (an empty note keeps the one there). Pure, so the Worker bundles it too
 * (spec 2026-10-05 §7.1).
 */
export function applyDecisions(text: string, rules: QueueRules, decisions: readonly CsvDecision[]): { text: string; applied: string[]; missing: string[] } {
  const { header, rows } = csvRecords(text)
  const byKey = new Map(rows.map((r) => [(r['key'] ?? '').trim(), r]))
  const applied: string[] = []
  const missing: string[] = []
  for (const d of decisions) {
    const row = byKey.get(d.key)
    if (!row) {
      missing.push(d.key)
      continue
    }
    for (const col of rules.columns) if (d.cells && col in d.cells) row[col] = d.cells[col] ?? ''
    row['verdict'] = d.action === 'drop' ? 'drop' : 'ok'
    if (d.note !== undefined && d.note !== '') row['note'] = d.note
    applied.push(d.key)
  }
  if (applied.length === 0) return { text, applied, missing }
  return { text: formatCsv([header, ...rows.map((r) => header.map((c) => r[c] ?? ''))]), applied, missing }
}

/** Why no decision with this action can be written to the queue, or null. */
export function invalidDecision(rules: QueueRules, action: unknown): string | null {
  if (!(ACTIONS as readonly unknown[]).includes(action)) return `${String(action)} is not accept, keep, edit or drop`
  if (action === 'drop' && !rules.verdicts.includes('drop')) return 'this queue has no drop'
  return null
}
```

`review-app/shared/rowHash.ts`:

```ts
import { canonicalJson } from '@wordado/core'

/** The pipeline's rowContent (aiReview/store.ts), with WebCrypto instead of node:crypto, for the Worker. */
export async function rowHash(queue: string, proposed: unknown, reopened: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson({ queue, proposed, reopened })))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

`review-app/shared/snapshot.ts`:

```ts
import type { RowView } from '../server/types'
import type { Language } from './hosted'

export const CURRENT_KEY = 'current.json'

export interface SnapshotPointer {
  readonly id: string
  readonly built: string
  readonly commit: string
}
export interface SnapshotFileInfo {
  readonly file: string
  readonly rows: number
  readonly flagged: number
  readonly reported: number
}
export interface SnapshotQueue {
  readonly queue: string
  readonly language: Language
  readonly columns: readonly string[]
  readonly verdicts: readonly string[]
  readonly files: readonly SnapshotFileInfo[]
}
export interface SnapshotIndex extends SnapshotPointer {
  readonly queues: readonly SnapshotQueue[]
}
export interface SnapshotFile {
  readonly file: string
  readonly version: string
  readonly rows: readonly RowView[]
}

export const snapshotIndexKey = (id: string) => `snapshots/${id}/index.json`
/** review/<queue>/<stem>.csv → snapshots/<id>/<queue>/<stem>.json */
export const snapshotFileKey = (id: string, file: string) => `snapshots/${id}/${file.replace(/^review\//, '').replace(/\.csv$/, '.json')}`
```

`review-app/shared/hosted.ts`:

```ts
import type { Action, RowView } from '../server/types'

export type Language = 'bg' | 'de' | 'es' | 'en'
export const LANGUAGES: readonly Language[] = ['bg', 'de', 'es', 'en']
export const LANGUAGE_NAMES: Readonly<Record<Language, string>> = { bg: 'Bulgarian', de: 'German', es: 'Spanish', en: 'English levels' }
export type Role = 'reviewer' | 'admin'

/** The language a reviewer needs for a queue: translation-<l1> and title-<l1> need l1, level needs en; null for queues the hosted app does not serve. */
export function languageOf(queue: string): Language | null {
  if (queue === 'level') return 'en'
  const m = /^(?:translation|title)-([a-z]{2})$/.exec(queue)
  const l = m?.[1]
  return l && (LANGUAGES as readonly string[]).includes(l) && l !== 'en' ? (l as Language) : null
}

export interface Me {
  readonly email: string
  readonly name: string
  readonly role: Role
  readonly languages: readonly Language[]
}

export interface Progress {
  readonly inScope: number
  readonly decided: number
  readonly changed: number
  readonly submitted: number
  readonly merged: number
  readonly remaining: number
}

export interface AssignmentView {
  readonly id: number
  readonly reviewer: string
  readonly reviewerName: string
  readonly queue: string
  readonly files: readonly string[] | '*'
  readonly flaggedOnly: boolean
  readonly createdAt: string
  readonly closedAt: string | null
  readonly progress: Progress | null
}

export interface HostedDecision {
  readonly action: Action
  readonly cells: Readonly<Record<string, string>>
  readonly note: string
  readonly submission: number | null
  /** the row changed in a newer snapshot since this decision */
  readonly changed: boolean
}
export interface HostedRow extends RowView {
  readonly decision: HostedDecision | null
}
export interface RowsResponse {
  readonly rows: readonly HostedRow[]
  readonly discarded: readonly string[]
}

export interface HostedDecisionRequest {
  readonly assignment: number
  readonly queue: string
  readonly file: string
  readonly key: string
  readonly rowHash: string
  readonly action: Action
  readonly cells?: Record<string, string>
  readonly note?: string
}

export interface SubmitResult {
  readonly pr: number
  readonly url: string
  readonly count: number
  readonly leftOut: readonly { readonly key: string; readonly reason: 'changed' | 'gone' }[]
}

export interface ReviewerView {
  readonly email: string
  readonly name: string
  readonly role: Role
  readonly languages: readonly Language[]
  readonly invitedAt: string
  readonly inviteSentAt: string | null
  readonly disabledAt: string | null
}

export interface SubmissionView {
  readonly id: number
  readonly assignment: number
  readonly reviewer: string
  readonly reviewerName: string
  readonly queue: string
  readonly branch: string
  readonly pr: number | null
  readonly url: string | null
  readonly count: number
  readonly leftOut: number
  readonly status: 'open' | 'merged' | 'closed'
  readonly createdAt: string
}

export interface SplitProposal {
  readonly reviewer: string
  readonly files: readonly string[]
  readonly rows: number
}

export interface SnapshotStatus {
  readonly id: string
  readonly built: string
  readonly commit: string
  readonly queues: readonly {
    readonly queue: string
    readonly language: Language
    readonly files: readonly { readonly file: string; readonly rows: number; readonly flagged: number; readonly reported: number; readonly assignedTo: string | null }[]
  }[]
}
```

In `review-app/server/decisions.ts`, keep every check `saveDecision` makes today (and its messages), and replace
only the write: after the version check,

```ts
  const out = applyDecisions(text, spec, [{ key: req.key, action: req.action, cells: req.cells, note: req.note }])
  if (out.applied.length === 0) return { ok: false, reason: 'gone', message: `${req.key} is no longer in ${req.file}` }
  writeFileSync(path, out.text)
  return { ok: true, version: fileVersion(out.text) }
```

Remove the now-unused `csvRecords`, `formatCsv` imports and the local `ACTIONS` (import `ACTIONS` from
`../shared/apply`).

- [ ] **Step 4: Run all review-app tests**

Run: `pnpm --filter @wordado/review-app test`
Expected: PASS, including the existing `server/decisions.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add review-app/shared review-app/server/decisions.ts review-app/vitest.config.ts review-app/tsconfig.json
git commit -m "feat(review-app): shared decision writing, row hash and hosted types"
```

---

### Task 2: The snapshot builder

**Files:**
- Modify: `review-app/server/types.ts` (`rowHash: string` on `RowView`), `review-app/server/model.ts`
- Create: `review-app/server/snapshot.ts`, `review-app/server/snapshotMain.ts`, `review-app/server/snapshot.test.ts`
- Modify: `review-app/package.json` (script `"snapshot": "tsx server/snapshotMain.ts"`)
- Modify: test fixtures that build `RowView` literals (`src/App.test.tsx`, `src/RowView.test.tsx`, any other):
  add `rowHash: 'h'`

**Interfaces:**
- Consumes: Task 1 snapshot types, `snapshotFileKey`, `snapshotIndexKey`, `CURRENT_KEY`, `languageOf`.
- Produces:
  - `RowView.rowHash: string` (the `content` hash `model.ts` already computes)
  - `allRows(dir: string, queue: string): RowView[]` in `model.ts` (unfiltered, file order, with other senses)
  - `buildSnapshot(dir: string, out: string, meta: { commit: string; built: string }): SnapshotIndex`
  - `snapshotId(commit: string, built: string): string` → `<7-char sha>-<yyyymmddThhmmZ>`
  - CLI: `pnpm --filter @wordado/review-app snapshot <content> <out> [--commit <sha>]`

- [ ] **Step 1: Write the failing test**

`review-app/server/snapshot.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rowContent } from '@wordado/pipeline/aiReview/store'
import { describe, expect, it } from 'vitest'
import { CURRENT_KEY, snapshotFileKey, snapshotIndexKey, type SnapshotFile, type SnapshotIndex } from '../shared/snapshot'
import { reviewFixture } from './fixture'
import { listRows } from './model'
import { buildSnapshot, snapshotId } from './snapshot'

describe('buildSnapshot', () => {
  it('writes an index, one JSON per review file and current.json last', async () => {
    const dir = await reviewFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: '3f2a91c0ffee', built: '2026-10-05T10:12:30Z' })
    expect(index.id).toBe('3f2a91c-20261005T1012Z')
    expect(JSON.parse(readFileSync(join(out, CURRENT_KEY), 'utf8'))).toEqual({ id: index.id, built: '2026-10-05T10:12:30Z', commit: '3f2a91c0ffee' })
    const onDisk = JSON.parse(readFileSync(join(out, snapshotIndexKey(index.id)), 'utf8')) as SnapshotIndex
    expect(onDisk).toEqual(index)
    const queues = index.queues.map((q) => q.queue)
    expect(queues).toContain('translation-bg')
    expect(queues).toContain('level')
    expect(queues).not.toContain('english')
    expect(queues).not.toContain('audio')
    const bg = index.queues.find((q) => q.queue === 'translation-bg')!
    expect(bg.language).toBe('bg')
    expect(bg.columns).toEqual(['translation', 'alternates', 'sense'])
    expect(bg.verdicts).toContain('drop')
    expect(index.queues.find((q) => q.queue === 'level')!.language).toBe('en')
    for (const f of bg.files) expect(existsSync(join(out, snapshotFileKey(index.id, f.file)))).toBe(true)
  })

  it('holds every row as the local app shows it, with its row hash', async () => {
    const dir = await reviewFixture()
    const out = mkdtempSync(join(tmpdir(), 'snap-'))
    const index = buildSnapshot(dir, out, { commit: 'abcdef1', built: '2026-10-05T00:00:00Z' })
    const bg = index.queues.find((q) => q.queue === 'translation-bg')!
    const rows = bg.files.flatMap((f) => (JSON.parse(readFileSync(join(out, snapshotFileKey(index.id, f.file)), 'utf8')) as SnapshotFile).rows)
    expect(rows.length).toBe(bg.files.reduce((n, f) => n + f.rows, 0))
    expect(bg.files.reduce((n, f) => n + f.flagged, 0)).toBe(rows.filter((r) => r.ai === 'flagged').length)
    const flaggedLocal = listRows(dir, 'translation-bg', { withUnflagged: false })
    for (const r of flaggedLocal) expect(rows.find((x) => x.key === r.key)).toEqual(r)
    const sample = rows[0]!
    expect(sample.rowHash).toMatch(/^[0-9a-f]{64}$/)
    expect(sample.rowHash).not.toBe(rowContent('translation-bg', 'something else', ''))
  })
})
```

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @wordado/review-app test -- --project server server/snapshot.test.ts`
Expected: FAIL (no `./snapshot`).

- [ ] **Step 3: Implement**

In `server/types.ts` add to `RowView`:

```ts
  /** rowContent(queue, proposed, reopened): what an AI verdict and a hosted decision are keyed on */
  rowHash: string
```

In `server/model.ts`, in the `out.push({...})` of `rowsOf`, add `rowHash: content,`. Add:

```ts
/** Every row of every open file of one queue, unfiltered, in file order: the snapshot's view (spec 2026-10-05 §4). */
export function allRows(dir: string, queue: string): RowView[] {
  return rowsOf(dir, queue, makeCtx(dir), { withOtherSenses: true })
}
```

`review-app/server/snapshot.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { readConfig } from '@wordado/pipeline/config'
import { queueSpecs } from '@wordado/pipeline/queues'
import { FIELDS, queueKind } from '@wordado/pipeline/aiReview/prompts'
import { languageOf } from '../shared/hosted'
import { CURRENT_KEY, snapshotFileKey, snapshotIndexKey, type SnapshotFile, type SnapshotIndex, type SnapshotQueue } from '../shared/snapshot'
import { allRows, fileVersion } from './model'
import { readFileSync } from 'node:fs'
import type { RowView } from './types'

/** <7-char sha>-<yyyymmddThhmmZ> */
export function snapshotId(commit: string, built: string): string {
  const d = new Date(built)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${commit.slice(0, 7)}-${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}Z`
}

function write(out: string, key: string, value: unknown): void {
  const path = join(out, key)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

/**
 * The rows of every open review file the hosted app serves (translation-<l1>, title-<l1>, level), as the local app
 * shows them, under snapshots/<id>/, then current.json pointing at it (spec 2026-10-05 §4).
 */
export function buildSnapshot(dir: string, out: string, meta: { commit: string; built: string }): SnapshotIndex {
  const id = snapshotId(meta.commit, meta.built)
  const specs = queueSpecs(readConfig(dir).l1s)
  const reviewDir = join(dir, 'review')
  const names = existsSync(reviewDir) ? readdirSync(reviewDir).sort() : []
  const queues: SnapshotQueue[] = []
  for (const queue of names) {
    const language = languageOf(queue)
    const spec = specs.get(queue)
    if (!language || !spec || !queueKind(queue) || !FIELDS[queueKind(queue)!]) continue
    const byFile = new Map<string, RowView[]>()
    for (const r of allRows(dir, queue)) byFile.set(r.file, [...(byFile.get(r.file) ?? []), r])
    if (byFile.size === 0) continue
    const files = [...byFile.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, rows]) => {
      const body: SnapshotFile = { file, version: fileVersion(readFileSync(join(dir, file), 'utf8')), rows }
      write(out, snapshotFileKey(id, file), body)
      return { file, rows: rows.length, flagged: rows.filter((r) => r.ai === 'flagged').length, reported: rows.filter((r) => r.reports !== '').length }
    })
    queues.push({ queue, language, columns: [...spec.columns], verdicts: [...spec.verdicts], files })
  }
  const index: SnapshotIndex = { id, built: meta.built, commit: meta.commit, queues }
  write(out, snapshotIndexKey(id), index)
  write(out, CURRENT_KEY, { id, built: meta.built, commit: meta.commit })
  return index
}
```

(Tidy the imports into one `node:fs` import when you write it; the block above lists what is needed.)

`review-app/server/snapshotMain.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildSnapshot } from './snapshot'

const argv = process.argv.slice(2)
const commitAt = argv.indexOf('--commit')
const commitArg = commitAt >= 0 ? argv[commitAt + 1] : undefined
const [contentArg, outArg] = argv.filter((a, i) => !a.startsWith('--') && i !== commitAt + 1)
if (!contentArg || !outArg || !existsSync(join(resolve(contentArg), 'pipeline.json'))) {
  console.error('usage: pnpm --filter @wordado/review-app snapshot <content-dir> <out-dir> [--commit <sha>]')
  process.exit(2)
}
const dir = resolve(contentArg)
const commit = commitArg ?? execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const index = buildSnapshot(dir, resolve(outArg), { commit, built: new Date().toISOString() })
for (const q of index.queues) {
  const rows = q.files.reduce((n, f) => n + f.rows, 0)
  const flagged = q.files.reduce((n, f) => n + f.flagged, 0)
  console.log(`${q.queue}: ${q.files.length} files, ${rows} rows, ${flagged} flagged`)
}
console.log(`snapshot ${index.id}`)
```

Note: `allRows` calls `makeCtx` once per queue (reads the draft each time). That is acceptable for a job that runs
once per merge; do not optimise.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @wordado/review-app test && pnpm --filter @wordado/review-app typecheck`
Expected: PASS (after adding `rowHash: 'h'` to RowView literals in existing UI tests).

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): snapshot builder for the hosted app"
```

---

### Task 3: Worker scaffold: config, schema, request rules

**Files:**
- Modify: `review-app/package.json` (deps `hono`, devDep `wrangler`; scripts below), `pnpm-lock.yaml`
- Create: `review-app/wrangler.jsonc`, `review-app/migrations/0001_init.sql`
- Create: `review-app/worker/{index,bindings,app,b64}.ts`, `review-app/worker/test/platform.ts`,
  `review-app/worker/app.test.ts`
- Modify: `review-app/vitest.config.ts` (a `worker` project), `review-app/tsconfig.json` (include `worker`)

**Interfaces:**
- Produces:
  - `Env` (bindings.ts) — fields exactly as below
  - `interface Deps { env: Env; fetch: (input: string, init?: RequestInit) => Promise<Response>; now: () => Date; log: (line: string) => void }`
  - `createApp(deps: Deps): Hono<AppEnv>` with `type AppEnv = { Variables: { me: ReviewerRow } }` (ReviewerRow from Task 5's `db.ts`; in this task declare `Variables: { me: unknown }` and tighten in Task 4)
  - `jsonBody<T>(c): Promise<T>` throwing `BadBody`; `apiError(c, status, message)`
  - `b64url.encode(bytes: Uint8Array): string`, `b64url.decode(s: string): Uint8Array`, `b64url.encodeText`, `b64url.decodeText`
  - test helpers: `startPlatform(): Promise<{ env: Env; dispose(): Promise<void> }>`, `resetDb(db)`, `testDeps(env, overrides?): Deps`

- [ ] **Step 1: Add dependencies and config**

```bash
pnpm --filter @wordado/review-app add hono@^4.13.8
pnpm --filter @wordado/review-app add -D wrangler@^4.136.3
```

Scripts in `review-app/package.json`:

```json
"snapshot": "tsx server/snapshotMain.ts",
"dev:hosted": "vite build && wrangler dev --port 4181 --ip 127.0.0.1",
"e2e:hosted": "playwright test -c playwright.hosted.config.ts",
"deploy:check": "vite build && wrangler deploy --dry-run --env production --outdir dist-worker"
```

Add `review-app/dist-worker/` and `review-app/.e2e/` to the root `.gitignore`.

`review-app/wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  // The top level is local development and tests only; a deploy always names --env production
  // (spec 2026-10-05 §14). Its own name means a bare `wrangler deploy` can never replace the real Worker.
  "name": "wordado-review-local",
  "main": "worker/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "dist", "not_found_handling": "single-page-application", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "wordado-review", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }],
  "r2_buckets": [{ "binding": "SNAPSHOTS", "bucket_name": "wordado-review" }],
  "vars": {
    "APP_ORIGIN": "http://127.0.0.1:4181",
    "ACCESS_TEAM_DOMAIN": "",
    "ACCESS_AUD": "",
    "CONTENT_REPO": "wordado/wordado-content",
    "GITHUB_APP_ID": "",
    "GITHUB_INSTALLATION_ID": "",
    "MAIL_FROM": "Wordado Review <review@wordado.com>"
  },
  "observability": { "enabled": true },
  "env": {
    "production": {
      "name": "wordado-review",
      "routes": [{ "pattern": "review.wordado.com", "custom_domain": true }],
      // The operator's ids and values (review-app/README.md, "Hosted"); scripts/check-config.ts refuses
      // a deploy while any is still the placeholder. ADMIN_EMAIL and the keys are secrets, not vars.
      "d1_databases": [{ "binding": "DB", "database_name": "wordado-review", "database_id": "00000000-0000-0000-0000-000000000000", "migrations_dir": "migrations" }],
      "r2_buckets": [{ "binding": "SNAPSHOTS", "bucket_name": "wordado-review" }],
      "vars": {
        "APP_ORIGIN": "https://review.wordado.com",
        "ACCESS_TEAM_DOMAIN": "",
        "ACCESS_AUD": "",
        "CONTENT_REPO": "wordado/wordado-content",
        "GITHUB_APP_ID": "",
        "GITHUB_INSTALLATION_ID": "",
        "MAIL_FROM": "Wordado Review <review@wordado.com>"
      }
    }
  }
}
```

`review-app/migrations/0001_init.sql`:

```sql
CREATE TABLE reviewers (
  email TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  languages TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('reviewer', 'admin')),
  invited_at TEXT NOT NULL,
  invite_sent_at TEXT,
  disabled_at TEXT
);
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  reviewer TEXT NOT NULL REFERENCES reviewers(email),
  queue TEXT NOT NULL,
  files TEXT NOT NULL,
  flagged_only INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX assignments_open ON assignments (queue) WHERE closed_at IS NULL;
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY,
  assignment INTEGER NOT NULL REFERENCES assignments(id),
  branch TEXT NOT NULL,
  pr INTEGER,
  url TEXT,
  count INTEGER NOT NULL,
  left_out INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'merged', 'closed')),
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX submissions_pr ON submissions (pr) WHERE pr IS NOT NULL;
CREATE TABLE decisions (
  assignment INTEGER NOT NULL REFERENCES assignments(id),
  queue TEXT NOT NULL,
  file TEXT NOT NULL,
  key TEXT NOT NULL,
  row_hash TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accept', 'keep', 'edit', 'drop')),
  cells TEXT NOT NULL,
  note TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  submission INTEGER REFERENCES submissions(id),
  PRIMARY KEY (assignment, queue, key)
);
```

(`submissions.url` is an addition to spec §5's table: the pull request's link, kept so the admin page needs no
GitHub call to show it.)

- [ ] **Step 2: Write the failing tests**

`review-app/worker/test/platform.ts`:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import type { D1Database, Env, R2Bucket } from '../bindings'
import type { Deps } from '../app'

const root = join(import.meta.dirname, '..', '..')

/** Runs the migrations, statement by statement, as `wrangler d1 migrations apply` would. */
export async function migrate(db: D1Database): Promise<void> {
  for (const name of readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = readFileSync(join(root, 'migrations', name), 'utf8').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)
    await db.batch(statements.map((s) => db.prepare(s)))
  }
}

export async function resetDb(db: D1Database): Promise<void> {
  await db.batch(['DELETE FROM decisions', 'DELETE FROM submissions', 'DELETE FROM assignments', 'DELETE FROM reviewers'].map((s) => db.prepare(s)))
}

/** Local D1 and R2 from wrangler.jsonc's top level, in memory, migrated. */
export async function startPlatform(): Promise<{ env: Env; dispose(): Promise<void> }> {
  const proxy = await getPlatformProxy<{ DB: D1Database; SNAPSHOTS: R2Bucket }>({ configPath: join(root, 'wrangler.jsonc'), persist: false })
  await migrate(proxy.env.DB)
  const env: Env = {
    DB: proxy.env.DB,
    SNAPSHOTS: proxy.env.SNAPSHOTS,
    APP_ORIGIN: 'https://review.test',
    ACCESS_TEAM_DOMAIN: 'team.example.com',
    ACCESS_AUD: 'aud-test',
    ADMIN_EMAIL: 'admin@example.com',
    CONTENT_REPO: 'wordado/wordado-content',
    GITHUB_APP_ID: '1',
    GITHUB_INSTALLATION_ID: '2',
    MAIL_FROM: 'Wordado Review <review@wordado.com>',
  }
  return { env, dispose: () => proxy.dispose() }
}

export function testDeps(env: Env, overrides: Partial<Deps> = {}): Deps {
  return {
    env,
    fetch: async (input) => new Response(`no fake for ${input}`, { status: 599 }),
    now: () => new Date('2026-10-05T12:00:00Z'),
    log: () => undefined,
    ...overrides,
  }
}
```

`review-app/worker/app.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './app'
import { startPlatform, testDeps } from './test/platform'
import type { Env } from './bindings'

let env: Env
let dispose: () => Promise<void>
beforeAll(async () => ({ env, dispose } = await startPlatform()))
afterAll(() => dispose())

describe('request rules', () => {
  const app = () => createApp(testDeps(env))

  it('refuses a POST from another origin', async () => {
    const res = await app().request('/api/decision', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('refuses a POST without JSON', async () => {
    const res = await app().request('/api/decision', { method: 'POST', headers: { origin: 'https://review.test', 'content-type': 'text/plain' }, body: 'x' })
    expect(res.status).toBe(415)
  })

  it('answers 404 JSON for an unknown API path', async () => {
    const res = await app().request('/api/nothing-here', { headers: {} })
    expect([401, 404]).toContain(res.status)
    expect(res.headers.get('content-type')).toMatch(/json/)
  })

  it('has the schema', async () => {
    const tables = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()
    expect(tables.results.map((t) => t.name)).toEqual(expect.arrayContaining(['assignments', 'decisions', 'reviewers', 'submissions']))
  })
})
```

Add to `review-app/vitest.config.ts` projects:
`{ test: { name: 'worker', include: ['worker/**/*.test.ts'], environment: 'node', testTimeout: 30_000, hookTimeout: 60_000 } }`.

- [ ] **Step 3: Run to see it fail**

Run: `pnpm --filter @wordado/review-app test -- --project worker`
Expected: FAIL (no `./app`).

- [ ] **Step 4: Implement**

`review-app/worker/bindings.ts` (only the binding methods this Worker uses, so no `@cloudflare/workers-types` is
needed and the Node-typed tests compile):

```ts
export interface D1Meta { readonly last_row_id: number; readonly changes: number }
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>
  run(): Promise<{ meta: D1Meta }>
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>
}
export interface R2ObjectBody { text(): Promise<string> }
export interface R2Bucket {
  get(key: string): Promise<R2ObjectBody | null>
  put(key: string, value: string): Promise<unknown>
}

export interface Env {
  readonly DB: D1Database
  readonly SNAPSHOTS: R2Bucket
  readonly APP_ORIGIN: string
  readonly ACCESS_TEAM_DOMAIN: string
  readonly ACCESS_AUD: string
  /** Tests and the hosted e2e only: a JWKS JSON used instead of the team's keys. check-config refuses it in production. */
  readonly ACCESS_JWKS?: string
  readonly ADMIN_EMAIL: string
  readonly CONTENT_REPO: string
  readonly GITHUB_APP_ID: string
  readonly GITHUB_INSTALLATION_ID: string
  /** Tests and e2e only: a fake GitHub API's base URL. */
  readonly GITHUB_API_URL?: string
  readonly GITHUB_APP_PRIVATE_KEY?: string
  readonly GITHUB_WEBHOOK_SECRET?: string
  readonly RESEND_API_KEY?: string
  readonly MAIL_FROM: string
}
```

`review-app/worker/b64.ts`:

```ts
export const b64url = {
  encode(bytes: Uint8Array): string {
    let s = ''
    for (const b of bytes) s += String.fromCharCode(b)
    return btoa(s).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
  },
  decode(text: string): Uint8Array {
    const s = atob(text.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (text.length % 4)) % 4))
    return Uint8Array.from(s, (c) => c.charCodeAt(0))
  },
  encodeText: (text: string) => b64url.encode(new TextEncoder().encode(text)),
  decodeText: (text: string) => new TextDecoder().decode(b64url.decode(text)),
}
```

`review-app/worker/app.ts`:

```ts
import { Hono, type Context } from 'hono'
import type { Env } from './bindings'

export interface Deps {
  readonly env: Env
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>
  readonly now: () => Date
  readonly log: (line: string) => void
}

export type AppEnv = { Variables: { me: unknown } }

/** A request body the client got wrong; answered 400. */
export class BadBody extends Error {}

export async function jsonBody<T>(c: Context): Promise<T> {
  let parsed: unknown
  try {
    parsed = await c.req.json()
  } catch {
    throw new BadBody('the request body is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadBody('the request body is not valid JSON')
  return parsed as T
}

export const apiError = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 410 | 415 | 503, message: string) => c.json({ message }, status)

/** Paths that are not called by the browser and so carry no Origin or Access token (GitHub's webhook). */
const MACHINE_PATHS = new Set(['/api/github/webhook'])

export function createApp(deps: Deps): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
  app.onError((err, c) => {
    if (err instanceof BadBody) return apiError(c, 400, err.message)
    deps.log(`error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`)
    return c.json({ message: 'internal error' }, 500)
  })
  // Spec §6.2: in place of the local Host check, a state-changing request must come from the app's own origin.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && !MACHINE_PATHS.has(c.req.path)) {
      if (c.req.header('origin') !== deps.env.APP_ORIGIN) return apiError(c, 403, 'bad origin')
      if (!(c.req.header('content-type') ?? '').toLowerCase().startsWith('application/json')) return apiError(c, 415, 'a request with a body needs content-type: application/json')
    }
    await next()
  })
  app.all('/api/*', (c) => apiError(c, 404, 'no such API'))
  return app
}
```

(Routes added by later tasks are registered **before** the `/api/*` catch-all; keep the catch-all last.)

`review-app/worker/index.ts`:

```ts
import { createApp } from './app'
import type { Env } from './bindings'

export default {
  fetch(request: Request, env: Env): Promise<Response> | Response {
    return createApp({ env, fetch: (input, init) => fetch(input, init), now: () => new Date(), log: (line) => console.log(line) }).fetch(request)
  },
}
```

- [ ] **Step 5: Run tests, typecheck, lint**

Run: `pnpm --filter @wordado/review-app test -- --project worker && pnpm --filter @wordado/review-app typecheck && pnpm lint`
Expected: PASS. If `getPlatformProxy` cannot start in the sandbox, report BLOCKED with its error; do not mock D1.

- [ ] **Step 6: Commit**

```bash
git add review-app pnpm-lock.yaml .gitignore
git commit -m "feat(review-app): wordado-review Worker scaffold, D1 schema, request rules"
```

---

### Task 4: Access sign-in, the data layer for reviewers, and `/api/me`

**Files:**
- Create: `review-app/worker/access.ts`, `review-app/worker/db.ts` (reviewer part), `review-app/worker/routes/me.ts`
- Create: `review-app/worker/test/jwt.ts`, `review-app/worker/access.test.ts`, `review-app/worker/routes/me.test.ts`
- Modify: `review-app/worker/app.ts` (auth middleware, `AppEnv` variables)

**Interfaces:**
- Consumes: `Deps`, `createApp`, `b64url`, `startPlatform`, `testDeps`.
- Produces:
  - `verifyAccessJwt(token: string, opts: { aud: string; issuer: string; keys: () => Promise<readonly JsonWebKey[]>; now: Date }): Promise<{ email: string } | null>`
  - `accessKeys(deps: Deps): () => Promise<readonly JsonWebKey[]>` (from `ACCESS_JWKS`, else
    `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, cached one hour per module)
  - `db.ts`: `interface ReviewerRow { email: string; name: string; languages: Language[]; role: Role; invitedAt: string; inviteSentAt: string | null; disabledAt: string | null }`,
    `getReviewer(db, email)`, `listReviewers(db)`, `insertReviewer(db, r: ReviewerRow)`,
    `updateReviewer(db, email, patch: Partial<Pick<ReviewerRow, 'name' | 'languages' | 'role' | 'inviteSentAt' | 'disabledAt'>>)`,
    `toReviewerView(r): ReviewerView`
  - `AppEnv = { Variables: { me: ReviewerRow } }`; every `/api/*` route except `MACHINE_PATHS` has `c.get('me')`
  - test helper `testKeys(): Promise<{ jwks: string; sign(claims: Record<string, unknown>): Promise<string>; token(email: string, env: Env): Promise<string> }>`
  - `asUser(app, token)`-style helper is not needed: tests pass the header `cf-access-jwt-assertion`.

- [ ] **Step 1: Write the failing tests**

`review-app/worker/test/jwt.ts`:

```ts
import { b64url } from '../b64'
import type { Env } from '../bindings'

/** An RSA key pair for test tokens, its public JWKS as ACCESS_JWKS takes it, and a signer. */
export async function testKeys() {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair
  const jwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid', alg: 'RS256', use: 'sig' }
  const sign = async (claims: Record<string, unknown>, kid = 'test-kid') => {
    const head = b64url.encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }))
    const body = b64url.encodeText(JSON.stringify(claims))
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${head}.${body}`))
    return `${head}.${body}.${b64url.encode(new Uint8Array(sig))}`
  }
  const token = (email: string, env: Pick<Env, 'ACCESS_AUD' | 'ACCESS_TEAM_DOMAIN'>, exp = Math.floor(Date.now() / 1000) + 3600) =>
    sign({ email, aud: [env.ACCESS_AUD], iss: `https://${env.ACCESS_TEAM_DOMAIN}`, exp, iat: exp - 3600 })
  return { jwks: JSON.stringify({ keys: [jwk] }), sign, token, privateKey: pair.privateKey }
}
```

`review-app/worker/access.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { verifyAccessJwt } from './access'
import { testKeys } from './test/jwt'

const env = { ACCESS_AUD: 'aud-test', ACCESS_TEAM_DOMAIN: 'team.example.com' }
const now = new Date()
const opts = (jwks: string) => ({ aud: 'aud-test', issuer: 'https://team.example.com', keys: async () => (JSON.parse(jwks) as { keys: JsonWebKey[] }).keys, now })

describe('verifyAccessJwt', () => {
  it('accepts a valid token and lower-cases the email', async () => {
    const k = await testKeys()
    expect(await verifyAccessJwt(await k.token('Anna@Example.com', env), opts(k.jwks))).toEqual({ email: 'anna@example.com' })
  })
  it('refuses the wrong audience, issuer, an expired token, and a bad signature', async () => {
    const k = await testKeys()
    const other = await testKeys()
    expect(await verifyAccessJwt(await k.token('a@example.com', { ...env, ACCESS_AUD: 'other' }), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await k.token('a@example.com', { ...env, ACCESS_TEAM_DOMAIN: 'evil.example.com' }), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await k.token('a@example.com', env, Math.floor(now.getTime() / 1000) - 10), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt(await other.token('a@example.com', env), opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt('not.a.jwt', opts(k.jwks))).toBeNull()
    expect(await verifyAccessJwt('', opts(k.jwks))).toBeNull()
  })
})
```

`review-app/worker/routes/me.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertReviewer } from '../db'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(() => resetDb(env.DB))

const me = async (email: string | null) =>
  createApp(testDeps(env)).request('/api/me', { headers: email ? { 'cf-access-jwt-assertion': await keys.token(email, env) } : {} })

describe('GET /api/me', () => {
  it('is 401 without a token', async () => {
    expect((await me(null)).status).toBe(401)
  })
  it('is 403 for an email nobody invited', async () => {
    expect((await me('stranger@example.com')).status).toBe(403)
  })
  it('creates the first admin from ADMIN_EMAIL', async () => {
    const res = await me('ADMIN@example.com')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ email: 'admin@example.com', name: 'Coordinator', role: 'admin', languages: ['bg', 'de', 'es', 'en'] })
  })
  it('knows an invited reviewer whatever the email case, and refuses a disabled one', async () => {
    await insertReviewer(env.DB, { email: 'anna@example.com', name: 'Anna', languages: ['de'], role: 'reviewer', invitedAt: '2026-10-05T00:00:00Z', inviteSentAt: null, disabledAt: null })
    const ok = await me('Anna@Example.com')
    expect(ok.status).toBe(200)
    expect(((await ok.json()) as { name: string }).name).toBe('Anna')
    await env.DB.prepare('UPDATE reviewers SET disabled_at = ? WHERE email = ?').bind('2026-10-05T01:00:00Z', 'anna@example.com').run()
    expect((await me('anna@example.com')).status).toBe(403)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @wordado/review-app test -- --project worker`
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement**

`review-app/worker/access.ts`:

```ts
import { b64url } from './b64'
import type { Deps } from './app'

interface Claims { email?: unknown; aud?: unknown; iss?: unknown; exp?: unknown }

/** Cloudflare Access's JWT (spec 2026-10-05 §10): RS256 against the team's keys, audience, issuer, expiry. */
export async function verifyAccessJwt(
  token: string,
  opts: { aud: string; issuer: string; keys: () => Promise<readonly JsonWebKey[]>; now: Date },
): Promise<{ email: string } | null> {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [h, p, s] = parts as [string, string, string]
  let header: { alg?: unknown; kid?: unknown }
  let claims: Claims
  try {
    header = JSON.parse(b64url.decodeText(h)) as typeof header
    claims = JSON.parse(b64url.decodeText(p)) as Claims
  } catch {
    return null
  }
  if (header.alg !== 'RS256') return null
  const candidates = (await opts.keys()).filter((k) => header.kid === undefined || (k as { kid?: unknown }).kid === header.kid)
  const data = new TextEncoder().encode(`${h}.${p}`)
  let sig: Uint8Array
  try {
    sig = b64url.decode(s)
  } catch {
    return null
  }
  let valid = false
  for (const jwk of candidates) {
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])
    if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)) {
      valid = true
      break
    }
  }
  if (!valid) return null
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!auds.includes(opts.aud)) return null
  if (claims.iss !== opts.issuer) return null
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= opts.now.getTime()) return null
  if (typeof claims.email !== 'string' || claims.email === '') return null
  return { email: claims.email.toLowerCase() }
}

let cached: { url: string; at: number; keys: readonly JsonWebKey[] } | null = null

/** The keys Access signs with: ACCESS_JWKS when set (tests, e2e), else the team's certs, cached for an hour. */
export function accessKeys(deps: Deps): () => Promise<readonly JsonWebKey[]> {
  return async () => {
    if (deps.env.ACCESS_JWKS) return (JSON.parse(deps.env.ACCESS_JWKS) as { keys: JsonWebKey[] }).keys
    const url = `https://${deps.env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`
    const now = deps.now().getTime()
    if (cached && cached.url === url && now - cached.at < 3_600_000) return cached.keys
    const res = await deps.fetch(url)
    if (!res.ok) throw new Error(`Access certs: ${res.status}`)
    const keys = ((await res.json()) as { keys: JsonWebKey[] }).keys
    cached = { url, at: now, keys }
    return keys
  }
}
```

`review-app/worker/db.ts` (reviewer part; Task 5 adds the rest to the same file):

```ts
import type { D1Database } from './bindings'
import type { Language, ReviewerView, Role } from '../shared/hosted'

export interface ReviewerRow {
  readonly email: string
  readonly name: string
  readonly languages: readonly Language[]
  readonly role: Role
  readonly invitedAt: string
  readonly inviteSentAt: string | null
  readonly disabledAt: string | null
}

interface ReviewerRecord { email: string; name: string; languages: string; role: Role; invited_at: string; invite_sent_at: string | null; disabled_at: string | null }
const reviewer = (r: ReviewerRecord): ReviewerRow => ({
  email: r.email, name: r.name, languages: JSON.parse(r.languages) as Language[], role: r.role,
  invitedAt: r.invited_at, inviteSentAt: r.invite_sent_at, disabledAt: r.disabled_at,
})

export async function getReviewer(db: D1Database, email: string): Promise<ReviewerRow | null> {
  const r = await db.prepare('SELECT * FROM reviewers WHERE email = ?').bind(email.toLowerCase()).first<ReviewerRecord>()
  return r ? reviewer(r) : null
}
export async function listReviewers(db: D1Database): Promise<ReviewerRow[]> {
  return (await db.prepare('SELECT * FROM reviewers ORDER BY name').all<ReviewerRecord>()).results.map(reviewer)
}
export async function insertReviewer(db: D1Database, r: ReviewerRow): Promise<void> {
  await db
    .prepare('INSERT INTO reviewers (email, name, languages, role, invited_at, invite_sent_at, disabled_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(r.email.toLowerCase(), r.name, JSON.stringify(r.languages), r.role, r.invitedAt, r.inviteSentAt, r.disabledAt)
    .run()
}
export async function updateReviewer(
  db: D1Database,
  email: string,
  patch: Partial<Pick<ReviewerRow, 'name' | 'languages' | 'role' | 'inviteSentAt' | 'disabledAt'>>,
): Promise<void> {
  const cols: Record<string, unknown> = {}
  if (patch.name !== undefined) cols['name'] = patch.name
  if (patch.languages !== undefined) cols['languages'] = JSON.stringify(patch.languages)
  if (patch.role !== undefined) cols['role'] = patch.role
  if (patch.inviteSentAt !== undefined) cols['invite_sent_at'] = patch.inviteSentAt
  if (patch.disabledAt !== undefined) cols['disabled_at'] = patch.disabledAt
  const names = Object.keys(cols)
  if (names.length === 0) return
  await db.prepare(`UPDATE reviewers SET ${names.map((n) => `${n} = ?`).join(', ')} WHERE email = ?`).bind(...Object.values(cols), email.toLowerCase()).run()
}
export const toReviewerView = (r: ReviewerRow): ReviewerView => ({ ...r, languages: [...r.languages] })
```

In `app.ts`: change `AppEnv` to `{ Variables: { me: ReviewerRow } }` and add, after the request-rules middleware:

```ts
  app.use('/api/*', async (c, next) => {
    if (MACHINE_PATHS.has(c.req.path)) return next()
    const token = c.req.header('cf-access-jwt-assertion') ?? ''
    const who = await verifyAccessJwt(token, { aud: deps.env.ACCESS_AUD, issuer: `https://${deps.env.ACCESS_TEAM_DOMAIN}`, keys: accessKeys(deps), now: deps.now() })
    if (!who) return apiError(c, 401, 'sign in again')
    let me = await getReviewer(deps.env.DB, who.email)
    // The first admin (spec §5) is created on their first request.
    if (!me && who.email === deps.env.ADMIN_EMAIL.toLowerCase()) {
      me = { email: who.email, name: 'Coordinator', languages: ['bg', 'de', 'es', 'en'], role: 'admin', invitedAt: deps.now().toISOString(), inviteSentAt: null, disabledAt: null }
      await insertReviewer(deps.env.DB, me)
    }
    if (!me || me.disabledAt) return apiError(c, 403, 'This address has no invitation. Ask the coordinator for one.')
    c.set('me', me)
    await next()
  })
```

`review-app/worker/routes/me.ts`:

```ts
import type { Hono } from 'hono'
import type { AppEnv } from '../app'
import type { Me } from '../../shared/hosted'

export function meRoutes(app: Hono<AppEnv>): void {
  app.get('/api/me', (c) => {
    const me = c.get('me')
    const body: Me = { email: me.email, name: me.name, role: me.role, languages: [...me.languages] }
    return c.json(body)
  })
}
```

Register `meRoutes(app)` in `createApp` before the catch-all.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @wordado/review-app test -- --project worker && pnpm --filter @wordado/review-app typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): Access sign-in, reviewers table, /api/me"
```

---

### Task 5: Snapshot store, assignment rows and the reviewer's reads

**Files:**
- Modify: `review-app/worker/db.ts` (assignments, decisions, submissions)
- Create: `review-app/worker/snapshotStore.ts`, `review-app/worker/rows.ts`, `review-app/worker/routes/reviewer.ts`
- Create: `review-app/worker/test/snapshot.ts` (puts a fixture snapshot in R2), `review-app/worker/rows.test.ts`,
  `review-app/worker/routes/reviewer.test.ts`

**Interfaces:**
- Consumes: Task 1 types; Task 2 `buildSnapshot`, `reviewFixture`; Task 4 `ReviewerRow`, auth.
- Produces (`db.ts`):
  - `interface AssignmentRow { id: number; reviewer: string; queue: string; files: readonly string[] | '*'; flaggedOnly: boolean; createdAt: string; closedAt: string | null }`
  - `getAssignment(db, id)`, `listAssignments(db, filter: { reviewer?: string; open?: boolean; queue?: string })`,
    `insertAssignment(db, a: Omit<AssignmentRow, 'id' | 'closedAt'>): Promise<number>`, `closeAssignment(db, id, at)`
  - `interface DecisionRow { assignment: number; queue: string; file: string; key: string; rowHash: string; action: Action; cells: Record<string, string>; note: string; decidedAt: string; submission: number | null }`
  - `listDecisions(db, assignment)`, `upsertDecision(db, d)`, `deleteDecision(db, assignment, key)` (unsubmitted
    only), `deleteDecisions(db, assignment, keys)` (unsubmitted only), `moveDecisions(db, from, to)` (unsubmitted
    only), `markSubmitted(db, assignment, keys, submission)`, `unsubmit(db, submission)`
  - `interface SubmissionRow { id: number; assignment: number; branch: string; pr: number | null; url: string | null; count: number; leftOut: number; status: 'open' | 'merged' | 'closed'; createdAt: string }`
  - `insertSubmission(db, s: Omit<SubmissionRow, 'id'>): Promise<number>`, `listSubmissions(db, filter: { assignment?: number; status?: SubmissionRow['status'] })`,
    `submissionByPr(db, pr)`, `setSubmissionStatus(db, id, status)`
- Produces (`snapshotStore.ts`):
  - `interface Snapshot { index: SnapshotIndex; queue(name: string): SnapshotQueue | null; file(path: string): Promise<SnapshotFile | null> }`
  - `currentSnapshot(deps: Deps): Promise<Snapshot | null>` (pointer and index cached 30 s; files cached by key, at most 64)
  - `resetSnapshotCache(): void` (tests)
- Produces (`rows.ts`):
  - `assignmentRows(snap: Snapshot, a: AssignmentRow): Promise<{ rows: RowView[]; keys: ReadonlySet<string> }>` (rows filtered for a flagged-only assignment; `keys` = every key in the assignment's files)
  - `scopeFiles(snap, a): readonly string[]` (the files of the assignment that are in the snapshot)
  - `progress(rows, decisions, submissions): Progress`
  - `rank(r: RowView): number` (reported 0, major 1, minor 2, unreviewed 3, other 4)
  - `withDecisions(rows, decisions): HostedRow[]`
- Produces (routes): `GET /api/assignments` → `AssignmentView[]`; `GET /api/rows?assignment=<id>` → `RowsResponse`
- Test helper: `putSnapshot(env: Env): Promise<{ index: SnapshotIndex; content: string }>` builds the fixture
  snapshot (Task 2) and puts every file under its key in `env.SNAPSHOTS`, `current.json` last.

- [ ] **Step 1: Write the failing tests**

`review-app/worker/test/snapshot.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { reviewFixture } from '../../server/fixture'
import { buildSnapshot } from '../../server/snapshot'
import { CURRENT_KEY, type SnapshotIndex } from '../../shared/snapshot'
import type { Env } from '../bindings'

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
}

/** The local app's fixture as a snapshot in R2, as review-snapshot.yml would leave it. */
export async function putSnapshot(env: Env, commit = 'abcdef1234', built = '2026-10-05T10:00:00Z'): Promise<{ index: SnapshotIndex; content: string; out: string }> {
  const content = await reviewFixture()
  const out = mkdtempSync(join(tmpdir(), 'snap-'))
  const index = buildSnapshot(content, out, { commit, built })
  for (const path of walk(out).filter((p) => !p.endsWith(CURRENT_KEY))) await env.SNAPSHOTS.put(relative(out, path), readFileSync(path, 'utf8'))
  await env.SNAPSHOTS.put(CURRENT_KEY, readFileSync(join(out, CURRENT_KEY), 'utf8'))
  return { index, content, out }
}
```

`review-app/worker/rows.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { RowView } from '../server/types'
import type { DecisionRow, SubmissionRow } from './db'
import { progress, rank, withDecisions } from './rows'

const row = (key: string, over: Partial<RowView> = {}): RowView => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation', cells: {}, fields: [], context: {},
  otherSenses: [], reports: '', ai: 'passed', severity: null, objections: [], decided: null, stale: false, rowHash: `h-${key}`, ...over,
})
const decision = (key: string, over: Partial<DecisionRow> = {}): DecisionRow => ({
  assignment: 1, queue: 'translation-de', file: 'review/translation-de/a.csv', key, rowHash: `h-${key}`, action: 'keep', cells: {}, note: '', decidedAt: 't', submission: null, ...over,
})

describe('withDecisions', () => {
  it('marks a decision on a changed row as changed and the row as undecided', () => {
    const [a, b] = withDecisions([row('a'), row('b')], [decision('a'), decision('b', { rowHash: 'old' })])
    expect(a!.decision).toMatchObject({ action: 'keep', changed: false })
    expect(a!.decided).toEqual({ verdict: 'ok', note: '' })
    expect(b!.decision).toMatchObject({ changed: true })
    expect(b!.decided).toBeNull()
  })
})

describe('progress', () => {
  it('counts decided, changed, submitted, merged and remaining', () => {
    const rows = [row('a'), row('b'), row('c'), row('d')]
    const subs: SubmissionRow[] = [
      { id: 7, assignment: 1, branch: 'x', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' },
      { id: 8, assignment: 1, branch: 'y', pr: 2, url: null, count: 5, leftOut: 0, status: 'merged', createdAt: 't' },
    ]
    const p = progress(rows, [decision('a'), decision('b', { rowHash: 'old' }), decision('c', { submission: 7 })], subs)
    expect(p).toEqual({ inScope: 4, decided: 1, changed: 1, submitted: 1, merged: 5, remaining: 2 })
  })
})

describe('rank', () => {
  it('puts reports first, then major, minor, unreviewed', () => {
    expect([row('x', { ai: 'unreviewed' }), row('y', { severity: 'minor' }), row('z', { reports: 'r' }), row('w', { severity: 'major' })].sort((p, q) => rank(p) - rank(q)).map((r) => r.key)).toEqual(['z', 'w', 'y', 'x'])
  })
})
```

`review-app/worker/routes/reviewer.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { AssignmentView, RowsResponse } from '../../shared/hosted'
import type { SnapshotIndex } from '../../shared/snapshot'
import { createApp } from '../app'
import type { Env } from '../bindings'
import { insertAssignment, insertReviewer, upsertDecision } from '../db'
import { resetSnapshotCache } from '../snapshotStore'
import { testKeys } from '../test/jwt'
import { resetDb, startPlatform, testDeps } from '../test/platform'
import { putSnapshot } from '../test/snapshot'

let env: Env
let dispose: () => Promise<void>
let keys: Awaited<ReturnType<typeof testKeys>>
let index: SnapshotIndex
beforeAll(async () => {
  keys = await testKeys()
  const p = await startPlatform()
  env = { ...p.env, ACCESS_JWKS: keys.jwks }
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(env.DB)
  resetSnapshotCache()
  index = (await putSnapshot(env)).index
  await insertReviewer(env.DB, { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
  await insertReviewer(env.DB, { email: 'eve@example.com', name: 'Eve', languages: ['bg'], role: 'reviewer', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const get = async (path: string, email = 'ivan@example.com') =>
  createApp(testDeps(env)).request(path, { headers: { 'cf-access-jwt-assertion': await keys.token(email, env) } })

describe('reviewer reads', () => {
  it('lists only my open assignments, with progress', async () => {
    const mine = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    await insertAssignment(env.DB, { reviewer: 'eve@example.com', queue: 'level', files: '*', flaggedOnly: true, createdAt: 't' })
    const list = (await (await get('/api/assignments')).json()) as AssignmentView[]
    expect(list.map((a) => a.id)).toEqual([mine])
    expect(list[0]!.progress!.inScope).toBeGreaterThan(0)
  })

  it('serves a flagged-only assignment its flagged and reported rows, worst first', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.rows.length).toBeGreaterThan(0)
    expect(body.rows.every((r) => r.ai === 'flagged' || r.reports !== '')).toBe(true)
    expect(body.rows[0]!.reports).not.toBe('')
  })

  it('serves a whole-file assignment every row of its files, in file order', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [file.file], flaggedOnly: false, createdAt: 't' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.rows.length).toBe(file.rows)
  })

  it('is 403 for someone else’s assignment', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    expect((await get(`/api/rows?assignment=${id}`)).status).toBe(403)
  })

  it('discards an unsubmitted decision whose row left the snapshot and marks a changed one', async () => {
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    const first = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows[0]!
    const base = { assignment: id, queue: 'translation-bg', file: first.file, action: 'keep' as const, cells: {}, note: '', decidedAt: 't', submission: null }
    await upsertDecision(env.DB, { ...base, key: first.key, rowHash: 'stale-hash' })
    await upsertDecision(env.DB, { ...base, key: 'gone-9', rowHash: 'x' })
    const body = (await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse
    expect(body.discarded).toEqual(['gone-9'])
    expect(body.rows.find((r) => r.key === first.key)!.decision).toMatchObject({ changed: true })
  })

  it('is 503 while no snapshot exists', async () => {
    await env.SNAPSHOTS.put('current.json', JSON.stringify({ id: 'missing', built: 't', commit: 'c' }))
    resetSnapshotCache()
    const id = await insertAssignment(env.DB, { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true, createdAt: 't' })
    expect((await get(`/api/rows?assignment=${id}`)).status).toBe(503)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @wordado/review-app test -- --project worker`
Expected: FAIL.

- [ ] **Step 3: Implement**

`db.ts` additions (records use snake_case columns; JSON columns are `files`, `cells`):

```ts
import type { Action } from '../server/types'

export interface AssignmentRow { readonly id: number; readonly reviewer: string; readonly queue: string; readonly files: readonly string[] | '*'; readonly flaggedOnly: boolean; readonly createdAt: string; readonly closedAt: string | null }
interface AssignmentRecord { id: number; reviewer: string; queue: string; files: string; flagged_only: number; created_at: string; closed_at: string | null }
const assignment = (r: AssignmentRecord): AssignmentRow => ({
  id: r.id, reviewer: r.reviewer, queue: r.queue, files: r.files === '*' ? '*' : (JSON.parse(r.files) as string[]),
  flaggedOnly: r.flagged_only === 1, createdAt: r.created_at, closedAt: r.closed_at,
})
export async function getAssignment(db: D1Database, id: number): Promise<AssignmentRow | null> {
  const r = await db.prepare('SELECT * FROM assignments WHERE id = ?').bind(id).first<AssignmentRecord>()
  return r ? assignment(r) : null
}
export async function listAssignments(db: D1Database, filter: { reviewer?: string; open?: boolean; queue?: string } = {}): Promise<AssignmentRow[]> {
  const where: string[] = []
  const args: unknown[] = []
  if (filter.reviewer !== undefined) (where.push('reviewer = ?'), args.push(filter.reviewer))
  if (filter.queue !== undefined) (where.push('queue = ?'), args.push(filter.queue))
  if (filter.open === true) where.push('closed_at IS NULL')
  if (filter.open === false) where.push('closed_at IS NOT NULL')
  const sql = `SELECT * FROM assignments${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY closed_at IS NOT NULL, id DESC`
  return (await db.prepare(sql).bind(...args).all<AssignmentRecord>()).results.map(assignment)
}
export async function insertAssignment(db: D1Database, a: Omit<AssignmentRow, 'id' | 'closedAt'>): Promise<number> {
  const res = await db
    .prepare('INSERT INTO assignments (reviewer, queue, files, flagged_only, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(a.reviewer, a.queue, a.files === '*' ? '*' : JSON.stringify(a.files), a.flaggedOnly ? 1 : 0, a.createdAt)
    .run()
  return res.meta.last_row_id
}
export async function closeAssignment(db: D1Database, id: number, at: string): Promise<void> {
  await db.prepare('UPDATE assignments SET closed_at = ? WHERE id = ? AND closed_at IS NULL').bind(at, id).run()
}

export interface DecisionRow { readonly assignment: number; readonly queue: string; readonly file: string; readonly key: string; readonly rowHash: string; readonly action: Action; readonly cells: Readonly<Record<string, string>>; readonly note: string; readonly decidedAt: string; readonly submission: number | null }
interface DecisionRecord { assignment: number; queue: string; file: string; key: string; row_hash: string; action: Action; cells: string; note: string; decided_at: string; submission: number | null }
const decisionRow = (r: DecisionRecord): DecisionRow => ({
  assignment: r.assignment, queue: r.queue, file: r.file, key: r.key, rowHash: r.row_hash, action: r.action,
  cells: JSON.parse(r.cells) as Record<string, string>, note: r.note, decidedAt: r.decided_at, submission: r.submission,
})
export async function listDecisions(db: D1Database, assignmentId: number): Promise<DecisionRow[]> {
  return (await db.prepare('SELECT * FROM decisions WHERE assignment = ? ORDER BY file, key').bind(assignmentId).all<DecisionRecord>()).results.map(decisionRow)
}
export async function upsertDecision(db: D1Database, d: DecisionRow): Promise<void> {
  await db
    .prepare(
      `INSERT INTO decisions (assignment, queue, file, key, row_hash, action, cells, note, decided_at, submission) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (assignment, queue, key) DO UPDATE SET file = excluded.file, row_hash = excluded.row_hash, action = excluded.action,
       cells = excluded.cells, note = excluded.note, decided_at = excluded.decided_at, submission = excluded.submission`,
    )
    .bind(d.assignment, d.queue, d.file, d.key, d.rowHash, d.action, JSON.stringify(d.cells), d.note, d.decidedAt, d.submission)
    .run()
}
export async function deleteDecision(db: D1Database, assignmentId: number, key: string): Promise<void> {
  await db.prepare('DELETE FROM decisions WHERE assignment = ? AND key = ? AND submission IS NULL').bind(assignmentId, key).run()
}
export async function deleteDecisions(db: D1Database, assignmentId: number, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return
  await db.batch(keys.map((k) => db.prepare('DELETE FROM decisions WHERE assignment = ? AND key = ? AND submission IS NULL').bind(assignmentId, k)))
}
export async function moveDecisions(db: D1Database, from: number, to: number): Promise<void> {
  await db.prepare('UPDATE decisions SET assignment = ? WHERE assignment = ? AND submission IS NULL').bind(to, from).run()
}
export async function markSubmitted(db: D1Database, assignmentId: number, keys: readonly string[], submission: number): Promise<void> {
  await db.batch(keys.map((k) => db.prepare('UPDATE decisions SET submission = ? WHERE assignment = ? AND key = ?').bind(submission, assignmentId, k)))
}
export async function unsubmit(db: D1Database, submission: number): Promise<void> {
  await db.prepare('UPDATE decisions SET submission = NULL WHERE submission = ?').bind(submission).run()
}

export interface SubmissionRow { readonly id: number; readonly assignment: number; readonly branch: string; readonly pr: number | null; readonly url: string | null; readonly count: number; readonly leftOut: number; readonly status: 'open' | 'merged' | 'closed'; readonly createdAt: string }
interface SubmissionRecord { id: number; assignment: number; branch: string; pr: number | null; url: string | null; count: number; left_out: number; status: SubmissionRow['status']; created_at: string }
const submissionRow = (r: SubmissionRecord): SubmissionRow => ({ id: r.id, assignment: r.assignment, branch: r.branch, pr: r.pr, url: r.url, count: r.count, leftOut: r.left_out, status: r.status, createdAt: r.created_at })
export async function insertSubmission(db: D1Database, s: Omit<SubmissionRow, 'id'>): Promise<number> {
  const res = await db
    .prepare('INSERT INTO submissions (assignment, branch, pr, url, count, left_out, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(s.assignment, s.branch, s.pr, s.url, s.count, s.leftOut, s.status, s.createdAt)
    .run()
  return res.meta.last_row_id
}
export async function listSubmissions(db: D1Database, filter: { assignment?: number; status?: SubmissionRow['status'] } = {}): Promise<SubmissionRow[]> {
  const where: string[] = []
  const args: unknown[] = []
  if (filter.assignment !== undefined) (where.push('assignment = ?'), args.push(filter.assignment))
  if (filter.status !== undefined) (where.push('status = ?'), args.push(filter.status))
  const sql = `SELECT * FROM submissions${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC`
  return (await db.prepare(sql).bind(...args).all<SubmissionRecord>()).results.map(submissionRow)
}
export async function submissionByPr(db: D1Database, pr: number): Promise<SubmissionRow | null> {
  const r = await db.prepare('SELECT * FROM submissions WHERE pr = ?').bind(pr).first<SubmissionRecord>()
  return r ? submissionRow(r) : null
}
export async function setSubmissionStatus(db: D1Database, id: number, status: SubmissionRow['status']): Promise<void> {
  await db.prepare('UPDATE submissions SET status = ? WHERE id = ?').bind(status, id).run()
}
```

`review-app/worker/snapshotStore.ts`:

```ts
import { CURRENT_KEY, snapshotFileKey, snapshotIndexKey, type SnapshotFile, type SnapshotIndex, type SnapshotPointer, type SnapshotQueue } from '../shared/snapshot'
import type { Deps } from './app'

export interface Snapshot {
  readonly index: SnapshotIndex
  queue(name: string): SnapshotQueue | null
  file(path: string): Promise<SnapshotFile | null>
}

let head: { at: number; index: SnapshotIndex } | null = null
const files = new Map<string, SnapshotFile>()
const MAX_FILES = 64

export function resetSnapshotCache(): void {
  head = null
  files.clear()
}

/** The snapshot current.json names (spec §4.3), or null when there is none yet or it is incomplete. Cached 30 s. */
export async function currentSnapshot(deps: Deps): Promise<Snapshot | null> {
  const now = deps.now().getTime()
  if (!head || now - head.at > 30_000) {
    const pointer = await deps.env.SNAPSHOTS.get(CURRENT_KEY)
    if (!pointer) return null
    const { id } = JSON.parse(await pointer.text()) as SnapshotPointer
    if (head?.index.id !== id) {
      const index = await deps.env.SNAPSHOTS.get(snapshotIndexKey(id))
      if (!index) return null
      head = { at: now, index: JSON.parse(await index.text()) as SnapshotIndex }
    } else head = { at: now, index: head.index }
  }
  const index = head.index
  return {
    index,
    queue: (name) => index.queues.find((q) => q.queue === name) ?? null,
    file: async (path) => {
      const key = snapshotFileKey(index.id, path)
      const hit = files.get(key)
      if (hit) return hit
      const obj = await deps.env.SNAPSHOTS.get(key)
      if (!obj) return null
      const body = JSON.parse(await obj.text()) as SnapshotFile
      if (files.size >= MAX_FILES) files.delete(files.keys().next().value!)
      files.set(key, body)
      return body
    },
  }
}
```

`review-app/worker/rows.ts`:

```ts
import type { RowView } from '../server/types'
import type { HostedRow, Progress } from '../shared/hosted'
import type { AssignmentRow, DecisionRow, SubmissionRow } from './db'
import type { Snapshot } from './snapshotStore'

export const rank = (r: RowView) => (r.reports !== '' ? 0 : r.severity === 'major' ? 1 : r.severity === 'minor' ? 2 : r.ai === 'unreviewed' ? 3 : 4)

export function scopeFiles(snap: Snapshot, a: AssignmentRow): string[] {
  const inSnapshot = (snap.queue(a.queue)?.files ?? []).map((f) => f.file)
  return a.files === '*' ? inSnapshot : inSnapshot.filter((f) => a.files.includes(f))
}

/** The assignment's rows (spec §6): flagged-only → flagged or reported, worst first; otherwise every row in file order. */
export async function assignmentRows(snap: Snapshot, a: AssignmentRow): Promise<{ rows: RowView[]; keys: ReadonlySet<string> }> {
  const all: RowView[] = []
  for (const f of scopeFiles(snap, a)) all.push(...((await snap.file(f))?.rows ?? []))
  const keys = new Set(all.map((r) => r.key))
  if (!a.flaggedOnly) return { rows: all, keys }
  return { rows: all.filter((r) => r.ai === 'flagged' || r.reports !== '').sort((x, y) => rank(x) - rank(y)), keys }
}

export function withDecisions(rows: readonly RowView[], decisions: readonly DecisionRow[]): HostedRow[] {
  const byKey = new Map(decisions.map((d) => [d.key, d]))
  return rows.map((r) => {
    const d = byKey.get(r.key)
    if (!d) return { ...r, decided: null, decision: null }
    const changed = d.rowHash !== r.rowHash
    return {
      ...r,
      decided: changed ? null : { verdict: d.action === 'drop' ? 'drop' : 'ok', note: d.note },
      decision: { action: d.action, cells: d.cells, note: d.note, submission: d.submission, changed },
    }
  })
}

export function progress(rows: readonly RowView[], decisions: readonly DecisionRow[], submissions: readonly SubmissionRow[]): Progress {
  const hash = new Map(rows.map((r) => [r.key, r.rowHash]))
  const open = new Set(submissions.filter((s) => s.status === 'open').map((s) => s.id))
  let decided = 0
  let changed = 0
  let submitted = 0
  for (const d of decisions) {
    if (!hash.has(d.key)) continue
    if (d.submission !== null && open.has(d.submission)) submitted += 1
    else if (d.submission !== null) continue
    else if (hash.get(d.key) !== d.rowHash) changed += 1
    else decided += 1
  }
  const merged = submissions.filter((s) => s.status === 'merged').reduce((n, s) => n + s.count, 0)
  return { inScope: rows.length, decided, changed, submitted, merged, remaining: rows.length - decided - submitted }
}
```

`review-app/worker/routes/reviewer.ts`:

```ts
import type { Hono } from 'hono'
import type { AssignmentView, RowsResponse } from '../../shared/hosted'
import { apiError, type AppEnv, type Deps } from '../app'
import { deleteDecisions, getAssignment, listAssignments, listDecisions, listReviewers, listSubmissions, type AssignmentRow } from '../db'
import { assignmentRows, progress, withDecisions } from '../rows'
import { currentSnapshot, type Snapshot } from '../snapshotStore'

export const NO_SNAPSHOT = 'The review data is not available yet.'

export async function assignmentView(deps: Deps, snap: Snapshot | null, a: AssignmentRow, names: ReadonlyMap<string, string>): Promise<AssignmentView> {
  const p = snap ? progress((await assignmentRows(snap, a)).rows, await listDecisions(deps.env.DB, a.id), await listSubmissions(deps.env.DB, { assignment: a.id })) : null
  return { id: a.id, reviewer: a.reviewer, reviewerName: names.get(a.reviewer) ?? a.reviewer, queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly, createdAt: a.createdAt, closedAt: a.closedAt, progress: p }
}

export async function reviewerNames(deps: Deps): Promise<Map<string, string>> {
  return new Map((await listReviewers(deps.env.DB)).map((r) => [r.email, r.name]))
}

/** The signed-in reviewer's open assignment, or null (403). */
export async function ownAssignment(deps: Deps, email: string, id: number): Promise<AssignmentRow | null> {
  const a = Number.isInteger(id) ? await getAssignment(deps.env.DB, id) : null
  return a && a.reviewer === email && a.closedAt === null ? a : null
}

export function reviewerRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.get('/api/assignments', async (c) => {
    const me = c.get('me')
    const snap = await currentSnapshot(deps)
    const names = await reviewerNames(deps)
    const list = await listAssignments(deps.env.DB, { reviewer: me.email, open: true })
    return c.json(await Promise.all(list.map((a) => assignmentView(deps, snap, a, names))))
  })

  app.get('/api/rows', async (c) => {
    const a = await ownAssignment(deps, c.get('me').email, Number(c.req.query('assignment')))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    const { rows, keys } = await assignmentRows(snap, a)
    const decisions = await listDecisions(deps.env.DB, a.id)
    const discarded = decisions.filter((d) => d.submission === null && !keys.has(d.key)).map((d) => d.key)
    await deleteDecisions(deps.env.DB, a.id, discarded)
    const body: RowsResponse = { rows: withDecisions(rows, decisions.filter((d) => !discarded.includes(d.key))), discarded }
    return c.json(body)
  })
}
```

Register `reviewerRoutes(app, deps)` in `createApp`.

- [ ] **Step 4: Run tests, typecheck, lint**

Run: `pnpm --filter @wordado/review-app test -- --project worker && pnpm --filter @wordado/review-app typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): snapshot store, assignment rows and progress"
```

---

### Task 6: Deciding and undoing

**Files:**
- Create: `review-app/worker/routes/decision.ts`, `review-app/worker/routes/decision.test.ts`

**Interfaces:**
- Consumes: `ownAssignment`, `scopeFiles`, `currentSnapshot`, `upsertDecision`, `deleteDecision`, `listDecisions`,
  `listSubmissions`, `invalidDecision`, `HostedDecisionRequest`.
- Produces: `POST /api/decision` → `DecisionResult` (200 `{ ok: true, version: rowHash }`; 400/409/410 `{ ok: false, reason, message }`;
  403 `{ message }`); `DELETE /api/decision` with body `{ assignment, key }` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

`review-app/worker/routes/decision.test.ts` (same `beforeAll`/`beforeEach` set-up as `reviewer.test.ts`: platform,
keys, `putSnapshot`, reviewers Ivan (`bg`, `en`) and Eve (`bg`), plus an assignment `id` for Ivan on
`translation-bg`, `'*'`, flagged-only; and `row` = the first row of `GET /api/rows?assignment=id`):

```ts
const post = async (method: 'POST' | 'DELETE', body: unknown, email = 'ivan@example.com') =>
  createApp(testDeps(env)).request('/api/decision', {
    method,
    headers: { 'cf-access-jwt-assertion': await keys.token(email, env), origin: env.APP_ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/decision', () => {
  it('stores a decision and shows it on the row; a second one replaces it', async () => {
    const req = { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'edit', cells: { translation: 'бряг' }, note: 'n' }
    expect((await post('POST', req)).status).toBe(200)
    expect((await post('POST', { ...req, action: 'keep', cells: {} })).status).toBe(200)
    const rows = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(rows.find((r) => r.key === row.key)!.decision).toMatchObject({ action: 'keep', changed: false })
  })
  it('is 409 changed when the row hash differs from the snapshot', async () => {
    const res = await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: 'old', action: 'keep' })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ ok: false, reason: 'changed' })
  })
  it('is 410 gone for a key not in the file', async () => {
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: 'nope-1', rowHash: 'x', action: 'keep' })).status).toBe(410)
  })
  it('is 400 for an unknown action, a drop on a title queue, or a cell outside the columns', async () => {
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'zap' })).status).toBe(400)
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'edit', cells: { headword: 'x' } })).status).toBe(400)
  })
  it('is 403 for a row outside the assignment or someone else’s assignment', async () => {
    expect((await post('POST', { assignment: id, queue: 'level', file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })).status).toBe(403)
    expect((await post('POST', { assignment: id, queue: row.queue, file: 'review/translation-bg/other.csv', key: row.key, rowHash: row.rowHash, action: 'keep' })).status).toBe(403)
    expect((await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' }, 'eve@example.com')).status).toBe(403)
  })
  it('is 409 for a row already submitted', async () => {
    const req = { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' }
    await post('POST', req)
    const sub = await insertSubmission(env.DB, { assignment: id, branch: 'b', pr: 1, url: null, count: 1, leftOut: 0, status: 'open', createdAt: 't' })
    await markSubmitted(env.DB, id, [row.key], sub)
    const res = await post('POST', req)
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'changed', message: expect.stringMatching(/submitted/) })
  })
})

describe('DELETE /api/decision', () => {
  it('undoes an unsubmitted decision', async () => {
    await post('POST', { assignment: id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })
    expect((await post('DELETE', { assignment: id, key: row.key })).status).toBe(200)
    const rows = ((await (await get(`/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(rows.find((r) => r.key === row.key)!.decision).toBeNull()
  })
})
```

Also add one test on a `title-bg` assignment (if the fixture has `title-bg` files; else a `level` assignment for
Ivan): `action: 'drop'` → 400 `invalid`.

- [ ] **Step 2: Run to see it fail**

Run: `pnpm --filter @wordado/review-app test -- --project worker worker/routes/decision.test.ts`
Expected: FAIL (404 from the catch-all).

- [ ] **Step 3: Implement**

`review-app/worker/routes/decision.ts`:

```ts
import type { Hono } from 'hono'
import type { DecisionResult } from '../../server/types'
import { invalidDecision } from '../../shared/apply'
import type { HostedDecisionRequest } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { deleteDecision, listDecisions, listSubmissions, upsertDecision } from '../db'
import { scopeFiles } from '../rows'
import { currentSnapshot } from '../snapshotStore'
import { NO_SNAPSHOT, ownAssignment } from './reviewer'

const fail = (reason: 'changed' | 'gone' | 'invalid', message: string): DecisionResult => ({ ok: false, reason, message })

export function decisionRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/api/decision', async (c) => {
    const req = await jsonBody<HostedDecisionRequest>(c)
    const a = await ownAssignment(deps, c.get('me').email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    if (req.queue !== a.queue || !scopeFiles(snap, a).includes(req.file)) return apiError(c, 403, 'this row is not in your assignment')
    const rules = snap.queue(a.queue)!
    const invalid = invalidDecision(rules, req.action)
    if (invalid) return c.json(fail('invalid', invalid), 400)
    const cells = req.cells ?? {}
    const bad = Object.keys(cells).find((k) => !rules.columns.includes(k) || typeof cells[k] !== 'string')
    if (bad !== undefined) return c.json(fail('invalid', `${bad} cannot be edited in ${a.queue}`), 400)
    if (req.note !== undefined && typeof req.note !== 'string') return c.json(fail('invalid', 'the note must be text'), 400)
    const row = (await snap.file(req.file))?.rows.find((r) => r.key === req.key)
    if (!row) return c.json(fail('gone', `${req.key} is no longer in ${req.file}`), 410)
    if (row.rowHash !== req.rowHash) return c.json(fail('changed', `${req.key} changed since it was loaded`), 409)
    const open = new Set((await listSubmissions(deps.env.DB, { assignment: a.id, status: 'open' })).map((s) => s.id))
    const existing = (await listDecisions(deps.env.DB, a.id)).find((d) => d.key === req.key)
    if (existing?.submission != null && open.has(existing.submission)) return c.json(fail('changed', `${req.key} is already submitted`), 409)
    await upsertDecision(deps.env.DB, {
      assignment: a.id, queue: a.queue, file: req.file, key: req.key, rowHash: req.rowHash, action: req.action,
      cells, note: req.note ?? '', decidedAt: deps.now().toISOString(), submission: null,
    })
    return c.json({ ok: true, version: row.rowHash } satisfies DecisionResult)
  })

  app.delete('/api/decision', async (c) => {
    const req = await jsonBody<{ assignment?: unknown; key?: unknown }>(c)
    const a = await ownAssignment(deps, c.get('me').email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    if (typeof req.key !== 'string') return apiError(c, 400, 'a key is needed')
    await deleteDecision(deps.env.DB, a.id, req.key)
    return c.json({ ok: true })
  })
}
```

Note: a decision whose submission is `merged` or `closed` is not blocked here (a closed PR unsubmits on the
webhook; a merged one's row has left the snapshot and is answered 410 before this check).

Register `decisionRoutes(app, deps)` in `createApp`.

- [ ] **Step 4: Run tests, typecheck, lint** — as in Task 5. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): hosted decisions with row-hash checks"
```

---

### Task 7: Assignments: overlap, close, reassign, split, snapshot status

**Files:**
- Create: `review-app/worker/assign.ts`, `review-app/worker/assign.test.ts`
- Create: `review-app/worker/routes/admin.ts`, `review-app/worker/routes/admin.test.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces:
  - `filesOverlap(a: readonly string[] | '*', b: readonly string[] | '*'): boolean`
  - `class SplitError extends Error`; `proposeSplit(files: readonly { file: string; weight: number }[], reviewers: readonly string[]): SplitProposal[]`
  - `requireAdmin` middleware on `/api/admin/*` (403 `admins only`)
  - `createAssignment(deps, input: { reviewer: string; queue: string; files: readonly string[] | '*'; flaggedOnly: boolean }, ignore?: number): Promise<{ id: number } | { status: 400 | 409; message: string }>`
    (shared by create, reassign and split; `ignore` = an assignment id to leave out of the overlap check)
  - Routes: `GET /api/admin/assignments` → `AssignmentView[]` (open first, then the 50 newest closed);
    `POST /api/admin/assignments` `{ reviewer, queue, files, flaggedOnly }` → `AssignmentView` (201);
    `POST /api/admin/assignments/:id/close` → `AssignmentView`;
    `POST /api/admin/assignments/:id/reassign` `{ to, decisions: 'move' | 'discard' }` → `AssignmentView` (the new one);
    `POST /api/admin/assignments/split` `{ queue, flaggedOnly, reviewers: string[] }` → `{ proposal: SplitProposal[] }`,
    and with `{ ..., confirm: true, proposal: SplitProposal[] }` → `{ assignments: AssignmentView[] }`;
    `GET /api/admin/snapshot` → `SnapshotStatus | null`.
  - `closeAssignmentsWhere(deps, email, pred: (a: AssignmentRow) => boolean)` used by Task 8.

- [ ] **Step 1: Write the failing tests**

`review-app/worker/assign.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { filesOverlap, proposeSplit, SplitError } from './assign'

describe('filesOverlap', () => {
  it('treats * as every file', () => {
    expect(filesOverlap('*', ['a'])).toBe(true)
    expect(filesOverlap(['a'], '*')).toBe(true)
    expect(filesOverlap(['a', 'b'], ['c'])).toBe(false)
    expect(filesOverlap(['a', 'b'], ['b'])).toBe(true)
  })
})

describe('proposeSplit', () => {
  it('deals whole files so each reviewer gets about the same weight', () => {
    const files = [10, 9, 8, 7, 6, 5].map((w, i) => ({ file: `f${i}`, weight: w * 10 }))
    const p = proposeSplit(files, ['a@example.com', 'b@example.com'])
    expect(p.map((x) => x.rows).sort()).toEqual([220, 230])
    expect(p.flatMap((x) => x.files).sort()).toEqual(['f0', 'f1', 'f2', 'f3', 'f4', 'f5'])
    expect(p[0]!.files).toEqual([...p[0]!.files].sort())
  })
  it('refuses fewer files than reviewers, or fewer than two reviewers', () => {
    expect(() => proposeSplit([{ file: 'f', weight: 1 }], ['a', 'b'])).toThrow(SplitError)
    expect(() => proposeSplit([{ file: 'f', weight: 1 }, { file: 'g', weight: 1 }], ['a'])).toThrow(/two or more/)
  })
})
```

`review-app/worker/routes/admin.test.ts` (set-up as in `reviewer.test.ts`; also the admin is created by calling
`GET /api/me` as `admin@example.com`; reviewers Ivan (`bg`, `en`), Eve (`bg`), Hans (`de`); helper
`admin(method, path, body?)` sends the admin's token, `origin` and JSON headers):

```ts
describe('admin assignments', () => {
  it('is 403 for a reviewer', async () => {
    expect((await as('ivan@example.com', 'GET', '/api/admin/assignments')).status).toBe(403)
  })
  it('creates an assignment in the reviewer’s language and refuses another language', async () => {
    const ok = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(ok.status).toBe(201)
    const bad = await admin('POST', '/api/admin/assignments', { reviewer: 'hans@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(bad.status).toBe(400)
  })
  it('refuses an overlapping assignment and names who has the file', async () => {
    const file = index.queues.find((q) => q.queue === 'translation-bg')!.files[0]!.file
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: [file], flaggedOnly: false })
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { message: string }).message).toMatch(/Ivan/)
  })
  it('refuses files that are not in the snapshot', async () => {
    const res = await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: ['review/translation-bg/nope.csv'], flaggedOnly: false })
    expect(res.status).toBe(400)
  })
  it('closes an assignment, which frees its files', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    expect((await admin('POST', `/api/admin/assignments/${a.id}/close`, {})).status).toBe(200)
    expect((await admin('POST', '/api/admin/assignments', { reviewer: 'eve@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).status).toBe(201)
  })
  it('reassigns, moving or discarding unsubmitted decisions', async () => {
    const a = (await (await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })).json()) as AssignmentView
    const row = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${a.id}`)).json()) as RowsResponse).rows[0]!
    await as('ivan@example.com', 'POST', '/api/decision', { assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action: 'keep' })
    const moved = (await (await admin('POST', `/api/admin/assignments/${a.id}/reassign`, { to: 'eve@example.com', decisions: 'move' })).json()) as AssignmentView
    expect(moved.reviewer).toBe('eve@example.com')
    expect(moved.progress!.decided).toBe(1)
    const again = (await (await admin('POST', `/api/admin/assignments/${moved.id}/reassign`, { to: 'ivan@example.com', decisions: 'discard' })).json()) as AssignmentView
    expect(again.progress!.decided).toBe(0)
    expect((await admin('POST', `/api/admin/assignments/${again.id}/reassign`, { to: 'hans@example.com', decisions: 'move' })).status).toBe(400)
  })
  it('proposes a split, then creates it on confirm', async () => {
    const res = await admin('POST', '/api/admin/assignments/split', { queue: 'translation-bg', flaggedOnly: false, reviewers: ['ivan@example.com', 'eve@example.com'] })
    const { proposal } = (await res.json()) as { proposal: SplitProposal[] }
    expect(proposal).toHaveLength(2)
    const done = await admin('POST', '/api/admin/assignments/split', { queue: 'translation-bg', flaggedOnly: false, reviewers: ['ivan@example.com', 'eve@example.com'], confirm: true, proposal })
    expect(((await done.json()) as { assignments: AssignmentView[] }).assignments).toHaveLength(2)
  })
  it('reports the snapshot with who holds each file', async () => {
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: true })
    const s = (await (await admin('GET', '/api/admin/snapshot')).json()) as SnapshotStatus
    expect(s.id).toBe(index.id)
    expect(s.queues.find((q) => q.queue === 'level')!.files.every((f) => f.assignedTo === 'Ivan')).toBe(true)
  })
})
```

If the fixture has only one `translation-bg` file, the split test cannot propose two parts: in that case the
test uses whatever queue in `index` has at least two files, found at run time
(`index.queues.find((q) => q.files.length >= 2)`), with reviewers who have its language (create them in the test).

- [ ] **Step 2: Run to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

`review-app/worker/assign.ts`:

```ts
import type { SplitProposal } from '../shared/hosted'

export function filesOverlap(a: readonly string[] | '*', b: readonly string[] | '*'): boolean {
  if (a === '*' || b === '*') return true
  return a.some((f) => b.includes(f))
}

export class SplitError extends Error {}

/** Whole files dealt out heaviest first, each to the reviewer with the least so far (spec §5, "Splitting a queue"). */
export function proposeSplit(files: readonly { file: string; weight: number }[], reviewers: readonly string[]): SplitProposal[] {
  if (reviewers.length < 2) throw new SplitError('pick two or more reviewers to split between')
  if (files.length < reviewers.length) throw new SplitError(`only ${files.length} free files for ${reviewers.length} reviewers`)
  const parts = reviewers.map((reviewer) => ({ reviewer, files: [] as string[], rows: 0 }))
  for (const f of [...files].sort((x, y) => y.weight - x.weight || x.file.localeCompare(y.file))) {
    const least = parts.reduce((m, p) => (p.rows < m.rows ? p : m))
    least.files.push(f.file)
    least.rows += f.weight
  }
  return parts.map((p) => ({ reviewer: p.reviewer, files: p.files.sort(), rows: p.rows }))
}
```

`review-app/worker/routes/admin.ts`:

```ts
import type { Hono } from 'hono'
import { languageOf, type SnapshotStatus, type SplitProposal } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { filesOverlap, proposeSplit, SplitError } from '../assign'
import { closeAssignment, deleteDecisions, getAssignment, getReviewer, insertAssignment, listAssignments, listDecisions, moveDecisions, type AssignmentRow } from '../db'
import { currentSnapshot } from '../snapshotStore'
import { assignmentView, NO_SNAPSHOT, reviewerNames } from './reviewer'

type Created = { id: number } | { status: 400 | 409; message: string }

export async function createAssignment(
  deps: Deps,
  input: { reviewer: string; queue: string; files: readonly string[] | '*'; flaggedOnly: boolean },
  ignore?: number,
): Promise<Created> {
  const r = await getReviewer(deps.env.DB, String(input.reviewer))
  if (!r || r.disabledAt) return { status: 400, message: `${String(input.reviewer)} is not an active reviewer` }
  const lang = languageOf(String(input.queue))
  if (!lang || !r.languages.includes(lang)) return { status: 400, message: `${r.name} does not review ${String(input.queue)}` }
  const snap = await currentSnapshot(deps)
  const q = snap?.queue(input.queue)
  if (!q) return { status: 400, message: `${input.queue} has no open review files` }
  const files = input.files === '*' ? '*' : Array.isArray(input.files) ? input.files.map(String) : null
  if (files === null || (files !== '*' && files.length === 0)) return { status: 400, message: 'pick files, or all files' }
  const known = new Set(q.files.map((f) => f.file))
  const unknown = files === '*' ? undefined : files.find((f) => !known.has(f))
  if (unknown) return { status: 400, message: `${unknown} is not an open file of ${input.queue}` }
  const names = await reviewerNames(deps)
  const clash = (await listAssignments(deps.env.DB, { queue: input.queue, open: true })).find((a) => a.id !== ignore && filesOverlap(a.files, files))
  if (clash) return { status: 409, message: `${clash.files === '*' ? 'This queue' : 'A file'} is already assigned to ${names.get(clash.reviewer) ?? clash.reviewer}` }
  return { id: await insertAssignment(deps.env.DB, { reviewer: r.email, queue: input.queue, files, flaggedOnly: Boolean(input.flaggedOnly), createdAt: deps.now().toISOString() }) }
}

/** Closes the reviewer's open assignments that match (Task 8: disabling, removing a language). */
export async function closeAssignmentsWhere(deps: Deps, email: string, pred: (a: AssignmentRow) => boolean): Promise<void> {
  for (const a of await listAssignments(deps.env.DB, { reviewer: email, open: true })) if (pred(a)) await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
}

export function adminRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.use('/api/admin/*', async (c, next) => (c.get('me').role === 'admin' ? next() : apiError(c, 403, 'admins only')))

  const view = async (id: number) => assignmentView(deps, await currentSnapshot(deps), (await getAssignment(deps.env.DB, id))!, await reviewerNames(deps))

  app.get('/api/admin/assignments', async (c) => {
    const snap = await currentSnapshot(deps)
    const names = await reviewerNames(deps)
    const all = await listAssignments(deps.env.DB)
    const shown = [...all.filter((a) => a.closedAt === null), ...all.filter((a) => a.closedAt !== null).slice(0, 50)]
    return c.json(await Promise.all(shown.map((a) => assignmentView(deps, snap, a, names))))
  })

  app.post('/api/admin/assignments', async (c) => {
    const body = await jsonBody<{ reviewer: string; queue: string; files: string[] | '*'; flaggedOnly: boolean }>(c)
    const made = await createAssignment(deps, body)
    if ('status' in made) return apiError(c, made.status, made.message)
    return c.json(await view(made.id), 201)
  })

  app.post('/api/admin/assignments/:id/close', async (c) => {
    const a = await getAssignment(deps.env.DB, Number(c.req.param('id')))
    if (!a) return apiError(c, 404, 'no such assignment')
    await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
    return c.json(await view(a.id))
  })

  app.post('/api/admin/assignments/:id/reassign', async (c) => {
    const body = await jsonBody<{ to?: unknown; decisions?: unknown }>(c)
    const a = await getAssignment(deps.env.DB, Number(c.req.param('id')))
    if (!a || a.closedAt !== null) return apiError(c, 404, 'no such open assignment')
    if (body.decisions !== 'move' && body.decisions !== 'discard') return apiError(c, 400, 'decisions must be move or discard')
    const made = await createAssignment(deps, { reviewer: String(body.to), queue: a.queue, files: a.files, flaggedOnly: a.flaggedOnly }, a.id)
    if ('status' in made) return apiError(c, made.status, made.message)
    await closeAssignment(deps.env.DB, a.id, deps.now().toISOString())
    if (body.decisions === 'move') await moveDecisions(deps.env.DB, a.id, made.id)
    else await deleteDecisions(deps.env.DB, a.id, (await listDecisions(deps.env.DB, a.id)).filter((d) => d.submission === null).map((d) => d.key))
    return c.json(await view(made.id))
  })

  app.post('/api/admin/assignments/split', async (c) => {
    const body = await jsonBody<{ queue: string; flaggedOnly: boolean; reviewers: string[]; confirm?: boolean; proposal?: SplitProposal[] }>(c)
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    const q = snap.queue(String(body.queue))
    if (!q) return apiError(c, 400, `${String(body.queue)} has no open review files`)
    if (body.confirm === true) {
      if (!Array.isArray(body.proposal)) return apiError(c, 400, 'confirm needs the proposal')
      const made: number[] = []
      for (const p of body.proposal) {
        const r = await createAssignment(deps, { reviewer: p.reviewer, queue: q.queue, files: p.files, flaggedOnly: Boolean(body.flaggedOnly) })
        if ('status' in r) {
          for (const id of made) await closeAssignment(deps.env.DB, id, deps.now().toISOString())
          return apiError(c, r.status, r.message)
        }
        made.push(r.id)
      }
      return c.json({ assignments: await Promise.all(made.map(view)) }, 201)
    }
    const taken = (await listAssignments(deps.env.DB, { queue: q.queue, open: true })).flatMap((a) => (a.files === '*' ? q.files.map((f) => f.file) : a.files))
    const free = q.files
      .filter((f) => !taken.includes(f.file))
      .map((f) => ({ file: f.file, weight: body.flaggedOnly ? f.flagged + f.reported : f.rows }))
      .filter((f) => !body.flaggedOnly || f.weight > 0)
    try {
      return c.json({ proposal: proposeSplit(free, Array.isArray(body.reviewers) ? body.reviewers.map(String) : []) })
    } catch (err) {
      if (err instanceof SplitError) return apiError(c, 400, err.message)
      throw err
    }
  })

  app.get('/api/admin/snapshot', async (c) => {
    const snap = await currentSnapshot(deps)
    if (!snap) return c.json(null)
    const names = await reviewerNames(deps)
    const open = await listAssignments(deps.env.DB, { open: true })
    const holder = (queue: string, file: string) => {
      const a = open.find((x) => x.queue === queue && (x.files === '*' || x.files.includes(file)))
      return a ? (names.get(a.reviewer) ?? a.reviewer) : null
    }
    const body: SnapshotStatus = {
      id: snap.index.id, built: snap.index.built, commit: snap.index.commit,
      queues: snap.index.queues.map((q) => ({ queue: q.queue, language: q.language, files: q.files.map((f) => ({ ...f, assignedTo: holder(q.queue, f.file) })) })),
    }
    return c.json(body)
  })
}
```

Register `adminRoutes(app, deps)` in `createApp`.

- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): admin assignments, split and reassign"
```

---

### Task 8: Reviewers and email

**Files:**
- Create: `review-app/worker/mail.ts`, `review-app/worker/mail.test.ts`
- Create: `review-app/worker/routes/reviewers.ts`, `review-app/worker/routes/reviewers.test.ts`

**Interfaces:**
- Consumes: Task 4 db reviewer functions; Task 7 `closeAssignmentsWhere`, `requireAdmin` (the `/api/admin/*` middleware).
- Produces:
  - `interface ReviewMailer { invite(to: string, name: string, languages: readonly Language[]): Promise<void>; submitted(to: readonly string[], s: { name: string; count: number; queue: string; url: string }): Promise<void> }`
  - `reviewMailer(deps: Deps): ReviewMailer` (Resend when `RESEND_API_KEY` is set, else log lines `Invite for <to>` / `Submitted notice to <to>`)
  - Routes: `GET /api/admin/reviewers` → `ReviewerView[]`; `POST /api/admin/reviewers` `{ email, name, languages, role? }` →
    `{ reviewer: ReviewerView; inviteSent: boolean; link: string }` (201; 409 if the email exists);
    `PATCH /api/admin/reviewers/:email` `{ name?, languages?, role?, disabled? }` → `ReviewerView`;
    `POST /api/admin/reviewers/:email/invite` → `{ inviteSent: boolean; link: string }`

- [ ] **Step 1: Write the failing tests**

`review-app/worker/mail.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { reviewMailer } from './mail'

const env = { MAIL_FROM: 'Wordado Review <review@wordado.com>', APP_ORIGIN: 'https://review.wordado.com', RESEND_API_KEY: 're_test' }

describe('reviewMailer', () => {
  it('sends an invite through Resend with the link and the sign-in line', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = []
    const mailer = reviewMailer({ env, fetch: async (url, init) => (calls.push({ url, body: JSON.parse(String(init?.body)) }), new Response('{}')), now: () => new Date(), log: () => undefined } as never)
    await mailer.invite('anna@example.com', 'Anna', ['de'])
    expect(calls[0]!.url).toBe('https://api.resend.com/emails')
    expect(calls[0]!.body).toMatchObject({ from: env.MAIL_FROM, to: ['anna@example.com'], subject: 'You are invited to review German for Wordado' })
    expect(String(calls[0]!.body['text'])).toContain('https://review.wordado.com')
    expect(String(calls[0]!.body['text'])).toMatch(/code/)
  })
  it('throws when Resend refuses, and logs instead without a key', async () => {
    const refusing = reviewMailer({ env, fetch: async () => new Response('no', { status: 422 }), now: () => new Date(), log: () => undefined } as never)
    await expect(refusing.invite('a@example.com', 'A', ['bg'])).rejects.toThrow(/422/)
    const lines: string[] = []
    const logging = reviewMailer({ env: { ...env, RESEND_API_KEY: undefined }, fetch: async () => new Response(), now: () => new Date(), log: (l: string) => lines.push(l) } as never)
    await logging.submitted(['admin@example.com'], { name: 'Anna', count: 3, queue: 'translation-de', url: 'https://github.com/x/pull/1' })
    expect(lines[0]).toMatch(/admin@example.com/)
  })
})
```

`review-app/worker/routes/reviewers.test.ts` (platform set-up as before; `deps` has a `fetch` that records Resend
calls and answers 200, or 500 when `failMail` is set; the admin exists via `GET /api/me`):

```ts
describe('admin reviewers', () => {
  it('invites a reviewer and records that the invite went out', async () => {
    const res = await admin('POST', '/api/admin/reviewers', { email: 'Anna@Example.com', name: 'Anna', languages: ['de'] })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { reviewer: ReviewerView; inviteSent: boolean; link: string }
    expect(body.reviewer.email).toBe('anna@example.com')
    expect(body.inviteSent).toBe(true)
    expect(body.reviewer.inviteSentAt).not.toBeNull()
    expect(mails).toHaveLength(1)
  })
  it('still creates the reviewer when the mail fails, and says so', async () => {
    failMail = true
    const body = (await (await admin('POST', '/api/admin/reviewers', { email: 'b@example.com', name: 'B', languages: ['bg'] })).json()) as { reviewer: ReviewerView; inviteSent: boolean; link: string }
    expect(body.inviteSent).toBe(false)
    expect(body.link).toBe(env.APP_ORIGIN)
    expect(body.reviewer.inviteSentAt).toBeNull()
  })
  it('refuses a bad email, no languages, an unknown language, and a duplicate', async () => {
    expect((await admin('POST', '/api/admin/reviewers', { email: 'nope', name: 'N', languages: ['de'] })).status).toBe(400)
    expect((await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: [] })).status).toBe(400)
    expect((await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: ['fr'] })).status).toBe(400)
    await admin('POST', '/api/admin/reviewers', { email: 'n@example.com', name: 'N', languages: ['de'] })
    expect((await admin('POST', '/api/admin/reviewers', { email: 'N@example.com', name: 'N', languages: ['de'] })).status).toBe(409)
  })
  it('disabling closes the reviewer’s assignments and locks them out; enabling lets them back in', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'ivan@example.com', name: 'Ivan', languages: ['bg'] })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { disabled: true })
    expect((await as('ivan@example.com', 'GET', '/api/me')).status).toBe(403)
    expect((await listAssignments(env.DB, { reviewer: 'ivan@example.com', open: true }))).toHaveLength(0)
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { disabled: false })
    expect((await as('ivan@example.com', 'GET', '/api/me')).status).toBe(200)
  })
  it('removing a language closes that language’s assignments only', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'ivan@example.com', name: 'Ivan', languages: ['bg', 'en'] })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'translation-bg', files: '*', flaggedOnly: true })
    await admin('POST', '/api/admin/assignments', { reviewer: 'ivan@example.com', queue: 'level', files: '*', flaggedOnly: true })
    await admin('PATCH', '/api/admin/reviewers/ivan@example.com', { languages: ['en'] })
    expect((await listAssignments(env.DB, { reviewer: 'ivan@example.com', open: true })).map((a) => a.queue)).toEqual(['level'])
  })
  it('an admin cannot disable or demote themselves', async () => {
    expect((await admin('PATCH', '/api/admin/reviewers/admin@example.com', { disabled: true })).status).toBe(400)
    expect((await admin('PATCH', '/api/admin/reviewers/admin@example.com', { role: 'reviewer' })).status).toBe(400)
  })
  it('resends an invite', async () => {
    await admin('POST', '/api/admin/reviewers', { email: 'b@example.com', name: 'B', languages: ['bg'] })
    expect(((await (await admin('POST', '/api/admin/reviewers/b@example.com/invite', {})).json()) as { inviteSent: boolean }).inviteSent).toBe(true)
    expect(mails).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

`review-app/worker/mail.ts`:

```ts
import { LANGUAGE_NAMES, type Language } from '../shared/hosted'
import type { Deps } from './app'

export interface ReviewMailer {
  invite(to: string, name: string, languages: readonly Language[]): Promise<void>
  submitted(to: readonly string[], s: { name: string; count: number; queue: string; url: string }): Promise<void>
}

const list = (langs: readonly Language[]) => {
  const names = langs.map((l) => LANGUAGE_NAMES[l])
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)!}`
}

/** Invites and submit notices (spec §8) through Resend's HTTP API; without a key (local, tests), log lines. */
export function reviewMailer(deps: Pick<Deps, 'env' | 'fetch' | 'log'>): ReviewMailer {
  const { env } = deps
  const send = async (to: readonly string[], subject: string, text: string) => {
    if (!env.RESEND_API_KEY) {
      deps.log(`mail to ${to.join(', ')}: ${subject}`)
      return
    }
    const res = await deps.fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to, subject, text }),
    })
    if (!res.ok) throw new Error(`Resend refused the email: ${res.status}`)
  }
  return {
    invite: (to, name, languages) =>
      send(
        [to],
        `You are invited to review ${list(languages)} for Wordado`,
        `Hello ${name},\n\nYou are invited to review ${list(languages)} for Wordado, an app that teaches English vocabulary.\n\nOpen ${env.APP_ORIGIN} and sign in with this address (${to}): you will get a code by email.\n\nThe coordinator will tell you which rows are yours.`,
      ),
    submitted: (to, s) =>
      to.length === 0 ? Promise.resolve() : send(to, `${s.name} submitted ${s.count} decisions on ${s.queue}`, `${s.name} submitted ${s.count} decisions on ${s.queue}.\n\nPull request: ${s.url}`),
  }
}
```

The log line must contain the recipient (the test checks `admin@example.com` appears).

`review-app/worker/routes/reviewers.ts`:

```ts
import type { Hono } from 'hono'
import { LANGUAGES, languageOf, type Language, type ReviewerView, type Role } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { getReviewer, insertReviewer, listReviewers, toReviewerView, updateReviewer, type ReviewerRow } from '../db'
import { reviewMailer } from '../mail'
import { closeAssignmentsWhere } from './admin'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const languagesOf = (v: unknown): Language[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((l) => (LANGUAGES as readonly unknown[]).includes(l)) ? [...new Set(v as Language[])] : null

export function reviewersRoutes(app: Hono<AppEnv>, deps: Deps): void {
  const mailer = reviewMailer(deps)
  const invite = async (r: ReviewerRow): Promise<boolean> => {
    try {
      await mailer.invite(r.email, r.name, r.languages)
      await updateReviewer(deps.env.DB, r.email, { inviteSentAt: deps.now().toISOString() })
      return true
    } catch (err) {
      deps.log(`invite to ${r.email} not sent: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  app.get('/api/admin/reviewers', async (c) => c.json((await listReviewers(deps.env.DB)).map(toReviewerView)))

  app.post('/api/admin/reviewers', async (c) => {
    const body = await jsonBody<{ email?: unknown; name?: unknown; languages?: unknown; role?: unknown }>(c)
    const email = String(body.email ?? '').trim().toLowerCase()
    const name = String(body.name ?? '').trim()
    const languages = languagesOf(body.languages)
    const role: Role = body.role === 'admin' ? 'admin' : 'reviewer'
    if (!EMAIL.test(email)) return apiError(c, 400, 'that is not an email address')
    if (name === '') return apiError(c, 400, 'a name is needed')
    if (!languages) return apiError(c, 400, `pick one or more of ${LANGUAGES.join(', ')}`)
    if (await getReviewer(deps.env.DB, email)) return apiError(c, 409, `${email} is already a reviewer`)
    const r: ReviewerRow = { email, name, languages, role, invitedAt: deps.now().toISOString(), inviteSentAt: null, disabledAt: null }
    await insertReviewer(deps.env.DB, r)
    const inviteSent = await invite(r)
    return c.json({ reviewer: toReviewerView((await getReviewer(deps.env.DB, email))!), inviteSent, link: deps.env.APP_ORIGIN }, 201)
  })

  app.patch('/api/admin/reviewers/:email', async (c) => {
    const r = await getReviewer(deps.env.DB, c.req.param('email'))
    if (!r) return apiError(c, 404, 'no such reviewer')
    const body = await jsonBody<{ name?: unknown; languages?: unknown; role?: unknown; disabled?: unknown }>(c)
    const self = r.email === c.get('me').email
    if (self && (body.disabled === true || body.role === 'reviewer')) return apiError(c, 400, 'you cannot disable or demote yourself')
    const patch: Parameters<typeof updateReviewer>[2] = {}
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (name === '') return apiError(c, 400, 'a name is needed')
      patch.name = name
    }
    if (body.languages !== undefined) {
      const languages = languagesOf(body.languages)
      if (!languages) return apiError(c, 400, `pick one or more of ${LANGUAGES.join(', ')}`)
      patch.languages = languages
      await closeAssignmentsWhere(deps, r.email, (a) => !languages.includes(languageOf(a.queue)!))
    }
    if (body.role === 'admin' || body.role === 'reviewer') patch.role = body.role
    if (body.disabled === true) {
      patch.disabledAt = deps.now().toISOString()
      await closeAssignmentsWhere(deps, r.email, () => true)
    }
    if (body.disabled === false) patch.disabledAt = null
    await updateReviewer(deps.env.DB, r.email, patch)
    const out: ReviewerView = toReviewerView((await getReviewer(deps.env.DB, r.email))!)
    return c.json(out)
  })

  app.post('/api/admin/reviewers/:email/invite', async (c) => {
    const r = await getReviewer(deps.env.DB, c.req.param('email'))
    if (!r) return apiError(c, 404, 'no such reviewer')
    return c.json({ inviteSent: await invite(r), link: deps.env.APP_ORIGIN })
  })
}
```

Note `updateReviewer`'s `disabledAt: null` must clear the column: its patch check is `!== undefined`, so `null`
writes NULL. Register `reviewersRoutes(app, deps)` **after** `adminRoutes` (so the admin middleware covers it).

- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): invite, edit and disable reviewers; Resend mail"
```

---

### Task 9: The GitHub App client

**Files:**
- Create: `review-app/worker/github.ts`, `review-app/worker/github.test.ts`, `review-app/worker/test/fakeGitHub.ts`

**Interfaces:**
- Consumes: `b64url`, `Deps`.
- Produces:
  - `appJwt(appId: string, pem: string, now: Date): Promise<string>` (throws a clear error on a PKCS#1 key)
  - `class GitHub { constructor(cfg: { api: string; appId: string; installationId: string; privateKeyPem: string; repo: string }, fetch: Deps['fetch'], now: () => Date) }` with
    `headSha(branch?: string): Promise<string>`, `readText(path: string, ref: string): Promise<string | null>`,
    `commitFiles(o: { parent: string; branch: string; message: string; author: { name: string; email: string }; files: readonly { path: string; content: string }[] }): Promise<{ commit: string } | { exists: true }>`,
    `openPr(o: { title: string; head: string; body: string }): Promise<{ number: number; url: string }>`,
    `prState(n: number): Promise<'open' | 'merged' | 'closed'>`
  - `githubFor(deps: Deps): GitHub | null` (null when `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_ID` or `GITHUB_INSTALLATION_ID` is missing)
  - `verifyWebhook(secret: string, body: string, signature: string | null): Promise<boolean>`
  - test: `class FakeGitHub { files: Map<string, string>; mainSha: string; branches: Map<string, string>; commits: Map<string, { tree: string; parents: string[]; message: string; author: { name: string; email: string }; files: Map<string, string> }>; pulls: { number: number; title: string; head: string; body: string; state: 'open' | 'closed'; merged: boolean }[]; fetch: Deps['fetch'] }`,
    `pkcs8Pem(key: CryptoKey): Promise<string>` and `testAppKey(): Promise<string>` (a PKCS#8 PEM for tests)

- [ ] **Step 1: Write the fake and the failing tests**

`review-app/worker/test/fakeGitHub.ts`:

```ts
import { b64url } from '../b64'

type Commit = { tree: string; parents: string[]; message: string; author: { name: string; email: string }; files: Map<string, string> }

/** The GitHub REST endpoints the Worker uses, in memory (spec §13). `files` is main's content. */
export class FakeGitHub {
  readonly files: Map<string, string>
  readonly branches = new Map<string, string>()
  readonly commits = new Map<string, Commit>()
  readonly trees = new Map<string, Map<string, string>>()
  readonly pulls: { number: number; title: string; head: string; body: string; state: 'open' | 'closed'; merged: boolean }[] = []
  private n = 0
  constructor(files: Record<string, string>, readonly repo = 'wordado/wordado-content') {
    this.files = new Map(Object.entries(files))
    this.trees.set('tree-main', new Map(this.files))
    this.commits.set('sha-main', { tree: 'tree-main', parents: [], message: 'main', author: { name: 'x', email: 'x' }, files: new Map(this.files) })
    this.branches.set('main', 'sha-main')
  }
  get mainSha(): string {
    return this.branches.get('main')!
  }
  /** Replaces a file on main with a new commit, as a merged pull request would. */
  pushToMain(path: string, content: string): void {
    const files = new Map(this.commits.get(this.mainSha)!.files)
    files.set(path, content)
    this.files.set(path, content)
    const sha = `sha-${++this.n}`
    this.commits.set(sha, { tree: `tree-${sha}`, parents: [this.mainSha], message: 'push', author: { name: 'x', email: 'x' }, files })
    this.branches.set('main', sha)
  }
  readonly fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input)
    const method = init.method ?? 'GET'
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
    const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })
    const p = url.pathname
    const repo = `/repos/${this.repo}`
    if (method === 'POST' && /^\/app\/installations\/\d+\/access_tokens$/.test(p)) return json({ token: 'inst-token', expires_at: '2099-01-01T00:00:00Z' }, 201)
    if (!(init.headers as Record<string, string> | undefined)?.['authorization']?.startsWith('Bearer ')) return json({ message: 'no auth' }, 401)
    let m: RegExpExecArray | null
    if (method === 'GET' && (m = new RegExp(`^${repo}/git/ref/heads/(.+)$`).exec(p))) {
      const sha = this.branches.get(decodeURIComponent(m[1]!))
      return sha ? json({ object: { sha } }) : json({ message: 'Not Found' }, 404)
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/contents/(.+)$`).exec(p))) {
      const ref = url.searchParams.get('ref') ?? this.mainSha
      const text = this.commits.get(ref)?.files.get(decodeURIComponent(m[1]!))
      return text === undefined ? json({ message: 'Not Found' }, 404) : new Response(text)
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/git/commits/(.+)$`).exec(p))) {
      const c = this.commits.get(m[1]!)
      return c ? json({ sha: m[1], tree: { sha: c.tree } }) : json({ message: 'Not Found' }, 404)
    }
    if (method === 'POST' && p === `${repo}/git/trees`) {
      const base = [...this.commits.values()].find((c) => c.tree === body['base_tree'])
      const files = new Map(base?.files ?? [])
      for (const e of body['tree'] as { path: string; content: string }[]) files.set(e.path, e.content)
      const sha = `tree-${++this.n}`
      this.trees.set(sha, files)
      return json({ sha }, 201)
    }
    if (method === 'POST' && p === `${repo}/git/commits`) {
      const sha = `sha-${++this.n}`
      this.commits.set(sha, { tree: String(body['tree']), parents: body['parents'] as string[], message: String(body['message']), author: body['author'] as Commit['author'], files: this.trees.get(String(body['tree']))! })
      return json({ sha }, 201)
    }
    if (method === 'POST' && p === `${repo}/git/refs`) {
      const branch = String(body['ref']).replace(/^refs\/heads\//, '')
      if (this.branches.has(branch)) return json({ message: 'Reference already exists' }, 422)
      this.branches.set(branch, String(body['sha']))
      return json({ ref: body['ref'] }, 201)
    }
    if (method === 'POST' && p === `${repo}/pulls`) {
      const number = this.pulls.length + 1
      this.pulls.push({ number, title: String(body['title']), head: String(body['head']), body: String(body['body']), state: 'open', merged: false })
      return json({ number, html_url: `https://github.com/${this.repo}/pull/${number}` }, 201)
    }
    if (method === 'GET' && (m = new RegExp(`^${repo}/pulls/(\\d+)$`).exec(p))) {
      const pr = this.pulls.find((x) => x.number === Number(m![1]))
      return pr ? json({ number: pr.number, state: pr.state, merged: pr.merged }) : json({ message: 'Not Found' }, 404)
    }
    return json({ message: `fake GitHub has no ${method} ${p}` }, 404)
  }
}

export async function pkcs8Pem(key: CryptoKey): Promise<string> {
  const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', key))
  const b64 = btoa(String.fromCharCode(...der))
  return `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END PRIVATE KEY-----\n`
}

export async function testAppKey(): Promise<{ pem: string; publicKey: CryptoKey }> {
  const pair = (await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'])) as CryptoKeyPair
  return { pem: await pkcs8Pem(pair.privateKey), publicKey: pair.publicKey }
}

export { b64url }
```

(`String.fromCharCode(...der)` is fine for a ~1.2 KB key.)

`review-app/worker/github.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { b64url } from './b64'
import { appJwt, GitHub, verifyWebhook } from './github'
import { FakeGitHub, testAppKey } from './test/fakeGitHub'

const now = new Date('2026-10-05T12:00:00Z')

describe('appJwt', () => {
  it('signs an RS256 JWT for the app, valid ten minutes at most', async () => {
    const { pem, publicKey } = await testAppKey()
    const jwt = await appJwt('123', pem, now)
    const [h, p, s] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(b64url.decodeText(h))).toEqual({ alg: 'RS256', typ: 'JWT' })
    const claims = JSON.parse(b64url.decodeText(p)) as { iss: string; iat: number; exp: number }
    expect(claims.iss).toBe('123')
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600)
    expect(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, b64url.decode(s), new TextEncoder().encode(`${h}.${p}`))).toBe(true)
  })
  it('explains a PKCS#1 key', async () => {
    await expect(appJwt('1', '-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----', now)).rejects.toThrow(/openssl pkcs8/)
  })
})

describe('GitHub', () => {
  const make = async (fake: FakeGitHub) => new GitHub({ api: 'https://api.github.test', appId: '1', installationId: '2', privateKeyPem: (await testAppKey()).pem, repo: fake.repo }, (i, init) => fake.fetch(i.replace('https://api.github.test', 'https://x'), init), () => now)

  it('reads a file at a commit, commits files on a new branch and opens a pull request', async () => {
    const fake = new FakeGitHub({ 'review/a.csv': 'old', 'review/b.csv': 'keep' })
    const gh = await make(fake)
    const head = await gh.headSha()
    expect(await gh.readText('review/a.csv', head)).toBe('old')
    expect(await gh.readText('review/none.csv', head)).toBeNull()
    const made = await gh.commitFiles({ parent: head, branch: 'review/x-1', message: 'm', author: { name: 'Анна', email: 'review@wordado.com' }, files: [{ path: 'review/a.csv', content: 'new' }] })
    expect('commit' in made).toBe(true)
    const commit = fake.commits.get(fake.branches.get('review/x-1')!)!
    expect(commit.files.get('review/a.csv')).toBe('new')
    expect(commit.files.get('review/b.csv')).toBe('keep')
    expect(commit.author.name).toBe('Анна')
    expect(await gh.commitFiles({ parent: head, branch: 'review/x-1', message: 'm', author: { name: 'A', email: 'e' }, files: [] })).toEqual({ exists: true })
    expect(await gh.openPr({ title: 't', head: 'review/x-1', body: 'b' })).toEqual({ number: 1, url: 'https://github.com/wordado/wordado-content/pull/1' })
    expect(await gh.prState(1)).toBe('open')
    fake.pulls[0]!.state = 'closed'
    fake.pulls[0]!.merged = true
    expect(await gh.prState(1)).toBe('merged')
  })
})

describe('verifyWebhook', () => {
  it('accepts GitHub’s sha256 HMAC and refuses anything else', async () => {
    const body = '{"action":"closed"}'
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('s3cret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    expect(await verifyWebhook('s3cret', body, `sha256=${sig}`)).toBe(true)
    expect(await verifyWebhook('s3cret', body, `sha256=${'0'.repeat(64)}`)).toBe(false)
    expect(await verifyWebhook('s3cret', body, null)).toBe(false)
    expect(await verifyWebhook('', body, `sha256=${sig}`)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** `review-app/worker/github.ts`:

```ts
import { b64url } from './b64'
import type { Deps } from './app'

export async function appJwt(appId: string, pem: string, now: Date): Promise<string> {
  if (pem.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is a PKCS#1 key; convert it first: openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem')
  }
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '')), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const iat = Math.floor(now.getTime() / 1000) - 60
  const head = b64url.encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body = b64url.encodeText(JSON.stringify({ iat, exp: iat + 540, iss: appId }))
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`))
  return `${head}.${body}.${b64url.encode(new Uint8Array(sig))}`
}

const tokens = new Map<string, { token: string; expires: number }>()

export interface GitHubConfig { readonly api: string; readonly appId: string; readonly installationId: string; readonly privateKeyPem: string; readonly repo: string }

/** The few GitHub REST calls Submit needs, as the GitHub App installed on wordado-content (spec §7, §10). */
export class GitHub {
  constructor(private readonly cfg: GitHubConfig, private readonly fetchFn: Deps['fetch'], private readonly now: () => Date) {}

  private async token(): Promise<string> {
    const hit = tokens.get(this.cfg.installationId)
    if (hit && hit.expires - this.now().getTime() > 300_000) return hit.token
    const res = await this.fetchFn(`${this.cfg.api}/app/installations/${this.cfg.installationId}/access_tokens`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await appJwt(this.cfg.appId, this.cfg.privateKeyPem, this.now())}`, accept: 'application/vnd.github+json', 'user-agent': 'wordado-review' },
    })
    if (!res.ok) throw new Error(`GitHub installation token: ${res.status}`)
    const body = (await res.json()) as { token: string; expires_at: string }
    tokens.set(this.cfg.installationId, { token: body.token, expires: Date.parse(body.expires_at) })
    return body.token
  }

  private async call(method: string, path: string, body?: unknown, accept = 'application/vnd.github+json'): Promise<Response> {
    const headers: Record<string, string> = { authorization: `Bearer ${await this.token()}`, accept, 'user-agent': 'wordado-review', 'x-github-api-version': '2022-11-28' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    return this.fetchFn(`${this.cfg.api}/repos/${this.cfg.repo}${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  }

  private async json<T>(res: Response, what: string): Promise<T> {
    if (!res.ok) throw new Error(`GitHub ${what}: ${res.status}`)
    return (await res.json()) as T
  }

  async headSha(branch = 'main'): Promise<string> {
    return (await this.json<{ object: { sha: string } }>(await this.call('GET', `/git/ref/heads/${encodeURIComponent(branch)}`), 'ref')).object.sha
  }

  async readText(path: string, ref: string): Promise<string | null> {
    const res = await this.call('GET', `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`, undefined, 'application/vnd.github.raw')
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`GitHub contents ${path}: ${res.status}`)
    return res.text()
  }

  async commitFiles(o: { parent: string; branch: string; message: string; author: { name: string; email: string }; files: readonly { path: string; content: string }[] }): Promise<{ commit: string } | { exists: true }> {
    const base = await this.json<{ tree: { sha: string } }>(await this.call('GET', `/git/commits/${o.parent}`), 'commit')
    const tree = await this.json<{ sha: string }>(
      await this.call('POST', '/git/trees', { base_tree: base.tree.sha, tree: o.files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }),
      'tree',
    )
    const commit = await this.json<{ sha: string }>(
      await this.call('POST', '/git/commits', { message: o.message, tree: tree.sha, parents: [o.parent], author: { ...o.author, date: this.now().toISOString() } }),
      'commit',
    )
    const ref = await this.call('POST', '/git/refs', { ref: `refs/heads/${o.branch}`, sha: commit.sha })
    if (ref.status === 422) return { exists: true }
    await this.json(ref, 'ref create')
    return { commit: commit.sha }
  }

  async openPr(o: { title: string; head: string; body: string }): Promise<{ number: number; url: string }> {
    const pr = await this.json<{ number: number; html_url: string }>(await this.call('POST', '/pulls', { ...o, base: 'main' }), 'pull request')
    return { number: pr.number, url: pr.html_url }
  }

  async prState(n: number): Promise<'open' | 'merged' | 'closed'> {
    const pr = await this.json<{ state: string; merged: boolean }>(await this.call('GET', `/pulls/${n}`), 'pull request')
    return pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed'
  }
}

export function githubFor(deps: Deps): GitHub | null {
  const e = deps.env
  if (!e.GITHUB_APP_PRIVATE_KEY || !e.GITHUB_APP_ID || !e.GITHUB_INSTALLATION_ID) return null
  return new GitHub({ api: e.GITHUB_API_URL ?? 'https://api.github.com', appId: e.GITHUB_APP_ID, installationId: e.GITHUB_INSTALLATION_ID, privateKeyPem: e.GITHUB_APP_PRIVATE_KEY, repo: e.CONTENT_REPO }, deps.fetch, deps.now)
}

/** GitHub's X-Hub-Signature-256 (spec §7.4). */
export async function verifyWebhook(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!secret || !signature?.startsWith('sha256=')) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const want = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const got = signature.slice('sha256='.length)
  if (got.length !== want.length) return false
  let diff = 0
  for (let i = 0; i < want.length; i += 1) diff |= want.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}
```

Export a `resetGitHubTokens()` (clears `tokens`) for tests.

- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): GitHub App client and webhook signature"
```

---

### Task 10: Submit, the webhook and submissions

**Files:**
- Create: `review-app/worker/submit.ts`, `review-app/worker/routes/submit.ts`, `review-app/worker/routes/submit.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 5, 8, 9 (`applyDecisions`, `rowHash`, db functions, `reviewMailer`, `GitHub`, `githubFor`, `verifyWebhook`, `FakeGitHub`).
- Produces:
  - `branchSlug(name: string, email: string): string` (lowercase ASCII `[a-z0-9-]`, from the name, else the email's local part, else `reviewer`)
  - `submit(deps: Deps, me: ReviewerRow, a: AssignmentRow, gh: GitHub, rules: QueueRules): Promise<SubmitResult | { status: 400; message: string }>`
  - Routes: `POST /api/submit` `{ assignment }` → `SubmitResult` (400 nothing to submit; 403; 502 `Could not reach GitHub, try again`; 503 GitHub not configured / no snapshot);
    `POST /api/github/webhook` (no Access, signature checked; 401 on a bad signature; 204 otherwise);
    `GET /api/admin/submissions` → `SubmissionView[]` (refreshes open ones from GitHub first, best effort)

- [ ] **Step 1: Write the failing tests**

`review-app/worker/routes/submit.test.ts`. Set-up: platform + keys + `putSnapshot` (keep `content` and `index`);
reviewers Ivan (`bg`, `en`) and the admin; assignment `id` for Ivan, `translation-bg`, `'*'`, flagged-only;
`fake = new FakeGitHub(files)` where `files` maps every `review/**` path under `content` to its text (walk the
directory); `env` gets `GITHUB_APP_PRIVATE_KEY = (await testAppKey()).pem`, `GITHUB_API_URL =
'https://api.github.test'`, `GITHUB_WEBHOOK_SECRET = 's3cret'`, `RESEND_API_KEY = 're_test'`; `deps.fetch` routes
`https://api.github.test/*` to `fake.fetch` (rewriting the origin) and records `https://api.resend.com/*` calls in
`mails`. Call `resetGitHubTokens()` and `resetSnapshotCache()` in `beforeEach`. Helpers `as(email, method, path,
body?)` and `decideFirst(n)` (decides the first `n` rows of the assignment with `keep`, returns them).

```ts
describe('POST /api/submit', () => {
  it('commits the decisions into the review files on one branch and opens a pull request', async () => {
    const rows = await decideFirst(2)
    const res = await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    expect(res.status).toBe(200)
    const out = (await res.json()) as SubmitResult
    expect(out).toMatchObject({ pr: 1, count: 2, leftOut: [] })
    const pr = fake.pulls[0]!
    expect(pr.title).toBe('translation-bg: 2 decisions by Ivan')
    expect(pr.head).toBe('review/translation-bg-ivan-20261005-1')
    const commit = fake.commits.get(fake.branches.get(pr.head)!)!
    expect(commit.message).toBe('review: translation-bg, 2 decisions by Ivan')
    expect(commit.author.name).toBe('Ivan')
    const text = commit.files.get(rows[0]!.file)!
    expect(csvRecords(text).rows.find((r) => r['key'] === rows[0]!.key)!['verdict']).toBe('ok')
    expect(mails.some((m) => m.to.includes('admin@example.com'))).toBe(true)
    const after = ((await (await as('ivan@example.com', 'GET', `/api/rows?assignment=${id}`)).json()) as RowsResponse).rows
    expect(after.find((r) => r.key === rows[0]!.key)!.decision!.submission).not.toBeNull()
  })

  it('leaves out a row whose proposal changed on main and submits the rest', async () => {
    const rows = await decideFirst(2)
    const sidecarPath = rows[0]!.file.replace(/\.csv$/, '.json')
    const sidecar = JSON.parse(fake.files.get(sidecarPath)!) as { items: { key: string; proposed: unknown }[] }
    sidecar.items = sidecar.items.map((i) => (i.key === rows[0]!.key ? { ...i, proposed: { changed: true } } : i))
    fake.pushToMain(sidecarPath, JSON.stringify(sidecar))
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect(out.count).toBe(1)
    expect(out.leftOut).toEqual([{ key: rows[0]!.key, reason: 'changed' }])
  })

  it('uses the next branch number when the branch exists, and the email for a non-ASCII name', async () => {
    await env.DB.prepare('UPDATE reviewers SET name = ? WHERE email = ?').bind('Анна "Ани" Петрова', 'ivan@example.com').run()
    fake.branches.set('review/translation-bg-ivan-20261005-1', 'sha-main')
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect(fake.pulls.at(-1)!.head).toBe('review/translation-bg-ivan-20261005-2')
    expect(fake.commits.get(fake.branches.get('review/translation-bg-ivan-20261005-2')!)!.author.name).toBe('Анна "Ани" Петрова')
    expect(out.count).toBe(1)
  })

  it('is 400 with nothing to submit, and 502 with nothing recorded when GitHub fails', async () => {
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(400)
    await decideFirst(1)
    failGitHub = true
    expect((await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).status).toBe(502)
    expect(await listSubmissions(env.DB)).toHaveLength(0)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
  })
})

describe('webhook and submissions', () => {
  const hook = async (payload: unknown, secret = 's3cret') => {
    const body = JSON.stringify(payload)
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('')
    return createApp(deps).request('/api/github/webhook', { method: 'POST', headers: { 'x-github-event': 'pull_request', 'x-hub-signature-256': `sha256=${sig}`, 'content-type': 'application/json' }, body })
  }

  it('a closed, unmerged pull request puts its decisions back to unsubmitted', async () => {
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    expect((await hook({ action: 'closed', pull_request: { number: out.pr, merged: false } })).status).toBe(204)
    expect((await listDecisions(env.DB, id)).every((d) => d.submission === null)).toBe(true)
    expect((await listSubmissions(env.DB))[0]!.status).toBe('closed')
  })
  it('a merged one is marked merged', async () => {
    await decideFirst(1)
    const out = (await (await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })).json()) as SubmitResult
    await hook({ action: 'closed', pull_request: { number: out.pr, merged: true } })
    expect((await listSubmissions(env.DB))[0]!.status).toBe('merged')
  })
  it('refuses a bad signature', async () => {
    expect((await hook({ action: 'closed', pull_request: { number: 1, merged: true } }, 'wrong')).status).toBe(401)
  })
  it('the admin list refreshes open submissions from GitHub', async () => {
    await decideFirst(1)
    await as('ivan@example.com', 'POST', '/api/submit', { assignment: id })
    fake.pulls[0]!.state = 'closed'
    const list = (await (await as('admin@example.com', 'GET', '/api/admin/submissions')).json()) as SubmissionView[]
    expect(list[0]).toMatchObject({ status: 'closed', reviewerName: expect.any(String), queue: 'translation-bg', url: 'https://github.com/wordado/wordado-content/pull/1' })
  })
})
```

Also unit-test `branchSlug` in the same file: `branchSlug('Ivan Petrov', 'x@example.com') === 'ivan-petrov'`,
`branchSlug('Анна', 'anna.k@example.com') === 'anna-k'`, `branchSlug('***', '!!@example.com') === 'reviewer'`.

- [ ] **Step 2: Run to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

`review-app/worker/submit.ts`:

```ts
import { csvRecords } from '@wordado/pipeline/csv'
import { applyDecisions, type QueueRules } from '../shared/apply'
import type { SubmitResult } from '../shared/hosted'
import { rowHash } from '../shared/rowHash'
import type { Deps } from './app'
import { insertSubmission, listDecisions, listReviewers, listSubmissions, markSubmitted, type AssignmentRow, type DecisionRow, type ReviewerRow } from './db'
import type { GitHub } from './github'
import { reviewMailer } from './mail'

export function branchSlug(name: string, email: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug(name) || slug(email.split('@')[0] ?? '') || 'reviewer'
}

const AUTHOR_EMAIL = 'review@wordado.com'

/** Spec §7.2: the assignment's unsubmitted decisions, checked against main, as one commit and one pull request. */
export async function submit(deps: Deps, me: ReviewerRow, a: AssignmentRow, gh: GitHub, rules: QueueRules): Promise<SubmitResult | { status: 400; message: string }> {
  const pending = (await listDecisions(deps.env.DB, a.id)).filter((d) => d.submission === null)
  if (pending.length === 0) return { status: 400, message: 'nothing to submit' }
  const head = await gh.headSha()
  const byFile = new Map<string, DecisionRow[]>()
  for (const d of pending) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
  const leftOut: { key: string; reason: 'changed' | 'gone' }[] = []
  const files: { path: string; content: string }[] = []
  const sent: DecisionRow[] = []
  for (const [file, decisions] of byFile) {
    const csv = await gh.readText(file, head)
    const sidecarText = await gh.readText(file.replace(/\.csv$/, '.json'), head)
    if (csv === null || sidecarText === null) {
      for (const d of decisions) leftOut.push({ key: d.key, reason: 'gone' })
      continue
    }
    const proposals = new Map((JSON.parse(sidecarText) as { items: { key: string; proposed: unknown }[] }).items.map((i) => [i.key, i.proposed]))
    const reopened = new Map(csvRecords(csv).rows.map((r) => [(r['key'] ?? '').trim(), r['reopened'] ?? '']))
    const ok: DecisionRow[] = []
    for (const d of decisions) {
      if (!proposals.has(d.key) || !reopened.has(d.key)) leftOut.push({ key: d.key, reason: 'gone' })
      else if ((await rowHash(a.queue, proposals.get(d.key), reopened.get(d.key)!)) !== d.rowHash) leftOut.push({ key: d.key, reason: 'changed' })
      else ok.push(d)
    }
    if (ok.length === 0) continue
    const out = applyDecisions(csv, rules, ok.map((d) => ({ key: d.key, action: d.action, cells: d.cells, note: d.note })))
    files.push({ path: file, content: out.text })
    sent.push(...ok.filter((d) => out.applied.includes(d.key)))
  }
  if (sent.length === 0) return { status: 400, message: `nothing could be submitted: ${leftOut.length} rows changed or are gone` }

  const day = deps.now().toISOString().slice(0, 10).replaceAll('-', '')
  const base = `review/${a.queue}-${branchSlug(me.name, me.email)}-${day}`
  const message = `review: ${a.queue}, ${sent.length} decisions by ${me.name}`
  let n = (await listSubmissions(deps.env.DB, { assignment: a.id })).filter((s) => s.branch.startsWith(`${base}-`)).length + 1
  let branch = `${base}-${n}`
  for (;;) {
    const made = await gh.commitFiles({ parent: head, branch, message, author: { name: me.name, email: AUTHOR_EMAIL }, files })
    if ('commit' in made) break
    n += 1
    if (n > 20) throw new Error('could not find a free branch name')
    branch = `${base}-${n}`
  }
  const counts = (['accept', 'keep', 'edit', 'drop'] as const).map((k) => `${k} ${sent.filter((d) => d.action === k).length}`).join(', ')
  const perFile = files.map((f) => `- ${f.path}: ${sent.filter((d) => d.file === f.path).length}`).join('\n')
  const notes = sent.filter((d) => d.note !== '').map((d) => `- ${d.key}: ${d.note}`).join('\n')
  const body = `Submitted by ${me.name} in the review app.\n\n${counts}\n\n${perFile}${notes ? `\n\nNotes:\n${notes}` : ''}${leftOut.length ? `\n\nLeft out (changed or gone since decided): ${leftOut.map((l) => l.key).join(', ')}` : ''}`
  const pr = await gh.openPr({ title: `${a.queue}: ${sent.length} decisions by ${me.name}`, head: branch, body })
  const submission = await insertSubmission(deps.env.DB, { assignment: a.id, branch, pr: pr.number, url: pr.url, count: sent.length, leftOut: leftOut.length, status: 'open', createdAt: deps.now().toISOString() })
  await markSubmitted(deps.env.DB, a.id, sent.map((d) => d.key), submission)
  const admins = (await listReviewers(deps.env.DB)).filter((r) => r.role === 'admin' && !r.disabledAt).map((r) => r.email)
  try {
    await reviewMailer(deps).submitted(admins, { name: me.name, count: sent.length, queue: a.queue, url: pr.url })
  } catch (err) {
    deps.log(`submit notice not sent: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { pr: pr.number, url: pr.url, count: sent.length, leftOut }
}
```

Note on spec §7.2 step 4 ("a branch left behind without a pull request"): if `openPr` throws after the branch was
created, nothing is recorded; the next Submit finds the branch taken (422) and moves to the next number.

`review-app/worker/routes/submit.ts`:

```ts
import type { Hono } from 'hono'
import type { SubmissionView } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { getAssignment, listSubmissions, setSubmissionStatus, submissionByPr, unsubmit } from '../db'
import { githubFor, verifyWebhook } from '../github'
import { currentSnapshot } from '../snapshotStore'
import { submit } from '../submit'
import { NO_SNAPSHOT, ownAssignment, reviewerNames } from './reviewer'

export function submitRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/api/submit', async (c) => {
    const req = await jsonBody<{ assignment?: unknown }>(c)
    const me = c.get('me')
    const a = await ownAssignment(deps, me.email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    const rules = snap?.queue(a.queue)
    if (!rules) return apiError(c, 503, NO_SNAPSHOT)
    const gh = githubFor(deps)
    if (!gh) return apiError(c, 503, 'GitHub is not configured for the review app')
    try {
      const out = await submit(deps, me, a, gh, rules)
      return 'status' in out ? apiError(c, out.status, out.message) : c.json(out)
    } catch (err) {
      deps.log(`submit failed: ${err instanceof Error ? err.message : String(err)}`)
      return c.json({ message: 'Could not reach GitHub, try again' }, 502)
    }
  })

  app.post('/api/github/webhook', async (c) => {
    const body = await c.req.text()
    if (!(await verifyWebhook(deps.env.GITHUB_WEBHOOK_SECRET ?? '', body, c.req.header('x-hub-signature-256') ?? null))) return apiError(c, 401, 'bad signature')
    if (c.req.header('x-github-event') !== 'pull_request') return c.body(null, 204)
    const event = JSON.parse(body) as { action?: string; pull_request?: { number?: number; merged?: boolean } }
    if (event.action !== 'closed' || typeof event.pull_request?.number !== 'number') return c.body(null, 204)
    const s = await submissionByPr(deps.env.DB, event.pull_request.number)
    if (s && s.status === 'open') await closeSubmission(deps, s.id, event.pull_request.merged === true)
    return c.body(null, 204)
  })

  app.get('/api/admin/submissions', async (c) => {
    const gh = githubFor(deps)
    for (const s of await listSubmissions(deps.env.DB, { status: 'open' })) {
      if (!gh || s.pr === null) continue
      try {
        const state = await gh.prState(s.pr)
        if (state !== 'open') await closeSubmission(deps, s.id, state === 'merged')
      } catch (err) {
        deps.log(`refresh of pull request ${s.pr} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    const names = await reviewerNames(deps)
    const out: SubmissionView[] = []
    for (const s of await listSubmissions(deps.env.DB)) {
      const a = (await getAssignment(deps.env.DB, s.assignment))!
      out.push({ id: s.id, assignment: s.assignment, reviewer: a.reviewer, reviewerName: names.get(a.reviewer) ?? a.reviewer, queue: a.queue, branch: s.branch, pr: s.pr, url: s.url, count: s.count, leftOut: s.leftOut, status: s.status, createdAt: s.createdAt })
    }
    return c.json(out)
  })
}

async function closeSubmission(deps: Deps, id: number, merged: boolean): Promise<void> {
  await setSubmissionStatus(deps.env.DB, id, merged ? 'merged' : 'closed')
  if (!merged) await unsubmit(deps.env.DB, id)
}
```

Register `submitRoutes(app, deps)` **before** `adminRoutes` would also be fine, but the admin route
`/api/admin/submissions` must be covered by the admin middleware: register `submitRoutes` **after** `adminRoutes`.
The webhook is in `MACHINE_PATHS` (Task 3), so neither Origin nor Access applies to it.

- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): submit as a pull request, webhook, submissions"
```

---

### Task 11: UI: shared review screen and the reviewer's hosted mode

**Files:**
- Create: `review-app/src/ReviewScreen.tsx`, `review-app/src/Root.tsx`, `review-app/src/hostedApi.ts`,
  `review-app/src/hosted/HostedApp.tsx`, `review-app/src/hosted/Assignments.tsx`, `review-app/src/hosted/AssignmentReview.tsx`
- Create: `review-app/src/hostedApi.test.ts`, `review-app/src/hosted/HostedApp.test.tsx`
- Modify: `review-app/src/App.tsx` (renders `ReviewScreen`), `review-app/src/main.tsx` (renders `Root`),
  `review-app/src/app.css` (Settings-look classes)

**Interfaces:**
- Consumes: Task 1 hosted types; the API of Tasks 4–6 and 10.
- Produces:
  - `ReviewScreen(props: { rows: readonly RowView[]; onDecide(row: RowView, action: Action, cells: Record<string, string>, note: string): Promise<string | null>; onReload(): Promise<void>; controls?: ReactNode; actions?: ReactNode; notice?: string; who?: string })` — the filters (level, severity), the decided count, the list, the panel and the keys. `onDecide` resolves to a notice to show (or null) and the screen then reloads and moves on when the notice is null.
  - `hostedApi`: `me(): Promise<{ kind: 'local' } | { kind: 'me'; me: Me } | { kind: 'denied'; message: string } | { kind: 'signedOut' }>`,
    `assignments()`, `rows(id)`, `decide(req: HostedDecisionRequest): Promise<DecisionResult>`, `undo(assignment, key)`, `submit(id): Promise<SubmitResult>`,
    and `admin.*` (Task 12 uses them): `reviewers()`, `invite(body)`, `patchReviewer(email, patch)`, `resendInvite(email)`,
    `assignments()`, `assign(body)`, `close(id)`, `reassign(id, to, decisions)`, `split(body)`, `submissions()`, `snapshot()`

- [ ] **Step 1: Write the failing tests**

`review-app/src/hostedApi.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from './hostedApi'

afterEach(() => vi.unstubAllGlobals())
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('hostedApi.me', () => {
  it('is local on 404, signed out on 401, denied with the message on 403', async () => {
    respond(404, { message: 'no such API' })
    expect(await hostedApi.me()).toEqual({ kind: 'local' })
    respond(401, { message: 'sign in again' })
    expect(await hostedApi.me()).toEqual({ kind: 'signedOut' })
    respond(403, { message: 'no invitation' })
    expect(await hostedApi.me()).toEqual({ kind: 'denied', message: 'no invitation' })
    respond(200, { email: 'a@example.com', name: 'A', role: 'reviewer', languages: ['de'] })
    expect(await hostedApi.me()).toMatchObject({ kind: 'me', me: { name: 'A' } })
  })
})

describe('hostedApi.decide', () => {
  it('returns 409 and 410 bodies as results and throws on 5xx', async () => {
    respond(409, { ok: false, reason: 'changed', message: 'changed' })
    expect(await hostedApi.decide({ assignment: 1, queue: 'q', file: 'f', key: 'k', rowHash: 'h', action: 'keep' })).toMatchObject({ reason: 'changed' })
    respond(500, { message: 'internal error' })
    await expect(hostedApi.decide({ assignment: 1, queue: 'q', file: 'f', key: 'k', rowHash: 'h', action: 'keep' })).rejects.toThrow('internal error')
  })
})
```

`review-app/src/hosted/HostedApp.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { HostedApp } from './HostedApp'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const me = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const] }
const progress = { inScope: 2, decided: 0, changed: 0, submitted: 0, merged: 0, remaining: 2 }
const assignment = { id: 7, reviewer: me.email, reviewerName: 'Anna', queue: 'translation-de', files: '*' as const, flaggedOnly: true, createdAt: 't', closedAt: null, progress }
const row = (key: string, over = {}) => ({
  queue: 'translation-de', file: 'review/translation-de/a.csv', version: 'v', key, kind: 'translation' as const, cells: { translation: 'Ufer' }, fields: ['translation'],
  context: { level: 'A1' }, otherSenses: [], reports: '', ai: 'flagged' as const, severity: 'major' as const, objections: [], decided: null, stale: false, rowHash: `h-${key}`, decision: null, ...over,
})

describe('HostedApp', () => {
  it('lists my assignments and opens one', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2')], discarded: [] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    expect(await screen.findByRole('article', { name: 'Row bank-2' })).toBeTruthy()
  })

  it('decides with the row hash and submits', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    const rows = vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2'), row('bank-3')], discarded: [] })
    const decide = vi.spyOn(hostedApi, 'decide').mockResolvedValue({ ok: true, version: 'h-bank-2' })
    const submit = vi.spyOn(hostedApi, 'submit').mockResolvedValue({ pr: 12, url: 'https://github.com/x/pull/12', count: 1, leftOut: [] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    await screen.findByRole('article', { name: 'Row bank-2' })
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }))
    await waitFor(() => expect(decide).toHaveBeenCalledWith(expect.objectContaining({ assignment: 7, key: 'bank-2', rowHash: 'h-bank-2', action: 'keep' })))
    rows.mockResolvedValue({ rows: [row('bank-2', { decided: { verdict: 'ok', note: '' }, decision: { action: 'keep', cells: {}, note: '', submission: null, changed: false } }), row('bank-3')], discarded: [] })
    fireEvent.click(await screen.findByRole('button', { name: /Submit 1 decision/ }))
    await waitFor(() => expect(submit).toHaveBeenCalledWith(7))
    expect(await screen.findByRole('link', { name: /pull request 12/i })).toBeTruthy()
  })

  it('says when a decided row changed and when decisions were discarded', async () => {
    vi.spyOn(hostedApi, 'assignments').mockResolvedValue([assignment])
    vi.spyOn(hostedApi, 'rows').mockResolvedValue({ rows: [row('bank-2', { decision: { action: 'keep', cells: {}, note: '', submission: null, changed: true } })], discarded: ['gone-1'] })
    render(<HostedApp me={me} />)
    fireEvent.click(await screen.findByRole('button', { name: /translation-de/ }))
    expect(await screen.findByText(/gone-1/)).toBeTruthy()
    expect(await screen.findByText(/Changed since you decided it/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run to see them fail.**

Run: `pnpm --filter @wordado/review-app test -- --project ui`
Expected: FAIL (new modules missing); the existing `App.test.tsx` still passes.

- [ ] **Step 3: Implement**

1. **Extract `ReviewScreen` from `App.tsx`.** Move into `ReviewScreen.tsx` everything from the `level`/`severity`
   state through `useKeys(keys)` and the `<main>` block: `shown`, `row`, `move`, `next`, `prev`, `saving`,
   `handleDecide`, the level and severity `<select>`s, `{decided} of {rows.length} decided`, the notice paragraph
   and `<main>…</main>`. Its `decide` becomes:

   ```tsx
   const decide = useCallback(
     async (action: Action, cells: Record<string, string>, note: string) => {
       if (!row || saving) return
       setSaving(true)
       try {
         const message = await props.onDecide(row, action, cells, note)
         setNotice(message ?? '')
         await props.onReload()
         if (message === null) next()
       } catch (err) {
         setNotice(err instanceof Error ? err.message : String(err))
       } finally {
         setSaving(false)
       }
     },
     [row, saving, props, next],
   )
   ```

   The header renders `{props.controls}`, the two filters, the decided count, `{props.who}` (muted) and
   `{props.actions}`; a `props.notice` from the parent is shown when the screen's own notice is empty. Selection
   keeps today's rule (`cur` if still present, else the first undecided).

   `App.tsx` keeps its reviewer-name prompt, queue state, `all` checkbox, `load` and *Import decisions*, and
   renders `<ReviewScreen rows={rows} onDecide={...} onReload={load} controls={<>queue select, show unflagged</>} actions={<button>Import decisions</button>} notice={notice} who={reviewer} />`
   with `onDecide` mapping today's result (`!res.ok` → `res.reason === 'invalid' ? res.message : 'This file changed; reloaded.'`, ok → `null`). The existing `App.test.tsx` and
   `e2e/review.spec.ts` must pass unchanged.

2. **`hostedApi.ts`** — same `checked` helper as `api.ts` (copy it; do not export it from `api.ts`), plus:

   ```ts
   const send = async <T,>(method: string, path: string, body: unknown): Promise<T> =>
     checked(await fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })) as Promise<T>

   export const hostedApi = {
     async me(): Promise<{ kind: 'local' } | { kind: 'me'; me: Me } | { kind: 'denied'; message: string } | { kind: 'signedOut' }> {
       const res = await fetch('/api/me')
       const body: unknown = await res.json().catch(() => null)
       if (res.status === 404) return { kind: 'local' }
       if (res.status === 401) return { kind: 'signedOut' }
       if (res.status === 403) return { kind: 'denied', message: (body as { message?: string } | null)?.message ?? 'No invitation.' }
       if (!res.ok) throw new Error(`request failed (${res.status})`)
       return { kind: 'me', me: body as Me }
     },
     assignments: () => get<AssignmentView[]>('/api/assignments'),
     rows: (id: number) => get<RowsResponse>(`/api/rows?assignment=${id}`),
     async decide(req: HostedDecisionRequest): Promise<DecisionResult> { /* as api.ts's decide, path /api/decision */ },
     undo: (assignment: number, key: string) => send<{ ok: true }>('DELETE', '/api/decision', { assignment, key }),
     submit: (assignment: number) => send<SubmitResult>('POST', '/api/submit', { assignment }),
     admin: {
       reviewers: () => get<ReviewerView[]>('/api/admin/reviewers'),
       invite: (b: { email: string; name: string; languages: Language[]; role?: Role }) => send<{ reviewer: ReviewerView; inviteSent: boolean; link: string }>('POST', '/api/admin/reviewers', b),
       patchReviewer: (email: string, patch: { name?: string; languages?: Language[]; role?: Role; disabled?: boolean }) => send<ReviewerView>('PATCH', `/api/admin/reviewers/${encodeURIComponent(email)}`, patch),
       resendInvite: (email: string) => send<{ inviteSent: boolean; link: string }>('POST', `/api/admin/reviewers/${encodeURIComponent(email)}/invite`, {}),
       assignments: () => get<AssignmentView[]>('/api/admin/assignments'),
       assign: (b: { reviewer: string; queue: string; files: string[] | '*'; flaggedOnly: boolean }) => send<AssignmentView>('POST', '/api/admin/assignments', b),
       close: (id: number) => send<AssignmentView>('POST', `/api/admin/assignments/${id}/close`, {}),
       reassign: (id: number, to: string, decisions: 'move' | 'discard') => send<AssignmentView>('POST', `/api/admin/assignments/${id}/reassign`, { to, decisions }),
       split: (b: { queue: string; flaggedOnly: boolean; reviewers: string[]; confirm?: boolean; proposal?: SplitProposal[] }) =>
         send<{ proposal?: SplitProposal[]; assignments?: AssignmentView[] }>('POST', '/api/admin/assignments/split', b),
       submissions: () => get<SubmissionView[]>('/api/admin/submissions'),
       snapshot: () => get<SnapshotStatus | null>('/api/admin/snapshot'),
     },
   }
   ```

3. **`Root.tsx`**: calls `hostedApi.me()` once; renders `<App />` for `local`, `<HostedApp me={me} />` for `me`,
   for `denied` a centered panel with the message and "Ask the coordinator for an invitation.", for `signedOut` a
   panel "Your sign-in expired." with a link "Sign in again" to `/`. `main.tsx` renders `<Root />`.

4. **`hosted/HostedApp.tsx`**: state `view: { kind: 'list' } | { kind: 'review'; assignment: AssignmentView } | { kind: 'admin' }`.
   Header bar: "Wordado review", the reviewer's name, and for an admin an **Admin** button (Task 12 fills
   `<Admin />`; in this task render a placeholder `<p>Admin</p>` that Task 12 replaces). `list` → `<Assignments>`;
   `review` → `<AssignmentReview>` with a **Back to my assignments** button.

5. **`hosted/Assignments.tsx`**: loads `hostedApi.assignments()`; renders a `<ul className="settings-rows">` of
   `<button className="settings-row">` per assignment, each with `settings-row-title` = queue (e.g.
   `translation-de`), and a note line: scope (`flagged rows` or `all rows`, and `all files` or `N files`) and progress
   (`12 decided · 3 submitted · 40 to go`); clicking opens it. No assignments → "Nothing is assigned to you yet."
   When `progress` is null (no snapshot): "The review data is not available yet."

6. **`hosted/AssignmentReview.tsx`**: loads `hostedApi.rows(a.id)`; keeps `rows` and a `notice`. When
   `discarded` is non-empty: notice `Removed decisions on rows that are gone: gone-1, …`. Passes to
   `ReviewScreen`:
   - `rows` (as returned; a row whose `decision?.changed` is true has `decided: null` already, and the row panel
     shows a `stale-notice` line **Changed since you decided it** above the panel: render it in
     `AssignmentReview` above `ReviewScreen` when the selected row is changed — simplest: show a notice line
     `Changed since you decided it: <keys>` listing every changed key, above the screen),
   - `onDecide(row, action, cells, note)` → `hostedApi.decide({ assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action, cells, note })`;
     `ok` → null; `changed` → `'This row changed; reloaded.'`; `gone` → `'This row is gone; reloaded.'`; `invalid` → its message,
   - `actions`: **Submit N decision(s)** (N = rows with a decision, not changed, `submission === null`; disabled at
     0), which calls `hostedApi.submit(a.id)` then shows: `Sent as ` + `<a href={url} target="_blank" rel="noreferrer">pull request {pr}</a>`
     + ` (${count} decisions)` and, when `leftOut` is non-empty, `Left out because they changed: k1, k2`; then reloads.
   - `controls`: the queue name and the scope.

7. **CSS**: add to `app.css` the Settings look for the hosted screens, adapted to the review app's tokens:
   `.panel` (background `var(--panel)`, border, radius 1rem, padding), `.settings-rows`/`.settings-row`/
   `.settings-row-title`/`.settings-row-text .note` (from `web/src/styles.css`, replacing `--paper-raised` →
   `--bg`, `--rule` → `--border`, `--ink` → `--fg`, `--paper` → `--panel`, spacing variables → rem values),
   `.segmented` (inline-flex group of buttons, the pressed one `aria-pressed="true"` filled with `--accent`),
   `.field` (label above control, 0.75rem gap) and `.note` (muted, 0.875rem). Use these classes in the hosted
   screens; the local screen keeps its look.

- [ ] **Step 4: Run all review-app tests and the local e2e**

Run: `pnpm --filter @wordado/review-app test && pnpm --filter @wordado/review-app e2e && pnpm --filter @wordado/review-app typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): hosted reviewer screens on a shared review screen"
```

---

### Task 12: UI: the admin page

**Files:**
- Create: `review-app/src/hosted/Admin.tsx`, `AdminReviewers.tsx`, `AdminAssignments.tsx`, `AdminSubmissions.tsx`
- Create: `review-app/src/hosted/Admin.test.tsx`
- Modify: `review-app/src/hosted/HostedApp.tsx` (renders `<Admin />` for the admin view)

**Interfaces:**
- Consumes: `hostedApi.admin.*`, hosted types, `LANGUAGES`, `LANGUAGE_NAMES`, `languageOf`.
- Produces: `Admin()` with four `panel` sections in this order: **Review data** (snapshot), **Reviewers**,
  **Assignments**, **Submissions**. Every action reloads the affected section and shows the server's message on
  failure in a `role="status"` notice.

- [ ] **Step 1: Write the failing tests** — `review-app/src/hosted/Admin.test.tsx`:

```tsx
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hostedApi } from '../hostedApi'
import { Admin } from './Admin'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const snapshot = {
  id: 'abc-1', built: '2026-10-05T10:00:00Z', commit: 'abcdef1',
  queues: [{ queue: 'translation-de', language: 'de' as const, files: [
    { file: 'review/translation-de/a.csv', rows: 200, flagged: 9, reported: 0, assignedTo: null },
    { file: 'review/translation-de/b.csv', rows: 180, flagged: 4, reported: 1, assignedTo: 'Hans' },
  ] }],
}
const anna = { email: 'anna@example.com', name: 'Anna', role: 'reviewer' as const, languages: ['de' as const], invitedAt: 't', inviteSentAt: null, disabledAt: null }

beforeEach(() => {
  vi.spyOn(hostedApi.admin, 'snapshot').mockResolvedValue(snapshot)
  vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna])
  vi.spyOn(hostedApi.admin, 'assignments').mockResolvedValue([])
  vi.spyOn(hostedApi.admin, 'submissions').mockResolvedValue([])
})

describe('Admin', () => {
  it('shows the snapshot and who holds each file', async () => {
    render(<Admin />)
    expect(await screen.findByText(/abcdef1/)).toBeTruthy()
    expect(await screen.findByText(/Hans/)).toBeTruthy()
  })

  it('invites a reviewer and shows the link when the mail failed', async () => {
    const invite = vi.spyOn(hostedApi.admin, 'invite').mockResolvedValue({ reviewer: { ...anna, email: 'b@example.com', name: 'B' }, inviteSent: false, link: 'https://review.wordado.com' })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Invite a reviewer' })
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: 'b@example.com' } })
    fireEvent.change(within(form).getByLabelText('Name'), { target: { value: 'B' } })
    fireEvent.click(within(form).getByLabelText('German'))
    fireEvent.click(within(form).getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(invite).toHaveBeenCalledWith({ email: 'b@example.com', name: 'B', languages: ['de'], role: 'reviewer' }))
    expect(await screen.findByText(/invite not sent/i)).toBeTruthy()
    expect(screen.getByText('https://review.wordado.com')).toBeTruthy()
  })

  it('assigns free files of a queue in the reviewer’s language', async () => {
    const assign = vi.spyOn(hostedApi.admin, 'assign').mockResolvedValue({ id: 1, reviewer: anna.email, reviewerName: 'Anna', queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false, createdAt: 't', closedAt: null, progress: null })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Assign' })
    fireEvent.change(within(form).getByLabelText('Reviewer'), { target: { value: anna.email } })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    expect(within(form).getByLabelText(/b\.csv/).hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(form).getByLabelText(/a\.csv/))
    fireEvent.click(within(form).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(assign).toHaveBeenCalledWith({ reviewer: anna.email, queue: 'translation-de', files: ['review/translation-de/a.csv'], flaggedOnly: false }))
  })

  it('proposes a split and confirms it', async () => {
    vi.spyOn(hostedApi.admin, 'reviewers').mockResolvedValue([anna, { ...anna, email: 'hans@example.com', name: 'Hans' }])
    const split = vi.spyOn(hostedApi.admin, 'split')
      .mockResolvedValueOnce({ proposal: [{ reviewer: anna.email, files: ['review/translation-de/a.csv'], rows: 200 }, { reviewer: 'hans@example.com', files: ['review/translation-de/c.csv'], rows: 190 }] })
      .mockResolvedValueOnce({ assignments: [] })
    render(<Admin />)
    const form = await screen.findByRole('form', { name: 'Split a queue' })
    fireEvent.change(within(form).getByLabelText('Queue'), { target: { value: 'translation-de' } })
    fireEvent.click(within(form).getByLabelText('Anna'))
    fireEvent.click(within(form).getByLabelText('Hans'))
    fireEvent.click(within(form).getByRole('button', { name: 'Propose' }))
    expect(await within(form).findByText(/200 rows/)).toBeTruthy()
    fireEvent.click(within(form).getByRole('button', { name: 'Create these assignments' }))
    await waitFor(() => expect(split).toHaveBeenLastCalledWith(expect.objectContaining({ confirm: true, proposal: expect.any(Array) })))
  })

  it('disables a reviewer after confirming', async () => {
    const patch = vi.spyOn(hostedApi.admin, 'patchReviewer').mockResolvedValue({ ...anna, disabledAt: 't' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<Admin />)
    fireEvent.click(await screen.findByRole('button', { name: 'Disable Anna' }))
    await waitFor(() => expect(patch).toHaveBeenCalledWith(anna.email, { disabled: true }))
  })
})
```

- [ ] **Step 2: Run to see them fail.** Expected: FAIL.

- [ ] **Step 3: Implement** the four components:

- **`Admin.tsx`**: loads `snapshot`, `reviewers`, `assignments`, `submissions` in parallel; passes data and a
  `reload()` to the sections; one `notice` state rendered as `<p role="status" className="notice">`. Section
  **Review data**: "Built <date> from <commit 7 chars>" and, per queue, `queue: N files, R rows, F flagged`, with
  a `<details>` listing files and `assignedTo` (or "free"). `null` snapshot → "No review data yet: the
  review-snapshot workflow has not run."
- **`AdminReviewers.tsx`**: a `<form aria-label="Invite a reviewer">` with **Email**, **Name**, language
  checkboxes labelled by `LANGUAGE_NAMES` (`Bulgarian`, `German`, `Spanish`, `English levels`), and an **Admin**
  checkbox (role); submit button **Invite**. On success with `inviteSent: false` show "Invite not sent: send this
  link yourself" and the link as text. The list (`settings-rows`): per reviewer, name, email, languages, status
  (`invited, not sent` / `invited <date>` / `disabled`), and buttons **Resend invite**, **Edit languages**
  (inline checkboxes + **Save** → `patchReviewer(email, { languages })`), and **Disable <name>** /
  **Enable <name>** (`aria-label` exactly `Disable Anna`; confirm with `window.confirm('Disable Anna? Their open
  assignments close; decisions they have not submitted are kept.')`).
- **`AdminAssignments.tsx`**:
  - `<form aria-label="Assign">`: **Reviewer** select (active reviewers, value = email), **Queue** select (queues
    in the snapshot whose `languageOf(queue)` is one of the reviewer's languages), a `segmented` control
    **All rows** / **Flagged rows only** (default All rows), an **All files** checkbox, and one checkbox per file
    labelled `<file name> · <rows> rows · <flagged> flagged`, **disabled** when `assignedTo` is not null (its
    label then ends with `· <assignedTo>`). **Assign** sends `files: '*'` when All files is ticked, else the ticked
    paths.
  - `<form aria-label="Split a queue">`: **Queue** select, the same segmented control, one checkbox per active
    reviewer with that queue's language (label = name), **Propose** → shows the proposal as a list (`<name>:
    <n> files, <rows> rows`) with, per file, a select to move it to another reviewer in the proposal (recomputing
    the rows sum from the snapshot's counts), then **Create these assignments** → `split({ ..., confirm: true, proposal })`.
  - The list: open assignments first (`settings-rows`), each: reviewer name, queue, scope, progress
    (`decided · changed · submitted · merged · to go`), and **Close** (confirm "Close this assignment? Its
    unsubmitted decisions are kept for a later reassignment.") and **Reassign…** (a select of active reviewers
    with the queue's language, a `segmented` **Move their decisions** / **Discard them**, **Reassign**). Closed
    ones below under "Closed".
- **`AdminSubmissions.tsx`**: list of submissions: reviewer, queue, count, left out, status, created date, and a
  link `pull request <n>` to `url`.

- [ ] **Step 4: Run tests, typecheck, lint.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add review-app
git commit -m "feat(review-app): admin page for reviewers, assignments and submissions"
```

---

### Task 13: Hosted end-to-end run and CI

**Files:**
- Create: `review-app/e2e/hosted/start.ts`, `review-app/e2e/hosted/hosted.spec.ts`, `review-app/playwright.hosted.config.ts`
- Modify: `review-app/playwright.config.ts` (`testIgnore: ['hosted/**']`), `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `reviewFixture`, `buildSnapshot`, `migrate`, `testKeys`, `FakeGitHub`, `testAppKey`, the Worker.
- Produces: `pnpm --filter @wordado/review-app e2e:hosted`; `review-app/.e2e/tokens.json` `{ admin: string; reviewer: string }`;
  the fake GitHub's state at `GET http://127.0.0.1:4182/_state` → `{ pulls, branches }`.

- [ ] **Step 1: Write the start script**

`review-app/e2e/hosted/start.ts`:

```ts
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { getPlatformProxy } from 'wrangler'
import { reviewFixture } from '../../server/fixture'
import { buildSnapshot } from '../../server/snapshot'
import { CURRENT_KEY } from '../../shared/snapshot'
import type { D1Database, R2Bucket } from '../../worker/bindings'
import { FakeGitHub, testAppKey } from '../../worker/test/fakeGitHub'
import { testKeys } from '../../worker/test/jwt'
import { migrate } from '../../worker/test/platform'

const root = join(import.meta.dirname, '..', '..')
const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]))
const TEAM = 'e2e.example.com'
const AUD = 'e2e-aud'

const content = await reviewFixture()
const snap = mkdtempSync(join(tmpdir(), 'snap-'))
buildSnapshot(content, snap, { commit: 'e2e0000aaaa', built: new Date().toISOString() })

// Local D1 and R2 in the same directory wrangler dev will use.
const state = mkdtempSync(join(tmpdir(), 'review-state-'))
const proxy = await getPlatformProxy<{ DB: D1Database; SNAPSHOTS: R2Bucket }>({ configPath: join(root, 'wrangler.jsonc'), persist: { path: state } })
await migrate(proxy.env.DB)
for (const p of walk(snap).filter((p) => !p.endsWith(CURRENT_KEY))) await proxy.env.SNAPSHOTS.put(relative(snap, p), readFileSync(p, 'utf8'))
await proxy.env.SNAPSHOTS.put(CURRENT_KEY, readFileSync(join(snap, CURRENT_KEY), 'utf8'))
await proxy.env.DB.prepare("INSERT INTO reviewers (email, name, languages, role, invited_at) VALUES ('reviewer@example.com', 'Rita', '[\"bg\",\"en\"]', 'reviewer', '2026-10-05T00:00:00Z')").run()
await proxy.env.DB.prepare("INSERT INTO reviewers (email, name, languages, role, invited_at) VALUES ('hans@example.com', 'Hans', '[\"de\",\"bg\"]', 'reviewer', '2026-10-05T00:00:00Z')").run()
await proxy.env.DB.prepare("INSERT INTO assignments (reviewer, queue, files, flagged_only, created_at) VALUES ('reviewer@example.com', 'translation-bg', '*', 1, '2026-10-05T00:00:00Z')").run()
await proxy.dispose()

// The fake GitHub: main holds the fixture's review files.
const files = Object.fromEntries(walk(join(content, 'review')).map((p) => [relative(content, p), readFileSync(p, 'utf8')]))
const gh = new FakeGitHub(files)
createServer((req, res) => {
  void (async () => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    if (req.url === '/_state') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ pulls: gh.pulls, branches: [...gh.branches.keys()] }))
      return
    }
    const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, String(v)]))
    const out = await gh.fetch(`https://x${req.url}`, { method: req.method ?? 'GET', headers, ...(chunks.length ? { body: Buffer.concat(chunks).toString('utf8') } : {}) })
    res.writeHead(out.status, { 'content-type': out.headers.get('content-type') ?? 'text/plain' })
    res.end(await out.text())
  })()
}).listen(4182, '127.0.0.1')

const keys = await testKeys()
const env = { ACCESS_AUD: AUD, ACCESS_TEAM_DOMAIN: TEAM }
mkdirSync(join(root, '.e2e'), { recursive: true })
writeFileSync(join(root, '.e2e', 'tokens.json'), JSON.stringify({ admin: await keys.token('admin@example.com', env), reviewer: await keys.token('reviewer@example.com', env) }))

const vars = {
  ACCESS_JWKS: keys.jwks, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAIL: 'admin@example.com',
  GITHUB_API_URL: 'http://127.0.0.1:4182', GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '1', GITHUB_APP_PRIVATE_KEY: (await testAppKey()).pem,
  APP_ORIGIN: 'http://127.0.0.1:4181',
}
spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', '4181', '--ip', '127.0.0.1', '--persist-to', state, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: root, stdio: 'inherit' })
```

If `wrangler dev --persist-to` does not see what `getPlatformProxy({ persist: { path } })` wrote (they must share
the `v3/` layout under the same directory), seed instead with `wrangler d1 migrations apply DB --local
--persist-to <state>`, `wrangler d1 execute DB --local --persist-to <state> --command "<sql>"` and `wrangler r2
object put wordado-review/<key> --local --persist-to <state> --file <path>` for each snapshot file. Report which
one you used. If `--var` mangles the multi-line PEM, pass it through a temporary `.dev.vars`-format file with
`--env-file` instead (quote the value, newlines as `\n`).

`review-app/playwright.hosted.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e/hosted',
  use: { baseURL: 'http://127.0.0.1:4181', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'pnpm build && tsx e2e/hosted/start.ts', url: 'http://127.0.0.1:4181/', reuseExistingServer: false, timeout: 180_000 },
})
```

- [ ] **Step 2: Write the tests** `review-app/e2e/hosted/hosted.spec.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Browser } from '@playwright/test'

const tokens = () => JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '.e2e', 'tokens.json'), 'utf8')) as { admin: string; reviewer: string }
const as = async (browser: Browser, who: 'admin' | 'reviewer') => (await browser.newContext({ extraHTTPHeaders: { 'cf-access-jwt-assertion': tokens()[who] } })).newPage()

test('a reviewer decides rows with the keys and submits a pull request', async ({ browser }) => {
  const page = await as(browser, 'reviewer')
  await page.goto('/')
  await page.getByRole('button', { name: /translation-bg/ }).click()
  const list = page.getByRole('list', { name: 'Rows' })
  await expect(list.getByRole('button').first()).toBeVisible()
  await page.keyboard.press('2')
  await page.keyboard.press('2')
  await page.getByRole('button', { name: /Submit 2 decisions/ }).click()
  await expect(page.getByRole('link', { name: /pull request 1/ })).toBeVisible()
  const state = (await (await fetch('http://127.0.0.1:4182/_state')).json()) as { pulls: { title: string }[] }
  expect(state.pulls[0]!.title).toBe('translation-bg: 2 decisions by Rita')
})

test('an admin invites a reviewer and assigns files; an overlap is refused', async ({ browser }) => {
  const page = await as(browser, 'admin')
  await page.goto('/')
  await page.getByRole('button', { name: 'Admin' }).click()
  const invite = page.getByRole('form', { name: 'Invite a reviewer' })
  await invite.getByLabel('Email').fill('new@example.com')
  await invite.getByLabel('Name').fill('Nora')
  await invite.getByLabel('Spanish').check()
  await invite.getByRole('button', { name: 'Invite' }).click()
  await expect(page.getByText('new@example.com')).toBeVisible()
  const assign = page.getByRole('form', { name: 'Assign' })
  await assign.getByLabel('Reviewer').selectOption('hans@example.com')
  await assign.getByLabel('Queue').selectOption('translation-bg')
  await assign.getByLabel('All files').check()
  await assign.getByRole('button', { name: 'Assign' }).click()
  await expect(page.locator('p.notice')).toContainText(/already assigned to Rita/)
})
```

(The two tests share one Worker; the first submits from Rita's assignment and does not change who holds
`translation-bg`, so the second test's overlap error names Rita.)

- [ ] **Step 3: Run it**

Run: `pnpm --filter @wordado/review-app e2e:hosted`
Expected: 2 passed. Also `pnpm --filter @wordado/review-app e2e` (the local run) still passes and does not pick up
`e2e/hosted/**`.

- [ ] **Step 4: CI** — in `.github/workflows/ci.yml`, `test` job, after "The review app, end to end":

```yaml
      - name: The hosted review app, end to end
        run: pnpm --filter @wordado/review-app e2e:hosted
```

and in the `static` job after "Dry-run both deployments":

```yaml
      - name: Dry-run the review app's deployment
        run: pnpm --filter @wordado/review-app deploy:check
```

- [ ] **Step 5: Commit**

```bash
git add review-app .github/workflows/ci.yml
git commit -m "test(review-app): hosted end-to-end run against wrangler dev; CI steps"
```

---

### Task 14: Deploy workflow, production config check, setup guide

**Files:**
- Create: `review-app/scripts/check-config.ts`, `review-app/scripts/check-config.test.ts`, `.github/workflows/deploy-review.yml`
- Modify: `.github/workflows/ci.yml` (a `deploy-review` job), `review-app/vitest.config.ts` (include `scripts/**/*.test.ts` in the `server` project), `review-app/README.md` (a **Hosted** section)

**Interfaces:**
- Produces: `checkProductionConfig(jsonc: string): string[]` (problems; empty = fine), CLI
  `tsx scripts/check-config.ts wrangler.jsonc` (exit 1 with `::error::` lines).

- [ ] **Step 1: Write the failing test** `review-app/scripts/check-config.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkProductionConfig } from './check-config'

const real = readFileSync(join(import.meta.dirname, '..', 'wrangler.jsonc'), 'utf8')

describe('checkProductionConfig', () => {
  it('refuses the placeholders the repository ships with', () => {
    const problems = checkProductionConfig(real)
    expect(problems.join('\n')).toMatch(/database_id/)
    expect(problems.join('\n')).toMatch(/ACCESS_AUD/)
    expect(problems.join('\n')).toMatch(/GITHUB_APP_ID/)
  })
  it('passes a filled-in config and refuses ACCESS_JWKS or GITHUB_API_URL in production', () => {
    const filled = real
      .replace(/"database_id": "0{8}-0{4}-0{4}-0{4}-0{12}"(?![\s\S]*"database_id")/, '"database_id": "1b2c3d4e-0000-4000-8000-000000000001"')
      .replace(/("production"[\s\S]*?)"ACCESS_TEAM_DOMAIN": ""/, '$1"ACCESS_TEAM_DOMAIN": "wordado.cloudflareaccess.com"')
      .replace(/("production"[\s\S]*?)"ACCESS_AUD": ""/, '$1"ACCESS_AUD": "abc"')
      .replace(/("production"[\s\S]*?)"GITHUB_APP_ID": ""/, '$1"GITHUB_APP_ID": "123"')
      .replace(/("production"[\s\S]*?)"GITHUB_INSTALLATION_ID": ""/, '$1"GITHUB_INSTALLATION_ID": "456"')
    expect(checkProductionConfig(filled)).toEqual([])
    expect(checkProductionConfig(filled.replace('"MAIL_FROM": "Wordado Review <review@wordado.com>"\n      }', '"MAIL_FROM": "x", "ACCESS_JWKS": "{}"\n      }'))).not.toEqual([])
  })
})
```

(If the regex edits prove brittle, build the filled config by parsing the JSONC into an object, mutating
`env.production`, and serialising: `checkProductionConfig` must accept plain JSON too.)

- [ ] **Step 2: Run to see it fail.** Expected: FAIL.

- [ ] **Step 3: Implement**

`review-app/scripts/check-config.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** JSONC → JSON: drops // and /* */ comments outside strings, and trailing commas. */
function parseJsonc(text: string): unknown {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      out += ch
      if (ch === '\\') out += text[++i] ?? ''
      else if (ch === '"') inString = false
    } else if (ch === '"') {
      inString = true
      out += ch
    } else if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i += 1
      out += '\n'
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1
    } else out += ch
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'))
}

interface Prod { d1_databases?: { database_id?: string }[]; vars?: Record<string, string>; routes?: { pattern?: string }[] }

/** What still stops a production deploy (spec 2026-10-05 §14). */
export function checkProductionConfig(jsonc: string): string[] {
  const prod = ((parseJsonc(jsonc) as { env?: { production?: Prod } }).env?.production ?? {}) as Prod
  const problems: string[] = []
  const id = prod.d1_databases?.[0]?.database_id ?? ''
  if (/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(id) || id === '') problems.push('env.production d1_databases[0].database_id is still the placeholder (review-app/README.md, "Hosted", step 1)')
  for (const name of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'GITHUB_APP_ID', 'GITHUB_INSTALLATION_ID']) {
    if (!prod.vars?.[name]) problems.push(`env.production vars.${name} is empty (review-app/README.md, "Hosted")`)
  }
  for (const name of ['ACCESS_JWKS', 'GITHUB_API_URL', 'ADMIN_EMAIL']) {
    if (prod.vars && name in prod.vars) problems.push(`env.production vars.${name} must not be set: ${name === 'ADMIN_EMAIL' ? 'it is a secret' : 'it is for tests only'}`)
  }
  if (prod.vars?.['APP_ORIGIN'] !== 'https://review.wordado.com') problems.push('env.production vars.APP_ORIGIN must be https://review.wordado.com')
  if (!prod.routes?.some((r) => r.pattern === 'review.wordado.com')) problems.push('env.production routes must include review.wordado.com')
  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: tsx scripts/check-config.ts <wrangler.jsonc>')
    process.exit(2)
  }
  const problems = checkProductionConfig(readFileSync(file, 'utf8'))
  for (const p of problems) console.error(`::error::${p}`)
  process.exit(problems.length > 0 ? 1 : 0)
}
```

`.github/workflows/deploy-review.yml`:

```yaml
name: Deploy the review app

# Called by CI on main when review-app/ or what it builds on changed (spec 2026-10-05 §14): D1 migrations
# first (forward-only), then the Worker with the UI. Its secrets live in Cloudflare, not here.
on:
  workflow_call:

permissions:
  contents: read

jobs:
  deploy:
    name: Deploy (review)
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    environment:
      name: production-review
      url: https://review.wordado.com
    concurrency:
      group: deploy-review
      cancel-in-progress: false
    env:
      CLOUDFLARE_ACCOUNT_ID: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
      WRANGLER_SEND_METRICS: 'false'
    steps:
      - uses: actions/checkout@v5
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Refuse a production config that is not filled in
        working-directory: review-app
        run: pnpm exec tsx scripts/check-config.ts wrangler.jsonc
      - name: Build the UI
        run: pnpm --filter @wordado/review-app build
      - name: Migrate D1 (forward-only, before the Worker)
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: review-app
          packageManager: pnpm
          command: d1 migrations apply DB --remote --env production
      - name: Deploy the Worker and the UI
        uses: cloudflare/wrangler-action@v4
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ vars.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: review-app
          packageManager: pnpm
          command: deploy --env production
```

In `ci.yml` add:

```yaml
  review-changes:
    name: Did the review app change
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-24.04
    outputs:
      changed: ${{ steps.diff.outputs.changed }}
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0
      - id: diff
        env:
          BEFORE: ${{ github.event.before }}
        run: |
          if git diff --name-only "$BEFORE" "$GITHUB_SHA" | grep -qE '^(review-app/|pipeline/src/|core/src/|pnpm-lock.yaml)'; then
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            echo "changed=false" >> "$GITHUB_OUTPUT"
          fi

  deploy-review:
    name: Review app deployment
    needs: [static, test, review-changes]
    if: needs.review-changes.outputs.changed == 'true' && vars.REVIEW_DEPLOY_ENABLED == 'true'
    uses: ./.github/workflows/deploy-review.yml
    secrets: inherit
```

`review-app/README.md` gets a **Hosted** section (after "What the AI reviews, and when"):

- What it is (spec 2026-10-05) in two sentences.
- **One-time setup** (operator), numbered:
  1. `wrangler d1 create wordado-review`; put its id into `env.production.d1_databases[0].database_id`.
  2. `wrangler r2 bucket create wordado-review` (no public access, no custom domain).
  3. Cloudflare Zero Trust → Access → Applications → Self-hosted, domain `review.wordado.com`; login method
     *One-time PIN*; policy *Allow*, include *Everyone* (the Worker decides who is invited); a second application
     for the path `review.wordado.com/api/github/webhook` with a *Bypass* policy. Copy the application's AUD tag
     to `ACCESS_AUD` and the team domain (`<team>.cloudflareaccess.com`) to `ACCESS_TEAM_DOMAIN`.
  4. GitHub App (organisation `wordado` → Settings → Developer settings → GitHub Apps → New): no homepage
     needed; webhook URL `https://review.wordado.com/api/github/webhook` with a secret; permissions *Contents:
     read and write*, *Pull requests: read and write*; event *Pull request*; install it on `wordado-content`
     only. Put the app id and installation id in `GITHUB_APP_ID` / `GITHUB_INSTALLATION_ID`. Generate a private
     key and convert it: `openssl pkcs8 -topk8 -nocrypt -in app.pem -out app-pkcs8.pem`.
  5. Worker secrets, in the Cloudflare dashboard (Workers → wordado-review → Settings → Variables and secrets),
     never pasted in chat: `GITHUB_APP_PRIVATE_KEY` (the PKCS#8 file's content), `GITHUB_WEBHOOK_SECRET`,
     `RESEND_API_KEY` (a new sending-only Resend key for `wordado.com`), `ADMIN_EMAIL`.
  6. GitHub environment `production-review` in `wordado/wordado` with a required reviewer; repository variable
     `REVIEW_DEPLOY_ENABLED=true` once steps 1–5 are done.
  7. In wordado-content: an R2 API token limited to the `wordado-review` bucket (read and write) as secrets
     `R2_REVIEW_ACCESS_KEY_ID` / `R2_REVIEW_SECRET_ACCESS_KEY`, variable `REVIEW_BUCKET=wordado-review`, variable
     `REVIEW_APP_BOT` = the app's bot login (`<app-slug>[bot]`), and the two workflows from
     `pipeline/template/.github/workflows/review-snapshot.yml` and `review-import.yml`.
- **Running it locally**: `pnpm --filter @wordado/review-app snapshot "$PWD/content" /tmp/snap`, then
  `pnpm --filter @wordado/review-app e2e:hosted` shows the full flow against fakes.
- **How a reviewer works** (short): the invite email → sign in with the code → *My assignments* → the same keys
  as the local app → **Submit** → the coordinator gets an email with the pull request; the import runs on it.
- **Changing reviewers**: disable, reassign, close, split (spec §5, §5.1), one line each.

- [ ] **Step 4: Run tests, lint the workflows**

Run: `pnpm --filter @wordado/review-app test && pnpm lint && docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color`
Expected: PASS (if Docker is unavailable, say so and rely on CI's actionlint).

- [ ] **Step 5: Commit**

```bash
git add review-app .github/workflows
git commit -m "ci(review-app): production deploy behind approval, config check, setup guide"
```

---

### Task 15: Content-repo workflow templates

**Files:**
- Create: `pipeline/template/.github/workflows/review-snapshot.yml`, `pipeline/template/.github/workflows/review-import.yml`
- Modify: `.github/workflows/ci.yml` (actionlint the whole template directory)

**Interfaces:**
- Consumes: `review-app snapshot` CLI (Task 2), `corpus import --by` (exists), repository variables
  `PIPELINE_REF`, `CLOUDFLARE_ACCOUNT_ID`, `REVIEW_BUCKET`, `REVIEW_APP_BOT`, secrets `R2_REVIEW_ACCESS_KEY_ID`,
  `R2_REVIEW_SECRET_ACCESS_KEY`.
- Produces: the two workflow files, ready to copy into wordado-content (after the product owner's go-ahead).

- [ ] **Step 1: Write `review-snapshot.yml`**

```yaml
name: Review snapshot

# Builds the hosted review app's rows from main and uploads them to the private R2 bucket (spec 2026-10-05 §4.3):
# the files first, current.json last, so the app reads either the whole old snapshot or the whole new one.
on:
  push:
    branches: [main]
    paths: ['review/**', 'decisions/**', 'ai-review/**', 'pipeline.json']
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: review-snapshot
  cancel-in-progress: true

env:
  CORPUS: pnpm --dir ${{ github.workspace }}/wordado --filter @wordado/pipeline corpus

jobs:
  snapshot:
    name: snapshot
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    env:
      R2: https://${{ vars.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      BUCKET: s3://${{ vars.REVIEW_BUCKET }}
      AWS_DEFAULT_REGION: auto
      # R2 does not take the AWS CLI's default integrity headers.
      AWS_REQUEST_CHECKSUM_CALCULATION: when_required
      AWS_RESPONSE_CHECKSUM_VALIDATION: when_required
    steps:
      - uses: actions/checkout@v5
        with:
          path: content
      - uses: actions/checkout@v5
        with:
          repository: wordado/wordado
          ref: ${{ vars.PIPELINE_REF }}
          path: wordado
      - uses: pnpm/action-setup@v6
        with:
          package_json_file: wordado/package.json
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: wordado/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
        working-directory: wordado
      - name: Rebuild the draft (no LLM calls)
        run: $CORPUS draft "$GITHUB_WORKSPACE/content" --offline
      - name: Build the snapshot
        run: pnpm --dir "$GITHUB_WORKSPACE/wordado" --filter @wordado/review-app snapshot "$GITHUB_WORKSPACE/content" "$RUNNER_TEMP/snap" --commit "$GITHUB_SHA"
      - name: Upload it, current.json last, and keep the newest two
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_REVIEW_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_REVIEW_SECRET_ACCESS_KEY }}
        run: |
          prev=$(aws s3 cp "$BUCKET/current.json" - --endpoint-url "$R2" 2>/dev/null | jq -r .id || true)
          new=$(jq -r .id "$RUNNER_TEMP/snap/current.json")
          aws s3 sync "$RUNNER_TEMP/snap/snapshots" "$BUCKET/snapshots" --endpoint-url "$R2" --only-show-errors
          aws s3 cp "$RUNNER_TEMP/snap/current.json" "$BUCKET/current.json" --endpoint-url "$R2" --content-type application/json
          for id in $(aws s3 ls "$BUCKET/snapshots/" --endpoint-url "$R2" | awk '{print $2}' | tr -d /); do
            if [ "$id" != "$new" ] && [ "$id" != "$prev" ]; then
              aws s3 rm "$BUCKET/snapshots/$id" --recursive --endpoint-url "$R2" --only-show-errors
            fi
          done
          echo "snapshot $new is current (kept $prev)"
```

- [ ] **Step 2: Write `review-import.yml`**

```yaml
name: Review import

# A pull request the hosted review app opened (spec 2026-10-05 §7.3): run corpus import on its branch, as the
# local app's Import button does, and push the result onto the same pull request.
on:
  pull_request:
    types: [opened]
    branches: [main]

permissions:
  contents: write
  pull-requests: write

env:
  CORPUS: pnpm --dir ${{ github.workspace }}/wordado --filter @wordado/pipeline corpus

jobs:
  import:
    name: import
    if: startsWith(github.head_ref, 'review/') && github.event.pull_request.user.login == vars.REVIEW_APP_BOT && github.event.pull_request.head.repo.full_name == github.repository
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v5
        with:
          ref: ${{ github.head_ref }}
          path: content
      - uses: actions/checkout@v5
        with:
          repository: wordado/wordado
          ref: ${{ vars.PIPELINE_REF }}
          path: wordado
      - uses: pnpm/action-setup@v6
        with:
          package_json_file: wordado/package.json
      - uses: actions/setup-node@v5
        with:
          node-version: 24
          cache: pnpm
          cache-dependency-path: wordado/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
        working-directory: wordado
      - name: Import the reviewer's decisions
        id: import
        run: |
          content="$GITHUB_WORKSPACE/content"
          by=$(git -C "$content" log -1 --format=%an)
          echo "by=$by" >> "$GITHUB_OUTPUT"
          $CORPUS draft "$content" --offline
          # Rows import cannot apply stay in the review file and exit 1; report them rather than fail.
          set +e
          $CORPUS import "$content" --by "$by" > "$RUNNER_TEMP/import.log" 2>&1
          echo "status=$?" >> "$GITHUB_OUTPUT"
          set -e
          cat "$RUNNER_TEMP/import.log"
      - name: Push the import onto the pull request
        working-directory: content
        env:
          BY: ${{ steps.import.outputs.by }}
          HEAD: ${{ github.head_ref }}
        run: |
          git add -A review decisions
          if git diff --cached --quiet; then echo "Nothing imported."; exit 0; fi
          queue=${HEAD#review/}
          queue=${queue%-*-*-*}
          git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
            commit -m "import: $queue by $BY"
          git push origin "HEAD:$HEAD"
      - name: Comment on rows import could not apply
        if: steps.import.outputs.status != '0'
        env:
          GH_TOKEN: ${{ github.token }}
          PR: ${{ github.event.pull_request.number }}
        run: |
          {
            echo "Some rows could not be imported; they stay in the review file:"
            echo
            echo '```'
            cat "$RUNNER_TEMP/import.log"
            echo '```'
          } > "$RUNNER_TEMP/comment.md"
          gh pr comment "$PR" --repo "$GITHUB_REPOSITORY" --body-file "$RUNNER_TEMP/comment.md"
```

Notes for the implementer: the branch is `review/<queue>-<slug>-<yyyymmdd>-<n>` (Task 10), so `queue` strips the
last three `-` parts; a reviewer name with quotes reaches `corpus import` only through `"$by"` (quoted), never
interpolated into the script by `${{ }}`. `git log -1 --format=%an` is the review commit's author (the reviewer's
name), since the checkout is the pull request's head.

- [ ] **Step 3: Lint** — in `ci.yml` change the content-workflow actionlint step to lint every template workflow:

```yaml
      - name: Lint the content repository's workflows
        run: docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color pipeline/template/.github/workflows/corpus.yml pipeline/template/.github/workflows/review-snapshot.yml pipeline/template/.github/workflows/review-import.yml
```

Run the same command locally (Docker). Expected: no findings.

- [ ] **Step 4: Commit**

```bash
git add pipeline/template/.github/workflows .github/workflows/ci.yml
git commit -m "feat(pipeline): content-repo workflows for review snapshots and imports"
```

---

## After the plan (needs the product owner's go-ahead, not part of the subagent run)

1. Merge the PR; set up Cloudflare, the GitHub App and Resend per `review-app/README.md` "Hosted" (the product
   owner does the dashboard steps; Claude never sees the secrets).
2. Move `PIPELINE_REF` in wordado-content to the merge commit and open a wordado-content PR adding
   `review-snapshot.yml` and `review-import.yml`; run *Review snapshot* by hand once.
3. Set `REVIEW_DEPLOY_ENABLED=true`; approve the first `production-review` deployment.
4. Try one real submit with a test assignment, check the import workflow's commit on the pull request, then close
   it unmerged (its decisions return to unsubmitted).
