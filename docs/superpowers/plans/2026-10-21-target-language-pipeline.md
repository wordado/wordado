# A second target language: pack format and pipeline — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The pack format and the corpus pipeline can build a German corpus (`target: 'de'`) beside the English one, with prefixed IDs, a grammar block, German prompts and voices, and English as an L1, while every English output stays byte-identical.

**Architecture:** A **language profile** per target language (`pipeline/src/profiles.ts`) holds everything that differs between languages: prompt sections, ID prefix and transliteration, voices, the target's review queue name, and the grammar schema (which lives in `core`, because clients validate and display it). `pipeline.json` gains an optional `target` (absent means `en`), and every stage reads the profile through `StageRun.profile` or `profileOf(config)`. A German corpus is a separate content directory (`content/de/`), so caches, registry and decisions never mix. This is plan 1 of 2 for issue #313; plan 2 (`2026-10-21-target-language-app.md`) is the learner app.

**Tech Stack:** TypeScript, pnpm workspaces, vitest, `@wordado/core`, `@wordado/pipeline`, `@wordado/review-app` (call sites only).

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` §5.1, §5.2, §5.5 (amended in #314). Issue #313 and its comment list the code items found while planning.

## Global Constraints

- **English stays byte-identical.** With no `target` in `pipeline.json`, every prompt, cache key, entry ID, unit ID, clip ID, queue name, CSV, pack and manifest the pipeline writes is exactly what it writes today. Do not bump `LEMMAS_VERSION`, `SENSES_VERSION`, any translate/titles/themes version or `AI_REVIEW_VERSION`.
- **Targets:** `en` and `de` only. Profile code = the pack's `target`.
- **German IDs:** entry IDs and unit IDs start with `de.`; umlauts and ß are transliterated before the slug is made: `ä→ae`, `ö→oe`, `ü→ue`, `ß→ss` (lower-cased first, so `Ä` also becomes `ae`). IDs stay ASCII and satisfy `/^[A-Za-z0-9][A-Za-z0-9._-]*$/`.
- **German pack IDs:** `corpus-de-<l1>`; English keeps `corpus-<l1>`. File names do not change (`corpus-v<n>-<l1>.pack`, `trial-v<n>-<l1>.trial`): a German release is uploaded under the `de/` prefix by the content repository's workflow (not this plan).
- **Manifest descriptors** carry `target` only when it is not `en`, so the English manifest's bytes do not change.
- **Grammar schema (German):** `gender` ∈ {`m`,`f`,`n`}, `plural` text (empty = no plural), `separable` boolean, `irregular` boolean, `auxiliary` ∈ {`haben`,`sein`}. Nouns carry `gender` and `plural`; verbs carry `separable`, `irregular`, `auxiliary`; other parts of speech carry no grammar block. Clients ignore a grammar field they do not know (§5.2).
- **Voices:** English accents `uk` (required), `us`; German accent `de` (required). An accent key is two lowercase letters.
- **Sense glosses stay English** in both corpora (`sense_en`): they are the internal identity of a sense, and the per-L1 `sense` the learner sees comes from the translate stage as today.
- **English as an L1:** code `en`; British spelling; nouns without an article; verbs as the bare infinitive. An L1 may not equal the target.
- **This repository is public:** no corpus text, prices, dates or names in code, tests, commits or PRs.
- Commits as `11029931+danchom@users.noreply.github.com`, on branch `feat/target-language-pipeline` in `.worktrees/target-language-pipeline`. Before the PR: `pnpm --filter @wordado/core test`, `pnpm --filter @wordado/pipeline test`, `pnpm --filter @wordado/review-app test`, `pnpm -r typecheck`, `pnpm lint`.

## Review Focus

1. **An English content directory after the change** — `corpus draft --offline` on the real `content/` must produce the same `work/draft.json`, the same review CSVs and, through `corpus release` into a temp dir, the same pack bytes as before. Task 9 pins it with a before/after comparison on the fixture, and the PR description must report the real-content comparison.
2. **A German headword whose slug collides after transliteration** (`Mädchen` and a hypothetical `Maedchen`) — must get `de.maedchen-1` and `de.maedchen-2`, never the same ID. Pinned in Task 3.
3. **A senses answer for German with grammar on the wrong part of speech** (gender on a verb) — the parser keeps only the fields for that part of speech; the pack never carries a noun field on a verb. Pinned in Task 4.
4. **A `pipeline.json` with `target: "de"` and `l1s` containing `de`** — refused by config validation, not discovered as a nonsense pack. Pinned in Task 2.
5. **A learner report for a German entry triaged in the English directory** (or the reverse) — ignored, never reopening anything. Pinned in Task 6.

---

### Task 1: Core pack format — targets, voices, grammar, descriptor target, pack IDs

**Files:**
- Create: `core/src/target.ts`, `core/src/target.test.ts`
- Create: `core/src/grammar.ts`, `core/src/grammar.test.ts`
- Modify: `core/src/types.ts:39` (Accent), `core/src/types.ts` (`CorpusEntry` gains `grammar`)
- Modify: `core/src/pack.ts` (`PackEntry.grammar?`)
- Modify: `core/src/packValidation.ts` (target, audio keys, grammar)
- Modify: `core/src/manifest.ts` (`PackDescriptor.target?`)
- Modify: `core/src/corpus.ts` (`Corpus.target`, `CorpusEntry.grammar`, `entryClips` order, mixed targets refused)
- Modify: `core/src/index.ts` (exports)
- Test: `core/src/packValidation.test.ts`, `core/src/manifest.test.ts`, `core/src/corpus.test.ts`

**Interfaces:**
- Produces:
  - `TARGETS: readonly ['en','de']`, `type Target`, `isTarget(v: unknown): v is Target`
  - `coursePackId(target: string, l1: string): string` → `corpus-<l1>` for `en`, `corpus-<target>-<l1>` otherwise
  - `ENTRY_ID_PREFIX: Readonly<Record<Target, string>>` = `{ en: '', de: 'de.' }`
  - `targetOfEntryId(entryId: string): Target` → `de` when the ID starts with `de.`, else `en`
  - `type Accent = string`; `ACCENT = /^[a-z]{2}$/`; `ACCENT_ORDER = ['uk','us']`
  - `type GrammarValue = string | boolean`; `type Grammar = Readonly<Record<string, GrammarValue>>`
  - `interface GrammarField { readonly kind: 'enum' | 'text' | 'flag'; readonly values?: readonly string[]; readonly pos: readonly PartOfSpeech[] }`
  - `GRAMMAR_SCHEMAS: Readonly<Partial<Record<Target, Readonly<Record<string, GrammarField>>>>>`
  - `grammarProblems(target: string, pos: PartOfSpeech, grammar: unknown): string[]`
  - `PackEntry.grammar?: Grammar`, `CorpusEntry.grammar: Grammar | null`, `Corpus.target: string`, `PackDescriptor.target?: string`

- [ ] **Step 1: Write the failing tests for targets and grammar**

`core/src/target.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { coursePackId, isTarget, targetOfEntryId, TARGETS } from './target'

describe('targets', () => {
  it('knows English and German', () => {
    expect(TARGETS).toEqual(['en', 'de'])
    expect(isTarget('de')).toBe(true)
    expect(isTarget('fr')).toBe(false)
  })
  it('keeps English pack IDs and prefixes the others', () => {
    expect(coursePackId('en', 'bg')).toBe('corpus-bg')
    expect(coursePackId('de', 'bg')).toBe('corpus-de-bg')
  })
  it('reads the target from an entry ID', () => {
    expect(targetOfEntryId('bank-1')).toBe('en')
    expect(targetOfEntryId('de.bank-1')).toBe('de')
    expect(targetOfEntryId('dew-1')).toBe('en')
  })
})
```

`core/src/grammar.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { GRAMMAR_SCHEMAS, grammarProblems } from './grammar'

describe('grammarProblems', () => {
  it('accepts a German noun and a German verb', () => {
    expect(grammarProblems('de', 'noun', { gender: 'n', plural: 'Häuser' })).toEqual([])
    expect(grammarProblems('de', 'verb', { separable: true, irregular: false, auxiliary: 'sein' })).toEqual([])
  })
  it('refuses wrong values and fields of another part of speech', () => {
    expect(grammarProblems('de', 'noun', { gender: 'x', plural: 'Häuser' })).toEqual(['gender must be one of m, f, n'])
    expect(grammarProblems('de', 'verb', { gender: 'm' })).toEqual(['gender is not a field of a verb'])
    expect(grammarProblems('de', 'noun', { plural: 3 })).toEqual(['plural must be text'])
    expect(grammarProblems('de', 'verb', { separable: 'yes' })).toEqual(['separable must be true or false'])
  })
  it('ignores a field it does not know, as an older client must', () => {
    expect(grammarProblems('de', 'noun', { gender: 'f', plural: '', case: 'x' })).toEqual([])
  })
  it('refuses a grammar block on a target without a schema', () => {
    expect(GRAMMAR_SCHEMAS.en).toBeUndefined()
    expect(grammarProblems('en', 'noun', { gender: 'm' })).toEqual(['en has no grammar block'])
  })
  it('refuses a block that is not an object', () => {
    expect(grammarProblems('de', 'noun', 'm')).toEqual(['must be an object'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/core exec vitest run src/target.test.ts src/grammar.test.ts`
Expected: FAIL, "Cannot find module './target'" and "'./grammar'".

- [ ] **Step 3: Implement `target.ts` and `grammar.ts`**

`core/src/target.ts`:
```ts
/** The languages Wordado teaches (spec §1, §5.5). A course is a target and an L1. */
export const TARGETS = ['en', 'de'] as const
export type Target = (typeof TARGETS)[number]
export const isTarget = (v: unknown): v is Target => typeof v === 'string' && (TARGETS as readonly string[]).includes(v)

/** Entry and unit IDs of every target but English start with this, so two courses never share an ID (§5.5). */
export const ENTRY_ID_PREFIX: Readonly<Record<Target, string>> = { en: '', de: 'de.' }

/** A course pack's ID: English keeps the IDs its clients already hold. */
export function coursePackId(target: string, l1: string): string {
  return target === 'en' ? `corpus-${l1}` : `corpus-${target}-${l1}`
}

/** The target an entry belongs to, from its ID's prefix. */
export function targetOfEntryId(entryId: string): Target {
  for (const t of TARGETS) if (ENTRY_ID_PREFIX[t] !== '' && entryId.startsWith(ENTRY_ID_PREFIX[t])) return t
  return 'en'
}
```

`core/src/grammar.ts`:
```ts
import type { PartOfSpeech } from './types'
import type { Target } from './target'

export type GrammarValue = string | boolean
/** An entry's grammar block (spec §5.2): the fields its target's schema declares for its part of speech. */
export type Grammar = Readonly<Record<string, GrammarValue>>

export interface GrammarField {
  readonly kind: 'enum' | 'text' | 'flag'
  readonly values?: readonly string[]
  /** The parts of speech that carry this field. */
  readonly pos: readonly PartOfSpeech[]
}

/** Per target (spec §5.5). English declares none. */
export const GRAMMAR_SCHEMAS: Readonly<Partial<Record<Target, Readonly<Record<string, GrammarField>>>>> = {
  de: {
    gender: { kind: 'enum', values: ['m', 'f', 'n'], pos: ['noun'] },
    plural: { kind: 'text', pos: ['noun'] },
    separable: { kind: 'flag', pos: ['verb'] },
    irregular: { kind: 'flag', pos: ['verb'] },
    auxiliary: { kind: 'enum', values: ['haben', 'sein'], pos: ['verb'] },
  },
}

/** What is wrong with an entry's grammar block. A field the schema does not know is ignored (§5.2). */
export function grammarProblems(target: string, pos: PartOfSpeech, grammar: unknown): string[] {
  const schema = GRAMMAR_SCHEMAS[target as Target]
  if (!schema) return [`${target} has no grammar block`]
  if (typeof grammar !== 'object' || grammar === null || Array.isArray(grammar)) return ['must be an object']
  const problems: string[] = []
  for (const [name, value] of Object.entries(grammar)) {
    const field = schema[name]
    if (!field) continue
    if (!field.pos.includes(pos)) problems.push(`${name} is not a field of a ${pos}`)
    else if (field.kind === 'text' && typeof value !== 'string') problems.push(`${name} must be text`)
    else if (field.kind === 'flag' && typeof value !== 'boolean') problems.push(`${name} must be true or false`)
    else if (field.kind === 'enum' && !field.values!.includes(value as string)) problems.push(`${name} must be one of ${field.values!.join(', ')}`)
  }
  return problems
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/core exec vitest run src/target.test.ts src/grammar.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing pack, manifest and corpus tests**

Add to `core/src/packValidation.test.ts` (reuse the file's existing valid-pack builder; it is the object the file's first "accepts a sound pack" test validates — call it `sound()` below and adapt the name to the file's):
```ts
describe('second target language', () => {
  it('accepts a German pack with a grammar block and a German voice', () => {
    const pack = sound()
    pack.target = 'de'
    pack.entries[0].entry_id = 'de.haus-1'
    pack.entries[0].pos = 'noun'
    pack.entries[0].grammar = { gender: 'n', plural: 'Häuser' }
    pack.entries[0].audio = { de: pack.entries[0].audio.uk }
    // keep every reference to the renamed entry consistent (units' entry_ids, audio clip entry ids) the way the file's other rename tests do
    expect(validatePack(pack).status).toBe('ok')
  })
  it('refuses a target it does not teach', () => {
    const pack = sound()
    pack.target = 'fr'
    expect(validatePack(pack)).toMatchObject({ status: 'invalid', errors: [{ path: 'target', message: 'must be one of en, de' }] })
  })
  it('refuses a grammar block with a wrong value, naming the field', () => {
    const pack = sound()
    pack.target = 'de'
    pack.entries[0].pos = 'noun'
    pack.entries[0].grammar = { gender: 'x' }
    const result = validatePack(pack)
    expect(result.status).toBe('invalid')
    expect(JSON.stringify(result)).toContain('gender must be one of m, f, n')
  })
  it('refuses an audio key that is not two lowercase letters', () => {
    const pack = sound()
    pack.entries[0].audio = { UK: pack.entries[0].audio.uk }
    expect(JSON.stringify(validatePack(pack))).toContain('must be a clip id under a two-letter accent')
  })
})
```

Add to `core/src/manifest.test.ts`:
```ts
it('reads a descriptor target and leaves it out when absent', () => {
  const m = { schema_version: 1, corpus_version: 1, packs: [
    { pack_id: 'corpus-de-bg', l1: 'bg', target: 'de', corpus_version: 1, schema_version: 1, url: 'corpus-v1-bg.pack', sha256: 'a'.repeat(64), bytes: 1 },
    { pack_id: 'corpus-bg', l1: 'bg', corpus_version: 1, schema_version: 1, url: 'corpus-v1-bg.pack', sha256: 'b'.repeat(64), bytes: 1 },
  ] }
  const r = validateManifest(m)
  expect(r.status).toBe('ok')
  if (r.status !== 'ok') return
  expect(r.manifest.packs[0]!.target).toBe('de')
  expect('target' in r.manifest.packs[1]!).toBe(false)
})
it('refuses a descriptor target it does not teach', () => {
  const m = { schema_version: 1, corpus_version: 1, packs: [
    { pack_id: 'corpus-fr-bg', l1: 'bg', target: 'fr', corpus_version: 1, schema_version: 1, url: 'x.pack', sha256: 'a'.repeat(64), bytes: 1 },
  ] }
  expect(validateManifest(m)).toMatchObject({ status: 'invalid', errors: [{ path: 'packs[0].target', message: 'must be one of en, de' }] })
})
```

Add to `core/src/corpus.test.ts` (use the file's existing pack builder):
```ts
it('carries the target and each entry grammar', () => {
  const pack = { ...samplePack(), target: 'de' } // adapt to the file's builder; give one entry grammar { gender: 'f', plural: 'Frauen' }
  const corpus = loadCorpus([pack])
  expect(corpus.target).toBe('de')
  expect([...corpus.entries.values()].some((e) => e.grammar?.['gender'] === 'f')).toBe(true)
  expect([...corpus.entries.values()].filter((e) => e.grammar === null).length).toBeGreaterThan(0)
})
it('refuses packs of two targets', () => {
  expect(() => loadCorpus([samplePack(), { ...otherPackOfSameL1(), target: 'de' }])).toThrow(/is for target de, not en/)
})
it('plays UK, then US, then any other accent', () => {
  // an entry whose audio is { de: 'x-de-1' } yields that clip; { us, uk } yields uk first
})
```
Write the third test concretely with the file's helpers: one entry with `audio: { us: idUs, uk: idUk }` must give `[uk, us]`; one with `audio: { de: idDe }` must give `[de]`.

- [ ] **Step 6: Run them to see them fail**

Run: `pnpm --filter @wordado/core test`
Expected: FAIL on the new tests (target `fr` accepted, `grammar` unknown, `corpus.target` undefined).

- [ ] **Step 7: Implement the format changes**

`core/src/types.ts`:
```ts
/** A voice of the target language (spec §5.5): `uk`/`us` for English, `de` for German. */
export type Accent = string
export const ACCENT = /^[a-z]{2}$/
/** The order clips are offered in: these first, the rest by name. */
export const ACCENT_ORDER: readonly string[] = ['uk', 'us']
```
and add to `CorpusEntry`: `/** The entry's grammar block (spec §5.2); null when it has none. */ readonly grammar: Grammar | null` (import `type Grammar` from `./grammar`). `CorpusEntry.audio` stays `Readonly<Partial<Record<Accent, string>>>`.

`core/src/pack.ts`: add to `PackEntry` after `taught?`:
```ts
  /** The target's grammar for this entry (spec §5.2, §5.5); absent when the target declares none or the part of speech carries none. */
  readonly grammar?: Grammar
```

`core/src/packValidation.ts`:
- Audio keys (today `:59-62`): replace the `uk`/`us` test with `if (!ACCENT.test(accent) || typeof clip !== 'string' ...) r.add(..., 'must be a clip id under a two-letter accent')`.
- Entry: after `taught`, read `grammar`: when `raw.grammar !== undefined`, `for (const p of grammarProblems(target, pos, raw.grammar)) r.add(at(path, 'grammar'), p)` and keep it as `grammar: raw.grammar as Grammar`; when undefined, omit the key (so English entries stay byte-identical when re-serialised). The entry parser needs the pack's target: read `target` before the entries and pass it in.
- `target` (today `:255-256`): `if (!isTarget(target)) r.add('target', 'must be one of en, de')`. The message is built from `TARGETS.join(', ')`.

`core/src/manifest.ts`: `PackDescriptor` gains `readonly target?: string`. In `parseDescriptor`, after `l1`:
```ts
  const target = raw['target']
  if (target !== undefined && !isTarget(target)) r.add(`${path}.target`, `must be one of ${TARGETS.join(', ')}`)
  ...
  return { pack_id, l1, ...(typeof target === 'string' ? { target } : {}), corpus_version, ... }
```

`core/src/corpus.ts`:
- `Corpus` gains `readonly target: string` (`first.target`); `loadCorpus` throws `Pack ${pack.pack_id} is for target ${pack.target}, not ${first.target}` when targets differ, beside the L1 check.
- Each `CorpusEntry` gets `grammar: e.grammar ?? null`.
- `entryClips`:
```ts
export function entryClips(corpus: Corpus, entry: CorpusEntry): AudioClip[] {
  const accents = Object.keys(entry.audio).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : 1))
  return accents.flatMap((accent) => {
    const id = entry.audio[accent]
    const clip = id === undefined ? undefined : corpus.clips.get(id)
    return clip ? [clip] : []
  })
}
const rank = (accent: string) => { const i = ACCENT_ORDER.indexOf(accent); return i === -1 ? ACCENT_ORDER.length : i }
```
`core/src/index.ts`: `export * from './target'` and `export * from './grammar'` (match the file's style).

- [ ] **Step 8: Run the core suite and the typecheck**

Run: `pnpm --filter @wordado/core test && pnpm -r typecheck`
Expected: core PASS. The typecheck may fail in packages that build `CorpusEntry` literals (tests in `client-data`/`web` that construct entries): add `grammar: null` to those literals. No behaviour changes there.

- [ ] **Step 9: Commit**

```bash
git add core client-data web
git commit -m "feat(core): targets, two-letter voices, a grammar block and a descriptor target in the pack format (#313)"
```

---

### Task 2: Language profiles and `target` in `pipeline.json`

**Files:**
- Create: `pipeline/src/profiles.ts`, `pipeline/src/profiles.test.ts`
- Modify: `pipeline/src/config.ts` (`PipelineConfig.target?`, validation, `reviewQueues`)
- Modify: `pipeline/src/decisions.ts` (`QUEUES`: drop `english`, add `grammar`)
- Test: `pipeline/src/config.test.ts`

**Interfaces:**
- Consumes: `Target`, `isTarget`, `ENTRY_ID_PREFIX`, `GRAMMAR_SCHEMAS` (Task 1).
- Produces:
```ts
export interface LanguageProfile {
  readonly code: Target
  /** The language's English name: "English", "German". */
  readonly name: string
  /** As prompts say it: "an English vocabulary course". */
  readonly course: string
  readonly idPrefix: string
  /** Applied after lower-casing, before diacritics are stripped (Global Constraints). */
  readonly transliterate: Readonly<Record<string, string>>
  /** The accents its voices may have; the first is required. */
  readonly accents: readonly string[]
  /** The queue for headword-side fields (IPA, variants, examples): "english", "german". */
  readonly reviewQueue: string
  readonly grammar: Readonly<Record<string, GrammarField>> | null
  /** Prompt lines (Task 4 uses them). */
  readonly lemmaKindLine: string
  readonly lemmaLemmasLine: string
  readonly senseIpaLine: string
  readonly senseVariantsLine: string
  readonly senseGrammarLine: string // '' when grammar is null
  readonly senseHeadwordRule: string
}
export const PROFILES: Readonly<Record<Target, LanguageProfile>>
export function profileOf(config: Pick<PipelineConfig, 'target'>): LanguageProfile
```
  - `PipelineConfig.target?: Target`
  - `reviewQueues(l1s: readonly string[], profile: LanguageProfile): string[]`
  - `QUEUES = { level, audio, grammar: 'grammar', translation(l1), title(l1) }`

- [ ] **Step 1: Write the failing tests**

`pipeline/src/profiles.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { PROFILES, profileOf } from './profiles'

describe('profiles', () => {
  it('defaults to English', () => {
    expect(profileOf({}).code).toBe('en')
    expect(profileOf({ target: 'de' }).code).toBe('de')
  })
  it('keeps English exactly as the pipeline has always been', () => {
    const en = PROFILES.en
    expect(en.course).toBe('an English vocabulary course')
    expect(en.idPrefix).toBe('')
    expect(en.accents).toEqual(['uk', 'us'])
    expect(en.reviewQueue).toBe('english')
    expect(en.grammar).toBeNull()
    expect(en.senseGrammarLine).toBe('')
  })
  it('describes German', () => {
    const de = PROFILES.de
    expect(de.course).toBe('a German vocabulary course')
    expect(de.idPrefix).toBe('de.')
    expect(de.transliterate).toEqual({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })
    expect(de.accents).toEqual(['de'])
    expect(de.reviewQueue).toBe('german')
    expect(Object.keys(de.grammar!)).toEqual(['gender', 'plural', 'separable', 'irregular', 'auxiliary'])
  })
})
```

Add to `pipeline/src/config.test.ts` (use the file's valid-config helper; called `valid()` here):
```ts
describe('target', () => {
  it('accepts a German directory with a German voice', () => {
    expect(configProblems({ ...valid(), target: 'de', l1s: ['bg', 'es', 'en'], tts: { ...valid().tts, accents: { de: valid().tts.accents.uk } } })).toEqual([])
  })
  it('refuses a target it does not know', () => {
    expect(configProblems({ ...valid(), target: 'fr' })).toContain('target: must be one of en, de')
  })
  it('refuses an L1 that is the target', () => {
    expect(configProblems({ ...valid(), target: 'de', l1s: ['bg', 'de'], tts: { ...valid().tts, accents: { de: valid().tts.accents.uk } } }))
      .toContain('l1s: de is the target language')
  })
  it('asks for the target voices', () => {
    expect(configProblems({ ...valid(), target: 'de' })).toEqual(expect.arrayContaining(['tts.accents.de: required', 'tts.accents.uk: accent must be de']))
  })
  it('keeps the English messages', () => {
    expect(configProblems({ ...valid(), tts: { ...valid().tts, accents: { xx: valid().tts.accents.uk } } }))
      .toEqual(expect.arrayContaining(['tts.accents.uk: required', 'tts.accents.xx: accent must be uk or us']))
  })
  it('names the grammar queue only for a target with grammar', () => {
    expect(reviewQueues(['bg'], PROFILES.en)).toEqual(['english', 'level', 'audio', 'translation-bg', 'title-bg'])
    expect(reviewQueues(['bg'], PROFILES.de)).toEqual(['german', 'level', 'audio', 'grammar', 'translation-bg', 'title-bg'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/profiles.test.ts src/config.test.ts`
Expected: FAIL ("Cannot find module './profiles'").

- [ ] **Step 3: Implement**

`pipeline/src/profiles.ts` — the English lines are **copied verbatim** from today's prompts (`stages/lemmas.ts:30-31`, `stages/senses.ts:44-45,48`), so Task 4 can splice them back unchanged:
```ts
import { ENTRY_ID_PREFIX, GRAMMAR_SCHEMAS, type GrammarField, type Target } from '@wordado/core'
import type { PipelineConfig } from './config'

export interface LanguageProfile { /* as in Interfaces above */ }

const EN: LanguageProfile = {
  code: 'en',
  name: 'English',
  course: 'an English vocabulary course',
  idPrefix: ENTRY_ID_PREFIX.en,
  transliterate: {},
  accents: ['uk', 'us'],
  reviewQueue: 'english',
  grammar: null,
  lemmaKindLine: `- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").`,
  lemmaLemmasLine: `- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.`,
  senseIpaLine: `- "ipa": the standard British pronunciation in IPA, without slashes.`,
  senseVariantsLine: `- "variants": other accepted spellings (colour → color); usually empty.`,
  senseGrammarLine: '',
  senseHeadwordRule: `Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: with its capital letters where it has them (I, Monday, English, TV), otherwise the same as "lemma".`,
}

const DE: LanguageProfile = {
  code: 'de',
  name: 'German',
  course: 'a German vocabulary course',
  idPrefix: ENTRY_ID_PREFIX.de,
  transliterate: { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' },
  accents: ['de'],
  reviewQueue: 'german',
  grammar: GRAMMAR_SCHEMAS.de!,
  lemmaKindLine: `- "kind": "word" for an ordinary German word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not German; "offensive" for a slur, profanity or vulgar word; "fragment" for a tokenisation fragment or the detached particle of a separable verb (e.g. "auf" in "steht auf" when it is not the preposition).`,
  lemmaLemmasLine: `- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase: nouns in the nominative singular, verbs in the infinitive, adjectives uninflected (ging → gehen; häuser → haus; größere → groß). A compound is its own headword (haustür → haustür, not haus or tür). A separable verb's finite form gives the separable infinitive only when the particle is part of the form (aufstehen → aufstehen). Otherwise an empty list.`,
  senseIpaLine: `- "ipa": the standard German pronunciation (as spoken in Germany) in IPA, without slashes.`,
  senseVariantsLine: `- "variants": other accepted spellings (Swiss "ss" for "ß": Straße → Strasse; a reformed or older spelling still in use); usually empty.`,
  senseGrammarLine: `- "grammar": for a noun, "gender" (m, f or n) and "plural" (the nominative plural without the article; empty if the noun has none); for a verb, "separable" (true or false), "irregular" (true for a strong or mixed verb) and "auxiliary" (haben or sein, for the perfect). For any other part of speech give gender "", plural "", separable false, irregular false, auxiliary "".`,
  senseHeadwordRule: `Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: nouns capitalised (Haus, Montag), reflexive verbs with "sich" (sich freuen), otherwise the same as "lemma".`,
}

export const PROFILES: Readonly<Record<Target, LanguageProfile>> = { en: EN, de: DE }

export function profileOf(config: Pick<PipelineConfig, 'target'>): LanguageProfile {
  return PROFILES[config.target ?? 'en']
}
```

`pipeline/src/decisions.ts`:
```ts
export const QUEUES = {
  level: 'level',
  audio: 'audio',
  /** The grammar block of a target that has one (spec §5.5). */
  grammar: 'grammar',
  translation: (l1: string) => `translation-${l1}`,
  title: (l1: string) => `title-${l1}`,
} as const
```
Removing `english` makes every use a compile error: Tasks 5 and 6 replace them with `profile.reviewQueue`. Until then the package does not typecheck; run only the tests named in this task.

`pipeline/src/config.ts`:
- `PipelineConfig` gains `/** The language this directory's corpus teaches (spec §5.5); absent for English. */ readonly target?: Target`.
- `configProblems`: before `l1s` checks,
```ts
  const target = raw['target']
  if (target !== undefined && !isTarget(target)) p.push(`target: must be one of ${TARGETS.join(', ')}`)
  const profile = PROFILES[isTarget(target) ? target : 'en']
```
  after the `l1s` checks, `for (const l1 of l1s) if (l1 === profile.code) p.push(\`l1s: ${l1} is the target language\`)`; in the accents block replace the two hard-coded lines:
```ts
      const [first] = profile.accents
      if (accents[first!] === undefined) p.push(`tts.accents.${first}: required`)
      for (const [accent, voice] of Object.entries(accents)) {
        const path = `tts.accents.${accent}`
        if (!profile.accents.includes(accent)) p.push(`${path}: accent must be ${profile.accents.join(' or ')}`)
        else if ...
```
- `reviewQueues`:
```ts
export const reviewQueues = (l1s: readonly string[], profile: LanguageProfile): string[] => [
  profile.reviewQueue,
  QUEUES.level,
  QUEUES.audio,
  ...(profile.grammar ? [QUEUES.grammar] : []),
  ...l1s.flatMap((l1) => [QUEUES.translation(l1), QUEUES.title(l1)]),
]
```
  and its callers inside `config.ts` (`accept_unreviewed`, `aiReviewProblems`) pass `profile`.
- `AI_REVIEW_QUEUE = /^(translation|title)-[a-z]{2}$|^level$|^grammar$/`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/profiles.test.ts src/config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/profiles.ts pipeline/src/profiles.test.ts pipeline/src/config.ts pipeline/src/config.test.ts pipeline/src/decisions.ts
git commit -m "feat(pipeline): a language profile per target, and target in pipeline.json (#313)"
```

---

### Task 3: IDs — prefixed and transliterated slugs, prefixed unit IDs

**Files:**
- Modify: `pipeline/src/registry.ts:33-110` (`slugOf`, `assignIds`)
- Modify: `pipeline/src/units.ts:76-89` (unit ID prefix)
- Modify: `pipeline/src/draft.ts:154` and the call into the units builder
- Test: `pipeline/src/registry.test.ts`, `pipeline/src/units.test.ts`

**Interfaces:**
- Consumes: `LanguageProfile`, `PROFILES` (Task 2).
- Produces: `slugOf(headword: string, profile?: LanguageProfile): string` (default `PROFILES.en`); `assignIds(registry, keys, profile?)`; the units builder takes `idPrefix: string` (default `''`) as its last parameter.

- [ ] **Step 1: Write the failing tests**

`pipeline/src/registry.test.ts`, add:
```ts
describe('German IDs', () => {
  it('prefixes and transliterates', () => {
    const de = PROFILES.de
    expect(['Mädchen', 'Straße', 'Öl', 'über', 'Haustür', 'sich freuen'].map((h) => slugOf(h, de)))
      .toEqual(['de.maedchen', 'de.strasse', 'de.oel', 'de.ueber', 'de.haustuer', 'de.sich_freuen'])
  })
  it('keeps English slugs exactly', () => {
    expect(['thank you', "o'clock", 'Café'].map((h) => slugOf(h))).toEqual(['thank_you', 'oclock', 'cafe'])
  })
  it('numbers two headwords that transliterate alike apart', () => {
    const { ids } = assignIds({ entries: [] }, [
      { headword: 'Mädchen', pos: 'noun', sense_en: '' },
      { headword: 'Maedchen', pos: 'noun', sense_en: '' },
    ], PROFILES.de)
    expect(ids).toEqual(['de.maedchen-1', 'de.maedchen-2'])
  })
})
```
`pipeline/src/units.test.ts`, add a test that calls the units builder exactly as the file's first test does, with `'de.'` as the new last argument, and expects every `unit_id` to match `/^de\.a1-\d{2}$/`; and that the same call without it still gives `a1-01`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/registry.test.ts src/units.test.ts`
Expected: FAIL (`slugOf` ignores the profile; the units builder has no prefix).

- [ ] **Step 3: Implement**

`registry.ts`:
```ts
export function slugOf(headword: string, profile: LanguageProfile = PROFILES.en): string {
  let lower = norm(headword)
  for (const [from, to] of Object.entries(profile.transliterate)) lower = lower.replaceAll(from, to)
  const slug = lower.normalize('NFD').replace(/\p{M}/gu, '')
    .replace(/\s+/g, '_').replace(/[^a-z0-9._-]/g, '').replace(/^[^a-z0-9]+/, '')
  return `${profile.idPrefix}${slug === '' ? 'w' : slug}`
}
```
`assignIds(registry, keys, profile: LanguageProfile = PROFILES.en)` passes `profile` to `slugOf` at `:102`. The numbering regex `/^(.*)-(\d+)$/` already works with a prefix.

`units.ts:76`: `const prefix = \`${idPrefix}${level.toLowerCase()}\`` with `idPrefix: string = ''` added as the builder's last parameter.

`draft.ts`: `const profile = profileOf(config)` near `const lead`; pass it to `assignIds(..., profile)` and `profile.idPrefix` to the units builder.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/registry.test.ts src/units.test.ts`
Expected: PASS, and the existing ID tests (`bank-1`, `run-4`, `a1-01`) still pass.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/registry.ts pipeline/src/registry.test.ts pipeline/src/units.ts pipeline/src/units.test.ts pipeline/src/draft.ts
git commit -m "feat(pipeline): German entry and unit IDs, prefixed and transliterated (#313)"
```

---

### Task 4: Stage prompts from the profile, and German grammar from the senses stage

**Files:**
- Modify: `pipeline/src/stages/lemmas.ts` (`StageRun.profile`, `SYSTEM` → `system(profile)`)
- Modify: `pipeline/src/stages/senses.ts` (`system(profile)`, `schema(themeIds, profile)`, parse keeps `grammar`)
- Modify: `pipeline/src/stages/translate.ts` (`SYSTEM(guide, profile)`, `L1_GUIDES.en`)
- Modify: `pipeline/src/stages/titles.ts` (`SYSTEM(l1s, profile)`, `L1_NAMES.en`)
- Modify: `pipeline/src/stages/themes.ts` (`system(profile)`)
- Modify: `pipeline/src/draft.ts:108` (`run()` adds `profile`), `pipeline/src/compare.ts` (same)
- Create: `pipeline/src/stages/prompts.test.ts`
- Test: `pipeline/src/stages/senses.test.ts`

**Interfaces:**
- Consumes: `LanguageProfile` (Task 2).
- Produces: `StageRun.profile: LanguageProfile`; `SenseProposal.grammar?: Grammar` (only when the profile has grammar); `L1_GUIDES.en`, `L1_NAMES.en`.

- [ ] **Step 1: Write the failing prompt tests**

`pipeline/src/stages/prompts.test.ts` pins English byte-for-byte (copy each expected string from the current source before editing it):
```ts
import { describe, expect, it } from 'vitest'
import { PROFILES } from '../profiles'
import { lemmaSystem } from './lemmas'
import { senseSystem } from './senses'
import { translateSystem, L1_GUIDES } from './translate'
import { titleSystem, L1_NAMES } from './titles'
import { themeSystem } from './themes'

// Today's prompts, copied verbatim from the source before this task.
const LEMMAS_EN = `You prepare an English vocabulary course for adult learners.
For each English word form you are given, in the order given, return:
- "form": the form exactly as given.
- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").
- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.
Return one item per form, in the same order, and nothing else.`
// SENSES_EN, TRANSLATE_HEAD_EN, TITLES_HEAD_EN, THEMES_EN: copy each the same way from senses.ts:39-48,
// translate.ts:54-57 (with the bg guide), titles.ts:21-23 (with l1s ['bg','de','es']) and themes.ts:17-20.

describe('English prompts are unchanged', () => {
  it('lemmas', () => expect(lemmaSystem(PROFILES.en)).toBe(LEMMAS_EN))
  it('senses', () => expect(senseSystem(PROFILES.en)).toBe(SENSES_EN))
  it('translate', () => expect(translateSystem(L1_GUIDES.bg!, PROFILES.en)).toBe(TRANSLATE_BG_EN))
  it('titles', () => expect(titleSystem(['bg', 'de', 'es'], PROFILES.en)).toBe(TITLES_EN))
  it('themes', () => expect(themeSystem(PROFILES.en)).toBe(THEMES_EN))
})

describe('German prompts', () => {
  it('name the course and the language', () => {
    expect(lemmaSystem(PROFILES.de)).toContain('You prepare a German vocabulary course for adult learners.\nFor each German word form')
    expect(senseSystem(PROFILES.de)).toContain('- "grammar": for a noun, "gender"')
    expect(senseSystem(PROFILES.de)).toContain('three short, natural German sentences')
    expect(senseSystem(PROFILES.de)).toContain('two to four plain English words') // glosses stay English
    expect(translateSystem(L1_GUIDES.en!, PROFILES.de)).toContain('translate the German headword')
    expect(themeSystem(PROFILES.de)).toContain('the words of a German vocabulary course')
  })
  it('have an English L1', () => {
    expect(L1_GUIDES.en).toContain('Translate into English')
    expect(L1_NAMES.en).toBe('English, as written in Britain')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages/prompts.test.ts`
Expected: FAIL (`lemmaSystem` is not exported).

- [ ] **Step 3: Implement**

- `lemmas.ts`: `StageRun` gains `readonly profile: LanguageProfile`. Replace `const SYSTEM` with
```ts
export const lemmaSystem = (p: LanguageProfile) => `You prepare ${p.course} for adult learners.
For each ${p.name} word form you are given, in the order given, return:
- "form": the form exactly as given.
${p.lemmaKindLine}
${p.lemmaLemmasLine}
Return one item per form, in the same order, and nothing else.`
```
  and use `lemmaSystem(run.profile)` where `SYSTEM` was used.
- `senses.ts`: `senseSystem(p)` is today's text with `an English vocabulary course` → `${p.course}`, the ipa and variants lines → `${p.senseIpaLine}` / `${p.senseVariantsLine}`, `three short, natural English sentences` → `three short, natural ${p.name} sentences`, the final paragraph → `${p.senseHeadwordRule}`, and `${p.senseGrammarLine}` inserted on its own line after the examples line **only when non-empty** (build the lines as an array and `filter((l) => l !== '')` so English has no blank line). The gloss line keeps "plain English words" for every profile.
  `schema(themeIds, profile)`: when `profile.grammar`, add to each sense item `grammar: { type: 'object', properties: { gender: { type: 'string', enum: ['m','f','n',''] }, plural: { type: 'string' }, separable: { type: 'boolean' }, irregular: { type: 'boolean' }, auxiliary: { type: 'string', enum: ['haben','sein',''] } }, required: [all five], additionalProperties: false }` and add `'grammar'` to that item's `required`. For English the schema is unchanged.
  The parser, for a profile with grammar, sets `grammar` from the answer, keeping only the fields the schema gives the sense's `pos` and dropping empty enum values:
```ts
function keptGrammar(profile: LanguageProfile, pos: PartOfSpeech, raw: Record<string, unknown>): Grammar | undefined {
  if (!profile.grammar) return undefined
  const out: Record<string, GrammarValue> = {}
  for (const [name, field] of Object.entries(profile.grammar)) {
    if (!field.pos.includes(pos)) continue
    const v = raw[name]
    if (field.kind === 'enum' && v === '') continue
    if (v !== undefined) out[name] = v as GrammarValue
  }
  return Object.keys(out).length > 0 ? out : undefined
}
```
  and throws `ParseError` when `grammarProblems(profile.code, pos, kept)` is non-empty.
- `translate.ts`: `export const translateSystem = (guide: string, p: LanguageProfile) => \`You translate ${p.course} for adult learners.\nFor each item, in the order given, translate the ${p.name} headword in the sense its gloss and example show.\n${guide}\nReturn one item per input item, with "key" exactly as given, and nothing else.\``; `translateSenses` uses `run.profile`. Add:
```ts
  en: `Translate into English, as a bilingual dictionary would.
- Nouns: the singular, without an article (water, not the water).
- Verbs: the bare infinitive, without "to" (write). Phrasal verbs as a dictionary gives them (get up; look after).
- Adjectives: the base form (big).
- Interjections and phrases: what an English speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four English words that tell this sense apart from the headword's other senses (for Bank: "for money", "to sit on"). Empty when the gloss is empty.
Use British English spelling (colour, centre, organise). No explanations in brackets.`,
```
- `titles.ts`: `titleSystem(l1s, p)` replaces `an English vocabulary course` with `${p.course}`; `L1_NAMES.en = 'English, as written in Britain'`. The title stays asked "in English (\"en\")" for every target: it is the English interface's title.
- `themes.ts`: `themeSystem(p)` replaces `an English vocabulary course` with `${p.course}`.
- `draft.ts:108`: `const run = (stage: string): StageRun => ({ llm, cache: ..., concurrency: ..., offline, profile })`; `compare.ts` builds its `StageRun` with `profileOf(config)` the same way.

- [ ] **Step 4: Write the failing senses-parse test**

`pipeline/src/stages/senses.test.ts`, add (use the file's `fakeLlm` pattern; the fake returns, for lemma `gehen`, one verb sense with `grammar: { gender: 'm', plural: 'x', separable: false, irregular: true, auxiliary: 'sein' }`, and for `haus` one noun sense with `grammar: { gender: 'n', plural: 'Häuser', separable: false, irregular: false, auxiliary: '' }`):
```ts
it('keeps the grammar fields of each part of speech for German', async () => {
  const out = await describeLemmas(lemmas(['gehen', 'haus']), SENSES_THEME_IDS, runFor(PROFILES.de, fake))
  expect(out[0]![0]!.grammar).toEqual({ separable: false, irregular: true, auxiliary: 'sein' })
  expect(out[1]![0]!.grammar).toEqual({ gender: 'n', plural: 'Häuser' })
})
it('asks English senses without grammar', async () => {
  const out = await describeLemmas(lemmas(['bank']), SENSES_THEME_IDS, runFor(PROFILES.en, englishFake))
  expect(out[0]![0]!.grammar).toBeUndefined()
})
```
(`lemmas` and `runFor` are small helpers in the test file building `RankedLemma[]` and a `StageRun` with an in-memory cache, the way the file's existing tests do.)

- [ ] **Step 5: Run the stage tests**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/stages`
Expected: PASS, including every existing stage test.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/stages pipeline/src/draft.ts pipeline/src/compare.ts
git commit -m "feat(pipeline): stage prompts from the language profile; German grammar; English as an L1 (#313)"
```

---

### Task 5: The draft, queues and assembly carry the profile and the grammar block

**Files:**
- Modify: `pipeline/src/draft.ts` (`DraftEntry.grammar`; drops use `profile.reviewQueue`; `QUEUES.english` uses)
- Modify: `pipeline/src/queues.ts` (`queueSpecs(l1s, profile)`, `pendingItems(draft, decisions, l1s, profile)`, grammar queue)
- Modify: `pipeline/src/assemble.ts` (target, pack ID, grammar, review queue)
- Modify: `pipeline/src/build.ts:75-90`, `pipeline/src/trial.ts:108-121` (descriptor `target`)
- Modify: every other caller of `queueSpecs`, `pendingItems`, `reviewQueues` (`grep -rn "queueSpecs\|pendingItems\|reviewQueues" pipeline/src review-app --include=*.ts`): pass `profileOf(config)`.
- Test: `pipeline/src/queues.test.ts`, `pipeline/src/assemble.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `DraftEntry.grammar: Grammar | null`; `queueSpecs(l1s, profile)`; `pendingItems(draft, decisions, l1s, profile)`; grammar CSV columns = the schema's field names, flags written `yes`/`no`, empty cell = field absent.

- [ ] **Step 1: Write the failing tests**

`queues.test.ts`, add:
```ts
it('names the headword queue after the target and adds a grammar queue for German', () => {
  expect([...queueSpecs(['bg'], PROFILES.de).keys()]).toEqual(['german', 'level', 'audio', 'grammar', 'translation-bg', 'title-bg'])
  expect([...queueSpecs(['bg'], PROFILES.en).keys()]).toEqual(['english', 'level', 'audio', 'translation-bg', 'title-bg'])
})
it('writes and reads a grammar row', () => {
  const spec = queueSpecs(['bg'], PROFILES.de).get('grammar')!
  expect(spec.columns).toEqual(['gender', 'plural', 'separable', 'irregular', 'auxiliary'])
  expect(spec.toCells({ separable: true, irregular: false, auxiliary: 'sein' }))
    .toEqual({ gender: '', plural: '', separable: 'yes', irregular: 'no', auxiliary: 'sein' })
  expect(spec.fromCells({ gender: 'n', plural: 'Häuser', separable: '', irregular: '', auxiliary: '' })).toEqual({ gender: 'n', plural: 'Häuser' })
  expect(() => spec.fromCells({ gender: 'x', plural: '', separable: '', irregular: '', auxiliary: '' })).toThrow('gender must be one of m, f, n')
})
```
(The `fromCells` value check uses `grammarProblems(profile.code, pos, value)`; since the CSV row has no `pos` cell, check enum/flag/text shape only: call a small `grammarShapeProblems(schema, value)` helper defined in `queues.ts` that applies the same three value checks without the part-of-speech check.)

`assemble.test.ts`, add a test that assembles a draft built with `target: 'de'` (use the file's draft builder; give one live noun entry `entry_id: 'de.haus-1'`, `grammar: { gender: 'n', plural: 'Häuser' }`, a verb entry with `grammar: { separable: false, irregular: true, auxiliary: 'sein' }`, and an adjective with `grammar: null`, and a config with `target: 'de'`, `l1s: ['bg']`, accents `{ de }`) and expects:
```ts
expect(out.source.target).toBe('de')
expect(out.source.pack_id).toBe('corpus-de-bg')
expect(out.source.entries.find((e) => e.entry_id === 'de.haus-1')!.grammar).toEqual({ gender: 'n', plural: 'Häuser' })
expect('grammar' in out.source.entries.find((e) => e.pos === 'adj')!).toBe(false)
expect(out.pending.some((l) => l.includes('german not reviewed'))).toBe(true) // unless accepted
```
and that a `grammar` decision `fix` with value `{ gender: 'f', plural: 'Häuser' }` changes the packed grammar.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/queues.test.ts src/assemble.test.ts`
Expected: FAIL (signatures and grammar missing).

- [ ] **Step 3: Implement**

- `draft.ts`: `DraftEntry` gains `/** The target's grammar (spec §5.5); null when it has none. */ readonly grammar: Grammar | null`, filled from the sense's `grammar ?? null`. Replace `QUEUES.english` at `:188` with `profile.reviewQueue`.
- `queues.ts`:
  - `queueSpecs(l1s, profile)`: the first spec's `name` is `profile.reviewQueue`; when `profile.grammar`, add after `audio`:
```ts
    {
      name: QUEUES.grammar,
      columns: Object.keys(profile.grammar),
      context: ['headword', 'pos', 'sense_en', 'example', 'reopened'],
      verdicts: ['ok'],
      toCells: (v) => Object.fromEntries(Object.entries(profile.grammar!).map(([name, f]) => {
        const value = (v as Grammar)[name]
        return [name, value === undefined ? '' : f.kind === 'flag' ? (value ? 'yes' : 'no') : String(value)]
      })),
      fromCells: (c) => {
        const out: Record<string, GrammarValue> = {}
        for (const [name, f] of Object.entries(profile.grammar!)) {
          const cell = (c[name] ?? '').trim()
          if (cell === '') continue
          out[name] = f.kind === 'flag' ? cell === 'yes' : cell
        }
        const problems = grammarShapeProblems(profile.grammar!, out)
        if (problems.length > 0) throw new Error(problems[0])
        return out
      },
    },
```
    (the order of specs must match the order `reviewQueues` gives: headword queue, level, audio, grammar, then per L1).
  - `pendingItems(draft, decisions, l1s, profile)`: the map starts with `[[profile.reviewQueue, []], [QUEUES.level, []]]` plus `[QUEUES.grammar, []]` when `profile.grammar`; push `profile.reviewQueue` where `QUEUES.english` was; and for each live entry with `e.grammar !== null`, `push(QUEUES.grammar, e.entry_id, e.grammar, { ...base, example: e.english.examples[0] ?? '' })`. Replace the remaining `QUEUES.english` uses (`:131`, `:169`) the same way.
- `assemble.ts`: `const profile = profileOf(config)`. Replace `QUEUES.english` with `profile.reviewQueue` (the pending line becomes `${id}: ${profile.reviewQueue} not reviewed`, which for English is the old text). Fold grammar:
```ts
    const grammar = e.grammar === null ? null : foldField(e.grammar, decisions.for(QUEUES.grammar, e.entry_id))
    if (grammar && !grammar.reviewed) awaiting(QUEUES.grammar, `${e.entry_id}: grammar not reviewed`)
```
  and in the entry literal `...(grammar && Object.keys(grammar.value).length > 0 ? { grammar: grammar.value } : {})`. The source becomes `{ pack_id: coursePackId(profile.code, l1), corpus_version, l1, target: profile.code, units, themes, entries }`.
- `build.ts` and `trial.ts`: in the descriptor literal, after `l1: pack.l1,` add `...(pack.target === 'en' ? {} : { target: pack.target }),`.
- Fix every other call site of `queueSpecs`, `pendingItems` and `reviewQueues` (pipeline `cli.ts`, `reopen.ts`, `aiReview/*`, `release.ts`, `status`; review-app `server/model.ts`, `server/snapshot.ts`, `server/decisions.ts`) to pass `profileOf(config)`.

- [ ] **Step 4: Run the pipeline suite and the typecheck**

Run: `pnpm --filter @wordado/pipeline test && pnpm -r typecheck`
Expected: PASS. Existing tests that pin `review/english/…`, `english not reviewed`, `corpus-bg` and `corpus-v1-bg.pack` still pass unchanged.

- [ ] **Step 5: Commit**

```bash
git add pipeline review-app
git commit -m "feat(pipeline): the draft, queues and packs carry the target and the grammar block (#313)"
```

---

### Task 6: AI review and triage for any target

**Files:**
- Modify: `pipeline/src/aiReview/prompts.ts` (course name from the profile; a `grammar` kind)
- Modify: `pipeline/src/aiReview/rows.ts` (grammar rows), `pipeline/src/aiReview/run.ts` (pass the profile)
- Modify: `pipeline/src/reports.ts:70` (`example` reports go to `profile.reviewQueue`)
- Test: `pipeline/src/aiReview/prompts.test.ts`, `pipeline/src/reports.test.ts`

**Interfaces:**
- Consumes: Tasks 2–5.
- Produces: `QueueKind` gains `'grammar'`; `AI_REVIEW_VERSION.grammar = 1` (the other kinds keep 1); `systemPrompt(kind, l1, profile)`; `routes(field, l1s, reportL1, profile)`; `TriageInput.profile: LanguageProfile`.

- [ ] **Step 1: Write the failing tests**

`aiReview/prompts.test.ts` (create if absent):
```ts
it('keeps the English prompts', () => {
  // copy today's three prompts (translation with the bg guide, title, level) verbatim as constants, as in Task 4
  expect(systemPrompt('translation', 'bg', PROFILES.en)).toBe(TRANSLATION_BG_EN)
  expect(systemPrompt('title', 'bg', PROFILES.en)).toBe(TITLE_EN)
  expect(systemPrompt('level', '', PROFILES.en)).toBe(LEVEL_EN)
})
it('names the German course and reviews German grammar', () => {
  expect(systemPrompt('level', '', PROFILES.de)).toContain('in a German vocabulary course')
  expect(queueKind('grammar')).toBe('grammar')
  expect(FIELDS.grammar).toEqual(['gender', 'plural', 'separable', 'irregular', 'auxiliary'])
  expect(systemPrompt('grammar', '', PROFILES.de)).toContain('gender')
})
```
`reports.test.ts`, add:
```ts
it('sends a German example report to the german queue', () => { /* triage with profile PROFILES.de, a report field 'example' on a live 'de.haus-1': reopens german */ })
it('ignores a report for an entry of the other course', () => {
  // English directory (PROFILES.en), live set without 'de.haus-1', one translation report on 'de.haus-1' over the threshold:
  // triage reopens nothing and throws nothing
})
```
Write both concretely with the file's existing triage helpers. Also update the existing `:51` expectation `['english','level']` only if its call now takes a profile (it should still produce `['english','level']` with `PROFILES.en`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/aiReview src/reports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `prompts.ts`: `systemPrompt(kind, l1, profile)`; replace `an English vocabulary course` (translation `:57`, title `:68`, level `:73`) with `${profile.course}` (the level one reads "each meaning in ${profile.course} for adults"). `queueKind` returns `'grammar'` for `'grammar'`. `FIELDS.grammar = ['gender','plural','separable','irregular','auxiliary']`; `CATEGORIES.grammar = ['gender','plural','verb-form','other']`; the grammar prompt:
```ts
  if (kind === 'grammar') {
    return `You are a native-speaker lexicographer checking the grammar of each word in ${profile.course} for adults.
For a noun: gender (m, f or n) and plural (the nominative plural without the article; empty only if the noun has no plural). For a verb: separable (true or false), irregular (true for a strong or mixed verb) and auxiliary (haben or sein, for the perfect). A field that does not apply is absent.
Judge the word in the meaning its gloss (sense_en) and example show.

${COMMON}`
  }
```
- `rows.ts`: grammar rows are the cells plus `{ headword, pos, sense_en, example, learner_reports }`.
- `run.ts`: take `profileOf(cfg)` and pass it to `systemPrompt` and `pendingItems`.
- `reports.ts`: `routes(field, l1s, reportL1, profile)`; `example` → `profile.reviewQueue`. `TriageInput` gains `profile`; the CLI builds it from the config. A report whose entry is not in `live` is already skipped: confirm it with the new test, and if it is not, skip it at the top of the per-report loop with `if (!input.live.has(entryId)) continue`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/aiReview pipeline/src/reports.ts pipeline/src/reports.test.ts pipeline/src/cli.ts
git commit -m "feat(pipeline): AI review and triage for any target, with a grammar review kind (#313)"
```

---

### Task 7: A German directory end to end on the fixture

**Files:**
- Modify: `pipeline/src/testing/fixture.ts` (`sampleLlm({ grammar })`, `en` translations; `makeContent` accepts `target`)
- Test: `pipeline/src/e2e.test.ts` (new `describe('a German corpus')`)

**Interfaces:**
- Consumes: Tasks 1–6.
- Produces: `sampleLlm(opts?: { grammar?: boolean })`; `makeContent({ config: { target: 'de', l1s: ['bg','en'], tts: { ...accents: { de } } } })` works.

- [ ] **Step 1: Write the failing end-to-end test**

```ts
describe('a German corpus', () => {
  it('drafts, reviews, records audio and releases German packs', async () => {
    const dir = makeContent({ config: { target: 'de', l1s: ['bg', 'en'], tts: { model: 'fake', max_clips_per_run: 1000, accents: { de: { voice: 'v', instructions: 'Say the German word once.' } } } } })
    await runDraft({ dir, llm: sampleLlm({ grammar: true }) })
    approveAll(dir)
    await recordAudio(dir)
    const plan = planRelease(dir, { now: '2026-10-21T00:00:00Z' })
    expect(plan.problems).toEqual([])
    const bg = plan.packs.find((p) => p.pack.l1 === 'bg')!.pack
    expect(bg.target).toBe('de')
    expect(bg.pack_id).toBe('corpus-de-bg')
    expect(bg.entries.every((e) => e.entry_id.startsWith('de.'))).toBe(true)
    expect(bg.units.every((u) => u.unit_id.startsWith('de.'))).toBe(true)
    expect(bg.entries.filter((e) => e.pos === 'noun').every((e) => e.grammar && 'gender' in e.grammar)).toBe(true)
    expect(Object.keys(bg.entries[0]!.audio)).toEqual(['de'])
    expect(plan.manifest.packs.every((d) => d.target === 'de')).toBe(true)
    expect(plan.packs.map((p) => p.pack.l1).sort()).toEqual(['bg', 'en'])
    expect(validatePack(JSON.parse(new TextDecoder().decode(plan.packs[0]!.bytes))).status).toBe('ok')
    expect(existsSync(join(dir, 'review', 'german'))).toBe(true)
    expect(existsSync(join(dir, 'review', 'grammar'))).toBe(true)
  })
})
```
Adapt names to the file (`planRelease`'s result shape, how `e2e.test.ts` reads pack bytes): the assertions are what matter.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/e2e.test.ts -t "German"`
Expected: FAIL (the fake answers no grammar and no `en` translations).

- [ ] **Step 3: Extend the fixture**

`sampleLlm(opts = {})`: in the `senses` branch, when `opts.grammar`, give each sense `grammar: pos === 'noun' ? { gender: 'n', plural: '', separable: false, irregular: false, auxiliary: '' } : pos === 'verb' ? { gender: '', plural: '', separable: false, irregular: true, auxiliary: 'haben' } : { gender: '', plural: '', separable: false, irregular: false, auxiliary: '' }`. In the `translate` branch answer `en` like `de` (the translation is the headword). `makeContent` already merges `config` overrides; ensure the themes it writes have an `en` name and description (they do: `init.ts` seeds `{ en, bg }`; add `en` only if the L1 list needs it — `en` is already the required English key).

- [ ] **Step 4: Run the whole pipeline suite**

Run: `pnpm --filter @wordado/pipeline test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/testing/fixture.ts pipeline/src/e2e.test.ts
git commit -m "test(pipeline): a German corpus from draft to release on the fixture (#313)"
```

---

### Task 8: The runbook

**Files:**
- Modify: `pipeline/README.md` (new section "Adding a target language", and "Adding an L1" notes)

- [ ] **Step 1: Write the section**

Add after "Adding an L1":
```markdown
## Adding a target language

A target language is a whole corpus, not an L1: its own content directory (`content/<target>/`, a checkout path the
content repository's workflows pass as `<dir>`), its own frequency sources, caches, registry, decisions, audio and
releases (spec §5.5). German (`de`) is the model.

1. **Code** (this repository): a profile in `PROFILES` (`pipeline/src/profiles.ts`): the course's name in prompts,
   the ID prefix and transliteration, the accents its voices may have, its headword queue's name, its prompt lines,
   and, when entries carry grammar, a schema in `GRAMMAR_SCHEMAS` (`core/src/grammar.ts`) and the target in
   `TARGETS` and `ENTRY_ID_PREFIX` (`core/src/target.ts`).
2. **Content directory:** `pipeline.json` with `"target": "<code>"`, `l1s` without the target itself, `tts.accents`
   with the profile's accents (the first required), and `ai_review.queues` with `grammar` when the profile has one;
   `sources.json` and `sources/` with the language's frequency lists and licences; `themes.json` with every theme's
   `en` and L1 names.
3. **Draft, review, audio, release** as for English. Entry and unit IDs start with the profile's prefix; packs are
   `corpus-<target>-<l1>`; manifest descriptors carry `target`; the files are uploaded under `<target>/`.

Sense glosses (`sense_en`) stay English in every corpus: they are a sense's identity, not what learners see.
```
In "Adding an L1", add: "English (`en`) is an L1 of the German corpus; an L1 may not be the directory's target."

- [ ] **Step 2: Commit**

```bash
git add pipeline/README.md
git commit -m "docs(pipeline): adding a target language (#313)"
```

---

### Task 9: English unchanged — the byte-for-byte check

**Files:**
- Test: `pipeline/src/e2e.test.ts` (new test), plus a manual check on the real content for the PR

- [ ] **Step 1: Write the regression test**

The fixture's English e2e already pins file names and IDs. Add one test that runs the English fixture flow (draft → approveAll → audio → `planRelease`) and compares `canonicalJson` of every pack and the manifest against snapshot files committed under `pipeline/src/testing/english-release/` **generated from `main` before Task 1** (generate them on a clean checkout of `main` with a throwaway script that runs the same flow and writes the outputs, commit them in this task, and assert equality here).

- [ ] **Step 2: Run it**

Run: `pnpm --filter @wordado/pipeline exec vitest run src/e2e.test.ts`
Expected: PASS: identical bytes.

- [ ] **Step 3: Check the real English content (for the PR description)**

On a local checkout of the content repository at `content/`, with this branch:
```bash
pnpm --filter @wordado/pipeline corpus draft "$PWD/content" --offline
git -C content status --short   # expect: no change outside work/
pnpm --filter @wordado/pipeline corpus release "$PWD/content" /tmp/en-after   # if release needs the release gates, use the e2e's planRelease through a one-off tsx script instead
```
and compare `/tmp/en-after/*.pack` and `manifest.json` with `content/last-published/`: identical for an unchanged corpus version. Write the result in the PR description. **Ask the owner before running anything in `content/`**: it is the private content repository (ask-first rule). The offline draft spends nothing and writes only `work/`.

- [ ] **Step 4: Commit**

```bash
git add pipeline/src/e2e.test.ts pipeline/src/testing/english-release
git commit -m "test(pipeline): an English release stays byte-identical (#313)"
```

---

## After this plan

- The content repository: `pipeline.json` for `de/`, its sources, and a `target` input in the workflows that sets `<dir>` to `content/<target>` and the bucket prefix to `<target>/` (wordado-content#78, ask first).
- The hosted review app serves English queues only; German translation, title and level rows are reviewed in the local review app or as CSV until a follow-up issue gives the hosted app a target (its queue names collide across targets).
- Plan 2: the learner app (`2026-10-21-target-language-app.md`).
