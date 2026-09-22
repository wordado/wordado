# Pack Format and Sample Pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Define the corpus pack — its schema, validator, checksum and the manifest-as-list — in `core`, build the first `pipeline` package that turns a source into a byte-identical pack, and ship a hand-made 60-entry A1 Bulgarian sample pack with audio that demo mode and every later test use.

**Architecture:** A pack is one canonical JSON document (sorted keys, no whitespace) per (corpus version, L1), checksummed with SHA-256 in a manifest that is a list. `core` owns the schema, the validator, the cross-version stability rules, the manifest selection rule and the mapping from a pack to the `CorpusEntry`/`Unit` shapes plans 1 and 2 already consume, so the pipeline (build time, Node) and `client-data` (plan 4, browser) validate with the same code. The sample pack is version 0 of the real Bulgarian corpus pack, not a separate corpus: its IDs are the IDs the full corpus keeps, which is what lets demo events carry over into an account.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7, Vitest 5, fast-check 4 (unchanged). New in `pipeline` only: `tsx` (runs TypeScript under Node) and `@types/node`. `core` gains no dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` — this plan implements §5.1 (packs, manifest, stability rules, schema version), §5.2 (entry contents), the theme definitions and minimum size of §8.9, the audio manifest of §9.3, the bundled demo sample of §8.6, and the corpus-pipeline tests of §13. It is plan 3 of 8; see `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`.

## Global Constraints

- `core` is pure: no I/O, no framework, no platform APIs (spec §4.1). `tsconfig.base.json` sets `"lib": ["ES2022"]` and `"types": []`, so `fetch`, `process`, `crypto` and `TextEncoder` do not compile there. Do not loosen it. The checksum is therefore computed in `pipeline` (Node `crypto`) and verified in `client-data` (Web Crypto, plan 4); `core` defines the bytes it is taken over.
- `core` never depends on the host locale: canonical JSON sorts keys by code unit, and duplicate detection normalises with `NFC` + `toLowerCase()`, as `distractors.ts` does.
- `pipeline` runs at build time under Node, in GitHub Actions or on a developer's machine, never at runtime (spec §4.1). It may do I/O, and every rule it applies comes from `core`.
- A corpus version is immutable and byte-identical everywhere (spec §5.1): the build must not embed a timestamp, a host path or a scan order. The same source gives the same bytes on every machine, and a test proves it for the sample.
- Entry IDs and unit IDs are stable and never reused; a retired entry stays in the pack (spec §5.1). Retired entries are invisible to every progress rule (plan 1's `isLive`).
- Entry IDs are unique across the packs a client loads (spec §5.1). An entry ID is the key of a `c:` word ID and must satisfy `isWordId`.
- Every theme is named and described in English and in the pack's L1 (spec §8.9, §13).
- The sample pack's audio is generated once with the macOS system voice and committed. It is below the quality bar of spec §5.4 and is replaced by plan 8's TTS; the plan says so where the clips are made.
- Code style: no semicolons, single quotes, 2-space indent, named exports only, `readonly` on every interface field. Wire-format fields (pack and manifest JSON) are `snake_case`, as the spec writes them; `core`'s in-memory types stay `camelCase`. Each new module has one test file beside it.
- Every task ends with `pnpm test` and `pnpm typecheck` green from the repository root.

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| Corpus pack binary format | one UTF-8 JSON document, canonical (keys sorted at every depth, no whitespace); SHA-256 hex of the bytes in the manifest | `core/src/pack.ts`, `pipeline/src/build.ts` |
| Pack schema version | `1` | `core/src/pack.ts` |
| Manifest schema version | `1` | `core/src/manifest.ts` |
| Minimum theme size | 25 live entries | `core/src/corpus.ts` |
| The curated theme list | 24 themes, in the sample pack's `themes` | `pipeline/samples/a1-bg/source.json` |
| Parts of speech | `noun verb adj adv pron prep det num conj intj phrase` | `core/src/types.ts` |
| Audio container | AAC in MP4, `audio/mp4`, `.m4a` | `pipeline/src/build.ts` |
| Sample pack | `corpus-bg` version 0: 60 A1 entries, 3 units of 20, UK audio only | `pipeline/samples/a1-bg/` |

## Decisions recorded here

- **JSON, not a binary format.** A full pack is one or two megabytes of text that the CDN compresses in transit; `core` can validate parsed JSON with no I/O; the file diffs in review. A binary format would buy nothing at this scale.
- **The sample pack is `corpus-bg` version 0.** The demo sample ships in the app bundle (spec §8.6) and demo events must survive sign-up (§8.6, §9.2). If the sample were its own pack its entry IDs would be meaningless in the full corpus. So the sample is a *subset* of the Bulgarian corpus pack at version 0, and every later version keeps its entry and unit IDs (Task 5's `checkPackSuccession` proves it). Plan 8 seeds its ID registry with the sample.
- **IDs are opaque slugs.** Entry `<headword-slug>-<n>` (`hello-1`, `bank-2`), unit `<level>-<nn>` (`a1-01`), clip `<entry_id>-<accent>` (`hello-1-uk`). The slug is a mnemonic, not a key: a corrected headword keeps its old ID.
- **A theme is offered when it reaches the minimum size; the pack does not say so.** Every theme the corpus will ever offer is defined in the pack (the curated list); `offeredThemes` counts live entries per theme and applies `MIN_THEME_SIZE`. That is the spec's "a theme can appear as the corpus grows" as a derived rule, with nothing to keep in sync. The sample pack offers exactly one theme (`daily-life`, 25 entries) and defines 23 more, so the rule is exercised both ways.
- **An entry's level is its unit's level, and path order never goes back a level.** The validator enforces both: `pathNewWords` and `assumedKnownWords` (plan 1) reason about units by level and by order, and an A2 unit ordered before an A1 unit would put A2 words in an A1 learner's queue.
- **URLs in the manifest and the pack are relative to the manifest's URL.** The pipeline uploads `manifest.json`, the packs and `audio/<clip>.m4a` under one prefix; the bundled sample is the same layout inside the app. No absolute URL is ever written into a pack, so the same bytes serve from R2 and from the bundle.
- **The sense gloss may be empty.** It is "shown wherever the headword alone is ambiguous" (spec §5.2); most A1 entries have none. Identity is still (headword, part of speech, sense), so two glossless entries of one headword and part of speech are a duplicate.
- **The user-word shape is not defined here.** The whole personal dictionary is Phase 2 (spec §8.2). Plan 2 left "the three-record merge of a user word into a corpus entry" to plan 5 "on plan 3's user-word shape"; that merge waits for Phase 2 with the shape.
- **`tsx` runs the pipeline.** `core`'s modules import each other without extensions, which Node's own type stripping cannot resolve; `tsx` resolves them and needs no build step. It is a `pipeline` devDependency only.

## File Structure

```
core/src/
  types.ts           + PARTS_OF_SPEECH, PartOfSpeech, Accent, LocalizedText;
                       CorpusEntry gains variants, sense, examples, audio; Unit gains title   (modify)
  pack.ts            Pack wire types, PACK_SCHEMA_VERSION, canonicalJson                     (new)  §5.1, §5.2
  validation.ts      internal: Report, field readers, ID/URL/hash patterns (not exported)    (new)
  packValidation.ts  validatePack, PackError, PackValidation                                 (new)  §5.1, §13
  corpus.ts          loadCorpus, Corpus, Theme, AudioClip, themeEntries, offeredThemes,
                     entryClips, MIN_THEME_SIZE                                              (new)  §8.9, §9.3
  manifest.ts        PackManifest, PackDescriptor, validateManifest, selectPacks             (new)  §5.1, §9.3
  packStability.ts   checkPackSuccession                                                     (new)  §5.1, §13
  index.ts           re-exports pack, packValidation, corpus, manifest, packStability        (modify)
  distractors.test.ts, path.test.ts, progress.test.ts   fixture helpers gain the new fields  (modify)
pipeline/
  package.json       @wordado/pipeline: depends on core; tsx and @types/node
  tsconfig.json      extends the base with Node types
  vitest.config.ts
  src/
    checksum.ts      sha256Hex over bytes (Node crypto)
    build.ts         buildPack: source + clip files → canonical pack bytes + one-pack manifest
    fs.ts            readSourceDir, writeArtifacts
    cli.ts           `corpus build|validate|check`
    sample.test.ts   the committed sample rebuilds byte for byte and has the intended shape
  scripts/
    say-audio.sh     one-off macOS clip generation for the sample
  samples/a1-bg/
    source.json      hand-written: metadata, 60 entries, 3 units, 24 themes
    audio/*.m4a      60 clips (committed)
    corpus-v0-bg.pack, manifest.json   built artifacts (committed; the test rebuilds them)
pnpm-workspace.yaml  + pipeline
package.json         + sample-pack script
```

Dependency order in `core`: `types` → `pack` → `validation` → `packValidation` → `corpus`, `manifest`, `packStability`. `pipeline` depends on `core` only.

---

### Task 1: Pack wire types and canonical JSON

**Files:**
- Modify: `core/src/types.ts`
- Create: `core/src/pack.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/pack.test.ts`

**Interfaces:**
- Consumes: `CefrLevel` (plan 1).
- Produces, from `types.ts`: `PARTS_OF_SPEECH` and `PartOfSpeech`; `Accent = 'uk' | 'us'`; `LocalizedText { en, l1 }`.
- Produces, from `pack.ts`: `PACK_SCHEMA_VERSION = 1`; `Pack`, `PackEntry`, `PackUnit`, `PackTheme`, `PackAudioClip`; `canonicalJson(value: unknown): string`.

This task adds shared vocabulary to `types.ts` without yet changing `CorpusEntry` or `Unit` (Task 3 does that, with the fixture edits).

- [ ] **Step 1: Write the failing test**

`core/src/pack.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canonicalJson } from './pack'

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe(
      '{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}',
    )
  })

  it('keeps array order and drops undefined fields', () => {
    expect(canonicalJson({ list: [2, 1], gone: undefined, kept: null })).toBe('{"kept":null,"list":[2,1]}')
  })

  it('is a fixed point: parsing and re-encoding gives the same string', () => {
    const once = canonicalJson({ z: [1, { b: 'ю', a: 'a' }], a: 1.5 })
    expect(canonicalJson(JSON.parse(once))).toBe(once)
  })

  it('sorts by code unit, not by locale, so every machine agrees', () => {
    expect(canonicalJson({ b: 1, B: 2, a: 3, _x: 4 })).toBe('{"B":2,"_x":4,"a":3,"b":1}')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- pack.test`
Expected: FAIL — cannot resolve `./pack`.

- [ ] **Step 3: Add the shared vocabulary to `types.ts`**

In `core/src/types.ts`, after the `WordFlag` type, insert:

```ts
/** Part-of-speech tags a pack may use (spec §5.2). */
export const PARTS_OF_SPEECH = [
  'noun',
  'verb',
  'adj',
  'adv',
  'pron',
  'prep',
  'det',
  'num',
  'conj',
  'intj',
  'phrase',
] as const
export type PartOfSpeech = (typeof PARTS_OF_SPEECH)[number]

/** Audio accents a pack may carry per entry (spec §5.2). */
export type Accent = 'uk' | 'us'

/** Text shipped in a pack in English and in the pack's L1: unit titles, theme names (spec §8.9). */
export interface LocalizedText {
  readonly en: string
  readonly l1: string
}
```

- [ ] **Step 4: Write `pack.ts`**

`core/src/pack.ts`:

```ts
import type { Accent, CefrLevel, LocalizedText, PartOfSpeech } from './types'

/**
 * The pack schema this build of `core` reads (spec §5.1). Bump it on any
 * change a client of the previous version could not load; a client that
 * meets a newer schema keeps its current pack and asks for an app update.
 */
export const PACK_SCHEMA_VERSION = 1

/** One clip of the audio manifest. `url` is relative to the manifest that listed the pack (spec §9.3). */
export interface PackAudioClip {
  readonly clip_id: string
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly mime: string
}

/** One sense of a headword, as shipped (spec §5.2). */
export interface PackEntry {
  readonly entry_id: string
  readonly headword: string
  /** Accepted spellings (colour / color). */
  readonly variants: readonly string[]
  readonly pos: PartOfSpeech
  /** Sense gloss in the L1; empty when the headword alone is unambiguous. */
  readonly sense: string
  readonly ipa: string
  readonly level: CefrLevel
  readonly unit_id: string
  readonly themes: readonly string[]
  readonly translation: string
  readonly alternates: readonly string[]
  /** English example sentences; at least one for a live entry. */
  readonly examples: readonly string[]
  /** Clip IDs into the pack's audio manifest, by accent. */
  readonly audio: Readonly<Partial<Record<Accent, string>>>
  readonly retired: boolean
}

export interface PackUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  /** Position in the path, unique across the packs a client loads. */
  readonly order: number
  readonly title: LocalizedText
  readonly entry_ids: readonly string[]
}

/** A curated theme (spec §8.9). Membership is on the entries; size decides whether it is offered. */
export interface PackTheme {
  readonly theme_id: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

/** A corpus pack as shipped: one JSON document per (corpus version, L1) (spec §5.1). */
export interface Pack {
  readonly schema_version: number
  readonly pack_id: string
  readonly corpus_version: number
  readonly l1: string
  readonly target: string
  readonly entries: readonly PackEntry[]
  readonly units: readonly PackUnit[]
  readonly themes: readonly PackTheme[]
  readonly audio: readonly PackAudioClip[]
}

/**
 * A pack's bytes are this string in UTF-8: keys sorted by code unit at every
 * depth, no whitespace, undefined fields dropped. The same content is the same
 * bytes on every machine, which is what makes the manifest's checksum mean
 * something (spec §5.1).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) out[key] = sortKeys(source[key])
    }
    return out
  }
  return value
}
```

- [ ] **Step 5: Export it**

In `core/src/index.ts`, append:

```ts
export * from './pack'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `pack.test.ts` has 4 passing tests.

- [ ] **Step 7: Commit**

```bash
git add core/src/types.ts core/src/pack.ts core/src/pack.test.ts core/src/index.ts
git commit -m "feat(core): pack wire types and canonical JSON

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: The pack validator

**Files:**
- Create: `core/src/validation.ts` (internal helpers, not re-exported)
- Create: `core/src/packValidation.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/packValidation.test.ts`

**Interfaces:**
- Consumes: `Pack` and its parts, `PACK_SCHEMA_VERSION` (Task 1); `CEFR_LEVELS`, `PARTS_OF_SPEECH`, `levelIndex`, `LocalizedText`; `isWordId` (plan 1).
- Produces, from `validation.ts` (internal): `Report`, `Raw`, `isRecord`, `at`, `text`, `texts`, `integer`, `bool`, `oneOf`, `localized`, `records`, `id`, `ID`, `LANG`, `SHA256`, `RELATIVE_URL`, `norm`, `checkUnique`.
- Produces, from `packValidation.ts`: `PackError { path, message }`; `PackValidation` (`{ status: 'ok', pack }` | `{ status: 'unsupported_schema', schemaVersion }` | `{ status: 'invalid', errors }`); `ValidatePackOptions { supportedSchemaVersions? }`; `validatePack(value: unknown, options?): PackValidation`.

The validator collects every structural error, then runs the cross checks only on a structurally sound pack, so one missing field does not bury the report in follow-on noise. `unsupported_schema` is its own status because the client's response differs: keep the current pack and ask the learner to update the app (spec §5.1).

- [ ] **Step 1: Write the failing test**

`core/src/packValidation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Pack, PackEntry } from './pack'
import { validatePack } from './packValidation'

const clip = (id: string) => ({ clip_id: id, url: `audio/${id}.m4a`, sha256: 'a'.repeat(64), bytes: 1000, mime: 'audio/mp4' })
const theme = (id: string) => ({ theme_id: id, name: { en: id, l1: id }, description: { en: id, l1: id } })

function entry(over: Partial<PackEntry> & Pick<PackEntry, 'entry_id' | 'unit_id'>): PackEntry {
  return {
    headword: over.entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    themes: [],
    translation: over.entry_id,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired: false,
    ...over,
  }
}

function fixture(over: Partial<Pack> = {}): Pack {
  return {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: 0,
    l1: 'bg',
    target: 'en',
    entries: [
      entry({ entry_id: 'hello-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], audio: { uk: 'hello-1-uk' } }),
      entry({ entry_id: 'water-1', unit_id: 'a1-01', themes: ['food'], audio: { uk: 'water-1-uk' } }),
      entry({ entry_id: 'bread-1', unit_id: 'a1-02', themes: ['food'] }),
    ],
    units: [
      { unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'Hello', l1: 'Здравей' }, entry_ids: ['hello-1', 'water-1'] },
      { unit_id: 'a1-02', level: 'A1', order: 2, title: { en: 'Food', l1: 'Храна' }, entry_ids: ['bread-1'] },
    ],
    themes: [theme('greetings'), theme('food')],
    audio: [clip('hello-1-uk'), clip('water-1-uk')],
    ...over,
  }
}

/** The error paths of an invalid pack, or [] when it is valid. */
function paths(value: unknown): string[] {
  const result = validatePack(value)
  return result.status === 'invalid' ? result.errors.map((e) => e.path) : []
}

function withEntry(index: number, over: Partial<PackEntry>): Pack {
  const base = fixture()
  return { ...base, entries: base.entries.map((e, i) => (i === index ? { ...e, ...over } : e)) }
}

describe('validatePack', () => {
  it('accepts a sound pack and returns it typed', () => {
    const result = validatePack(fixture())
    expect(result.status).toBe('ok')
    if (result.status === 'ok') expect(result.pack.entries.map((e) => e.entry_id)).toEqual(['hello-1', 'water-1', 'bread-1'])
  })

  it('reports a schema it cannot read as its own status', () => {
    expect(validatePack(fixture({ schema_version: 2 }))).toEqual({ status: 'unsupported_schema', schemaVersion: 2 })
    expect(validatePack(fixture({ schema_version: 2 }), { supportedSchemaVersions: [1, 2] }).status).toBe('ok')
    expect(paths(fixture({ schema_version: 0 }))).toEqual(['schema_version'])
    expect(paths({ ...fixture(), schema_version: '1' })).toEqual(['schema_version'])
  })

  it('rejects anything that is not an object', () => {
    expect(paths(null)).toEqual([''])
    expect(paths([])).toEqual([''])
    expect(paths('pack')).toEqual([''])
  })

  it('collects every structural error instead of stopping at the first', () => {
    const bad = withEntry(0, { headword: '', level: 'Z9' as never, audio: { fr: 'x' } as never })
    expect(paths(bad)).toEqual(
      expect.arrayContaining(['entries[0].headword', 'entries[0].level', 'entries[0].audio.fr']),
    )
    expect(paths({ ...fixture(), l1: 'bul', target: '', pack_id: 'has space', corpus_version: -1 })).toEqual(
      expect.arrayContaining(['l1', 'target', 'pack_id', 'corpus_version']),
    )
  })

  it('requires an example sentence and IPA on live entries only', () => {
    expect(paths(withEntry(2, { examples: [] }))).toEqual(['entries[2].examples'])
    expect(paths(withEntry(2, { ipa: '' }))).toEqual(['entries[2].ipa'])
    expect(paths(withEntry(2, { examples: [], ipa: '', retired: true }))).toEqual([])
  })

  it('rejects duplicate IDs and duplicate senses, case-insensitively', () => {
    const base = fixture()
    const dupId = { ...base, entries: [...base.entries, entry({ entry_id: 'bread-1', unit_id: 'a1-02' })] }
    expect(paths(dupId)).toContain('entries[3].entry_id')
    expect(paths(withEntry(1, { headword: 'Bread', sense: '' }))).toContain('entries[2]')
    expect(paths(withEntry(1, { headword: 'Bread', sense: 'за пиене' }))).toEqual([])
    expect(paths(withEntry(1, { headword: 'bread', pos: 'verb' }))).toEqual([])
    const dupUnit = { ...base, units: [...base.units, { ...base.units[1]!, order: 3 }] }
    expect(paths(dupUnit)).toContain('units[2].unit_id')
    const dupTheme = { ...base, themes: [...base.themes, theme('food')] }
    expect(paths(dupTheme)).toContain('themes[2].theme_id')
    const dupClip = { ...base, audio: [...base.audio, clip('hello-1-uk')] }
    expect(paths(dupClip)).toContain('audio[2].clip_id')
  })

  it('keeps entries and units consistent in both directions', () => {
    // Both directions report: the entry names an unknown unit, and its old unit still lists it.
    expect(paths(withEntry(2, { unit_id: 'a1-99' }))).toEqual(['entries[2].unit_id', 'units[1].entry_ids[0]'])
    expect(paths(withEntry(2, { unit_id: 'a1-01' }))).toEqual(
      expect.arrayContaining(['entries[2].unit_id', 'units[1].entry_ids[0]']),
    )
    expect(paths(withEntry(2, { level: 'A2' }))).toEqual(['entries[2].level'])
    const base = fixture()
    const listsUnknown = { ...base, units: [base.units[0]!, { ...base.units[1]!, entry_ids: ['bread-1', 'nope-1'] }] }
    expect(paths(listsUnknown)).toEqual(['units[1].entry_ids[1]'])
    const empty = { ...base, units: [...base.units, { ...base.units[1]!, unit_id: 'a1-03', order: 3, entry_ids: [] }] }
    expect(paths(empty)).toEqual(['units[2].entry_ids'])
    const twice = { ...base, units: [base.units[0]!, { ...base.units[1]!, entry_ids: ['bread-1', 'bread-1'] }] }
    expect(paths(twice)).toEqual(['units[1].entry_ids[1]'])
  })

  it('keeps path order unique and never going back a level', () => {
    const base = fixture()
    const sameOrder = { ...base, units: [base.units[0]!, { ...base.units[1]!, order: 1 }] }
    expect(paths(sameOrder)).toEqual(['units[1].order'])
    const a2First: Pack = {
      ...base,
      entries: base.entries.map((e) => (e.unit_id === 'a1-01' ? { ...e, level: 'A2' } : e)),
      units: [{ ...base.units[0]!, level: 'A2' }, base.units[1]!],
    }
    expect(paths(a2First)).toEqual(['units[1].order'])
  })

  it('resolves themes and clips, and tolerates no orphan clip', () => {
    expect(paths(withEntry(0, { themes: ['greetings', 'nope'] }))).toEqual(['entries[0].themes[1]'])
    expect(paths(withEntry(0, { audio: { uk: 'nope-uk' } }))).toEqual(
      expect.arrayContaining(['entries[0].audio.uk', 'audio[0].clip_id']),
    )
    const base = fixture()
    const orphan = { ...base, audio: [...base.audio, clip('bread-1-uk')] }
    expect(paths(orphan)).toEqual(['audio[2].clip_id'])
  })

  it('checks clip URLs and checksums', () => {
    const base = fixture()
    const withUrl = (url: string) => ({ ...base, audio: [{ ...base.audio[0]!, url }, base.audio[1]!] })
    for (const url of ['/audio/x.m4a', 'audio/../x.m4a', 'https://cdn.example/x.m4a', '']) {
      expect(paths(withUrl(url)), url).toContain('audio[0].url')
    }
    expect(paths(withUrl('audio/x.m4a'))).toEqual([])
    const badHash = { ...base, audio: [{ ...base.audio[0]!, sha256: 'A'.repeat(64) }, base.audio[1]!] }
    expect(paths(badHash)).toEqual(['audio[0].sha256'])
    const badBytes = { ...base, audio: [{ ...base.audio[0]!, bytes: 0 }, base.audio[1]!] }
    expect(paths(badBytes)).toEqual(['audio[0].bytes'])
  })

  it('requires both languages of every localized text', () => {
    const base = fixture()
    const half = { ...base, themes: [base.themes[0]!, { ...base.themes[1]!, description: { en: 'Food', l1: '' } }] }
    expect(paths(half)).toEqual(['themes[1].description.l1'])
    const noTitle = { ...base, units: [{ ...base.units[0]!, title: 'Hello' as never }, base.units[1]!] }
    expect(paths(noTitle)).toEqual(['units[0].title'])
  })

  it('accepts an empty pack: the checks are on what is there', () => {
    expect(paths(fixture({ entries: [], units: [], themes: [], audio: [] }))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- packValidation.test`
Expected: FAIL — cannot resolve `./packValidation`.

- [ ] **Step 3: Write the internal helpers**

`core/src/validation.ts` (internal: not added to `index.ts`):

```ts
import type { LocalizedText } from './types'

/** One problem with a pack or manifest; `path` is a JSON path such as `entries[3].audio.uk`. */
export interface PackError {
  readonly path: string
  readonly message: string
}

export class Report {
  readonly errors: PackError[] = []
  add(path: string, message: string): void {
    this.errors.push({ path, message })
  }
}

export type Raw = Record<string, unknown>

export function isRecord(value: unknown): value is Raw {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** The key pattern of a `c:` word ID, reused for every ID in a pack. */
export const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const LANG = /^[a-z]{2}$/
export const SHA256 = /^[0-9a-f]{64}$/
/** A relative path: no leading slash, no scheme, and no `..` segment (checked separately). */
export const RELATIVE_URL = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/

// Locale-independent by construction: the same duplicate is a duplicate everywhere.
export const norm = (s: string): string => s.trim().normalize('NFC').toLowerCase()

export const at = (path: string, key: string): string => (path === '' ? key : `${path}.${key}`)

export function text(r: Report, raw: Raw, key: string, path: string, nonEmpty = true): string {
  const v = raw[key]
  if (typeof v !== 'string') {
    r.add(at(path, key), 'must be a string')
    return ''
  }
  if (nonEmpty && v.trim() === '') r.add(at(path, key), 'must not be empty')
  return v
}

export function texts(r: Report, raw: Raw, key: string, path: string): string[] {
  const v = raw[key]
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim() !== '')) {
    r.add(at(path, key), 'must be an array of non-empty strings')
    return []
  }
  return v as string[]
}

export function integer(r: Report, raw: Raw, key: string, path: string, min: number): number {
  const v = raw[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) {
    r.add(at(path, key), `must be an integer of at least ${min}`)
    return min
  }
  return v
}

export function bool(r: Report, raw: Raw, key: string, path: string): boolean {
  const v = raw[key]
  if (typeof v !== 'boolean') {
    r.add(at(path, key), 'must be true or false')
    return false
  }
  return v
}

export function oneOf<T extends string>(r: Report, raw: Raw, key: string, path: string, allowed: readonly T[]): T {
  const v = raw[key]
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    r.add(at(path, key), `must be one of ${allowed.join(', ')}`)
    return allowed[0]!
  }
  return v as T
}

export function localized(r: Report, raw: Raw, key: string, path: string): LocalizedText {
  const v = raw[key]
  if (!isRecord(v)) {
    r.add(at(path, key), 'must be an object with "en" and "l1"')
    return { en: '', l1: '' }
  }
  return { en: text(r, v, 'en', at(path, key)), l1: text(r, v, 'l1', at(path, key)) }
}

/** The objects of an array field; non-objects are reported and dropped. */
export function records(r: Report, raw: Raw, key: string, path: string): Raw[] {
  const v = raw[key]
  if (!Array.isArray(v)) {
    r.add(at(path, key), 'must be an array')
    return []
  }
  return v.flatMap((item, i) => {
    if (isRecord(item)) return [item]
    r.add(`${at(path, key)}[${i}]`, 'must be an object')
    return []
  })
}

export function id(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && !ID.test(v)) {
    r.add(at(path, key), 'must start with a letter or digit and contain only letters, digits, ".", "_" and "-"')
  }
  return v
}

export function relativeUrl(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && (!RELATIVE_URL.test(v) || v.split('/').includes('..'))) {
    r.add(at(path, key), 'must be a relative path without ".."')
  }
  return v
}

export function sha256(r: Report, raw: Raw, key: string, path: string): string {
  const v = text(r, raw, key, path)
  if (v !== '' && !SHA256.test(v)) r.add(at(path, key), 'must be 64 lowercase hex digits')
  return v
}

/** Reports the second and later occurrences of a key. */
export function checkUnique(r: Report, keys: readonly string[], pathOf: (i: number) => string, what: string): void {
  const seen = new Set<string>()
  keys.forEach((key, i) => {
    if (seen.has(key)) r.add(pathOf(i), `duplicate ${what} ${JSON.stringify(key)}`)
    seen.add(key)
  })
}
```

- [ ] **Step 4: Write the validator**

`core/src/packValidation.ts`:

```ts
import { PACK_SCHEMA_VERSION, type Pack, type PackAudioClip, type PackEntry, type PackTheme, type PackUnit } from './pack'
import { CEFR_LEVELS, PARTS_OF_SPEECH, levelIndex, type Accent } from './types'
import {
  at,
  bool,
  checkUnique,
  id,
  integer,
  isRecord,
  LANG,
  localized,
  norm,
  oneOf,
  records,
  relativeUrl,
  Report,
  sha256,
  text,
  texts,
  type PackError,
  type Raw,
} from './validation'
import { isWordId } from './wordId'

export type { PackError } from './validation'

export type PackValidation =
  | { readonly status: 'ok'; readonly pack: Pack }
  /** A schema this build cannot read: keep the current pack and ask the learner to update the app (spec §5.1). */
  | { readonly status: 'unsupported_schema'; readonly schemaVersion: number }
  | { readonly status: 'invalid'; readonly errors: readonly PackError[] }

export interface ValidatePackOptions {
  /** Defaults to `[PACK_SCHEMA_VERSION]`. */
  readonly supportedSchemaVersions?: readonly number[]
}

function parseEntry(r: Report, raw: Raw, path: string): PackEntry {
  const entryId = text(r, raw, 'entry_id', path)
  if (entryId !== '' && !isWordId(`c:${entryId}`)) r.add(at(path, 'entry_id'), 'must be a valid word_id key')
  const retired = bool(r, raw, 'retired', path)
  const examples = texts(r, raw, 'examples', path)
  if (!retired && examples.length === 0) r.add(at(path, 'examples'), 'a live entry needs at least one example sentence')
  const audio: Partial<Record<Accent, string>> = {}
  const rawAudio = raw['audio']
  if (!isRecord(rawAudio)) r.add(at(path, 'audio'), 'must be an object of clip ids by accent')
  else {
    for (const [accent, clip] of Object.entries(rawAudio)) {
      if ((accent !== 'uk' && accent !== 'us') || typeof clip !== 'string' || clip === '') {
        r.add(`${at(path, 'audio')}.${accent}`, 'must be a clip id under "uk" or "us"')
      } else audio[accent] = clip
    }
  }
  return {
    entry_id: entryId,
    headword: text(r, raw, 'headword', path),
    variants: texts(r, raw, 'variants', path),
    pos: oneOf(r, raw, 'pos', path, PARTS_OF_SPEECH),
    sense: text(r, raw, 'sense', path, false),
    ipa: text(r, raw, 'ipa', path, !retired),
    level: oneOf(r, raw, 'level', path, CEFR_LEVELS),
    unit_id: id(r, raw, 'unit_id', path),
    themes: texts(r, raw, 'themes', path),
    translation: text(r, raw, 'translation', path),
    alternates: texts(r, raw, 'alternates', path),
    examples,
    audio,
    retired,
  }
}

function parseUnit(r: Report, raw: Raw, path: string): PackUnit {
  return {
    unit_id: id(r, raw, 'unit_id', path),
    level: oneOf(r, raw, 'level', path, CEFR_LEVELS),
    order: integer(r, raw, 'order', path, 1),
    title: localized(r, raw, 'title', path),
    entry_ids: texts(r, raw, 'entry_ids', path),
  }
}

function parseTheme(r: Report, raw: Raw, path: string): PackTheme {
  return {
    theme_id: id(r, raw, 'theme_id', path),
    name: localized(r, raw, 'name', path),
    description: localized(r, raw, 'description', path),
  }
}

function parseClip(r: Report, raw: Raw, path: string): PackAudioClip {
  return {
    clip_id: id(r, raw, 'clip_id', path),
    url: relativeUrl(r, raw, 'url', path),
    sha256: sha256(r, raw, 'sha256', path),
    bytes: integer(r, raw, 'bytes', path, 1),
    mime: text(r, raw, 'mime', path),
  }
}

/** Referential integrity and the stability rules that hold inside one pack (spec §5.1, §13). */
function crossCheck(r: Report, pack: Pack): void {
  checkUnique(r, pack.entries.map((e) => e.entry_id), (i) => `entries[${i}].entry_id`, 'entry_id')
  checkUnique(
    r,
    pack.entries.map((e) => `${norm(e.headword)}|${e.pos}|${norm(e.sense)}`),
    (i) => `entries[${i}]`,
    'headword, part of speech and sense',
  )
  checkUnique(r, pack.units.map((u) => u.unit_id), (i) => `units[${i}].unit_id`, 'unit_id')
  checkUnique(r, pack.units.map((u) => String(u.order)), (i) => `units[${i}].order`, 'order')
  checkUnique(r, pack.themes.map((t) => t.theme_id), (i) => `themes[${i}].theme_id`, 'theme_id')
  checkUnique(r, pack.audio.map((c) => c.clip_id), (i) => `audio[${i}].clip_id`, 'clip_id')

  const units = new Map(pack.units.map((u) => [u.unit_id, u]))
  const entries = new Map(pack.entries.map((e) => [e.entry_id, e]))
  const themes = new Set(pack.themes.map((t) => t.theme_id))
  const clips = new Set(pack.audio.map((c) => c.clip_id))
  const referenced = new Set<string>()

  pack.entries.forEach((e, i) => {
    const path = `entries[${i}]`
    const unit = units.get(e.unit_id)
    if (!unit) r.add(`${path}.unit_id`, `unknown unit ${JSON.stringify(e.unit_id)}`)
    else {
      if (unit.level !== e.level) r.add(`${path}.level`, `differs from the level of unit ${e.unit_id}`)
      if (!unit.entry_ids.includes(e.entry_id)) r.add(`${path}.unit_id`, `unit ${e.unit_id} does not list this entry`)
    }
    e.themes.forEach((t, j) => {
      if (!themes.has(t)) r.add(`${path}.themes[${j}]`, `unknown theme ${JSON.stringify(t)}`)
    })
    for (const [accent, clip] of Object.entries(e.audio)) {
      if (!clips.has(clip)) r.add(`${path}.audio.${accent}`, `unknown clip ${JSON.stringify(clip)}`)
      referenced.add(clip)
    }
  })

  pack.units.forEach((u, i) => {
    const path = `units[${i}]`
    if (u.entry_ids.length === 0) r.add(`${path}.entry_ids`, 'must list at least one entry')
    checkUnique(r, u.entry_ids, (j) => `${path}.entry_ids[${j}]`, 'entry')
    u.entry_ids.forEach((entryId, j) => {
      const e = entries.get(entryId)
      if (!e) r.add(`${path}.entry_ids[${j}]`, `unknown entry ${JSON.stringify(entryId)}`)
      else if (e.unit_id !== u.unit_id) r.add(`${path}.entry_ids[${j}]`, `entry ${entryId} belongs to unit ${e.unit_id}`)
    })
  })

  const ordered = [...pack.units].sort((a, b) => a.order - b.order)
  ordered.forEach((u, i) => {
    const prev = ordered[i - 1]
    if (prev && levelIndex(u.level) < levelIndex(prev.level)) {
      r.add(`units[${pack.units.indexOf(u)}].order`, `a ${u.level} unit cannot follow the ${prev.level} unit ${prev.unit_id} in path order`)
    }
  })

  pack.audio.forEach((c, i) => {
    if (!referenced.has(c.clip_id)) r.add(`audio[${i}].clip_id`, 'no entry references this clip')
  })
}

/**
 * Checks a parsed pack document (spec §5.1, §13): every field, every ID
 * reference, no duplicate sense, units and entries consistent both ways, path
 * order monotone in level, and an audio manifest that is referenced and
 * well-formed. Structural errors are all collected; cross checks run only
 * on a structurally sound pack.
 */
export function validatePack(value: unknown, options: ValidatePackOptions = {}): PackValidation {
  const supported = options.supportedSchemaVersions ?? [PACK_SCHEMA_VERSION]
  if (!isRecord(value)) return { status: 'invalid', errors: [{ path: '', message: 'must be an object' }] }
  const schema = value['schema_version']
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { status: 'invalid', errors: [{ path: 'schema_version', message: 'must be a positive integer' }] }
  }
  if (!supported.includes(schema)) return { status: 'unsupported_schema', schemaVersion: schema }

  const r = new Report()
  const l1 = text(r, value, 'l1', '')
  if (l1 !== '' && !LANG.test(l1)) r.add('l1', 'must be a two-letter lowercase language code')
  const target = text(r, value, 'target', '')
  if (target !== '' && !LANG.test(target)) r.add('target', 'must be a two-letter lowercase language code')
  const pack: Pack = {
    schema_version: schema,
    pack_id: id(r, value, 'pack_id', ''),
    corpus_version: integer(r, value, 'corpus_version', '', 0),
    l1,
    target,
    entries: records(r, value, 'entries', '').map((e, i) => parseEntry(r, e, `entries[${i}]`)),
    units: records(r, value, 'units', '').map((u, i) => parseUnit(r, u, `units[${i}]`)),
    themes: records(r, value, 'themes', '').map((t, i) => parseTheme(r, t, `themes[${i}]`)),
    audio: records(r, value, 'audio', '').map((c, i) => parseClip(r, c, `audio[${i}]`)),
  }
  if (r.errors.length === 0) crossCheck(r, pack)
  return r.errors.length > 0 ? { status: 'invalid', errors: r.errors } : { status: 'ok', pack }
}
```

- [ ] **Step 5: Export it**

In `core/src/index.ts`, append:

```ts
export * from './packValidation'
```

(`validation.ts` stays internal.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `packValidation.test.ts` has 12 passing tests.

- [ ] **Step 7: Commit**

```bash
git add core/src/validation.ts core/src/packValidation.ts core/src/packValidation.test.ts core/src/index.ts
git commit -m "feat(core): pack validator with referential and stability checks

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Loading packs into a corpus; themes by size

**Files:**
- Modify: `core/src/types.ts` (`CorpusEntry`, `Unit`)
- Modify: `core/src/distractors.test.ts:9-22,112-122`, `core/src/path.test.ts:8-13`, `core/src/progress.test.ts:13`
- Create: `core/src/corpus.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/corpus.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 1); `CorpusEntry`, `Unit`, `levelIndex`, `LocalizedText`; `corpusWordId`, `WordId` (plan 1).
- Produces, from `types.ts`: `CorpusEntry` gains `variants: readonly string[]`, `sense: string`, `examples: readonly string[]`, `audio: Readonly<Partial<Record<Accent, string>>>`, and `pos` narrows to `PartOfSpeech`; `Unit` gains `title: LocalizedText`.
- Produces, from `corpus.ts`: `MIN_THEME_SIZE = 25`; `Theme { themeId, name, description }`; `AudioClip { clipId, url, sha256, bytes, mime }`; `Corpus { l1, entries: ReadonlyMap<string, CorpusEntry>, units: readonly Unit[] (path order), themes, clips: ReadonlyMap<string, AudioClip>, retired: ReadonlySet<WordId> }`; `loadCorpus(packs: readonly Pack[]): Corpus`; `themeEntries(corpus, themeId): CorpusEntry[]`; `offeredThemes(corpus): Theme[]`; `entryClips(corpus, entry): AudioClip[]`.

`loadCorpus` takes *validated* packs (the `Pack` type is what `validatePack` returns) and merges the manifest's list into one corpus; it throws on what only a list can get wrong (an ID or a unit order in two packs, packs of two L1s). `Corpus.units` and `Corpus.retired` are what `PathContext` (plan 1) needs; `entries.values()` is the `DistractorContext.pool`.

- [ ] **Step 1: Extend the shared types**

In `core/src/types.ts`, replace the `CorpusEntry` and `Unit` interfaces with:

```ts
/** One sense of a headword, as `core` sees it, for one L1 (spec §5.2). */
export interface CorpusEntry {
  /** Stable ID, without the `c:` prefix. */
  readonly entryId: string
  readonly headword: string
  /** Accepted spellings (colour / color); exact matches in typing modes (spec §8.1). */
  readonly variants: readonly string[]
  readonly pos: PartOfSpeech
  /** Sense gloss in the L1; empty when the headword alone is unambiguous. */
  readonly sense: string
  readonly level: CefrLevel
  readonly ipa: string
  /** A back-reference to the entry's unit; the pack validator keeps it consistent with Unit.wordIds. */
  readonly unitId: string
  readonly themes: readonly string[]
  /** Primary translation first, then accepted alternates. */
  readonly translations: readonly string[]
  /** English example sentences. */
  readonly examples: readonly string[]
  /** Clip IDs into the corpus's audio manifest, by accent (spec §9.3). */
  readonly audio: Readonly<Partial<Record<Accent, string>>>
  readonly retired: boolean
}

/** A unit of the level path (spec §7.2). */
export interface Unit {
  readonly unitId: string
  readonly level: CefrLevel
  /** Position in the path. Unique; lower comes first. */
  readonly order: number
  readonly title: LocalizedText
  /** The source of truth for unit membership and order; CorpusEntry.unitId is the back-reference. */
  readonly wordIds: readonly WordId[]
}
```

`PartOfSpeech`, `Accent` and `LocalizedText` are defined earlier in the same file (Task 1); move that block above `CorpusEntry` if it is not already.

- [ ] **Step 2: Update the three fixture helpers**

`core/src/distractors.test.ts`, the `entry` helper: replace `pos: 'adjective',` with `pos: 'adj',` and add the four fields, so it reads:

```ts
function entry(headword: string, translations: string[], over: Partial<CorpusEntry> = {}): CorpusEntry {
  n += 1
  return {
    entryId: `en-${String(n).padStart(6, '0')}`,
    headword,
    variants: [],
    pos: 'adj',
    sense: '',
    level: 'A1',
    ipa: `/${headword}/`,
    unitId: 'a1-u1',
    themes: [],
    translations,
    examples: [],
    audio: {},
    retired: false,
    ...over,
  }
}
```

In the same file, the property-test pool: replace

```ts
    .map((pool) => pool.map((e, i): CorpusEntry => ({ ...e, entryId: `e${i}`, unitId: 'u', themes: [] })))
```

with

```ts
    .map((pool) =>
      pool.map(
        (e, i): CorpusEntry => ({ ...e, entryId: `e${i}`, unitId: 'u', themes: [], variants: [], sense: '', examples: [], audio: {} }),
      ),
    )
```

`core/src/path.test.ts`, the `unit` helper:

```ts
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({
  unitId,
  level,
  order,
  title: { en: unitId, l1: unitId },
  wordIds: ids.map(w),
})
```

`core/src/progress.test.ts`, line 13:

```ts
const unit = (unitId: string, level: CefrLevel, order: number, ids: number[]): Unit => ({ unitId, level, order, title: { en: unitId, l1: unitId }, wordIds: ids.map(w) })
```

Run `pnpm typecheck`; if any other file constructs a `CorpusEntry` or `Unit` literal, add the same fields there, and if a test compares `pos` to `'adjective'`, make it `'adj'`. Then run `pnpm test`: everything still passes (the new fields change no rule).

- [ ] **Step 3: Write the failing test**

`core/src/corpus.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { entryClips, loadCorpus, MIN_THEME_SIZE, offeredThemes, themeEntries } from './corpus'
import type { Pack, PackEntry, PackUnit } from './pack'
import { corpusWordId } from './wordId'

const clip = (id: string) => ({ clip_id: id, url: `audio/${id}.m4a`, sha256: 'a'.repeat(64), bytes: 1000, mime: 'audio/mp4' })
const theme = (id: string) => ({ theme_id: id, name: { en: id, l1: id }, description: { en: id, l1: id } })

function entry(over: Partial<PackEntry> & Pick<PackEntry, 'entry_id' | 'unit_id'>): PackEntry {
  return {
    headword: over.entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    themes: [],
    translation: over.entry_id,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired: false,
    ...over,
  }
}

const unit = (unit_id: string, level: PackUnit['level'], order: number, entry_ids: string[]): PackUnit => ({
  unit_id,
  level,
  order,
  title: { en: unit_id, l1: unit_id },
  entry_ids,
})

function pack(over: Partial<Pack> = {}): Pack {
  return {
    schema_version: 1,
    pack_id: 'corpus-bg',
    corpus_version: 1,
    l1: 'bg',
    target: 'en',
    entries: [
      entry({ entry_id: 'water-1', unit_id: 'a1-02', themes: ['food'], translation: 'вода', alternates: ['водичка'], audio: { uk: 'water-1-uk' } }),
      entry({ entry_id: 'bread-1', unit_id: 'a1-02', themes: ['food'] }),
      entry({ entry_id: 'hello-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], audio: { uk: 'hello-1-uk', us: 'hello-1-us' } }),
      entry({ entry_id: 'bye-1', unit_id: 'a1-01', pos: 'intj', themes: ['greetings'], retired: true }),
    ],
    units: [unit('a1-02', 'A1', 2, ['bread-1', 'water-1']), unit('a1-01', 'A1', 1, ['hello-1', 'bye-1'])],
    themes: [theme('greetings'), theme('food')],
    audio: [clip('water-1-uk'), clip('hello-1-uk'), clip('hello-1-us')],
    ...over,
  }
}

describe('loadCorpus', () => {
  it('maps entries, units, themes and clips into the shapes the rules read', () => {
    const corpus = loadCorpus([pack()])
    expect(corpus.l1).toBe('bg')
    expect(corpus.entries.get('water-1')).toMatchObject({
      entryId: 'water-1',
      headword: 'water',
      unitId: 'a1-02',
      translations: ['вода', 'водичка'],
      audio: { uk: 'water-1-uk' },
    })
    expect(corpus.units.map((u) => u.unitId)).toEqual(['a1-01', 'a1-02'])
    expect(corpus.units[0]!.wordIds).toEqual([corpusWordId('hello-1'), corpusWordId('bye-1')])
    expect(corpus.units[0]!.title).toEqual({ en: 'a1-01', l1: 'a1-01' })
    expect([...corpus.retired]).toEqual([corpusWordId('bye-1')])
    expect(corpus.themes.map((t) => t.themeId)).toEqual(['greetings', 'food'])
    expect(corpus.clips.get('hello-1-us')).toEqual({ clipId: 'hello-1-us', url: 'audio/hello-1-us.m4a', sha256: 'a'.repeat(64), bytes: 1000, mime: 'audio/mp4' })
  })

  it('merges the packs of a manifest list', () => {
    const extra = pack({
      pack_id: 'extra-bg',
      entries: [entry({ entry_id: 'rice-1', unit_id: 'a2-01', level: 'A2', themes: ['food'] })],
      units: [unit('a2-01', 'A2', 3, ['rice-1'])],
      audio: [],
    })
    const corpus = loadCorpus([pack(), extra])
    expect(corpus.entries.size).toBe(5)
    expect(corpus.units.map((u) => u.unitId)).toEqual(['a1-01', 'a1-02', 'a2-01'])
    expect(corpus.themes).toHaveLength(2)
  })

  it('rejects what only a list can get wrong', () => {
    expect(() => loadCorpus([])).toThrow(/no packs/i)
    expect(() => loadCorpus([pack(), pack({ pack_id: 'again-bg' })])).toThrow(/water-1/)
    const otherL1 = pack({ pack_id: 'corpus-es', l1: 'es', entries: [], units: [], audio: [] })
    expect(() => loadCorpus([pack(), otherL1])).toThrow(/es/)
    const sameOrder = pack({ pack_id: 'x', entries: [entry({ entry_id: 'rice-1', unit_id: 'a1-09' })], units: [unit('a1-09', 'A1', 1, ['rice-1'])], audio: [] })
    expect(() => loadCorpus([pack(), sameOrder])).toThrow(/order 1/)
  })
})

describe('themeEntries', () => {
  it('lists live entries in level order, then path order', () => {
    const extra = pack({
      pack_id: 'extra-bg',
      entries: [entry({ entry_id: 'rice-1', unit_id: 'a2-01', level: 'A2', themes: ['food'] })],
      units: [unit('a2-01', 'A2', 3, ['rice-1'])],
      audio: [],
    })
    const corpus = loadCorpus([pack(), extra])
    expect(themeEntries(corpus, 'food').map((e) => e.entryId)).toEqual(['bread-1', 'water-1', 'rice-1'])
    expect(themeEntries(corpus, 'greetings').map((e) => e.entryId)).toEqual(['hello-1'])
    expect(themeEntries(corpus, 'nope')).toEqual([])
  })
})

describe('offeredThemes', () => {
  function withFoodEntries(count: number, retired: number): Pack {
    const ids = Array.from({ length: count }, (_, i) => `food${i}-1`)
    return pack({
      entries: ids.map((id, i) => entry({ entry_id: id, unit_id: 'a1-01', themes: ['food'], retired: i < retired })),
      units: [unit('a1-01', 'A1', 1, ids)],
      audio: [],
    })
  }

  it('offers a theme once it has the minimum number of live entries', () => {
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE, 0)])).map((t) => t.themeId)).toEqual(['food'])
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE - 1, 0)]))).toEqual([])
  })

  it('does not count retired entries', () => {
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE, 1)]))).toEqual([])
    expect(offeredThemes(loadCorpus([withFoodEntries(MIN_THEME_SIZE + 1, 1)])).map((t) => t.themeId)).toEqual(['food'])
  })
})

describe('entryClips', () => {
  it('returns the clips an entry can play, UK first', () => {
    const corpus = loadCorpus([pack()])
    expect(entryClips(corpus, corpus.entries.get('hello-1')!).map((c) => c.clipId)).toEqual(['hello-1-uk', 'hello-1-us'])
    expect(entryClips(corpus, corpus.entries.get('water-1')!).map((c) => c.clipId)).toEqual(['water-1-uk'])
    expect(entryClips(corpus, corpus.entries.get('bread-1')!)).toEqual([])
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- corpus.test`
Expected: FAIL — cannot resolve `./corpus`.

- [ ] **Step 5: Write `corpus.ts`**

`core/src/corpus.ts`:

```ts
import type { Pack } from './pack'
import { levelIndex, type CorpusEntry, type LocalizedText, type Unit } from './types'
import { corpusWordId, type WordId } from './wordId'

/** A theme is offered once this many live entries carry its tag (spec §8.9). Tuning value (§15). */
export const MIN_THEME_SIZE = 25

export interface Theme {
  readonly themeId: string
  readonly name: LocalizedText
  readonly description: LocalizedText
}

export interface AudioClip {
  readonly clipId: string
  /** Relative to the manifest that listed the pack (spec §9.3). */
  readonly url: string
  readonly sha256: string
  readonly bytes: number
  readonly mime: string
}

/** Every loaded pack, merged: what `PathContext`, `DistractorContext` and the screens read. */
export interface Corpus {
  readonly l1: string
  readonly entries: ReadonlyMap<string, CorpusEntry>
  /** In path order. */
  readonly units: readonly Unit[]
  /** The curated list, whether or not each theme is offered yet. */
  readonly themes: readonly Theme[]
  readonly clips: ReadonlyMap<string, AudioClip>
  /** For `PathContext.retired`. */
  readonly retired: ReadonlySet<WordId>
}

/**
 * Merges validated packs — the manifest's list (spec §5.1) — into one corpus.
 * Throws on what only a list can get wrong: an entry, unit, clip or unit
 * order in two packs, or packs for two L1s.
 */
export function loadCorpus(packs: readonly Pack[]): Corpus {
  const first = packs[0]
  if (!first) throw new Error('No packs to load')
  const entries = new Map<string, CorpusEntry>()
  const units: Unit[] = []
  const themes = new Map<string, Theme>()
  const clips = new Map<string, AudioClip>()
  const retired = new Set<WordId>()
  for (const pack of packs) {
    if (pack.l1 !== first.l1) throw new Error(`Pack ${pack.pack_id} is for L1 ${pack.l1}, not ${first.l1}`)
    for (const e of pack.entries) {
      if (entries.has(e.entry_id)) throw new Error(`Entry ${e.entry_id} appears in more than one pack`)
      entries.set(e.entry_id, {
        entryId: e.entry_id,
        headword: e.headword,
        variants: e.variants,
        pos: e.pos,
        sense: e.sense,
        level: e.level,
        ipa: e.ipa,
        unitId: e.unit_id,
        themes: e.themes,
        translations: [e.translation, ...e.alternates],
        examples: e.examples,
        audio: e.audio,
        retired: e.retired,
      })
      if (e.retired) retired.add(corpusWordId(e.entry_id))
    }
    for (const u of pack.units) {
      const clash = units.find((x) => x.unitId === u.unit_id || x.order === u.order)
      if (clash) throw new Error(`Unit ${u.unit_id} (order ${u.order}) clashes with unit ${clash.unitId} (order ${clash.order}) of another pack`)
      units.push({ unitId: u.unit_id, level: u.level, order: u.order, title: u.title, wordIds: u.entry_ids.map(corpusWordId) })
    }
    for (const t of pack.themes) {
      if (!themes.has(t.theme_id)) themes.set(t.theme_id, { themeId: t.theme_id, name: t.name, description: t.description })
    }
    for (const c of pack.audio) {
      if (clips.has(c.clip_id)) throw new Error(`Clip ${c.clip_id} appears in more than one pack`)
      clips.set(c.clip_id, { clipId: c.clip_id, url: c.url, sha256: c.sha256, bytes: c.bytes, mime: c.mime })
    }
  }
  units.sort((a, b) => a.order - b.order)
  return { l1: first.l1, entries, units, themes: [...themes.values()], clips, retired }
}

/** Each word's position along the path, for stable ordering inside a level. */
function pathPositions(corpus: Corpus): Map<WordId, number> {
  const positions = new Map<WordId, number>()
  for (const unit of corpus.units) for (const wordId of unit.wordIds) positions.set(wordId, positions.size)
  return positions
}

/**
 * The live entries of a theme in level order, then path order: the serve
 * order of a theme collection (spec §8.9), which plan 4 passes as
 * `SessionInput.collectionNew`.
 */
export function themeEntries(corpus: Corpus, themeId: string): CorpusEntry[] {
  const positions = pathPositions(corpus)
  const position = (e: CorpusEntry) => positions.get(corpusWordId(e.entryId)) ?? Number.MAX_SAFE_INTEGER
  return [...corpus.entries.values()]
    .filter((e) => !e.retired && e.themes.includes(themeId))
    .sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || position(a) - position(b))
}

/** The themes big enough to offer (spec §8.9). A theme appears as the corpus grows; nothing is stored. */
export function offeredThemes(corpus: Corpus): Theme[] {
  return corpus.themes.filter((t) => themeEntries(corpus, t.themeId).length >= MIN_THEME_SIZE)
}

/** The clips an entry can play, UK first: what the audio prefetch and mode availability look at (spec §9.3). */
export function entryClips(corpus: Corpus, entry: CorpusEntry): AudioClip[] {
  return [entry.audio.uk, entry.audio.us].flatMap((id) => {
    const clip = id === undefined ? undefined : corpus.clips.get(id)
    return clip ? [clip] : []
  })
}
```

- [ ] **Step 6: Export it**

In `core/src/index.ts`, append:

```ts
export * from './corpus'
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `corpus.test.ts` has 7 passing tests.

- [ ] **Step 8: Commit**

```bash
git add core/src/types.ts core/src/corpus.ts core/src/corpus.test.ts core/src/index.ts core/src/distractors.test.ts core/src/path.test.ts core/src/progress.test.ts
git commit -m "feat(core): load packs into a corpus; themes offered by size

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: The manifest as a list, and pack selection

**Files:**
- Create: `core/src/manifest.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/manifest.test.ts`

**Interfaces:**
- Consumes: the internal helpers of `validation.ts` (Task 2).
- Produces: `MANIFEST_SCHEMA_VERSION = 1`; `PackDescriptor { pack_id, l1, corpus_version, schema_version, url, sha256, bytes }`; `PackManifest { schema_version, corpus_version, packs }`; `ManifestValidation`; `validateManifest(value: unknown, supportedSchemaVersions?): ManifestValidation`; `InstalledPack { pack_id, corpus_version, schema_version }`; `PackSelectionInput { manifest, l1, installed, supportedSchemaVersions }`; `PackSelection { fetch, appUpdateNeeded }`; `selectPacks(input): PackSelection`.

The manifest is a list from day one (spec §5.1, §14): one item at launch, but `selectPacks` handles several per L1 without a special case. The rule for a pack whose schema is newer than the client reads comes straight from §5.1: keep the current pack, report that the app needs an update.

- [ ] **Step 1: Write the failing test**

`core/src/manifest.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectPacks, validateManifest, type PackDescriptor, type PackManifest } from './manifest'

const bg = (corpus_version: number, schema_version = 1): PackDescriptor => ({
  pack_id: 'corpus-bg',
  l1: 'bg',
  corpus_version,
  schema_version,
  url: `corpus-v${corpus_version}-bg.pack`,
  sha256: 'b'.repeat(64),
  bytes: 120_000,
})
const es = (corpus_version: number): PackDescriptor => ({ ...bg(corpus_version), pack_id: 'corpus-es', l1: 'es', url: `corpus-v${corpus_version}-es.pack` })
const manifest = (packs: PackDescriptor[], corpus_version = 1): PackManifest => ({ schema_version: 1, corpus_version, packs })
const supported = [1]

describe('validateManifest', () => {
  it('accepts a sound manifest', () => {
    expect(validateManifest(manifest([bg(1), es(1)]))).toEqual({ status: 'ok', manifest: manifest([bg(1), es(1)]) })
  })

  it('reports an unreadable schema as its own status', () => {
    expect(validateManifest({ ...manifest([]), schema_version: 3 })).toEqual({ status: 'unsupported_schema', schemaVersion: 3 })
  })

  it('collects field errors and duplicate pack ids', () => {
    const result = validateManifest(manifest([{ ...bg(1), url: '/abs', sha256: 'zz', bytes: 0 }, bg(2)]))
    expect(result.status).toBe('invalid')
    if (result.status === 'invalid') {
      expect(result.errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(['packs[0].url', 'packs[0].sha256', 'packs[0].bytes', 'packs[1].pack_id']),
      )
    }
    expect(validateManifest(null).status).toBe('invalid')
    expect(validateManifest({ schema_version: 1, corpus_version: 1 }).status).toBe('invalid')
  })
})

describe('selectPacks', () => {
  it('fetches the learner-L1 packs a fresh install lacks and ignores other L1s', () => {
    const out = selectPacks({ manifest: manifest([bg(1), es(1)]), l1: 'bg', installed: [], supportedSchemaVersions: supported })
    expect(out).toEqual({ fetch: [bg(1)], appUpdateNeeded: [] })
  })

  it('fetches only a newer version', () => {
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    expect(selectPacks({ manifest: manifest([bg(1)]), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([])
    expect(selectPacks({ manifest: manifest([bg(2)], 2), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([bg(2)])
    expect(selectPacks({ manifest: manifest([bg(0)]), l1: 'bg', installed, supportedSchemaVersions: supported }).fetch).toEqual([])
  })

  it('keeps the current pack and asks for an app update when the schema is newer than it reads', () => {
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    const out = selectPacks({ manifest: manifest([bg(2, 2)], 2), l1: 'bg', installed, supportedSchemaVersions: supported })
    expect(out).toEqual({ fetch: [], appUpdateNeeded: [bg(2, 2)] })
    expect(selectPacks({ manifest: manifest([bg(2, 2)], 2), l1: 'bg', installed, supportedSchemaVersions: [1, 2] }).fetch).toEqual([bg(2, 2)])
  })

  it('handles several packs for one L1 independently', () => {
    const extra: PackDescriptor = { ...bg(1), pack_id: 'exam-bg', url: 'exam-v1-bg.pack' }
    const installed = [{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }]
    const out = selectPacks({ manifest: manifest([bg(1), extra]), l1: 'bg', installed, supportedSchemaVersions: supported })
    expect(out.fetch).toEqual([extra])
  })

  it('leaves an installed pack alone when the manifest no longer lists it', () => {
    const installed = [{ pack_id: 'gone-bg', corpus_version: 1, schema_version: 1 }]
    expect(selectPacks({ manifest: manifest([]), l1: 'bg', installed, supportedSchemaVersions: supported })).toEqual({ fetch: [], appUpdateNeeded: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- manifest.test`
Expected: FAIL — cannot resolve `./manifest`.

- [ ] **Step 3: Write `manifest.ts`**

`core/src/manifest.ts`:

```ts
import {
  checkUnique,
  id,
  integer,
  isRecord,
  LANG,
  records,
  relativeUrl,
  Report,
  sha256,
  text,
  type PackError,
  type Raw,
} from './validation'

/** The manifest schema this build reads. Bump on any change an older client could not parse. */
export const MANIFEST_SCHEMA_VERSION = 1

/** One pack the manifest offers. `url` is relative to the manifest's own URL. */
export interface PackDescriptor {
  readonly pack_id: string
  readonly l1: string
  readonly corpus_version: number
  readonly schema_version: number
  readonly url: string
  readonly sha256: string
  readonly bytes: number
}

/**
 * A client's content is described by a list (spec §5.1): one item per pack,
 * each with its own version and checksum. `corpus_version` is the global
 * version; the list says which L1 packs exist at it.
 */
export interface PackManifest {
  readonly schema_version: number
  readonly corpus_version: number
  readonly packs: readonly PackDescriptor[]
}

export type ManifestValidation =
  | { readonly status: 'ok'; readonly manifest: PackManifest }
  | { readonly status: 'unsupported_schema'; readonly schemaVersion: number }
  | { readonly status: 'invalid'; readonly errors: readonly PackError[] }

function parseDescriptor(r: Report, raw: Raw, path: string): PackDescriptor {
  const l1 = text(r, raw, 'l1', path)
  if (l1 !== '' && !LANG.test(l1)) r.add(`${path}.l1`, 'must be a two-letter lowercase language code')
  return {
    pack_id: id(r, raw, 'pack_id', path),
    l1,
    corpus_version: integer(r, raw, 'corpus_version', path, 0),
    schema_version: integer(r, raw, 'schema_version', path, 1),
    url: relativeUrl(r, raw, 'url', path),
    sha256: sha256(r, raw, 'sha256', path),
    bytes: integer(r, raw, 'bytes', path, 1),
  }
}

export function validateManifest(
  value: unknown,
  supportedSchemaVersions: readonly number[] = [MANIFEST_SCHEMA_VERSION],
): ManifestValidation {
  if (!isRecord(value)) return { status: 'invalid', errors: [{ path: '', message: 'must be an object' }] }
  const schema = value['schema_version']
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { status: 'invalid', errors: [{ path: 'schema_version', message: 'must be a positive integer' }] }
  }
  if (!supportedSchemaVersions.includes(schema)) return { status: 'unsupported_schema', schemaVersion: schema }
  const r = new Report()
  const manifest: PackManifest = {
    schema_version: schema,
    corpus_version: integer(r, value, 'corpus_version', '', 0),
    packs: records(r, value, 'packs', '').map((p, i) => parseDescriptor(r, p, `packs[${i}]`)),
  }
  checkUnique(r, manifest.packs.map((p) => p.pack_id), (i) => `packs[${i}].pack_id`, 'pack_id')
  return r.errors.length > 0 ? { status: 'invalid', errors: r.errors } : { status: 'ok', manifest }
}

/** What the client already holds, per pack. */
export interface InstalledPack {
  readonly pack_id: string
  readonly corpus_version: number
  readonly schema_version: number
}

export interface PackSelectionInput {
  readonly manifest: PackManifest
  readonly l1: string
  readonly installed: readonly InstalledPack[]
  /** Normally `[PACK_SCHEMA_VERSION]`. */
  readonly supportedSchemaVersions: readonly number[]
}

export interface PackSelection {
  /** Newer packs to download, verify and swap in at the start of the next session (spec §5.1). */
  readonly fetch: readonly PackDescriptor[]
  /** Newer packs whose schema this build cannot read: keep the installed one and ask the learner to update the app. */
  readonly appUpdateNeeded: readonly PackDescriptor[]
}

/** Which of the manifest's packs a client of `l1` should fetch (spec §5.1, §9.3). */
export function selectPacks(input: PackSelectionInput): PackSelection {
  const fetch: PackDescriptor[] = []
  const appUpdateNeeded: PackDescriptor[] = []
  for (const offered of input.manifest.packs) {
    if (offered.l1 !== input.l1) continue
    const have = input.installed.find((p) => p.pack_id === offered.pack_id)
    if (have && have.corpus_version >= offered.corpus_version) continue
    if (input.supportedSchemaVersions.includes(offered.schema_version)) fetch.push(offered)
    else appUpdateNeeded.push(offered)
  }
  return { fetch, appUpdateNeeded }
}
```

- [ ] **Step 4: Export it**

In `core/src/index.ts`, append:

```ts
export * from './manifest'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `manifest.test.ts` has 8 passing tests.

- [ ] **Step 6: Commit**

```bash
git add core/src/manifest.ts core/src/manifest.test.ts core/src/index.ts
git commit -m "feat(core): pack manifest as a list and pack selection

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Stability between pack versions

**Files:**
- Create: `core/src/packStability.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/packStability.test.ts`

**Interfaces:**
- Consumes: `Pack` (Task 1); `PackError` (Task 2).
- Produces: `checkPackSuccession(previous: Pack, next: Pack): PackError[]`.

What version *n+1* of a pack owes version *n* (spec §5.1): the same pack and L1; a higher corpus version; a schema version that does not go back; every entry ID and unit ID still present. A retired entry may come back to life (a mistake corrected) and an entry may move unit or level; neither is checked. The pipeline runs this against the last published pack before it publishes (plan 8), and the sample pack is version 0, so the first real Bulgarian pack is checked against it.

- [ ] **Step 1: Write the failing test**

`core/src/packStability.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Pack, PackEntry, PackUnit } from './pack'
import { checkPackSuccession } from './packStability'

function entry(entry_id: string, unit_id: string, retired = false): PackEntry {
  return {
    entry_id,
    headword: entry_id.replace(/-\d+$/, ''),
    variants: [],
    pos: 'noun',
    sense: '',
    ipa: 'x',
    level: 'A1',
    unit_id,
    themes: [],
    translation: entry_id,
    alternates: [],
    examples: ['An example.'],
    audio: {},
    retired,
  }
}

const unit = (unit_id: string, order: number, entry_ids: string[]): PackUnit => ({
  unit_id,
  level: 'A1',
  order,
  title: { en: unit_id, l1: unit_id },
  entry_ids,
})

const v0: Pack = {
  schema_version: 1,
  pack_id: 'corpus-bg',
  corpus_version: 0,
  l1: 'bg',
  target: 'en',
  entries: [entry('hello-1', 'a1-01'), entry('water-1', 'a1-01')],
  units: [unit('a1-01', 1, ['hello-1', 'water-1'])],
  themes: [],
  audio: [],
}

const messages = (errors: { message: string }[]) => errors.map((e) => e.message)

describe('checkPackSuccession', () => {
  it('accepts a version that keeps every ID and grows', () => {
    const v1: Pack = {
      ...v0,
      corpus_version: 1,
      entries: [...v0.entries, entry('bread-1', 'a1-02')],
      units: [...v0.units, unit('a1-02', 2, ['bread-1'])],
    }
    expect(checkPackSuccession(v0, v1)).toEqual([])
  })

  it('accepts a retired entry, a moved entry and an un-retired entry', () => {
    const retired: Pack = { ...v0, corpus_version: 1, entries: [entry('hello-1', 'a1-01', true), v0.entries[1]!] }
    expect(checkPackSuccession(v0, retired)).toEqual([])
    expect(checkPackSuccession(retired, { ...v0, corpus_version: 2 })).toEqual([])
    const moved: Pack = {
      ...v0,
      corpus_version: 1,
      entries: [v0.entries[0]!, entry('water-1', 'a1-02')],
      units: [unit('a1-01', 1, ['hello-1']), unit('a1-02', 2, ['water-1'])],
    }
    expect(checkPackSuccession(v0, moved)).toEqual([])
  })

  it('rejects a removed entry or unit', () => {
    const dropped: Pack = { ...v0, corpus_version: 1, entries: [v0.entries[0]!], units: [unit('a1-01', 1, ['hello-1'])] }
    expect(messages(checkPackSuccession(v0, dropped))).toEqual(['entry water-1 was removed; retire it instead'])
    const renamedUnit: Pack = {
      ...v0,
      corpus_version: 1,
      entries: v0.entries.map((e) => ({ ...e, unit_id: 'a1-1' })),
      units: [unit('a1-1', 1, ['hello-1', 'water-1'])],
    }
    expect(messages(checkPackSuccession(v0, renamedUnit))).toEqual(['unit a1-01 was removed'])
  })

  it('rejects a version that does not rise, a schema that goes back, or another pack', () => {
    expect(checkPackSuccession(v0, v0).map((e) => e.path)).toEqual(['corpus_version'])
    expect(checkPackSuccession({ ...v0, schema_version: 2 }, { ...v0, corpus_version: 1 }).map((e) => e.path)).toEqual(['schema_version'])
    expect(checkPackSuccession(v0, { ...v0, corpus_version: 1, pack_id: 'corpus-es', l1: 'es' }).map((e) => e.path)).toEqual(['pack_id', 'l1'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- packStability.test`
Expected: FAIL — cannot resolve `./packStability`.

- [ ] **Step 3: Write `packStability.ts`**

`core/src/packStability.ts`:

```ts
import type { Pack } from './pack'
import type { PackError } from './validation'

/**
 * What version n+1 of a pack owes version n (spec §5.1): the same pack and
 * L1, a higher corpus version, a schema that does not go back, and every
 * entry and unit ID still present — a retired entry stays in the pack. The
 * pipeline runs this against the last published pack before publishing.
 */
export function checkPackSuccession(previous: Pack, next: Pack): PackError[] {
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
  const units = new Set(next.units.map((u) => u.unit_id))
  for (const u of previous.units) {
    if (!units.has(u.unit_id)) errors.push({ path: 'units', message: `unit ${u.unit_id} was removed` })
  }
  return errors
}
```

- [ ] **Step 4: Export it**

In `core/src/index.ts`, append:

```ts
export * from './packStability'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `packStability.test.ts` has 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add core/src/packStability.ts core/src/packStability.test.ts core/src/index.ts
git commit -m "feat(core): stability checks between pack versions

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The pipeline package: checksum, build and CLI

**Files:**
- Modify: `pnpm-workspace.yaml`, `package.json` (root)
- Create: `pipeline/package.json`, `pipeline/tsconfig.json`, `pipeline/vitest.config.ts`
- Create: `pipeline/src/checksum.ts`, `pipeline/src/build.ts`, `pipeline/src/fs.ts`, `pipeline/src/cli.ts`
- Test: `pipeline/src/checksum.test.ts`, `pipeline/src/build.test.ts`

**Interfaces:**
- Consumes: `canonicalJson`, `PACK_SCHEMA_VERSION`, `validatePack`, `MANIFEST_SCHEMA_VERSION`, `checkPackSuccession`, `loadCorpus`, `offeredThemes`, `themeEntries` and the `Pack`/`PackManifest`/`PackError` types from `@wordado/core` (Tasks 1–5).
- Produces, from `checksum.ts`: `sha256Hex(bytes: Uint8Array): string`.
- Produces, from `build.ts`: `AUDIO_MIME = 'audio/mp4'`, `AUDIO_EXT = 'm4a'`; `ClipFile { clipId, bytes }`; `BuildOutput { pack, packFile, packBytes, manifest }`; `BuildError` (with `.errors: readonly PackError[]`); `buildPack(source: unknown, clips: readonly ClipFile[]): BuildOutput`.
- Produces, from `fs.ts`: `readSourceDir(dir): { source: unknown; clips: ClipFile[] }`; `writeArtifacts(dir, out: BuildOutput): void`.
- Produces: the CLI `pnpm --filter @wordado/pipeline corpus <build DIR | validate FILE | check PREV NEXT>` and the root script `pnpm sample-pack`.

A *source* is the pack without `schema_version` and `audio`: the pipeline derives both, so a hand-written manifest can never drift from the files beside it. `buildPack` sorts entries, units, themes and clips before encoding, so the source's order and the directory's scan order leave no trace in the bytes.

- [ ] **Step 1: Add the package to the workspace**

`pnpm-workspace.yaml`:

```yaml
packages:
  - core
  - pipeline
```

`pipeline/package.json`:

```json
{
  "name": "@wordado/pipeline",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json",
    "corpus": "tsx src/cli.ts"
  },
  "dependencies": {
    "@wordado/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "tsx": "^4.19.0"
  }
}
```

`pipeline/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src"]
}
```

`pipeline/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
```

In the root `package.json`, add to `scripts`:

```json
    "sample-pack": "pnpm --filter @wordado/pipeline corpus build samples/a1-bg"
```

Run: `pnpm install`
Expected: `pipeline` linked, `tsx` and `@types/node` added, `pnpm-lock.yaml` updated.

- [ ] **Step 2: Write the failing tests**

`pipeline/src/checksum.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './checksum'

describe('sha256Hex', () => {
  it('matches the published test vector', () => {
    expect(sha256Hex(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })

  it('hashes the empty input', () => {
    expect(sha256Hex(new Uint8Array())).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
```

`pipeline/src/build.test.ts`:

```ts
import { validatePack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { BuildError, buildPack } from './build'
import { sha256Hex } from './checksum'

const water = {
  entry_id: 'water-1',
  headword: 'water',
  variants: [],
  pos: 'noun',
  sense: '',
  ipa: 'ˈwɔːtə',
  level: 'A1',
  unit_id: 'a1-01',
  themes: ['food'],
  translation: 'вода',
  alternates: [],
  examples: ['Water, please.'],
  audio: { uk: 'water-1-uk' },
  retired: false,
}
const bread = { ...water, entry_id: 'bread-1', headword: 'bread', ipa: 'bred', translation: 'хляб', audio: {} }

const source = (entries = [water, bread]) => ({
  pack_id: 'corpus-bg',
  corpus_version: 3,
  l1: 'bg',
  target: 'en',
  entries,
  units: [{ unit_id: 'a1-01', level: 'A1', order: 1, title: { en: 'Food', l1: 'Храна' }, entry_ids: ['water-1', 'bread-1'] }],
  themes: [{ theme_id: 'food', name: { en: 'Food', l1: 'Храна' }, description: { en: 'Food.', l1: 'Храна.' } }],
})
const clips = [{ clipId: 'water-1-uk', bytes: new TextEncoder().encode('not really audio') }]

describe('buildPack', () => {
  it('derives the audio manifest from the clip files', () => {
    const out = buildPack(source(), clips)
    expect(out.pack.audio).toEqual([
      { clip_id: 'water-1-uk', url: 'audio/water-1-uk.m4a', sha256: sha256Hex(clips[0]!.bytes), bytes: 16, mime: 'audio/mp4' },
    ])
    expect(out.pack.schema_version).toBe(1)
  })

  it('names the file and describes it in a one-pack manifest', () => {
    const out = buildPack(source(), clips)
    expect(out.packFile).toBe('corpus-v3-bg.pack')
    expect(out.manifest).toEqual({
      schema_version: 1,
      corpus_version: 3,
      packs: [
        { pack_id: 'corpus-bg', l1: 'bg', corpus_version: 3, schema_version: 1, url: 'corpus-v3-bg.pack', sha256: sha256Hex(out.packBytes), bytes: out.packBytes.byteLength },
      ],
    })
  })

  it('gives the same bytes whatever the order of the source and the clips', () => {
    const a = buildPack(source([water, bread]), clips)
    const b = buildPack(source([bread, water]), [...clips].reverse())
    expect(Buffer.from(a.packBytes).equals(Buffer.from(b.packBytes))).toBe(true)
    expect(a.pack.entries.map((e) => e.entry_id)).toEqual(['bread-1', 'water-1'])
  })

  it('produces bytes that parse and validate as a pack', () => {
    const out = buildPack(source(), clips)
    const text = new TextDecoder().decode(out.packBytes)
    // Canonical: keys sorted, so the document opens with the audio manifest, and no whitespace between tokens.
    expect(text.startsWith('{"audio":[{"bytes":16,"clip_id":"water-1-uk"')).toBe(true)
    expect(validatePack(JSON.parse(text)).status).toBe('ok')
  })

  it('reports every validation error', () => {
    const bad = source([{ ...water, unit_id: 'a1-99', themes: ['nope'] }, bread])
    expect(() => buildPack(bad, clips)).toThrow(BuildError)
    try {
      buildPack(bad, clips)
    } catch (err) {
      expect((err as BuildError).errors.map((e) => e.path)).toEqual(
        expect.arrayContaining(['entries[0].unit_id', 'entries[0].themes[0]']),
      )
    }
  })

  it('refuses a source that carries what the build derives', () => {
    expect(() => buildPack({ ...source(), audio: [] }, clips)).toThrow(/derived/)
    expect(() => buildPack({ ...source(), schema_version: 1 }, clips)).toThrow(/derived/)
    expect(() => buildPack('nope', clips)).toThrow(BuildError)
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/pipeline test`
Expected: FAIL — cannot resolve `./checksum` and `./build`.

- [ ] **Step 4: Write `checksum.ts` and `build.ts`**

`pipeline/src/checksum.ts`:

```ts
import { createHash } from 'node:crypto'

/** The checksum a manifest carries for a pack, and a pack for a clip (spec §5.1, §9.3). */
export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
```

`pipeline/src/build.ts`:

```ts
import {
  canonicalJson,
  MANIFEST_SCHEMA_VERSION,
  PACK_SCHEMA_VERSION,
  validatePack,
  type Pack,
  type PackAudioClip,
  type PackError,
  type PackManifest,
} from '@wordado/core'
import { sha256Hex } from './checksum'

/** AAC in an MP4 container: playable in every launch browser (spec §9.3). */
export const AUDIO_MIME = 'audio/mp4'
export const AUDIO_EXT = 'm4a'

export interface ClipFile {
  readonly clipId: string
  readonly bytes: Uint8Array
}

export interface BuildOutput {
  readonly pack: Pack
  /** `corpus-v<version>-<l1>.pack`: the file name the manifest points at. */
  readonly packFile: string
  readonly packBytes: Uint8Array
  /** A manifest listing this pack alone; plan 8 composes the multi-L1 manifest. */
  readonly manifest: PackManifest
}

export class BuildError extends Error {
  readonly errors: readonly PackError[]
  constructor(errors: readonly PackError[]) {
    super(errors.map((e) => `${e.path || '(pack)'}: ${e.message}`).join('\n'))
    this.name = 'BuildError'
    this.errors = errors
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Assembles a pack from a source (the pack without `schema_version` and
 * `audio`) and the clip files beside it. Everything is sorted before
 * encoding, so the same source gives the same bytes on every machine.
 */
export function buildPack(source: unknown, clips: readonly ClipFile[]): BuildOutput {
  if (!isRecord(source)) throw new BuildError([{ path: '', message: 'source must be a JSON object' }])
  if ('audio' in source || 'schema_version' in source) {
    throw new BuildError([{ path: '', message: 'the audio manifest and the schema version are derived by the build, not written by hand' }])
  }
  const audio: PackAudioClip[] = [...clips]
    .sort((a, b) => byString(a.clipId, b.clipId))
    .map((c) => ({
      clip_id: c.clipId,
      url: `audio/${c.clipId}.${AUDIO_EXT}`,
      sha256: sha256Hex(c.bytes),
      bytes: c.bytes.byteLength,
      mime: AUDIO_MIME,
    }))
  const result = validatePack({ ...source, schema_version: PACK_SCHEMA_VERSION, audio })
  if (result.status === 'unsupported_schema') throw new BuildError([{ path: 'schema_version', message: 'not supported by this build' }])
  if (result.status === 'invalid') throw new BuildError(result.errors)
  const pack: Pack = {
    ...result.pack,
    entries: [...result.pack.entries].sort((a, b) => byString(a.entry_id, b.entry_id)),
    units: [...result.pack.units].sort((a, b) => a.order - b.order),
    themes: [...result.pack.themes].sort((a, b) => byString(a.theme_id, b.theme_id)),
  }
  const packBytes = new TextEncoder().encode(canonicalJson(pack))
  const packFile = `corpus-v${pack.corpus_version}-${pack.l1}.pack`
  const manifest: PackManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    corpus_version: pack.corpus_version,
    packs: [
      {
        pack_id: pack.pack_id,
        l1: pack.l1,
        corpus_version: pack.corpus_version,
        schema_version: pack.schema_version,
        url: packFile,
        sha256: sha256Hex(packBytes),
        bytes: packBytes.byteLength,
      },
    ],
  }
  return { pack, packFile, packBytes, manifest }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/pipeline test`
Expected: PASS — 8 tests.

- [ ] **Step 6: Write `fs.ts` and `cli.ts`**

`pipeline/src/fs.ts`:

```ts
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { AUDIO_EXT, type BuildOutput, type ClipFile } from './build'

export interface SourceDir {
  readonly source: unknown
  readonly clips: ClipFile[]
}

/** A source directory: `source.json` beside an `audio/` directory of `.m4a` clips named by clip ID. */
export function readSourceDir(dir: string): SourceDir {
  const source: unknown = JSON.parse(readFileSync(join(dir, 'source.json'), 'utf8'))
  const audioDir = join(dir, 'audio')
  const clips = readdirSync(audioDir)
    .filter((name) => extname(name) === `.${AUDIO_EXT}`)
    .sort()
    .map((name) => ({ clipId: basename(name, `.${AUDIO_EXT}`), bytes: new Uint8Array(readFileSync(join(audioDir, name))) }))
  return { source, clips }
}

/** Writes the pack and its one-pack manifest beside the source, where the audio already is. */
export function writeArtifacts(dir: string, out: BuildOutput): void {
  writeFileSync(join(dir, out.packFile), out.packBytes)
  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(out.manifest, null, 2)}\n`)
}
```

`pipeline/src/cli.ts`:

```ts
import { readFileSync } from 'node:fs'
import {
  checkPackSuccession,
  loadCorpus,
  offeredThemes,
  themeEntries,
  validatePack,
  type Pack,
  type PackError,
} from '@wordado/core'
import { BuildError, buildPack, type BuildOutput, type ClipFile } from './build'
import { readSourceDir, writeArtifacts } from './fs'

function fail(errors: readonly PackError[]): never {
  for (const e of errors) console.error(`${e.path || '(pack)'}: ${e.message}`)
  process.exit(1)
}

function usage(): never {
  console.error('usage: corpus build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack>')
  process.exit(2)
}

function readPack(file: string): Pack {
  const result = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (result.status === 'unsupported_schema') {
    fail([{ path: 'schema_version', message: `schema ${result.schemaVersion} is not supported by this build` }])
  }
  if (result.status === 'invalid') fail(result.errors)
  return result.pack
}

function tryBuild(source: unknown, clips: readonly ClipFile[]): BuildOutput {
  try {
    return buildPack(source, clips)
  } catch (err) {
    if (err instanceof BuildError) fail(err.errors)
    throw err
  }
}

function build(dir: string): void {
  const { source, clips } = readSourceDir(dir)
  const out = tryBuild(source, clips)
  writeArtifacts(dir, out)
  const corpus = loadCorpus([out.pack])
  const offered = new Set(offeredThemes(corpus).map((t) => t.themeId))
  console.log(
    `wrote ${out.packFile}: ${out.pack.entries.length} entries, ${out.pack.units.length} units, ${clips.length} clips, ${out.packBytes.byteLength} bytes`,
  )
  for (const t of corpus.themes) {
    const size = themeEntries(corpus, t.themeId).length
    console.log(`  ${t.themeId}: ${size} entries${offered.has(t.themeId) ? '' : ' (below the minimum, not offered)'}`)
  }
}

const [command, first, second] = process.argv.slice(2)
switch (command) {
  case 'build':
    if (!first) usage()
    build(first)
    break
  case 'validate':
    if (!first) usage()
    readPack(first)
    console.log('ok')
    break
  case 'check': {
    if (!first || !second) usage()
    const errors = checkPackSuccession(readPack(first), readPack(second))
    if (errors.length > 0) fail(errors)
    console.log('ok')
    break
  }
  default:
    usage()
}
```

- [ ] **Step 7: Run the whole suite**

Run: `pnpm test && pnpm typecheck`
Expected: all green in both packages. Then `pnpm --filter @wordado/pipeline corpus` prints the usage line and exits 2.

- [ ] **Step 8: Commit**

```bash
git add pnpm-workspace.yaml package.json pnpm-lock.yaml pipeline/package.json pipeline/tsconfig.json pipeline/vitest.config.ts pipeline/src
git commit -m "feat(pipeline): pack build, checksum and CLI

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: The A1 Bulgarian sample pack, with audio

**Files:**
- Create: `pipeline/samples/a1-bg/source.json`
- Create: `pipeline/scripts/say-audio.sh`
- Create (generated): `pipeline/samples/a1-bg/audio/*.m4a` (60 clips), `pipeline/samples/a1-bg/corpus-v0-bg.pack`, `pipeline/samples/a1-bg/manifest.json`
- Test: `pipeline/src/sample.test.ts`

**Interfaces:**
- Consumes: `buildPack`, `readSourceDir` (Task 6); `validatePack`, `loadCorpus`, `offeredThemes`, `themeEntries`, `pickDistractors`, `buildMatchingBoard`, `seededRng` from `@wordado/core`.
- Produces: the committed sample pack that plans 4–7 load, and the curated theme list.

The sample is `corpus-bg` at `corpus_version` 0: 60 A1 entries in three units of 20, tagged with the curated themes so that exactly one theme (`daily-life`) reaches the minimum size. The Bulgarian content is written by the plan author and has **not** had the native-speaker spot-check of spec §5.4; the sample is a fixture and demo, and the first real pack (plan 8) goes through that review. Every translation, primary or alternate, is distinct across the 60 entries so the demo's distractors are never ambiguous, and the sample test proves it.

- [ ] **Step 1: Write the source**

`pipeline/samples/a1-bg/source.json`:

```json
{
  "pack_id": "corpus-bg",
  "corpus_version": 0,
  "l1": "bg",
  "target": "en",
  "units": [
    {
      "unit_id": "a1-01",
      "level": "A1",
      "order": 1,
      "title": { "en": "People and greetings", "l1": "Хора и поздрави" },
      "entry_ids": [
        "hello-1", "goodbye-1", "please-1", "thank_you-1", "yes-1", "no-1", "sorry-1", "name-1", "friend-1", "family-1",
        "mother-1", "father-1", "brother-1", "sister-1", "child-1", "man-1", "woman-1", "boy-1", "girl-1", "teacher-1"
      ]
    },
    {
      "unit_id": "a1-02",
      "level": "A1",
      "order": 2,
      "title": { "en": "Food and drink", "l1": "Храна и напитки" },
      "entry_ids": [
        "food-1", "water-1", "bread-1", "milk-1", "coffee-1", "tea-1", "apple-1", "egg-1", "cheese-1", "meat-1",
        "fish-1", "rice-1", "sugar-1", "salt-1", "breakfast-1", "lunch-1", "dinner-1", "eat-1", "drink-1", "hungry-1"
      ]
    },
    {
      "unit_id": "a1-03",
      "level": "A1",
      "order": 3,
      "title": { "en": "Home and every day", "l1": "Домът и всеки ден" },
      "entry_ids": [
        "house-1", "home-1", "room-1", "door-1", "window-1", "bed-1", "table-1", "chair-1", "kitchen-1", "key-1",
        "day-1", "night-1", "morning-1", "today-1", "time-1", "week-1", "work-1", "school-1", "shop-1", "money-1"
      ]
    }
  ],
  "themes": [
    { "theme_id": "people", "name": { "en": "People and family", "l1": "Хора и семейство" }, "description": { "en": "Family members and the people around you.", "l1": "Членове на семейството и хората около теб." } },
    { "theme_id": "greetings", "name": { "en": "Greetings and politeness", "l1": "Поздрави и учтивост" }, "description": { "en": "Saying hello, thank you and sorry.", "l1": "Как да поздравиш, да благодариш и да се извиниш." } },
    { "theme_id": "food", "name": { "en": "Food and drink", "l1": "Храна и напитки" }, "description": { "en": "What you eat and drink every day.", "l1": "Какво ядеш и пиеш всеки ден." } },
    { "theme_id": "restaurant", "name": { "en": "Eating out", "l1": "В ресторанта" }, "description": { "en": "Ordering, paying and asking for the menu.", "l1": "Поръчване, плащане и менюто." } },
    { "theme_id": "home", "name": { "en": "At home", "l1": "У дома" }, "description": { "en": "Rooms, furniture and things around the house.", "l1": "Стаи, мебели и вещи в дома." } },
    { "theme_id": "daily-life", "name": { "en": "Daily life", "l1": "Всекидневие" }, "description": { "en": "Your day from morning to night.", "l1": "Денят ти от сутрин до вечер." } },
    { "theme_id": "time", "name": { "en": "Time and dates", "l1": "Време и дати" }, "description": { "en": "Days, weeks, hours and the calendar.", "l1": "Дни, седмици, часове и календарът." } },
    { "theme_id": "numbers", "name": { "en": "Numbers and amounts", "l1": "Числа и количества" }, "description": { "en": "Counting, prices and how much.", "l1": "Броене, цени и колко." } },
    { "theme_id": "travel", "name": { "en": "Travel and transport", "l1": "Пътуване и транспорт" }, "description": { "en": "Trips, tickets, trains and planes.", "l1": "Пътувания, билети, влакове и самолети." } },
    { "theme_id": "directions", "name": { "en": "Places and directions", "l1": "Места и посоки" }, "description": { "en": "Finding your way around town.", "l1": "Как да се ориентираш в града." } },
    { "theme_id": "shopping", "name": { "en": "Shopping and money", "l1": "Пазаруване и пари" }, "description": { "en": "Shops, prices and paying.", "l1": "Магазини, цени и плащане." } },
    { "theme_id": "work", "name": { "en": "Work and jobs", "l1": "Работа и професии" }, "description": { "en": "Jobs, the office and colleagues.", "l1": "Професии, офисът и колегите." } },
    { "theme_id": "school", "name": { "en": "School and study", "l1": "Училище и учене" }, "description": { "en": "Classes, learning and exams.", "l1": "Часове, учене и изпити." } },
    { "theme_id": "body", "name": { "en": "Body and health", "l1": "Тяло и здраве" }, "description": { "en": "Parts of the body and feeling well.", "l1": "Части на тялото и доброто самочувствие." } },
    { "theme_id": "doctor", "name": { "en": "At the doctor", "l1": "При лекаря" }, "description": { "en": "Symptoms, medicine and appointments.", "l1": "Симптоми, лекарства и прегледи." } },
    { "theme_id": "clothes", "name": { "en": "Clothes", "l1": "Дрехи" }, "description": { "en": "What you wear, and sizes.", "l1": "Какво носиш и размери." } },
    { "theme_id": "weather", "name": { "en": "Weather and nature", "l1": "Времето и природата" }, "description": { "en": "Sun, rain, seasons and the outdoors.", "l1": "Слънце, дъжд, сезони и природата." } },
    { "theme_id": "animals", "name": { "en": "Animals", "l1": "Животни" }, "description": { "en": "Pets, farm animals and wildlife.", "l1": "Домашни любимци, селскостопански и диви животни." } },
    { "theme_id": "colours", "name": { "en": "Colours and shapes", "l1": "Цветове и форми" }, "description": { "en": "Describing how things look.", "l1": "Как изглеждат нещата." } },
    { "theme_id": "feelings", "name": { "en": "Feelings and opinions", "l1": "Чувства и мнения" }, "description": { "en": "Saying how you feel and what you think.", "l1": "Как се чувстваш и какво мислиш." } },
    { "theme_id": "hobbies", "name": { "en": "Free time and sport", "l1": "Свободно време и спорт" }, "description": { "en": "Hobbies, games and going out.", "l1": "Хобита, игри и излизане." } },
    { "theme_id": "technology", "name": { "en": "Phones and computers", "l1": "Телефони и компютри" }, "description": { "en": "Devices, the internet and messages.", "l1": "Устройства, интернет и съобщения." } },
    { "theme_id": "city", "name": { "en": "Town and city", "l1": "Градът" }, "description": { "en": "Streets, buildings and public places.", "l1": "Улици, сгради и обществени места." } },
    { "theme_id": "actions", "name": { "en": "Everyday actions", "l1": "Всекидневни действия" }, "description": { "en": "Common verbs for what you do.", "l1": "Често използвани глаголи за това, което правиш." } }
  ],
  "entries": [
    { "entry_id": "hello-1", "headword": "hello", "variants": [], "pos": "intj", "sense": "", "ipa": "həˈləʊ", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "здравей", "alternates": ["здравейте"], "examples": ["Hello, my name is Anna."], "audio": { "uk": "hello-1-uk" }, "retired": false },
    { "entry_id": "goodbye-1", "headword": "goodbye", "variants": ["good-bye"], "pos": "intj", "sense": "", "ipa": "ˌɡʊdˈbaɪ", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "довиждане", "alternates": ["чао"], "examples": ["Goodbye! See you tomorrow."], "audio": { "uk": "goodbye-1-uk" }, "retired": false },
    { "entry_id": "please-1", "headword": "please", "variants": [], "pos": "adv", "sense": "", "ipa": "pliːz", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "моля", "alternates": [], "examples": ["A coffee, please."], "audio": { "uk": "please-1-uk" }, "retired": false },
    { "entry_id": "thank_you-1", "headword": "thank you", "variants": [], "pos": "phrase", "sense": "", "ipa": "ˈθæŋk juː", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "благодаря", "alternates": ["мерси"], "examples": ["Thank you for your help."], "audio": { "uk": "thank_you-1-uk" }, "retired": false },
    { "entry_id": "yes-1", "headword": "yes", "variants": [], "pos": "adv", "sense": "", "ipa": "jes", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "да", "alternates": [], "examples": ["Yes, I am from Sofia."], "audio": { "uk": "yes-1-uk" }, "retired": false },
    { "entry_id": "no-1", "headword": "no", "variants": [], "pos": "adv", "sense": "", "ipa": "nəʊ", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "не", "alternates": [], "examples": ["No, thank you."], "audio": { "uk": "no-1-uk" }, "retired": false },
    { "entry_id": "sorry-1", "headword": "sorry", "variants": [], "pos": "intj", "sense": "", "ipa": "ˈsɒri", "level": "A1", "unit_id": "a1-01", "themes": ["greetings"], "translation": "извинявай", "alternates": ["извинете", "съжалявам"], "examples": ["Sorry, I am late."], "audio": { "uk": "sorry-1-uk" }, "retired": false },
    { "entry_id": "name-1", "headword": "name", "variants": [], "pos": "noun", "sense": "", "ipa": "neɪm", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "име", "alternates": [], "examples": ["My name is Peter."], "audio": { "uk": "name-1-uk" }, "retired": false },
    { "entry_id": "friend-1", "headword": "friend", "variants": [], "pos": "noun", "sense": "", "ipa": "frend", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "приятел", "alternates": ["приятелка"], "examples": ["She is my best friend."], "audio": { "uk": "friend-1-uk" }, "retired": false },
    { "entry_id": "family-1", "headword": "family", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈfæməli", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "семейство", "alternates": [], "examples": ["I have a big family."], "audio": { "uk": "family-1-uk" }, "retired": false },
    { "entry_id": "mother-1", "headword": "mother", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈmʌðə", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "майка", "alternates": ["мама"], "examples": ["My mother is a doctor."], "audio": { "uk": "mother-1-uk" }, "retired": false },
    { "entry_id": "father-1", "headword": "father", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈfɑːðə", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "баща", "alternates": ["татко"], "examples": ["My father works in a bank."], "audio": { "uk": "father-1-uk" }, "retired": false },
    { "entry_id": "brother-1", "headword": "brother", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈbrʌðə", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "брат", "alternates": [], "examples": ["I have one brother."], "audio": { "uk": "brother-1-uk" }, "retired": false },
    { "entry_id": "sister-1", "headword": "sister", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈsɪstə", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "сестра", "alternates": [], "examples": ["My sister is ten years old."], "audio": { "uk": "sister-1-uk" }, "retired": false },
    { "entry_id": "child-1", "headword": "child", "variants": [], "pos": "noun", "sense": "", "ipa": "tʃaɪld", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "дете", "alternates": [], "examples": ["The child is playing."], "audio": { "uk": "child-1-uk" }, "retired": false },
    { "entry_id": "man-1", "headword": "man", "variants": [], "pos": "noun", "sense": "", "ipa": "mæn", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "мъж", "alternates": [], "examples": ["The man is reading a book."], "audio": { "uk": "man-1-uk" }, "retired": false },
    { "entry_id": "woman-1", "headword": "woman", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈwʊmən", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "жена", "alternates": [], "examples": ["The woman is my teacher."], "audio": { "uk": "woman-1-uk" }, "retired": false },
    { "entry_id": "boy-1", "headword": "boy", "variants": [], "pos": "noun", "sense": "", "ipa": "bɔɪ", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "момче", "alternates": [], "examples": ["The boy is six."], "audio": { "uk": "boy-1-uk" }, "retired": false },
    { "entry_id": "girl-1", "headword": "girl", "variants": [], "pos": "noun", "sense": "", "ipa": "ɡɜːl", "level": "A1", "unit_id": "a1-01", "themes": ["people"], "translation": "момиче", "alternates": [], "examples": ["The girl has a red bag."], "audio": { "uk": "girl-1-uk" }, "retired": false },
    { "entry_id": "teacher-1", "headword": "teacher", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈtiːtʃə", "level": "A1", "unit_id": "a1-01", "themes": ["people", "school"], "translation": "учител", "alternates": ["учителка"], "examples": ["Our teacher is very kind."], "audio": { "uk": "teacher-1-uk" }, "retired": false },
    { "entry_id": "food-1", "headword": "food", "variants": [], "pos": "noun", "sense": "", "ipa": "fuːd", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "храна", "alternates": [], "examples": ["I like Italian food."], "audio": { "uk": "food-1-uk" }, "retired": false },
    { "entry_id": "water-1", "headword": "water", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈwɔːtə", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "вода", "alternates": [], "examples": ["A glass of water, please."], "audio": { "uk": "water-1-uk" }, "retired": false },
    { "entry_id": "bread-1", "headword": "bread", "variants": [], "pos": "noun", "sense": "", "ipa": "bred", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "хляб", "alternates": [], "examples": ["We buy bread every morning."], "audio": { "uk": "bread-1-uk" }, "retired": false },
    { "entry_id": "milk-1", "headword": "milk", "variants": [], "pos": "noun", "sense": "", "ipa": "mɪlk", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "мляко", "alternates": [], "examples": ["The milk is in the fridge."], "audio": { "uk": "milk-1-uk" }, "retired": false },
    { "entry_id": "coffee-1", "headword": "coffee", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈkɒfi", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "кафе", "alternates": [], "examples": ["I drink coffee in the morning."], "audio": { "uk": "coffee-1-uk" }, "retired": false },
    { "entry_id": "tea-1", "headword": "tea", "variants": [], "pos": "noun", "sense": "", "ipa": "tiː", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "чай", "alternates": [], "examples": ["Do you want tea or coffee?"], "audio": { "uk": "tea-1-uk" }, "retired": false },
    { "entry_id": "apple-1", "headword": "apple", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈæpl", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "ябълка", "alternates": [], "examples": ["An apple a day is good for you."], "audio": { "uk": "apple-1-uk" }, "retired": false },
    { "entry_id": "egg-1", "headword": "egg", "variants": [], "pos": "noun", "sense": "", "ipa": "eɡ", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "яйце", "alternates": [], "examples": ["I eat an egg for breakfast."], "audio": { "uk": "egg-1-uk" }, "retired": false },
    { "entry_id": "cheese-1", "headword": "cheese", "variants": [], "pos": "noun", "sense": "", "ipa": "tʃiːz", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "сирене", "alternates": ["кашкавал"], "examples": ["This cheese is from Bulgaria."], "audio": { "uk": "cheese-1-uk" }, "retired": false },
    { "entry_id": "meat-1", "headword": "meat", "variants": [], "pos": "noun", "sense": "", "ipa": "miːt", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "месо", "alternates": [], "examples": ["He does not eat meat."], "audio": { "uk": "meat-1-uk" }, "retired": false },
    { "entry_id": "fish-1", "headword": "fish", "variants": [], "pos": "noun", "sense": "", "ipa": "fɪʃ", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "риба", "alternates": [], "examples": ["We have fish for dinner."], "audio": { "uk": "fish-1-uk" }, "retired": false },
    { "entry_id": "rice-1", "headword": "rice", "variants": [], "pos": "noun", "sense": "", "ipa": "raɪs", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "ориз", "alternates": [], "examples": ["Rice with vegetables, please."], "audio": { "uk": "rice-1-uk" }, "retired": false },
    { "entry_id": "sugar-1", "headword": "sugar", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈʃʊɡə", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "захар", "alternates": [], "examples": ["No sugar in my tea, thanks."], "audio": { "uk": "sugar-1-uk" }, "retired": false },
    { "entry_id": "salt-1", "headword": "salt", "variants": [], "pos": "noun", "sense": "", "ipa": "sɔːlt", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "сол", "alternates": [], "examples": ["Pass the salt, please."], "audio": { "uk": "salt-1-uk" }, "retired": false },
    { "entry_id": "breakfast-1", "headword": "breakfast", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈbrekfəst", "level": "A1", "unit_id": "a1-02", "themes": ["food", "daily-life"], "translation": "закуска", "alternates": [], "examples": ["Breakfast is at eight."], "audio": { "uk": "breakfast-1-uk" }, "retired": false },
    { "entry_id": "lunch-1", "headword": "lunch", "variants": [], "pos": "noun", "sense": "", "ipa": "lʌntʃ", "level": "A1", "unit_id": "a1-02", "themes": ["food", "daily-life"], "translation": "обяд", "alternates": [], "examples": ["We have lunch at work."], "audio": { "uk": "lunch-1-uk" }, "retired": false },
    { "entry_id": "dinner-1", "headword": "dinner", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈdɪnə", "level": "A1", "unit_id": "a1-02", "themes": ["food", "daily-life"], "translation": "вечеря", "alternates": [], "examples": ["Dinner is ready!"], "audio": { "uk": "dinner-1-uk" }, "retired": false },
    { "entry_id": "eat-1", "headword": "eat", "variants": [], "pos": "verb", "sense": "", "ipa": "iːt", "level": "A1", "unit_id": "a1-02", "themes": ["food", "daily-life", "actions"], "translation": "ям", "alternates": [], "examples": ["What do you want to eat?"], "audio": { "uk": "eat-1-uk" }, "retired": false },
    { "entry_id": "drink-1", "headword": "drink", "variants": [], "pos": "verb", "sense": "", "ipa": "drɪŋk", "level": "A1", "unit_id": "a1-02", "themes": ["food", "daily-life", "actions"], "translation": "пия", "alternates": [], "examples": ["Drink some water."], "audio": { "uk": "drink-1-uk" }, "retired": false },
    { "entry_id": "hungry-1", "headword": "hungry", "variants": [], "pos": "adj", "sense": "", "ipa": "ˈhʌŋɡri", "level": "A1", "unit_id": "a1-02", "themes": ["food"], "translation": "гладен", "alternates": ["гладна"], "examples": ["I am hungry."], "audio": { "uk": "hungry-1-uk" }, "retired": false },
    { "entry_id": "house-1", "headword": "house", "variants": [], "pos": "noun", "sense": "", "ipa": "haʊs", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "къща", "alternates": [], "examples": ["They live in a small house."], "audio": { "uk": "house-1-uk" }, "retired": false },
    { "entry_id": "home-1", "headword": "home", "variants": [], "pos": "noun", "sense": "", "ipa": "həʊm", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "дом", "alternates": [], "examples": ["I am at home now."], "audio": { "uk": "home-1-uk" }, "retired": false },
    { "entry_id": "room-1", "headword": "room", "variants": [], "pos": "noun", "sense": "", "ipa": "ruːm", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "стая", "alternates": [], "examples": ["My room is small."], "audio": { "uk": "room-1-uk" }, "retired": false },
    { "entry_id": "door-1", "headword": "door", "variants": [], "pos": "noun", "sense": "", "ipa": "dɔː", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "врата", "alternates": [], "examples": ["Please close the door."], "audio": { "uk": "door-1-uk" }, "retired": false },
    { "entry_id": "window-1", "headword": "window", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈwɪndəʊ", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "прозорец", "alternates": [], "examples": ["Open the window, please."], "audio": { "uk": "window-1-uk" }, "retired": false },
    { "entry_id": "bed-1", "headword": "bed", "variants": [], "pos": "noun", "sense": "", "ipa": "bed", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "легло", "alternates": [], "examples": ["The cat is on the bed."], "audio": { "uk": "bed-1-uk" }, "retired": false },
    { "entry_id": "table-1", "headword": "table", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈteɪbl", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "маса", "alternates": [], "examples": ["The book is on the table."], "audio": { "uk": "table-1-uk" }, "retired": false },
    { "entry_id": "chair-1", "headword": "chair", "variants": [], "pos": "noun", "sense": "", "ipa": "tʃeə", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "стол", "alternates": [], "examples": ["Sit on this chair."], "audio": { "uk": "chair-1-uk" }, "retired": false },
    { "entry_id": "kitchen-1", "headword": "kitchen", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈkɪtʃɪn", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "кухня", "alternates": [], "examples": ["Mum is in the kitchen."], "audio": { "uk": "kitchen-1-uk" }, "retired": false },
    { "entry_id": "key-1", "headword": "key", "variants": [], "pos": "noun", "sense": "", "ipa": "kiː", "level": "A1", "unit_id": "a1-03", "themes": ["home", "daily-life"], "translation": "ключ", "alternates": [], "examples": ["Where is my key?"], "audio": { "uk": "key-1-uk" }, "retired": false },
    { "entry_id": "day-1", "headword": "day", "variants": [], "pos": "noun", "sense": "", "ipa": "deɪ", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "ден", "alternates": [], "examples": ["Have a nice day!"], "audio": { "uk": "day-1-uk" }, "retired": false },
    { "entry_id": "night-1", "headword": "night", "variants": [], "pos": "noun", "sense": "", "ipa": "naɪt", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "нощ", "alternates": [], "examples": ["Good night!"], "audio": { "uk": "night-1-uk" }, "retired": false },
    { "entry_id": "morning-1", "headword": "morning", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈmɔːnɪŋ", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "сутрин", "alternates": ["утро"], "examples": ["I get up at seven in the morning."], "audio": { "uk": "morning-1-uk" }, "retired": false },
    { "entry_id": "today-1", "headword": "today", "variants": [], "pos": "adv", "sense": "", "ipa": "təˈdeɪ", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "днес", "alternates": [], "examples": ["Today is Monday."], "audio": { "uk": "today-1-uk" }, "retired": false },
    { "entry_id": "time-1", "headword": "time", "variants": [], "pos": "noun", "sense": "по часовник", "ipa": "taɪm", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "време", "alternates": ["час"], "examples": ["What time is it?"], "audio": { "uk": "time-1-uk" }, "retired": false },
    { "entry_id": "week-1", "headword": "week", "variants": [], "pos": "noun", "sense": "", "ipa": "wiːk", "level": "A1", "unit_id": "a1-03", "themes": ["time", "daily-life"], "translation": "седмица", "alternates": [], "examples": ["See you next week."], "audio": { "uk": "week-1-uk" }, "retired": false },
    { "entry_id": "work-1", "headword": "work", "variants": [], "pos": "noun", "sense": "", "ipa": "wɜːk", "level": "A1", "unit_id": "a1-03", "themes": ["work", "daily-life"], "translation": "работа", "alternates": [], "examples": ["I go to work by bus."], "audio": { "uk": "work-1-uk" }, "retired": false },
    { "entry_id": "school-1", "headword": "school", "variants": [], "pos": "noun", "sense": "", "ipa": "skuːl", "level": "A1", "unit_id": "a1-03", "themes": ["school", "daily-life"], "translation": "училище", "alternates": [], "examples": ["The children are at school."], "audio": { "uk": "school-1-uk" }, "retired": false },
    { "entry_id": "shop-1", "headword": "shop", "variants": [], "pos": "noun", "sense": "", "ipa": "ʃɒp", "level": "A1", "unit_id": "a1-03", "themes": ["shopping", "daily-life"], "translation": "магазин", "alternates": [], "examples": ["The shop opens at nine."], "audio": { "uk": "shop-1-uk" }, "retired": false },
    { "entry_id": "money-1", "headword": "money", "variants": [], "pos": "noun", "sense": "", "ipa": "ˈmʌni", "level": "A1", "unit_id": "a1-03", "themes": ["shopping", "daily-life"], "translation": "пари", "alternates": [], "examples": ["I have no money."], "audio": { "uk": "money-1-uk" }, "retired": false }
  ]
}
```

Theme sizes this gives: `daily-life` 25 (all of unit 3 plus `breakfast`, `lunch`, `dinner`, `eat`, `drink`), `food` 20, `people` 13, `home` 10, `greetings` 7, `time` 6, `actions` 2, `school` 2, `shopping` 2, `work` 1, the rest 0. Only `daily-life` is offered.

- [ ] **Step 2: Write the audio script and generate the clips**

`pipeline/scripts/say-audio.sh`:

```bash
#!/usr/bin/env bash
# One-off, macOS only. Placeholder clips for the sample pack from the system
# voice: below the quality bar of spec §5.4, replaced by plan 8's TTS. Skips
# clips that already exist, so it is safe to rerun after adding an entry.
set -euo pipefail
dir="$(cd "$(dirname "$0")/../samples/a1-bg" && pwd)"
mkdir -p "$dir/audio"
node --input-type=module -e '
import { readFileSync } from "node:fs"
const source = JSON.parse(readFileSync(process.argv[1], "utf8"))
for (const e of source.entries) if (e.audio.uk) console.log(`${e.audio.uk}\t${e.headword}`)
' "$dir/source.json" | while IFS=$'\t' read -r clip word; do
  out="$dir/audio/$clip.m4a"
  [ -f "$out" ] && continue
  say -v Daniel -o "$dir/audio/$clip.aiff" "$word"
  afconvert -f m4af -d aac -b 48000 "$dir/audio/$clip.aiff" "$out"
  rm "$dir/audio/$clip.aiff"
  echo "$clip"
done
```

Run:

```bash
chmod +x pipeline/scripts/say-audio.sh
pipeline/scripts/say-audio.sh
ls pipeline/samples/a1-bg/audio | wc -l
```

Expected: 60 files, each a few kilobytes. (`Daniel` is the en_GB system voice; `say -v '?' | grep en_GB` lists it. If it is missing, install it under System Settings → Accessibility → Spoken Content and rerun.)

- [ ] **Step 3: Build the pack**

Run: `pnpm sample-pack`
Expected output begins `wrote corpus-v0-bg.pack: 60 entries, 3 units, 60 clips, …` followed by 24 theme lines, of which only `daily-life: 25 entries` lacks the "(below the minimum, not offered)" suffix. `pipeline/samples/a1-bg/corpus-v0-bg.pack` and `manifest.json` now exist.

- [ ] **Step 4: Write the failing test**

`pipeline/src/sample.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildMatchingBoard,
  loadCorpus,
  offeredThemes,
  pickDistractors,
  seededRng,
  themeEntries,
  validatePack,
  type WordId,
} from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { buildPack } from './build'
import { readSourceDir } from './fs'

const DIR = fileURLToPath(new URL('../samples/a1-bg/', import.meta.url))
const { source, clips } = readSourceDir(DIR)
const built = buildPack(source, clips)
const corpus = loadCorpus([built.pack])
const pool = [...corpus.entries.values()]

describe('the A1 Bulgarian sample pack', () => {
  it('is committed byte for byte as the build produces it', () => {
    const committed = readFileSync(join(DIR, built.packFile))
    expect(committed.equals(Buffer.from(built.packBytes))).toBe(true)
    expect(JSON.parse(readFileSync(join(DIR, 'manifest.json'), 'utf8'))).toEqual(built.manifest)
  })

  it('validates from disk and is version 0 of the Bulgarian corpus pack', () => {
    const result = validatePack(JSON.parse(readFileSync(join(DIR, built.packFile), 'utf8')))
    expect(result.status).toBe('ok')
    expect(built.pack.pack_id).toBe('corpus-bg')
    expect(built.pack.corpus_version).toBe(0)
    expect(built.packFile).toBe('corpus-v0-bg.pack')
  })

  it('has 60 A1 entries in three units of 20, 24 themes and a UK clip for every entry', () => {
    expect(pool).toHaveLength(60)
    expect(corpus.units.map((u) => u.wordIds.length)).toEqual([20, 20, 20])
    expect(corpus.themes).toHaveLength(24)
    expect(corpus.clips.size).toBe(60)
    for (const e of pool) {
      expect(e.level).toBe('A1')
      expect(e.retired).toBe(false)
      expect(e.examples.length).toBeGreaterThan(0)
      expect(corpus.clips.has(e.audio.uk ?? '')).toBe(true)
    }
    for (const clip of corpus.clips.values()) expect(clip.bytes).toBeGreaterThan(1000)
  })

  it('offers exactly the themes that reach the minimum size', () => {
    expect(offeredThemes(corpus).map((t) => t.themeId)).toEqual(['daily-life'])
    expect(themeEntries(corpus, 'daily-life')).toHaveLength(25)
    expect(themeEntries(corpus, 'food')).toHaveLength(20)
  })

  it('has no two entries sharing a translation, so no demo distractor is ambiguous', () => {
    const seen = new Map<string, string>()
    for (const e of pool) {
      for (const t of e.translations) {
        expect(seen.get(t), `${t} in ${e.entryId} and ${seen.get(t)}`).toBeUndefined()
        seen.set(t, e.entryId)
      }
    }
  })

  it('gives every entry three distractors and fills a matching board', () => {
    const encountered = new Set<WordId>()
    for (const e of pool) {
      expect(pickDistractors(e, { pool, encountered, listening: false }, 3, seededRng(1))).toHaveLength(3)
      expect(pickDistractors(e, { pool, encountered, listening: true }, 3, seededRng(2))).toHaveLength(3)
    }
    expect(buildMatchingBoard(pool, 5, seededRng(3))).toHaveLength(5)
  })
})
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `sample.test.ts` has 6 passing tests. If the byte-for-byte test fails, the committed pack was not rebuilt after the last edit to `source.json`: run `pnpm sample-pack` and rerun.

- [ ] **Step 6: Check the succession rule against the sample**

The first real Bulgarian pack (plan 8) is checked against this file. Prove the CLI accepts a pack against itself only when the version rises:

```bash
cd pipeline
pnpm corpus validate samples/a1-bg/corpus-v0-bg.pack
pnpm corpus check samples/a1-bg/corpus-v0-bg.pack samples/a1-bg/corpus-v0-bg.pack; echo "exit $?"
cd ..
```

Expected: `ok`, then `corpus_version: must be greater than 0` and `exit 1`.

- [ ] **Step 7: Commit**

```bash
git add pipeline/samples/a1-bg pipeline/scripts/say-audio.sh pipeline/src/sample.test.ts
git commit -m "feat(pipeline): A1 Bulgarian sample pack with audio

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Contracts this plan hands to the later plans

- **Verify before you validate** (plan 4). `client-data` downloads a pack, checks `sha256` and `bytes` against the manifest's descriptor with Web Crypto, then calls `validatePack(JSON.parse(text), { supportedSchemaVersions: [PACK_SCHEMA_VERSION] })`. A `status` of `unsupported_schema` means keep the installed pack and show the update prompt; `invalid` means discard and retry later, never load. The manifest itself goes through `validateManifest` first.
- **URLs resolve against the manifest's URL** (plans 4, 6, 8): `new URL(descriptor.url, manifestUrl)` for packs, `new URL(clip.url, manifestUrl)` for audio. The bundled demo sample is served under one prefix with the same layout (`manifest.json`, `corpus-v0-bg.pack`, `audio/`), so the loader has one code path.
- **The installed-packs table** (plan 4) stores `pack_id`, `corpus_version`, `schema_version` and `sha256` per pack; `selectPacks` reads the first three. A fetched pack is swapped in at the start of the next session, never mid-session (spec §5.1).
- **`loadCorpus` feeds the rules** (plans 4, 6): `Corpus.units` and `Corpus.retired` are `PathContext.units` and `PathContext.retired`; `[...corpus.entries.values()]` is `DistractorContext.pool`; `themeEntries(corpus, activeThemeId)` mapped to word IDs is `SessionInput.collectionNew`; `offeredThemes(corpus)` is the theme picker's list; unit titles and theme names come from the pack in `en` and `l1`, never from the app's string tables.
- **Audio availability is per item** (plan 4): the cached-clips set intersected with `entryClips(corpus, entry)` decides whether `listening_select` is in the `available` set passed to `chooseMode` for that word. The prefetch horizon (spec §15) is plan 4's.
- **The demo sample is `corpus-bg` version 0** (plans 5, 6): demo events reference entry IDs that every later corpus version keeps, so carrying them into a new account needs no ID translation. Plan 6 bundles `pipeline/samples/a1-bg/` as static assets.
- **Plan 8 seeds its ID registry with the sample** and runs `corpus check <last published> <candidate>` before publishing, so `checkPackSuccession` is the gate that keeps every sample ID alive. Its multi-L1 manifest is composed from `buildPack`'s one-pack manifests at one `corpus_version`. When its TTS replaces the sample's clips, the clip IDs stay and only the checksums change, which is a new corpus version like any other.
- **The curated theme list lives in the pack** (plan 8): the 24 themes in the sample's `source.json` are the list; adding one is a data change with names in every L1. `MIN_THEME_SIZE` counts live entries across every level in the pack.
- **Parts of speech are the 11 tags in `PARTS_OF_SPEECH`** (plan 8): the banding step maps whatever the sources say onto them, and the validator rejects anything else.
- **The sample's Bulgarian has not been spot-checked by a native speaker** (spec §5.4). Plan 8's review pass covers version 1, which contains these entries.

Left for later plans: the user-word shape and the merge of a user word into a corpus entry (Phase 2, spec §8.2); the image field of §5.2 (Phase 2) and exam tags (Phase 3), which will be a schema bump when they arrive; R2 upload and the multi-L1 manifest (plan 8).
