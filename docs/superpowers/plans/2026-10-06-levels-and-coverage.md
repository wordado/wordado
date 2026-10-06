# Levels and Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the corpus pipeline bring back the common words and the easy words, set levels with a two-step limit, and rebuild levels and units once for corpus version 6.

**Architecture:** Five small rule changes in `pipeline/` and one option in `core/`. Each rule is a pure function changed test-first: lemma ranking, the level limit, selection, the release's succession check. `corpus draft --rebuild` then wires them together for one deliberate run; the default behaviour (published words keep their level and unit) does not change.

**Tech Stack:** TypeScript 7, Node 24, pnpm workspace, Vitest 5, oxlint. No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-06-levels-and-coverage-design.md`. Read it before any task.

## Global Constraints

- Work on the branch `spec/levels-and-coverage` (it already holds the spec). Commit as `11029931+danchom@users.noreply.github.com`; check with `git config user.email` before the first commit.
- Style: no semicolons, single quotes, named exports, `readonly` interface fields, comments that say why. `pnpm lint` (oxlint, `--deny-warnings`) and `pnpm typecheck` must pass.
- `tsconfig.base.json` has `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: an indexed read needs `!` or a check, and an optional property is never passed as `undefined`.
- A test sits beside its module. Write the test, run it, see it fail for the stated reason, then write the code.
- Commit messages: `type(package): what changed`, for example `fix(pipeline): …`, `feat(pipeline): …`, `feat(core): …`. End each with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- `targets` in `pipeline.json` keeps its meaning and its values. Nothing in this plan changes a frequency band boundary.
- `LEMMAS_VERSION` stays `1`. No cache line is rewritten.
- No entry ID changes and no entry is removed. `checkPackSuccession` must always refuse a removed entry.
- Do not touch the content repository (`content/`), the web app or the server. Do not run any command that calls a model or needs `OPENROUTER_API_KEY`.
- Run one test file with `pnpm --filter @wordado/pipeline exec vitest run src/<path>` (for core: `pnpm --filter @wordado/core exec vitest run src/<file>`).

## Review Focus

Inputs the spec implies but does not spell out. Each has a test in the task that owns the code.

1. **A contraction with a typographic apostrophe (`they’ll`) among the empty-lemma forms.** It must be skipped like `they're`, not become a headword. (Task 1)
2. **A later meaning whose rank is inside a `main_meanings` bound, and a dropped main meaning.** Neither is brought in by the rule. (Task 4)
3. **A `sizes` value smaller than what is already live.** No live entry is removed; the level simply takes no more. (Task 4)
4. **`--rebuild` run a second time before the release.** No unit number from the first run is reused, and every live entry is in exactly one unit. (Task 6)
5. **A published entry that a reviewer dropped before the rebuild.** It ships retired, in its old unit, and the release still passes. (Task 7)

---

## File structure

| File | Change | Responsibility |
|---|---|---|
| `pipeline/src/stages/lemmas.ts` | modify `rankLemmas` | an empty lemma list means the form is its own headword |
| `pipeline/src/testing/fixture.ts` | modify `sampleLlm` | the fake lemmatiser answers `the` with an empty list |
| `pipeline/src/stages/senses.ts` | modify `bandLevel` | the two-step limit |
| `pipeline/src/config.ts` | add three optional settings | `sizes`, `main_meanings`, `units_rebuilt_after` |
| `pipeline/src/select.ts` | modify `selectLive` | main meanings first, then the frequency fill against `sizes` |
| `core/src/packStability.ts` | add an option | a removed unit may be accepted; a removed entry never |
| `pipeline/src/draft.ts` | `rebuild` option, `level_flagged` | banded levels for all, units from scratch, moved entries flagged |
| `pipeline/src/release.ts` | `unitsRebuilt` | pass the option when `units_rebuilt_after` is in effect |
| `pipeline/src/cli.ts` | `--rebuild`, a status line | the command line |
| `pipeline/README.md` | new section, command table | how to use it |
| `docs/superpowers/specs/2026-10-06-levels-and-coverage-design.md` | one paragraph | record what Task 6 found |

---

### Task 1: An empty lemma list means the form is its own headword

**Files:**
- Modify: `pipeline/src/stages/lemmas.ts` (function `rankLemmas`, at the end of the file)
- Modify: `pipeline/src/testing/fixture.ts` (the `lemmas` branch of `sampleLlm`)
- Test: `pipeline/src/stages/lemmas.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `rankLemmas(forms, results, pinned, max)` with the same signature. New behaviour only.

- [ ] **Step 1: Write the failing tests**

Add inside `describe('rankLemmas', …)` in `pipeline/src/stages/lemmas.test.ts`:

```ts
  it('takes a word with an empty lemma list as its own headword, and still skips a contraction piece', () => {
    const fs = [
      { form: 'the', perMillion: 5000, rank: 1 },
      { form: "they're", perMillion: 900, rank: 2 },
      { form: 'they’ll', perMillion: 800, rank: 3 },
      { form: 'london', perMillion: 400, rank: 4 },
    ]
    const results: LemmaResult[] = [
      { form: 'the', kind: 'word', lemmas: [] },
      { form: "they're", kind: 'word', lemmas: [] },
      { form: 'they’ll', kind: 'word', lemmas: [] },
      { form: 'london', kind: 'name', lemmas: [] },
    ]
    expect(rankLemmas(fs, results, [], 10)).toEqual([{ lemma: 'the', perMillion: 5000, rank: 1, pinned: false }])
  })

  it('adds the rate of an empty-list form to a lemma that other forms already name', () => {
    const fs = [
      { form: 'be', perMillion: 300, rank: 1 },
      { form: 'is', perMillion: 700, rank: 2 },
    ]
    const results: LemmaResult[] = [
      { form: 'be', kind: 'word', lemmas: [] },
      { form: 'is', kind: 'word', lemmas: ['be'] },
    ]
    expect(rankLemmas(fs, results, [], 10)).toEqual([{ lemma: 'be', perMillion: 1000, rank: 1, pinned: false }])
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages/lemmas.test.ts`
Expected: 2 failed. The first receives `[]`; the second receives `be` with `perMillion: 700`.

- [ ] **Step 3: Change `rankLemmas`**

In `pipeline/src/stages/lemmas.ts`, add above `rankLemmas`:

```ts
/**
 * The stage sometimes answers "a word, an inflection of nothing" with an empty list. In the first real run that
 * took 91 of the 100 most frequent forms out of the corpus (level check, 2026-10-06). Such a form is its own
 * headword. A contraction piece ("they're") is not: the stage should have called it a fragment.
 */
const ownLemma = (form: string): readonly string[] => (/['’]/.test(form) ? [] : [norm(form)].filter((l) => l !== ''))
```

and replace the first statement inside `rankLemmas` (the `results.forEach` block) with:

```ts
  results.forEach((r, i) => {
    if (r.kind !== 'word') return
    const lemmas = r.lemmas.length > 0 ? r.lemmas : ownLemma(forms[i]!.form)
    if (lemmas.length === 0) return
    const share = forms[i]!.perMillion / lemmas.length
    for (const l of lemmas) rates.set(l, (rates.get(l) ?? 0) + share)
  })
```

- [ ] **Step 4: Run the file and see it pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages/lemmas.test.ts`
Expected: all pass (6 tests).

- [ ] **Step 5: Make the fixture answer `the` with an empty list**

In `pipeline/src/testing/fixture.ts`, in `sampleLlm`, replace the `lemmas` branch's return with:

```ts
      // `the` comes back with an empty list, as the real stage answered its first batch (level check, 2026-10-06).
      return {
        items: forms.map((form) =>
          form === 'london' ? { form, kind: 'name', lemmas: [] } : { form, kind: 'word', lemmas: form === 'the' ? [] : [form === 'went' ? 'go' : form] },
        ),
      }
```

Every fixture-based test now depends on Step 3: without it, `the-1` would vanish from the drafts.

- [ ] **Step 6: Run the pipeline and review-app suites**

Run: `pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/review-app test`
Expected: all pass. (`review-app` builds its fixture from `pipeline/src/testing/fixture.ts`.) Encoder tests are skipped when ffmpeg is not installed; that is fine.

- [ ] **Step 7: Commit**

```bash
git add pipeline/src/stages/lemmas.ts pipeline/src/stages/lemmas.test.ts pipeline/src/testing/fixture.ts
git commit -m "fix(pipeline): a word with an empty lemma list is its own headword

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The two-step level limit

**Files:**
- Modify: `pipeline/src/stages/senses.ts` (function `bandLevel`, near line 166)
- Test: `pipeline/src/stages/senses.test.ts` (the `describe('bandLevel (Decision 7)', …)` block at the end)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `LEVEL_LIMIT_STEPS = 2` (exported constant) and `bandLevel(llm, band)` with the same signature.

- [ ] **Step 1: Replace the `bandLevel` tests**

Replace the whole `describe('bandLevel (Decision 7)', …)` block in `pipeline/src/stages/senses.test.ts` with:

```ts
describe('bandLevel (Decision 7; two steps since 2026-10-06)', () => {
  it('keeps the LLM level when it is at most two bands from frequency', () => {
    expect(bandLevel('A2', 'A1')).toEqual({ level: 'A2', flagged: false })
    expect(bandLevel('B1', 'B1')).toEqual({ level: 'B1', flagged: false })
    expect(bandLevel('B1', 'A1')).toEqual({ level: 'B1', flagged: false })
    expect(bandLevel('A1', 'B1')).toEqual({ level: 'A1', flagged: false })
  })
  it('limits a level more than two bands away, and flags it for banding review', () => {
    expect(bandLevel('B2', 'A1')).toEqual({ level: 'B1', flagged: true })
    expect(bandLevel('C1', 'A1')).toEqual({ level: 'B1', flagged: true })
    expect(bandLevel('A1', 'B2')).toEqual({ level: 'A2', flagged: true })
    expect(bandLevel('A1', 'C1')).toEqual({ level: 'B1', flagged: true })
  })
  it('never leaves the scale at its ends', () => {
    expect(bandLevel('A1', 'A1')).toEqual({ level: 'A1', flagged: false })
    expect(bandLevel('C1', 'C1')).toEqual({ level: 'C1', flagged: false })
    expect(bandLevel('C1', 'B1')).toEqual({ level: 'C1', flagged: false })
  })
  it('drops C2, which no Phase 1 path teaches', () => {
    expect(bandLevel('C2', 'A1')).toEqual({ level: null, flagged: false })
  })
})
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages/senses.test.ts`
Expected: 2 failed (`keeps the LLM level …` receives `A2` flagged for `bandLevel('B1', 'A1')`; `limits a level …` receives `A2` for `bandLevel('B2', 'A1')`).

- [ ] **Step 3: Widen the limit**

In `pipeline/src/stages/senses.ts`, replace the `bandLevel` doc comment and body with:

```ts
/**
 * How far the LLM's level may sit from the frequency band. One band (Decision 7) put everyday words that print
 * mentions rarely two levels too high: "pen" at B1, "spoon" at B2 (level check, 2026-10-06).
 */
export const LEVEL_LIMIT_STEPS = 2

/** The LLM's judgement, kept within LEVEL_LIMIT_STEPS bands of frequency; a limited sense is flagged for banding review. */
export function bandLevel(llm: LlmLevel, band: CefrLevel): { readonly level: CefrLevel | null; readonly flagged: boolean } {
  if (llm === 'C2') return { level: null, flagged: false }
  const b = levelIndex(band)
  const l = levelIndex(llm)
  const clamped = Math.min(Math.max(l, b - LEVEL_LIMIT_STEPS), b + LEVEL_LIMIT_STEPS)
  return { level: CEFR_LEVELS[clamped]!, flagged: clamped !== l }
}
```

- [ ] **Step 4: Run the file, then the pipeline suite**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages/senses.test.ts && pnpm --filter @wordado/pipeline test`
Expected: all pass. (`draft.test.ts` "keeps a published sense live when its banded level leaves the shipped levels" still holds: band C1 with an LLM level of A2 is limited to B1 under both rules.)

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/stages/senses.ts pipeline/src/stages/senses.test.ts
git commit -m "feat(pipeline): the level may sit two bands from frequency, not one

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: The settings `sizes`, `main_meanings` and `units_rebuilt_after`

**Files:**
- Modify: `pipeline/src/config.ts` (interface `PipelineConfig`; function `configProblems`, after the `report_threshold` check)
- Test: `pipeline/src/config.test.ts` (inside `describe('configProblems', …)`)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces, on `PipelineConfig`:
  - `readonly sizes?: Readonly<Record<CefrLevel, number>>`
  - `readonly main_meanings?: Readonly<Partial<Record<CefrLevel, 'all' | number>>>`
  - `readonly units_rebuilt_after?: number`

- [ ] **Step 1: Write the failing tests**

Add inside `describe('configProblems', …)` in `pipeline/src/config.test.ts`:

```ts
  it('accepts sizes, main_meanings and units_rebuilt_after, which are all optional', () => {
    expect(
      configProblems({
        ...validConfig,
        sizes: { A1: 600, A2: 1000, B1: 1500, B2: 1600, C1: 2000 },
        main_meanings: { A1: 'all', B1: 5100 },
        units_rebuilt_after: 5,
      }),
    ).toEqual([])
    expect(configProblems({ ...validConfig, units_rebuilt_after: 0 })).toEqual([])
  })

  it('names a missing size, a main_meanings rule of the wrong kind or for a level not shipped, and a bad version', () => {
    expect(
      configProblems({
        ...validConfig,
        sizes: { A1: 600, A2: 0, B1: 1500, B2: 1600 },
        main_meanings: { A1: 'every', B2: 'all', A2: 0 },
        units_rebuilt_after: -1,
      }),
    ).toEqual([
      'sizes.A2: must be a positive integer',
      'sizes.C1: must be a positive integer',
      'main_meanings.A1: must be "all" or a positive integer',
      'main_meanings.B2: must be a level this corpus ships',
      'main_meanings.A2: must be "all" or a positive integer',
      'units_rebuilt_after: must be a corpus version (0 or more)',
    ])
  })
```

(`validConfig.levels` is `['A1', 'A2', 'B1']`, so `B2` is not shipped.)

- [ ] **Step 2: Run and see the second test fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/config.test.ts`
Expected: 1 failed: `names a missing size …` receives `[]`.

- [ ] **Step 3: Add the settings**

In `pipeline/src/config.ts`, add to `PipelineConfig` after `targets`:

```ts
  /** How many entries the frequency fill brings each level to (spec 2026-10-06 §3.3). Absent: `targets`. */
  readonly sizes?: Readonly<Record<CefrLevel, number>>
  /**
   * Main meanings (sense order 0) that are live whatever their level's size: every one of a level (`all`), or
   * those whose word's frequency rank is within a bound.
   */
  readonly main_meanings?: Readonly<Partial<Record<CefrLevel, 'all' | number>>>
  /**
   * The corpus version whose units the next release may replace (spec 2026-10-06 §3.6). It has an effect only
   * while that version is the last published one.
   */
  readonly units_rebuilt_after?: number
```

In `configProblems`, directly after the line `posInt(raw['report_threshold'], 'report_threshold')`, add:

```ts
  const sizes = raw['sizes']
  if (sizes !== undefined) {
    if (!isRecord(sizes)) p.push('sizes: must be an object')
    else for (const level of CEFR_LEVELS) posInt(sizes[level], `sizes.${level}`)
  }
  const main = raw['main_meanings']
  if (main !== undefined) {
    if (!isRecord(main)) p.push('main_meanings: must be an object')
    else
      for (const [level, rule] of Object.entries(main)) {
        if (!Array.isArray(levels) || !levels.includes(level)) p.push(`main_meanings.${level}: must be a level this corpus ships`)
        else if (rule !== 'all' && !(typeof rule === 'number' && Number.isInteger(rule) && rule >= 1)) p.push(`main_meanings.${level}: must be "all" or a positive integer`)
      }
  }
  const rebuilt = raw['units_rebuilt_after']
  if (rebuilt !== undefined && !(typeof rebuilt === 'number' && Number.isInteger(rebuilt) && rebuilt >= 0)) {
    p.push('units_rebuilt_after: must be a corpus version (0 or more)')
  }
```

- [ ] **Step 4: Run and see it pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/config.test.ts && pnpm --filter @wordado/pipeline typecheck`
Expected: all pass, no type error.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/config.ts pipeline/src/config.test.ts
git commit -m "feat(pipeline): settings for level sizes, main meanings and a one-time unit rebuild

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Selection takes easy main meanings first, and fills against `sizes`

**Files:**
- Modify: `pipeline/src/select.ts` (function `selectLive`)
- Modify: `pipeline/src/draft.ts` (the one call of `selectLive`, near line 171)
- Test: `pipeline/src/select.test.ts`

**Interfaces:**
- Consumes: `PipelineConfig.sizes`, `PipelineConfig.main_meanings` (Task 3).
- Produces:
  - `export type MainMeaningRule = 'all' | number`
  - `selectLive(candidates: readonly SelectCandidate[], levels: readonly CefrLevel[], sizes: Readonly<Record<CefrLevel, number>>, mainMeanings?: Readonly<Partial<Record<CefrLevel, MainMeaningRule>>>): Set<string>`

- [ ] **Step 1: Write the failing tests**

In `pipeline/src/select.test.ts`, change the helper's level type so B1 can be used. Replace the `c` helper's signature line with:

```ts
const c = (entry_id: string, level: 'A1' | 'A2' | 'B1' | 'B2', rank: number, extra: Partial<SelectCandidate> = {}): SelectCandidate => ({
```

Then add after the `describe('selectLive (Decision 9)', …)` block:

```ts
describe('selectLive with main_meanings and sizes (spec 2026-10-06 §3.3)', () => {
  const sizes = { A1: 1, A2: 1, B1: 2, B2: 1, C1: 1 }

  it('takes every main meaning of an "all" level, whatever the size', () => {
    const out = selectLive([c('a', 'A1', 1), c('b', 'A1', 2), c('z', 'A1', 9000)], ['A1'], sizes, { A1: 'all' })
    expect([...out].sort()).toEqual(['a', 'b', 'z'])
  })

  it('takes a bounded level’s main meanings up to the rank, then fills by frequency to the size', () => {
    // m1 and m2 are within rank 100. f is past it: it comes in only while the size has room.
    const cands = [c('m1', 'B1', 50), c('m2', 'B1', 100), c('f', 'B1', 101)]
    expect([...selectLive(cands, ['B1'], sizes, { B1: 100 })].sort()).toEqual(['m1', 'm2'])
    expect([...selectLive(cands, ['B1'], { ...sizes, B1: 3 }, { B1: 100 })].sort()).toEqual(['f', 'm1', 'm2'])
  })

  it('does not count a later meaning as a main meaning, even inside the bound', () => {
    const cands = [c('w-1', 'A2', 10), c('w-2', 'A2', 30, { order: 1 }), c('v-2', 'A2', 20, { order: 1 })]
    // The main meaning fills A2's size of 1, so neither later meaning comes in.
    expect([...selectLive(cands, ['A2'], sizes, { A2: 'all' })]).toEqual(['w-1'])
  })

  it('keeps a dropped main meaning out, and leaves a level without a rule to the frequency fill', () => {
    expect([...selectLive([c('d', 'A1', 1, { dropped: true }), c('k', 'A1', 2)], ['A1'], sizes, { A1: 'all' })]).toEqual(['k'])
    expect([...selectLive([c('a', 'A2', 1), c('b', 'A2', 2)], ['A2'], sizes, { A1: 'all' })]).toEqual(['a'])
  })

  it('never removes a previously live entry when the size is smaller than what was live', () => {
    const cands = [c('w1', 'B2', 5, { wasLive: true }), c('w2', 'B2', 6, { wasLive: true }), c('n', 'B2', 1)]
    expect([...selectLive(cands, ['B2'], sizes)].sort()).toEqual(['w1', 'w2'])
  })

  it('gives the same course when it is run on its own result', () => {
    const cands = [c('a', 'A1', 1), c('b', 'A1', 2), c('m', 'B1', 40), c('f', 'B1', 400), c('g', 'B1', 500)]
    const rules = { A1: 'all' as const, B1: 100 }
    const first = selectLive(cands, ['A1', 'B1'], sizes, rules)
    expect([...first].sort()).toEqual(['a', 'b', 'f', 'm'])
    const second = selectLive(cands.map((x) => ({ ...x, wasLive: first.has(x.entry_id) })), ['A1', 'B1'], sizes, rules)
    expect([...second].sort()).toEqual([...first].sort())
  })
})
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/select.test.ts`
Expected: the new tests that pass a fourth argument fail (for example the first receives `['a']`). Typecheck would also reject the fourth argument; that is expected until Step 3.

- [ ] **Step 3: Change `selectLive`**

In `pipeline/src/select.ts`, replace the doc comment and the function `selectLive` with:

```ts
/** Which main meanings of a level are live whatever its size: all of them, or those whose word ranks within a bound. */
export type MainMeaningRule = 'all' | number

/**
 * The live entries (Decision 9). Pinned and previously live entries stay,
 * so a learner's words never vanish between versions. Then come the main
 * meanings a level's rule names (spec 2026-10-06 §3.3): an easy word must
 * not be left out because more frequent ones filled its level. Both count
 * toward the level's size, which the most frequent of the rest fill.
 * A dropped entry is never live. An entry of a level this corpus does not
 * ship is never live.
 */
export function selectLive(
  candidates: readonly SelectCandidate[],
  levels: readonly CefrLevel[],
  sizes: Readonly<Record<CefrLevel, number>>,
  mainMeanings: Readonly<Partial<Record<CefrLevel, MainMeaningRule>>> = {},
): Set<string> {
  const live = new Set<string>()
  const count = new Map<CefrLevel, number>()
  const add = (c: SelectCandidate) => {
    live.add(c.entry_id)
    count.set(c.level, (count.get(c.level) ?? 0) + 1)
  }
  const shipped = candidates.filter((c) => levels.includes(c.level) && !c.dropped)
  for (const c of shipped) if (c.pinned || c.wasLive) add(c)
  for (const c of shipped) {
    const rule = mainMeanings[c.level]
    // A main meaning's rank is its word's rank (`senseRank` with order 0).
    if (live.has(c.entry_id) || c.order !== 0 || rule === undefined) continue
    if (rule === 'all' || c.rank <= rule) add(c)
  }
  const rest = shipped
    .filter((c) => !live.has(c.entry_id))
    .sort((a, b) => a.rank - b.rank || a.order - b.order || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0))
  for (const c of rest) if ((count.get(c.level) ?? 0) < sizes[c.level]) add(c)
  return live
}
```

- [ ] **Step 4: Pass the settings from the draft**

In `pipeline/src/draft.ts`, in the call of `selectLive`, replace the last argument line `config.targets,` with:

```ts
    config.sizes ?? config.targets,
    config.main_meanings ?? {},
```

- [ ] **Step 5: Run the file, the suite and the typecheck**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/select.test.ts && pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/pipeline typecheck`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/select.ts pipeline/src/select.test.ts pipeline/src/draft.ts
git commit -m "feat(pipeline): easy main meanings are always live; level sizes apart from band boundaries

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: The succession check can accept removed units

**Files:**
- Modify: `core/src/packStability.ts`
- Test: `core/src/packStability.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces:
  - `export interface SuccessionOptions { readonly allowRemovedUnits?: boolean }`
  - `checkPackSuccession(previous: Pack, next: Pack, opts?: SuccessionOptions): PackError[]`
  Both are exported from `@wordado/core` through the existing `export * from './packStability'` in `core/src/index.ts`.

- [ ] **Step 1: Write the failing test**

Add inside the top-level `describe` of `core/src/packStability.test.ts` (it defines `entry`, `unit` and `v0` above):

```ts
  it('accepts removed units when the units were rebuilt, and still refuses a removed entry', () => {
    const rebuilt: Pack = {
      ...v0,
      corpus_version: 1,
      entries: [entry('hello-1', 'a1-02'), entry('water-1', 'a1-02')],
      units: [unit('a1-02', 1, ['hello-1', 'water-1'])],
    }
    expect(checkPackSuccession(v0, rebuilt)).toEqual([{ path: 'units', message: 'unit a1-01 was removed' }])
    expect(checkPackSuccession(v0, rebuilt, { allowRemovedUnits: true })).toEqual([])
    const lost: Pack = { ...rebuilt, entries: [entry('hello-1', 'a1-02')], units: [unit('a1-02', 1, ['hello-1'])] }
    expect(checkPackSuccession(v0, lost, { allowRemovedUnits: true })).toEqual([{ path: 'entries', message: 'entry water-1 was removed; retire it instead' }])
  })
```

- [ ] **Step 2: Run and see it fail**

Run: `pnpm --filter @wordado/core exec vitest run src/packStability.test.ts`
Expected: 1 failed: the second `expect` receives the `unit a1-01 was removed` error.

- [ ] **Step 3: Add the option**

Replace the doc comment and the function in `core/src/packStability.ts` with:

```ts
export interface SuccessionOptions {
  /**
   * The units were rebuilt once (spec 2026-10-06 §3.6): a unit of the previous version may be gone. The app
   * derives a learner's path from the words they have met, so only saved unlocks are lost. Entries never may go.
   */
  readonly allowRemovedUnits?: boolean
}

/**
 * What version n+1 of a pack owes version n (spec §5.1): the same pack and
 * L1, a higher corpus version, a schema that does not go back, and every
 * entry and unit ID still present — a retired entry stays in the pack. The
 * pipeline runs this against the last published pack before publishing.
 */
export function checkPackSuccession(previous: Pack, next: Pack, opts: SuccessionOptions = {}): PackError[] {
  const errors: PackError[] = []
  if (next.pack_id !== previous.pack_id) errors.push({ path: 'pack_id', message: `must stay ${previous.pack_id}` })
  if (next.l1 !== previous.l1) errors.push({ path: 'l1', message: `must stay ${previous.l1}` })
  if (next.corpus_version <= previous.corpus_version) {
    errors.push({ path: 'corpus_version', message: `must be greater than ${previous.corpus_version}` })
  }
  if (next.schema_version < previous.schema_version) errors.push({ path: 'schema_version', message: 'must not go back' })
  const entries = new Set(next.entries.map((e) => e.entry_id))
  for (const e of previous.entries) {
    if (!entries.has(e.entry_id)) errors.push({ path: 'entries', message: `entry ${e.entry_id} was removed; retire it instead` })
  }
  if (!opts.allowRemovedUnits) {
    const units = new Set(next.units.map((u) => u.unit_id))
    for (const u of previous.units) {
      if (!units.has(u.unit_id)) errors.push({ path: 'units', message: `unit ${u.unit_id} was removed` })
    }
  }
  return errors
}
```

- [ ] **Step 4: Run and see it pass**

Run: `pnpm --filter @wordado/core exec vitest run src/packStability.test.ts && pnpm --filter @wordado/core typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add core/src/packStability.ts core/src/packStability.test.ts
git commit -m "feat(core): the succession check can accept removed units, never a removed entry

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: `--rebuild` in the draft, and moved entries in the level queue

**Files:**
- Modify: `pipeline/src/draft.ts` (`DraftOptions`; inside `runDraft`: the `proposed` map and the `assignUnits` call)
- Test: `pipeline/src/draft.test.ts`

**Interfaces:**
- Consumes: `bandLevel` with two steps (Task 2); `PipelineConfig.sizes` (Task 3); `selectLive` (Task 4).
- Produces: `DraftOptions.rebuild?: boolean`. With it, `runDraft` gives every entry its banded level and builds all units again. In every draft, `DraftEntry.level_flagged` is true for a never-published entry whose level was limited, and for a published entry whose proposal differs from its published level.

Background the implementer needs:
- `readLastPublished(dir)` returns `last.packs` (a map from L1 to `Pack`). Each `Pack.entries[i]` has `entry_id`, `level` and `retired`.
- Today `level_flagged` is `!unit && s.flagged`: a limited level is flagged only in the one draft that first places the entry in a unit, and never for a published entry. The second half of that is why the spec adds the published-level rule. The first half is a defect this task also repairs: the flag was lost on the next draft, before the ai-review action could see the row.
- `assignUnits(units, live, published, unitSize)` keeps an entry in its unit while its level matches, and gives new units the numbers after the highest number already present for the level. Passing the registry's units with empty `entry_ids` therefore makes every live entry "fresh" and continues the numbering.

- [ ] **Step 1: Let the test helper take a configuration**

In `pipeline/src/draft.test.ts`, replace the first two lines of the helper `publishedV1`:

```ts
async function publishedV1(): Promise<string> {
  const dir = makeContent()
```

with:

```ts
async function publishedV1(config: Partial<PipelineConfig> = {}): Promise<string> {
  const dir = makeContent({ config })
```

and add this import beside the other imports at the top of the file:

```ts
import type { PipelineConfig } from './config'
```

- [ ] **Step 2: Write the failing tests**

Add at the end of `describe('runDraft', …)` in `pipeline/src/draft.test.ts`:

```ts
  const ALL_LEVELS: Partial<PipelineConfig> = { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] }
  // New boundaries put almost every word in a far band; `sizes` keeps the old sizes, so only levels are in play.
  const FAR_BANDS: Partial<PipelineConfig> = { targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 } }

  it('without rebuild, new band boundaries move no published entry and no unit', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    const before = readDraft(dir)
    editConfig(dir, { ...FAR_BANDS })
    const plain = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(plain.entries.map((e) => [e.entry_id, e.level, e.level_flagged])).toEqual(before.entries.map((e) => [e.entry_id, e.level, false]))
    expect(plain.units.map((u) => [u.unit_id, u.entry_ids])).toEqual(before.units.map((u) => [u.unit_id, u.entry_ids]))
  })

  it('with rebuild, gives every entry its banded level and builds all units again, after the old numbers', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    const before = readDraft(dir)
    editConfig(dir, { ...FAR_BANDS })
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    expect(rebuilt.problems).toEqual([])
    expect([...rebuilt.live].sort()).toEqual([...before.live].sort())
    const byId = new Map(rebuilt.entries.map((e) => [e.entry_id, e]))
    // go (rank 2, band A2) keeps the LLM's A1. bank's river sense (rank 27, band C1) is limited to two steps: B1.
    expect(byId.get('go-1')).toMatchObject({ level: 'A1', level_flagged: false })
    expect(byId.get('bank-2')).toMatchObject({ level_proposal: 'B1', level: 'B1', level_flagged: true })
    const oldIds = new Set(before.units.map((u) => u.unit_id))
    const liveUnits = rebuilt.units.filter((u) => u.entry_ids.length > 0)
    expect(liveUnits.every((u) => !oldIds.has(u.unit_id))).toBe(true)
    // Every live entry is in exactly one unit, of its own level.
    const placed = liveUnits.flatMap((u) => u.entry_ids.map((id) => [id, u.level] as const))
    expect(placed.map(([id]) => id).sort()).toEqual([...rebuilt.live].sort())
    expect(placed.every(([id, level]) => byId.get(id)!.level === level)).toBe(true)
    // the and go are still A1: their new unit takes the number after the four old A1 units.
    expect(rebuilt.units.find((u) => u.entry_ids.includes('go-1'))).toMatchObject({ unit_id: 'a1-05', level: 'A1' })
    // The old units stay in the registry, empty, so their numbers are never given out again.
    const registry = JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')) as { units: { unit_id: string; entry_ids: string[] }[] }
    expect(registry.units.filter((u) => oldIds.has(u.unit_id)).map((u) => u.entry_ids)).toEqual([...oldIds].map(() => []))
  })

  it('after a rebuild, a plain offline draft gives the same course and keeps the moved entry in the level queue', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    editConfig(dir, { ...FAR_BANDS })
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const again = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(again.units).toEqual(rebuilt.units)
    expect(again.entries.map((e) => [e.entry_id, e.level, e.level_flagged])).toEqual(rebuilt.entries.map((e) => [e.entry_id, e.level, e.level_flagged]))
    const pending = pendingItems(again, Decisions.read(dir), ['bg'])
    expect(pending.get(QUEUES.level)!.find((i) => i.key === 'bank-2')).toMatchObject({ proposed: 'B1' })
    // A unit that lost all its words asks for no title.
    const emptied = ['a1-01', 'a1-02', 'a1-03', 'a1-04', 'a2-01']
    expect(pending.get(QUEUES.title('bg'))!.some((i) => emptied.includes(i.key))).toBe(false)
  })

  it('a second rebuild reuses no unit number and still places every live entry once', async () => {
    const dir = await publishedV1(ALL_LEVELS)
    editConfig(dir, { ...FAR_BANDS })
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    const firstIds = new Set(first.units.map((u) => u.unit_id))
    const liveUnits = second.units.filter((u) => u.entry_ids.length > 0)
    expect(liveUnits.every((u) => !firstIds.has(u.unit_id))).toBe(true)
    expect(liveUnits.flatMap((u) => u.entry_ids).sort()).toEqual([...second.live].sort())
  })

  it('keeps a limited level flagged from draft to draft until the entry is published', async () => {
    // B1 has room for bank's river sense beside the pinned sample words, so it is live and gets a unit.
    const dir = makeContent({ config: { ...ALL_LEVELS, ...FAR_BANDS, sizes: { A1: 62, A2: 2, B1: 100, B2: 1, C1: 1 } } })
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(first.live).toContain('bank-2')
    expect(first.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', level_flagged: true })
    const second = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(second.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', level_flagged: true })
  })
```

- [ ] **Step 3: Run and see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/draft.test.ts`
Expected: the first new test passes already (it pins today's default). The next three fail because `rebuild` is ignored: for example `bank-2` keeps `level: 'A2'`. The last fails on the second draft with `level_flagged: false`.

If the last test fails on the *first* draft with a different level for `bank-2`, stop and report: the fixture's ranks are not what this plan assumes (the 1, go 2, bank 3, and river as bank's third sense at rank 27).

- [ ] **Step 4: Add the option**

In `pipeline/src/draft.ts`, add to `DraftOptions` after `regroup`:

```ts
  /**
   * Once, for a deliberate release (spec 2026-10-06 §3.4): every entry takes its banded level, whatever unit it
   * sat in, and all units are built again. The old units stay in the registry, empty, so no number is reused.
   */
  readonly rebuild?: boolean
```

In `runDraft`, directly after the line `const last = readLastPublished(dir)`, add:

```ts
  // What each live entry's level was when last published: a proposal that differs from it is a move a reviewer sees.
  const publishedLevel = new Map<string, CefrLevel>()
  for (const pack of last.packs.values()) for (const e of pack.entries) if (!e.retired) publishedLevel.set(e.entry_id, e.level)
```

In the `proposed` map, replace these two lines:

```ts
    // An entry keeps its unit, and so its level, unless a banding decision moves it (Decision 9).
    const proposal = unit ? unit.level : s.banded
```

with:

```ts
    // An entry keeps its unit, and so its level, unless a banding decision moves it (Decision 9) or the units are
    // being rebuilt.
    const proposal = unit && !opts.rebuild ? unit.level : s.banded
    const was = publishedLevel.get(entry_id)
```

and replace the line `level_flagged: !unit && s.flagged,` with:

```ts
      // A limited level stays flagged until it is published; a published entry is flagged when its level moved.
      level_flagged: was === undefined ? s.flagged : was !== proposal,
```

Replace the first argument of the `assignUnits` call:

```ts
    opts.regroup ? registry.units.filter((u) => publishedUnits.has(u.unit_id)) : registry.units,
```

with:

```ts
    opts.rebuild
      ? registry.units.map((u) => ({ ...u, entry_ids: [] }))
      : opts.regroup
        ? registry.units.filter((u) => publishedUnits.has(u.unit_id))
        : registry.units,
```

`CefrLevel` is already imported at the top of `draft.ts`.

- [ ] **Step 5: Run the file and the suite**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/draft.test.ts && pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/review-app test && pnpm --filter @wordado/pipeline typecheck`
Expected: all pass.

If an older test now fails on `level_flagged`, read it before changing anything: the only intended difference from before is that a never-published entry with a limited level stays flagged on later drafts. Report any other difference instead of editing the test.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/draft.ts pipeline/src/draft.test.ts
git commit -m "feat(pipeline): draft --rebuild re-levels every entry and builds the units again, once

A published entry whose level moved is in the level queue in every draft, and a
limited level stays flagged until it is published.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The release accepts removed units once; `--rebuild` and the status line in the CLI

**Files:**
- Modify: `pipeline/src/release.ts` (`ReleasePlan`, `planRelease`)
- Modify: `pipeline/src/cli.ts` (`USAGE`, `draft`, `status`)
- Test: `pipeline/src/release.test.ts`, `pipeline/src/cli.test.ts`

**Interfaces:**
- Consumes: `checkPackSuccession(previous, next, { allowRemovedUnits })` (Task 5); `PipelineConfig.units_rebuilt_after` (Task 3); `DraftOptions.rebuild` (Task 6).
- Produces: `ReleasePlan.unitsRebuilt: boolean`; the CLI flag `--rebuild` on `corpus draft`.

- [ ] **Step 1: Write the failing release tests**

In `pipeline/src/release.test.ts`, add after the helper `reviewed`:

```ts
const setConfig = (dir: string, change: Record<string, unknown>) => {
  const file = join(dir, 'pipeline.json')
  writeJson(file, { ...JSON.parse(readFileSync(file, 'utf8')), ...change })
}

/** Version 1 published, then new band boundaries and a rebuild, reviewed and ready for a release. */
async function rebuiltAfterV1(beforeRebuild: (dir: string) => void = () => {}): Promise<{ dir: string; v1: Pack }> {
  const dir = makeContent({ config: { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] } })
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  await recordAudio(dir)
  approveAll(dir)
  const o = out()
  writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))
  adoptRelease(dir, o)
  const v1 = packOf(join(dir, 'last-published'), 'corpus-v1-bg.pack')
  setConfig(dir, { targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 } })
  beforeRebuild(dir)
  await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
  approveAll(dir)
  return { dir, v1 }
}
```

and add inside `describe('planRelease and writeRelease', …)`:

```ts
  it('refuses a rebuilt corpus whose old units are gone, unless units_rebuilt_after names the last published version', async () => {
    const { dir, v1 } = await rebuiltAfterV1()
    const refused = planRelease(dir, { draft: false, now: NOW })
    expect(refused.unitsRebuilt).toBe(false)
    expect(refused.problems).toEqual(v1.units.map((u) => `bg: units: unit ${u.unit_id} was removed`))
    setConfig(dir, { units_rebuilt_after: 1 })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.unitsRebuilt).toBe(true)
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const o = out()
    writeRelease(dir, o, plan)
    expect(publishProblems(reader(o))).toEqual([])
    const v2 = packOf(o, 'corpus-v2-bg.pack')
    const liveIds = (p: Pack) => p.entries.filter((e) => !e.retired).map((e) => e.entry_id).sort()
    expect(liveIds(v2)).toEqual(liveIds(v1))
    expect(v2.units.some((u) => v1.units.some((old) => old.unit_id === u.unit_id))).toBe(false)
    expect(loadCorpus([v2]).entries.size).toBe(v1.entries.length)
    // The setting names version 1 only: once version 2 is published, it allows nothing.
    adoptRelease(dir, o)
    expect(planRelease(dir, { draft: false, now: NOW }).unitsRebuilt).toBe(false)
  })

  it('carries an entry dropped before a rebuild, retired, in its old unit', async () => {
    const { dir, v1 } = await rebuiltAfterV1((d) => {
      const the = readDraft(d).entries.find((e) => e.entry_id === 'the-1')!
      Decisions.read(d).append(QUEUES.translation('bg'), [{ key: 'the-1', at: NOW, verdict: 'drop', proposed: the.l1['bg']!, by: 'r' }])
    })
    setConfig(dir, { units_rebuilt_after: 1 })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending, plan.retired]).toEqual([[], [], ['the-1']])
    const o = out()
    writeRelease(dir, o, plan)
    const v2 = packOf(o, 'corpus-v2-bg.pack')
    const old = v1.entries.find((e) => e.entry_id === 'the-1')!
    expect(v2.entries.find((e) => e.entry_id === 'the-1')).toEqual({ ...old, retired: true })
    expect(v2.units.find((u) => u.unit_id === old.unit_id)).toMatchObject({ level: 'A1', entry_ids: ['the-1'] })
  })
```

- [ ] **Step 2: Run and see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/release.test.ts`
Expected: both new tests fail: `refused.unitsRebuilt` is `undefined`, and the second plan's `problems` still lists the removed units.

- [ ] **Step 3: Pass the option from `planRelease`**

In `pipeline/src/release.ts`, add to the interface `ReleasePlan` after `retired`:

```ts
  /** `units_rebuilt_after` names the last published version: this release may leave out its units (spec 2026-10-06 §3.6). */
  readonly unitsRebuilt: boolean
```

In `planRelease`, after the line `const corpusVersion = last.manifest.corpus_version + 1`, add:

```ts
  // One release only: the setting stops matching as soon as its successor is published.
  const unitsRebuilt = config.units_rebuilt_after === last.manifest.corpus_version
```

Replace the line that calls `checkPackSuccession`:

```ts
    if (previous) problems.push(...checkPackSuccession(previous, out.pack).map((e) => `${l1}: ${e.path}: ${e.message}`))
```

with:

```ts
    if (previous) problems.push(...checkPackSuccession(previous, out.pack, { allowRemovedUnits: unitsRebuilt }).map((e) => `${l1}: ${e.path}: ${e.message}`))
```

and add `unitsRebuilt,` to the object `planRelease` returns, after `retired: [...retired].sort(),`.

- [ ] **Step 4: Run and see the release tests pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/release.test.ts`
Expected: all pass.

If the second new test fails because a unit that holds only a retired entry is refused by pack validation, stop and report the exact message: the spec's "no entry is removed" then needs a decision about such units.

- [ ] **Step 5: Write the failing CLI tests**

Add inside `describe('corpus (the CLI)', …)` in `pipeline/src/cli.test.ts`:

```ts
  it('draft refuses --rebuild together with --regroup', () => {
    const out = corpus('draft', makeContent(), '--rebuild', '--regroup', '--offline')
    expect(out.status).toBe(2)
    expect(out.stderr).toMatch(/usage: corpus/)
  })

  it('status says when the next release may replace the published units, and only then', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    // The fixture's last published version is the sample, version 0.
    writeJson(contentPaths(dir).config, { ...readConfig(dir), units_rebuilt_after: 0 })
    expect(corpus('status', dir).stdout).toMatch(/units_rebuilt_after/)
    writeJson(contentPaths(dir).config, { ...readConfig(dir), units_rebuilt_after: 7 })
    expect(corpus('status', dir).stdout).not.toMatch(/units_rebuilt_after/)
  })
```

- [ ] **Step 6: Run and see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/cli.test.ts`
Expected: 2 failed. The draft exits with status 1, not 2: it ignores `--rebuild`, runs offline and stops at the first stage that is not cached. And `status` prints no `units_rebuilt_after` line.

- [ ] **Step 7: Add the flag and the status line**

In `pipeline/src/cli.ts`:

Replace these two lines of `USAGE`:

```ts
    draft <dir> [--offline] [--regroup]
                                   every LLM stage; --offline uses the cache only; --regroup rebuilds unpublished units
```

with:

```ts
    draft <dir> [--offline] [--regroup | --rebuild]
                                   every LLM stage; --offline uses the cache only; --regroup rebuilds unpublished units;
                                   --rebuild, once: every entry takes its banded level and all units are built again
```

In the function `draft`, add as its first statement:

```ts
  if (flag('--rebuild') && flag('--regroup')) usage()
```

and replace `regroup: flag('--regroup'),` in the `runDraft` call with:

```ts
regroup: flag('--regroup'), rebuild: flag('--rebuild'),
```

In the function `status`, directly after the `console.log` that prints the headline (`corpus v…: … problems, …`), add:

```ts
  if (plan.unitsRebuilt) console.log('  units rebuilt: this release may leave out the published units (units_rebuilt_after)')
```

- [ ] **Step 8: Run the files, the suite, the typecheck and the lint**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/cli.test.ts src/release.test.ts && pnpm --filter @wordado/pipeline test && pnpm typecheck && pnpm lint`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add pipeline/src/release.ts pipeline/src/release.test.ts pipeline/src/cli.ts pipeline/src/cli.test.ts
git commit -m "feat(pipeline): one release may replace the published units (units_rebuilt_after); corpus draft --rebuild

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: End to end, the README, and the spec note

**Files:**
- Test: `pipeline/src/e2e.test.ts`
- Modify: `pipeline/README.md`
- Modify: `docs/superpowers/specs/2026-10-06-levels-and-coverage-design.md` (§3.5)

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Write the end-to-end test**

Add inside the `describe` of `pipeline/src/e2e.test.ts`, after the existing test:

```ts
  it('rebuilds levels and units once, reviews the moved level in a spreadsheet, and releases v2 with every entry kept', async () => {
    const dir = makeContent({ config: { levels: ['A1', 'A2', 'B1', 'B2', 'C1'] } })
    const specs = queueSpecs(['bg'])
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await recordAudio(dir, '20261001T1000')
    queues(dir, '2026-10-01')
    review(dir)
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-01T12:00:00Z' }).errors).toEqual([])
    const v1Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v1')
    writeRelease(dir, v1Dir, planRelease(dir, { draft: false, now: '2026-10-01T13:00:00Z' }))
    const v1 = pack(v1Dir, 'corpus-v1-bg.pack')
    adoptRelease(dir, v1Dir)

    // New band boundaries, the old sizes, and leave to replace version 1's units.
    const file = join(dir, 'pipeline.json')
    writeFileSync(
      file,
      JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), targets: { A1: 1, A2: 1, B1: 1, B2: 1, C1: 1 }, sizes: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 }, units_rebuilt_after: 1 }),
    )
    const rebuilt = await runDraft({ dir, llm: sampleLlm(), offline: false, rebuild: true })
    expect(rebuilt.live).toHaveLength(v1.entries.length)
    const written = queues(dir, '2026-10-05')
    const levelFile = written.find((f) => f.startsWith('review/level/'))
    expect(levelFile).toBeDefined()
    expect(parseCsv(readFileSync(join(dir, levelFile!), 'utf8')).some((row) => row[0] === 'bank-2')).toBe(true)
    review(dir)
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-05T12:00:00Z' }).errors).toEqual([])
    await runDraft({ dir, llm: sampleLlm(), offline: true })

    const plan = planRelease(dir, { draft: false, now: '2026-10-05T13:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const v2Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v2')
    writeRelease(dir, v2Dir, plan)
    expect(publishProblems(reader(v2Dir))).toEqual([])
    const v2 = pack(v2Dir, 'corpus-v2-bg.pack')
    expect(checkPackSuccession(v1, v2, { allowRemovedUnits: true })).toEqual([])
    expect(checkPackSuccession(v1, v2).map((e) => e.path)).toEqual(v1.units.map(() => 'units'))
    expect(v2.entries.find((e) => e.entry_id === 'bank-2')).toMatchObject({ level: 'B1', retired: false })
    expect(v2.units.find((u) => u.entry_ids.includes('bank-2'))!.level).toBe('B1')
    const fixes = JSON.parse(readFileSync(join(v2Dir, 'fixes.json'), 'utf8')) as { fixes: { word_id: string; field: string; fixed_in: number }[] }
    expect(fixes.fixes.some((f) => f.word_id === 'c:bank-2' && f.field === 'level' && f.fixed_in === 2)).toBe(true)
  }, 30_000)
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/e2e.test.ts`
Expected: both tests pass. This test adds no new behaviour: it proves Tasks 1 to 7 work together through the spreadsheet path. If it fails, the failure names the task to return to; do not weaken an assertion to make it pass.

- [ ] **Step 3: Update the README**

In `pipeline/README.md`, replace the `draft` row of the Commands table with:

```markdown
| `draft <dir> [--offline] [--regroup \| --rebuild]` | Every LLM stage, then IDs, selection, themes, units and titles. Needs `OPENROUTER_API_KEY`, except `--offline`, which uses the caches only. `--regroup` rebuilds every unit no published pack carries. `--rebuild` is for one deliberate release: see *Levels, sizes and which words are in*. |
```

and add this section directly before `## Themes and units`:

```markdown
## Levels, sizes and which words are in

A sense's level is the LLM's judgement, kept within **two** bands of its word's frequency band (one band, until
2026-10-06, put everyday words that print mentions rarely two levels too high). `targets` in `pipeline.json` sets
the band boundaries and nothing else needs to change them.

Which entries are live is decided in this order:

1. Pinned entries and entries live in the last published pack. A learner's words never vanish.
2. The main meanings named by `main_meanings`: `"A1": "all"` takes every main meaning of the level, and
   `"B1": 5100` takes those whose word is among the 5,100 most frequent. An easy word is then never left out
   because more frequent ones filled its level.
3. The most frequent of the rest, until a level holds `sizes[level]` entries. Without `sizes`, `targets` is used.

    "sizes": { "A1": 600, "A2": 1000, "B1": 1500, "B2": 1600, "C1": 2000 },
    "main_meanings": { "A1": "all", "A2": "all", "B1": 5100 }

A word form whose lemma answer came back empty counts as its own headword, unless it holds an apostrophe.

### Rebuilding levels and units, once

A published entry keeps its unit, and so its level; a published unit keeps its words. To apply a new level rule
to the whole corpus, run **once**, locally:

    pnpm --filter @wordado/pipeline corpus draft "$PWD/content" --rebuild

Every entry takes its banded level and all units are built again. The old units stay in `registry.json`, empty,
so their numbers are never reused. Every entry keeps its ID and stays live. Commit the caches and
`registry.json`; later plain drafts read the new units.

A published entry whose level changed is in the `level` queue, so the AI review checks it and a person decides its
objections, as for any row.

The release refuses removed units. For this one release, name the version being replaced in `pipeline.json`:

    "units_rebuilt_after": 5

It has an effect only while version 5 is the last published one, and `corpus status` says so while it does.
Remove it after the release. Learners keep every word's progress; the saved unit unlocks are lost, and the app
works the path out again from the words they have met.
```

- [ ] **Step 4: Record in the spec what Task 6 found**

In `docs/superpowers/specs/2026-10-06-levels-and-coverage-design.md`, replace the first paragraph of §3.5 (it begins "`level_flagged` (`src/draft.ts`) is true today") with:

```markdown
`level_flagged` (`src/draft.ts`) was true only in the one draft that first placed a limited entry in a unit: the
next draft found the entry in a unit and cleared the flag, before the ai-review action could see the row. It is
now decided against the last published pack, in every draft, not only with `--rebuild`:

- an entry that was never published is flagged while the limit changed its level;
- a published entry is flagged when its proposal differs from its published level.

So the rows stay in the queue for the actions that follow, and leave it by themselves once version 6 is published.
```

- [ ] **Step 5: Run everything**

Run: `pnpm typecheck && pnpm lint && pnpm --filter @wordado/core test && pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/review-app test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/e2e.test.ts pipeline/README.md docs/superpowers/specs/2026-10-06-levels-and-coverage-design.md
git commit -m "test(pipeline): a rebuild end to end; docs: levels, sizes, main meanings and the one-time rebuild

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## After the tasks: operator steps (not for the implementer)

These are the product owner's steps from spec §6. None of them is run by an agent without an explicit go-ahead: they spend money, change the private content repository, or publish.

1. Open a pull request from `spec/levels-and-coverage` and merge it when CI is green.
2. In `wordado-content`: add the twelve months to `essentials.txt`; add `sizes`, `main_meanings` and `"units_rebuilt_after": 5` to `pipeline.json` (values in spec §3.3 and §3.6); move the variable `PIPELINE_REF` to the merged commit.
3. Locally: `pnpm --filter @wordado/pipeline corpus draft "$PWD/content" --rebuild`, with `OPENROUTER_API_KEY` or `CORPUS_LLM=claude-code`. Commit the caches and `registry.json` in a pull request.
4. `python3 check.py "$PWD/content"` in the research repository's `2026-10-06-level-check/`, and compare with spec §1 and §5 before spending more.
5. Actions › Corpus › `ai-review`, one queue at a time.
6. Decide the rows with a major objection in the review app; import; pull request.
7. Actions › Corpus › `audio`; listen to the sample.
8. `corpus status`, then Actions › Corpus › `release`.
9. Remove `units_rebuilt_after` from `pipeline.json`.
