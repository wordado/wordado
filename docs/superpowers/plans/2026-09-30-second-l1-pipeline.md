# A Second L1 in the Pipeline, and the German Corpus Implementation Plan (plan 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The corpus pipeline builds a German pack (English for German speakers, L1 `de`) beside the Bulgarian one, without changing a single word, gloss, unit, title or review decision of the published Bulgarian corpus.

**Architecture:** One draft still serves every L1: senses, themes, levels, audio, IDs and units are shared, and only translations and unit titles are asked per L1. Today three rules assume one L1, and each would rewrite the Bulgarian corpus the moment `de` is added:
- senses merge on every L1's translation;
- unit titles are cached under the whole L1 list;
- a fix doesn't say which L1's translation changed.

This plan makes the first L1 in `pipeline.json` the lead L1 that senses merge on, asks unit titles one L1 at a time (so Bulgarian's cache still hits), and records the L1 on translation fixes. It then adds the German translation guide, unit-group names and theme names, and drafts the German corpus. The app side (choosing and changing L1, a German demo, the German interface, reports that carry the L1) is plan 10.

**Tech Stack:** TypeScript 7 (strict, `exactOptionalPropertyTypes`), pnpm workspaces (`@wordado/core`, `@wordado/pipeline`), Vitest, oxlint, the Corpus workflow of `wordado/wordado-content`.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`
- §3: the five L1s.
- §5.1: one pack per (version, L1).
- §5.2: senses split only where translations diverge.
- §8.9: every theme named in every L1.
- §8.10: reports and fixes.
- §14 Phase 1b: "Spanish, German, French, and Russian translations for A1–B1, each released when its native-speaker review is complete. No code change: a new pack per L1." This plan is the code change that makes the second half of that sentence true.

## Decisions

1. **Senses merge on the lead L1.** The lead is the first code in `pipeline.json`'s `l1s` (`bg`), the L1 the published corpus was built on.
   - Two senses of one headword and part of speech with the same lead translation are one entry, whatever the other L1s say.
   - Where another L1 translates the merged senses differently, that L1 keeps the first sense's translation and gains the other's words as alternates (at most four). A German learner who types either word is right.
   - Adding an L1 therefore never splits a published entry. A new L1 is appended to `l1s`, never put first.
   - A release refuses when the lead L1 has never been published but another has.
2. **Unit titles are asked one L1 at a time.**
   - The cache key is `{ level, words, l1s: [l1] }`. For `bg` that is exactly today's key (`l1s: ['bg']`), so every Bulgarian title, and every review decision on it, stays as it is.
   - A title's English half comes from the lead L1's answer, so every L1's pack shows the same English unit title.
3. **A translation fix names its L1** (`"l1": "de"` in `fixes.json`); audio, example and level fixes are shared and carry none. A translation fix answers a report only when both name the same L1.
   - Fixes and reports without an L1 predate this plan and were all Bulgarian, so they count as `bg`.
   - Plan 10 makes reports carry the learner's L1.
4. **A drop removes the word for every L1** (the product owner, 2026-09-30). The word list, units and progress stay shared.
   - Reviewers drop only when the English sense itself is wrong. A hard-to-translate word gets the best translation and a note.
5. **German ships unreviewed, like Bulgarian v1** (the product owner, 2026-09-30).
   - `accept_unreviewed` names `translation-de` and `title-de`, so German neither blocks a Bulgarian release nor waits for a reviewer. Its review comes with a later version.
6. **German style, for the translation guide:**
   - nouns singular and capitalised, without the article;
   - verbs in the infinitive (separable and reflexive as a dictionary gives them);
   - adjectives uninflected;
   - standard German (Germany), current spelling, with ß and umlauts.
   - Articles are left out because the learners are German speakers: they know the gender, and the answer they type is the word.
7. **Triage still reopens every L1's translation set on a translation report**, until plan 10 gives reports an L1 (`pipeline/src/reports.ts:62-67` says so today).

## Global Constraints

- Commits use the author email `11029931+danchom@users.noreply.github.com`, never a personal address. The subject goes on its own first line, and trailers go in the body after a blank line: `git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -F <message file>`.
- No new dependencies. The pnpm minimum-release-age gate stays as it is.
- `pnpm typecheck` and `pnpm lint` (`oxlint --deny-warnings`) pass at the repository root after every task.
- Run a package's tests from its directory with `npx vitest run <file>`, and all of them with `npx vitest run`.
- Business strategy (prices, the business model, payment providers, market or competitor reasoning) never goes into this public repository, including plans, READMEs, commit messages and pull request descriptions.
- Anything that touches `wordado/wordado-content`, moves `PIPELINE_REF`, runs a workflow or spends money on the LLM needs the product owner's go-ahead at the time.

## Review Focus

1. **Adding `de` leaves Bulgarian exactly as published:** every live entry's ID, translation, alternates, sense gloss, IPA, examples and level; every unit and its Bulgarian title; every review decision; no new Bulgarian fixes. Tests: Task 4 (draft and release golden tests).
2. **A sense Bulgarian merged but German translates two ways:** the German learner is marked right for either word. Test: Task 2 (`mergeSenses` folds the other translation into the alternates).
3. **A German translation fix must never tell a Bulgarian reporter "fixed", nor the other way round.** Fixes and reports from before this plan count as Bulgarian. Test: Task 1 (`fixedReports`).
4. **An L1 put first in `l1s` by mistake would re-merge the senses:** the release refuses and names the lead. Test: Task 4.
5. **German names missing from `themes.json`:** the draft refuses before any LLM call and names each missing name (the existing `themeProblems`). Task 5 adds them before `de` goes into `l1s`, and its check step runs the draft offline first to prove it.

---

### Task 1: Core and pipeline: a translation fix names its L1

**Files:**
- Modify: `core/src/fixes.ts`, `core/src/fixes.test.ts`, `pipeline/src/fixes.ts`, `pipeline/src/fixes.test.ts`, `pipeline/src/release.ts:88-94`
- Update expectations: `pipeline/src/release.test.ts:130`, `pipeline/src/e2e.test.ts:100`

**Interfaces:**
- Produces:
  - `Fix` gains `readonly l1?: string`, present only when `field === 'translation'`.
  - `ReportRecord` gains `readonly l1?: string`.
  - `LEGACY_L1 = 'bg'`, exported from `core/src/fixes.ts`.
  - `fixedReports` compares L1s for translation fixes.
  - `diffFixes(previous, next)` sets `l1: next.l1` on translation fixes.

- [ ] **Step 1: Write the failing tests**

Add to `core/src/fixes.test.ts`, inside `describe('validateFixes', …)`:

```ts
  it('accepts an L1 on a translation fix only', () => {
    const withL1 = { schema_version: 1, corpus_version: 2, fixes: [{ word_id: 'c:bank-1', field: 'translation', fixed_in: 2, l1: 'de' }] }
    expect(validateFixes(withL1)).toEqual(withL1)
    expect(validateFixes({ ...withL1, fixes: [{ word_id: 'c:bank-1', field: 'audio', fixed_in: 2, l1: 'de' }] })).toBeNull()
    expect(validateFixes({ ...withL1, fixes: [{ word_id: 'c:bank-1', field: 'translation', fixed_in: 2, l1: 'DE' }] })).toBeNull()
  })
```

and inside `describe('fixedReports', …)`:

```ts
  it('matches a translation fix only to a report in the same L1; one without an L1 counts as Bulgarian', () => {
    const file: FixesFile = { schema_version: 1, corpus_version: 3, fixes: [{ word_id: 'c:go-1', field: 'translation', fixed_in: 2, l1: 'de' }, { word_id: 'c:go-1', field: 'audio', fixed_in: 2 }] }
    const de = { ...report('k1', 'c:go-1', 'translation', 1), l1: 'de' }
    const bg = report('k2', 'c:go-1', 'translation', 1)
    const deAudio = { ...report('k3', 'c:go-1', 'audio', 1), l1: 'de' }
    expect(fixedReports([de, bg, deAudio], file, 3).map((m) => m.report.key)).toEqual(['k1', 'k3'])
    const legacy: FixesFile = { schema_version: 1, corpus_version: 2, fixes: [{ word_id: 'c:go-1', field: 'translation', fixed_in: 2 }] }
    expect(fixedReports([de, bg], legacy, 2).map((m) => m.report.key)).toEqual(['k2'])
  })
```

Add to `pipeline/src/fixes.test.ts`:

```ts
  it('names the pack’s L1 on a translation fix, and none on shared fields', () => {
    const before = pack(1, [e()])
    const after = { ...pack(2, [e({ translation: 'Wasser', ipa: 'x' })]), l1: 'de' }
    expect(diffFixes({ ...before, l1: 'de' }, after)).toContainEqual({ word_id: 'c:water-1', field: 'translation', fixed_in: 2, l1: 'de' })
  })
```

If `pack` or `e` in that file do not accept these overrides, build the packs the way the file's other tests do and set `l1: 'de'` on both. If `ipa` is not a field `diffFixes` compares, drop it from the override: the point is the `translation` fix's `l1`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd core && npx vitest run src/fixes.test.ts; cd ../pipeline && npx vitest run src/fixes.test.ts`
Expected: FAIL. `validateFixes` returns null for an `l1`, `fixedReports` matches `k2` in the first case, and `diffFixes` sets no `l1`.

- [ ] **Step 3: Implement**

In `core/src/fixes.ts`:

```ts
/** Fixes and reports written before either carried an L1 were all Bulgarian (plan 9, Decision 3). */
export const LEGACY_L1 = 'bg'
const L1 = /^[a-z]{2}$/

export interface Fix {
  readonly word_id: string
  readonly field: FixedField
  readonly fixed_in: number
  /** The L1 whose translation changed; only on translation fixes, whose text is per L1. */
  readonly l1?: string
}
```

In `validateFixes`'s loop, after reading `fixedIn`:

```ts
    const l1 = f['l1']
    if (l1 !== undefined && (typeof l1 !== 'string' || !L1.test(l1) || field !== 'translation')) return null
    out.push({ word_id: wordId, field: field as FixedField, fixed_in: fixedIn, ...(typeof l1 === 'string' ? { l1 } : {}) })
```

(replacing the existing `out.push(…)`).

In `ReportRecord`:

```ts
  /** The learner's L1 when reporting; absent on reports from before plan 10, which were all Bulgarian. */
  readonly l1?: string
```

In `fixedReports`, the filter becomes:

```ts
      .filter(
        (f) =>
          f.word_id === report.wordId &&
          f.field === report.field &&
          (f.field !== 'translation' || (f.l1 ?? LEGACY_L1) === (report.l1 ?? LEGACY_L1)) &&
          f.fixed_in > report.packVersion &&
          f.fixed_in <= installed,
      )
```

Update the doc comment: "same word and field (and, for a translation, the same L1)".

In `pipeline/src/fixes.ts`, `diffFixes`:

```ts
      if (canonicalJson(value(old)) !== canonicalJson(value(e))) {
        out.push({ word_id: `c:${e.entry_id}`, field, fixed_in: next.corpus_version, ...(field === 'translation' ? { l1: next.l1 } : {}) })
      }
```

In `pipeline/src/release.ts`, the de-duplication key keeps each L1's translation fix:

```ts
      const key = `${f.word_id}|${f.field}|${f.l1 ?? ''}`
```

Update the two expectations that pin a translation fix: `pipeline/src/release.test.ts:130` and `pipeline/src/e2e.test.ts:100` become `[{ word_id: 'c:go-1', field: 'translation', fixed_in: 2, l1: 'bg' }]`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd core && npx vitest run && cd ../pipeline && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. The web's `FixNotices` (plan 8b) builds `ReportRecord`s without `l1`, so they count as Bulgarian, which is right while the app is Bulgarian only.

- [ ] **Step 5: Commit**

```bash
git add core/src/fixes.ts core/src/fixes.test.ts pipeline/src/fixes.ts pipeline/src/fixes.test.ts pipeline/src/release.ts pipeline/src/release.test.ts pipeline/src/e2e.test.ts
git -c user.email=11029931+danchom@users.noreply.github.com -c user.name=danchom commit -F <message file>   # subject: feat: a translation fix names its L1
```

---

### Task 2: Pipeline: senses merge on the lead L1, and the German guide

**Files:**
- Modify: `pipeline/src/stages/translate.ts` (`L1_GUIDES` at lines 27-36, `mergeSenses` at lines 114-128), `pipeline/src/units.ts` (`GROUP_NAMES` at lines 97-106), `pipeline/src/testing/fixture.ts` (the fake `translate` and `titles`)
- Test: `pipeline/src/stages/translate.test.ts`, `pipeline/src/units.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `mergeSenses(senses, l1s)` keeps its signature. It now merges on `l1s[0]` and folds the other L1s' translations of merged senses into the kept sense's alternates.
  - `L1_GUIDES.de`.
  - `GROUP_NAMES.de`.
  - The fixture's fake LLM answers `translate` for `l1: 'de'`, and `titles` for whichever `l1s` the input names (Task 3 sends `l1s` in the input).

- [ ] **Step 1: Write the failing tests**

In `pipeline/src/stages/translate.test.ts`, inside `describe('mergeSenses (Decision 8)', …)`, add the following. Keep the existing `s(gloss, bg)` helper for the Bulgarian-only test. If the file's `s` has a different shape, write this local helper instead:

```ts
  const two = (gloss: string, bg: string, de: { translation: string; alternates?: string[] }) => ({
    headword: 'bank',
    pos: 'noun',
    gloss,
    l1: { bg: { translation: bg, alternates: [], sense: '' }, de: { translation: de.translation, alternates: de.alternates ?? [], sense: '' } },
  })

  it('merges on the lead L1 only; another L1’s other words become alternates of the kept sense', () => {
    const out = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Bankgebäude', alternates: ['Bank'] }), two('river', 'бряг', { translation: 'Ufer' })], ['bg', 'de'])
    expect(out.map((x) => x.gloss)).toEqual(['money', 'river'])
    expect(out[0]!.l1['de']).toEqual({ translation: 'Bank', alternates: ['Bankgebäude'], sense: '' })
    expect(out[0]!.l1['bg']).toEqual({ translation: 'банка', alternates: [], sense: '' })
  })

  it('never lets a later L1 split senses the lead L1 merged', () => {
    const one = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Gebäude' })], ['bg'])
    const both = mergeSenses([two('money', 'банка', { translation: 'Bank' }), two('building', 'банка', { translation: 'Gebäude' })], ['bg', 'de'])
    expect(both.map((x) => x.gloss)).toEqual(one.map((x) => x.gloss))
  })

  it('keeps at most four alternates', () => {
    const out = mergeSenses(
      [two('a', 'x', { translation: 'eins', alternates: ['zwei', 'drei', 'vier'] }), two('b', 'x', { translation: 'fünf', alternates: ['sechs'] })],
      ['bg', 'de'],
    )
    expect(out[0]!.l1['de']!.alternates).toEqual(['zwei', 'drei', 'vier', 'fünf'])
  })
```

Add a guide test next to the file's existing `L1_GUIDES` test:

```ts
  it('has a German guide: nouns without the article, verbs in the infinitive', () => {
    expect(L1_GUIDES['de']).toMatch(/German/)
    expect(L1_GUIDES['de']).toMatch(/without the article/)
    expect(L1_GUIDES['de']).toMatch(/infinitive/)
  })
```

In `pipeline/src/units.test.ts`, next to the existing `groupTitles` test:

```ts
  it('names part-of-speech and mixed units in German', () => {
    const units = [
      { unit_id: 'a1-05', level: 'A1' as const, entry_ids: ['x-1'], group: 'pos:verb' },
      { unit_id: 'a1-06', level: 'A1' as const, entry_ids: ['y-1'], group: 'mixed' },
    ]
    const titles = groupTitles(units, ['bg', 'de'])
    expect(titles.get('a1-05')).toEqual({ bg: { en: 'Verbs 1', l1: 'Глаголи 1' }, de: { en: 'Verbs 1', l1: 'Verben 1' } })
    expect(titles.get('a1-06')!['de']).toEqual({ en: 'More words 1', l1: 'Weitere Wörter 1' })
  })
```

(Use the `RegistryUnit` shape the file's other `groupTitles` test uses, if it differs.)

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd pipeline && npx vitest run src/stages/translate.test.ts src/units.test.ts`
Expected: FAIL. `mergeSenses` keeps `building` (the German translations differ), there is no German guide, and `groupTitles` throws "no unit group names for de".

- [ ] **Step 3: Implement**

Replace `mergeSenses` in `pipeline/src/stages/translate.ts`:

```ts
const MAX_ALTERNATES = 4

/**
 * Senses of one headword and POS merge when the lead L1's primary translations agree (spec §5.2; plan 9,
 * Decision 1). The lead is the first L1 in `pipeline.json`, the one the published corpus was built on, so adding
 * an L1 never splits a published entry. Where another L1 translates merged senses differently, it keeps the
 * first sense's translation and gains the other's words as alternates, so either answer is right.
 */
export function mergeSenses<T extends { readonly headword: string; readonly pos: string; readonly l1: Readonly<Record<string, TranslationFields>> }>(
  senses: readonly T[],
  l1s: readonly string[],
): T[] {
  const lead = l1s[0]
  if (lead === undefined) return [...senses]
  const kept: T[] = []
  const at = new Map<string, number>()
  for (const s of senses) {
    const signature = [norm(s.headword), s.pos, norm(s.l1[lead]?.translation ?? '')].join('|')
    const index = at.get(signature)
    if (index === undefined) {
      at.set(signature, kept.length)
      kept.push(s)
      continue
    }
    const first = kept[index]!
    const l1: Record<string, TranslationFields> = { ...first.l1 }
    for (const other of l1s.slice(1)) {
      const mine = first.l1[other]
      const theirs = s.l1[other]
      if (!mine || !theirs) continue
      const known = new Set([mine.translation, ...mine.alternates].map(norm))
      const alternates = [...mine.alternates]
      for (const word of [theirs.translation, ...theirs.alternates]) {
        if (known.has(norm(word))) continue
        known.add(norm(word))
        alternates.push(word)
      }
      l1[other] = { ...mine, alternates: alternates.slice(0, MAX_ALTERNATES) }
    }
    kept[index] = { ...first, l1 }
  }
  return kept
}
```

The existing parse already caps alternates at four with a literal `slice(0, 4)`. Use `MAX_ALTERNATES` there too.

Add to `L1_GUIDES`:

```ts
  de: `Translate into German, as a bilingual dictionary would.
- Nouns: the singular, capitalised, without the article (Wasser, not das Wasser): the learners are German speakers and know the gender.
- Verbs: the infinitive (schreiben). Separable and reflexive verbs as a dictionary gives them (anrufen; sich freuen).
- Adjectives: the uninflected form (groß).
- Interjections and phrases: what a German speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four German words that tell this sense apart from the headword's other senses (for bank: "Geldinstitut", "Flussufer"). Empty when the gloss is empty.
Use standard German as written in Germany, in the current spelling, with ß and umlauts. No English words, no explanations in brackets.`,
```

Add to `GROUP_NAMES` in `pipeline/src/units.ts`:

```ts
  de: {
    noun: 'Nomen', verb: 'Verben', adj: 'Adjektive', adv: 'Adverbien', pron: 'Pronomen', prep: 'Präpositionen',
    det: 'Begleiter', num: 'Zahlwörter', conj: 'Konjunktionen', intj: 'Ausrufe', phrase: 'Wendungen', mixed: 'Weitere Wörter',
  },
```

In `pipeline/src/testing/fixture.ts`:

```ts
const EXTRA_DE: Record<string, { translation: string; alternates: string[]; sense: string }> = {
  'the|': { translation: 'der', alternates: ['die', 'das'], sense: '' },
  'okay|': { translation: 'okay', alternates: ['gut'], sense: '' },
  'go|': { translation: 'gehen', alternates: ['fahren'], sense: '' },
  'bank|money': { translation: 'Bank', alternates: [], sense: 'Geldinstitut' },
  'bank|building': { translation: 'Bankgebäude', alternates: [], sense: 'Gebäude' },
  'bank|river': { translation: 'Ufer', alternates: [], sense: 'Flussufer' },
}
```

- In the fake `translate`, read `l1` from the input (`(input as { l1: string; items: … })`). When `l1 === 'de'`, answer `EXTRA_DE[…]` or, for a sample word, `{ translation: \`DE ${item.headword}\`, alternates: [], sense: '' }`. Otherwise keep today's Bulgarian answer.
- In the fake `titles`, read `l1s` from the input (Task 3 sends it; default to `['bg']` when absent). Answer `{ unit, en: \`Unit ${u.unit}\`, ...Object.fromEntries(l1s.map((l) => [l, l === 'bg' ? \`Урок ${u.unit}\` : \`Lektion ${u.unit}\`])) }`.

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd pipeline && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS. The existing merge test (`['bg']`) passes unchanged: with one L1, merging on the lead is today's rule.

- [ ] **Step 5: Commit**

Subject: `feat(pipeline): senses merge on the lead L1, and a German translation guide`.

---

### Task 3: Pipeline: unit titles, one L1 at a time

**Files:**
- Modify: `pipeline/src/stages/titles.ts` (`titleUnits` at lines 53-78)
- Test: `pipeline/src/stages/titles.test.ts`

**Interfaces:**
- Consumes: the fixture's `titles` fake, which answers the `l1s` named in its input (Task 2).
- Produces: `titleUnits(units, l1s, run)` keeps its signature and return type (`Map<unit_id, Record<l1, { en, l1 }>>`). It now makes one cached batch per L1, keyed `{ level, words, l1s: [l1] }`, and takes each title's `en` from `l1s[0]`'s answer.

- [ ] **Step 1: Write the failing tests**

Add to `pipeline/src/stages/titles.test.ts`. The file's `run(answer)` helper opens a fresh cache. Add a variant that shares one cache file:

```ts
import { cacheKey } from '../cache'

const shared = () => join(mkdtempSync(join(tmpdir(), 'titles-')), 'titles.jsonl')
const on = (file: string, answer: (n: string, i: unknown) => unknown) => ({ llm: fakeLlm(answer), cache: StageCache.open(file), concurrency: 1, offline: false })
const perL1 = (_: string, input: unknown) => {
  const { l1s, units } = input as { l1s: string[]; units: { unit: string }[] }
  return { items: units.map((u) => ({ unit: u.unit, en: l1s[0] === 'bg' ? 'Food' : 'Eating', ...Object.fromEntries(l1s.map((l) => [l, l === 'bg' ? 'Храна' : 'Essen'])) })) }
}

it('keeps the Bulgarian cache key of the single-L1 pipeline, so adding German asks German only', async () => {
  const file = shared()
  const units = [{ unit_id: 'a1-04', level: 'A1' as const, words: ['milk', 'bread'] }]
  await titleUnits(units, ['bg'], on(file, perL1))
  // The key a Bulgarian-only draft wrote before this plan.
  expect(StageCache.open(file).has(cacheKey('titles', 1, { level: 'A1', words: ['bread', 'milk'], l1s: ['bg'] }))).toBe(true)
  const r = on(file, perL1)
  const out = await titleUnits(units, ['bg', 'de'], r)
  expect(r.llm.calls.map((c) => (c.input as { l1s: string[] }).l1s)).toEqual([['de']])
  // One English title for every L1: the lead's.
  expect(out.get('a1-04')).toEqual({ bg: { en: 'Food', l1: 'Храна' }, de: { en: 'Food', l1: 'Essen' } })
})
```

If `TITLES_VERSION` is not 1 when you start, use its value in the `cacheKey` call.

- [ ] **Step 2: Run the test and see it fail**

Run: `cd pipeline && npx vitest run src/stages/titles.test.ts`
Expected: FAIL. With `['bg', 'de']`, the key includes both L1s, so the call asks for both (and the input has no `l1s`).

- [ ] **Step 3: Implement**

Replace `titleUnits` in `pipeline/src/stages/titles.ts`:

```ts
/**
 * A title per unit, per L1, asked one L1 at a time (plan 9, Decision 2): a Bulgarian title's cache key is the one
 * a Bulgarian-only draft wrote, so adding an L1 asks only that L1. Every L1's title takes its English from the lead
 * L1's answer. A unit whose words change is named again, and its title goes back to review.
 */
export async function titleUnits(units: readonly TitleUnit[], l1s: readonly string[], run: StageRun): Promise<Map<string, Titles>> {
  const byL1 = new Map<string, Titles[]>()
  for (const l1 of l1s) {
    const one = [l1]
    byL1.set(
      l1,
      await cachedBatch({
        cache: run.cache,
        stage: 'titles',
        version: TITLES_VERSION,
        items: units,
        keyInput: (u) => ({ level: u.level, words: [...u.words].sort(), l1s: one }),
        batchSize: 10,
        concurrency: run.concurrency,
        offline: run.offline,
        model: run.llm.model,
        run: (batch) =>
          run.llm.json({
            name: 'titles',
            system: SYSTEM(one),
            input: { l1s: one, units: batch.map((u) => ({ unit: u.unit_id, level: u.level, words: u.words })) },
            schema: schema(one),
            parse: parse(
              batch.map((u) => u.unit_id),
              one,
            ),
          }),
      }),
    )
  }
  const lead = l1s[0]
  return new Map(
    units.map((u, i) => {
      const en = lead === undefined ? '' : byL1.get(lead)![i]![lead]!.en
      return [u.unit_id, Object.fromEntries(l1s.map((l1) => [l1, { en, l1: byL1.get(l1)![i]![l1]!.l1 }]))]
    }),
  )
}
```

- [ ] **Step 4: Run the tests and see them pass**

Run: `cd pipeline && npx vitest run && cd .. && pnpm typecheck && pnpm lint`
Expected: PASS, including the existing titles tests (one L1 behaves as before) and the draft tests.

- [ ] **Step 5: Commit**

Subject: `feat(pipeline): unit titles asked one L1 at a time, keeping the Bulgarian cache`.

---

### Task 4: Pipeline: adding an L1 leaves the published corpus alone (golden tests, the lead check, the runbook)

**Files:**
- Modify: `pipeline/src/release.ts` (`planRelease`, next to the "published before" check at line ~58), `pipeline/README.md`, `pipeline/template/README.md:26-27`
- Test: `pipeline/src/draft.test.ts`

**Interfaces:**
- Consumes:
  - Tasks 1–3.
  - `publishedV1()` and `editConfig(dir, change)` in `pipeline/src/draft.test.ts:16-30`.
  - `runDraft`, `recordAudio`, `approveAll`, `sampleLlm`, `planRelease`, `writeRelease`, `pendingItems`, and `readLastPublished`.
- Produces: a release problem, `"the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead"`, when some L1 has been published but `l1s[0]` has not.

- [ ] **Step 1: Write the failing tests**

Add to `pipeline/src/draft.test.ts`. The helper names every theme in German, which `themeProblems` requires once `de` is in `l1s`:

```ts
const nameThemesInGerman = (dir: string) => {
  const file = join(dir, 'themes.json')
  const themes = JSON.parse(readFileSync(file, 'utf8')) as { name: Record<string, string>; description: Record<string, string> }[]
  writeJson(file, themes.map((t) => ({ ...t, name: { ...t.name, de: `DE ${t.name['en']}` }, description: { ...t.description, de: `DE ${t.description['en']}` } })))
}

describe('adding an L1 (plan 9)', () => {
  it('drafts German beside a published Bulgarian corpus without changing any Bulgarian word, unit, title or decision', async () => {
    const dir = await publishedV1()
    const before = readDraft(dir)
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    const after = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(after.live).toEqual(before.live)
    const bg = (d: typeof before) => d.entries.map((e) => [e.entry_id, e.headword, e.pos, e.sense_en, e.level, e.english, e.l1['bg']])
    expect(bg(after)).toEqual(bg(before))
    expect(after.units.map((u) => [u.unit_id, u.entry_ids, u.titles['bg']])).toEqual(before.units.map((u) => [u.unit_id, u.entry_ids, u.titles['bg']]))
    // Every Bulgarian review decision still holds: nothing Bulgarian is open again.
    const pending = pendingItems(after, Decisions.read(dir), ['bg', 'de'])
    expect(pending.get(QUEUES.translation('bg'))).toEqual([])
    expect(pending.get(QUEUES.title('bg'))).toEqual([])
    // German is there for every live entry, and bank's merged sense accepts both German words.
    const live = new Set(after.live)
    expect(after.entries.filter((e) => live.has(e.entry_id)).every((e) => e.l1['de'] !== undefined)).toBe(true)
    expect(after.entries.find((e) => e.entry_id === 'bank-1')!.l1['de']).toMatchObject({ translation: 'Bank', alternates: ['Bankgebäude'] })
  })

  it('releases a German pack beside an unchanged Bulgarian one, with no new Bulgarian fixes', async () => {
    const dir = await publishedV1()
    const v1 = readLastPublished(dir).packs.get('bg')!
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['bg', 'de'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const plan = planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    expect(plan.outputs.map((o) => o.pack.l1).sort()).toEqual(['bg', 'de'])
    const bg2 = plan.outputs.find((o) => o.pack.l1 === 'bg')!.pack
    expect(bg2.entries).toEqual(v1.entries)
    expect(bg2.units).toEqual(v1.units)
    expect(plan.fixes.fixes.filter((f) => f.fixed_in === 2)).toEqual([])
  })

  it('refuses a release whose first L1 was never published: senses merge on it', async () => {
    const dir = await publishedV1()
    nameThemesInGerman(dir)
    editConfig(dir, { l1s: ['de', 'bg'], accept_unreviewed: ['translation-de', 'title-de'] })
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(planRelease(dir, { draft: false, now: '2026-10-05T09:00:00Z' }).problems).toContain(
      "the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead",
    )
  })
})
```

Import what is missing at the top of the file: `pendingItems` from `./queues`, `planRelease` from `./release`, `readLastPublished` from `./lastPublished`, and `Decisions`/`QUEUES` if absent. `publishedV1` releases v1 with audio, so the German release needs no new clips: clips belong to entries, not L1s. If the second test reports pending audio, check whether `publishedV1` recorded clips; do not add audio for German.

- [ ] **Step 2: Run the tests and see them fail**

Run: `cd pipeline && npx vitest run src/draft.test.ts`
Expected: the first two tests pass if Tasks 1–3 are correct (they are the golden tests; if either fails, fix the task that broke Bulgarian, not the test). The third fails: there is no lead check yet.

- [ ] **Step 3: Implement the lead check**

In `planRelease` (`pipeline/src/release.ts`), after the loop that says an L1 published before must stay in `l1s`:

```ts
  const lead = config.l1s[0]
  if (last.packs.size > 0 && lead !== undefined && !last.packs.has(lead)) {
    problems.push("the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead")
  }
```

- [ ] **Step 4: The runbook**

In `pipeline/README.md`, add a section before *When something is wrong*:

```markdown
## Adding an L1

One draft serves every L1: senses, themes, levels, audio, IDs and units are shared, and only translations and unit
titles are asked per L1. To add one (German, `de`, is the model):

1. **Code** (this repository): a translation guide in `L1_GUIDES` (`pipeline/src/stages/translate.ts`) and unit-group
   names in `GROUP_NAMES` (`pipeline/src/units.ts`).
2. **Theme names**: every theme in `themes.json` gets a `name` and a `description` in the new L1. The draft refuses
   until each has both.
3. **`pipeline.json`**: append the code to `l1s`. Never put it first: the first L1 is the lead that senses merge on,
   and a release refuses a lead that was never published. To ship it unreviewed, add `translation-<l1>` and
   `title-<l1>` to `accept_unreviewed`; otherwise its review files block every release until reviewed.
4. **Draft** (online). It asks the new L1's translations and unit titles only; the other L1s' caches all hit.
   Adding an L1 never changes another L1's pack: merged senses stay merged, and the new L1 keeps the first sense's
   translation with the other senses' words as alternates.

Shared rules to tell reviewers: a `drop` in any L1's file removes the word for every L1, so drop only a wrong English
sense; a hard-to-translate word gets the best translation and a note. Until reports carry the learner's L1
(plan 10), a translation report reopens every L1's translation of that word.
```

In `pipeline/template/README.md:26-27`, name the queues generically: `translation-<l1>` (every translation set and its sense gloss, one queue per L1) and `title-<l1>` (unit titles, per L1).

- [ ] **Step 5: Run everything and commit**

Run: `cd pipeline && npx vitest run && cd .. && pnpm typecheck && pnpm lint && pnpm test`
Expected: PASS.

Subject: `feat(pipeline): adding an L1 leaves the published corpus alone`.

---

### Task 5: The German corpus (content repository; each outward step with the product owner's go-ahead)

**Files (in `wordado/wordado-content`, the local clone at `~/code/projects/cc/wordado/content`):** `themes.json`, `pipeline.json`, then the draft's caches, `registry.json` and `review/` files.

This task runs after the pull request with Tasks 1–4 is merged and `PIPELINE_REF` points at the merge.

- [ ] **Step 1: German theme names**

On a branch `content/german` from `origin/main`, add `name.de` and `description.de` to every theme with this script (run from the content clone):

```bash
node - <<'EOF'
const fs = require('fs')
const de = {
  actions: ['Alltägliche Handlungen', 'Häufige Verben für das, was man tut.'],
  animals: ['Tiere', 'Haustiere, Nutztiere und Wildtiere.'],
  arts: ['Kunst und Unterhaltung', 'Bücher, Musik, Film, Theater und Kunst.'],
  body: ['Körper und Gesundheit', 'Körperteile und Wohlbefinden.'],
  business: ['Wirtschaft und Handel', 'Unternehmen, Märkte, Handel, Produkte und die Wirtschaft.'],
  cause: ['Ursachen und Folgen', 'Warum etwas geschieht, Wirkungen, Probleme und Lösungen.'],
  change: ['Wandel und Entwicklung', 'Wachsen, steigen, sinken, sich verbessern, anfangen und enden.'],
  character: ['Persönlichkeit und Verhalten', 'Wie Menschen sind und wie sie sich verhalten.'],
  city: ['Die Stadt', 'Straßen, Gebäude und öffentliche Orte.'],
  clothes: ['Kleidung', 'Was man trägt, und Größen.'],
  colours: ['Farben und Formen', 'Beschreiben, wie Dinge aussehen.'],
  communication: ['Sprechen und Kommunikation', 'Sagen, fragen, erklären, besprechen und zustimmen.'],
  comparing: ['Vergleichen und Messen', 'Größe, Grad, Menge, Ähnlichkeit und Unterschied.'],
  conflict: ['Krieg und Frieden', 'Armeen, Waffen, Kämpfe, Verteidigung und Frieden.'],
  'daily-life': ['Alltag', 'Tagesablauf und Hausarbeit.'],
  describing: ['Dinge beschreiben', 'Allgemeine Eigenschaften: wichtig, einfach, besonders, normal, offensichtlich.'],
  directions: ['Orte und Wege', 'Sich in der Stadt zurechtfinden.'],
  doctor: ['Beim Arzt', 'Beschwerden, Medikamente und Termine.'],
  environment: ['Umwelt', 'Energie, Verschmutzung, Klima und der Schutz des Planeten.'],
  feelings: ['Gefühle', 'Wie man sich fühlt: glücklich, traurig, besorgt, aufgeregt.'],
  food: ['Essen und Trinken', 'Was man jeden Tag isst und trinkt.'],
  goals: ['Pläne und Ziele', 'Ziele, Pläne, Anstrengung, Erfolg und Misserfolg.'],
  greetings: ['Begrüßung und Höflichkeit', 'Hallo, danke und Entschuldigung sagen.'],
  hobbies: ['Freizeit und Sport', 'Hobbys, Spiele und Ausgehen.'],
  home: ['Zu Hause', 'Zimmer, Möbel und Dinge im Haus.'],
  law: ['Recht und Kriminalität', 'Gesetze, Gerichte, Polizei, Verbrechen und Gerechtigkeit.'],
  linking: ['Verbindungswörter', 'Wörter, die Gedanken verbinden: weil, obwohl, jedoch, deshalb.'],
  media: ['Nachrichten und Medien', 'Zeitungen, Fernsehen, Berichte, Verlage und Werbung.'],
  numbers: ['Zahlen und Mengen', 'Zählen, Preise und wie viel.'],
  people: ['Familie und Mitmenschen', 'Familienangehörige, Freunde und die Menschen, denen man täglich begegnet.'],
  politics: ['Staat und Politik', 'Regierung, Wahlen, Parteien, politische Maßnahmen und Amtsträger.'],
  relationships: ['Beziehungen', 'Freunde, Partner, Ehe und der Umgang mit anderen.'],
  restaurant: ['Essen gehen', 'Bestellen, bezahlen und nach der Speisekarte fragen.'],
  school: ['Schule und Studium', 'Schule, Universität, Unterricht und Prüfungen.'],
  science: ['Wissenschaft und Forschung', 'Experimente, Belege, Theorien und wie die Natur funktioniert.'],
  shopping: ['Einkaufen und Geld', 'Geschäfte, Preise und Bezahlen.'],
  society: ['Gesellschaft und Kultur', 'Gemeinschaften, Traditionen, Religion, Identität und gesellschaftliche Fragen.'],
  technology: ['Handys und Computer', 'Geräte, das Internet und Nachrichten.'],
  thinking: ['Denken und Ideen', 'Denken, wissen, glauben, entscheiden und Meinungen.'],
  time: ['Zeit und Datum', 'Tage, Wochen, Uhrzeiten und der Kalender.'],
  travel: ['Reisen und Verkehr', 'Reisen, Fahrkarten, Züge und Flugzeuge.'],
  weather: ['Wetter und Natur', 'Sonne, Regen, Jahreszeiten und die Natur draußen.'],
  work: ['Arbeit und Beruf', 'Berufe, Arbeitsplätze, Kollegen und Karriere.'],
}
const themes = JSON.parse(fs.readFileSync('themes.json', 'utf8'))
const missing = themes.filter((t) => !de[t.theme_id]).map((t) => t.theme_id)
if (missing.length) throw new Error(`no German for: ${missing.join(', ')}`)
for (const t of themes) { t.name.de = de[t.theme_id][0]; t.description.de = de[t.theme_id][1] }
fs.writeFileSync('themes.json', JSON.stringify(themes, null, 2) + '\n')
console.log(`${themes.length} themes named in German`)
EOF
```

Expected: `43 themes named in German`. If `themes.json` has a theme this list lacks, the script stops and names it: add its German to the script, then run it again.

- [ ] **Step 2: `pipeline.json`**

Set `"l1s": ["bg", "de"]`, and append `"translation-de"` and `"title-de"` to `accept_unreviewed`. Check the file still validates, and that German is not yet drafted: run `corpus draft --offline` against the content clone. It must stop at the missing German translations (an `OfflineMiss` naming `translate-de`), not at a theme or config problem.

```bash
pnpm --filter @wordado/pipeline corpus draft "$HOME/code/projects/cc/wordado/content" --offline
```

Commit both files on the branch (subject: `content: German, beside Bulgarian`).

- [ ] **Step 3: Draft (product owner's go-ahead: it spends money)**

About 155 translation batches and 16 title batches. That is roughly $5 on OpenRouter, or run it locally on the Claude plan with `CORPUS_LLM=claude-code`. Locally:

```bash
set -a; . ~/.wordado-corpus.env; set +a
pnpm --filter @wordado/pipeline corpus draft "$HOME/code/projects/cc/wordado/content"
pnpm --filter @wordado/pipeline corpus queues "$HOME/code/projects/cc/wordado/content"
```

Or push the branch, merge it, and run Actions › Corpus › `draft`, which opens its own pull request.

- [ ] **Step 4: Check Bulgarian is untouched**

Build a draft release locally and compare it with `last-published/`:

```bash
C="$HOME/code/projects/cc/wordado/content"; OUT=$(mktemp -d)/out
pnpm --filter @wordado/pipeline corpus release "$C" "$OUT" --draft
node -e '
const fs=require("fs"),{join}=require("path");const [c,o]=process.argv.slice(1)
const pack=(d,v)=>JSON.parse(fs.readFileSync(join(d,`corpus-v${v}-bg.pack`),"utf8"))
const last=JSON.parse(fs.readFileSync(join(c,"last-published","manifest.json"),"utf8")).corpus_version
const a=pack(join(c,"last-published"),last), b=pack(o,last+1)
const same=JSON.stringify(a.entries)===JSON.stringify(b.entries)&&JSON.stringify(a.units)===JSON.stringify(b.units)
const fixes=JSON.parse(fs.readFileSync(join(o,"fixes.json"),"utf8")).fixes.filter(f=>f.fixed_in===last+1)
console.log(same?"Bulgarian entries and units unchanged":"BULGARIAN CHANGED",`; new fixes: ${fixes.length}`)
console.log(`German pack: ${fs.existsSync(join(o,`corpus-v${last+1}-de.pack`))}`)
' "$C" "$OUT"
```

Expected: `Bulgarian entries and units unchanged ; new fixes: 0` and `German pack: true`. Anything else stops the task: find what changed before going on.

- [ ] **Step 5: Hand over**

Commit the draft's results (caches, `registry.json`, `review/`) on the branch and open a content pull request (product owner's go-ahead), or merge the workflow's. The German pack is published with the next release. That waits for plan 10, because until then the app cannot choose German. The Bulgarian app ignores a German pack in the manifest, since it selects packs by L1 (`core/src/manifest.ts:110`).

---

## Self-review

- **Spec coverage.**
  - §14 Phase 1b ("a new pack per L1, no code change") is made true by Tasks 1–4 and exercised by Task 5.
  - §5.2 (senses split only where translations diverge) now applies on the lead L1, and other L1s fold into alternates (Decision 1). This is a narrowing, recorded as a decision.
  - §8.9 (every theme named in every L1) is Task 5 step 1, enforced by the existing `themeProblems`.
  - §8.10 (fixes told to reporters) keeps Bulgarian and German apart (Task 1).
  - The app side of §8.6 and §11.2 is plan 10.
- **Types across tasks.**
  - `Fix.l1?`, `ReportRecord.l1?` and `LEGACY_L1` are defined in Task 1, and used by the release de-duplication (Task 1) and by the golden release test (Task 4).
  - `mergeSenses(senses, l1s)` and `titleUnits(units, l1s, run)` keep their signatures, so `draft.ts` changes nowhere.
  - The fixture's `titles` fake reads `input.l1s`, which Task 3 sends.
- **Placeholders.** None. Where a test file's local helper may differ, the step says which shape to use.

## Handover to plan 10

Found by plan 9's final review; plan 10 takes them.

- **English unit titles can differ between packs.** A non-lead L1's title takes its English half from the lead L1's
  raw draft answer (`pipeline/src/stages/titles.ts`), while the lead's pack ships its published or reviewed title
  (`assemble.ts`, `previousUnits`). Once a `title-bg` reviewer edits `title_en`, the German pack shows the old English.
  Fix in `assemble`: for a non-lead L1, take `en` from the lead's folded or published title.
- **Web builds from before plan 9 ignore a fix's `l1`.** Their `validateFixes` drops unknown keys, so they would tell a
  Bulgarian reporter that a German translation fix is theirs. This matters only once German has a translation fix, well
  after the current web build has rolled out. Check before German's first reviewed release.
- **Reports carry no L1 yet** (Decision 7). Plan 10 adds the learner's L1 to `content_report` (core rule, server column,
  migration) and makes triage reopen only that L1's translation queue.
