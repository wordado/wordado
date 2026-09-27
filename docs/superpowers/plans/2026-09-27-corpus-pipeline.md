# Corpus Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A manually started pipeline turns cleared open frequency data into the Bulgarian A1–B1 corpus. Its steps are lemmas, English senses with CEFR banding, Bulgarian translations, units, native-speaker review queues, TTS audio with spot-listens, and triage of learners' error reports. It publishes each corpus version to R2 only when every gate has passed.

**Architecture:** The pipeline **code** lives in this public repository (`pipeline/`) and is tested on fixtures. The corpus **content** lives in a new private repository, `wordado/wordado-content`, cloned into `content/` and ignored here. That covers the licence register, frequency lists, LLM caches, the ID registry, review queues and decisions, audio, and the last published snapshot. `corpus init` scaffolds it from `pipeline/template/`. That includes its GitHub Actions workflow, which checks out this repository at a pinned commit and runs `corpus draft | audio | triage | release`. Each command reads the content directory and writes back into it. Every LLM and TTS result is cached in the content repository, so a rerun costs nothing and gives the same proposals. A reviewer's decision is an append-only event bound to the exact proposal it judged.

**Tech Stack:** TypeScript 7 on Node 24 (`tsx`), Vitest 5, OpenRouter (chat completions with `json_schema` structured output; `/api/v1/audio/speech` for TTS), ffmpeg/ffprobe (AAC in MP4, loudness and silence trim), `pg` for the read-only report pull, hyparquet for reading FineWeb's Parquet shards, GitHub Actions in the content repository, the AWS CLI against R2's S3 API.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`. This plan implements:
- §5.1: versioned, immutable packs, the stability rules and the manifest as a list.
- §5.2: entry contents, where one entry is one sense.
- §5.3: A1–B1 targets.
- §5.4: sourcing, banding, native-speaker review, examples, and audio to the quality bar.
- §8.10: report triage, the threshold and regenerating reported audio.
- §4.4: the manually started corpus workflow, with the manifest published last.
- §13: pipeline tests.
- §15: the legal gate on inputs, the TTS vendor and the report threshold.

Roadmap: `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, row 8.

## Global Constraints

- Node `>=24`, pnpm `12.4.2`, TypeScript 7 (`tsc -p`), Vitest 5, oxlint 1.85 (`pnpm lint`, `--deny-warnings`). Every package keeps `pnpm typecheck`, `pnpm lint` and `pnpm test` green. Work goes through a pull request (standing agreement since plan 7).
- **Every input to the pipeline needs a licence that permits commercial use without imposing share-alike on the resulting corpus** (§5.4). The Oxford 3000/5000 and the English Vocabulary Profile must not be copied (§5.4, R1). The pipeline refuses to read a source whose licence record is not cleared (Decision 3).
- **A given corpus version is immutable and byte-identical everywhere** (§5.1). Entry IDs and unit IDs are stable and never reused. A revised entry keeps its ID, and a retired entry stays in the pack flagged `retired`. `checkPackSuccession` from `core` is the gate.
- **An entry is one sense of a headword.** Identity is (headword, part of speech, sense). The pipeline splits a headword only where the L1 translations genuinely diverge (§5.2).
- **Native-speaker spot-check of banding and of every translation set; example sentences human-reviewed** (§5.4 steps 3–4).
- **Audio: a neural voice, a native-speaker spot-listen of a sample from every batch, and automatic re-generation of any clip reported** (§5.4 step 5, §8.10).
- **A clip whose bytes change needs a new clip ID**, because clips are cached for a day. Pack file names carry their version, because packs are cached as immutable (plan 7's contract).
- **Keep the sample's entry IDs live in the real corpus** (plan 7's contract): a demo carried into an account keeps answers on `c:hello-1` and the other sample words.
- **The manifest is published only after every file it names is uploaded** (§4.4).
- **LLM requests are sent with data collection denied** (§17.1: `provider.data_collection: "deny"`).
- **Linux runners only** (§17.1). The content repository is private: 2,000 Actions minutes a month (§17.2).
- `core` stays pure: no I/O. The pipeline may use Node APIs.
- Follow the existing code style: comments say why, cite the spec section, and read as prose. No placeholder copy.

## Decisions (made while writing this plan, 2026-09-27)

1. **Build now, gate the data** (the product owner, 2026-09-27). The legal review of the frequency lists has not cleared. The pipeline is built and tested on invented fixtures, and every real run waits until a source's licence record is cleared.
2. **Content lives in the private `wordado/wordado-content`**, cloned into `content/` and ignored here, as `docs/research/` is (the product owner, 2026-09-27). The code stays MIT and public. The reviewed corpus, its caches, its decisions and its history do not. Packs are public on the CDN in any case.
3. **The licence register.** `content/sources.json` lists each frequency list with its licence, whether it permits commercial use, whether it is share-alike, and who cleared it and when. `readClearedSources` refuses the whole run if any listed source is uncleared, non-commercial or share-alike, and names each offending source. A cleared source that needs attribution is recorded in `release.json` (`attributions`), so the app's about page can show it (handover).
4. **Review queues are CSV files in the content repository** (the product owner, 2026-09-27), with a JSON sidecar holding the proposals. The reviewer edits cells in place and writes `ok`, `drop` or `redo` in the `verdict` column. `corpus import --by <name>` turns each row into an append-only decision event. The files open in Excel, Numbers or Google Sheets: UTF-8 with a BOM and CRLF line ends.
5. **A decision is bound to the proposal it judged** (`foldField`). `ok` or `fix` applies only while the proposal is unchanged. If a prompt version is bumped and the LLM proposes something new, the old decision becomes stale and the item is queued again. A report crossing the threshold appends `reopen`, which queues the item with its current value.
6. **Queues.** `english` covers every live entry's IPA, variants and examples. `translation-<l1>` covers every live entry's translation set and sense gloss. `level` covers entries whose LLM level was clamped by the frequency band, plus a deterministic 1-in-20 sample. `title-<l1>` covers unit titles. `audio` covers the spot-listen sample of each batch, plus every regenerated clip.
7. **CEFR banding** (§5.4 step 2). A lemma's frequency band comes from its rank against the cumulative level targets (A1 ≤ 600, A2 ≤ 1,600, B1 ≤ 3,100, B2 ≤ 5,100, C1 ≤ 7,100). The LLM judges each sense's level from the CEFR descriptors alone. It is never asked for, or given, a published list's level. The result is the LLM's level clamped to within one band of the frequency band. A clamped sense is flagged for banding review. The LLM's `C2` means out of scope, and the sense is dropped.
8. **Sense splitting.** The senses stage proposes up to four senses per headword. After translation, two senses of the same headword and part of speech merge when their primary translations agree in every configured L1 (§5.2: split only where the L1 translations diverge). An entry's L1 `sense` gloss ships only when its headword and part of speech have more than one live entry.
9. **Stability rules the pipeline adds** (§5.1). An entry that was live in the last published pack stays live unless a reviewer drops it. An entry keeps its unit, and so its level, unless a banding decision moves it. The sample's 60 entries are `pinned` in the registry, and the gate refuses a release in which one is not live. An entry dropped after publication is carried as `retired` with its last published fields.
10. **IDs.** Entry IDs are `<slug>-<n>`, as in the sample (`thank_you-1`). The slug is the lowercase headword without diacritics, with spaces as `_` and any other character removed. `n` is one more than the highest used for that slug, so no ID is ever reused. A new sense matches a registry entry by exact (headword, POS, English gloss). Failing that, it matches when both sides have exactly one sense for that headword and POS. Unit IDs are `<level>-<nn>` (`a1-04`), and new units append after a level's existing ones. Path `order` is renumbered by level, then unit number. Clip IDs are `<entry_id>-<accent>-<generation>` (`hello-1-uk-1`), so a regenerated clip is always a new ID and never collides with the sample's `hello-1-uk`.
11. **TTS is OpenRouter's `/api/v1/audio/speech`** (the product owner, 2026-09-27; §15's vendor item). It returns MP3, which ffmpeg trims of leading and trailing silence, normalises (EBU R128, −16 LUFS) and encodes as mono AAC in MP4 at 48 kbit/s (the sample's format, `audio/mp4`). A clip must last between 0.15 s and 3 s, or it is made again, up to three tries. The model, voice and instructions for each accent sit in `pipeline.json`. Changing them changes the `voice_key` and regenerates every clip. The UK accent is required, and US is optional ("where sensible", §5.2). OpenRouter's speech endpoint does not document the `provider.data_collection` field, so the operator denies data collection in the account's privacy settings (runbook). Its input is English headwords only.
12. **Spot-listen sample.** In each batch, max(5, ⌈10%⌉) clips are picked by a hash of the batch and clip ID. Every clip made because of a `redo` or a report is also queued. A batch passes when every queued clip in it has a verdict. A `redo` makes a new generation in the next batch, which is listened to in turn.
13. **Report triage** (§8.10; §15's threshold resolved: **2**). `corpus triage` reads `content_report` through a read-only Postgres role (`REPORTS_DATABASE_URL`), groups the reports by entry and field, and counts distinct reporters since the field last changed. Reporters are hashed before anything is written, and a deleted account counts once per report. At the threshold it appends `reopen` to the field's queue. `translation` and `other` go to `translation-<l1>`, `example` to `english` and `level` to `level`. A single `audio` report appends `redo` to the entry's current clip. Reports carry no L1, so a translation report reopens every configured L1's queue. With Bulgarian alone that is exact (handover).
14. **Release.** `corpus release <content> <out>` builds a pack for each configured L1 at `corpus_version` = last published + 1, with one manifest listing them all. It also writes `fixes.json` (every entry field that changed, by version, cumulative, for plan 8b's "your report was fixed") and `release.json` (`draft`, attributions). It refuses unless every gate passes. `--draft` skips only the review gates and marks the output a draft, and `corpus publishable` refuses a draft. The previous version is `content/last-published/`, seeded with the sample (v0). The workflow first checks that the live manifest is that snapshot, then publishes, then commits the new snapshot.
15. **The content repository runs the workflow; this repository's `publish-content.yml` is removed.** One publish path means the sample can never be republished over the real corpus. The public repository's Actions logs are public, and the content repository's are not.
16. **"Your report was fixed" is plan 8b** (the product owner, 2026-09-27). This plan publishes `fixes.json`; 8b shows it in the app.
17. **A1–B1 first** (the product owner, 2026-09-27; spec §14). B2 and C1 come in a later corpus version of the same pack. That version changes `pipeline.json` only: `levels` gains B2 and C1, and `max_forms` and `max_lemmas` rise enough to cover about 7,100 entries. Its B2 and C1 units follow the B1 units, and every existing ID, unit and learner's progress stays as it is.
18. **LLM defaults.** Model `anthropic/claude-sonnet-5` (the operator confirms the slug on openrouter.ai/models before the first run), temperature 0.2, `provider: { require_parameters: true, data_collection: "deny" }`, and a spend ceiling per run (`llm.max_usd_per_run`, from `usage.cost`). Cache keys are (stage, prompt version, input), not the model: changing the model does not throw away reviewed proposals, and bumping a prompt version does.
19. **Frequency sources, from the pilot** (the product owner, 2026-09-27; `docs/research/2026-09-27-frequency-pilot/report.md` in the research repository). The pilot compared four sources that allow commercial use. Our own count of **FineWeb** (ODC-By 1.0) was the strongest, and **FineWeb merged with Google Books GB 2000–2019** (CC BY 3.0) the most balanced. Project Gutenberg ranks the language of old novels, and Wikipedia has almost no dialogue. `corpus count-text` counts FineWeb's Parquet shards and `corpus sum-gbooks` adds up Google Books' yearly counts. Each writes a `sources/*.tsv` for the licence register, so the legal review still gates them. Every source ranks conversational words low (*hello* about 4,400th, *goodbye* about 7,400th), and no free subtitle list is licensed for us. So `essentials.txt`, a curated in-house list of about 230 everyday words, is always described. Its senses take the LLM's level rather than the frequency band, count toward the level targets, and all go to banding review. The senses stage also returns a headword's capitals (*I, Monday, TV*), which the lowercased lists lose.

## Review Focus

1. **A reviewer's spreadsheet round-trip**: Excel or Sheets re-saves the CSV with a BOM or without one, with CRLF or LF, with quoted cells holding commas, quotes and line breaks, or with the verdict in capitals. Import must read every row exactly and apply nothing it cannot match to a proposal. Task 1 (`csv.test.ts`) and Task 12 (`queues.test.ts`: "reads a file re-saved by a spreadsheet", "rejects an unknown verdict and applies nothing from that row").
2. **A rerun after a crash or a budget stop**: paid LLM and TTS results are never paid for twice, and a half-finished run leaves the content directory usable. Task 4 (`cache.test.ts`: "keeps each result the moment it arrives"; `llm.test.ts`: "stops before a call that would exceed the budget") and Task 13 (`audio.test.ts`: "a failed clip leaves the others written and recorded").
3. **A release that would break learners' state**: a sample ID not live, an entry removed instead of retired, a unit emptied, a corpus version that does not rise, or a live manifest that is not the snapshot the release was built on. Nothing is written or published. Task 14 (`release.test.ts`) and Task 16 (`live.test.ts`). A pinned entry that is not live: Task 11 (`draft.test.ts`).
4. **A frequency list whose licence is not cleared**, or is share-alike or non-commercial, or is listed but missing: the run stops before reading any source and names each problem. Task 2 (`sources.test.ts`).
5. **An LLM response that is malformed, truncated, missing an item, or answers a different item than asked**: it is retried, never silently shifted onto the wrong word. Task 4 (`llm.test.ts`) and Tasks 5, 6, 8 and 10 (each stage's "rejects a response that answers other items than it was asked").

---

## File Structure

**Pipeline (`pipeline/`)**, all new unless marked:
- `src/csv.ts` (+ test): RFC 4180 CSV for the review queues (Task 1).
- `src/files.ts` (+ test): JSON and JSONL reading and writing with stable formatting (Task 1).
- `src/config.ts` (+ test): `pipeline.json` and `themes.json`, validated (Task 2).
- `src/content.ts`: every path inside a content directory (Task 2).
- `src/sources.ts` (+ test): the licence register and its gate (Task 2).
- `src/frequency.ts` (+ test): frequency lists → ranked word forms (Task 3).
- `src/mapLimit.ts`, `src/llm.ts`, `src/cache.ts` (+ tests): bounded concurrency, the `Llm` port and OpenRouter, the JSONL stage cache (Task 4).
- `src/stages/lemmas.ts` (+ test): forms → lemmas (Task 5).
- `src/stages/senses.ts` (+ test): lemmas → English senses; frequency bands (Task 6).
- `src/registry.ts` (+ test): entry IDs and matching (Task 7).
- `src/stages/translate.ts`, `src/select.ts` (+ tests): L1 translations, sense merging, live selection (Task 8).
- `src/decisions.ts` (+ test): decision events and `foldField` (Task 9).
- `src/units.ts`, `src/stages/titles.ts` (+ tests): units and their titles (Task 10).
- `src/lastPublished.ts`, `src/init.ts`, `src/draft.ts` (+ tests), `src/testing/fixture.ts`, `template/` (without its workflow): the content directory and the `draft` command (Task 11).
- `src/queues.ts` (+ test): queue export and import (Task 12).
- `src/tts.ts`, `src/encoder.ts`, `src/audio.ts` (+ tests): speech, encoding, clips and batches (Task 13).
- `src/assemble.ts`, `src/fixes.ts`, `src/release.ts` (+ tests); `src/publishable.ts` (modify, + test): packs per L1, the gates, the release directory; refuse a draft (Task 14).
- `src/reports.ts` (+ test); `package.json` (modify: `pg`, `@types/pg`): pull and triage (Task 15).
- `src/live.ts` (+ test), `src/cli.ts` (modify), `src/cli.test.ts`, `src/e2e.test.ts`: the commands and the whole pipeline (Task 16).
- `src/prepare.ts` (+ test), `src/cli.ts` (modify), `package.json` (modify: `hyparquet`, `hyparquet-writer`): frequency lists from FineWeb and Google Books (Task 17).
- `template/.github/workflows/corpus.yml`, `README.md`: the content repository's workflow and the runbook (Task 18).

**Core (`core/`)**: `src/index.ts` (modify): export `norm` (Task 3).

**Repository** (Task 18)
- `.gitignore`: `content/`.
- `.github/workflows/ci.yml` (modify): ffmpeg for the pipeline suite; actionlint over the template workflow.
- `.github/workflows/publish-content.yml` (delete).
- `docs/deploy.md`, `docs/development.md`, `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, `README.md` (modify).

### Content directory (`content/`, the private repository)

```
content/
  README.md               terms (all rights reserved) and the reviewer's guide
  pipeline.json           configuration (Task 2)
  sources.json            the licence register (Task 2)
  sources/*.tsv           frequency lists, "form<TAB>count" per line
  themes.json             the curated themes with names in English and every L1
  registry.json           entry IDs and units: grows, never shrinks
  cache/<stage>.jsonl     LLM results, one line per item
  work/draft.json         the last draft (ignored; `corpus draft --offline` rebuilds it)
  review/<queue>/*.csv    open review files, each with a .json sidecar
  decisions/<queue>.jsonl append-only decision events
  audio/<clip>.m4a        every clip ever made
  audio.jsonl             one record per clip, appended as each is made
  last-published/         manifest.json, its packs and fixes.json as last published
  .github/workflows/corpus.yml
```

---

### Task 1: CSV and JSON files

The queues are spreadsheets a reviewer opens in Excel or Google Sheets, so the CSV reader must accept what those write back. JSON and JSONL files are written with stable formatting, so diffs in the content repository show only real changes.

**Files:**
- Create: `pipeline/src/csv.ts`, `pipeline/src/csv.test.ts`, `pipeline/src/files.ts`, `pipeline/src/files.test.ts`

**Interfaces:**
- Produces: `parseCsv(text: string): string[][]`; `formatCsv(rows: readonly (readonly string[])[]): string`; `csvRecords(text: string): { header: string[]; rows: Record<string, string>[] }`. `readJson<T>(file: string): T`; `readJsonOr<T>(file: string, fallback: T): T`; `writeJson(file: string, value: unknown): void` (creates parent directories, two-space indent, trailing newline); `readJsonl<T>(file: string): T[]` (missing file → `[]`); `appendJsonl(file: string, items: readonly unknown[]): void`.

- [ ] **Step 1: Write the failing tests**

`pipeline/src/csv.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { csvRecords, formatCsv, parseCsv } from './csv'

describe('parseCsv', () => {
  it('reads quoted cells holding commas, quotes and line breaks', () => {
    expect(parseCsv('a,"b, c","say ""hi""","two\nlines"\n')).toEqual([['a', 'b, c', 'say "hi"', 'two\nlines']])
  })

  it('reads what a spreadsheet writes back: a BOM, CRLF, and no final newline', () => {
    expect(parseCsv('﻿key,verdict\r\nhello-1,OK\r\nwater-1,')).toEqual([
      ['key', 'verdict'],
      ['hello-1', 'OK'],
      ['water-1', ''],
    ])
  })

  it('keeps empty cells and drops blank lines', () => {
    expect(parseCsv('a,,c\n\n,b,\n')).toEqual([['a', '', 'c'], ['', 'b', '']])
  })

  it('refuses an unterminated quote rather than guessing', () => {
    expect(() => parseCsv('a,"b\n')).toThrow(/unterminated/)
  })
})

describe('formatCsv', () => {
  it('writes a BOM and CRLF, and quotes only the cells that need it', () => {
    expect(formatCsv([['key', 'note'], ['a', 'x, "y"']])).toBe('﻿key,note\r\na,"x, ""y"""\r\n')
  })

  it('round-trips through parseCsv', () => {
    const rows = [['к', 'здравей | здравейте'], ['line\nbreak', '"q"']]
    expect(parseCsv(formatCsv(rows))).toEqual(rows)
  })
})

describe('csvRecords', () => {
  it('keys each row by the header, trimming header names', () => {
    expect(csvRecords('key , verdict\nhello-1,ok\n')).toEqual({ header: ['key', 'verdict'], rows: [{ key: 'hello-1', verdict: 'ok' }] })
  })

  it('fills cells a spreadsheet dropped from the end of a row', () => {
    expect(csvRecords('key,verdict,note\nhello-1\n').rows).toEqual([{ key: 'hello-1', verdict: '', note: '' }])
  })
})
```

`pipeline/src/files.test.ts`:

```ts
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { appendJsonl, readJsonl, readJsonOr, writeJson } from './files'

const dir = () => mkdtempSync(join(tmpdir(), 'files-'))

describe('files', () => {
  it('writes JSON with a trailing newline, creating directories', () => {
    const file = join(dir(), 'a', 'b.json')
    writeJson(file, { x: 1 })
    expect(readFileSync(file, 'utf8')).toBe('{\n  "x": 1\n}\n')
  })

  it('reads a fallback for a missing JSON file', () => {
    expect(readJsonOr(join(dir(), 'none.json'), [])).toEqual([])
  })

  it('appends JSONL lines and reads them back; a missing file is empty', () => {
    const file = join(dir(), 'c', 'd.jsonl')
    expect(readJsonl(file)).toEqual([])
    appendJsonl(file, [{ a: 1 }])
    appendJsonl(file, [{ a: 2 }, { a: 'з' }])
    expect(readJsonl(file)).toEqual([{ a: 1 }, { a: 2 }, { a: 'з' }])
  })

  it('names the file and line of a broken JSONL line', () => {
    const file = join(dir(), 'e.jsonl')
    appendJsonl(file, [{ a: 1 }])
    appendFileSync(file, '{broken\n')
    expect(() => readJsonl(file)).toThrow(/e\.jsonl:2/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- csv files`
Expected: FAIL, "Failed to resolve import './csv'" and "./files".

- [ ] **Step 3: Implement**

`pipeline/src/csv.ts`:

```ts
/**
 * RFC 4180 CSV for the review queues (Decision 4). What we write opens
 * correctly in Excel (a UTF-8 BOM, CRLF); what we read is whatever a
 * spreadsheet writes back: with or without the BOM, CRLF or LF, a missing
 * final newline, and trailing empty cells dropped.
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    cell = ''
  }
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
      } else cell += ch
      i += 1
      continue
    }
    if (ch === '"' && cell === '') quoted = true
    else if (ch === ',') {
      row.push(cell)
      cell = ''
    } else if (ch === '\r' && src[i + 1] === '\n') {
      endRow()
      i += 1
    } else if (ch === '\n' || ch === '\r') endRow()
    else cell += ch
    i += 1
  }
  if (quoted) throw new Error('CSV has an unterminated quoted cell')
  if (cell !== '' || row.length > 0) endRow()
  return rows
}

const needsQuotes = /[",\r\n]/

export function formatCsv(rows: readonly (readonly string[])[]): string {
  const line = (cells: readonly string[]) =>
    cells.map((c) => (needsQuotes.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')
  return `﻿${rows.map(line).join('\r\n')}\r\n`
}

export function csvRecords(text: string): { header: string[]; rows: Record<string, string>[] } {
  const [head, ...body] = parseCsv(text)
  const header = (head ?? []).map((h) => h.trim())
  const rows = body.map((cells) => Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ''])))
  return { header, rows }
}
```

`pipeline/src/files.ts`:

```ts
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname } from 'node:path'

/** Content-repository files are diffed by people, so every write is stable: two-space JSON, one trailing newline. */
export function readJson<T>(file: string): T {
  return JSON.parse(readFileSync(file, 'utf8')) as T
}

export function readJsonOr<T>(file: string, fallback: T): T {
  return existsSync(file) ? readJson<T>(file) : fallback
}

export function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function readJsonl<T>(file: string): T[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .flatMap((line, i) => {
      if (line.trim() === '') return []
      try {
        return [JSON.parse(line) as T]
      } catch {
        throw new Error(`${basename(file)}:${i + 1}: not JSON`)
      }
    })
}

/** One line per item, appended at once: a crash never loses a line already written (Review Focus 2). */
export function appendJsonl(file: string, items: readonly unknown[]): void {
  if (items.length === 0) return
  mkdirSync(dirname(file), { recursive: true })
  appendFileSync(file, items.map((item) => `${JSON.stringify(item)}\n`).join(''))
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- csv files`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/csv.ts pipeline/src/csv.test.ts pipeline/src/files.ts pipeline/src/files.test.ts
git commit -m "feat(pipeline): CSV for the review queues and stable JSON files"
```

---

### Task 2: Configuration, content paths and the licence gate

**Files:**
- Create: `pipeline/src/config.ts`, `pipeline/src/config.test.ts`, `pipeline/src/content.ts`, `pipeline/src/sources.ts`, `pipeline/src/sources.test.ts`

**Interfaces:**
- Consumes: `CEFR_LEVELS`, `CefrLevel`, `Accent` (`@wordado/core`); `readJson`, `readJsonOr` (Task 1).
- Produces:
  - `interface TtsVoice { readonly voice: string; readonly instructions: string; readonly provider_options?: Readonly<Record<string, unknown>> }`
  - `interface PipelineConfig { readonly l1s: readonly string[]; readonly levels: readonly CefrLevel[]; readonly targets: Readonly<Record<CefrLevel, number>>; readonly max_forms: number; readonly max_lemmas: number; readonly unit_size: number; readonly report_threshold: number; readonly llm: { readonly model: string; readonly concurrency: number; readonly max_usd_per_run: number }; readonly tts: { readonly model: string; readonly accents: Readonly<Partial<Record<Accent, TtsVoice>>>; readonly max_clips_per_run: number } }`
  - `interface CuratedTheme { readonly theme_id: string; readonly name: Readonly<Record<string, string>>; readonly description: Readonly<Record<string, string>> }`: names keyed by `en` and each L1.
  - `configProblems(raw: unknown): string[]`; `readConfig(dir: string): PipelineConfig` (throws `ConfigError` listing problems); `themeProblems(raw: unknown, l1s: readonly string[]): string[]`; `readThemes(dir: string, l1s: readonly string[]): CuratedTheme[]`.
  - `contentPaths(dir: string)` returns `{ root, config, sources, sourcesDir, themes, registry, cacheDir, cache(stage), draft, reviewDir, queueDir(queue), decisionsDir, decisions(queue), audioDir, clip(clipId), audioRecords, lastPublished, essentials }`.
  - `interface SourceRecord { readonly id: string; readonly file: string; readonly title: string; readonly url: string; readonly licence: string; readonly commercial_use: boolean; readonly share_alike: boolean; readonly attribution: string; readonly cleared_by: string; readonly cleared_on: string; readonly notes: string }`
  - `licenceProblems(record: SourceRecord): string[]`; `class LicenceError extends Error { readonly problems: readonly string[] }`; `readClearedSources(dir: string): { record: SourceRecord; text: string }[]`.

- [ ] **Step 1: Write the failing tests**

`pipeline/src/config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { configProblems, themeProblems } from './config'

export const validConfig = {
  l1s: ['bg'],
  levels: ['A1', 'A2', 'B1'],
  targets: { A1: 600, A2: 1000, B1: 1500, B2: 2000, C1: 2000 },
  max_forms: 12000,
  max_lemmas: 5000,
  unit_size: 20,
  report_threshold: 2,
  llm: { model: 'anthropic/claude-sonnet-5', concurrency: 4, max_usd_per_run: 40 },
  tts: {
    model: 'openai/gpt-4o-mini-tts-2025-12-15',
    accents: { uk: { voice: 'alloy', instructions: 'A neutral British accent.' } },
    max_clips_per_run: 4000,
  },
}

describe('configProblems', () => {
  it('accepts the template configuration', () => {
    expect(configProblems(validConfig)).toEqual([])
  })

  it('names every problem at once', () => {
    expect(
      configProblems({ ...validConfig, l1s: ['BG'], levels: ['A1', 'Z9'], unit_size: 0, llm: { ...validConfig.llm, model: '' } }),
    ).toEqual([
      'l1s[0]: must be a two-letter lowercase language code',
      'levels[1]: must be one of A1, A2, B1, B2, C1',
      'unit_size: must be a positive integer',
      'llm.model: must be a non-empty string',
    ])
  })

  it('needs a UK voice, the one accent every entry carries', () => {
    expect(configProblems({ ...validConfig, tts: { ...validConfig.tts, accents: {} } })).toEqual(['tts.accents.uk: required'])
  })

  it('refuses levels out of path order, which would make units go backwards', () => {
    expect(configProblems({ ...validConfig, levels: ['A2', 'A1'] })).toEqual(['levels: must be in CEFR order without repeats'])
  })
})

describe('themeProblems', () => {
  const theme = { theme_id: 'food', name: { en: 'Food', bg: 'Храна' }, description: { en: 'Food.', bg: 'Храна.' } }

  it('accepts a theme named in English and every L1', () => {
    expect(themeProblems([theme], ['bg'])).toEqual([])
  })

  it('names a theme missing an L1 name or repeated', () => {
    expect(themeProblems([theme, { ...theme, name: { en: 'Food' } }], ['bg'])).toEqual([
      'themes[1].theme_id: food appears twice',
      'themes[1].name.bg: required',
    ])
  })
})
```

`pipeline/src/sources.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LicenceError, licenceProblems, readClearedSources, type SourceRecord } from './sources'

const cleared: SourceRecord = {
  id: 'invented',
  file: 'invented.tsv',
  title: 'Invented list',
  url: 'https://example.invalid',
  licence: 'CC0-1.0',
  commercial_use: true,
  share_alike: false,
  attribution: '',
  cleared_by: 'Legal review',
  cleared_on: '2026-10-01',
  notes: '',
}

function content(records: unknown[], files: Record<string, string> = { 'invented.tsv': 'water\t10\n' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'sources-'))
  writeFileSync(join(dir, 'sources.json'), JSON.stringify(records))
  mkdirSync(join(dir, 'sources'))
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, 'sources', name), text)
  return dir
}

describe('licenceProblems (spec §5.4, §15)', () => {
  it('passes a cleared, commercial, non-share-alike source', () => {
    expect(licenceProblems(cleared)).toEqual([])
  })

  it('refuses share-alike, non-commercial and uncleared sources, each by name', () => {
    expect(licenceProblems({ ...cleared, share_alike: true, commercial_use: false, cleared_by: '', cleared_on: '' })).toEqual([
      'invented: does not permit commercial use',
      'invented: is share-alike, which would bind the corpus',
      'invented: not cleared by the legal review (cleared_by and cleared_on are empty)',
    ])
  })

  it('refuses a clearance date that is not a date', () => {
    expect(licenceProblems({ ...cleared, cleared_on: 'soon' })).toEqual(['invented: cleared_on must be YYYY-MM-DD'])
  })
})

describe('readClearedSources', () => {
  it('reads every source when all are cleared', () => {
    expect(readClearedSources(content([cleared])).map((s) => s.text)).toEqual(['water\t10\n'])
  })

  it('reads nothing when any one source is not cleared, and names it', () => {
    const dir = content([cleared, { ...cleared, id: 'other', file: 'other.tsv', cleared_by: '' }], {
      'invented.tsv': 'water\t10\n',
      'other.tsv': 'bread\t5\n',
    })
    expect(() => readClearedSources(dir)).toThrow(LicenceError)
    expect(() => readClearedSources(dir)).toThrow(/other: not cleared/)
  })

  it('refuses an empty register: there is nothing to build from', () => {
    expect(() => readClearedSources(content([]))).toThrow(/no sources/)
  })

  it('names a listed file that is missing, and a file path that leaves sources/', () => {
    const dir = content([{ ...cleared, file: 'gone.tsv' }, { ...cleared, id: 'escape', file: '../x.tsv' }])
    expect(() => readClearedSources(dir)).toThrow(/invented: sources\/gone\.tsv is missing[\s\S]*escape: file must be a name inside sources\//)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- config sources`
Expected: FAIL, "Failed to resolve import './config'" and "./sources".

- [ ] **Step 3: Implement**

`pipeline/src/content.ts`:

```ts
import { join } from 'node:path'

/** Where everything lives inside a content directory, the private wordado-content repository (Decision 2). */
export function contentPaths(dir: string) {
  return {
    root: dir,
    config: join(dir, 'pipeline.json'),
    sources: join(dir, 'sources.json'),
    sourcesDir: join(dir, 'sources'),
    themes: join(dir, 'themes.json'),
    registry: join(dir, 'registry.json'),
    cacheDir: join(dir, 'cache'),
    cache: (stage: string) => join(dir, 'cache', `${stage}.jsonl`),
    draft: join(dir, 'work', 'draft.json'),
    reviewDir: join(dir, 'review'),
    queueDir: (queue: string) => join(dir, 'review', queue),
    decisionsDir: join(dir, 'decisions'),
    decisions: (queue: string) => join(dir, 'decisions', `${queue}.jsonl`),
    audioDir: join(dir, 'audio'),
    clip: (clipId: string) => join(dir, 'audio', `${clipId}.m4a`),
    audioRecords: join(dir, 'audio.jsonl'),
    lastPublished: join(dir, 'last-published'),
    essentials: join(dir, 'essentials.txt'),
  }
}

export type ContentPaths = ReturnType<typeof contentPaths>
```

`pipeline/src/config.ts`:

```ts
import { CEFR_LEVELS, type Accent, type CefrLevel } from '@wordado/core'
import { readJson } from './files'
import { contentPaths } from './content'

export interface TtsVoice {
  readonly voice: string
  /** How to say it: accent and pace. OpenAI-style models take it as `instructions`. */
  readonly instructions: string
  /** Passed through as the request's `provider.options` (OpenRouter's per-provider settings). */
  readonly provider_options?: Readonly<Record<string, unknown>>
}

/** `pipeline.json`: everything a run may tune without a code change. */
export interface PipelineConfig {
  readonly l1s: readonly string[]
  /** The levels this corpus ships (spec §14: A1–B1 for Phase 1a). */
  readonly levels: readonly CefrLevel[]
  /** Entries per level (spec §5.3); every level has one, for the frequency bands (Decision 7). */
  readonly targets: Readonly<Record<CefrLevel, number>>
  readonly max_forms: number
  readonly max_lemmas: number
  /** About 20 words per unit (spec §7.2). */
  readonly unit_size: number
  /** Independent reports that send a field to review (spec §8.10, §15). */
  readonly report_threshold: number
  readonly llm: { readonly model: string; readonly concurrency: number; readonly max_usd_per_run: number }
  readonly tts: {
    readonly model: string
    readonly accents: Readonly<Partial<Record<Accent, TtsVoice>>>
    readonly max_clips_per_run: number
  }
}

/** A curated theme (spec §8.9) as the content repository keeps it: named in English and in every L1. */
export interface CuratedTheme {
  readonly theme_id: string
  readonly name: Readonly<Record<string, string>>
  readonly description: Readonly<Record<string, string>>
}

export class ConfigError extends Error {
  readonly problems: readonly string[]
  constructor(file: string, problems: readonly string[]) {
    super(`${file}:\n${problems.join('\n')}`)
    this.name = 'ConfigError'
    this.problems = problems
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const LANG = /^[a-z]{2}$/
const THEME_ID = /^[a-z0-9][a-z0-9-]*$/

export function configProblems(raw: unknown): string[] {
  const p: string[] = []
  if (!isRecord(raw)) return ['must be an object']
  const posInt = (v: unknown, path: string) => {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) p.push(`${path}: must be a positive integer`)
  }
  const str = (v: unknown, path: string) => {
    if (typeof v !== 'string' || v.trim() === '') p.push(`${path}: must be a non-empty string`)
  }
  const l1s = raw['l1s']
  if (!Array.isArray(l1s) || l1s.length === 0) p.push('l1s: must list at least one L1')
  else
    l1s.forEach((l, i) => {
      if (typeof l !== 'string' || !LANG.test(l)) p.push(`l1s[${i}]: must be a two-letter lowercase language code`)
    })
  const levels = raw['levels']
  if (!Array.isArray(levels) || levels.length === 0) p.push('levels: must list at least one level')
  else {
    const bad = levels.map((l, i) => ((CEFR_LEVELS as readonly unknown[]).includes(l) ? null : i)).filter((i) => i !== null)
    bad.forEach((i) => p.push(`levels[${i}]: must be one of ${CEFR_LEVELS.join(', ')}`))
    if (bad.length === 0) {
      const idx = levels.map((l) => CEFR_LEVELS.indexOf(l as CefrLevel))
      if (idx.some((v, i) => i > 0 && v <= idx[i - 1]!)) p.push('levels: must be in CEFR order without repeats')
    }
  }
  const targets = raw['targets']
  if (!isRecord(targets)) p.push('targets: must be an object')
  else for (const level of CEFR_LEVELS) posInt(targets[level], `targets.${level}`)
  posInt(raw['max_forms'], 'max_forms')
  posInt(raw['max_lemmas'], 'max_lemmas')
  posInt(raw['unit_size'], 'unit_size')
  posInt(raw['report_threshold'], 'report_threshold')
  const llm = raw['llm']
  if (!isRecord(llm)) p.push('llm: must be an object')
  else {
    str(llm['model'], 'llm.model')
    posInt(llm['concurrency'], 'llm.concurrency')
    if (typeof llm['max_usd_per_run'] !== 'number' || !(llm['max_usd_per_run'] > 0)) p.push('llm.max_usd_per_run: must be a positive number')
  }
  const tts = raw['tts']
  if (!isRecord(tts)) p.push('tts: must be an object')
  else {
    str(tts['model'], 'tts.model')
    posInt(tts['max_clips_per_run'], 'tts.max_clips_per_run')
    const accents = tts['accents']
    if (!isRecord(accents)) p.push('tts.accents: must be an object')
    else {
      if (accents['uk'] === undefined) p.push('tts.accents.uk: required')
      for (const [accent, voice] of Object.entries(accents)) {
        const path = `tts.accents.${accent}`
        if (accent !== 'uk' && accent !== 'us') p.push(`${path}: accent must be uk or us`)
        else if (!isRecord(voice)) p.push(`${path}: must be an object`)
        else {
          str(voice['voice'], `${path}.voice`)
          str(voice['instructions'], `${path}.instructions`)
          if (voice['provider_options'] !== undefined && !isRecord(voice['provider_options'])) p.push(`${path}.provider_options: must be an object`)
        }
      }
    }
  }
  return p
}

export function readConfig(dir: string): PipelineConfig {
  const file = contentPaths(dir).config
  const raw = readJson<unknown>(file)
  const problems = configProblems(raw)
  if (problems.length > 0) throw new ConfigError(file, problems)
  return raw as PipelineConfig
}

export function themeProblems(raw: unknown, l1s: readonly string[]): string[] {
  if (!Array.isArray(raw)) return ['themes: must be a list']
  const p: string[] = []
  const seen = new Set<string>()
  raw.forEach((t, i) => {
    const path = `themes[${i}]`
    if (!isRecord(t)) return void p.push(`${path}: must be an object`)
    const id = t['theme_id']
    if (typeof id !== 'string' || !THEME_ID.test(id)) p.push(`${path}.theme_id: must be lowercase letters, digits and hyphens`)
    else if (seen.has(id)) p.push(`${path}.theme_id: ${id} appears twice`)
    else seen.add(id)
    for (const field of ['name', 'description'] as const) {
      const text = t[field]
      for (const lang of ['en', ...l1s]) {
        if (!isRecord(text) || typeof text[lang] !== 'string' || (text[lang] as string).trim() === '') p.push(`${path}.${field}.${lang}: required`)
      }
    }
  })
  return p
}

export function readThemes(dir: string, l1s: readonly string[]): CuratedTheme[] {
  const file = contentPaths(dir).themes
  const raw = readJson<unknown>(file)
  const problems = themeProblems(raw, l1s)
  if (problems.length > 0) throw new ConfigError(file, problems)
  return raw as CuratedTheme[]
}
```

`pipeline/src/sources.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { contentPaths } from './content'
import { readJson } from './files'

/**
 * One frequency list in the licence register (Decision 3). "Open" does not
 * mean "commercially usable" (spec §5.4): each source is cleared by the legal
 * review (§15) before the pipeline will read it.
 */
export interface SourceRecord {
  readonly id: string
  /** A file name inside `sources/`: "form<TAB>count" per line. */
  readonly file: string
  readonly title: string
  readonly url: string
  /** The licence as its publisher states it, e.g. an SPDX identifier. */
  readonly licence: string
  readonly commercial_use: boolean
  readonly share_alike: boolean
  /** Attribution the licence requires; shown in the app when non-empty (release.json). */
  readonly attribution: string
  readonly cleared_by: string
  readonly cleared_on: string
  readonly notes: string
}

export class LicenceError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`The licence register stops this run (spec §5.4):\n${problems.join('\n')}`)
    this.name = 'LicenceError'
    this.problems = problems
  }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function licenceProblems(r: SourceRecord): string[] {
  const p: string[] = []
  if (r.commercial_use !== true) p.push(`${r.id}: does not permit commercial use`)
  if (r.share_alike !== false) p.push(`${r.id}: is share-alike, which would bind the corpus`)
  if (!r.cleared_by?.trim() && !r.cleared_on?.trim()) p.push(`${r.id}: not cleared by the legal review (cleared_by and cleared_on are empty)`)
  else if (!r.cleared_by?.trim()) p.push(`${r.id}: cleared_by is empty`)
  else if (!DATE.test(r.cleared_on ?? '')) p.push(`${r.id}: cleared_on must be YYYY-MM-DD`)
  return p
}

/**
 * Every source's text, or nothing: one uncleared source stops the whole run
 * before any file is read, so an uncleared list can never leak into a corpus
 * built "just to try" (Review Focus 4).
 */
export function readClearedSources(dir: string): { record: SourceRecord; text: string }[] {
  const paths = contentPaths(dir)
  const records = readJson<SourceRecord[]>(paths.sources)
  if (!Array.isArray(records) || records.length === 0) throw new LicenceError(['sources.json lists no sources'])
  const problems: string[] = []
  for (const r of records) {
    problems.push(...licenceProblems(r))
    if (typeof r.file !== 'string' || basename(r.file) !== r.file) problems.push(`${r.id}: file must be a name inside sources/`)
    else if (!existsSync(join(paths.sourcesDir, r.file))) problems.push(`${r.id}: sources/${r.file} is missing`)
  }
  if (problems.length > 0) throw new LicenceError(problems)
  return records.map((record) => ({ record, text: readFileSync(join(paths.sourcesDir, record.file), 'utf8') }))
}
```

The test that expects "no sources" matches `sources.json lists no sources`.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- config sources && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, 13 tests; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/config.ts pipeline/src/config.test.ts pipeline/src/content.ts pipeline/src/sources.ts pipeline/src/sources.test.ts
git commit -m "feat(pipeline): configuration, content paths and the licence gate"
```

---

### Task 3: Frequency lists to ranked word forms

Frequency lists count word forms (*went*, *cats*), not lemmas. This task only normalises and ranks forms; Task 5 turns them into lemmas. Several lists are merged by averaging their per-million rates, so no single corpus's genre dominates. A list that lacks a form counts zero for it.

**Files:**
- Create: `pipeline/src/frequency.ts`, `pipeline/src/frequency.test.ts`
- Modify: `core/src/index.ts`

**Interfaces:**
- Consumes: `norm` (`@wordado/core`, exported by this task from `core/src/validation.ts`).
- Produces: `parseFrequencyList(text: string, sourceId: string): Map<string, number>` (form → count); `interface RankedForm { readonly form: string; readonly perMillion: number; readonly rank: number }`; `rankForms(lists: readonly ReadonlyMap<string, number>[], max: number): RankedForm[]`.

- [ ] **Step 1: Export `norm` from core**

Append to `core/src/index.ts`:

```ts
export { norm } from './validation'
```

- [ ] **Step 2: Write the failing test**

`pipeline/src/frequency.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseFrequencyList, rankForms } from './frequency'

describe('parseFrequencyList', () => {
  it('reads tab- or space-separated counts, skipping comments, blanks and a header', () => {
    const list = parseFrequencyList('# an invented list\nword\tcount\nthe\t100\n\nwater 40\n', 'x')
    expect([...list]).toEqual([['the', 100], ['water', 40]])
  })

  it('lowercases, merges forms that meet after normalising, and keeps apostrophes and hyphens', () => {
    const list = parseFrequencyList("The\t5\nthe\t3\ndon't\t2\nwell-known\t1\n", 'x')
    expect([...list]).toEqual([['the', 8], ["don't", 2], ['well-known', 1]])
  })

  it('drops tokens that are not words: numbers, punctuation, stray symbols', () => {
    expect([...parseFrequencyList('42\t9\n...\t9\n@home\t9\ncafé\t2\n', 'x')]).toEqual([['café', 2]])
  })

  it('names the source and line of a bad count', () => {
    expect(() => parseFrequencyList('form\tcount\nthe\t5\nwater\tmany\n', 'subs')).toThrow('subs:3: count must be a positive integer')
  })
})

describe('rankForms', () => {
  it('ranks by the mean per-million rate across lists, a missing form counting zero', () => {
    const a = new Map([['the', 900], ['water', 100]])
    const b = new Map([['the', 50], ['bread', 50]])
    expect(rankForms([a, b], 10)).toEqual([
      { form: 'the', perMillion: 700000, rank: 1 },
      { form: 'bread', perMillion: 250000, rank: 2 },
      { form: 'water', perMillion: 50000, rank: 3 },
    ])
  })

  it('breaks ties by form, so the ranking is the same on every machine', () => {
    expect(rankForms([new Map([['b', 1], ['a', 1]])], 10).map((f) => f.form)).toEqual(['a', 'b'])
  })

  it('keeps only the top max forms', () => {
    expect(rankForms([new Map([['a', 3], ['b', 2], ['c', 1]])], 2).map((f) => f.form)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- frequency`
Expected: FAIL, "Failed to resolve import './frequency'".

- [ ] **Step 4: Implement**

`pipeline/src/frequency.ts`:

```ts
import { norm } from '@wordado/core'

/** A word as a learner types it: letters (any script's Latin letters with diacritics), apostrophes, hyphens. */
const WORD = /^\p{Ll}[\p{Ll}'’-]*$/u

/**
 * A frequency list: "form<TAB>count" (or a space) per line. Comments (#),
 * blank lines and a non-numeric header line are skipped; tokens that are not
 * words are dropped. Forms that meet after normalising are summed.
 */
export function parseFrequencyList(text: string, sourceId: string): Map<string, number> {
  const out = new Map<string, number>()
  let data = false
  text.split(/\r?\n/).forEach((line, i) => {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) return
    const [rawForm, rawCount] = trimmed.split(/[\t ]+/)
    if (rawForm === undefined || rawCount === undefined) return
    // A non-numeric count before any data is the header line.
    if (!data && !/^\d+$/.test(rawCount)) return
    data = true
    if (!/^\d+$/.test(rawCount) || Number(rawCount) < 1) throw new Error(`${sourceId}:${i + 1}: count must be a positive integer`)
    const form = norm(rawForm).replaceAll('’', "'")
    if (!WORD.test(form)) return
    out.set(form, (out.get(form) ?? 0) + Number(rawCount))
  })
  return out
}

export interface RankedForm {
  readonly form: string
  readonly perMillion: number
  /** 1-based. */
  readonly rank: number
}

/** Merges lists by their mean per-million rate (a list without the form counts zero) and ranks the result. */
export function rankForms(lists: readonly ReadonlyMap<string, number>[], max: number): RankedForm[] {
  const sums = new Map<string, number>()
  for (const list of lists) {
    let total = 0
    for (const count of list.values()) total += count
    if (total === 0) continue
    for (const [form, count] of list) sums.set(form, (sums.get(form) ?? 0) + (count / total) * 1e6)
  }
  return [...sums]
    .map(([form, sum]) => ({ form, perMillion: Math.round(sum / lists.length) }))
    .sort((a, b) => b.perMillion - a.perMillion || (a.form < b.form ? -1 : a.form > b.form ? 1 : 0))
    .slice(0, max)
    .map((f, i) => ({ ...f, rank: i + 1 }))
}
```

The test's "a missing form counts zero" example: `the` = (900/1000 + 50/100) / 2 × 10⁶ = 700,000; `bread` = (0 + 0.5)/2 = 250,000; `water` = (0.1 + 0)/2 = 50,000.

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- frequency && pnpm --filter @wordado/core typecheck`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add core/src/index.ts pipeline/src/frequency.ts pipeline/src/frequency.test.ts
git commit -m "feat(pipeline): rank word forms from the cleared frequency lists"
```

---

### Task 4: The LLM port, OpenRouter, the stage cache and bounded concurrency

Every LLM stage goes through one port, so the tests use a fake and the vendor can be swapped (§17). Every result is cached in the content repository the moment it arrives, keyed by stage, prompt version and input, so a rerun pays nothing (Review Focus 2). A stage batches only its cache misses.

**Files:**
- Create: `pipeline/src/mapLimit.ts`, `pipeline/src/mapLimit.test.ts`, `pipeline/src/llm.ts`, `pipeline/src/llm.test.ts`, `pipeline/src/cache.ts`, `pipeline/src/cache.test.ts`

**Interfaces:**
- Consumes: `canonicalJson` (`@wordado/core`); `sha256Hex` (`./checksum`); `readJsonl`, `appendJsonl` (Task 1).
- Produces:
  - `mapLimit<I, O>(items: readonly I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]>`
  - `interface LlmRequest<T> { readonly name: string; readonly system: string; readonly input: unknown; readonly schema: Readonly<Record<string, unknown>>; readonly parse: (value: unknown) => T }`
  - `interface Llm { json<T>(req: LlmRequest<T>): Promise<T>; readonly model: string; spentUsd(): number }`
  - `class LlmError extends Error`; `class BudgetExceeded extends Error`; `class ParseError extends Error` (thrown by a stage's `parse`).
  - `openRouterLlm(opts: { apiKey: string; model: string; maxUsd: number; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Llm`
  - `fakeLlm(answer: (name: string, input: unknown) => unknown): Llm & { readonly calls: { name: string; input: unknown }[] }`, exported from `llm.ts` for the tests.
  - `class StageCache { static open(file: string): StageCache; get(key: string): unknown; has(key: string): boolean; set(key: string, value: unknown): void; readonly size: number }`
  - `cacheKey(stage: string, version: number, input: unknown): string`
  - `class OfflineMiss extends Error { readonly stage: string; readonly missing: number }`
  - `cachedBatch<I, O>(opts: { cache: StageCache; stage: string; version: number; items: readonly I[]; keyInput: (item: I) => unknown; batchSize: number; concurrency: number; offline: boolean; run: (batch: readonly I[]) => Promise<readonly O[]> }): Promise<O[]>` (results in item order)

- [ ] **Step 1: Write the failing tests**

`pipeline/src/mapLimit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mapLimit } from './mapLimit'

describe('mapLimit', () => {
  it('keeps results in item order and never runs more than the limit at once', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([30, 10, 20, 5], 2, async (ms, i) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((r) => setTimeout(r, ms))
      running -= 1
      return i
    })
    expect(out).toEqual([0, 1, 2, 3])
    expect(peak).toBe(2)
  })

  it('rejects with the first failure and starts nothing after it', async () => {
    const started: number[] = []
    await expect(
      mapLimit([1, 2, 3, 4], 1, async (n) => {
        started.push(n)
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
    expect(started).toEqual([1, 2])
  })
})
```

`pipeline/src/llm.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { BudgetExceeded, LlmError, openRouterLlm, ParseError, type LlmRequest } from './llm'

const req: LlmRequest<{ n: number }> = {
  name: 'count',
  system: 'Count.',
  input: { words: ['a'] },
  schema: { type: 'object', properties: { n: { type: 'number' } }, required: ['n'], additionalProperties: false },
  parse: (v) => {
    if (typeof v !== 'object' || v === null || typeof (v as { n?: unknown }).n !== 'number') throw new ParseError('n must be a number')
    return v as { n: number }
  },
}

function reply(content: string, cost = 0.01, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { cost } }), { status })
}

function client(responses: (Response | Error)[], maxUsd = 1) {
  const bodies: Record<string, unknown>[] = []
  const llm = openRouterLlm({
    apiKey: 'k',
    model: 'anthropic/claude-sonnet-5',
    maxUsd,
    sleep: async () => {},
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const next = responses.shift()
      if (!next) throw new Error('no more responses')
      if (next instanceof Error) throw next
      return next
    },
  })
  return { llm, bodies }
}

describe('openRouterLlm', () => {
  it('asks for strict structured output with data collection denied, and parses the reply', async () => {
    const { llm, bodies } = client([reply('{"n":3}')])
    expect(await llm.json(req)).toEqual({ n: 3 })
    expect(bodies[0]).toMatchObject({
      model: 'anthropic/claude-sonnet-5',
      temperature: 0.2,
      messages: [
        { role: 'system', content: 'Count.' },
        { role: 'user', content: '{"words":["a"]}' },
      ],
      response_format: { type: 'json_schema', json_schema: { name: 'count', strict: true, schema: req.schema } },
      provider: { require_parameters: true, data_collection: 'deny' },
    })
  })

  it('retries a malformed, a truncated or an unparseable reply, then succeeds', async () => {
    const { llm } = client([reply('{"n":'), reply('{"m":1}'), reply('{"n":4}')])
    expect(await llm.json(req)).toEqual({ n: 4 })
  })

  it('retries rate limits, server errors and network failures, but not a client error', async () => {
    const ok = client([new Response('', { status: 429 }), new Response('', { status: 502 }), new Error('socket'), reply('{"n":1}')])
    expect(await ok.llm.json(req)).toEqual({ n: 1 })
    const bad = client([new Response('{"error":{"message":"bad model"}}', { status: 400 })])
    await expect(bad.llm.json(req)).rejects.toThrow(LlmError)
  })

  it('gives up after four attempts, naming the last problem', async () => {
    const { llm } = client([reply('x'), reply('x'), reply('x'), reply('x')])
    await expect(llm.json(req)).rejects.toThrow(/count: .*not JSON/)
  })

  it('adds up usage.cost, and stops before a call that would exceed the budget', async () => {
    const { llm, bodies } = client([reply('{"n":1}', 0.6), reply('{"n":2}', 0.6), reply('{"n":3}')], 1)
    await llm.json(req)
    await llm.json(req)
    expect(llm.spentUsd()).toBeCloseTo(1.2)
    await expect(llm.json(req)).rejects.toThrow(BudgetExceeded)
    expect(bodies).toHaveLength(2)
  })
})
```

`pipeline/src/cache.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cachedBatch, cacheKey, OfflineMiss, StageCache } from './cache'

const file = () => join(mkdtempSync(join(tmpdir(), 'cache-')), 'stage.jsonl')

describe('StageCache', () => {
  it('keeps each result the moment it arrives, so a reopened cache has it', () => {
    const f = file()
    StageCache.open(f).set('k', { a: 1 })
    const again = StageCache.open(f)
    expect(again.has('k')).toBe(true)
    expect(again.get('k')).toEqual({ a: 1 })
  })

  it('keys by stage, prompt version and canonical input, not key order', () => {
    expect(cacheKey('s', 1, { a: 1, b: 2 })).toBe(cacheKey('s', 1, { b: 2, a: 1 }))
    expect(cacheKey('s', 2, { a: 1 })).not.toBe(cacheKey('s', 1, { a: 1 }))
  })
})

describe('cachedBatch', () => {
  const run = (calls: string[][]) => async (batch: readonly string[]) => {
    calls.push([...batch])
    return batch.map((w) => w.toUpperCase())
  }

  it('asks only for the misses, in batches, and returns results in item order', async () => {
    const cache = StageCache.open(file())
    const calls: string[][] = []
    const opts = { cache, stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: false }
    expect(await cachedBatch({ ...opts, items: ['a', 'b', 'c'], run: run(calls) })).toEqual(['A', 'B', 'C'])
    expect(await cachedBatch({ ...opts, items: ['c', 'd', 'a'], run: run(calls) })).toEqual(['C', 'D', 'A'])
    expect(calls).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('offline, names how many items are missing instead of calling out', async () => {
    const cache = StageCache.open(file())
    const calls: string[][] = []
    const opts = { cache, stage: 'senses', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: true }
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: run(calls) })).rejects.toThrow(OfflineMiss)
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: run(calls) })).rejects.toThrow('senses: 2 items are not cached')
    expect(calls).toEqual([])
  })

  it('refuses a batch answer of the wrong length rather than shifting results onto other items', async () => {
    const cache = StageCache.open(file())
    const opts = { cache, stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 2, concurrency: 1, offline: false }
    await expect(cachedBatch({ ...opts, items: ['a', 'b'], run: async () => ['A'] })).rejects.toThrow(/s: a batch of 2 came back with 1/)
  })

  it('a failed batch keeps the batches that finished before it', async () => {
    const f = file()
    const opts = { stage: 's', version: 1, keyInput: (w: string) => w, batchSize: 1, concurrency: 1, offline: false }
    await expect(
      cachedBatch({ ...opts, cache: StageCache.open(f), items: ['a', 'b'], run: async (b) => {
        if (b[0] === 'b') throw new Error('down')
        return ['A']
      } }),
    ).rejects.toThrow('down')
    expect(StageCache.open(f).size).toBe(1)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- mapLimit llm cache`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`pipeline/src/mapLimit.ts`:

```ts
/** Runs `fn` over `items` with at most `limit` in flight; results keep item order. The first failure rejects, and no new item starts after it. */
export async function mapLimit<I, O>(items: readonly I[], limit: number, fn: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next
      next += 1
      try {
        out[i] = await fn(items[i]!, i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return out
}
```

`pipeline/src/llm.ts`:

```ts
/** One structured request: the stage's instructions, its input as JSON, and the schema the answer must follow. */
export interface LlmRequest<T> {
  /** The schema's name; also names the stage in errors. */
  readonly name: string
  readonly system: string
  readonly input: unknown
  readonly schema: Readonly<Record<string, unknown>>
  /** Checks the answer beyond the schema (the right items, in the right order); throws ParseError. */
  readonly parse: (value: unknown) => T
}

/** The LLM port (spec §17: every vendor sits behind an interface). */
export interface Llm {
  json<T>(req: LlmRequest<T>): Promise<T>
  readonly model: string
  spentUsd(): number
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LlmError'
  }
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

export class BudgetExceeded extends Error {
  constructor(spent: number, max: number) {
    super(`LLM spend reached $${spent.toFixed(2)} of this run's $${max.toFixed(2)} (llm.max_usd_per_run); rerun to continue from the cache`)
    this.name = 'BudgetExceeded'
  }
}

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'
const ATTEMPTS = 4

class Retryable extends Error {}

export interface OpenRouterOptions {
  readonly apiKey: string
  readonly model: string
  readonly maxUsd: number
  readonly fetch?: typeof fetch
  readonly sleep?: (ms: number) => Promise<void>
}

/**
 * OpenRouter's chat completions with strict `json_schema` output (§17.1).
 * `require_parameters` keeps the request off providers that would ignore the
 * schema; `data_collection: "deny"` keeps it off providers that train on it.
 * Rate limits, server errors, network failures and answers that do not parse
 * are retried with backoff; any other client error is not.
 */
export function openRouterLlm(opts: OpenRouterOptions): Llm {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  let spent = 0

  async function attempt<T>(req: LlmRequest<T>): Promise<T> {
    let res: Response
    try {
      res = await doFetch(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${opts.apiKey}`,
          'content-type': 'application/json',
          'http-referer': 'https://wordado.com',
          'x-title': 'Wordado corpus pipeline',
        },
        body: JSON.stringify({
          model: opts.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: JSON.stringify(req.input) },
          ],
          response_format: { type: 'json_schema', json_schema: { name: req.name, strict: true, schema: req.schema } },
          provider: { require_parameters: true, data_collection: 'deny' },
        }),
      })
    } catch (err) {
      throw new Retryable(`network: ${err instanceof Error ? err.message : String(err)}`)
    }
    const text = await res.text()
    if (res.status === 429 || res.status >= 500) throw new Retryable(`HTTP ${res.status}`)
    if (!res.ok) throw new LlmError(`${req.name}: HTTP ${res.status}: ${text.slice(0, 500)}`)
    let body: { choices?: { message?: { content?: unknown } }[]; usage?: { cost?: unknown } }
    try {
      body = JSON.parse(text) as typeof body
    } catch {
      throw new Retryable('the response body is not JSON')
    }
    if (typeof body.usage?.cost === 'number') spent += body.usage.cost
    const content = body.choices?.[0]?.message?.content
    if (typeof content !== 'string') throw new Retryable('the response has no message content')
    let value: unknown
    try {
      value = JSON.parse(content)
    } catch {
      throw new Retryable('the answer is not JSON (truncated?)')
    }
    try {
      return req.parse(value)
    } catch (err) {
      if (err instanceof ParseError) throw new Retryable(`the answer does not fit: ${err.message}`)
      throw err
    }
  }

  return {
    model: opts.model,
    spentUsd: () => spent,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        if (spent >= opts.maxUsd) throw new BudgetExceeded(spent, opts.maxUsd)
        try {
          return await attempt(req)
        } catch (err) {
          if (!(err instanceof Retryable)) throw err
          last = err.message
          if (i < ATTEMPTS - 1) await sleep(1000 * 2 ** i)
        }
      }
      throw new LlmError(`${req.name}: gave up after ${ATTEMPTS} attempts: ${last}`)
    },
  }
}

/** A deterministic LLM for tests: `answer` gets the request's name and input and returns the parsed-JSON answer. */
export function fakeLlm(answer: (name: string, input: unknown) => unknown): Llm & { readonly calls: { name: string; input: unknown }[] } {
  const calls: { name: string; input: unknown }[] = []
  return {
    model: 'fake',
    calls,
    spentUsd: () => 0,
    async json<T>(req: LlmRequest<T>): Promise<T> {
      calls.push({ name: req.name, input: req.input })
      return req.parse(JSON.parse(JSON.stringify(answer(req.name, req.input))))
    },
  }
}
```

The "gives up" test expects `/count: .*not JSON/`. The last message is "the answer is not JSON (truncated?)", wrapped as "count: gave up after 4 attempts: the answer is not JSON (truncated?)", which matches.

`pipeline/src/cache.ts`:

```ts
import { canonicalJson } from '@wordado/core'
import { sha256Hex } from './checksum'
import { appendJsonl, readJsonl } from './files'
import { mapLimit } from './mapLimit'

interface Line {
  readonly key: string
  readonly value: unknown
}

/**
 * One stage's results, one JSONL line per item, in the content repository
 * (Decision 17). A line is appended the moment its batch returns, so a crash
 * or a budget stop loses nothing already paid for (Review Focus 2).
 */
export class StageCache {
  private readonly map: Map<string, unknown>
  private constructor(private readonly file: string, lines: readonly Line[]) {
    this.map = new Map(lines.map((l) => [l.key, l.value]))
  }
  static open(file: string): StageCache {
    return new StageCache(file, readJsonl<Line>(file))
  }
  get size(): number {
    return this.map.size
  }
  has(key: string): boolean {
    return this.map.has(key)
  }
  get(key: string): unknown {
    return this.map.get(key)
  }
  set(key: string, value: unknown): void {
    this.map.set(key, value)
    appendJsonl(this.file, [{ key, value }])
  }
}

/** The model is not part of the key: changing it keeps reviewed proposals; bumping a prompt version does not. */
export function cacheKey(stage: string, version: number, input: unknown): string {
  return sha256Hex(new TextEncoder().encode(canonicalJson([stage, version, input])))
}

export class OfflineMiss extends Error {
  readonly stage: string
  readonly missing: number
  constructor(stage: string, missing: number) {
    super(`${stage}: ${missing} items are not cached; run \`corpus draft\` with OPENROUTER_API_KEY first`)
    this.name = 'OfflineMiss'
    this.stage = stage
    this.missing = missing
  }
}

export interface CachedBatchOptions<I, O> {
  readonly cache: StageCache
  readonly stage: string
  readonly version: number
  readonly items: readonly I[]
  readonly keyInput: (item: I) => unknown
  readonly batchSize: number
  readonly concurrency: number
  /** Release runs offline: every item must already be cached. */
  readonly offline: boolean
  readonly run: (batch: readonly I[]) => Promise<readonly O[]>
}

/** Results for every item in item order, asking `run` only for cache misses, `batchSize` at a time. */
export async function cachedBatch<I, O>(opts: CachedBatchOptions<I, O>): Promise<O[]> {
  const keys = opts.items.map((item) => cacheKey(opts.stage, opts.version, opts.keyInput(item)))
  const missing: number[] = []
  const seen = new Set<string>()
  keys.forEach((k, i) => {
    if (!opts.cache.has(k) && !seen.has(k)) {
      seen.add(k)
      missing.push(i)
    }
  })
  if (missing.length > 0 && opts.offline) throw new OfflineMiss(opts.stage, missing.length)
  const batches: number[][] = []
  for (let i = 0; i < missing.length; i += opts.batchSize) batches.push(missing.slice(i, i + opts.batchSize))
  await mapLimit(batches, opts.concurrency, async (batch) => {
    const out = await opts.run(batch.map((i) => opts.items[i]!))
    if (out.length !== batch.length) throw new Error(`${opts.stage}: a batch of ${batch.length} came back with ${out.length}`)
    batch.forEach((i, j) => opts.cache.set(keys[i]!, out[j]))
  })
  return keys.map((k) => opts.cache.get(k) as O)
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- mapLimit llm cache && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/mapLimit.ts pipeline/src/mapLimit.test.ts pipeline/src/llm.ts pipeline/src/llm.test.ts pipeline/src/cache.ts pipeline/src/cache.test.ts
git commit -m "feat(pipeline): the LLM port over OpenRouter, the stage cache and bounded concurrency"
```

---
### Task 5: Forms to lemmas

A frequency list's forms become lemmas. The LLM names each form's lemma or lemmas (*went* → *go*; *saw* → *see*, *saw*) and says what kind of token it is, so names, abbreviations, foreign words, offensive words and fragments drop out. A form's rate is split evenly among its lemmas, and a lemma's rate is the sum of its forms'. The sample's headwords are pinned, so they are always described even if no list has them (Decision 9).

**Files:**
- Create: `pipeline/src/stages/lemmas.ts`, `pipeline/src/stages/lemmas.test.ts`

**Interfaces:**
- Consumes: `RankedForm` (Task 3); `Llm`, `ParseError` (Task 4); `StageCache`, `cachedBatch` (Task 4); `norm` (`@wordado/core`).
- Produces:
  - `LEMMAS_VERSION = 1`
  - `type FormKind = 'word' | 'name' | 'abbreviation' | 'foreign' | 'offensive' | 'fragment'`
  - `interface LemmaResult { readonly form: string; readonly kind: FormKind; readonly lemmas: readonly string[] }`
  - `interface StageRun { readonly llm: Llm; readonly cache: StageCache; readonly concurrency: number; readonly offline: boolean }`, used by every stage.
  - `lemmatise(forms: readonly RankedForm[], run: StageRun): Promise<LemmaResult[]>`
  - `interface RankedLemma { readonly lemma: string; readonly perMillion: number; readonly rank: number; readonly pinned: boolean }`
  - `rankLemmas(forms: readonly RankedForm[], results: readonly LemmaResult[], pinned: readonly string[], max: number): RankedLemma[]`

- [ ] **Step 1: Write the failing test**

`pipeline/src/stages/lemmas.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { lemmatise, rankLemmas, type LemmaResult } from './lemmas'

const cache = () => StageCache.open(join(mkdtempSync(join(tmpdir(), 'lemmas-')), 'lemmas.jsonl'))
const forms = [
  { form: 'went', perMillion: 300, rank: 1 },
  { form: 'saw', perMillion: 200, rank: 2 },
  { form: 'london', perMillion: 100, rank: 3 },
  { form: 'go', perMillion: 100, rank: 4 },
]
const LEXICON: Record<string, LemmaResult> = {
  went: { form: 'went', kind: 'word', lemmas: ['go'] },
  saw: { form: 'saw', kind: 'word', lemmas: ['see', 'saw'] },
  london: { form: 'london', kind: 'name', lemmas: [] },
  go: { form: 'go', kind: 'word', lemmas: ['Go '] },
}
const answer = (_name: string, input: unknown) => ({ items: (input as { forms: string[] }).forms.map((f) => LEXICON[f]) })

describe('lemmatise', () => {
  it('asks for every form once and normalises the lemmas it gets back', async () => {
    const llm = fakeLlm(answer)
    const run = { llm, cache: cache(), concurrency: 2, offline: false }
    const out = await lemmatise(forms, run)
    expect(out[3]).toEqual({ form: 'go', kind: 'word', lemmas: ['go'] })
    expect(llm.calls.map((c) => c.name)).toEqual(['lemmas'])
    await lemmatise(forms, run)
    expect(llm.calls).toHaveLength(1)
  })

  it('rejects a response that answers other items than it was asked', async () => {
    const llm = fakeLlm(() => ({ items: [LEXICON['saw'], LEXICON['went'], LEXICON['london'], LEXICON['go']] }))
    await expect(lemmatise(forms, { llm, cache: cache(), concurrency: 1, offline: false })).rejects.toThrow(/answers other items/)
  })
})

describe('rankLemmas', () => {
  it('sums each lemma over its forms, splitting a form among its lemmas, and drops non-words', () => {
    const results = forms.map((f) => ({ ...LEXICON[f.form]!, lemmas: LEXICON[f.form]!.lemmas.map((l) => l.trim().toLowerCase()) }))
    expect(rankLemmas(forms, results, [], 10)).toEqual([
      { lemma: 'go', perMillion: 400, rank: 1, pinned: false },
      { lemma: 'saw', perMillion: 100, rank: 2, pinned: false },
      { lemma: 'see', perMillion: 100, rank: 3, pinned: false },
    ])
  })

  it('keeps pinned headwords past the cut, and adds any the lists lack', () => {
    const results = forms.map((f) => ({ ...LEXICON[f.form]!, lemmas: LEXICON[f.form]!.lemmas.map((l) => l.trim().toLowerCase()) }))
    expect(rankLemmas(forms, results, ['see', 'thank you'], 1)).toEqual([
      { lemma: 'go', perMillion: 400, rank: 1, pinned: false },
      { lemma: 'see', perMillion: 100, rank: 3, pinned: true },
      { lemma: 'thank you', perMillion: 0, rank: 4, pinned: true },
    ])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- lemmas`
Expected: FAIL, "Failed to resolve import './lemmas'".

- [ ] **Step 3: Implement**

`pipeline/src/stages/lemmas.ts`:

```ts
import { norm } from '@wordado/core'
import { cachedBatch, type StageCache } from '../cache'
import type { RankedForm } from '../frequency'
import { ParseError, type Llm } from '../llm'

/** Bump when the prompt or schema changes: every form is asked again, and proposals built on it are re-reviewed. */
export const LEMMAS_VERSION = 1

export type FormKind = 'word' | 'name' | 'abbreviation' | 'foreign' | 'offensive' | 'fragment'
const KINDS: readonly FormKind[] = ['word', 'name', 'abbreviation', 'foreign', 'offensive', 'fragment']

export interface LemmaResult {
  readonly form: string
  readonly kind: FormKind
  /** Empty unless `kind` is `word`. */
  readonly lemmas: readonly string[]
}

/** What every LLM stage needs to run. */
export interface StageRun {
  readonly llm: Llm
  readonly cache: StageCache
  readonly concurrency: number
  readonly offline: boolean
}

const SYSTEM = `You prepare an English vocabulary course for adult learners.
For each English word form you are given, in the order given, return:
- "form": the form exactly as given.
- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").
- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.
Return one item per form, in the same order, and nothing else.`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          form: { type: 'string' },
          kind: { type: 'string', enum: KINDS },
          lemmas: { type: 'array', items: { type: 'string' } },
        },
        required: ['form', 'kind', 'lemmas'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const BATCH = 100

function parse(asked: readonly string[]) {
  return (value: unknown): LemmaResult[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError(`answers other items than it was asked (${Array.isArray(items) ? items.length : 0} for ${asked.length})`)
    return items.map((raw, i) => {
      const item = raw as { form?: unknown; kind?: unknown; lemmas?: unknown }
      if (item.form !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item.form)}, not ${JSON.stringify(asked[i])}`)
      if (!KINDS.includes(item.kind as FormKind)) throw new ParseError(`item ${i}: unknown kind`)
      const kind = item.kind as FormKind
      const lemmas = kind === 'word' && Array.isArray(item.lemmas) ? [...new Set(item.lemmas.map((l) => norm(String(l))).filter((l) => l !== ''))] : []
      return { form: asked[i]!, kind, lemmas }
    })
  }
}

export function lemmatise(forms: readonly RankedForm[], run: StageRun): Promise<LemmaResult[]> {
  return cachedBatch({
    cache: run.cache,
    stage: 'lemmas',
    version: LEMMAS_VERSION,
    items: forms.map((f) => f.form),
    keyInput: (form) => form,
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) => run.llm.json({ name: 'lemmas', system: SYSTEM, input: { forms: batch }, schema: SCHEMA, parse: parse(batch) }),
  })
}

export interface RankedLemma {
  readonly lemma: string
  readonly perMillion: number
  /** 1-based, over every lemma before the cut; a pinned lemma the lists lack comes last. */
  readonly rank: number
  /** A sample headword (Decision 9): described whatever its rank. */
  readonly pinned: boolean
}

/** Lemmas by summed rate: the top `max`, plus every pinned headword wherever it ranks. */
export function rankLemmas(forms: readonly RankedForm[], results: readonly LemmaResult[], pinned: readonly string[], max: number): RankedLemma[] {
  const rates = new Map<string, number>()
  results.forEach((r, i) => {
    if (r.kind !== 'word' || r.lemmas.length === 0) return
    const share = forms[i]!.perMillion / r.lemmas.length
    for (const l of r.lemmas) rates.set(l, (rates.get(l) ?? 0) + share)
  })
  const pins = new Set(pinned.map(norm))
  for (const p of pins) if (!rates.has(p)) rates.set(p, 0)
  return [...rates]
    .map(([lemma, perMillion]) => ({ lemma, perMillion: Math.round(perMillion) }))
    .sort((a, b) => b.perMillion - a.perMillion || (a.lemma < b.lemma ? -1 : a.lemma > b.lemma ? 1 : 0))
    .map((l, i) => ({ ...l, rank: i + 1, pinned: pins.has(l.lemma) }))
    .filter((l) => l.rank <= max || l.pinned)
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- lemmas`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/stages/lemmas.ts pipeline/src/stages/lemmas.test.ts
git commit -m "feat(pipeline): lemmas from word forms"
```

---

### Task 6: English senses and CEFR banding

Each lemma becomes up to four senses. Each sense has a part of speech (from core's 11 tags), a short English gloss, the LLM's CEFR judgement, UK IPA, spelling variants, up to three curated themes and three example sentences (§5.2, §5.4 steps 2 and 4). The level is then banded against frequency (Decision 7).

**Files:**
- Create: `pipeline/src/stages/senses.ts`, `pipeline/src/stages/senses.test.ts`

**Interfaces:**
- Consumes: `RankedLemma`, `StageRun` (Task 5); `ParseError` (Task 4); `cachedBatch` (Task 4); `CEFR_LEVELS`, `CefrLevel`, `PARTS_OF_SPEECH`, `PartOfSpeech`, `norm` (`@wordado/core`).
- Produces:
  - `SENSES_VERSION = 1`
  - `type LlmLevel = CefrLevel | 'C2'`
  - `interface SenseProposal { readonly headword: string; readonly pos: PartOfSpeech; readonly gloss: string; readonly level: LlmLevel; readonly ipa: string; readonly variants: readonly string[]; readonly themes: readonly string[]; readonly examples: readonly string[] }`
  - `describeLemmas(lemmas: readonly RankedLemma[], themeIds: readonly string[], run: StageRun): Promise<SenseProposal[][]>` (one list per lemma, in order)
  - `frequencyBand(rank: number, targets: Readonly<Record<CefrLevel, number>>): CefrLevel`
  - `bandLevel(llm: LlmLevel, band: CefrLevel): { readonly level: CefrLevel | null; readonly flagged: boolean }`

- [ ] **Step 1: Write the failing test**

`pipeline/src/stages/senses.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { bandLevel, describeLemmas, frequencyBand } from './senses'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'senses-')), 'senses.jsonl')),
  concurrency: 1,
  offline: false,
})
const bank = {
  lemma: 'bank',
  senses: [
    { pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping', 'unknown-theme'], examples: ['I went to the bank.', 'The bank | shut.'] },
    { pos: 'noun', gloss: 'river', level: 'B1', ipa: 'bæŋk', variants: [], themes: [], examples: ['We sat on the river bank.'] },
  ],
}
const lemmas = [{ lemma: 'bank', perMillion: 50, rank: 900, pinned: false }]

describe('describeLemmas', () => {
  it('keeps known themes only and makes examples safe for the review sheet', async () => {
    const [senses] = await describeLemmas(lemmas, ['shopping'], run(() => ({ items: [bank] })))
    expect(senses).toEqual([
      { headword: 'bank', pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping'], examples: ['I went to the bank.', 'The bank / shut.'] },
      { headword: 'bank', pos: 'noun', gloss: 'river', level: 'B1', ipa: 'bæŋk', variants: [], themes: [], examples: ['We sat on the river bank.'] },
    ])
  })

  it('rejects a response that answers other items than it was asked', async () => {
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [{ ...bank, lemma: 'river' }] })))).rejects.toThrow(/answers other items/)
  })

  it('keeps a headword’s capitals, and ignores a "headword" that is another word', async () => {
    const pronoun = { lemma: 'i', headword: 'I', senses: [{ ...bank.senses[0], pos: 'pron', gloss: '' }] }
    const lemma = [{ lemma: 'i', perMillion: 9000, rank: 10, pinned: false }]
    expect((await describeLemmas(lemma, [], run(() => ({ items: [pronoun] }))))[0]![0]!.headword).toBe('I')
    expect((await describeLemmas(lemma, [], run(() => ({ items: [{ ...pronoun, headword: 'Me' }] }))))[0]![0]!.headword).toBe('i')
  })

  it('rejects two senses of one part of speech that the gloss cannot tell apart', async () => {
    const same = { ...bank, senses: [bank.senses[0], { ...bank.senses[1], gloss: '' }] }
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [same] })))).rejects.toThrow(/needs a gloss/)
  })

  it('rejects a live sense with no example sentence (spec §5.2)', async () => {
    const bare = { ...bank, senses: [{ ...bank.senses[0], examples: [' '] }] }
    await expect(describeLemmas(lemmas, [], run(() => ({ items: [bare] })))).rejects.toThrow(/example/)
  })
})

describe('frequencyBand (Decision 7)', () => {
  const targets = { A1: 600, A2: 1000, B1: 1500, B2: 2000, C1: 2000 }
  it('bands by rank against the cumulative targets', () => {
    expect([1, 600, 601, 1600, 1601, 3100, 3101, 5100, 7100, 9999].map((r) => frequencyBand(r, targets))).toEqual([
      'A1', 'A1', 'A2', 'A2', 'B1', 'B1', 'B2', 'B2', 'C1', 'C1',
    ])
  })
})

describe('bandLevel (Decision 7)', () => {
  it('keeps the LLM level within one band of frequency', () => {
    expect(bandLevel('A2', 'A1')).toEqual({ level: 'A2', flagged: false })
    expect(bandLevel('B1', 'B1')).toEqual({ level: 'B1', flagged: false })
  })
  it('clamps a level more than one band away, and flags it for banding review', () => {
    expect(bandLevel('B2', 'A1')).toEqual({ level: 'A2', flagged: true })
    expect(bandLevel('A1', 'B2')).toEqual({ level: 'B1', flagged: true })
  })
  it('drops C2, which no Phase 1 path teaches', () => {
    expect(bandLevel('C2', 'A1')).toEqual({ level: null, flagged: false })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- senses`
Expected: FAIL, "Failed to resolve import './senses'".

- [ ] **Step 3: Implement**

`pipeline/src/stages/senses.ts`:

```ts
import { CEFR_LEVELS, levelIndex, norm, PARTS_OF_SPEECH, type CefrLevel, type PartOfSpeech } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { RankedLemma, StageRun } from './lemmas'

export const SENSES_VERSION = 1

export type LlmLevel = CefrLevel | 'C2'
const LLM_LEVELS: readonly LlmLevel[] = [...CEFR_LEVELS, 'C2']

/** One proposed sense of a headword, English side (spec §5.2). */
export interface SenseProposal {
  readonly headword: string
  readonly pos: PartOfSpeech
  /** A few English words that tell this sense apart; empty when it is the headword's only sense for this part of speech. */
  readonly gloss: string
  readonly level: LlmLevel
  /** UK IPA, without slashes. */
  readonly ipa: string
  readonly variants: readonly string[]
  readonly themes: readonly string[]
  readonly examples: readonly string[]
}

/**
 * The prompt judges level from the CEFR descriptors alone. It never names or
 * asks for a published list's levels, which must not be copied (spec §5.4, R1).
 */
const SYSTEM = `You prepare an English vocabulary course for adult learners.
For each headword you are given, in the order given, list the senses a learner up to CEFR C1 would need, most common first, at most four. For each sense:
- "pos": one of ${PARTS_OF_SPEECH.join(', ')} ("det" is a determiner, "intj" an interjection, "phrase" a fixed multi-word expression).
- "gloss": two to four plain English words that tell this sense apart from the headword's other senses with the same part of speech ("money" and "river" for bank). Empty only when the headword has a single sense for that part of speech.
- "level": the CEFR level at which a typical learner first needs this sense, judged from the CEFR descriptors (A1: basic personal and everyday needs; A2: routine tasks and familiar topics; B1: work, school, leisure and travel; B2: abstract and technical topics in one's field; C1: flexible use for social, academic and professional purposes). Use C2 for a sense beyond that.
- "ipa": the standard British pronunciation in IPA, without slashes.
- "variants": other accepted spellings (colour → color); usually empty.
- "themes": up to three theme ids from the list given, most relevant first; empty if none fits.
- "examples": three short, natural English sentences using the headword in this sense, suitable for adults, at or below the sense's level. No names of real people or brands.
Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: with its capital letters where it has them (I, Monday, English, TV), otherwise the same as "lemma".`

function schema(themeIds: readonly string[]) {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            lemma: { type: 'string' },
            headword: { type: 'string' },
            senses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pos: { type: 'string', enum: PARTS_OF_SPEECH },
                  gloss: { type: 'string' },
                  level: { type: 'string', enum: LLM_LEVELS },
                  ipa: { type: 'string' },
                  variants: { type: 'array', items: { type: 'string' } },
                  themes: { type: 'array', items: themeIds.length > 0 ? { type: 'string', enum: themeIds } : { type: 'string' } },
                  examples: { type: 'array', items: { type: 'string' } },
                },
                required: ['pos', 'gloss', 'level', 'ipa', 'variants', 'themes', 'examples'],
                additionalProperties: false,
              },
            },
          },
          required: ['lemma', 'headword', 'senses'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

const BATCH = 10
/** The review sheet separates list cells with " | " (Task 12); a sentence must not contain one. */
const cell = (s: string) => s.replaceAll('|', '/').replace(/\s+/g, ' ').trim()

function parseSense(headword: string, themeIds: ReadonlySet<string>, raw: Record<string, unknown>, where: string): SenseProposal {
  const pos = raw['pos'] as PartOfSpeech
  if (!PARTS_OF_SPEECH.includes(pos)) throw new ParseError(`${where}: unknown part of speech`)
  const level = raw['level'] as LlmLevel
  if (!LLM_LEVELS.includes(level)) throw new ParseError(`${where}: unknown level`)
  const strings = (v: unknown) => (Array.isArray(v) ? v.map((s) => cell(String(s))).filter((s) => s !== '') : [])
  const examples = strings(raw['examples']).slice(0, 5)
  if (examples.length === 0) throw new ParseError(`${where}: needs at least one example sentence`)
  const ipa = cell(String(raw['ipa'] ?? '')).replace(/^\/|\/$/g, '')
  if (ipa === '') throw new ParseError(`${where}: needs IPA`)
  return {
    headword,
    pos,
    gloss: cell(String(raw['gloss'] ?? '')),
    level,
    ipa,
    variants: [...new Set(strings(raw['variants']).map(norm))].filter((v) => v !== headword),
    themes: [...new Set(strings(raw['themes']))].filter((t) => themeIds.has(t)).slice(0, 3),
    examples,
  }
}

function parse(asked: readonly string[], themeIds: ReadonlySet<string>) {
  return (value: unknown): SenseProposal[][] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError(`answers other items than it was asked`)
    return items.map((raw, i) => {
      const item = raw as { lemma?: unknown; headword?: unknown; senses?: unknown }
      if (item.lemma !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item.lemma)}`)
      // Frequency lists are lowercased; the headword keeps its capitals (I, Monday) when it is the same word.
      const display = String(item.headword ?? '').trim()
      const headword = display !== '' && norm(display) === asked[i] ? display : asked[i]!
      const senses = (Array.isArray(item.senses) ? item.senses : []).slice(0, 4).map((s, j) => parseSense(headword, themeIds, s as Record<string, unknown>, `${asked[i]} sense ${j}`))
      const byPos = new Map<string, SenseProposal[]>()
      for (const s of senses) byPos.set(s.pos, [...(byPos.get(s.pos) ?? []), s])
      for (const [pos, group] of byPos) {
        if (group.length > 1 && group.some((s) => s.gloss === '')) throw new ParseError(`${asked[i]} (${pos}): every sense needs a gloss when there are several`)
        if (new Set(group.map((s) => norm(s.gloss))).size !== group.length) throw new ParseError(`${asked[i]} (${pos}): two senses share a gloss`)
      }
      return senses
    })
  }
}

export function describeLemmas(lemmas: readonly RankedLemma[], themeIds: readonly string[], run: StageRun): Promise<SenseProposal[][]> {
  const known = new Set(themeIds)
  const sortedThemes = [...themeIds].sort()
  return cachedBatch({
    cache: run.cache,
    stage: 'senses',
    version: SENSES_VERSION,
    items: lemmas.map((l) => l.lemma),
    // The theme list is part of the question: adding a theme asks every headword again.
    keyInput: (lemma) => ({ lemma, themes: sortedThemes }),
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) =>
      run.llm.json({ name: 'senses', system: SYSTEM, input: { themes: sortedThemes, headwords: batch }, schema: schema(sortedThemes), parse: parse(batch, known) }),
  })
}

/** A lemma's level by frequency alone: its rank against the cumulative targets (Decision 7). Past C1's total it is C1. */
export function frequencyBand(rank: number, targets: Readonly<Record<CefrLevel, number>>): CefrLevel {
  let upTo = 0
  for (const level of CEFR_LEVELS) {
    upTo += targets[level]
    if (rank <= upTo) return level
  }
  return 'C1'
}

/** The LLM's judgement, kept within one band of frequency; clamping flags the sense for banding review. */
export function bandLevel(llm: LlmLevel, band: CefrLevel): { readonly level: CefrLevel | null; readonly flagged: boolean } {
  if (llm === 'C2') return { level: null, flagged: false }
  const b = levelIndex(band)
  const l = levelIndex(llm)
  const clamped = Math.min(Math.max(l, b - 1), b + 1)
  return { level: CEFR_LEVELS[clamped]!, flagged: clamped !== l }
}
```

The test's `bank` fixture has a theme `unknown-theme`, which the schema's enum would stop a real provider from sending. `parseSense` also filters it, because the fake does not enforce the schema.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- senses`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/stages/senses.ts pipeline/src/stages/senses.test.ts
git commit -m "feat(pipeline): English senses with CEFR banding against frequency"
```

---

### Task 7: The ID registry

Entry IDs are forever (§5.1). The registry records every ID ever assigned with the English identity it stands for, plus the units. It only grows. It is seeded from the sample pack, whose 60 entries are pinned.

**Files:**
- Create: `pipeline/src/registry.ts`, `pipeline/src/registry.test.ts`

**Interfaces:**
- Consumes: `Pack`, `PartOfSpeech`, `CefrLevel`, `norm` (`@wordado/core`).
- Produces:
  - `interface RegistryEntry { readonly entry_id: string; readonly headword: string; readonly pos: PartOfSpeech; readonly sense_en: string; readonly pinned: boolean }`
  - `interface RegistryUnit { readonly unit_id: string; readonly level: CefrLevel; readonly entry_ids: readonly string[] }`
  - `interface Registry { readonly entries: readonly RegistryEntry[]; readonly units: readonly RegistryUnit[] }`
  - `interface SenseKey { readonly headword: string; readonly pos: PartOfSpeech; readonly sense_en: string }`
  - `slugOf(headword: string): string`
  - `assignIds(registry: Registry, keys: readonly SenseKey[]): { registry: Registry; ids: string[] }`
  - `registryFromSample(pack: Pack): Registry`

- [ ] **Step 1: Write the failing test**

`pipeline/src/registry.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { assignIds, registryFromSample, slugOf, type Registry } from './registry'

const samplePack = (() => {
  const file = fileURLToPath(new URL('../samples/a1-bg/corpus-v0-bg.pack', import.meta.url))
  const r = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (r.status !== 'ok') throw new Error('sample invalid')
  return r.pack as Pack
})()

describe('slugOf (Decision 10)', () => {
  it('makes IDs like the sample’s', () => {
    expect(['thank you', "o'clock", 'Café', 'well-known', '  ', "’"].map(slugOf)).toEqual(['thank_you', 'oclock', 'cafe', 'well-known', 'w', 'w'])
  })
})

describe('registryFromSample', () => {
  it('pins every sample entry under its own ID and keeps its units', () => {
    const r = registryFromSample(samplePack)
    expect(r.entries).toHaveLength(60)
    expect(r.entries.every((e) => e.pinned && e.sense_en === '')).toBe(true)
    expect(r.entries.find((e) => e.entry_id === 'thank_you-1')).toMatchObject({ headword: 'thank you' })
    expect(r.units.map((u) => u.unit_id)).toEqual(['a1-01', 'a1-02', 'a1-03'])
  })
})

describe('assignIds', () => {
  const base: Registry = {
    entries: [
      { entry_id: 'bank-1', headword: 'bank', pos: 'noun', sense_en: 'money', pinned: false },
      { entry_id: 'hello-1', headword: 'hello', pos: 'intj', sense_en: '', pinned: true },
      { entry_id: 'run-3', headword: 'run', pos: 'verb', sense_en: 'move fast', pinned: false },
    ],
    units: [],
  }

  it('keeps an exact match’s ID', () => {
    expect(assignIds(base, [{ headword: 'bank', pos: 'noun', sense_en: 'Money ' }]).ids).toEqual(['bank-1'])
  })

  it('matches a lone sense to a lone registry entry whose gloss moved, and records the new gloss', () => {
    const out = assignIds(base, [{ headword: 'hello', pos: 'intj', sense_en: 'greeting' }])
    expect(out.ids).toEqual(['hello-1'])
    expect(out.registry.entries.find((e) => e.entry_id === 'hello-1')).toMatchObject({ sense_en: 'greeting', pinned: true })
  })

  it('gives a new sense the next number for its slug, never reusing one', () => {
    const out = assignIds(base, [
      { headword: 'bank', pos: 'noun', sense_en: 'money' },
      { headword: 'bank', pos: 'noun', sense_en: 'river' },
      { headword: 'run', pos: 'noun', sense_en: '' },
    ])
    expect(out.ids).toEqual(['bank-1', 'bank-2', 'run-4'])
    expect(out.registry.entries).toHaveLength(5)
  })

  it('never deletes an entry the new senses no longer mention', () => {
    expect(assignIds(base, []).registry.entries).toEqual(base.entries)
  })

  it('refuses the same sense twice in one call', () => {
    expect(() => assignIds(base, [{ headword: 'x', pos: 'noun', sense_en: '' }, { headword: 'X', pos: 'noun', sense_en: '' }])).toThrow(/twice/)
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- registry`
Expected: FAIL, "Failed to resolve import './registry'".

- [ ] **Step 3: Implement**

`pipeline/src/registry.ts`:

```ts
import { norm, type CefrLevel, type Pack, type PartOfSpeech } from '@wordado/core'

/** An entry ID and the English sense it stands for (spec §5.2's identity). Never removed (spec §5.1). */
export interface RegistryEntry {
  readonly entry_id: string
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
  /** A sample entry: must stay live (plan 7's contract, Decision 9). */
  readonly pinned: boolean
}

export interface RegistryUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly entry_ids: readonly string[]
}

export interface Registry {
  readonly entries: readonly RegistryEntry[]
  readonly units: readonly RegistryUnit[]
}

export interface SenseKey {
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
}

/** The sample's ID style: `thank_you`, `oclock`, `cafe` (Decision 10). */
export function slugOf(headword: string): string {
  const slug = norm(headword)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
  return slug === '' ? 'w' : slug
}

const identity = (k: SenseKey) => `${norm(k.headword)}|${k.pos}|${norm(k.sense_en)}`
const headPos = (k: { headword: string; pos: string }) => `${norm(k.headword)}|${k.pos}`

/**
 * An ID for each sense (Decision 10). An exact (headword, POS, gloss) match
 * keeps its ID. Failing that, a headword and POS with one sense on each side
 * keep theirs, because the gloss of a lone sense is only a label, and the new
 * gloss is recorded. Anything else gets the next number for its slug.
 */
export function assignIds(registry: Registry, keys: readonly SenseKey[]): { registry: Registry; ids: string[] } {
  const seen = new Set<string>()
  for (const k of keys) {
    if (seen.has(identity(k))) throw new Error(`${k.headword} (${k.pos}, "${k.sense_en}") appears twice`)
    seen.add(identity(k))
  }
  const entries = [...registry.entries]
  const byIdentity = new Map(entries.map((e, i) => [identity(e), i]))
  const ids: (string | null)[] = keys.map((k) => {
    const i = byIdentity.get(identity(k))
    return i === undefined ? null : entries[i]!.entry_id
  })
  const used = new Set(ids.filter((id): id is string => id !== null))

  const keysByHead = new Map<string, number[]>()
  keys.forEach((k, i) => keysByHead.set(headPos(k), [...(keysByHead.get(headPos(k)) ?? []), i]))
  const entriesByHead = new Map<string, number[]>()
  entries.forEach((e, i) => entriesByHead.set(headPos(e), [...(entriesByHead.get(headPos(e)) ?? []), i]))
  for (const [head, ks] of keysByHead) {
    const es = entriesByHead.get(head) ?? []
    if (ks.length !== 1 || es.length !== 1) continue
    const k = ks[0]!
    const e = es[0]!
    if (ids[k] !== null || used.has(entries[e]!.entry_id)) continue
    ids[k] = entries[e]!.entry_id
    used.add(entries[e]!.entry_id)
    entries[e] = { ...entries[e]!, sense_en: keys[k]!.sense_en }
  }

  const highest = new Map<string, number>()
  for (const e of entries) {
    const m = /^(.*)-(\d+)$/.exec(e.entry_id)
    if (m) highest.set(m[1]!, Math.max(highest.get(m[1]!) ?? 0, Number(m[2])))
  }
  const out = ids.map((id, i) => {
    if (id !== null) return id
    const k = keys[i]!
    const slug = slugOf(k.headword)
    const n = (highest.get(slug) ?? 0) + 1
    highest.set(slug, n)
    const entryId = `${slug}-${n}`
    entries.push({ entry_id: entryId, headword: norm(k.headword), pos: k.pos, sense_en: k.sense_en, pinned: false })
    return entryId
  })
  return { registry: { entries, units: registry.units }, ids: out }
}

/** The registry a new content repository starts from: the sample's IDs, pinned, and its units (Decision 9). */
export function registryFromSample(pack: Pack): Registry {
  return {
    entries: pack.entries.map((e) => ({ entry_id: e.entry_id, headword: e.headword, pos: e.pos, sense_en: '', pinned: true })),
    units: pack.units.map((u) => ({ unit_id: u.unit_id, level: u.level, entry_ids: [...u.entry_ids] })),
  }
}
```

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- registry`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/registry.ts pipeline/src/registry.test.ts
git commit -m "feat(pipeline): the entry ID registry, seeded from the sample"
```

---

### Task 8: Translations, sense merging and selection

Each sense gets its L1 translation set: a primary translation, up to four accepted alternates and an L1 sense gloss. Senses of one headword and part of speech then merge where every L1 agrees (Decision 8). Selection picks the live entries per level (Decision 9).

**Files:**
- Create: `pipeline/src/stages/translate.ts`, `pipeline/src/stages/translate.test.ts`, `pipeline/src/select.ts`, `pipeline/src/select.test.ts`

**Interfaces:**
- Consumes: `StageRun` (Task 5); `ParseError` (Task 4); `cachedBatch` (Task 4); `norm`, `CefrLevel`, `levelIndex`, `PartOfSpeech` (`@wordado/core`).
- Produces:
  - `TRANSLATE_VERSION = 1`
  - `interface TranslationFields { readonly translation: string; readonly alternates: readonly string[]; readonly sense: string }`
  - `interface TranslateItem { readonly headword: string; readonly pos: PartOfSpeech; readonly gloss: string; readonly example: string }`
  - `L1_GUIDES: Readonly<Record<string, string>>`
  - `translateSenses(l1: string, items: readonly TranslateItem[], run: StageRun): Promise<TranslationFields[]>`
  - `mergeSenses<T extends { readonly headword: string; readonly pos: string; readonly l1: Readonly<Record<string, TranslationFields>> }>(senses: readonly T[], l1s: readonly string[]): T[]`
  - `interface SelectCandidate { readonly entry_id: string; readonly level: CefrLevel; readonly rank: number; readonly order: number; readonly pinned: boolean; readonly wasLive: boolean; readonly dropped: boolean }`
  - `selectLive(candidates: readonly SelectCandidate[], levels: readonly CefrLevel[], targets: Readonly<Record<CefrLevel, number>>): Set<string>`

- [ ] **Step 1: Write the failing tests**

`pipeline/src/stages/translate.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { L1_GUIDES, mergeSenses, translateSenses } from './translate'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'translate-')), 'translate.jsonl')),
  concurrency: 1,
  offline: false,
})
const items = [{ headword: 'water', pos: 'noun' as const, gloss: '', example: 'Water, please.' }]

describe('translateSenses', () => {
  it('trims, drops alternates equal to the primary or to each other, and keeps at most four', async () => {
    const out = await translateSenses('bg', items, run(() => ({
      items: [{ key: '0', translation: ' вода ', alternates: ['Вода', 'водичка', 'водичка', 'a', 'b', 'c', 'd'], sense: '' }],
    })))
    expect(out).toEqual([{ translation: 'вода', alternates: ['водичка', 'a', 'b', 'c'], sense: '' }])
  })

  it('sends the L1’s guide with the request, and refuses an L1 without one', async () => {
    const r = run(() => ({ items: [{ key: '0', translation: 'вода', alternates: [], sense: '' }] }))
    await translateSenses('bg', items, r)
    expect((r.llm as ReturnType<typeof fakeLlm>).calls[0]!.input).toMatchObject({ l1: 'bg' })
    expect(L1_GUIDES['bg']).toMatch(/Bulgarian/)
    await expect(translateSenses('xx', items, r)).rejects.toThrow(/no translation guide for xx/)
  })

  it('rejects a response that answers other items than it was asked', async () => {
    await expect(translateSenses('bg', items, run(() => ({ items: [{ key: '1', translation: 'вода', alternates: [], sense: '' }] })))).rejects.toThrow(/answers other items/)
  })

  it('rejects an empty primary translation', async () => {
    await expect(translateSenses('bg', items, run(() => ({ items: [{ key: '0', translation: ' ', alternates: [], sense: '' }] })))).rejects.toThrow(/empty translation/)
  })
})

describe('mergeSenses (Decision 8)', () => {
  const t = (translation: string) => ({ translation, alternates: [], sense: '' })
  const s = (gloss: string, bg: string, es?: string) => ({ headword: 'bank', pos: 'noun', gloss, l1: es ? { bg: t(bg), es: t(es) } : { bg: t(bg) } })

  it('merges senses whose primary translations agree, keeping the first', () => {
    expect(mergeSenses([s('money', 'банка'), s('building', 'Банка '), s('river', 'бряг')], ['bg']).map((x) => x.gloss)).toEqual(['money', 'river'])
  })

  it('keeps senses apart when any one L1 tells them apart', () => {
    expect(mergeSenses([s('money', 'банка', 'banco'), s('building', 'банка', 'sucursal')], ['bg', 'es'])).toHaveLength(2)
  })

  it('never merges across parts of speech', () => {
    expect(mergeSenses([s('money', 'банка'), { ...s('', 'банка'), pos: 'verb' }], ['bg'])).toHaveLength(2)
  })
})
```

`pipeline/src/select.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { selectLive, type SelectCandidate } from './select'

const c = (entry_id: string, level: 'A1' | 'A2' | 'B2', rank: number, extra: Partial<SelectCandidate> = {}): SelectCandidate => ({
  entry_id, level, rank, order: 0, pinned: false, wasLive: false, dropped: false, ...extra,
})
const targets = { A1: 2, A2: 1, B1: 1, B2: 1, C1: 1 }

describe('selectLive (Decision 9)', () => {
  it('fills each shipped level by rank up to its target', () => {
    expect([...selectLive([c('a', 'A1', 3), c('b', 'A1', 1), c('c', 'A1', 2), c('d', 'A2', 5), c('e', 'B2', 1)], ['A1', 'A2'], targets)].sort()).toEqual(['b', 'c', 'd'])
  })

  it('keeps pinned and previously live entries even past the target, and counts them toward it', () => {
    const out = selectLive([c('a', 'A1', 1), c('b', 'A1', 2), c('p', 'A1', 900, { pinned: true }), c('w', 'A1', 800, { wasLive: true })], ['A1'], targets)
    expect([...out].sort()).toEqual(['p', 'w'])
  })

  it('leaves out a dropped entry, even a pinned or previously live one', () => {
    expect([...selectLive([c('p', 'A1', 1, { pinned: true, dropped: true }), c('w', 'A1', 2, { wasLive: true, dropped: true })], ['A1'], targets)]).toEqual([])
  })

  it('breaks rank ties by sense order, then ID', () => {
    expect([...selectLive([c('y', 'A1', 1, { order: 1 }), c('x', 'A1', 1, { order: 1 }), c('z', 'A1', 1, { order: 0 })], ['A1'], targets)]).toEqual(['z', 'x'])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- translate select`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`pipeline/src/stages/translate.ts`:

```ts
import { norm, type PartOfSpeech } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { StageRun } from './lemmas'

export const TRANSLATE_VERSION = 1

/** An entry's L1 side (spec §5.2): one primary translation, accepted alternates, and a sense gloss. */
export interface TranslationFields {
  readonly translation: string
  readonly alternates: readonly string[]
  /** A few L1 words telling this sense apart; shipped only when the headword and POS have several live entries (Decision 8). */
  readonly sense: string
}

export interface TranslateItem {
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly gloss: string
  readonly example: string
}

/**
 * How to translate into each L1. A new L1 (spec §14, Phase 1b) adds its guide
 * here and its code to `pipeline.json`; nothing else changes.
 */
export const L1_GUIDES: Readonly<Record<string, string>> = {
  bg: `Translate into Bulgarian, in Cyrillic, as a bilingual dictionary would.
- Nouns: the indefinite singular (вода, not водата).
- Verbs: the first person singular present, the Bulgarian dictionary form (пиша). When both aspects are common, give the imperfective as the translation and the perfective among the alternates (пиша; напиша).
- Adjectives: the masculine singular (голям).
- Interjections and phrases: what a Bulgarian speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four Bulgarian words that tell this sense apart from the headword's other senses (for bank: "за пари", "на река"). Empty when the gloss is empty.
Use standard literary Bulgarian. No transliteration, no English words, no explanations in brackets.`,
}

const SYSTEM = (guide: string) => `You translate an English vocabulary course for adult learners.
For each item, in the order given, translate the English headword in the sense its gloss and example show.
${guide}
Return one item per input item, with "key" exactly as given, and nothing else.`

const SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          translation: { type: 'string' },
          alternates: { type: 'array', items: { type: 'string' } },
          sense: { type: 'string' },
        },
        required: ['key', 'translation', 'alternates', 'sense'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
} as const

const BATCH = 20
const clean = (s: unknown) => String(s ?? '').replaceAll('|', '/').replace(/\s+/g, ' ').trim()

function parse(count: number) {
  return (value: unknown): TranslationFields[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== count) throw new ParseError('answers other items than it was asked')
    return items.map((raw, i) => {
      const item = raw as Record<string, unknown>
      if (item['key'] !== String(i)) throw new ParseError(`answers other items than it was asked: item ${i} has key ${JSON.stringify(item['key'])}`)
      const translation = clean(item['translation'])
      if (translation === '') throw new ParseError(`item ${i}: empty translation`)
      const seen = new Set([norm(translation)])
      const alternates: string[] = []
      for (const a of Array.isArray(item['alternates']) ? item['alternates'] : []) {
        const alt = clean(a)
        if (alt === '' || seen.has(norm(alt))) continue
        seen.add(norm(alt))
        alternates.push(alt)
      }
      return { translation, alternates: alternates.slice(0, 4), sense: clean(item['sense']) }
    })
  }
}

export async function translateSenses(l1: string, items: readonly TranslateItem[], run: StageRun): Promise<TranslationFields[]> {
  const guide = L1_GUIDES[l1]
  if (guide === undefined) throw new Error(`no translation guide for ${l1}; add one to L1_GUIDES`)
  return cachedBatch({
    cache: run.cache,
    stage: `translate-${l1}`,
    version: TRANSLATE_VERSION,
    items,
    keyInput: (item) => item,
    batchSize: BATCH,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) =>
      run.llm.json({
        name: 'translate',
        system: SYSTEM(guide),
        input: { l1, items: batch.map((item, i) => ({ key: String(i), ...item })) },
        schema: SCHEMA,
        parse: parse(batch.length),
      }),
  })
}

/** Senses of one headword and POS merge when every L1's primary translation agrees: the pipeline splits only where translations diverge (spec §5.2). */
export function mergeSenses<T extends { readonly headword: string; readonly pos: string; readonly l1: Readonly<Record<string, TranslationFields>> }>(
  senses: readonly T[],
  l1s: readonly string[],
): T[] {
  const kept: T[] = []
  const signatures = new Set<string>()
  for (const s of senses) {
    const signature = [norm(s.headword), s.pos, ...l1s.map((l) => norm(s.l1[l]?.translation ?? ''))].join('|')
    if (signatures.has(signature)) continue
    signatures.add(signature)
    kept.push(s)
  }
  return kept
}
```

`pipeline/src/select.ts`:

```ts
import type { CefrLevel } from '@wordado/core'

export interface SelectCandidate {
  readonly entry_id: string
  readonly level: CefrLevel
  /** The lemma's frequency rank. */
  readonly rank: number
  /** The sense's position among its lemma's senses. */
  readonly order: number
  readonly pinned: boolean
  /** Live in the last published pack. */
  readonly wasLive: boolean
  /** A reviewer dropped it. */
  readonly dropped: boolean
}

/**
 * The live entries (Decision 9). Pinned and previously live entries stay,
 * so a learner's words never vanish between versions. They count toward
 * their level's target (spec §5.3), which the most frequent of the rest fill.
 * A dropped entry is never live. An entry of a level this corpus does not
 * ship is never live.
 */
export function selectLive(candidates: readonly SelectCandidate[], levels: readonly CefrLevel[], targets: Readonly<Record<CefrLevel, number>>): Set<string> {
  const live = new Set<string>()
  const count = new Map<CefrLevel, number>()
  const add = (c: SelectCandidate) => {
    live.add(c.entry_id)
    count.set(c.level, (count.get(c.level) ?? 0) + 1)
  }
  const shipped = candidates.filter((c) => levels.includes(c.level) && !c.dropped)
  for (const c of shipped) if (c.pinned || c.wasLive) add(c)
  const rest = shipped
    .filter((c) => !live.has(c.entry_id))
    .sort((a, b) => a.rank - b.rank || a.order - b.order || (a.entry_id < b.entry_id ? -1 : a.entry_id > b.entry_id ? 1 : 0))
  for (const c of rest) if ((count.get(c.level) ?? 0) < targets[c.level]) add(c)
  return live
}
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- translate select`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/stages/translate.ts pipeline/src/stages/translate.test.ts pipeline/src/select.ts pipeline/src/select.test.ts
git commit -m "feat(pipeline): L1 translations, sense merging and live selection"
```

---

### Task 9: Decision events

A reviewer's verdict is an event bound to the proposal it judged (Decision 5). `foldField` replays a field's events over its current proposal. It is the one place that says what a field's value is, whether it is reviewed, and whether it was dropped.

**Files:**
- Create: `pipeline/src/decisions.ts`, `pipeline/src/decisions.test.ts`

**Interfaces:**
- Consumes: `canonicalJson` (`@wordado/core`); `readJsonl`, `appendJsonl` (Task 1); `contentPaths` (Task 2).
- Produces:
  - `type Verdict = 'ok' | 'fix' | 'drop' | 'reopen' | 'redo'`
  - `interface DecisionEvent { readonly key: string; readonly at: string; readonly verdict: Verdict; readonly proposed?: unknown; readonly value?: unknown; readonly by: string; readonly note?: string }`
  - `interface FieldState<T> { readonly value: T; readonly reviewed: boolean; readonly dropped: boolean; readonly reopened: boolean; readonly stale: number }`
  - `foldField<T>(proposal: T, events: readonly DecisionEvent[]): FieldState<T>`
  - `QUEUES = { english: 'english', level: 'level', audio: 'audio', translation: (l1: string) => \`translation-${l1}\`, title: (l1: string) => \`title-${l1}\` }`
  - `class Decisions { static read(dir: string): Decisions; for(queue: string, key: string): readonly DecisionEvent[]; all(queue: string): readonly DecisionEvent[]; append(queue: string, events: readonly DecisionEvent[]): void }`

- [ ] **Step 1: Write the failing test**

`pipeline/src/decisions.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Decisions, foldField, type DecisionEvent } from './decisions'

const p = { translation: 'вода', alternates: [], sense: '' }
const ev = (e: Partial<DecisionEvent> & Pick<DecisionEvent, 'verdict'>): DecisionEvent => ({ key: 'water-1', at: '2026-10-01T00:00:00Z', by: 'r', ...e })

describe('foldField (Decision 5)', () => {
  it('is unreviewed with no events', () => {
    expect(foldField(p, [])).toEqual({ value: p, reviewed: false, dropped: false, reopened: false, stale: 0 })
  })

  it('an ok on this proposal reviews it; key order does not matter', () => {
    expect(foldField(p, [ev({ verdict: 'ok', proposed: { sense: '', alternates: [], translation: 'вода' } })]).reviewed).toBe(true)
  })

  it('a fix replaces the value and reviews it', () => {
    const fixed = { ...p, alternates: ['водичка'] }
    expect(foldField(p, [ev({ verdict: 'fix', proposed: p, value: fixed })])).toMatchObject({ value: fixed, reviewed: true })
  })

  it('a verdict on another proposal is stale and changes nothing', () => {
    expect(foldField(p, [ev({ verdict: 'ok', proposed: { ...p, translation: 'водата' } })])).toMatchObject({ reviewed: false, stale: 1 })
  })

  it('a reopen after a fix keeps the fixed value but asks for review again; an ok on the fixed value closes it', () => {
    const fixed = { ...p, translation: 'водица' }
    const events = [ev({ verdict: 'fix', proposed: p, value: fixed }), ev({ verdict: 'reopen', by: 'reports' })]
    expect(foldField(p, events)).toMatchObject({ value: fixed, reviewed: false, reopened: true })
    expect(foldField(p, [...events, ev({ verdict: 'ok', proposed: fixed })])).toMatchObject({ value: fixed, reviewed: true, reopened: false })
  })

  it('a drop on this proposal drops the entry', () => {
    expect(foldField(p, [ev({ verdict: 'drop', proposed: p })])).toMatchObject({ dropped: true, reviewed: true })
  })
})

describe('Decisions', () => {
  it('appends events per queue and reads them back by key in order', () => {
    const dir = mkdtempSync(join(tmpdir(), 'decisions-'))
    Decisions.read(dir).append('translation-bg', [ev({ verdict: 'ok', proposed: p }), ev({ key: 'bread-1', verdict: 'drop', proposed: p })])
    Decisions.read(dir).append('translation-bg', [ev({ verdict: 'reopen' })])
    const d = Decisions.read(dir)
    expect(d.for('translation-bg', 'water-1').map((e) => e.verdict)).toEqual(['ok', 'reopen'])
    expect(d.for('english', 'water-1')).toEqual([])
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- decisions`
Expected: FAIL, "Failed to resolve import './decisions'".

- [ ] **Step 3: Implement**

`pipeline/src/decisions.ts`:

```ts
import { readdirSync } from 'node:fs'
import { basename } from 'node:path'
import { canonicalJson } from '@wordado/core'
import { contentPaths } from './content'
import { appendJsonl, readJsonl } from './files'

export type Verdict = 'ok' | 'fix' | 'drop' | 'reopen' | 'redo'

/** One reviewer or triage verdict on one item of one queue (Decision 5). Append-only. */
export interface DecisionEvent {
  /** An entry ID, a unit ID (title queues) or a clip ID (audio). */
  readonly key: string
  /** ISO 8601. */
  readonly at: string
  readonly verdict: Verdict
  /** The value the reviewer saw; ok, fix and drop apply only while it is still the value. */
  readonly proposed?: unknown
  /** The corrected value, for fix. */
  readonly value?: unknown
  /** The reviewer's name, or "reports" for triage. */
  readonly by: string
  readonly note?: string
}

export interface FieldState<T> {
  readonly value: T
  readonly reviewed: boolean
  readonly dropped: boolean
  /** Reports sent it back to review (spec §8.10). */
  readonly reopened: boolean
  /** Verdicts on a proposal that is no longer current. */
  readonly stale: number
}

export const QUEUES = {
  english: 'english',
  level: 'level',
  audio: 'audio',
  translation: (l1: string) => `translation-${l1}`,
  title: (l1: string) => `title-${l1}`,
} as const

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)

/** A field's value and review state: its proposal with its events replayed in order. */
export function foldField<T>(proposal: T, events: readonly DecisionEvent[]): FieldState<T> {
  let value = proposal
  let reviewed = false
  let dropped = false
  let reopened = false
  let stale = 0
  for (const e of events) {
    if (e.verdict === 'reopen') {
      reviewed = false
      reopened = true
      continue
    }
    if (e.verdict === 'redo') continue
    if (!same(e.proposed, value)) {
      stale += 1
      continue
    }
    if (e.verdict === 'fix') value = e.value as T
    if (e.verdict === 'drop') dropped = true
    reviewed = true
    reopened = false
  }
  return { value, reviewed, dropped, reopened, stale }
}

/** Every queue's events, read once per command. */
export class Decisions {
  private constructor(
    private readonly dir: string,
    private readonly byQueue: Map<string, DecisionEvent[]>,
  ) {}

  static read(dir: string): Decisions {
    const paths = contentPaths(dir)
    const byQueue = new Map<string, DecisionEvent[]>()
    let files: string[] = []
    try {
      files = readdirSync(paths.decisionsDir).filter((f) => f.endsWith('.jsonl'))
    } catch {
      files = []
    }
    for (const f of files) byQueue.set(basename(f, '.jsonl'), readJsonl<DecisionEvent>(paths.decisions(basename(f, '.jsonl'))))
    return new Decisions(dir, byQueue)
  }

  all(queue: string): readonly DecisionEvent[] {
    return this.byQueue.get(queue) ?? []
  }

  for(queue: string, key: string): readonly DecisionEvent[] {
    return this.all(queue).filter((e) => e.key === key)
  }

  append(queue: string, events: readonly DecisionEvent[]): void {
    appendJsonl(contentPaths(this.dir).decisions(queue), events)
    this.byQueue.set(queue, [...this.all(queue), ...events])
  }
}
```

`for` is a linear scan per call. With about 3,100 entries across five queues that is ~10⁷ comparisons per run, which is acceptable. If a profile ever shows otherwise, index by key in `read`.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- decisions`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/decisions.ts pipeline/src/decisions.test.ts
git commit -m "feat(pipeline): decision events bound to the proposal they judged"
```

---
### Task 10: Units and unit titles

Units are about 20 thematically related words (§7.2). An entry keeps its unit across versions, and only new live entries are placed (Decision 9). The LLM names each unit in English and in every L1, and those names go to the `title-<l1>` queue.

**Files:**
- Create: `pipeline/src/units.ts`, `pipeline/src/units.test.ts`, `pipeline/src/stages/titles.ts`, `pipeline/src/stages/titles.test.ts`

**Interfaces:**
- Consumes: `RegistryUnit` (Task 7); `StageRun` (Task 5); `cachedBatch`, `ParseError` (Task 4); `CefrLevel`, `levelIndex`, `LocalizedText` (`@wordado/core`).
- Produces:
  - `interface UnitCandidate { readonly entry_id: string; readonly level: CefrLevel; readonly theme: string; readonly rank: number; readonly order: number }`
  - `assignUnits(units: readonly RegistryUnit[], live: readonly UnitCandidate[], published: ReadonlySet<string>, unitSize: number): RegistryUnit[]`
  - `inPathOrder(units: readonly RegistryUnit[]): RegistryUnit[]` (by level, then unit number)
  - `TITLES_VERSION = 1`
  - `interface TitleUnit { readonly unit_id: string; readonly level: CefrLevel; readonly words: readonly string[] }`
  - `titleUnits(units: readonly TitleUnit[], l1s: readonly string[], run: StageRun): Promise<Map<string, Readonly<Record<string, LocalizedText>>>>` (unit ID → L1 → `{ en, l1 }`)

- [ ] **Step 1: Write the failing tests**

`pipeline/src/units.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assignUnits, inPathOrder, type UnitCandidate } from './units'

const c = (entry_id: string, level: 'A1' | 'A2', theme: string, rank: number): UnitCandidate => ({ entry_id, level, theme, rank, order: 0 })

describe('assignUnits (spec §7.2, Decision 9)', () => {
  it('leaves placed entries where they are and appends new units after a level’s last', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['a'] }]
    const out = assignUnits(units, [c('a', 'A1', 'food', 1), c('b', 'A1', 'food', 2)], new Set(['a']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['a'] },
      { unit_id: 'a1-02', level: 'A1', entry_ids: ['b'] },
    ])
  })

  it('groups new words by theme, themes in order of their most frequent word, in units of the given size', () => {
    const live = [c('f1', 'A1', 'food', 5), c('h1', 'A1', 'home', 1), c('f2', 'A1', 'food', 6), c('h2', 'A1', 'home', 2), c('f3', 'A1', 'food', 7)]
    expect(assignUnits([], live, new Set(), 2).map((u) => u.entry_ids)).toEqual([['h1', 'h2'], ['f1', 'f2', 'f3']])
  })

  it('folds a last unit under half the size into the one before it', () => {
    const live = [1, 2, 3, 4, 5].map((r) => c(`w${r}`, 'A1', 'x', r))
    expect(assignUnits([], live, new Set(), 4).map((u) => u.entry_ids.length)).toEqual([5])
  })

  it('moves an entry whose level changed out of its unit, but keeps a retired published entry in place', () => {
    const units = [{ unit_id: 'a1-01', level: 'A1' as const, entry_ids: ['moved', 'retired', 'kept', 'never'] }]
    const out = assignUnits(units, [c('moved', 'A2', 'x', 1), c('kept', 'A1', 'x', 2)], new Set(['moved', 'retired', 'kept']), 20)
    expect(out).toEqual([
      { unit_id: 'a1-01', level: 'A1', entry_ids: ['retired', 'kept'] },
      { unit_id: 'a2-01', level: 'A2', entry_ids: ['moved'] },
    ])
  })

  it('never reuses a unit number, even of a unit that is now empty', () => {
    const units = [{ unit_id: 'a1-07', level: 'A1' as const, entry_ids: ['gone'] }]
    expect(assignUnits(units, [c('n', 'A1', 'x', 1)], new Set(), 20).map((u) => u.unit_id)).toEqual(['a1-07', 'a1-08'])
  })
})

describe('inPathOrder', () => {
  it('orders by level, then unit number', () => {
    const u = (unit_id: string, level: 'A1' | 'A2') => ({ unit_id, level, entry_ids: ['x'] })
    expect(inPathOrder([u('a2-01', 'A2'), u('a1-10', 'A1'), u('a1-02', 'A1')]).map((x) => x.unit_id)).toEqual(['a1-02', 'a1-10', 'a2-01'])
  })
})
```

`pipeline/src/stages/titles.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StageCache } from '../cache'
import { fakeLlm } from '../llm'
import { titleUnits } from './titles'

const run = (answer: (n: string, i: unknown) => unknown) => ({
  llm: fakeLlm(answer),
  cache: StageCache.open(join(mkdtempSync(join(tmpdir(), 'titles-')), 'titles.jsonl')),
  concurrency: 1,
  offline: false,
})

describe('titleUnits', () => {
  it('names each unit in English and every L1', async () => {
    const out = await titleUnits([{ unit_id: 'a1-04', level: 'A1', words: ['bread', 'milk'] }], ['bg'], run(() => ({ items: [{ unit: 'a1-04', en: ' Food ', bg: 'Храна' }] })))
    expect(out.get('a1-04')).toEqual({ bg: { en: 'Food', l1: 'Храна' } })
  })

  it('rejects a response that answers other items than it was asked, or leaves an L1 empty', async () => {
    const units = [{ unit_id: 'a1-04', level: 'A1' as const, words: ['bread'] }]
    await expect(titleUnits(units, ['bg'], run(() => ({ items: [{ unit: 'a1-05', en: 'x', bg: 'y' }] })))).rejects.toThrow(/answers other items/)
    await expect(titleUnits(units, ['bg'], run(() => ({ items: [{ unit: 'a1-04', en: 'x', bg: ' ' }] })))).rejects.toThrow(/bg title/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- units titles`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`pipeline/src/units.ts`:

```ts
import { levelIndex, type CefrLevel } from '@wordado/core'
import type { RegistryUnit } from './registry'

export interface UnitCandidate {
  readonly entry_id: string
  readonly level: CefrLevel
  /** The entry's first (most relevant) theme, or '' for none. */
  readonly theme: string
  readonly rank: number
  readonly order: number
}

const unitNumber = (unitId: string) => Number(/-(\d+)$/.exec(unitId)?.[1] ?? 0)

/**
 * The units after this draft (spec §7.2, Decision 9). A live entry stays in
 * its unit while its level matches. A published entry that is no longer live
 * stays too, retired. An entry that was never published and is no longer
 * live leaves. New live entries are grouped by theme, with themes ordered by
 * their most frequent new word, then cut into units of `unitSize`. A last
 * unit under half that size joins the one before it. New unit IDs continue
 * each level's numbering, so none is ever reused.
 */
export function assignUnits(units: readonly RegistryUnit[], live: readonly UnitCandidate[], published: ReadonlySet<string>, unitSize: number): RegistryUnit[] {
  const liveById = new Map(live.map((c) => [c.entry_id, c]))
  const kept = units.map((u) => ({
    ...u,
    entry_ids: u.entry_ids.filter((id) => {
      const c = liveById.get(id)
      return c ? c.level === u.level : published.has(id)
    }),
  }))
  const placed = new Set(kept.flatMap((u) => u.entry_ids))
  const out: RegistryUnit[] = [...kept]
  const levels = [...new Set(live.map((c) => c.level))].sort((a, b) => levelIndex(a) - levelIndex(b))
  for (const level of levels) {
    const fresh = live.filter((c) => c.level === level && !placed.has(c.entry_id))
    if (fresh.length === 0) continue
    const themeRank = new Map<string, number>()
    for (const c of fresh) themeRank.set(c.theme, Math.min(themeRank.get(c.theme) ?? Infinity, c.rank))
    fresh.sort(
      (a, b) =>
        themeRank.get(a.theme)! - themeRank.get(b.theme)! ||
        (a.theme < b.theme ? -1 : a.theme > b.theme ? 1 : 0) ||
        a.rank - b.rank ||
        a.order - b.order ||
        (a.entry_id < b.entry_id ? -1 : 1),
    )
    const chunks: string[][] = []
    for (let i = 0; i < fresh.length; i += unitSize) chunks.push(fresh.slice(i, i + unitSize).map((c) => c.entry_id))
    const last = chunks.at(-1)!
    if (chunks.length > 1 && last.length < Math.ceil(unitSize / 2)) {
      chunks.pop()
      chunks[chunks.length - 1]!.push(...last)
    }
    const prefix = level.toLowerCase()
    let n = Math.max(0, ...out.filter((u) => u.unit_id.startsWith(`${prefix}-`)).map((u) => unitNumber(u.unit_id)))
    for (const entry_ids of chunks) {
      n += 1
      out.push({ unit_id: `${prefix}-${String(n).padStart(2, '0')}`, level, entry_ids })
    }
  }
  return out
}

/** The path: levels in CEFR order, units by number within a level (spec §7.2). */
export function inPathOrder(units: readonly RegistryUnit[]): RegistryUnit[] {
  return [...units].sort((a, b) => levelIndex(a.level) - levelIndex(b.level) || unitNumber(a.unit_id) - unitNumber(b.unit_id) || (a.unit_id < b.unit_id ? -1 : 1))
}
```

The "moves an entry" test: `never` is neither live nor published, so it leaves. `retired` is published and not live, so it stays. `moved` is live at A2 in an A1 unit, so it leaves, and it is the only new A2 entry, so it becomes `a2-01`.

`pipeline/src/stages/titles.ts`:

```ts
import type { CefrLevel, LocalizedText } from '@wordado/core'
import { cachedBatch } from '../cache'
import { ParseError } from '../llm'
import type { StageRun } from './lemmas'

export const TITLES_VERSION = 1

export interface TitleUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly words: readonly string[]
}

const SYSTEM = (l1s: readonly string[]) => `You name the units of an English vocabulary course for adult learners.
For each unit, in the order given, write a title of two to four words that says what its words have in common ("Food and drink", "At home"), in English ("en", title words in sentence case) and in each of these languages, as a native speaker would title a textbook unit: ${l1s.join(', ')}.
Return one item per unit with "unit" exactly as given.`

function schema(l1s: readonly string[]) {
  const props: Record<string, unknown> = { unit: { type: 'string' }, en: { type: 'string' } }
  for (const l1 of l1s) props[l1] = { type: 'string' }
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

type Titles = Readonly<Record<string, LocalizedText>>

function parse(asked: readonly string[], l1s: readonly string[]) {
  return (value: unknown): Titles[] => {
    const items = (value as { items?: unknown }).items
    if (!Array.isArray(items) || items.length !== asked.length) throw new ParseError('answers other items than it was asked')
    return items.map((raw, i) => {
      const item = raw as Record<string, unknown>
      if (item['unit'] !== asked[i]) throw new ParseError(`answers other items than it was asked: item ${i} is ${JSON.stringify(item['unit'])}`)
      const en = String(item['en'] ?? '').trim()
      if (en === '') throw new ParseError(`${asked[i]}: empty en title`)
      const out: Record<string, LocalizedText> = {}
      for (const l1 of l1s) {
        const text = String(item[l1] ?? '').trim()
        if (text === '') throw new ParseError(`${asked[i]}: empty ${l1} title`)
        out[l1] = { en, l1: text }
      }
      return out
    })
  }
}

/** A title per unit, per L1. A unit whose words change is named again, and its title goes back to review. */
export async function titleUnits(units: readonly TitleUnit[], l1s: readonly string[], run: StageRun): Promise<Map<string, Titles>> {
  const titles = await cachedBatch({
    cache: run.cache,
    stage: 'titles',
    version: TITLES_VERSION,
    items: units,
    keyInput: (u) => ({ level: u.level, words: [...u.words].sort(), l1s }),
    batchSize: 10,
    concurrency: run.concurrency,
    offline: run.offline,
    run: (batch) =>
      run.llm.json({
        name: 'titles',
        system: SYSTEM(l1s),
        input: { units: batch.map((u) => ({ unit: u.unit_id, level: u.level, words: u.words })) },
        schema: schema(l1s),
        parse: parse(batch.map((u) => u.unit_id), l1s),
      }),
  })
  return new Map(units.map((u, i) => [u.unit_id, titles[i]!]))
}
```

The cache key leaves out the unit ID. A unit with the same words keeps its title, and two units cannot share words.

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- units titles`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/units.ts pipeline/src/units.test.ts pipeline/src/stages/titles.ts pipeline/src/stages/titles.test.ts
git commit -m "feat(pipeline): units by theme and their titles"
```

---

### Task 11: The content directory, the last published snapshot and the draft

`corpus init` seeds a content directory from the sample: the template's files, a registry with the sample pinned, the curated themes, and `last-published/` holding the sample (v0). `corpus draft` runs every LLM stage in order, assigns IDs, folds the level and drop decisions, selects, places units and names them. It writes `registry.json` and `work/draft.json`. Words in `essentials.txt`, a curated list of everyday spoken words that frequency lists rank too low (Decision 19), are always described. Their senses are live at the LLM's level, and every one goes to banding review. A fixture content directory built on the sample, and a fake LLM that answers from the sample, serve this task's test and every later one.

**Files:**
- Create: `pipeline/template/pipeline.json`, `pipeline/template/sources.json`, `pipeline/template/README.md`, `pipeline/template/.gitignore`, `pipeline/template/essentials.txt`
- Create: `pipeline/src/lastPublished.ts`, `pipeline/src/lastPublished.test.ts`, `pipeline/src/init.ts`, `pipeline/src/draft.ts`, `pipeline/src/draft.test.ts`, `pipeline/src/testing/fixture.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–10; `validateManifest`, `validatePack`, `Pack`, `PackManifest`, `ReportField`, `CefrLevel`, `LocalizedText`, `PartOfSpeech` (`@wordado/core`); `sha256Hex`.
- Produces:
  - `interface Fix { readonly word_id: string; readonly field: ReportField; readonly fixed_in: number }`; `interface FixesFile { readonly schema_version: 1; readonly corpus_version: number; readonly fixes: readonly Fix[] }`
  - `interface LastPublished { readonly manifest: PackManifest; readonly packs: ReadonlyMap<string, Pack>; readonly packBytes: ReadonlyMap<string, Uint8Array>; readonly fixes: FixesFile; readonly live: ReadonlySet<string>; readonly published: ReadonlySet<string> }` (packs keyed by L1)
  - `readLastPublished(dir: string): LastPublished` (throws on a missing file or a checksum mismatch)
  - `SAMPLE_DIR: string` (absolute path of `pipeline/samples/a1-bg`), `TEMPLATE_DIR: string`
  - `initContent(dir: string): void` (refuses a non-empty directory)
  - `interface EnglishFields { readonly ipa: string; readonly variants: readonly string[]; readonly examples: readonly string[] }`
  - `interface DraftEntry { readonly entry_id: string; readonly headword: string; readonly pos: PartOfSpeech; readonly sense_en: string; readonly rank: number; readonly order: number; readonly pinned: boolean; readonly essential: boolean; readonly band: CefrLevel; readonly level_proposal: CefrLevel; readonly level: CefrLevel; readonly level_flagged: boolean; readonly themes: readonly string[]; readonly english: EnglishFields; readonly l1: Readonly<Record<string, TranslationFields>> }`
  - `interface DraftUnit { readonly unit_id: string; readonly level: CefrLevel; readonly entry_ids: readonly string[]; readonly titles: Readonly<Record<string, LocalizedText>> }`
  - `interface Draft { readonly live: readonly string[]; readonly entries: readonly DraftEntry[]; readonly units: readonly DraftUnit[]; readonly problems: readonly string[] }`
  - `runDraft(opts: { dir: string; llm: Llm; offline: boolean }): Promise<Draft>` (also writes `registry.json` and `work/draft.json`)
  - `readDraft(dir: string): Draft`
  - `readEssentials(dir: string): string[]` (normalised headwords; a missing file is an empty list)
  - Test helpers in `src/testing/fixture.ts`: `makeContent(overrides?: { config?: Partial<PipelineConfig> }): string`; `sampleLlm(): Llm & { calls: { name: string; input: unknown }[] }`; `FIXTURE_TSV: string`

- [ ] **Step 1: Write the template**

`pipeline/template/pipeline.json`:

```json
{
  "l1s": ["bg"],
  "levels": ["A1", "A2", "B1"],
  "targets": { "A1": 600, "A2": 1000, "B1": 1500, "B2": 2000, "C1": 2000 },
  "max_forms": 12000,
  "max_lemmas": 5000,
  "unit_size": 20,
  "report_threshold": 2,
  "llm": { "model": "anthropic/claude-sonnet-5", "concurrency": 4, "max_usd_per_run": 40 },
  "tts": {
    "model": "openai/gpt-4o-mini-tts-2025-12-15",
    "accents": {
      "uk": {
        "voice": "alloy",
        "instructions": "Say the English word or phrase once, clearly and naturally, in a neutral standard British accent. Nothing else."
      }
    },
    "max_clips_per_run": 4000
  }
}
```

`pipeline/template/sources.json`:

```json
[]
```

`pipeline/template/.gitignore`:

```
work/
.DS_Store
```

`pipeline/template/essentials.txt` (the starting list; reviewers extend it in the content repository):

```
# Everyday spoken words that frequency lists rank too low for their CEFR level (Decision 19).
# One headword per line. Each is described whatever its frequency; its senses are live at the LLM's level,
# and every one goes to banding review. Written in-house: no licence applies.

# greetings and politeness
hello
hi
goodbye
bye
please
thanks
thank you
sorry
excuse me
welcome
okay
yes
no
pardon
congratulations
good morning
good night
see you
of course
sure
maybe
oh
wow

# people and family
mum
dad
mother
father
parent
son
daughter
brother
sister
grandmother
grandfather
grandma
grandpa
aunt
uncle
cousin
husband
wife
baby
kid
friend
boyfriend
girlfriend
neighbour

# feelings and states
happy
sad
tired
hungry
thirsty
angry
scared
bored
excited
worried
sick
ill
fine
great
nice
lovely

# food and drink
breakfast
lunch
dinner
bread
butter
cheese
egg
milk
coffee
tea
juice
beer
wine
sandwich
soup
salad
pizza
pasta
rice
chicken
fish
meat
apple
banana
orange
tomato
potato
cake
chocolate
sugar
salt
ice cream

# at home
kitchen
bedroom
bathroom
toilet
shower
bed
sofa
fridge
cupboard
window
door
key
lamp
towel
soap
toothbrush

# things people carry and use
phone
mobile
email
computer
laptop
internet
wifi
password
app
camera
charger
TV
television
radio
ticket
bag
wallet
umbrella
glasses
watch

# around town and travel
bus
train
taxi
car
bike
airport
station
hotel
restaurant
cafe
shop
supermarket
pharmacy
hospital
post office
street
bridge
park
museum
beach
map

# time
today
tomorrow
yesterday
tonight
morning
afternoon
evening
night
weekend
Monday
Tuesday
Wednesday
Thursday
Friday
Saturday
Sunday

# weather and colours
weather
sun
rain
snow
hot
cold
warm
red
blue
green
yellow
black
white

# body and health
head
hand
eye
tooth
doctor
medicine
pain

# everyday actions
eat
drink
sleep
wake up
wash
cook
buy
pay
open
close
wait
help
sit
call
speak
listen
```

`pipeline/template/README.md`:

````markdown
# Wordado content

The corpus of [Wordado](https://github.com/wordado/wordado): the licence register, frequency lists, LLM results,
the ID registry, review decisions, audio and the last published packs. The pipeline that reads and writes this
repository is `pipeline/` in the public repository; its README is the runbook.

## Terms

Copyright © 2026 Yordan Mihaylov. All rights reserved. This repository is private. Its content is not covered by
the public repository's MIT licence, and it may not be copied, redistributed or used in another product without
permission. Frequency lists in `sources/` stay under their own licences, recorded in `sources.json`.

## Reviewing

Open a file in `review/<queue>/` in Excel, Numbers or Google Sheets. For each row:

- If the proposal is right, write `ok` in **verdict**.
- If it is nearly right, correct the cells in place, then write `ok`. Lists (alternates, variants, examples) are
  separated by ` | `.
- If the entry should not be in the course at all, write `drop`.
- For audio, listen to the file named in **listen**, then write `ok` or `redo`.

Leave a row's verdict empty to decide later. Save as CSV (UTF-8) with the same name, commit, and open a pull
request. The pipeline imports it with `corpus import`.

Queues: `translation-bg` (every translation set and its sense gloss), `english` (IPA, spelling variants and example
sentences), `level` (a sample of CEFR levels, and every level the frequency band disagreed with), `title-bg` (unit
titles), and `audio` (a sample of every batch, and every clip made again).
````

- [ ] **Step 2: Write the failing tests**

`pipeline/src/testing/fixture.ts`:

```ts
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pack } from '@wordado/core'
import type { PipelineConfig } from '../config'
import { writeJson } from '../files'
import { initContent, SAMPLE_DIR } from '../init'
import { fakeLlm } from '../llm'

/**
 * An invented frequency list: made up for the tests, so it needs no clearance.
 * The sample's words are pinned, so the list only has to bring new words:
 * `went` (a form of go), `bank` (three senses, two of which translate alike),
 * `the`, and `london` (a name, dropped).
 */
export const FIXTURE_TSV = 'form\tcount\nthe\t5000\nwent\t900\ngo\t800\nlondon\t400\nbank\t300\n'

const sample = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack

const EXTRA_SENSES: Record<string, unknown[]> = {
  the: [{ pos: 'det', gloss: '', level: 'A1', ipa: 'ðə', variants: [], themes: [], examples: ['The door is open.'] }],
  okay: [{ pos: 'intj', gloss: '', level: 'A1', ipa: 'əʊˈkeɪ', variants: ['OK'], themes: [], examples: ['Okay, see you later.'] }],
  go: [{ pos: 'verb', gloss: '', level: 'A1', ipa: 'ɡəʊ', variants: [], themes: ['travel'], examples: ['We go home at six.'] }],
  bank: [
    { pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping'], examples: ['The bank opens at nine.'] },
    { pos: 'noun', gloss: 'building', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['city'], examples: ['Meet me outside the bank.'] },
    { pos: 'noun', gloss: 'river', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['travel'], examples: ['We sat on the bank of the river.'] },
  ],
}
const EXTRA_BG: Record<string, { translation: string; alternates: string[]; sense: string }> = {
  'the|': { translation: '(определителен член)', alternates: [], sense: '' },
  'okay|': { translation: 'добре', alternates: ['окей'], sense: '' },
  'go|': { translation: 'отивам', alternates: ['ходя'], sense: '' },
  'bank|money': { translation: 'банка', alternates: [], sense: 'за пари' },
  'bank|building': { translation: 'банка', alternates: [], sense: 'сграда' },
  'bank|river': { translation: 'бряг', alternates: [], sense: 'на река' },
}

/** A fake LLM that answers every stage from the sample pack and the few invented words above. */
export function sampleLlm() {
  return fakeLlm((name, input) => {
    if (name === 'lemmas') {
      const forms = (input as { forms: string[] }).forms
      return { items: forms.map((form) => (form === 'london' ? { form, kind: 'name', lemmas: [] } : { form, kind: 'word', lemmas: [form === 'went' ? 'go' : form] })) }
    }
    if (name === 'senses') {
      const headwords = (input as { headwords: string[] }).headwords
      return {
        items: headwords.map((lemma) => ({
          lemma,
          senses:
            EXTRA_SENSES[lemma] ??
            sample.entries
              .filter((e) => e.headword === lemma)
              .map((e) => ({ pos: e.pos, gloss: '', level: e.level, ipa: e.ipa, variants: e.variants, themes: e.themes, examples: e.examples })),
        })),
      }
    }
    if (name === 'translate') {
      const items = (input as { items: { key: string; headword: string; gloss: string }[] }).items
      return {
        items: items.map((item) => {
          const extra = EXTRA_BG[`${item.headword}|${item.gloss}`]
          const e = sample.entries.find((x) => x.headword === item.headword)
          return { key: item.key, ...(extra ?? { translation: e!.translation, alternates: e!.alternates, sense: '' }) }
        }),
      }
    }
    if (name === 'titles') {
      const units = (input as { units: { unit: string }[] }).units
      return { items: units.map((u) => ({ unit: u.unit, en: `Unit ${u.unit}`, bg: `Урок ${u.unit}` })) }
    }
    throw new Error(`the sample LLM does not answer ${name}`)
  })
}

/** A content directory as `corpus init` makes it, with a cleared invented source and small targets. */
export function makeContent(overrides: { config?: Partial<PipelineConfig> } = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'content-')), 'content')
  initContent(dir)
  const config = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8')) as PipelineConfig
  writeJson(join(dir, 'pipeline.json'), {
    ...config,
    levels: ['A1', 'A2'],
    targets: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 },
    max_forms: 100,
    max_lemmas: 100,
    ...overrides.config,
  })
  writeJson(join(dir, 'sources.json'), [
    {
      id: 'invented',
      file: 'invented.tsv',
      title: 'Invented test list',
      url: '',
      licence: 'none (invented for tests)',
      commercial_use: true,
      share_alike: false,
      attribution: '',
      cleared_by: 'test fixture',
      cleared_on: '2026-09-27',
      notes: '',
    },
  ])
  mkdirSync(join(dir, 'sources'), { recursive: true })
  writeFileSync(join(dir, 'sources', 'invented.tsv'), FIXTURE_TSV)
  // The template's starting list would ask the fake LLM about words it does not know; tests add their own.
  writeFileSync(join(dir, 'essentials.txt'), '')
  return dir
}
```

`pipeline/src/lastPublished.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readLastPublished } from './lastPublished'
import { makeContent } from './testing/fixture'

describe('readLastPublished', () => {
  it('reads the sample as version 0, every entry live and published', () => {
    const last = readLastPublished(makeContent())
    expect(last.manifest.corpus_version).toBe(0)
    expect([...last.packs.keys()]).toEqual(['bg'])
    expect(last.live.size).toBe(60)
    expect(last.published.has('hello-1')).toBe(true)
    expect(last.fixes).toEqual({ schema_version: 1, corpus_version: 0, fixes: [] })
  })

  it('refuses a pack whose bytes do not match the manifest', () => {
    const dir = makeContent()
    const file = join(dir, 'last-published', 'corpus-v0-bg.pack')
    writeFileSync(file, readFileSync(file, 'utf8').replace('здравей', 'здрасти'))
    expect(() => readLastPublished(dir)).toThrow(/corpus-v0-bg\.pack: sha256 does not match/)
  })
})
```

`pipeline/src/draft.test.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OfflineMiss } from './cache'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { writeJson } from './files'
import type { Llm, LlmRequest } from './llm'
import { LicenceError } from './sources'
import type { SenseProposal } from './stages/senses'
import { makeContent, sampleLlm } from './testing/fixture'

describe('runDraft', () => {
  it('keeps all 60 sample IDs live in their units, and places the new words', async () => {
    const dir = makeContent()
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    expect(draft.problems).toEqual([])
    expect(draft.live).toEqual(expect.arrayContaining(['hello-1', 'thank_you-1', 'money-1']))
    expect(draft.live).toHaveLength(64)
    const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
    expect(byId.get('go-1')).toMatchObject({ pos: 'verb', level: 'A1', l1: { bg: { translation: 'отивам', alternates: ['ходя'], sense: '' } } })
    expect(byId.get('the-1')).toMatchObject({ pos: 'det', level: 'A1' })
    // money and building both translate as банка, so they merge; river stays apart (Decision 8).
    expect(draft.entries.filter((e) => e.headword === 'bank').map((e) => [e.entry_id, e.sense_en])).toEqual([['bank-1', 'money'], ['bank-2', 'river']])
    expect(draft.units.map((u) => [u.unit_id, u.entry_ids.length])).toEqual([['a1-01', 20], ['a1-02', 20], ['a1-03', 20], ['a1-04', 2], ['a2-01', 2]])
    expect(draft.units[3]!.titles).toEqual({ bg: { en: 'Unit a1-04', l1: 'Урок a1-04' } })
    expect(readDraft(dir).live).toEqual(draft.live)
    expect(JSON.parse(readFileSync(join(dir, 'registry.json'), 'utf8')).entries).toHaveLength(64)
  })

  it('pays for nothing the second time, and runs offline from the cache', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const again = sampleLlm()
    const draft = await runDraft({ dir, llm: again, offline: true })
    expect(again.calls).toEqual([])
    expect(draft.live).toHaveLength(64)
  })

  it('offline, names the stage that is not cached', async () => {
    await expect(runDraft({ dir: makeContent(), llm: sampleLlm(), offline: true })).rejects.toThrow(OfflineMiss)
  })

  it('a dropped entry leaves the live set, and a level fix moves it to a unit of its new level', async () => {
    const dir = makeContent()
    const first = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const go = first.entries.find((e) => e.entry_id === 'go-1')!
    const the = first.entries.find((e) => e.entry_id === 'the-1')!
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'the-1', at: '2026-10-01T00:00:00Z', verdict: 'drop', proposed: the.l1['bg'], by: 'r' }])
    d.append(QUEUES.level, [{ key: 'go-1', at: '2026-10-01T00:00:00Z', verdict: 'fix', proposed: go.level, value: 'A2', by: 'r' }])
    const second = await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(second.live).not.toContain('the-1')
    expect(second.entries.find((e) => e.entry_id === 'go-1')!.level).toBe('A2')
    // go-1 is A2 now, and outranks bank-2 for the A2 target of 2; bank-2 was never published, so it simply leaves.
    expect(second.units.find((u) => u.entry_ids.includes('go-1'))).toMatchObject({ unit_id: 'a2-02', level: 'A2' })
    expect(second.live).not.toContain('bank-2')
  })

  it('names a pinned sample entry the senses stage no longer proposes', async () => {
    const inner = sampleLlm()
    const llm: Llm = {
      model: 'fake',
      spentUsd: () => 0,
      json: async <T,>(req: LlmRequest<T>): Promise<T> => {
        const out = await inner.json(req)
        if (req.name !== 'senses') return out
        return (out as unknown as SenseProposal[][]).map((senses) => senses.filter((s) => s.headword !== 'hello')) as unknown as T
      },
    }
    const draft = await runDraft({ dir: makeContent(), llm, offline: false })
    expect(draft.problems).toEqual(['pinned entry hello-1 (hello, intj) is not live: the senses stage no longer proposes it'])
  })

  it('makes an essential word live at the LLM’s level, sends it to banding review, and counts it toward the target', async () => {
    const dir = makeContent()
    writeFileSync(join(dir, 'essentials.txt'), '# test\nOkay\n')
    const draft = await runDraft({ dir, llm: sampleLlm(), offline: false })
    const okay = draft.entries.find((e) => e.headword === 'okay')!
    expect(okay).toMatchObject({ entry_id: 'okay-1', essential: true, level: 'A1', level_flagged: true })
    expect(draft.live).toContain('okay-1')
    // A1's target of 62 is now the 60 sample words, okay and the; go (rank 2) no longer fits.
    expect(draft.live).toContain('the-1')
    expect(draft.live).not.toContain('go-1')
    expect(draft.problems).toEqual([])
  })

  it('stops before reading anything when a source is not cleared', async () => {
    const dir = makeContent()
    writeJson(join(dir, 'sources.json'), [{ id: 'x', file: 'invented.tsv', commercial_use: true, share_alike: false, cleared_by: '', cleared_on: '' }])
    const llm = sampleLlm()
    await expect(runDraft({ dir, llm, offline: false })).rejects.toThrow(LicenceError)
    expect(llm.calls).toEqual([])
  })
})
```

The 64 live entries are the 60 sample entries, `go-1` and `the-1` (A1, target 62), and `bank-1` and `bank-2` (A2, target 2). `the-1` and `go-1` are both new A1 entries. With `unit_size` 20 they form one unit of two, `a1-04`, because a lone short chunk stands (Task 10's rule folds a short chunk only into another new chunk).

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- lastPublished draft`
Expected: FAIL, unresolved imports (`./init`, `./lastPublished`, `./draft`).

- [ ] **Step 4: Implement**

`pipeline/src/lastPublished.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { validateManifest, validatePack, type Pack, type PackManifest, type ReportField } from '@wordado/core'
import { sha256Hex } from './checksum'
import { contentPaths } from './content'
import { readJsonOr } from './files'

/** One entry field that changed in a corpus version: what plan 8b matches a learner's reports against (spec §8.10). */
export interface Fix {
  readonly word_id: string
  readonly field: ReportField
  readonly fixed_in: number
}

export interface FixesFile {
  readonly schema_version: 1
  readonly corpus_version: number
  readonly fixes: readonly Fix[]
}

/** The corpus as last published: the predecessor every release is checked against (Decision 14). */
export interface LastPublished {
  readonly manifest: PackManifest
  /** By L1. */
  readonly packs: ReadonlyMap<string, Pack>
  /** The packs' bytes by file name, for `corpus live`. */
  readonly packBytes: ReadonlyMap<string, Uint8Array>
  readonly fixes: FixesFile
  /** Entries live in any published pack. */
  readonly live: ReadonlySet<string>
  /** Every entry any published pack carries, live or retired. */
  readonly published: ReadonlySet<string>
}

export function readLastPublished(dir: string): LastPublished {
  const root = contentPaths(dir).lastPublished
  const manifestFile = join(root, 'manifest.json')
  if (!existsSync(manifestFile)) throw new Error('last-published/manifest.json is missing; run `corpus init` or restore it from the CDN')
  const m = validateManifest(JSON.parse(readFileSync(manifestFile, 'utf8')))
  if (m.status !== 'ok') throw new Error(`last-published/manifest.json: ${m.status === 'invalid' ? m.errors.map((e) => `${e.path}: ${e.message}`).join('; ') : 'unsupported schema'}`)
  const packs = new Map<string, Pack>()
  const packBytes = new Map<string, Uint8Array>()
  for (const d of m.manifest.packs) {
    const file = join(root, d.url)
    if (!existsSync(file)) throw new Error(`last-published/${d.url}: missing`)
    const bytes = new Uint8Array(readFileSync(file))
    if (sha256Hex(bytes) !== d.sha256) throw new Error(`last-published/${d.url}: sha256 does not match the manifest`)
    const p = validatePack(JSON.parse(new TextDecoder().decode(bytes)))
    if (p.status !== 'ok') throw new Error(`last-published/${d.url}: not a valid pack`)
    packs.set(d.l1, p.pack)
    packBytes.set(d.url, bytes)
  }
  const live = new Set<string>()
  const published = new Set<string>()
  for (const pack of packs.values()) {
    for (const e of pack.entries) {
      published.add(e.entry_id)
      if (!e.retired) live.add(e.entry_id)
    }
  }
  const fixes = readJsonOr<FixesFile>(join(root, 'fixes.json'), { schema_version: 1, corpus_version: m.manifest.corpus_version, fixes: [] })
  return { manifest: m.manifest, packs, packBytes, fixes, live, published }
}
```

`pipeline/src/init.ts`:

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Pack } from '@wordado/core'
import { contentPaths } from './content'
import { writeJson } from './files'
import { registryFromSample } from './registry'

export const SAMPLE_DIR = fileURLToPath(new URL('../samples/a1-bg/', import.meta.url))
export const TEMPLATE_DIR = fileURLToPath(new URL('../template/', import.meta.url))

/**
 * A new content repository (Decision 2): the template's files, the sample's
 * IDs pinned in the registry, its curated themes named in English and
 * Bulgarian, and the sample itself as the last published version (v0).
 * The first real release is checked against it.
 */
export function initContent(dir: string): void {
  if (existsSync(dir) && readdirSync(dir).some((f) => f !== '.git')) throw new Error(`${dir} is not empty`)
  const paths = contentPaths(dir)
  cpSync(TEMPLATE_DIR, dir, { recursive: true })
  const packFile = 'corpus-v0-bg.pack'
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, packFile), 'utf8')) as Pack
  writeJson(paths.registry, registryFromSample(pack))
  writeJson(
    paths.themes,
    pack.themes.map((t) => ({ theme_id: t.theme_id, name: { en: t.name.en, bg: t.name.l1 }, description: { en: t.description.en, bg: t.description.l1 } })),
  )
  mkdirSync(paths.lastPublished, { recursive: true })
  cpSync(join(SAMPLE_DIR, packFile), join(paths.lastPublished, packFile))
  cpSync(join(SAMPLE_DIR, 'manifest.json'), join(paths.lastPublished, 'manifest.json'))
  writeJson(join(paths.lastPublished, 'fixes.json'), { schema_version: 1, corpus_version: 0, fixes: [] })
}
```

`pipeline/src/draft.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { norm, type CefrLevel, type LocalizedText, type PartOfSpeech } from '@wordado/core'
import { StageCache } from './cache'
import { readConfig, readThemes } from './config'
import { contentPaths } from './content'
import { Decisions, foldField, QUEUES } from './decisions'
import { readJson, writeJson } from './files'
import { parseFrequencyList, rankForms } from './frequency'
import { readLastPublished } from './lastPublished'
import type { Llm } from './llm'
import { assignIds, type Registry } from './registry'
import { selectLive } from './select'
import { readClearedSources } from './sources'
import { lemmatise, rankLemmas, type StageRun } from './stages/lemmas'
import { bandLevel, describeLemmas, frequencyBand } from './stages/senses'
import { titleUnits } from './stages/titles'
import { mergeSenses, translateSenses, type TranslationFields } from './stages/translate'
import { assignUnits } from './units'

export interface EnglishFields {
  readonly ipa: string
  readonly variants: readonly string[]
  readonly examples: readonly string[]
}

/** One candidate entry with its proposals: what the queues show and what a release folds decisions over. */
export interface DraftEntry {
  readonly entry_id: string
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
  readonly rank: number
  readonly order: number
  readonly pinned: boolean
  /** In essentials.txt: live at the LLM's level whatever its frequency (Decision 19). */
  readonly essential: boolean
  readonly band: CefrLevel
  /** What the banding queue judges: the unit's level for a placed entry, else the banded LLM level. */
  readonly level_proposal: CefrLevel
  /** The proposal after any banding decision. */
  readonly level: CefrLevel
  /** The frequency band clamped the LLM's level (Decision 7). */
  readonly level_flagged: boolean
  readonly themes: readonly string[]
  readonly english: EnglishFields
  readonly l1: Readonly<Record<string, TranslationFields>>
}

export interface DraftUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly entry_ids: readonly string[]
  /** By L1; absent for a unit with no live entry. */
  readonly titles: Readonly<Record<string, LocalizedText>>
}

export interface Draft {
  readonly live: readonly string[]
  readonly entries: readonly DraftEntry[]
  readonly units: readonly DraftUnit[]
  /** What stops a release whatever the reviewers do. */
  readonly problems: readonly string[]
}

export interface DraftOptions {
  readonly dir: string
  readonly llm: Llm
  /** No LLM calls: every answer must be cached (the release workflow). */
  readonly offline: boolean
}

/** `corpus draft`: every LLM stage, then IDs, decisions, selection and units. Writes registry.json and work/draft.json. */
export async function runDraft(opts: DraftOptions): Promise<Draft> {
  const { dir, llm, offline } = opts
  const paths = contentPaths(dir)
  const config = readConfig(dir)
  const themes = readThemes(dir, config.l1s)
  const sources = readClearedSources(dir)
  const last = readLastPublished(dir)
  const decisions = Decisions.read(dir)
  let registry = readJson<Registry>(paths.registry)
  const run = (stage: string): StageRun => ({ llm, cache: StageCache.open(paths.cache(stage)), concurrency: config.llm.concurrency, offline })

  const forms = rankForms(sources.map((s) => parseFrequencyList(s.text, s.record.id)), config.max_forms)
  const lemmaResults = await lemmatise(forms, run('lemmas'))
  const essentials = new Set(readEssentials(dir))
  const pinnedHeadwords = [...registry.entries.filter((e) => e.pinned).map((e) => e.headword), ...essentials]
  const lemmas = rankLemmas(forms, lemmaResults, pinnedHeadwords, config.max_lemmas)
  const senses = await describeLemmas(lemmas, themes.map((t) => t.theme_id), run('senses'))

  const inScope = lemmas.flatMap((lemma, i) =>
    senses[i]!.flatMap((s, order) => {
      const band = frequencyBand(lemma.rank, config.targets)
      const essential = essentials.has(lemma.lemma)
      // An essential word's frequency understates it, so its level is the LLM's, and a reviewer checks every one.
      const banded = essential ? { level: s.level === 'C2' ? null : s.level, flagged: true } : bandLevel(s.level, band)
      if (banded.level === null) return []
      if (!lemma.pinned && !config.levels.includes(banded.level)) return []
      return [{ ...s, rank: lemma.rank, order, band, essential, banded: banded.level, flagged: banded.flagged }]
    }),
  )
  const translations: Record<string, TranslationFields[]> = {}
  for (const l1 of config.l1s) {
    translations[l1] = await translateSenses(
      l1,
      inScope.map((s) => ({ headword: s.headword, pos: s.pos, gloss: s.gloss, example: s.examples[0]! })),
      run(`translate-${l1}`),
    )
  }
  const merged = mergeSenses(
    inScope.map((s, i) => ({ ...s, l1: Object.fromEntries(config.l1s.map((l) => [l, translations[l]![i]!])) as Record<string, TranslationFields> })),
    config.l1s,
  )

  const assigned = assignIds(registry, merged.map((s) => ({ headword: s.headword, pos: s.pos, sense_en: s.gloss })))
  registry = assigned.registry
  const pinned = new Set(registry.entries.filter((e) => e.pinned).map((e) => e.entry_id))
  const unitOf = new Map(registry.units.flatMap((u) => u.entry_ids.map((id) => [id, u] as const)))
  const entries: DraftEntry[] = merged.map((s, i) => {
    const entry_id = assigned.ids[i]!
    const unit = unitOf.get(entry_id)
    // An entry keeps its unit, and so its level, unless a banding decision moves it (Decision 9).
    const proposal = unit ? unit.level : s.banded
    return {
      entry_id,
      headword: s.headword,
      pos: s.pos,
      sense_en: s.gloss,
      rank: s.rank,
      order: s.order,
      pinned: pinned.has(entry_id),
      essential: s.essential,
      band: s.band,
      level_proposal: proposal,
      level: foldField(proposal, decisions.for(QUEUES.level, entry_id)).value,
      level_flagged: !unit && s.flagged,
      themes: s.themes,
      english: { ipa: s.ipa, variants: s.variants, examples: s.examples },
      l1: s.l1,
    }
  })

  const dropped = (e: DraftEntry) =>
    foldField(e.english, decisions.for(QUEUES.english, e.entry_id)).dropped ||
    config.l1s.some((l) => foldField(e.l1[l], decisions.for(QUEUES.translation(l), e.entry_id)).dropped)
  const live = selectLive(
    entries.map((e) => ({ entry_id: e.entry_id, level: e.level, rank: e.rank, order: e.order, pinned: e.pinned || e.essential, wasLive: last.live.has(e.entry_id), dropped: dropped(e) })),
    config.levels,
    config.targets,
  )
  const liveEntries = entries.filter((e) => live.has(e.entry_id))
  const units = assignUnits(
    registry.units,
    liveEntries.map((e) => ({ entry_id: e.entry_id, level: e.level, theme: e.themes[0] ?? '', rank: e.rank, order: e.order })),
    last.published,
    config.unit_size,
  )
  registry = { entries: registry.entries, units }

  const byId = new Map(entries.map((e) => [e.entry_id, e]))
  const liveUnits = units.filter((u) => u.entry_ids.some((id) => live.has(id)))
  const titles = await titleUnits(
    liveUnits.map((u) => ({ unit_id: u.unit_id, level: u.level, words: u.entry_ids.filter((id) => live.has(id)).map((id) => byId.get(id)!.headword) })),
    config.l1s,
    run('titles'),
  )

  const problems = registry.entries
    .filter((e) => e.pinned && !live.has(e.entry_id))
    .map((e) =>
      byId.has(e.entry_id)
        ? `pinned entry ${e.entry_id} (${e.headword}, ${e.pos}) is not live: it was dropped or its level left the shipped levels`
        : `pinned entry ${e.entry_id} (${e.headword}, ${e.pos}) is not live: the senses stage no longer proposes it`,
    )
  const draft: Draft = {
    live: liveEntries.map((e) => e.entry_id),
    entries,
    units: units.map((u) => ({ ...u, titles: titles.get(u.unit_id) ?? {} })),
    problems,
  }
  writeJson(paths.registry, registry)
  writeJson(paths.draft, draft)
  return draft
}

export function readDraft(dir: string): Draft {
  return readJson<Draft>(contentPaths(dir).draft)
}

/** essentials.txt: one headword per line, # for comments (Decision 19). */
export function readEssentials(dir: string): string[] {
  const file = contentPaths(dir).essentials
  if (!existsSync(file)) return []
  return [...new Set(readFileSync(file, 'utf8').split(/\r?\n/).map((l) => norm(l.replace(/#.*/, ''))).filter((l) => l !== ''))]
}
```

A pinned entry the senses stage stops proposing cannot be live. It has no fields to ship, and the gate refuses the release (Decision 9). The fix is to correct that lemma's line in `cache/senses.jsonl`, which is plain JSON in the content repository, and run `corpus draft` again. The runbook (Task 18) says so.

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- lastPublished draft && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, 9 tests.

If the unit counts differ, check `the`/`go` against the fixture's A1 target of 62 before changing the expectations. The test's comment gives the arithmetic.

- [ ] **Step 6: Commit**

```bash
git add pipeline/template pipeline/src/lastPublished.ts pipeline/src/lastPublished.test.ts pipeline/src/init.ts pipeline/src/draft.ts pipeline/src/draft.test.ts pipeline/src/testing/fixture.ts
git commit -m "feat(pipeline): the content directory, its last published snapshot and the draft"
```

---
### Task 12: Review queues

`corpus queues` writes every pending item to CSV files in `review/<queue>/`, skipping items already in an open file. `corpus import --by <name>` turns each row with a verdict into a decision event, keeps undecided rows in place, and deletes a file once every row is decided (Decisions 4–6).

**Files:**
- Create: `pipeline/src/queues.ts`, `pipeline/src/queues.test.ts`

**Interfaces:**
- Consumes: `formatCsv`, `csvRecords` (Task 1); `readJson`, `writeJson` (Task 1); `contentPaths` (Task 2); `Decisions`, `foldField`, `QUEUES`, `Verdict`, `DecisionEvent` (Task 9); `Draft` (Task 11); `sha256Hex`; `canonicalJson`, `CEFR_LEVELS` (`@wordado/core`).
- Produces:
  - `interface QueueItem { readonly key: string; readonly proposed: unknown; readonly context: Readonly<Record<string, string>> }`
  - `interface QueueSpec { readonly name: string; readonly columns: readonly string[]; readonly context: readonly string[]; readonly verdicts: readonly Verdict[]; toCells(value: unknown): Record<string, string>; fromCells(cells: Readonly<Record<string, string>>): unknown }`
  - `queueSpecs(l1s: readonly string[]): Map<string, QueueSpec>` (includes `audio`)
  - `levelSampled(entryId: string): boolean`
  - `pendingItems(draft: Draft, decisions: Decisions, l1s: readonly string[]): Map<string, QueueItem[]>` (every queue but `audio`)
  - `exportQueues(dir: string, items: ReadonlyMap<string, readonly QueueItem[]>, specs: ReadonlyMap<string, QueueSpec>, opts: { stamp: string; batchSize?: number }): string[]` (files written, relative to the content directory)
  - `importQueues(dir: string, specs: ReadonlyMap<string, QueueSpec>, opts: { by: string; now: string }): { applied: number; pending: number; errors: string[] }`
  - `splitList(cell: string): string[]`, `LIST_SEPARATOR = ' | '`

- [ ] **Step 1: Write the failing test**

`pipeline/src/queues.test.ts`:

```ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { csvRecords, formatCsv, parseCsv } from './csv'
import { Decisions, QUEUES } from './decisions'
import type { Draft, DraftEntry } from './draft'
import { exportQueues, importQueues, levelSampled, pendingItems, queueSpecs, splitList } from './queues'
import { makeContent } from './testing/fixture'

const entry = (entry_id: string, extra: Partial<DraftEntry> = {}): DraftEntry => ({
  entry_id,
  headword: entry_id.replace(/-\d+$/, ''),
  pos: 'noun',
  sense_en: '',
  rank: 1,
  order: 0,
  pinned: false,
  essential: false,
  band: 'A1',
  level_proposal: 'A1',
  level: 'A1',
  level_flagged: false,
  themes: [],
  english: { ipa: 'ˈwɔːtə', variants: [], examples: ['Water, please.', 'I drink water.'] },
  l1: { bg: { translation: 'вода', alternates: ['водичка'], sense: '' } },
  ...extra,
})
const draft = (entries: DraftEntry[], live = entries.map((e) => e.entry_id)): Draft => ({
  live,
  entries,
  units: [{ unit_id: 'a1-01', level: 'A1', entry_ids: live, titles: { bg: { en: 'Water', l1: 'Вода' } } }],
  problems: [],
})
const specs = queueSpecs(['bg'])
const NOW = '2026-10-01T10:00:00Z'

function exportAll(dir: string, d: Draft): string[] {
  return exportQueues(dir, pendingItems(d, Decisions.read(dir), ['bg']), specs, { stamp: '2026-10-01' })
}

function editRow(dir: string, file: string, key: string, cells: Record<string, string>): void {
  const path = join(dir, file)
  const rows = parseCsv(readFileSync(path, 'utf8'))
  const header = rows[0]!
  const row = rows.find((r) => r[0] === key)!
  for (const [col, value] of Object.entries(cells)) row[header.indexOf(col)] = value
  writeFileSync(path, formatCsv(rows))
}

describe('pendingItems', () => {
  it('queues every live entry’s English and translation set, and each live unit’s title', () => {
    const items = pendingItems(draft([entry('water-1'), entry('gone-1')], ['water-1']), Decisions.read(makeContent()), ['bg'])
    expect(items.get('english')!.map((i) => i.key)).toEqual(['water-1'])
    expect(items.get('translation-bg')![0]).toMatchObject({ key: 'water-1', proposed: { translation: 'вода', alternates: ['водичка'], sense: '' } })
    expect(items.get('title-bg')!.map((i) => i.key)).toEqual(['a1-01'])
  })

  it('queues a level only when the band clamped it, or the entry is in the 1-in-20 sample', () => {
    const flagged = entry('a-1', { level_flagged: true })
    const ids = Array.from({ length: 200 }, (_, i) => `w${i}-1`)
    const sampled = ids.filter(levelSampled)
    expect(sampled.length).toBeGreaterThan(3)
    expect(sampled.length).toBeLessThan(20)
    const items = pendingItems(draft([flagged, ...ids.map((id) => entry(id))]), Decisions.read(makeContent()), ['bg'])
    expect(items.get('level')!.map((i) => i.key)).toEqual(['a-1', ...sampled])
  })

  it('leaves out what is reviewed, and brings back what reports reopened', () => {
    const dir = makeContent()
    const e = entry('water-1')
    const d = Decisions.read(dir)
    d.append(QUEUES.english, [{ key: 'water-1', at: NOW, verdict: 'ok', proposed: e.english, by: 'r' }])
    expect(pendingItems(draft([e]), Decisions.read(dir), ['bg']).get('english')).toEqual([])
    d.append(QUEUES.english, [{ key: 'water-1', at: NOW, verdict: 'reopen', by: 'reports', note: '2 reports: example' }])
    expect(pendingItems(draft([e]), Decisions.read(dir), ['bg']).get('english')![0]!.context).toMatchObject({ reopened: '2 reports: example' })
  })
})

describe('exportQueues and importQueues', () => {
  it('writes one CSV and its sidecar per queue, and skips items already in an open file', () => {
    const dir = makeContent()
    const files = exportAll(dir, draft([entry('water-1')]))
    expect(files).toEqual(['review/english/2026-10-01-01.csv', 'review/title-bg/2026-10-01-01.csv', 'review/translation-bg/2026-10-01-01.csv'])
    const { header, rows } = csvRecords(readFileSync(join(dir, 'review/translation-bg/2026-10-01-01.csv'), 'utf8'))
    expect(header).toEqual(['key', 'verdict', 'translation', 'alternates', 'sense', 'headword', 'pos', 'sense_en', 'level', 'example', 'reopened', 'note'])
    expect(rows[0]).toMatchObject({ key: 'water-1', verdict: '', translation: 'вода', alternates: 'водичка', example: 'Water, please.' })
    expect(exportAll(dir, draft([entry('water-1')]))).toEqual([])
  })

  it('ok on an untouched row is ok; ok on edited cells is a fix; drop is a drop', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1'), entry('salt-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok' })
    editRow(dir, file, 'bread-1', { verdict: 'OK ', alternates: 'водичка | вода от чешмата' })
    editRow(dir, file, 'salt-1', { verdict: 'drop', note: 'not A1' })
    // pending: the three english rows and the one title row are still open.
    expect(importQueues(dir, specs, { by: 'Мария', now: NOW })).toEqual({ applied: 3, pending: 4, errors: [] })
    const events = Decisions.read(dir).all('translation-bg')
    expect(events.map((e) => [e.key, e.verdict])).toEqual([['water-1', 'ok'], ['bread-1', 'fix'], ['salt-1', 'drop']])
    expect(events[1]!.value).toEqual({ translation: 'вода', alternates: ['водичка', 'вода от чешмата'], sense: '' })
    expect(events[2]).toMatchObject({ by: 'Мария', note: 'not A1', at: NOW })
    expect(existsSync(join(dir, file))).toBe(false)
  })

  it('keeps undecided rows, with the reviewer’s edits, in the file', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok' })
    editRow(dir, file, 'bread-1', { sense: 'половин мисъл' })
    importQueues(dir, specs, { by: 'r', now: NOW })
    const { rows } = csvRecords(readFileSync(join(dir, file), 'utf8'))
    expect(rows).toEqual([expect.objectContaining({ key: 'bread-1', sense: 'половин мисъл' })])
    expect(JSON.parse(readFileSync(join(dir, file.replace(/\.csv$/, '.json')), 'utf8')).items.map((i: { key: string }) => i.key)).toEqual(['bread-1'])
  })

  it('reads a file re-saved by a spreadsheet: no BOM, LF line ends, a dropped trailing cell', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1')]))
    const file = join(dir, 'review/english/2026-10-01-01.csv')
    const [header, row] = parseCsv(readFileSync(file, 'utf8'))
    row![1] = 'ok'
    writeFileSync(file, [header!.join(','), row!.slice(0, -1).map((c) => (/[",\n]/.test(c) ? `"${c.replaceAll('"', '""')}"` : c)).join(',')].join('\n'))
    expect(importQueues(dir, specs, { by: 'r', now: NOW }).applied).toBe(1)
  })

  it('rejects an unknown verdict and applies nothing from that row; the other rows still apply', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1'), entry('bread-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'yes' })
    editRow(dir, file, 'bread-1', { verdict: 'ok' })
    const out = importQueues(dir, specs, { by: 'r', now: NOW })
    expect(out.errors).toEqual(['review/translation-bg/2026-10-01-01.csv water-1: verdict "yes" is not one of ok, drop'])
    expect(Decisions.read(dir).all('translation-bg').map((e) => e.key)).toEqual(['bread-1'])
  })

  it('rejects an ok on cells that are not a valid value, and a row the sidecar does not know', () => {
    const dir = makeContent()
    exportAll(dir, draft([entry('water-1')]))
    const file = 'review/translation-bg/2026-10-01-01.csv'
    editRow(dir, file, 'water-1', { verdict: 'ok', translation: ' ' })
    const rows = parseCsv(readFileSync(join(dir, file), 'utf8'))
    rows.push(['stranger-1', 'ok'])
    writeFileSync(join(dir, file), formatCsv(rows))
    expect(importQueues(dir, specs, { by: 'r', now: NOW }).errors).toEqual([
      'review/translation-bg/2026-10-01-01.csv water-1: translation is empty',
      'review/translation-bg/2026-10-01-01.csv stranger-1: not an item of this file',
    ])
  })

  it('needs a reviewer name', () => {
    expect(() => importQueues(makeContent(), specs, { by: ' ', now: NOW })).toThrow(/--by/)
  })
})

describe('splitList', () => {
  it('splits on the bar, trims, and drops empty items', () => {
    expect(splitList(' a |b||  c ')).toEqual(['a', 'b', 'c'])
  })
})

it('writes nothing for a queue with no items', () => {
  const dir = makeContent()
  exportQueues(dir, new Map([['english', []]]), specs, { stamp: '2026-10-01' })
  expect(existsSync(join(dir, 'review', 'english')) ? readdirSync(join(dir, 'review', 'english')) : []).toEqual([])
})
```

`water-1`, `bread-1` and `salt-1` are not in the 1-in-20 level sample (checked: of the IDs these tests use, only `gone-1` hashes into it, and it is not live), so no `level` file appears.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- queues`
Expected: FAIL, "Failed to resolve import './queues'".

- [ ] **Step 3: Implement**

`pipeline/src/queues.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { canonicalJson, CEFR_LEVELS } from '@wordado/core'
import { sha256Hex } from './checksum'
import { contentPaths } from './content'
import { csvRecords, formatCsv } from './csv'
import { Decisions, foldField, QUEUES, type DecisionEvent, type Verdict } from './decisions'
import type { Draft } from './draft'
import { readJson, writeJson } from './files'

export interface QueueItem {
  readonly key: string
  /** The value the reviewer judges; an ok binds to it (Decision 5). */
  readonly proposed: unknown
  /** Read-only columns that help the reviewer decide. */
  readonly context: Readonly<Record<string, string>>
}

export interface QueueSpec {
  readonly name: string
  /** Columns the reviewer may edit. */
  readonly columns: readonly string[]
  readonly context: readonly string[]
  readonly verdicts: readonly Verdict[]
  toCells(value: unknown): Record<string, string>
  /** Throws an Error naming the bad cell. */
  fromCells(cells: Readonly<Record<string, string>>): unknown
}

interface Sidecar {
  readonly queue: string
  readonly items: readonly { readonly key: string; readonly proposed: unknown }[]
}

export const LIST_SEPARATOR = ' | '
export const splitList = (cell: string): string[] => cell.split('|').map((s) => s.trim()).filter((s) => s !== '')
const required = (cells: Readonly<Record<string, string>>, col: string): string => {
  const v = (cells[col] ?? '').trim()
  if (v === '') throw new Error(`${col} is empty`)
  return v
}

export function queueSpecs(l1s: readonly string[]): Map<string, QueueSpec> {
  const specs: QueueSpec[] = [
    {
      name: QUEUES.english,
      columns: ['ipa', 'variants', 'examples'],
      context: ['headword', 'pos', 'sense_en', 'level', 'reopened'],
      verdicts: ['ok', 'drop'],
      toCells: (v) => {
        const e = v as { ipa: string; variants: string[]; examples: string[] }
        return { ipa: e.ipa, variants: e.variants.join(LIST_SEPARATOR), examples: e.examples.join(LIST_SEPARATOR) }
      },
      fromCells: (c) => {
        const examples = splitList(c['examples'] ?? '')
        if (examples.length === 0) throw new Error('examples is empty')
        return { ipa: required(c, 'ipa'), variants: splitList(c['variants'] ?? ''), examples }
      },
    },
    {
      name: QUEUES.level,
      columns: ['level'],
      context: ['headword', 'pos', 'sense_en', 'band', 'reopened'],
      verdicts: ['ok'],
      toCells: (v) => ({ level: String(v) }),
      fromCells: (c) => {
        const level = required(c, 'level').toUpperCase()
        if (!(CEFR_LEVELS as readonly string[]).includes(level)) throw new Error(`level must be one of ${CEFR_LEVELS.join(', ')}`)
        return level
      },
    },
    {
      name: QUEUES.audio,
      columns: [],
      context: ['headword', 'accent', 'listen', 'reason'],
      verdicts: ['ok', 'redo'],
      toCells: () => ({}),
      fromCells: () => null,
    },
  ]
  for (const l1 of l1s) {
    specs.push({
      name: QUEUES.translation(l1),
      columns: ['translation', 'alternates', 'sense'],
      context: ['headword', 'pos', 'sense_en', 'level', 'example', 'reopened'],
      verdicts: ['ok', 'drop'],
      toCells: (v) => {
        const t = v as { translation: string; alternates: string[]; sense: string }
        return { translation: t.translation, alternates: t.alternates.join(LIST_SEPARATOR), sense: t.sense }
      },
      fromCells: (c) => ({ translation: required(c, 'translation'), alternates: splitList(c['alternates'] ?? ''), sense: (c['sense'] ?? '').trim() }),
    })
    specs.push({
      name: QUEUES.title(l1),
      columns: ['title_en', 'title_l1'],
      context: ['level', 'words', 'reopened'],
      verdicts: ['ok'],
      toCells: (v) => {
        const t = v as { en: string; l1: string }
        return { title_en: t.en, title_l1: t.l1 }
      },
      fromCells: (c) => ({ en: required(c, 'title_en'), l1: required(c, 'title_l1') }),
    })
  }
  return new Map(specs.map((s) => [s.name, s]))
}

/** The banding spot-check's deterministic 1-in-20 sample (Decision 6). */
export function levelSampled(entryId: string): boolean {
  return Number.parseInt(sha256Hex(new TextEncoder().encode(entryId)).slice(0, 8), 16) % 20 === 0
}

/** Every item still waiting for a reviewer, per queue, from the draft and the decisions so far. Audio's items come from `audioQueueItems`. */
export function pendingItems(draft: Draft, decisions: Decisions, l1s: readonly string[]): Map<string, QueueItem[]> {
  const out = new Map<string, QueueItem[]>([[QUEUES.english, []], [QUEUES.level, []]])
  for (const l1 of l1s) {
    out.set(QUEUES.translation(l1), [])
    out.set(QUEUES.title(l1), [])
  }
  const live = new Set(draft.live)
  const push = <T>(queue: string, key: string, proposal: T, context: Record<string, string>) => {
    const events = decisions.for(queue, key)
    const state = foldField(proposal, events)
    if (state.reviewed || state.dropped) return
    const reopen = [...events].reverse().find((e) => e.verdict === 'reopen')
    out.get(queue)!.push({ key, proposed: state.value, context: { ...context, reopened: state.reopened ? (reopen?.note ?? 'reopened') : '' } })
  }
  for (const e of draft.entries) {
    if (!live.has(e.entry_id)) continue
    const base = { headword: e.headword, pos: e.pos, sense_en: e.sense_en, level: e.level }
    push(QUEUES.english, e.entry_id, e.english, base)
    for (const l1 of l1s) push(QUEUES.translation(l1), e.entry_id, e.l1[l1], { ...base, example: e.english.examples[0] ?? '' })
  }
  for (const e of draft.entries) {
    if (!live.has(e.entry_id) || !(e.level_flagged || levelSampled(e.entry_id))) continue
    push(QUEUES.level, e.entry_id, e.level_proposal, { headword: e.headword, pos: e.pos, sense_en: e.sense_en, band: e.band })
  }
  const byId = new Map(draft.entries.map((e) => [e.entry_id, e]))
  for (const u of draft.units) {
    const words = u.entry_ids.filter((id) => live.has(id))
    if (words.length === 0) continue
    for (const l1 of l1s) {
      const title = u.titles[l1]
      if (title) push(QUEUES.title(l1), u.unit_id, title, { level: u.level, words: words.map((id) => byId.get(id)?.headword ?? id).join(', ') })
    }
  }
  return out
}

function header(spec: QueueSpec): string[] {
  return ['key', 'verdict', ...spec.columns, ...spec.context, 'note']
}

function openFiles(dir: string, queue: string): string[] {
  const qdir = contentPaths(dir).queueDir(queue)
  if (!existsSync(qdir)) return []
  return readdirSync(qdir).filter((f) => f.endsWith('.csv')).sort().map((f) => join(qdir, f))
}

const sidecarOf = (csv: string) => csv.replace(/\.csv$/, '.json')

/** Writes pending items not already in an open file, `batchSize` rows per file. Returns the files written. */
export function exportQueues(
  dir: string,
  items: ReadonlyMap<string, readonly QueueItem[]>,
  specs: ReadonlyMap<string, QueueSpec>,
  opts: { stamp: string; batchSize?: number },
): string[] {
  const batchSize = opts.batchSize ?? 200
  const written: string[] = []
  for (const [queue, all] of [...items].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const spec = specs.get(queue)
    if (!spec) throw new Error(`no queue ${queue}`)
    const open = new Set(openFiles(dir, queue).flatMap((f) => readJson<Sidecar>(sidecarOf(f)).items.map((i) => i.key)))
    const fresh = all.filter((i) => !open.has(i.key))
    const qdir = contentPaths(dir).queueDir(queue)
    let n = 0
    for (let i = 0; i < fresh.length; i += batchSize) {
      const batch = fresh.slice(i, i + batchSize)
      let file: string
      do {
        n += 1
        file = join(qdir, `${opts.stamp}-${String(n).padStart(2, '0')}.csv`)
      } while (existsSync(file))
      const cols = header(spec)
      const rows = batch.map((item) => {
        const cells: Record<string, string> = { key: item.key, verdict: '', note: '', ...item.context, ...spec.toCells(item.proposed) }
        return cols.map((c) => cells[c] ?? '')
      })
      mkdirSync(qdir, { recursive: true })
      writeFileSync(file, formatCsv([cols, ...rows]))
      writeJson(sidecarOf(file), { queue, items: batch.map((b) => ({ key: b.key, proposed: b.proposed })) } satisfies Sidecar)
      written.push(relative(dir, file))
    }
  }
  return written
}

/** Applies every row with a verdict. Rows without one stay, with their edits; a file with none left is removed. */
export function importQueues(dir: string, specs: ReadonlyMap<string, QueueSpec>, opts: { by: string; now: string }): { applied: number; pending: number; errors: string[] } {
  if (opts.by.trim() === '') throw new Error('name the reviewer with --by')
  const decisions = Decisions.read(dir)
  const errors: string[] = []
  let applied = 0
  let pending = 0
  for (const spec of specs.values()) {
    for (const file of openFiles(dir, spec.name)) {
      const rel = relative(dir, file)
      const sidecar = readJson<Sidecar>(sidecarOf(file))
      const proposals = new Map(sidecar.items.map((i) => [i.key, i.proposed]))
      const { header: cols, rows } = csvRecords(readFileSync(file, 'utf8'))
      const events: DecisionEvent[] = []
      const keep: Record<string, string>[] = []
      for (const row of rows) {
        const key = (row['key'] ?? '').trim()
        const verdict = (row['verdict'] ?? '').trim().toLowerCase()
        if (!proposals.has(key)) {
          errors.push(`${rel} ${key}: not an item of this file`)
          continue
        }
        if (verdict === '') {
          keep.push(row)
          continue
        }
        if (!(spec.verdicts as readonly string[]).includes(verdict)) {
          errors.push(`${rel} ${key}: verdict "${row['verdict']}" is not one of ${spec.verdicts.join(', ')}`)
          keep.push(row)
          continue
        }
        const proposed = proposals.get(key)
        const note = (row['note'] ?? '').trim()
        const base = { key, at: opts.now, by: opts.by.trim(), proposed, ...(note ? { note } : {}) }
        if (verdict === 'ok' && spec.columns.length > 0) {
          let value: unknown
          try {
            value = spec.fromCells(row)
          } catch (err) {
            errors.push(`${rel} ${key}: ${err instanceof Error ? err.message : String(err)}`)
            keep.push(row)
            continue
          }
          events.push(canonicalJson(value) === canonicalJson(proposed) ? { ...base, verdict: 'ok' } : { ...base, verdict: 'fix', value })
        } else events.push({ ...base, verdict: verdict as Verdict })
      }
      decisions.append(spec.name, events)
      applied += events.length
      pending += keep.length
      if (keep.length === 0) {
        rmSync(file)
        rmSync(sidecarOf(file))
      } else {
        writeFileSync(file, formatCsv([cols, ...keep.map((r) => cols.map((c) => r[c] ?? ''))]))
        const kept = new Set(keep.map((r) => (r['key'] ?? '').trim()))
        writeJson(sidecarOf(file), { queue: spec.name, items: sidecar.items.filter((i) => kept.has(i.key)) } satisfies Sidecar)
      }
    }
  }
  return { applied, pending, errors }
}
```

A row the sidecar does not know is reported and dropped from the rewritten file. It was never an item, so keeping it would only repeat the error.

- [ ] **Step 4: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- queues && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/queues.ts pipeline/src/queues.test.ts
git commit -m "feat(pipeline): review queues as spreadsheets, imported as decision events"
```

---

### Task 13: Speech, encoding, clips and spot-listen batches

TTS goes through a port (§17), with OpenRouter's speech endpoint behind it (Decision 11). ffmpeg turns its MP3 into the app's AAC-in-MP4 clip. `corpus audio` makes a clip for every live entry and accent that lacks a current one, or whose voice changed, or that was marked `redo`. Each clip has a new ID (Decision 10), and the run is one batch. The spot-listen sample and the gate follow Decision 12.

**Files:**
- Create: `pipeline/src/tts.ts`, `pipeline/src/tts.test.ts`, `pipeline/src/encoder.ts`, `pipeline/src/encoder.test.ts`, `pipeline/src/audio.ts`, `pipeline/src/audio.test.ts`

**Interfaces:**
- Consumes: `TtsVoice`, `PipelineConfig` (Task 2); `contentPaths` (Task 2); `readJsonl`, `appendJsonl` (Task 1); `mapLimit` (Task 4); `Decisions`, `QUEUES` (Task 9); `QueueItem` (Task 12); `sha256Hex`; `canonicalJson`, `Accent` (`@wordado/core`).
- Produces:
  - `interface Tts { speak(text: string, voice: TtsVoice): Promise<Uint8Array> }` (MP3 bytes)
  - `openRouterTts(opts: { apiKey: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Tts`
  - `interface Encoded { readonly bytes: Uint8Array; readonly seconds: number }`; `interface Encoder { toM4a(mp3: Uint8Array): Promise<Encoded> }`
  - `ffmpegEncoder(opts?: { ffmpeg?: string; ffprobe?: string }): Encoder`; `hasFfmpeg(): boolean`
  - `interface AudioRecord { readonly clip_id: string; readonly entry_id: string; readonly accent: Accent; readonly text: string; readonly voice_key: string; readonly generation: number; readonly batch: string; readonly reason: 'new' | 'voice' | 'redo'; readonly created_at: string; readonly seconds: number }`
  - `voiceKey(model: string, voice: TtsVoice): string`
  - `readAudioRecords(dir: string): AudioRecord[]`; `currentClips(records: readonly AudioRecord[]): Map<string, AudioRecord>` (key `${entry_id}|${accent}`)
  - `interface ClipNeed { readonly entry_id: string; readonly accent: Accent; readonly text: string; readonly generation: number; readonly reason: AudioRecord['reason'] }`
  - `clipsNeeded(live: readonly { entry_id: string; headword: string }[], records: readonly AudioRecord[], config: PipelineConfig, decisions: Decisions): ClipNeed[]`
  - `generateClips(dir: string, needs: readonly ClipNeed[], deps: { tts: Tts; encoder: Encoder; config: PipelineConfig; batch: string; now: () => string; concurrency?: number }): Promise<{ made: AudioRecord[]; failed: string[]; skipped: number }>`
  - `audioSample(clipIds: readonly string[], batch: string): Set<string>`; `listenedTo(records: readonly AudioRecord[]): Map<string, Set<string>>` (batch → the clips queued for listening)
  - `audioQueueItems(records: readonly AudioRecord[], decisions: Decisions): QueueItem[]`
  - `audioProblems(live: readonly { entry_id: string }[], records: readonly AudioRecord[], config: PipelineConfig, decisions: Decisions): string[]`
  - `MIN_SECONDS = 0.15`, `MAX_SECONDS = 3`

- [ ] **Step 1: Write the failing tests**

`pipeline/src/tts.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openRouterTts } from './tts'

const voice = { voice: 'alloy', instructions: 'British.' }
function tts(responses: (Response | Error)[]) {
  const bodies: Record<string, unknown>[] = []
  const t = openRouterTts({
    apiKey: 'k',
    model: 'openai/gpt-4o-mini-tts-2025-12-15',
    sleep: async () => {},
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const next = responses.shift()!
      if (next instanceof Error) throw next
      return next
    },
  })
  return { t, bodies }
}
const mp3 = () => new Response(new Uint8Array([0xff, 0xfb, 1, 2]), { headers: { 'content-type': 'audio/mpeg' } })

describe('openRouterTts', () => {
  it('asks for MP3 with the voice and its instructions, and returns the bytes', async () => {
    const { t, bodies } = tts([mp3()])
    expect([...(await t.speak('thank you', voice))]).toEqual([0xff, 0xfb, 1, 2])
    expect(bodies[0]).toEqual({
      model: 'openai/gpt-4o-mini-tts-2025-12-15',
      input: 'thank you',
      voice: 'alloy',
      response_format: 'mp3',
      provider: { options: { openai: { instructions: 'British.' } } },
    })
  })

  it('passes a voice’s own provider options through instead', async () => {
    const { t, bodies } = tts([mp3()])
    await t.speak('hi', { ...voice, provider_options: { 'google-ai-studio': { speech_metadata: { style: 'calm' } } } })
    expect(bodies[0]!['provider']).toEqual({ options: { 'google-ai-studio': { speech_metadata: { style: 'calm' } } } })
  })

  it('retries rate limits and server errors; refuses a JSON error or an empty body', async () => {
    expect((await tts([new Response('', { status: 429 }), new Error('reset'), mp3()]).t.speak('a', voice)).length).toBe(4)
    await expect(tts([new Response('{"error":{}}', { status: 400, headers: { 'content-type': 'application/json' } })]).t.speak('a', voice)).rejects.toThrow(/HTTP 400/)
    await expect(tts([new Response(new Uint8Array(), { headers: { 'content-type': 'audio/mpeg' } })]).t.speak('a', voice)).rejects.toThrow(/no audio/)
  })
})
```

`pipeline/src/encoder.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { ffmpegEncoder, hasFfmpeg } from './encoder'

// CI installs ffmpeg for this suite (Task 18); a laptop without it skips only this file.
describe.skipIf(!hasFfmpeg())('ffmpegEncoder', () => {
  const tone = (): Uint8Array =>
    new Uint8Array(
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=0.5', '-af', 'adelay=400,apad=pad_dur=0.4', '-c:a', 'libmp3lame', '-f', 'mp3', 'pipe:1']),
    )

  it('trims the silence around the sound and writes AAC in MP4', async () => {
    const out = await ffmpegEncoder().toM4a(tone())
    expect(new TextDecoder().decode(out.bytes.slice(4, 8))).toBe('ftyp')
    expect(out.seconds).toBeGreaterThan(0.4)
    expect(out.seconds).toBeLessThan(0.9)
  })

  it('gives the same bytes for the same input', async () => {
    const input = tone()
    const [a, b] = [await ffmpegEncoder().toM4a(input), await ffmpegEncoder().toM4a(input)]
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true)
  })

  it('names the problem when the input is not audio', async () => {
    await expect(ffmpegEncoder().toM4a(new TextEncoder().encode('not audio'))).rejects.toThrow(/ffmpeg/)
  })
})
```

`pipeline/src/audio.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioProblems, audioQueueItems, audioSample, clipsNeeded, generateClips, readAudioRecords, voiceKey, type AudioRecord } from './audio'
import { readConfig } from './config'
import { Decisions, QUEUES } from './decisions'
import type { Encoder } from './encoder'
import { makeContent } from './testing/fixture'
import type { Tts } from './tts'

const NOW = '2026-10-01T10:00:00Z'
const fakeTts = (): Tts & { said: string[] } => {
  const said: string[] = []
  return { said, speak: async (text) => (said.push(text), new TextEncoder().encode(`mp3:${text}`)) }
}
const encoder = (seconds: (text: string, attempt: number) => number): Encoder => {
  const attempts = new Map<string, number>()
  return {
    toM4a: async (mp3) => {
      const text = new TextDecoder().decode(mp3)
      const n = (attempts.get(text) ?? 0) + 1
      attempts.set(text, n)
      return { bytes: new TextEncoder().encode(`m4a:${text}:${n}`), seconds: seconds(text, n) }
    },
  }
}

describe('clipsNeeded', () => {
  const dir = makeContent()
  const config = readConfig(dir)
  const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
  const rec = (extra: Partial<AudioRecord> = {}): AudioRecord => ({
    clip_id: 'water-1-uk-1', entry_id: 'water-1', accent: 'uk', text: 'water', voice_key: vk, generation: 1, batch: 'b1', reason: 'new', created_at: NOW, seconds: 0.6, ...extra,
  })
  const live = [{ entry_id: 'water-1', headword: 'water' }]

  it('needs a first clip, then nothing while the voice and the word stay the same', () => {
    expect(clipsNeeded(live, [], config, Decisions.read(dir))).toEqual([{ entry_id: 'water-1', accent: 'uk', text: 'water', generation: 1, reason: 'new' }])
    expect(clipsNeeded(live, [rec()], config, Decisions.read(dir))).toEqual([])
  })

  it('makes a new generation when the voice changed, or the current clip was marked redo', () => {
    expect(clipsNeeded(live, [rec({ voice_key: 'old' })], config, Decisions.read(dir))).toMatchObject([{ generation: 2, reason: 'voice' }])
    const d = Decisions.read(dir)
    d.append(QUEUES.audio, [{ key: 'water-1-uk-1', at: NOW, verdict: 'redo', proposed: 'water-1-uk-1', by: 'reports' }])
    expect(clipsNeeded(live, [rec()], config, d)).toMatchObject([{ generation: 2, reason: 'redo' }])
    expect(clipsNeeded(live, [rec(), rec({ clip_id: 'water-1-uk-2', generation: 2, reason: 'redo' })], config, d)).toEqual([])
  })
})

describe('generateClips', () => {
  it('writes each clip under a new ID and records it as it goes', async () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const needs = [{ entry_id: 'water-1', accent: 'uk' as const, text: 'water', generation: 1, reason: 'new' as const }]
    const out = await generateClips(dir, needs, { tts: fakeTts(), encoder: encoder(() => 0.6), config, batch: '20261001T1000', now: () => NOW })
    expect(out.made.map((r) => r.clip_id)).toEqual(['water-1-uk-1'])
    expect(readFileSync(join(dir, 'audio', 'water-1-uk-1.m4a'), 'utf8')).toBe('m4a:mp3:water:1')
    expect(readAudioRecords(dir)).toEqual(out.made)
  })

  it('makes a clip again when it is too short or too long, up to three tries', async () => {
    const dir = makeContent()
    const tts = fakeTts()
    const needs = [
      { entry_id: 'a-1', accent: 'uk' as const, text: 'a', generation: 1, reason: 'new' as const },
      { entry_id: 'b-1', accent: 'uk' as const, text: 'b', generation: 1, reason: 'new' as const },
    ]
    const out = await generateClips(dir, needs, { tts, encoder: encoder((t, n) => (t.endsWith('a') ? (n < 3 ? 5 : 0.5) : 0.05)), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect(out.made.map((r) => r.clip_id)).toEqual(['a-1-uk-1'])
    expect(out.failed).toEqual(['b-1-uk-1: 3 tries, the last 0.05 s long (0.15–3 s)'])
    expect(tts.said.filter((w) => w === 'a')).toHaveLength(3)
    expect(tts.said.filter((w) => w === 'b')).toHaveLength(3)
  })

  it('a failed clip leaves the others written and recorded', async () => {
    const dir = makeContent()
    const tts: Tts = { speak: async (text) => { if (text === 'bad') throw new Error('HTTP 400'); return new TextEncoder().encode(text) } }
    const needs = ['good', 'bad'].map((w) => ({ entry_id: `${w}-1`, accent: 'uk' as const, text: w, generation: 1, reason: 'new' as const }))
    const out = await generateClips(dir, needs, { tts, encoder: encoder(() => 0.5), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect(out.failed).toEqual(['bad-1-uk-1: HTTP 400'])
    expect(readAudioRecords(dir).map((r) => r.clip_id)).toEqual(['good-1-uk-1'])
    expect(existsSync(join(dir, 'audio', 'bad-1-uk-1.m4a'))).toBe(false)
  })

  it('makes at most max_clips_per_run, and counts the rest as skipped', async () => {
    const dir = makeContent({ config: { tts: { ...readConfig(makeContent()).tts, max_clips_per_run: 1 } } })
    const needs = ['x', 'y'].map((w) => ({ entry_id: `${w}-1`, accent: 'uk' as const, text: w, generation: 1, reason: 'new' as const }))
    const out = await generateClips(dir, needs, { tts: fakeTts(), encoder: encoder(() => 0.5), config: readConfig(dir), batch: 'b', now: () => NOW })
    expect([out.made.length, out.skipped]).toEqual([1, 1])
  })
})

describe('the spot-listen (Decision 12)', () => {
  const ids = Array.from({ length: 120 }, (_, i) => `w${i}-1-uk-1`)

  it('samples max(5, 10%) of a batch, the same way every time', () => {
    expect(audioSample(ids, 'b1').size).toBe(12)
    expect(audioSample(ids.slice(0, 20), 'b1').size).toBe(5)
    expect(audioSample(ids.slice(0, 3), 'b1').size).toBe(3)
    expect([...audioSample(ids, 'b1')]).toEqual([...audioSample([...ids].reverse(), 'b1')])
  })

  it('queues the sample and every clip made again, until each has a verdict; the gate waits for them', () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
    const records: AudioRecord[] = ids.map((clip_id, i) => ({
      clip_id, entry_id: `w${i}-1`, accent: 'uk', text: `w${i}`, voice_key: vk, generation: 1, batch: 'b1', reason: 'new', created_at: NOW, seconds: 0.5,
    }))
    const d = Decisions.read(dir)
    const live = records.map((r) => ({ entry_id: r.entry_id }))
    const items = audioQueueItems(records, d)
    expect(items).toHaveLength(12)
    expect(items[0]!.context).toMatchObject({ listen: `../../audio/${items[0]!.key}.m4a`, reason: 'new' })
    expect(audioProblems(live, records, config, d)).toEqual(['audio batch b1: 12 clips not yet listened to'])
    d.append(QUEUES.audio, items.map((i) => ({ key: i.key, at: NOW, verdict: 'ok' as const, proposed: i.key, by: 'r' })))
    expect(audioQueueItems(records, d)).toEqual([])
    expect(audioProblems(live, records, config, d)).toEqual([])
  })

  it('names a live entry with no current clip, or whose clip was marked redo', () => {
    const dir = makeContent()
    const config = readConfig(dir)
    const d = Decisions.read(dir)
    const vk = voiceKey(config.tts.model, config.tts.accents.uk!)
    const r: AudioRecord = { clip_id: 'a-1-uk-1', entry_id: 'a-1', accent: 'uk', text: 'a', voice_key: vk, generation: 1, batch: 'b', reason: 'new', created_at: NOW, seconds: 0.5 }
    d.append(QUEUES.audio, [{ key: 'a-1-uk-1', at: NOW, verdict: 'redo', proposed: 'a-1-uk-1', by: 'r' }])
    expect(audioProblems([{ entry_id: 'a-1' }, { entry_id: 'b-1' }], [r], config, d)).toEqual([
      'a-1: uk clip a-1-uk-1 is marked redo; run corpus audio',
      'b-1: no current uk clip; run corpus audio',
    ])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- tts encoder audio`
Expected: FAIL, unresolved imports.

- [ ] **Step 3: Implement**

`pipeline/src/tts.ts`:

```ts
import type { TtsVoice } from './config'

/** The TTS port (spec §17). Returns MP3 bytes; the encoder makes the app's clip from them. */
export interface Tts {
  speak(text: string, voice: TtsVoice): Promise<Uint8Array>
}

const ENDPOINT = 'https://openrouter.ai/api/v1/audio/speech'
const ATTEMPTS = 4

/**
 * OpenRouter's speech endpoint (Decision 11). The body follows OpenAI's
 * audio-speech shape. Provider-specific settings travel in
 * `provider.options`; by default that is OpenAI's `instructions`.
 */
export function openRouterTts(opts: { apiKey: string; model: string; fetch?: typeof fetch; sleep?: (ms: number) => Promise<void> }): Tts {
  const doFetch = opts.fetch ?? fetch
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  return {
    async speak(text, voice) {
      const body = JSON.stringify({
        model: opts.model,
        input: text,
        voice: voice.voice,
        response_format: 'mp3',
        provider: { options: voice.provider_options ?? { openai: { instructions: voice.instructions } } },
      })
      let last = ''
      for (let i = 0; i < ATTEMPTS; i += 1) {
        if (i > 0) await sleep(1000 * 2 ** (i - 1))
        let res: Response
        try {
          res = await doFetch(ENDPOINT, { method: 'POST', headers: { authorization: `Bearer ${opts.apiKey}`, 'content-type': 'application/json' }, body })
        } catch (err) {
          last = `network: ${err instanceof Error ? err.message : String(err)}`
          continue
        }
        if (res.status === 429 || res.status >= 500) {
          last = `HTTP ${res.status}`
          continue
        }
        if (!res.ok) throw new Error(`TTS "${text}": HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
        const bytes = new Uint8Array(await res.arrayBuffer())
        if (bytes.length === 0 || !(res.headers.get('content-type') ?? '').startsWith('audio/')) throw new Error(`TTS "${text}": no audio in the response`)
        return bytes
      }
      throw new Error(`TTS "${text}": gave up after ${ATTEMPTS} attempts: ${last}`)
    },
  }
}
```

`pipeline/src/encoder.ts`:

```ts
import { execFile, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

export interface Encoded {
  readonly bytes: Uint8Array
  readonly seconds: number
}

export interface Encoder {
  toM4a(mp3: Uint8Array): Promise<Encoded>
}

/**
 * Silence trimmed from both ends (the reverse trick trims the tail), EBU R128
 * loudness at −16 LUFS so every word plays at one volume, 0.1 s of tail, and
 * mono AAC at 48 kbit/s in MP4: the sample's format, `audio/mp4` (Decision 11).
 * Bit-exact flags and no metadata make the same input give the same bytes.
 */
const FILTER = [
  'silenceremove=start_periods=1:start_threshold=-50dB',
  'areverse',
  'silenceremove=start_periods=1:start_threshold=-50dB',
  'areverse',
  'loudnorm=I=-16:TP=-1.5:LRA=11',
  'apad=pad_dur=0.1',
].join(',')

export function ffmpegEncoder(opts: { ffmpeg?: string; ffprobe?: string } = {}): Encoder {
  const ffmpeg = opts.ffmpeg ?? 'ffmpeg'
  const ffprobe = opts.ffprobe ?? 'ffprobe'
  return {
    async toM4a(mp3) {
      const dir = mkdtempSync(join(tmpdir(), 'clip-'))
      const input = join(dir, 'in.mp3')
      const output = join(dir, 'out.m4a')
      try {
        writeFileSync(input, mp3)
        try {
          await run(ffmpeg, [
            '-hide_banner', '-loglevel', 'error', '-y', '-i', input,
            '-af', FILTER, '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', '48k',
            '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact', '-movflags', '+faststart',
            output,
          ])
        } catch (err) {
          throw new Error(`ffmpeg could not encode the clip: ${(err as { stderr?: string }).stderr?.trim() || String(err)}`)
        }
        const probe = await run(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', output])
        return { bytes: new Uint8Array(readFileSync(output)), seconds: Number(probe.stdout.trim()) }
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  }
}

export function hasFfmpeg(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version']).status === 0 && spawnSync('ffprobe', ['-version']).status === 0
  } catch {
    return false
  }
}
```

`pipeline/src/audio.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { canonicalJson, type Accent } from '@wordado/core'
import { sha256Hex } from './checksum'
import type { PipelineConfig, TtsVoice } from './config'
import { contentPaths } from './content'
import { QUEUES, type Decisions } from './decisions'
import type { Encoder } from './encoder'
import { appendJsonl, readJsonl } from './files'
import { mapLimit } from './mapLimit'
import type { QueueItem } from './queues'
import type { Tts } from './tts'

export const MIN_SECONDS = 0.15
export const MAX_SECONDS = 3
const TRIES = 3

/** One clip ever made. A clip's bytes never change: a new take is a new generation and a new ID (Decision 10). */
export interface AudioRecord {
  readonly clip_id: string
  readonly entry_id: string
  readonly accent: Accent
  readonly text: string
  readonly voice_key: string
  readonly generation: number
  /** The `corpus audio` run that made it: the unit of the spot-listen (§5.4). */
  readonly batch: string
  /** new: first clip; voice: the voice settings changed; redo: a reviewer or a report asked for it. */
  readonly reason: 'new' | 'voice' | 'redo'
  readonly created_at: string
  readonly seconds: number
}

export interface ClipNeed {
  readonly entry_id: string
  readonly accent: Accent
  readonly text: string
  readonly generation: number
  readonly reason: AudioRecord['reason']
}

const sha = (s: string) => sha256Hex(new TextEncoder().encode(s))

/** Changing the model, voice, instructions or options of an accent changes its key, and so remakes its clips. */
export function voiceKey(model: string, voice: TtsVoice): string {
  return sha(canonicalJson([model, voice])).slice(0, 16)
}

export function readAudioRecords(dir: string): AudioRecord[] {
  return readJsonl<AudioRecord>(contentPaths(dir).audioRecords)
}

/** The latest generation per entry and accent. */
export function currentClips(records: readonly AudioRecord[]): Map<string, AudioRecord> {
  const out = new Map<string, AudioRecord>()
  for (const r of records) {
    const key = `${r.entry_id}|${r.accent}`
    const have = out.get(key)
    if (!have || r.generation > have.generation) out.set(key, r)
  }
  return out
}

const isRedone = (decisions: Decisions, clipId: string) => decisions.for(QUEUES.audio, clipId).some((e) => e.verdict === 'redo')

export function clipsNeeded(
  live: readonly { entry_id: string; headword: string }[],
  records: readonly AudioRecord[],
  config: PipelineConfig,
  decisions: Decisions,
): ClipNeed[] {
  const current = currentClips(records)
  const needs: ClipNeed[] = []
  for (const e of live) {
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = current.get(`${e.entry_id}|${accent}`)
      const need = (reason: AudioRecord['reason']) => needs.push({ entry_id: e.entry_id, accent, text: e.headword, generation: (cur?.generation ?? 0) + 1, reason })
      if (!cur) need('new')
      else if (cur.voice_key !== voiceKey(config.tts.model, voice) || cur.text !== e.headword) need('voice')
      else if (isRedone(decisions, cur.clip_id)) need('redo')
    }
  }
  return needs
}

/**
 * Makes each needed clip: speak, encode, check its length, and try again up to
 * three times. Each clip is written and recorded the moment it is made, so a
 * failure or a stop keeps everything before it (Review Focus 2).
 */
export async function generateClips(
  dir: string,
  needs: readonly ClipNeed[],
  deps: { tts: Tts; encoder: Encoder; config: PipelineConfig; batch: string; now: () => string; concurrency?: number },
): Promise<{ made: AudioRecord[]; failed: string[]; skipped: number }> {
  const paths = contentPaths(dir)
  mkdirSync(paths.audioDir, { recursive: true })
  const todo = needs.slice(0, deps.config.tts.max_clips_per_run)
  const made: AudioRecord[] = []
  const failed: string[] = []
  await mapLimit(todo, deps.concurrency ?? 4, async (need) => {
    const clipId = `${need.entry_id}-${need.accent}-${need.generation}`
    const voice = deps.config.tts.accents[need.accent]!
    try {
      let last = 0
      for (let i = 0; i < TRIES; i += 1) {
        const clip = await deps.encoder.toM4a(await deps.tts.speak(need.text, voice))
        last = clip.seconds
        if (clip.seconds < MIN_SECONDS || clip.seconds > MAX_SECONDS) continue
        writeFileSync(paths.clip(clipId), clip.bytes)
        const record: AudioRecord = {
          clip_id: clipId,
          entry_id: need.entry_id,
          accent: need.accent,
          text: need.text,
          voice_key: voiceKey(deps.config.tts.model, voice),
          generation: need.generation,
          batch: deps.batch,
          reason: need.reason,
          created_at: deps.now(),
          seconds: Math.round(clip.seconds * 100) / 100,
        }
        appendJsonl(paths.audioRecords, [record])
        made.push(record)
        return
      }
      failed.push(`${clipId}: ${TRIES} tries, the last ${last} s long (${MIN_SECONDS}–${MAX_SECONDS} s)`)
    } catch (err) {
      failed.push(`${clipId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  })
  return { made, failed: failed.sort(), skipped: needs.length - todo.length }
}

/** A batch's spot-listen: max(5, ⌈10%⌉) clips chosen by a hash of batch and clip, so reruns choose the same. */
export function audioSample(clipIds: readonly string[], batch: string): Set<string> {
  const size = Math.min(clipIds.length, Math.max(5, Math.ceil(clipIds.length / 10)))
  return new Set([...clipIds].sort((a, b) => (sha(`${batch}|${a}`) < sha(`${batch}|${b}`) ? -1 : 1)).slice(0, size))
}

/** Per batch, the clips a reviewer must listen to: the sample, and every clip made again (Decision 12). */
export function listenedTo(records: readonly AudioRecord[]): Map<string, Set<string>> {
  const byBatch = new Map<string, AudioRecord[]>()
  for (const r of records) byBatch.set(r.batch, [...(byBatch.get(r.batch) ?? []), r])
  const out = new Map<string, Set<string>>()
  for (const [batch, rs] of byBatch) {
    const chosen = audioSample(rs.map((r) => r.clip_id), batch)
    for (const r of rs) if (r.reason === 'redo') chosen.add(r.clip_id)
    out.set(batch, chosen)
  }
  return out
}

const heard = (decisions: Decisions, clipId: string) => decisions.for(QUEUES.audio, clipId).some((e) => e.verdict === 'ok' || e.verdict === 'redo')

export function audioQueueItems(records: readonly AudioRecord[], decisions: Decisions): QueueItem[] {
  const byId = new Map(records.map((r) => [r.clip_id, r]))
  const current = new Set([...currentClips(records).values()].map((r) => r.clip_id))
  return [...listenedTo(records).values()]
    .flatMap((set) => [...set])
    .filter((id) => current.has(id) && !heard(decisions, id))
    .map((id) => {
      const r = byId.get(id)!
      return { key: id, proposed: id, context: { headword: r.text, accent: r.accent, listen: `../../audio/${id}.m4a`, reason: r.reason } }
    })
}

/** What stops a release on audio: a live entry without a current clip, a clip marked redo, a batch not yet heard. */
export function audioProblems(live: readonly { entry_id: string }[], records: readonly AudioRecord[], config: PipelineConfig, decisions: Decisions): string[] {
  const problems: string[] = []
  const current = currentClips(records)
  const batches = new Set<string>()
  for (const e of live) {
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = current.get(`${e.entry_id}|${accent}`)
      if (!cur || cur.voice_key !== voiceKey(config.tts.model, voice)) problems.push(`${e.entry_id}: no current ${accent} clip; run corpus audio`)
      else if (isRedone(decisions, cur.clip_id)) problems.push(`${e.entry_id}: ${accent} clip ${cur.clip_id} is marked redo; run corpus audio`)
      else batches.add(cur.batch)
    }
  }
  const chosen = listenedTo(records)
  for (const batch of [...batches].sort()) {
    const waiting = [...(chosen.get(batch) ?? [])].filter((id) => !heard(decisions, id)).length
    if (waiting > 0) problems.push(`audio batch ${batch}: ${waiting} clips not yet listened to`)
  }
  return problems
}
```

A clip marked `redo` counts as heard for its batch: the reviewer listened to it. Its replacement lands in a later batch, where it is always queued (reason `redo`).

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test -- tts encoder audio && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS: 3 TTS tests, 3 encoder tests (skipped without ffmpeg; install it with `brew install ffmpeg` to run them), and 9 audio tests.

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/tts.ts pipeline/src/tts.test.ts pipeline/src/encoder.ts pipeline/src/encoder.test.ts pipeline/src/audio.ts pipeline/src/audio.test.ts
git commit -m "feat(pipeline): TTS clips with a new ID per take, and the spot-listen gate"
```

---
### Task 14: Assembling packs, the gate and the release directory

`planRelease` folds every decision over the draft into one pack per L1, at the next corpus version. It carries every previously published entry that is no longer live as retired, runs the review, audio and succession gates, and reports what blocks (Decision 14). `writeRelease` writes the CDN directory: the manifest, the packs, the clips they name, `fixes.json` and `release.json`. `adoptRelease` makes a published release the new `last-published/`. `corpus publishable` now refuses a draft.

**Files:**
- Create: `pipeline/src/assemble.ts`, `pipeline/src/assemble.test.ts`, `pipeline/src/fixes.ts`, `pipeline/src/fixes.test.ts`, `pipeline/src/release.ts`, `pipeline/src/release.test.ts`
- Modify: `pipeline/src/publishable.ts`, `pipeline/src/publishable.test.ts`, `pipeline/src/testing/fixture.ts`

**Interfaces:**
- Consumes: `Draft` (Task 11); `Decisions`, `foldField`, `QUEUES` (Task 9); `levelSampled` (Task 12); `AudioRecord`, `currentClips`, `voiceKey`, `audioProblems`, `readAudioRecords` (Task 13); `CuratedTheme`, `readConfig`, `readThemes` (Task 2); `readClearedSources` (Task 2); `inPathOrder` (Task 10); `readLastPublished`, `Fix`, `FixesFile` (Task 11); `buildPack`, `BuildError`, `BuildOutput`, `AUDIO_EXT` (`./build`); `checkPackSuccession`, `MANIFEST_SCHEMA_VERSION`, `Pack`, `PackEntry`, `PackManifest`, `Accent` (`@wordado/core`).
- Produces:
  - `interface AssembleInput { readonly l1: string; readonly corpusVersion: number; readonly draft: Draft; readonly decisions: Decisions; readonly themes: readonly CuratedTheme[]; readonly records: readonly AudioRecord[]; readonly config: PipelineConfig; readonly previous: Pack | null; readonly hasClip: (clipId: string) => boolean }`
  - `interface Assembled { readonly source: Record<string, unknown>; readonly clipIds: readonly string[]; readonly problems: readonly string[]; readonly pending: readonly string[] }`
  - `assemble(input: AssembleInput): Assembled`
  - `diffFixes(previous: Pack | null, next: Pack): Fix[]`; `nextFixesFile(previous: FixesFile, fixes: readonly Fix[], version: number): FixesFile`
  - `interface ReleasePlan { readonly corpusVersion: number; readonly outputs: readonly BuildOutput[]; readonly clipIds: readonly string[]; readonly manifest: PackManifest; readonly fixes: FixesFile; readonly releaseInfo: ReleaseInfo; readonly problems: readonly string[]; readonly pending: readonly string[]; readonly retired: readonly string[] }`
  - `interface ReleaseInfo { readonly corpus_version: number; readonly draft: boolean; readonly built_at: string; readonly l1s: readonly string[]; readonly attributions: readonly { readonly source: string; readonly attribution: string }[] }`
  - `planRelease(dir: string, opts: { draft: boolean; now: string }): ReleasePlan`
  - `writeRelease(dir: string, outDir: string, plan: ReleasePlan): string[]` (refuses a plan with problems, a non-draft plan with pending items, and a non-empty `outDir`)
  - `adoptRelease(dir: string, outDir: string): void`
  - Fixture additions: `approveAll(dir: string): void` (ok on every pending item, audio included); `recordAudio(dir: string): Promise<void>` (fake clips for every live entry)

- [ ] **Step 1: Add the fixture helpers**

Append to `pipeline/src/testing/fixture.ts`:

```ts
import { audioQueueItems, clipsNeeded, generateClips, readAudioRecords } from '../audio'
import { readConfig } from '../config'
import { Decisions, QUEUES } from '../decisions'
import { readDraft } from '../draft'
import { pendingItems } from '../queues'

/** A clip per live entry from a fake voice: bytes that name the clip, 0.5 s long. */
export async function recordAudio(dir: string, batch = 'b1'): Promise<void> {
  const config = readConfig(dir)
  const draft = readDraft(dir)
  const live = new Set(draft.live)
  const needs = clipsNeeded(draft.entries.filter((e) => live.has(e.entry_id)), readAudioRecords(dir), config, Decisions.read(dir))
  await generateClips(dir, needs, {
    tts: { speak: async (text) => new TextEncoder().encode(text) },
    encoder: { toM4a: async (mp3) => ({ bytes: new Uint8Array([...new TextEncoder().encode('m4a:'), ...mp3]), seconds: 0.5 }) },
    config,
    batch,
    now: () => '2026-10-01T10:00:00Z',
  })
}

/** A reviewer who says ok to everything pending, audio included. */
export function approveAll(dir: string): void {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const at = '2026-10-01T11:00:00Z'
  for (const [queue, items] of pendingItems(readDraft(dir), decisions, config.l1s)) {
    decisions.append(queue, items.map((i) => ({ key: i.key, at, verdict: 'ok' as const, proposed: i.proposed, by: 'fixture' })))
  }
  decisions.append(QUEUES.audio, audioQueueItems(readAudioRecords(dir), decisions).map((i) => ({ key: i.key, at, verdict: 'ok' as const, proposed: i.key, by: 'fixture' })))
}
```

Put these imports at the top of the file, with the others.

- [ ] **Step 2: Write the failing tests**

`pipeline/src/fixes.test.ts`:

```ts
import type { Pack, PackEntry } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { diffFixes, nextFixesFile } from './fixes'

const e = (extra: Partial<PackEntry> = {}): PackEntry => ({
  entry_id: 'water-1', headword: 'water', variants: [], pos: 'noun', sense: '', ipa: 'x', level: 'A1', unit_id: 'a1-01', themes: [],
  translation: 'вода', alternates: [], examples: ['Water.'], audio: { uk: 'water-1-uk-1' }, retired: false, ...extra,
})
const pack = (v: number, entries: PackEntry[]) => ({ corpus_version: v, entries }) as unknown as Pack

describe('diffFixes', () => {
  it('names each changed field of an entry both versions carry, as a report field', () => {
    const before = pack(1, [e(), e({ entry_id: 'new-1' })])
    const after = pack(2, [e({ alternates: ['водичка'], examples: ['Water, please.'], audio: { uk: 'water-1-uk-2' }, level: 'A2' }), e({ entry_id: 'brand-1' })])
    expect(diffFixes(before, after)).toEqual([
      { word_id: 'c:water-1', field: 'audio', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'example', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'level', fixed_in: 2 },
      { word_id: 'c:water-1', field: 'translation', fixed_in: 2 },
    ])
  })

  it('counts a changed sense gloss as a translation fix, and nothing for an unchanged entry', () => {
    expect(diffFixes(pack(1, [e()]), pack(2, [e({ sense: 'питейна' })]))).toEqual([{ word_id: 'c:water-1', field: 'translation', fixed_in: 2 }])
    expect(diffFixes(pack(1, [e()]), pack(2, [e()]))).toEqual([])
    expect(diffFixes(null, pack(1, [e()]))).toEqual([])
  })
})

describe('nextFixesFile', () => {
  it('keeps every earlier fix and adds the new ones', () => {
    const prev = { schema_version: 1 as const, corpus_version: 1, fixes: [{ word_id: 'c:a-1', field: 'audio' as const, fixed_in: 1 }] }
    expect(nextFixesFile(prev, [{ word_id: 'c:b-1', field: 'level', fixed_in: 2 }], 2)).toEqual({
      schema_version: 1,
      corpus_version: 2,
      fixes: [{ word_id: 'c:a-1', field: 'audio', fixed_in: 1 }, { word_id: 'c:b-1', field: 'level', fixed_in: 2 }],
    })
  })
})
```

`pipeline/src/release.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalJson, checkPackSuccession, loadCorpus, validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { sha256Hex } from './checksum'
import { Decisions, QUEUES } from './decisions'
import { runDraft } from './draft'
import { writeJson } from './files'
import { publishProblems } from './publishable'
import { adoptRelease, planRelease, writeRelease } from './release'
import { approveAll, makeContent, recordAudio, sampleLlm } from './testing/fixture'

const NOW = '2026-10-02T09:00:00Z'
const out = () => join(mkdtempSync(join(tmpdir(), 'release-')), 'out')
const reader = (dir: string) => (path: string) => (existsSync(join(dir, path)) ? new Uint8Array(readFileSync(join(dir, path))) : null)
const packOf = (dir: string, file: string): Pack => {
  const r = validatePack(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (r.status !== 'ok') throw new Error('invalid')
  return r.pack
}

async function reviewed(): Promise<string> {
  const dir = makeContent()
  await runDraft({ dir, llm: sampleLlm(), offline: false })
  await recordAudio(dir)
  approveAll(dir)
  return dir
}

describe('planRelease and writeRelease', () => {
  it('releases a fully reviewed corpus as version 1, a valid successor of the sample', async () => {
    const dir = await reviewed()
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending]).toEqual([[], []])
    const o = out()
    writeRelease(dir, o, plan)
    expect(readdirSync(o).sort()).toEqual(['audio', 'corpus-v1-bg.pack', 'fixes.json', 'manifest.json', 'release.json'])
    expect(publishProblems(reader(o))).toEqual([])
    const v1 = packOf(o, 'corpus-v1-bg.pack')
    const v0 = packOf(join(dir, 'last-published'), 'corpus-v0-bg.pack')
    expect(checkPackSuccession(v0, v1)).toEqual([])
    expect(v1.entries.filter((e) => !e.retired)).toHaveLength(64)
    // bank has two live senses, so both ship their Bulgarian gloss; a lone sense ships none (Decision 8).
    expect(v1.entries.filter((e) => e.headword === 'bank').map((e) => e.sense)).toEqual(['за пари', 'на река'])
    expect(v1.entries.find((e) => e.entry_id === 'hello-1')).toMatchObject({ sense: '', audio: { uk: 'hello-1-uk-1' } })
    expect(v1.units.map((u) => [u.unit_id, u.order])).toEqual([['a1-01', 1], ['a1-02', 2], ['a1-03', 3], ['a1-04', 4], ['a2-01', 5]])
    expect(loadCorpus([v1]).entries.size).toBe(64)
    expect(JSON.parse(readFileSync(join(o, 'release.json'), 'utf8'))).toEqual({ corpus_version: 1, draft: false, built_at: NOW, l1s: ['bg'], attributions: [] })
  })

  it('refuses while anything awaits review, naming it; a draft builds anyway and cannot be published', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.problems).toEqual([])
    expect(plan.pending).toContain('hello-1: translation (bg) not reviewed')
    expect(plan.pending).toContain('hello-1: no current uk clip; run corpus audio')
    expect(() => writeRelease(dir, out(), plan)).toThrow(/awaits review/)
    const o = out()
    writeRelease(dir, o, planRelease(dir, { draft: true, now: NOW }))
    expect(publishProblems(reader(o))).toEqual(['release.json: a draft build cannot be published'])
  })

  it('carries an entry the last version had and this one does not, retired with its published fields', async () => {
    const dir = await reviewed()
    const o1 = out()
    writeRelease(dir, o1, planRelease(dir, { draft: false, now: NOW }))
    adoptRelease(dir, o1)
    const theV1 = packOf(o1, 'corpus-v1-bg.pack').entries.find((e) => e.entry_id === 'the-1')!
    const draft = JSON.parse(readFileSync(join(dir, 'work', 'draft.json'), 'utf8'))
    const the = draft.entries.find((e: { entry_id: string }) => e.entry_id === 'the-1')
    Decisions.read(dir).append(QUEUES.translation('bg'), [{ key: 'the-1', at: NOW, verdict: 'drop', proposed: the.l1.bg, by: 'r' }])
    // Online: unit a1-04 has new words, so it is named again.
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    approveAll(dir)
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect([plan.problems, plan.pending, plan.retired]).toEqual([[], [], ['the-1']])
    const o2 = out()
    writeRelease(dir, o2, plan)
    const v2 = packOf(o2, 'corpus-v2-bg.pack')
    expect(v2.entries.find((e) => e.entry_id === 'the-1')).toEqual({ ...theV1, retired: true })
    expect(checkPackSuccession(packOf(o1, 'corpus-v1-bg.pack'), v2)).toEqual([])
  })

  it('records a reviewer’s fix in fixes.json, after the earlier fixes', async () => {
    const dir = await reviewed()
    const o1 = out()
    writeRelease(dir, o1, planRelease(dir, { draft: false, now: NOW }))
    adoptRelease(dir, o1)
    const fixesV1 = JSON.parse(readFileSync(join(o1, 'fixes.json'), 'utf8'))
    const go = JSON.parse(readFileSync(join(dir, 'work', 'draft.json'), 'utf8')).entries.find((e: { entry_id: string }) => e.entry_id === 'go-1')
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'reopen', by: 'reports' }])
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: NOW, verdict: 'fix', proposed: go.l1.bg, value: { ...go.l1.bg, alternates: ['ходя', 'вървя'] }, by: 'r' }])
    const o2 = out()
    writeRelease(dir, o2, planRelease(dir, { draft: false, now: NOW }))
    const fixes = JSON.parse(readFileSync(join(o2, 'fixes.json'), 'utf8'))
    expect(fixes.corpus_version).toBe(2)
    expect(fixes.fixes.slice(0, fixesV1.fixes.length)).toEqual(fixesV1.fixes)
    expect(fixes.fixes.slice(fixesV1.fixes.length)).toEqual([{ word_id: 'c:go-1', field: 'translation', fixed_in: 2 }])
  })

  it('carries, retired, an entry only the last published pack knows', async () => {
    const dir = await reviewed()
    const lp = join(dir, 'last-published')
    const v0 = packOf(lp, 'corpus-v0-bg.pack')
    const ghost = { ...v0.entries.find((e) => e.entry_id === 'hello-1')!, entry_id: 'ghost-1', headword: 'ghost', audio: {} }
    const units = v0.units.map((u) => (u.unit_id === 'a1-01' ? { ...u, entry_ids: [...u.entry_ids, 'ghost-1'] } : u))
    const bytes = new TextEncoder().encode(canonicalJson({ ...v0, entries: [...v0.entries, ghost], units }))
    writeFileSync(join(lp, 'corpus-v0-bg.pack'), bytes)
    const manifest = JSON.parse(readFileSync(join(lp, 'manifest.json'), 'utf8'))
    manifest.packs[0] = { ...manifest.packs[0], sha256: sha256Hex(bytes), bytes: bytes.length }
    writeJson(join(lp, 'manifest.json'), manifest)
    await runDraft({ dir, llm: sampleLlm(), offline: true })
    const plan = planRelease(dir, { draft: false, now: NOW })
    expect(plan.problems).toEqual([])
    const o = out()
    writeRelease(dir, o, plan)
    expect(packOf(o, 'corpus-v1-bg.pack').entries.find((e) => e.entry_id === 'ghost-1')).toMatchObject({ retired: true, unit_id: 'a1-01' })
  })

  it('refuses to write into a directory that is not empty', async () => {
    const dir = await reviewed()
    const o = out()
    mkdirSync(o, { recursive: true })
    writeFileSync(join(o, 'stray'), '')
    expect(() => writeRelease(dir, o, planRelease(dir, { draft: false, now: NOW }))).toThrow(/not empty/)
  })

  it('checks the licence register again at release', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'))
    writeJson(join(dir, 'sources.json'), [{ ...sources[0], cleared_by: '', cleared_on: '' }])
    expect(() => planRelease(dir, { draft: false, now: NOW })).toThrow(/not cleared/)
  })

  it('lists a source’s required attribution in release.json', async () => {
    const dir = await reviewed()
    const sources = JSON.parse(readFileSync(join(dir, 'sources.json'), 'utf8'))
    writeJson(join(dir, 'sources.json'), [{ ...sources[0], attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' }])
    expect(planRelease(dir, { draft: false, now: NOW }).releaseInfo.attributions).toEqual([
      { source: 'Invented test list', attribution: 'Frequencies from the Invented Corpus (CC BY 4.0).' },
    ])
  })
})
```

`pipeline/src/assemble.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assemble } from './assemble'
import { readAudioRecords } from './audio'
import { readConfig, readThemes } from './config'
import { Decisions } from './decisions'
import { readDraft, runDraft } from './draft'
import { readLastPublished } from './lastPublished'
import { makeContent, sampleLlm } from './testing/fixture'

describe('assemble', () => {
  it('names a headword with several live senses that lacks an L1 gloss, whatever the reviewers say', async () => {
    const dir = makeContent()
    await runDraft({ dir, llm: sampleLlm(), offline: false })
    const draft = readDraft(dir)
    const noGloss = {
      ...draft,
      entries: draft.entries.map((e) => (e.entry_id === 'bank-2' ? { ...e, l1: { bg: { ...e.l1['bg']!, sense: '' } } } : e)),
    }
    const config = readConfig(dir)
    const out = assemble({
      l1: 'bg', corpusVersion: 1, draft: noGloss, decisions: Decisions.read(dir), themes: readThemes(dir, ['bg']),
      records: readAudioRecords(dir), config, previous: readLastPublished(dir).packs.get('bg') ?? null, hasClip: () => true,
    })
    expect(out.problems).toEqual(['bank-2: bank (noun) has 2 live entries, so it needs a bg sense gloss'])
  })
})
```

Append to `pipeline/src/publishable.test.ts`, inside its `describe`:

```ts
  it('refuses a draft release, and a release.json that is not JSON', () => {
    expect(publishProblems(sample({ 'release.json': bytes({ draft: true }) }))).toEqual(['release.json: a draft build cannot be published'])
    expect(publishProblems(sample({ 'release.json': new TextEncoder().encode('{') }))).toEqual(['release.json: not JSON'])
    expect(publishProblems(sample({ 'release.json': bytes({ draft: false }) }))).toEqual([])
  })
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- fixes release assemble publishable`
Expected: FAIL, unresolved imports, and the publishable test fails.

- [ ] **Step 4: Implement**

`pipeline/src/fixes.ts`:

```ts
import { canonicalJson, type Pack, type PackEntry, type ReportField } from '@wordado/core'
import type { Fix, FixesFile } from './lastPublished'

const FIELDS: readonly [ReportField, (e: PackEntry) => unknown][] = [
  ['audio', (e) => e.audio],
  ['example', (e) => e.examples],
  ['level', (e) => e.level],
  ['translation', (e) => [e.translation, e.alternates, e.sense]],
]

/** The report fields (spec §8.10) whose values changed between two versions, per entry both carry. */
export function diffFixes(previous: Pack | null, next: Pack): Fix[] {
  if (!previous) return []
  const before = new Map(previous.entries.map((e) => [e.entry_id, e]))
  const out: Fix[] = []
  for (const e of [...next.entries].sort((a, b) => (a.entry_id < b.entry_id ? -1 : 1))) {
    const old = before.get(e.entry_id)
    if (!old) continue
    for (const [field, value] of FIELDS) {
      if (canonicalJson(value(old)) !== canonicalJson(value(e))) out.push({ word_id: `c:${e.entry_id}`, field, fixed_in: next.corpus_version })
    }
  }
  return out
}

/** `fixes.json` is cumulative: a learner whose report is older than several versions still finds its fix (plan 8b). */
export function nextFixesFile(previous: FixesFile, fixes: readonly Fix[], version: number): FixesFile {
  return { schema_version: 1, corpus_version: version, fixes: [...previous.fixes, ...fixes] }
}
```

With several L1 packs, `planRelease` concatenates each pack's fixes and removes duplicates by `word_id|field`: the audio and examples are shared, so they change in every pack at once.

`pipeline/src/assemble.ts`:

```ts
import { norm, type Accent, type Pack, type PackEntry } from '@wordado/core'
import { currentClips, voiceKey, type AudioRecord } from './audio'
import type { CuratedTheme, PipelineConfig, TtsVoice } from './config'
import { foldField, QUEUES, type Decisions } from './decisions'
import type { Draft } from './draft'
import { levelSampled } from './queues'
import { inPathOrder } from './units'

export interface AssembleInput {
  readonly l1: string
  readonly corpusVersion: number
  readonly draft: Draft
  readonly decisions: Decisions
  readonly themes: readonly CuratedTheme[]
  readonly records: readonly AudioRecord[]
  readonly config: PipelineConfig
  /** This L1's last published pack, or null for an L1 never published. */
  readonly previous: Pack | null
  readonly hasClip: (clipId: string) => boolean
}

export interface Assembled {
  /** A pack source for `buildPack`: the pack without schema_version and audio. */
  readonly source: Record<string, unknown>
  readonly clipIds: readonly string[]
  /** Blocks any release, draft or not. */
  readonly problems: readonly string[]
  /** Awaits a reviewer; blocks all but a draft. */
  readonly pending: readonly string[]
}

/**
 * One L1's pack at the next version (Decision 14). A live entry takes each
 * field's folded value. An entry the previous pack carried and this draft
 * does not make live stays, retired, exactly as published (spec §5.1). Its
 * clips are kept when their files are still here.
 */
export function assemble(input: AssembleInput): Assembled {
  const { l1, draft, decisions, config } = input
  const problems: string[] = []
  const pending: string[] = []
  const live = new Set(draft.live)
  const liveEntries = draft.entries.filter((e) => live.has(e.entry_id))
  const clips = currentClips(input.records)

  const perHead = new Map<string, number>()
  for (const e of liveEntries) perHead.set(`${norm(e.headword)}|${e.pos}`, (perHead.get(`${norm(e.headword)}|${e.pos}`) ?? 0) + 1)

  const unitOf = new Map<string, string>()
  for (const u of draft.units) for (const id of u.entry_ids) unitOf.set(id, u.unit_id)

  const entries: PackEntry[] = []
  for (const e of liveEntries) {
    const english = foldField(e.english, decisions.for(QUEUES.english, e.entry_id))
    const translation = foldField(e.l1[l1]!, decisions.for(QUEUES.translation(l1), e.entry_id))
    if (!english.reviewed) pending.push(`${e.entry_id}: english not reviewed`)
    if (!translation.reviewed) pending.push(`${e.entry_id}: translation (${l1}) not reviewed`)
    if ((e.level_flagged || levelSampled(e.entry_id)) && !foldField(e.level_proposal, decisions.for(QUEUES.level, e.entry_id)).reviewed) {
      pending.push(`${e.entry_id}: level not reviewed`)
    }
    const senses = perHead.get(`${norm(e.headword)}|${e.pos}`) ?? 1
    if (senses > 1 && translation.value.sense.trim() === '') problems.push(`${e.entry_id}: ${e.headword} (${e.pos}) has ${senses} live entries, so it needs a ${l1} sense gloss`)
    const audio: Partial<Record<Accent, string>> = {}
    for (const [accent, voice] of Object.entries(config.tts.accents) as [Accent, TtsVoice][]) {
      const cur = clips.get(`${e.entry_id}|${accent}`)
      if (cur && cur.voice_key === voiceKey(config.tts.model, voice) && input.hasClip(cur.clip_id)) audio[accent] = cur.clip_id
    }
    const unitId = unitOf.get(e.entry_id)
    if (!unitId) {
      problems.push(`${e.entry_id}: live but in no unit`)
      continue
    }
    entries.push({
      entry_id: e.entry_id,
      headword: e.headword,
      variants: english.value.variants,
      pos: e.pos,
      sense: senses > 1 ? translation.value.sense : '',
      ipa: english.value.ipa,
      level: e.level,
      unit_id: unitId,
      themes: e.themes,
      translation: translation.value.translation,
      alternates: translation.value.alternates,
      examples: english.value.examples,
      audio,
      retired: false,
    })
  }

  for (const old of input.previous?.entries ?? []) {
    if (live.has(old.entry_id)) continue
    const audio = Object.fromEntries(Object.entries(old.audio).filter(([, clip]) => input.hasClip(clip)))
    entries.push({ ...old, audio, retired: true })
  }

  const present = new Set(entries.map((e) => e.entry_id))
  const byUnit = new Map<string, string[]>()
  for (const e of entries) byUnit.set(e.unit_id, [...(byUnit.get(e.unit_id) ?? []), e.entry_id])
  const previousUnits = new Map((input.previous?.units ?? []).map((u) => [u.unit_id, u]))
  const draftUnits = new Map(draft.units.map((u) => [u.unit_id, u]))
  const unitIds = new Set([...byUnit.keys()])
  const ordered = inPathOrder(
    [...unitIds].map((id) => ({ unit_id: id, level: (draftUnits.get(id) ?? previousUnits.get(id))!.level, entry_ids: [] as string[] })),
  )
  const units = ordered.map((u, i) => {
    const members = draftUnits.get(u.unit_id)?.entry_ids.filter((id) => present.has(id)) ?? []
    const listed = new Set(members)
    const entry_ids = [...members, ...byUnit.get(u.unit_id)!.filter((id) => !listed.has(id))]
    const hasLive = entry_ids.some((id) => live.has(id))
    let title = previousUnits.get(u.unit_id)?.title
    const proposed = draftUnits.get(u.unit_id)?.titles[l1]
    if (hasLive && proposed) {
      const state = foldField(proposed, decisions.for(QUEUES.title(l1), u.unit_id))
      if (!state.reviewed) pending.push(`unit ${u.unit_id}: title (${l1}) not reviewed`)
      title = state.value
    }
    if (!title) {
      problems.push(`unit ${u.unit_id}: has no ${l1} title`)
      title = { en: u.unit_id, l1: u.unit_id }
    }
    return { unit_id: u.unit_id, level: u.level, order: i + 1, title, entry_ids }
  })

  const themes = input.themes.map((t) => ({
    theme_id: t.theme_id,
    name: { en: t.name['en']!, l1: t.name[l1]! },
    description: { en: t.description['en']!, l1: t.description[l1]! },
  }))
  const clipIds = entries.flatMap((e) => Object.values(e.audio)).sort()
  return {
    source: { pack_id: `corpus-${l1}`, corpus_version: input.corpusVersion, l1, target: 'en', units, themes, entries },
    clipIds,
    problems,
    pending,
  }
}
```

`pipeline/src/release.ts`:

```ts
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackSuccession, MANIFEST_SCHEMA_VERSION, type PackManifest } from '@wordado/core'
import { assemble } from './assemble'
import { audioProblems, readAudioRecords } from './audio'
import { AUDIO_EXT, BuildError, buildPack, type BuildOutput } from './build'
import { readConfig, readThemes } from './config'
import { contentPaths } from './content'
import { Decisions } from './decisions'
import { readDraft } from './draft'
import { writeJson } from './files'
import { diffFixes, nextFixesFile } from './fixes'
import { readLastPublished, type Fix, type FixesFile } from './lastPublished'
import { readClearedSources } from './sources'

export interface ReleaseInfo {
  readonly corpus_version: number
  readonly draft: boolean
  readonly built_at: string
  readonly l1s: readonly string[]
  /** Attributions the cleared sources require; the app's about page shows them (handover). */
  readonly attributions: readonly { readonly source: string; readonly attribution: string }[]
}

export interface ReleasePlan {
  readonly corpusVersion: number
  readonly outputs: readonly BuildOutput[]
  readonly clipIds: readonly string[]
  readonly manifest: PackManifest
  readonly fixes: FixesFile
  readonly releaseInfo: ReleaseInfo
  readonly problems: readonly string[]
  readonly pending: readonly string[]
  readonly retired: readonly string[]
}

/** Everything a release would write, and what stands in its way. Writes nothing. */
export function planRelease(dir: string, opts: { draft: boolean; now: string }): ReleasePlan {
  const paths = contentPaths(dir)
  const config = readConfig(dir)
  const sources = readClearedSources(dir)
  const themes = readThemes(dir, config.l1s)
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const records = readAudioRecords(dir)
  const last = readLastPublished(dir)
  const corpusVersion = last.manifest.corpus_version + 1
  const problems: string[] = [...draft.problems]
  const pending: string[] = []
  for (const l1 of last.packs.keys()) if (!config.l1s.includes(l1)) problems.push(`${l1}: published before, so it must stay in pipeline.json's l1s`)

  const hasClip = (id: string) => existsSync(paths.clip(id))
  const outputs: BuildOutput[] = []
  const clipIds = new Set<string>()
  const fixes: Fix[] = []
  const seenFix = new Set<string>()
  const retired = new Set<string>()
  const liveList = draft.entries.filter((e) => draft.live.includes(e.entry_id))
  pending.push(...audioProblems(liveList, records, config, decisions))

  for (const l1 of config.l1s) {
    const previous = last.packs.get(l1) ?? null
    const a = assemble({ l1, corpusVersion, draft, decisions, themes, records, config, previous, hasClip })
    problems.push(...a.problems.map((p) => `${l1}: ${p}`))
    pending.push(...a.pending.filter((p) => !pending.includes(p)))
    let out: BuildOutput
    try {
      out = buildPack(a.source, a.clipIds.map((clipId) => ({ clipId, bytes: new Uint8Array(readFileSync(paths.clip(clipId))) })))
    } catch (err) {
      if (!(err instanceof BuildError)) throw err
      problems.push(...err.errors.map((e) => `${l1}: ${e.path || '(pack)'}: ${e.message}`))
      continue
    }
    if (previous) problems.push(...checkPackSuccession(previous, out.pack).map((e) => `${l1}: ${e.path}: ${e.message}`))
    for (const e of out.pack.entries) if (e.retired && last.live.has(e.entry_id)) retired.add(e.entry_id)
    for (const f of diffFixes(previous, out.pack)) {
      const key = `${f.word_id}|${f.field}`
      if (!seenFix.has(key)) {
        seenFix.add(key)
        fixes.push(f)
      }
    }
    for (const id of a.clipIds) clipIds.add(id)
    outputs.push(out)
  }

  const manifest: PackManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    packs: outputs.flatMap((o) => o.manifest.packs).sort((a, b) => (a.l1 < b.l1 ? -1 : 1)),
  }
  const releaseInfo: ReleaseInfo = {
    corpus_version: corpusVersion,
    draft: opts.draft,
    built_at: opts.now,
    l1s: config.l1s,
    attributions: sources.filter((s) => s.record.attribution.trim() !== '').map((s) => ({ source: s.record.title, attribution: s.record.attribution })),
  }
  return {
    corpusVersion,
    outputs,
    clipIds: [...clipIds].sort(),
    manifest,
    fixes: nextFixesFile(last.fixes, fixes, corpusVersion),
    releaseInfo,
    problems,
    pending,
    retired: [...retired].sort(),
  }
}

/** The CDN directory (plan 7's layout): manifest.json, the packs, audio/, fixes.json and release.json. */
export function writeRelease(dir: string, outDir: string, plan: ReleasePlan): string[] {
  if (plan.problems.length > 0) throw new Error(`the release has ${plan.problems.length} problems:\n${plan.problems.join('\n')}`)
  if (!plan.releaseInfo.draft && plan.pending.length > 0) throw new Error(`${plan.pending.length} items await review; release with --draft to build anyway`)
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`${outDir} is not empty`)
  const paths = contentPaths(dir)
  mkdirSync(join(outDir, 'audio'), { recursive: true })
  const files: string[] = []
  for (const o of plan.outputs) {
    writeFileSync(join(outDir, o.packFile), o.packBytes)
    files.push(o.packFile)
  }
  for (const id of plan.clipIds) {
    cpSync(paths.clip(id), join(outDir, 'audio', `${id}.${AUDIO_EXT}`))
    files.push(`audio/${id}.${AUDIO_EXT}`)
  }
  writeJson(join(outDir, 'fixes.json'), plan.fixes)
  writeJson(join(outDir, 'release.json'), plan.releaseInfo)
  writeJson(join(outDir, 'manifest.json'), plan.manifest)
  return [...files, 'fixes.json', 'release.json', 'manifest.json']
}

/** After a publish: the release becomes last-published/, the predecessor of the next (Decision 14). Audio stays in audio/. */
export function adoptRelease(dir: string, outDir: string): void {
  const target = contentPaths(dir).lastPublished
  const info = JSON.parse(readFileSync(join(outDir, 'release.json'), 'utf8')) as ReleaseInfo
  if (info.draft) throw new Error('a draft release is never adopted')
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.pack') || f === 'manifest.json' || f === 'fixes.json') cpSync(join(outDir, f), join(target, f))
  }
}
```

In `pipeline/src/publishable.ts`, add the draft check at the top of `publishProblems`, before reading the manifest:

```ts
  const release = read('release.json')
  if (release !== null) {
    try {
      if ((JSON.parse(new TextDecoder().decode(release)) as { draft?: unknown }).draft === true) return ['release.json: a draft build cannot be published']
    } catch {
      return ['release.json: not JSON']
    }
  }
```

Also update its doc comment: "…and not a draft release (Decision 14)."

- [ ] **Step 5: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/pipeline typecheck && pnpm lint`
Expected: every pipeline test passes, including the existing `build`, `sample` and `publishable` suites. Typecheck and lint are clean.

The first release test sets the expectations for the whole release: 64 live entries, units `a1-01`…`a2-01` with orders 1–5, and a v0 → v1 succession with no errors. If units or counts differ, compare against Task 11's `draft.test.ts` first. The release must agree with the draft.

- [ ] **Step 6: Commit**

```bash
git add pipeline/src/assemble.ts pipeline/src/assemble.test.ts pipeline/src/fixes.ts pipeline/src/fixes.test.ts pipeline/src/release.ts pipeline/src/release.test.ts pipeline/src/publishable.ts pipeline/src/publishable.test.ts pipeline/src/testing/fixture.ts
git commit -m "feat(pipeline): release: packs per L1, the review and succession gates, fixes.json"
```

---

### Task 15: Report triage

`corpus triage` reads `content_report` through a read-only role and appends `reopen` and `redo` events (Decision 13). Reporter IDs are hashed as they are read, so nothing written to the content repository identifies a learner. The notes are learner-written text: they go into the `reopen` event's note, truncated, for the reviewer (runbook: privacy).

**Files:**
- Create: `pipeline/src/reports.ts`, `pipeline/src/reports.test.ts`
- Modify: `pipeline/package.json` (`pg`, `@types/pg`)

**Interfaces:**
- Consumes: `Decisions`, `QUEUES`, `DecisionEvent` (Task 9); `AudioRecord`, `currentClips` (Task 13); `Fix` (Task 11); `sha256Hex`; `REPORT_FIELDS`, `ReportField` (`@wordado/core`).
- Produces:
  - `interface ReportRow { readonly id: number; readonly word_id: string; readonly field: ReportField; readonly note: string; readonly pack_version: number; readonly reporter: string; readonly received_at: number }`
  - `REPORTS_SQL: string`
  - `pullReports(query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>): Promise<ReportRow[]>`
  - `interface TriageInput { readonly reports: readonly ReportRow[]; readonly decisions: Decisions; readonly records: readonly AudioRecord[]; readonly fixes: readonly Fix[]; readonly live: ReadonlySet<string>; readonly l1s: readonly string[]; readonly threshold: number; readonly now: string }`
  - `triage(input: TriageInput): { events: { queue: string; event: DecisionEvent }[]; summary: string[] }`
  - `pgQuery(url: string): Promise<{ query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>; close: () => Promise<void> }>`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @wordado/pipeline add pg@^8.23.0 && pnpm --filter @wordado/pipeline add -D @types/pg@^8.23.1`
(the versions the server uses).

- [ ] **Step 2: Write the failing test**

`pipeline/src/reports.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { AudioRecord } from './audio'
import { Decisions, QUEUES } from './decisions'
import { pullReports, triage, type ReportRow } from './reports'
import { makeContent } from './testing/fixture'

const NOW = '2026-10-10T00:00:00Z'
const DAY = 86_400_000
const t0 = Date.parse('2026-10-05T00:00:00Z')
let nextId = 1
const r = (extra: Partial<ReportRow>): ReportRow => ({ id: nextId++, word_id: 'c:go-1', field: 'translation', note: '', pack_version: 1, reporter: 'a', received_at: t0, ...extra })
const input = (reports: ReportRow[], extra: Partial<Parameters<typeof triage>[0]> = {}) => ({
  reports,
  decisions: Decisions.read(makeContent()),
  records: [] as AudioRecord[],
  fixes: [],
  live: new Set(['go-1', 'water-1']),
  l1s: ['bg'],
  threshold: 2,
  now: NOW,
  ...extra,
})

describe('triage (spec §8.10, Decision 13)', () => {
  it('reopens a translation set when two different learners report it', () => {
    expect(triage(input([r({ reporter: 'a' })])).events).toEqual([])
    const out = triage(input([r({ reporter: 'a', note: 'should be "ида"' }), r({ reporter: 'b', field: 'other' })]))
    expect(out.events).toEqual([
      { queue: 'translation-bg', event: { key: 'go-1', at: NOW, verdict: 'reopen', by: 'reports', note: '2 reports (other, translation): should be "ида"' } },
    ])
    expect(out.summary).toEqual(['go-1: translation-bg reopened (2 reports)'])
  })

  it('counts one learner once, and each deleted account’s report on its own', () => {
    expect(triage(input([r({ reporter: 'a' }), r({ reporter: 'a' })])).events).toEqual([])
    expect(triage(input([r({ reporter: 'deleted:1' }), r({ reporter: 'deleted:2' })])).events).toHaveLength(1)
  })

  it('sends examples to the English queue and levels to the level queue', () => {
    const out = triage(input([r({ field: 'example' }), r({ field: 'example', reporter: 'b' }), r({ field: 'level' }), r({ field: 'level', reporter: 'b' })]))
    expect(out.events.map((e) => e.queue)).toEqual(['english', 'level'])
  })

  it('ignores reports made on a version before the field was last fixed, and reports already acted on', () => {
    const fixes = [{ word_id: 'c:go-1', field: 'translation' as const, fixed_in: 3 }]
    expect(triage(input([r({ pack_version: 2 }), r({ pack_version: 2, reporter: 'b' })], { fixes })).events).toEqual([])
    const dir = makeContent()
    const d = Decisions.read(dir)
    d.append(QUEUES.translation('bg'), [{ key: 'go-1', at: new Date(t0 + DAY).toISOString(), verdict: 'reopen', by: 'reports' }])
    expect(triage(input([r({}), r({ reporter: 'b' })], { decisions: d })).events).toEqual([])
    expect(triage(input([r({ received_at: t0 + 2 * DAY }), r({ reporter: 'b', received_at: t0 + 2 * DAY })], { decisions: d })).events).toHaveLength(1)
  })

  it('remakes a reported clip at the first report, once per clip', () => {
    const rec: AudioRecord = { clip_id: 'go-1-uk-1', entry_id: 'go-1', accent: 'uk', text: 'go', voice_key: 'k', generation: 1, batch: 'b', reason: 'new', created_at: '2026-10-01T00:00:00Z', seconds: 0.5 }
    const out = triage(input([r({ field: 'audio' })], { records: [rec] }))
    expect(out.events).toEqual([{ queue: 'audio', event: { key: 'go-1-uk-1', at: NOW, verdict: 'redo', proposed: 'go-1-uk-1', by: 'reports', note: '1 report' } }])
    const d = Decisions.read(makeContent())
    d.append(QUEUES.audio, [out.events[0]!.event])
    expect(triage(input([r({ field: 'audio' })], { records: [rec], decisions: d })).events).toEqual([])
  })

  it('skips personal words, entries that are not live, and audio reports older than the clip', () => {
    const rec: AudioRecord = { clip_id: 'go-1-uk-2', entry_id: 'go-1', accent: 'uk', text: 'go', voice_key: 'k', generation: 2, batch: 'b', reason: 'redo', created_at: '2026-10-06T00:00:00Z', seconds: 0.5 }
    expect(triage(input([r({ word_id: 'u:abc' }), r({ word_id: 'u:abc', reporter: 'b' }), r({ word_id: 'c:gone-1' }), r({ word_id: 'c:gone-1', reporter: 'b' }), r({ field: 'audio' })], { records: [rec] })).events).toEqual([])
  })
})

describe('pullReports', () => {
  it('hashes every reporter and keeps no raw user ID', async () => {
    const rows = await pullReports(async () => ({
      rows: [
        { id: '7', word_id: 'c:go-1', field: 'translation', note: 'x', pack_version: 1, reporter_id: 'user_123', received_at: '1760000000000' },
        { id: 8, word_id: 'c:go-1', field: 'audio', note: '', pack_version: 1, reporter_id: null, received_at: 1760000000001 },
      ],
    }))
    expect(rows.map((x) => x.reporter)).toEqual([expect.stringMatching(/^[0-9a-f]{16}$/), 'deleted:8'])
    expect(JSON.stringify(rows)).not.toContain('user_123')
    expect(rows[0]).toMatchObject({ id: 7, received_at: 1760000000000 })
  })

  it('skips a row with a field this build does not know', async () => {
    expect(await pullReports(async () => ({ rows: [{ id: 1, word_id: 'c:a-1', field: 'colour', note: '', pack_version: 1, reporter_id: 'u', received_at: 1 }] }))).toEqual([])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- reports`
Expected: FAIL, "Failed to resolve import './reports'".

- [ ] **Step 4: Implement**

`pipeline/src/reports.ts`:

```ts
import { REPORT_FIELDS, type ReportField } from '@wordado/core'
import pg from 'pg'
import { currentClips, type AudioRecord } from './audio'
import { sha256Hex } from './checksum'
import { QUEUES, type DecisionEvent, type Decisions } from './decisions'
import type { Fix } from './lastPublished'

/** A content report as triage sees it: the reporter pseudonymous, never the user ID (spec §11). */
export interface ReportRow {
  readonly id: number
  readonly word_id: string
  readonly field: ReportField
  readonly note: string
  /** The corpus version the learner was looking at. */
  readonly pack_version: number
  /** A hash of the reporter, or `deleted:<report id>` once the account is gone (each counts once). */
  readonly reporter: string
  /** Epoch milliseconds. */
  readonly received_at: number
}

/** Plan 5's table (server/migrations/0001_init.sql). The role that runs this can select from it and nothing else. */
export const REPORTS_SQL = 'select id, word_id, field, note, pack_version, reporter_id, received_at from content_report order by id'

const hash = (s: string) => sha256Hex(new TextEncoder().encode(s)).slice(0, 16)

export async function pullReports(query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>): Promise<ReportRow[]> {
  const { rows } = await query(REPORTS_SQL)
  return rows.flatMap((row) => {
    const field = String(row['field'])
    if (!(REPORT_FIELDS as readonly string[]).includes(field)) return []
    const id = Number(row['id'])
    const reporter = row['reporter_id']
    return [
      {
        id,
        word_id: String(row['word_id']),
        field: field as ReportField,
        note: String(row['note'] ?? ''),
        pack_version: Number(row['pack_version']),
        reporter: typeof reporter === 'string' && reporter !== '' ? hash(reporter) : `deleted:${id}`,
        received_at: Number(row['received_at']),
      },
    ]
  })
}

export interface TriageInput {
  readonly reports: readonly ReportRow[]
  readonly decisions: Decisions
  readonly records: readonly AudioRecord[]
  readonly fixes: readonly Fix[]
  readonly live: ReadonlySet<string>
  readonly l1s: readonly string[]
  readonly threshold: number
  readonly now: string
}

const NOTE_LIMIT = 280

/** Which queue a report sends its entry to, and which fixes reset its count. Audio is handled apart. */
function routes(field: ReportField, l1s: readonly string[]): { queue: string; fixField: ReportField }[] {
  if (field === 'example') return [{ queue: QUEUES.english, fixField: 'example' }]
  if (field === 'level') return [{ queue: QUEUES.level, fixField: 'level' }]
  // A report does not carry the learner's L1, so it reopens every L1's set; exact while Bulgarian is the only one.
  return l1s.map((l1) => ({ queue: QUEUES.translation(l1), fixField: 'translation' as ReportField }))
}

/**
 * Reports since a field last changed and since its last reopen, from
 * distinct reporters, reopen the field at the threshold (spec §8.10). A
 * single audio report remakes the entry's current clips made before it.
 */
export function triage(input: TriageInput): { events: { queue: string; event: DecisionEvent }[]; summary: string[] } {
  const events: { queue: string; event: DecisionEvent }[] = []
  const summary: string[] = []
  const lastFix = new Map<string, number>()
  for (const f of input.fixes) lastFix.set(`${f.word_id}|${f.field}`, Math.max(lastFix.get(`${f.word_id}|${f.field}`) ?? 0, f.fixed_in))

  const groups = new Map<string, { queue: string; entryId: string; reports: ReportRow[] }>()
  const audio = new Map<string, ReportRow[]>()
  for (const report of input.reports) {
    if (!report.word_id.startsWith('c:')) continue
    const entryId = report.word_id.slice(2)
    if (!input.live.has(entryId)) continue
    if (report.field === 'audio') {
      audio.set(entryId, [...(audio.get(entryId) ?? []), report])
      continue
    }
    for (const { queue, fixField } of routes(report.field, input.l1s)) {
      if (report.pack_version < (lastFix.get(`${report.word_id}|${fixField}`) ?? 0)) continue
      const key = `${queue}|${entryId}`
      const g = groups.get(key) ?? { queue, entryId, reports: [] }
      g.reports.push(report)
      groups.set(key, g)
    }
  }

  for (const g of [...groups.values()].sort((a, b) => (a.queue === b.queue ? (a.entryId < b.entryId ? -1 : 1) : a.queue < b.queue ? -1 : 1))) {
    const reopenedAt = Math.max(0, ...input.decisions.for(g.queue, g.entryId).filter((e) => e.verdict === 'reopen').map((e) => Date.parse(e.at)))
    const fresh = g.reports.filter((x) => x.received_at > reopenedAt)
    const reporters = new Set(fresh.map((x) => x.reporter))
    if (reporters.size < input.threshold) continue
    const fields = [...new Set(fresh.map((x) => x.field))].sort().join(', ')
    const notes = fresh.map((x) => x.note.trim()).filter((n) => n !== '').join(' / ')
    const note = `${reporters.size} reports (${fields})${notes ? `: ${notes}` : ''}`.slice(0, NOTE_LIMIT)
    events.push({ queue: g.queue, event: { key: g.entryId, at: input.now, verdict: 'reopen', by: 'reports', note } })
    summary.push(`${g.entryId}: ${g.queue} reopened (${reporters.size} reports)`)
  }

  const current = currentClips(input.records)
  for (const [entryId, reports] of [...audio].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const clip of [...current.values()].filter((c) => c.entry_id === entryId)) {
      if (input.decisions.for(QUEUES.audio, clip.clip_id).some((e) => e.verdict === 'redo')) continue
      const after = reports.filter((x) => x.received_at > Date.parse(clip.created_at))
      if (after.length === 0) continue
      events.push({
        queue: QUEUES.audio,
        event: { key: clip.clip_id, at: input.now, verdict: 'redo', proposed: clip.clip_id, by: 'reports', note: `${after.length} report${after.length === 1 ? '' : 's'}` },
      })
      summary.push(`${clip.clip_id}: remade at the next corpus audio (${after.length} report${after.length === 1 ? '' : 's'})`)
    }
  }
  return { events, summary }
}

/** A read-only connection to the store of record (runbook: the corpus_reports role). */
export async function pgQuery(url: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return {
    query: (sql: string) => client.query(sql) as Promise<{ rows: Record<string, unknown>[] }>,
    close: () => client.end(),
  }
}
```

In the first test, the note `2 reports (other, translation): should be "ида"` comes from sorting the fields alphabetically and joining the non-empty notes.

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test -- reports && pnpm --filter @wordado/pipeline typecheck`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add pipeline/package.json pnpm-lock.yaml pipeline/src/reports.ts pipeline/src/reports.test.ts
git commit -m "feat(pipeline): report triage, with reporters hashed as they are read"
```

---
### Task 16: The commands, the live-manifest check and the whole pipeline end to end

The CLI gains `init`, `draft`, `audio`, `queues`, `import`, `triage`, `status`, `release`, `published` and `live`, beside the existing `build`, `validate`, `check` and `publishable`. `corpus live` checks that the CDN serves exactly the `last-published/` snapshot a release is built on (Review Focus 3). An end-to-end test runs the reviewer's real path through CSV files, from `init` to a second corpus version that fixes a reported word.

**Files:**
- Create: `pipeline/src/live.ts`, `pipeline/src/live.test.ts`, `pipeline/src/e2e.test.ts`, `pipeline/src/cli.test.ts`
- Modify: `pipeline/src/cli.ts`

**Interfaces:**
- Consumes: every earlier task.
- Produces: `liveProblems(dir: string, manifestUrl: string, fetchText?: (url: string) => Promise<string>): Promise<string[]>`; the CLI below.

- [ ] **Step 1: Write the failing tests**

`pipeline/src/live.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { liveProblems } from './live'
import { makeContent } from './testing/fixture'

describe('liveProblems', () => {
  it('finds nothing when the CDN serves the last published manifest, whatever its formatting', async () => {
    const dir = makeContent()
    const served = JSON.stringify(JSON.parse(readFileSync(join(dir, 'last-published', 'manifest.json'), 'utf8')))
    expect(await liveProblems(dir, 'https://content.example/manifest.json', async () => served)).toEqual([])
  })

  it('names a CDN that serves another version, so no release is built on a stale predecessor', async () => {
    const dir = makeContent()
    const other = { ...JSON.parse(readFileSync(join(dir, 'last-published', 'manifest.json'), 'utf8')), corpus_version: 3 }
    expect(await liveProblems(dir, 'https://c/manifest.json', async () => JSON.stringify(other))).toEqual([
      'https://c/manifest.json serves corpus version 3, but last-published/ holds version 0 with other files; merge the content repository’s latest publish commit, or restore last-published/ from the CDN',
    ])
  })

  it('names a manifest it cannot fetch or read', async () => {
    const dir = makeContent()
    expect(await liveProblems(dir, 'https://c/m', async () => { throw new Error('HTTP 404') })).toEqual(['https://c/m: HTTP 404'])
    expect(await liveProblems(dir, 'https://c/m', async () => '<html>')).toEqual(['https://c/m: not JSON'])
  })
})
```

`pipeline/src/cli.test.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const PIPELINE = fileURLToPath(new URL('..', import.meta.url))
const corpus = (...args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], { cwd: PIPELINE, encoding: 'utf8', env: { ...process.env, OPENROUTER_API_KEY: '' } })

describe('corpus (the CLI)', () => {
  it('init makes a content directory, and refuses to overwrite one', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    expect(corpus('init', dir).status).toBe(0)
    expect(existsSync(join(dir, 'registry.json'))).toBe(true)
    const again = corpus('init', dir)
    expect(again.status).toBe(1)
    expect(again.stderr).toMatch(/not empty/)
  })

  it('draft stops at the licence register of a new content directory, before any network', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    corpus('init', dir)
    const out = corpus('draft', dir, '--offline')
    expect(out.status).toBe(1)
    expect(out.stderr).toMatch(/sources\.json lists no sources/)
  })

  it('draft without --offline needs OPENROUTER_API_KEY; import needs --by', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'cli-')), 'content')
    corpus('init', dir)
    expect(corpus('draft', dir).stderr).toMatch(/OPENROUTER_API_KEY/)
    expect(corpus('import', dir).status).toBe(2)
  })
})
```

`pipeline/src/e2e.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPackSuccession, loadCorpus, offeredThemes, validatePack, type Pack } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { audioQueueItems, readAudioRecords } from './audio'
import { readConfig } from './config'
import { formatCsv, parseCsv } from './csv'
import { Decisions } from './decisions'
import { readDraft, runDraft } from './draft'
import { readLastPublished } from './lastPublished'
import { publishProblems } from './publishable'
import { exportQueues, importQueues, pendingItems, queueSpecs } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { triage } from './reports'
import { makeContent, recordAudio, sampleLlm } from './testing/fixture'

/** The reviewer: opens every review file, says ok to each row, and edits the rows `edits` names first. */
function review(dir: string, edits: Record<string, Record<string, string>> = {}): void {
  const root = join(dir, 'review')
  for (const queue of readdirSync(root)) {
    for (const file of readdirSync(join(root, queue)).filter((f) => f.endsWith('.csv'))) {
      const path = join(root, queue, file)
      const rows = parseCsv(readFileSync(path, 'utf8'))
      const header = rows[0]!
      for (const row of rows.slice(1)) {
        for (const [col, value] of Object.entries(edits[`${queue}:${row[0]}`] ?? {})) row[header.indexOf(col)] = value
        row[header.indexOf('verdict')] = 'ok'
      }
      writeFileSync(path, formatCsv(rows))
    }
  }
}

function queues(dir: string, stamp: string): string[] {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const items = pendingItems(readDraft(dir), decisions, config.l1s)
  items.set('audio', audioQueueItems(readAudioRecords(dir), decisions))
  return exportQueues(dir, items, queueSpecs(config.l1s), { stamp })
}

const pack = (dir: string, file: string): Pack => {
  const r = validatePack(JSON.parse(readFileSync(join(dir, file), 'utf8')))
  if (r.status !== 'ok') throw new Error('invalid pack')
  return r.pack
}
const reader = (dir: string) => (p: string) => {
  try {
    return new Uint8Array(readFileSync(join(dir, p)))
  } catch {
    return null
  }
}

describe('the corpus pipeline, end to end (spec §13)', () => {
  it('drafts, reviews through spreadsheets, releases v1, triages reports and releases the fix as v2', async () => {
    const dir = makeContent()
    const specs = queueSpecs(['bg'])

    await runDraft({ dir, llm: sampleLlm(), offline: false })
    await recordAudio(dir, '20261001T1000')
    expect(queues(dir, '2026-10-01').length).toBeGreaterThan(3)
    review(dir, { 'translation-bg:go-1': { alternates: 'ходя | вървя' } })
    expect(importQueues(dir, specs, { by: 'Мария', now: '2026-10-01T12:00:00Z' }).errors).toEqual([])
    expect(readdirSync(join(dir, 'review')).flatMap((q) => readdirSync(join(dir, 'review', q)))).toEqual([])

    const v1Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v1')
    const plan1 = planRelease(dir, { draft: false, now: '2026-10-01T13:00:00Z' })
    expect([plan1.problems, plan1.pending]).toEqual([[], []])
    writeRelease(dir, v1Dir, plan1)
    expect(publishProblems(reader(v1Dir))).toEqual([])
    const v0 = readLastPublished(dir).packs.get('bg')!
    const v1 = pack(v1Dir, 'corpus-v1-bg.pack')
    expect(checkPackSuccession(v0, v1)).toEqual([])
    expect(v1.entries.find((e) => e.entry_id === 'go-1')).toMatchObject({ translation: 'отивам', alternates: ['ходя', 'вървя'] })
    expect(offeredThemes(loadCorpus([v1])).map((t) => t.themeId)).toEqual(offeredThemes(loadCorpus([v0])).map((t) => t.themeId))
    adoptRelease(dir, v1Dir)

    const reports = ['a', 'b'].map((reporter, i) => ({
      id: i + 1, word_id: 'c:go-1', field: 'translation' as const, note: i === 0 ? 'ида' : '', pack_version: 1, reporter, received_at: Date.parse('2026-10-03T00:00:00Z'),
    }))
    const decisions = Decisions.read(dir)
    const t = triage({ reports, decisions, records: readAudioRecords(dir), fixes: readLastPublished(dir).fixes.fixes, live: new Set(readDraft(dir).live), l1s: ['bg'], threshold: 2, now: '2026-10-04T00:00:00Z' })
    for (const { queue, event } of t.events) decisions.append(queue, [event])
    expect(t.summary).toEqual(['go-1: translation-bg reopened (2 reports)'])

    await runDraft({ dir, llm: sampleLlm(), offline: true })
    expect(queues(dir, '2026-10-04')).toEqual(['review/translation-bg/2026-10-04-01.csv'])
    expect(planRelease(dir, { draft: false, now: '2026-10-04T01:00:00Z' }).pending).toEqual(['go-1: translation (bg) not reviewed'])
    review(dir, { 'translation-bg:go-1': { alternates: 'ходя | ида' } })
    importQueues(dir, specs, { by: 'Мария', now: '2026-10-04T02:00:00Z' })

    const v2Dir = join(mkdtempSync(join(tmpdir(), 'e2e-')), 'v2')
    writeRelease(dir, v2Dir, planRelease(dir, { draft: false, now: '2026-10-04T03:00:00Z' }))
    const v2 = pack(v2Dir, 'corpus-v2-bg.pack')
    expect(checkPackSuccession(v1, v2)).toEqual([])
    expect(v2.entries.find((e) => e.entry_id === 'go-1')!.alternates).toEqual(['ходя', 'ида'])
    const fixes = JSON.parse(readFileSync(join(v2Dir, 'fixes.json'), 'utf8'))
    expect(fixes.fixes.filter((f: { fixed_in: number }) => f.fixed_in === 2)).toEqual([{ word_id: 'c:go-1', field: 'translation', fixed_in: 2 }])
  }, 30_000)
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @wordado/pipeline test -- live cli e2e`
Expected: FAIL: `./live` does not resolve, and the CLI does not know `init`.

- [ ] **Step 3: Implement**

`pipeline/src/live.ts`:

```ts
import { canonicalJson } from '@wordado/core'
import { readLastPublished } from './lastPublished'

async function defaultFetch(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}

/**
 * A release is built on `last-published/`. If the CDN serves anything else,
 * the release would skip a version, or re-number one, and its succession
 * check would pass against the wrong predecessor (Review Focus 3).
 */
export async function liveProblems(dir: string, manifestUrl: string, fetchText: (url: string) => Promise<string> = defaultFetch): Promise<string[]> {
  const local = readLastPublished(dir).manifest
  let text: string
  try {
    text = await fetchText(manifestUrl)
  } catch (err) {
    return [`${manifestUrl}: ${err instanceof Error ? err.message : String(err)}`]
  }
  let served: { corpus_version?: unknown }
  try {
    served = JSON.parse(text) as { corpus_version?: unknown }
  } catch {
    return [`${manifestUrl}: not JSON`]
  }
  if (canonicalJson(served) === canonicalJson(local)) return []
  return [
    `${manifestUrl} serves corpus version ${String(served.corpus_version)}, but last-published/ holds version ${local.corpus_version} with other files; merge the content repository’s latest publish commit, or restore last-published/ from the CDN`,
  ]
}
```

Replace `pipeline/src/cli.ts` with:

```ts
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackSuccession, loadCorpus, offeredThemes, themeEntries, validatePack, type Pack, type PackError } from '@wordado/core'
import { audioQueueItems, clipsNeeded, generateClips, readAudioRecords } from './audio'
import { BuildError, buildPack, type BuildOutput, type ClipFile } from './build'
import { readConfig } from './config'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { ffmpegEncoder } from './encoder'
import { readSourceDir, writeArtifacts } from './fs'
import { initContent } from './init'
import { readLastPublished } from './lastPublished'
import { liveProblems } from './live'
import { openRouterLlm, type Llm } from './llm'
import { publishProblems } from './publishable'
import { exportQueues, importQueues, pendingItems, queueSpecs } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { pgQuery, pullReports, triage } from './reports'
import { openRouterTts } from './tts'

const USAGE = `usage: corpus <command>
  content (a content directory, e.g. an absolute path to your clone of wordado-content):
    init <dir>                     a new content directory, seeded with the sample
    draft <dir> [--offline]        every LLM stage; --offline uses the cache only
    audio <dir> [--batch <id>]     TTS clips for live entries that need one
    queues <dir>                   write pending review items to review/
    import <dir> --by <name>       apply reviewed rows as decisions
    triage <dir>                   read content reports (REPORTS_DATABASE_URL) and reopen what they cross
    status <dir>                   what stands between the content and a release
    release <dir> <out> [--draft]  build the next corpus version into <out>
    published <dir> <out>          after a publish: <out> becomes last-published/
    live <dir> <manifest-url>      does the CDN serve last-published/?
  packs:
    build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack> | publishable <dir>`

const argv = process.argv.slice(2)
const VALUED = new Set(['--by', '--batch'])
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const flag = (name: string) => argv.includes(name)
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''))
const now = () => new Date().toISOString()

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}

function fail(errors: readonly PackError[]): never {
  for (const e of errors) console.error(`${e.path || '(pack)'}: ${e.message}`)
  process.exit(1)
}

function arg(value: string | undefined): string {
  if (!value) usage()
  return value
}

function apiKey(): string {
  const key = process.env['OPENROUTER_API_KEY']
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set (the LLM and TTS go through OpenRouter)')
    process.exit(2)
  }
  return key
}

/** For --offline: any call means an item was not cached, which runDraft reports first. */
const offlineLlm: Llm = {
  model: 'offline',
  spentUsd: () => 0,
  json: () => Promise.reject(new Error('offline')),
}

function readPack(file: string): Pack {
  const result = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (result.status === 'unsupported_schema') fail([{ path: 'schema_version', message: `schema ${result.schemaVersion} is not supported by this build` }])
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
  console.log(`wrote ${out.packFile}: ${out.pack.entries.length} entries, ${out.pack.units.length} units, ${clips.length} clips, ${out.packBytes.byteLength} bytes`)
  for (const t of corpus.themes) {
    const size = themeEntries(corpus, t.themeId).length
    console.log(`  ${t.themeId}: ${size} entries${offered.has(t.themeId) ? '' : ' (below the minimum, not offered)'}`)
  }
}

async function draft(dir: string): Promise<void> {
  const config = readConfig(dir)
  const offline = flag('--offline')
  const llm = offline ? offlineLlm : openRouterLlm({ apiKey: apiKey(), model: config.llm.model, maxUsd: config.llm.max_usd_per_run })
  const d = await runDraft({ dir, llm, offline })
  const live = new Set(d.live)
  const perLevel = config.levels.map((level) => `${level} ${d.entries.filter((e) => live.has(e.entry_id) && e.level === level).length}`).join(', ')
  const units = d.units.filter((u) => u.entry_ids.some((id) => live.has(id))).length
  console.log(`draft: ${d.live.length} live entries (${perLevel}) in ${units} units; LLM spend this run $${llm.spentUsd().toFixed(2)}`)
  for (const p of d.problems) console.error(p)
}

async function audio(dir: string): Promise<void> {
  const config = readConfig(dir)
  const d = readDraft(dir)
  const live = new Set(d.live)
  const needs = clipsNeeded(d.entries.filter((e) => live.has(e.entry_id)), readAudioRecords(dir), config, Decisions.read(dir))
  const batch = option('--batch') ?? now().slice(0, 16).replace(/[-:]/g, '')
  const out = await generateClips(dir, needs, { tts: openRouterTts({ apiKey: apiKey(), model: config.tts.model }), encoder: ffmpegEncoder(), config, batch, now })
  console.log(`audio batch ${batch}: ${out.made.length} clips made, ${out.failed.length} failed, ${out.skipped} left for the next run`)
  for (const f of out.failed) console.error(f)
}

function queues(dir: string): void {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const items = pendingItems(readDraft(dir), decisions, config.l1s)
  items.set(QUEUES.audio, audioQueueItems(readAudioRecords(dir), decisions))
  const files = exportQueues(dir, items, queueSpecs(config.l1s), { stamp: now().slice(0, 10) })
  console.log(files.length > 0 ? files.join('\n') : 'no new review items')
}

function importReviewed(dir: string): void {
  const by = option('--by')
  if (!by) usage()
  const out = importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now: now() })
  console.log(`${out.applied} decisions applied; ${out.pending} rows still open`)
  for (const e of out.errors) console.error(e)
  if (out.errors.length > 0) process.exit(1)
}

async function triageReports(dir: string): Promise<void> {
  const url = process.env['REPORTS_DATABASE_URL']
  if (!url) {
    console.error('REPORTS_DATABASE_URL is not set (a read-only role on content_report; see pipeline/README.md)')
    process.exit(2)
  }
  const config = readConfig(dir)
  const db = await pgQuery(url)
  let reports
  try {
    reports = await pullReports(db.query)
  } finally {
    await db.close()
  }
  const decisions = Decisions.read(dir)
  const out = triage({
    reports,
    decisions,
    records: readAudioRecords(dir),
    fixes: readLastPublished(dir).fixes.fixes,
    live: new Set(readDraft(dir).live),
    l1s: config.l1s,
    threshold: config.report_threshold,
    now: now(),
  })
  for (const { queue, event } of out.events) decisions.append(queue, [event])
  console.log(`${reports.length} reports read; ${out.events.length} items sent back`)
  for (const s of out.summary) console.log(`  ${s}`)
}

/** "hello-1: english not reviewed" and 63 like it print as one line with a count. */
function summarise(lines: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const l of lines) {
    const kind = l.replace(/^[^:]+: /, '')
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, n]) => `  ${n} × ${kind}`)
}

function status(dir: string): void {
  const plan = planRelease(dir, { draft: false, now: now() })
  console.log(`corpus v${plan.corpusVersion}: ${plan.problems.length} problems, ${plan.pending.length} items awaiting review`)
  for (const p of plan.problems) console.log(`  ${p}`)
  for (const s of summarise(plan.pending)) console.log(s)
  if (plan.retired.length > 0) console.log(`  retires: ${plan.retired.join(', ')}`)
}

function release(dir: string, outDir: string): void {
  const plan = planRelease(dir, { draft: flag('--draft'), now: now() })
  if (plan.problems.length > 0 || (!flag('--draft') && plan.pending.length > 0)) {
    for (const p of plan.problems) console.error(p)
    for (const s of summarise(plan.pending)) console.error(s)
    process.exit(1)
  }
  const files = writeRelease(dir, outDir, plan)
  console.log(`wrote corpus v${plan.corpusVersion}${flag('--draft') ? ' (draft)' : ''} to ${outDir}: ${plan.outputs.length} packs, ${plan.clipIds.length} clips, ${files.length} files`)
  if (plan.retired.length > 0) console.log(`retired: ${plan.retired.join(', ')}`)
}

async function live(dir: string, url: string): Promise<void> {
  const problems = await liveProblems(dir, url)
  for (const p of problems) console.error(p)
  if (problems.length > 0) process.exit(1)
  console.log('ok')
}

async function main(): Promise<void> {
  const [command, first, second] = positional
  switch (command) {
    case 'init':
      initContent(arg(first))
      console.log(`initialised ${first}; next: fill in sources.json once the legal review clears a source`)
      break
    case 'draft':
      await draft(arg(first))
      break
    case 'audio':
      await audio(arg(first))
      break
    case 'queues':
      queues(arg(first))
      break
    case 'import':
      importReviewed(arg(first))
      break
    case 'triage':
      await triageReports(arg(first))
      break
    case 'status':
      status(arg(first))
      break
    case 'release':
      release(arg(first), arg(second))
      break
    case 'published':
      adoptRelease(arg(first), arg(second))
      console.log(`last-published/ is now ${second}`)
      break
    case 'live':
      await live(arg(first), arg(second))
      break
    case 'build':
      build(arg(first))
      break
    case 'validate':
      readPack(arg(first))
      console.log('ok')
      break
    case 'check': {
      const errors = checkPackSuccession(readPack(arg(first)), readPack(arg(second)))
      if (errors.length > 0) fail(errors)
      console.log('ok')
      break
    }
    case 'publishable': {
      const dir = arg(first)
      const problems = publishProblems((path) => {
        const full = join(dir, path)
        return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
      })
      for (const problem of problems) console.error(problem)
      if (problems.length > 0) process.exit(1)
      console.log('ok')
      break
    }
    default:
      usage()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

- [ ] **Step 4: Run them to see them pass**

Run: `pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/pipeline typecheck && pnpm lint && pnpm sample-pack && git diff --exit-code pipeline/samples`
Expected: every pipeline test passes. `pnpm sample-pack` still builds the sample byte for byte (`git diff` is empty).

- [ ] **Step 5: Commit**

```bash
git add pipeline/src/live.ts pipeline/src/live.test.ts pipeline/src/cli.ts pipeline/src/cli.test.ts pipeline/src/e2e.test.ts
git commit -m "feat(pipeline): the corpus commands, the live-manifest check, and the pipeline end to end"
```

---

### Task 17: Frequency lists from FineWeb and Google Books

The pilot's choice of sources (Decision 19), made repeatable in the pipeline. `corpus count-text` counts word forms in Parquet shards (FineWeb's `text` column). `corpus sum-gbooks` adds up Google Books Ngram v3 1-gram counts over a range of years. Both write the `form<TAB>count` file that `parseFrequencyList` reads, most frequent first. The operator runs them once per source refresh, on a workstation: FineWeb shards are 2 GB each. The files then go into the content repository's `sources/`, with their licence records.

**Files:**
- Create: `pipeline/src/prepare.ts`, `pipeline/src/prepare.test.ts`
- Modify: `pipeline/src/cli.ts`, `pipeline/package.json`

**Interfaces:**
- Consumes: `norm` (`@wordado/core`); `parseFrequencyList` (Task 3, in the test).
- Produces: `countInto(counts: Map<string, number>, text: string): void`; `parquetTexts(file: string, column?: string): AsyncGenerator<string>`; `countParquet(files: readonly string[], progress?: (file: string, texts: number) => void): Promise<Map<string, number>>`; `sumGoogleBooks(files: readonly string[], from: number, to: number): Promise<Map<string, number>>`; `writeCounts(file: string, counts: ReadonlyMap<string, number>, opts: { top?: number; comment: string }): number`.

- [ ] **Step 1: Add the dependencies**

Run: `pnpm --filter @wordado/pipeline add hyparquet@^1.31.2 && pnpm --filter @wordado/pipeline add -D hyparquet-writer@^0.16.10`
(Both are MIT. hyparquet reads Snappy-compressed Parquet, which FineWeb uses, with no native code.)

- [ ] **Step 2: Write the failing test**

`pipeline/src/prepare.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { parquetWriteFile } from 'hyparquet-writer'
import { describe, expect, it } from 'vitest'
import { parseFrequencyList } from './frequency'
import { countInto, countParquet, parquetTexts, sumGoogleBooks, writeCounts } from './prepare'

const tmp = () => mkdtempSync(join(tmpdir(), 'prepare-'))

describe('countInto', () => {
  it('counts word forms as the frequency lists do: lowercased, apostrophes kept inside a word, hyphens split', () => {
    const counts = new Map<string, number>()
    countInto(counts, 'Don’t stop! The well-known CAFÉ, the café. 42')
    expect([...counts]).toEqual([["don't", 1], ['stop', 1], ['the', 2], ['well', 1], ['known', 1], ['café', 2]])
  })
})

describe('parquetTexts and countParquet', () => {
  it('reads the text column of every row group, in order, and counts it', async () => {
    const file = join(tmp(), 'shard.parquet')
    await parquetWriteFile({
      filename: file,
      columnData: [
        { name: 'text', data: ['a b', 'b', 'c c c', 'd', 'e'], type: 'STRING' },
        { name: 'id', data: ['1', '2', '3', '4', '5'], type: 'STRING' },
      ],
      rowGroupSize: 2,
    })
    const texts: string[] = []
    for await (const t of parquetTexts(file)) texts.push(t)
    expect(texts).toEqual(['a b', 'b', 'c c c', 'd', 'e'])
    expect(Object.fromEntries(await countParquet([file]))).toEqual({ a: 1, b: 2, c: 3, d: 1, e: 1 })
  })
})

describe('sumGoogleBooks', () => {
  it('adds up the years asked for, folds case, and skips part-of-speech tagged forms', async () => {
    const file = join(tmp(), '1-00000-of-00004.gz')
    const lines = ['Water\t1999,5,1\t2000,3,1\t2019,4,2\t2020,9,9', 'water\t2010,1,1', 'water_NOUN\t2005,100,1', 'the\t2005,10,1', 'old\t1990,7,1']
    writeFileSync(file, gzipSync(`${lines.join('\n')}\n`))
    expect(Object.fromEntries(await sumGoogleBooks([file], 2000, 2019))).toEqual({ water: 8, the: 10 })
  })
})

describe('writeCounts', () => {
  it('writes the most frequent forms first, ties by form, in a file parseFrequencyList reads back', () => {
    const file = join(tmp(), 'sources', 'x.tsv')
    expect(writeCounts(file, new Map([['b', 2], ['a', 2], ['c', 5], ['d', 1]]), { top: 3, comment: 'test counts' })).toBe(3)
    const text = readFileSync(file, 'utf8')
    expect(text).toBe('# test counts\nform\tcount\nc\t5\na\t2\nb\t2\n')
    expect([...parseFrequencyList(text, 'x')]).toEqual([['c', 5], ['a', 2], ['b', 2]])
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm --filter @wordado/pipeline test -- prepare`
Expected: FAIL, "Failed to resolve import './prepare'".

- [ ] **Step 4: Implement**

`pipeline/src/prepare.ts`:

```ts
import { createReadStream, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { norm } from '@wordado/core'
import { asyncBufferFromFile, parquetMetadataAsync, parquetReadObjects } from 'hyparquet'

/** A running word: letters, with apostrophes inside (don't). Hyphens and digits split words. */
const TOKEN = /\p{L}+(?:['’]\p{L}+)*/gu

/** Adds a text's word forms to `counts`, normalised as parseFrequencyList normalises them (Task 3). */
export function countInto(counts: Map<string, number>, text: string): void {
  // One normalisation per text rather than per token: this runs over billions of tokens.
  for (const [token] of text.normalize('NFC').toLowerCase().matchAll(TOKEN)) {
    const form = token.includes('’') ? token.replaceAll('’', "'") : token
    counts.set(form, (counts.get(form) ?? 0) + 1)
  }
}

/** One Parquet file's text column, a row group at a time, so a 2 GB shard never sits in memory whole. */
export async function* parquetTexts(file: string, column = 'text'): AsyncGenerator<string> {
  const buffer = await asyncBufferFromFile(file)
  const metadata = await parquetMetadataAsync(buffer)
  let rowStart = 0
  for (const group of metadata.row_groups) {
    const rowEnd = rowStart + Number(group.num_rows)
    const rows = (await parquetReadObjects({ file: buffer, metadata, columns: [column], rowStart, rowEnd })) as Record<string, unknown>[]
    for (const row of rows) {
      const text = row[column]
      if (typeof text === 'string') yield text
    }
    rowStart = rowEnd
  }
}

export async function countParquet(files: readonly string[], progress?: (file: string, texts: number) => void): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const file of files) {
    let texts = 0
    for await (const text of parquetTexts(file)) {
      countInto(counts, text)
      texts += 1
      if (progress && texts % 100_000 === 0) progress(file, texts)
    }
    progress?.(file, texts)
  }
  return counts
}

/**
 * Google Books Ngram v3 1-grams: `ngram TAB year,match_count,volume_count TAB …`.
 * Adds up `match_count` for years `from`–`to` (the pilot used 2000–2019, so the
 * counts reflect current usage), folds case, and skips part-of-speech tagged
 * forms (`water_NOUN`), which would count a word twice.
 */
export async function sumGoogleBooks(files: readonly string[], from: number, to: number): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })
    for await (const line of lines) {
      const [ngram, ...cells] = line.split('\t')
      if (!ngram || ngram.includes('_')) continue
      let n = 0
      for (const cell of cells) {
        const [year, match] = cell.split(',')
        const y = Number(year)
        if (y >= from && y <= to) n += Number(match)
      }
      if (n === 0) continue
      const form = norm(ngram)
      counts.set(form, (counts.get(form) ?? 0) + n)
    }
  }
  return counts
}

/** The pipeline's input format (`form<TAB>count`, a comment, a header), most frequent first. Returns the rows written. */
export function writeCounts(file: string, counts: ReadonlyMap<string, number>, opts: { top?: number; comment: string }): number {
  const rows = [...counts]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, opts.top ?? 200_000)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `# ${opts.comment}\nform\tcount\n${rows.map(([form, n]) => `${form}\t${n}`).join('\n')}\n`)
  return rows.length
}
```

200,000 forms is far more than ranking to C1 needs (`max_forms` is 12,000), and keeps the file a few megabytes. `parseFrequencyList` drops what is not a word (digits, stray symbols) when the pipeline reads the file.

In `pipeline/src/cli.ts`:

1. Add `import { countParquet, sumGoogleBooks, writeCounts } from './prepare'`.
2. Change `const VALUED = new Set(['--by', '--batch'])` to `const VALUED = new Set(['--by', '--batch', '--from', '--to'])`.
3. In `USAGE`, after the `live` line, add:

```
  frequency lists (run on a workstation; the output goes into the content repository's sources/):
    count-text <out.tsv> <parquet...>                  word forms in Parquet text shards (FineWeb)
    sum-gbooks <out.tsv> <gz...> [--from Y] [--to Y]   Google Books 1-grams, years 2000-2019 by default
```

4. Add these cases to `main`'s `switch`, before `build`:

```ts
    case 'count-text': {
      const [out, ...files] = positional.slice(1)
      if (!out || files.length === 0) usage()
      const counts = await countParquet(files, (file, texts) => console.error(`  ${file}: ${texts.toLocaleString('en')} texts`))
      const tokens = [...counts.values()].reduce((a, b) => a + b, 0)
      const written = writeCounts(out, counts, { comment: `corpus count-text over ${files.length} Parquet files, ${tokens} tokens, ${now()}` })
      console.log(`wrote ${out}: ${written} forms, ${tokens.toLocaleString('en')} tokens`)
      break
    }
    case 'sum-gbooks': {
      const [out, ...files] = positional.slice(1)
      if (!out || files.length === 0) usage()
      const from = Number(option('--from') ?? 2000)
      const to = Number(option('--to') ?? 2019)
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) usage()
      const counts = await sumGoogleBooks(files, from, to)
      const written = writeCounts(out, counts, { comment: `corpus sum-gbooks, Google Books Ngram v3 1-grams, ${from}-${to}, ${now()}` })
      console.log(`wrote ${out}: ${written} forms`)
      break
    }
```

- [ ] **Step 5: Run it to see it pass**

Run: `pnpm --filter @wordado/pipeline test && pnpm --filter @wordado/pipeline typecheck && pnpm lint`
Expected: PASS, 5 new tests, and every earlier suite still green.

- [ ] **Step 6: Commit**

```bash
git add pipeline/package.json pnpm-lock.yaml pipeline/src/prepare.ts pipeline/src/prepare.test.ts pipeline/src/cli.ts
git commit -m "feat(pipeline): frequency lists from FineWeb shards and Google Books 1-grams"
```

---

### Task 18: The content repository's workflow, CI, and the runbook

**Files:**
- Create: `pipeline/template/.github/workflows/corpus.yml`, `pipeline/README.md`
- Modify: `.github/workflows/ci.yml`, `.gitignore`, `docs/deploy.md`, `docs/development.md`, `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, `README.md`
- Delete: `.github/workflows/publish-content.yml`

- [ ] **Step 1: The content repository's workflow**

`pipeline/template/.github/workflows/corpus.yml`:

```yaml
name: Corpus

# The corpus pipeline (spec §4.4, §5.4), started by hand. The pipeline's code is the public
# wordado/wordado at vars.PIPELINE_REF; this repository holds the content it reads and writes.
# draft, audio and triage open a pull request with what they changed; release publishes to R2,
# manifest last, and commits the new last-published/ to main.
on:
  workflow_dispatch:
    inputs:
      action:
        description: What to run
        type: choice
        required: true
        options: [draft, audio, triage, release]

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: corpus
  cancel-in-progress: false

env:
  ACTION: ${{ inputs.action }}
  # Absolute, so it works from any step's working directory.
  CORPUS: pnpm --dir ${{ github.workspace }}/wordado --filter @wordado/pipeline corpus

jobs:
  work:
    name: ${{ inputs.action }}
    if: inputs.action != 'release'
    runs-on: ubuntu-24.04
    timeout-minutes: 240
    environment: corpus
    steps:
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
      - name: ffmpeg, for the clips
        if: inputs.action == 'audio'
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg
      - name: Run ${{ inputs.action }}
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
          REPORTS_DATABASE_URL: ${{ secrets.REPORTS_DATABASE_URL }}
        run: |
          content="$GITHUB_WORKSPACE/content"
          case "$ACTION" in
            draft) $CORPUS draft "$content" ;;
            audio) $CORPUS draft "$content" --offline && $CORPUS audio "$content" --batch "$(date -u +%Y%m%dT%H%M)" ;;
            triage) $CORPUS draft "$content" --offline && $CORPUS triage "$content" ;;
          esac
          $CORPUS queues "$content"
          $CORPUS status "$content"
      - name: Open a pull request with the results
        working-directory: content
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          git add -A
          if git diff --cached --quiet; then echo "Nothing changed."; exit 0; fi
          branch="corpus/$ACTION-$GITHUB_RUN_ID"
          git switch -c "$branch"
          git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
            commit -m "corpus: $ACTION (run $GITHUB_RUN_ID)"
          git push origin "$branch"
          gh pr create --base main --head "$branch" --title "corpus: $ACTION ($GITHUB_RUN_ID)" \
            --body "Results of the Corpus workflow's $ACTION run $GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID. New review files are under review/."

  release:
    name: release
    if: inputs.action == 'release'
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    environment: production
    env:
      OUT: ${{ github.workspace }}/out
      BUCKET: s3://${{ vars.CONTENT_BUCKET }}
      R2: https://${{ vars.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
      MANIFEST_URL: ${{ vars.CONTENT_MANIFEST_URL }}
      AWS_ACCESS_KEY_ID: ${{ secrets.R2_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_SECRET_ACCESS_KEY }}
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
      - name: The CDN serves last-published/, the version this release follows
        run: $CORPUS live "$GITHUB_WORKSPACE/content" "$MANIFEST_URL"
      - name: Build the release (every gate)
        run: |
          $CORPUS draft "$GITHUB_WORKSPACE/content" --offline
          $CORPUS release "$GITHUB_WORKSPACE/content" "$OUT"
      - name: Every file the manifest reaches is present, with its checksum
        run: $CORPUS publishable "$OUT"
      - name: Upload the packs and the audio (not the manifest)
        run: |
          aws s3 sync "$OUT" "$BUCKET" --endpoint-url "$R2" --exclude '*' --include '*.pack' \
            --content-type application/json --cache-control 'public, max-age=31536000, immutable'
          aws s3 sync "$OUT/audio" "$BUCKET/audio" --endpoint-url "$R2" \
            --content-type audio/mp4 --cache-control 'public, max-age=86400'
          aws s3 cp "$OUT/fixes.json" "$BUCKET/fixes.json" --endpoint-url "$R2" \
            --content-type application/json --cache-control no-cache
      - name: Publish the manifest, last
        run: |
          aws s3 cp "$OUT/manifest.json" "$BUCKET/manifest.json" --endpoint-url "$R2" \
            --content-type application/json --cache-control no-cache
      - name: The CDN serves the new manifest
        run: |
          expected=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).corpus_version)" "$OUT/manifest.json")
          served=$(curl --fail --silent --show-error -H 'cache-control: no-cache' "$MANIFEST_URL" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).corpus_version))")
          echo "corpus version: published $expected, served $served"
          test "$expected" = "$served"
      - name: Record the release as last-published/
        working-directory: content
        run: |
          $CORPUS published "$GITHUB_WORKSPACE/content" "$OUT"
          version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('last-published/manifest.json','utf8')).corpus_version)")
          git add last-published registry.json
          git -c user.name='github-actions[bot]' -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
            commit -m "corpus: published version $version (run $GITHUB_RUN_ID)"
          git push origin HEAD:main
```

`draft --offline` in the release job rebuilds `work/draft.json` from the committed caches without calling out, so a release never spends money and never publishes a proposal nobody has seen. The release job commits only `last-published/` and `registry.json`, the files `published` and `draft` may change.

- [ ] **Step 2: CI**

In `.github/workflows/ci.yml`:

1. In the `static` job, after `Lint the workflows`, add:

```yaml
      - name: Lint the content repository's workflow
        run: docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color pipeline/template/.github/workflows/corpus.yml
```

2. In the `test` job, before the step that runs the suites, add:

```yaml
      - name: ffmpeg, for the pipeline's encoder tests
        run: sudo apt-get update && sudo apt-get install -y --no-install-recommends ffmpeg
```

Delete `.github/workflows/publish-content.yml` (Decision 15).

Add to `.gitignore`, after the `docs/research/` block:

```
# The corpus lives in the private repo wordado/wordado-content, cloned here (pipeline/README.md).
content/
```

- [ ] **Step 3: The runbook**

`pipeline/README.md`:

````markdown
# The corpus pipeline

Turns open frequency data into Wordado's corpus: lemmas, English senses banded to CEFR levels, L1 translations,
units, native-speaker review, TTS audio and learners' error reports, up to a published corpus version (spec §5,
§8.10). The code is here, under the MIT licence. The content lives in the private repository
`wordado/wordado-content`, cloned into `content/` beside this repository's packages and ignored by it.

```
frequency lists ─► lemmas ─► senses + banding ─► translations ─► IDs, selection, units, titles   (corpus draft)
                                                                     │
                     review/*.csv ◄──────── corpus queues ◄─────────┤
                          │                                          │
                     corpus import ─► decisions/*.jsonl              ├─► corpus audio ─► audio/, audio.jsonl
                                                                     │
content_report ─► corpus triage ─► reopen / redo ───────────────────┘
                                                                     ▼
                                    corpus release ─► out/ ─► R2 (manifest last) ─► last-published/
```

## Commands

`pnpm --filter @wordado/pipeline corpus <command>`. Paths are relative to `pipeline/`, so pass the content directory
absolutely: `"$PWD/content"` from the repository root.

| Command | What it does |
|---|---|
| `init <dir>` | A new content directory: the template, the sample's IDs pinned in `registry.json`, the curated themes, and the sample as `last-published/` (v0). |
| `draft <dir> [--offline]` | Every LLM stage, then IDs, selection, units and titles. Needs `OPENROUTER_API_KEY`, except `--offline`, which uses the caches only. |
| `audio <dir> [--batch <id>]` | Clips for live entries that have none, whose voice settings changed, or that were marked `redo`. Needs ffmpeg and `OPENROUTER_API_KEY`. |
| `queues <dir>` | Writes pending review items to `review/<queue>/`. |
| `import <dir> --by <name>` | Applies every reviewed row as a decision. |
| `triage <dir>` | Reads `content_report` (`REPORTS_DATABASE_URL`); reopens fields at the threshold, remakes reported clips. |
| `status <dir>` | What stands between the content and a release. |
| `release <dir> <out> [--draft]` | The next corpus version, if every gate passes; `--draft` skips only the review gates and cannot be published. |
| `published <dir> <out>` | After a publish: `<out>` becomes `last-published/`. |
| `live <dir> <manifest-url>` | Whether the CDN serves `last-published/`. |

## Setting up (once)

1. **The content repository.** `gh repo create wordado/wordado-content --private`, then from this repository's root:
   `pnpm --filter @wordado/pipeline corpus init "$PWD/content"`, and in `content/`: `git init -b main`, commit, and
   `git remote add origin https://github.com/wordado/wordado-content.git && git push -u origin main`.
2. **Its Actions.** Settings › Actions › General › *Allow GitHub Actions to create and approve pull requests*.
   Variables: `PIPELINE_REF` (a commit of wordado/wordado; move it forward on purpose), `CLOUDFLARE_ACCOUNT_ID`,
   `CONTENT_BUCKET` (`wordado-content`), `CONTENT_MANIFEST_URL` (`https://content.wordado.com/manifest.json`).
   Environment `corpus`: secrets `OPENROUTER_API_KEY` and `REPORTS_DATABASE_URL`. Environment `production`, with
   the product owner as required reviewer: secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` (the R2 token of
   `docs/deploy.md` step 5).
3. **OpenRouter.** Create a key with a monthly credit limit. In Settings › Privacy, turn off providers that may
   train on inputs (the chat requests also send `data_collection: "deny"`; the speech endpoint does not document
   that field). Check `llm.model` and `tts.model` in `pipeline.json` against openrouter.ai/models.
4. **The report reader.** In Neon (production branch, SQL editor):
   `create role corpus_reports login password '<generated>'; grant select on content_report to corpus_reports;`
   `REPORTS_DATABASE_URL` is its direct connection string, with `sslmode=require`. It can read reports and nothing else.
5. **Voices.** Try the UK voice on a dozen words before the first `audio` run, and change `tts.accents.uk` until a
   native listener is happy. Every later change remakes every clip.

## The legal gate (spec §5.4, §15)

`sources.json` lists every frequency list: its licence, whether it allows commercial use, whether it is
share-alike, any attribution it requires, and who cleared it and when. **The pipeline reads nothing until every
listed source is cleared, commercial and not share-alike.** Put the list itself in `sources/` as
`form<TAB>count` lines. The legal review also covers the terms of OpenRouter, of the LLM and TTS providers behind
it, and of the chosen voice, for commercial use of their output. Record that outcome in `sources.json`'s `notes`
field for the first source, or in the content repository's README. A source that needs attribution appears in
each release's `release.json`, and the app must show it (a follow-up).

## Preparing the frequency lists

The pilot (`docs/research/2026-09-27-frequency-pilot/` in the research repository) chose two sources: our own count of
FineWeb, and Google Books GB for 2000–2019 (Decision 19). Both need the legal review's clearance and an attribution.
On a workstation, not in Actions:

1. **FineWeb.** Download 10 of the shards of `HuggingFaceFW/fineweb` `sample/10BT`, about 5 billion tokens
   (`https://huggingface.co/datasets/HuggingFaceFW/fineweb/resolve/main/sample/10BT/000_00000.parquet`, and so on).
   Then run `pnpm --filter @wordado/pipeline corpus count-text "$PWD/content/sources/fineweb.tsv" <shards...>`.
   Time one shard first: the rest take as long each.
2. **Google Books GB.** Download the four files listed at
   `https://storage.googleapis.com/books/ngrams/books/20200217/eng-gb/eng-gb-1-ngrams_exports.html`, about 3.6 GB.
   Then run `pnpm --filter @wordado/pipeline corpus sum-gbooks "$PWD/content/sources/google-books-gb.tsv" <files...>`.
3. **The licence register.** Record both in `sources.json` with the legal review's clearance:

   ```json
   [
     {
       "id": "fineweb", "file": "fineweb.tsv", "title": "FineWeb (sample-10BT, 10 shards), counted by corpus count-text",
       "url": "https://huggingface.co/datasets/HuggingFaceFW/fineweb", "licence": "ODC-By 1.0; Common Crawl terms of use",
       "commercial_use": true, "share_alike": false,
       "attribution": "Word frequencies counted from FineWeb by Hugging Face (ODC-By 1.0).",
       "cleared_by": "", "cleared_on": "", "notes": ""
     },
     {
       "id": "google-books-gb", "file": "google-books-gb.tsv", "title": "Google Books Ngram, British English 1-grams (20200217), 2000-2019",
       "url": "https://storage.googleapis.com/books/ngrams/books/datasetsv3.html", "licence": "CC BY 3.0 Unported",
       "commercial_use": true, "share_alike": false,
       "attribution": "Word frequencies from the Google Books Ngram Viewer (https://books.google.com/ngrams), CC BY 3.0.",
       "cleared_by": "", "cleared_on": "", "notes": ""
     }
   ]
   ```
4. **Essential words.** `essentials.txt` starts with about 230 everyday spoken words that frequency lists rank
   too low (greetings, family, feelings, food, the home, the days of the week). Reviewers add to it; anything on
   it is described whatever its frequency, and every sense of it goes to banding review.

## Running a version

1. **Draft** (Actions › Corpus › `draft`). It opens a pull request with the caches, the registry and new review
   files. Merge it.
2. **Review.** Reviewers edit `review/**/*.csv` (the content README says how) and open pull requests. Then run
   `corpus import "$PWD/content" --by <name>` locally, commit and push. Import rejects a row it cannot apply, names
   it, and leaves it in the file.
3. **Audio** (`audio`), then listen: its review files are under `review/audio/`. Merge. Repeat for clips marked `redo`.
4. **Triage** (`triage`) whenever reports have come in, before a release. It reopens items and marks clips
   `redo`: run `audio` and review again.
5. **Status**, locally, until it says `0 problems, 0 items awaiting review`.
6. **Release** (`release`), approved by the `production` environment's reviewer. It checks that the CDN serves
   `last-published/`, builds with every gate, uploads packs, audio and `fixes.json`, then the manifest, checks
   that the CDN serves it, and commits the new `last-published/` to main.

## When something is wrong

- **"pinned entry … is not live: the senses stage no longer proposes it".** A sample word's senses changed. Find
  the lemma's line in `cache/senses.jsonl` and restore a sense with the sample's part of speech. That file is
  plain JSON, one item per line. Then run `draft` again.
- **A stale decision.** A prompt version was bumped, so proposals changed, and their earlier verdicts no longer
  apply (Decision 5). `queues` offers them again.
- **The budget stopped a draft.** Run `draft` again: everything already paid for is in `cache/`.
- **`live` fails before a release.** `last-published/` is behind the CDN, or ahead of it: pull `main` of the
  content repository. If a publish failed after uploading the manifest, restore `last-published/` from the CDN's
  `manifest.json`, the packs it lists, and `fixes.json`.
- **A bad clip in production.** Mark it `redo` in an audio review file (or let reports do it), then run `audio` and
  `release`. The new take has a new clip ID.

## Privacy

`triage` reads report notes, which learners write, and puts up to 280 characters of them in the review files of
the private content repository. Reporter IDs are hashed as they are read and never written. Deleting an account
removes the reporter from `content_report` (spec §11). Notes already in the content repository's history stay
there. Say so in the privacy policy's section on reports.
````

- [ ] **Step 4: The docs and the roadmap**

`docs/deploy.md`:
- In the opening paragraph, replace "published by the manual **Publish content** workflow." with "published by the **Corpus** workflow of the private `wordado/wordado-content` repository (`pipeline/README.md`)."
- Replace step 9 ("**Content first.** …") with: "**Content first.** *Done 2026-09-27*, with the sample (v0), by the Publish content workflow that plan 8 replaced. The first corpus version is published by the content repository's **Corpus** workflow (`pipeline/README.md`)."
- In *Everyday*, change the reviewer paragraph's last sentence to: "The content repository's `production` environment has the same reviewer, for its **Corpus** release." Replace the **Content** bullet with: "**Content:** see `pipeline/README.md`. Its release job uploads packs, audio and `fixes.json`, and the manifest last."
- Step 6's production-only R2 secrets stay: the Worker does not use them, but they are removed only after the first corpus release proves the content repository's copies work. Add that sentence to step 6.

`docs/development.md`: after the "Sample content" bullet, add:

```markdown
- **The corpus pipeline** (`pipeline/README.md`) is tested on fixtures: `pnpm --filter @wordado/pipeline test`.
  Its encoder tests need ffmpeg (`brew install ffmpeg`) and are skipped without it; CI installs it. Real runs need the
  private content repository, cloned into `content/`.
```

`README.md`: in the package table, change the `pipeline` row to "Builds the corpus: frequency data to reviewed, published packs (`pipeline/README.md`)." In the licence section, after the sentence about corpus packs and audio, add: "The corpus's sources and review history live in a private repository."

`docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`:
- Row 8 becomes: `| 8 | **Corpus pipeline** — \`2026-09-27-corpus-pipeline.md\` | \`pipeline\` | Licence register and gate; frequency lists → lemmas → senses with CEFR banding → translations → IDs, selection, units, titles; review queues as spreadsheets; OpenRouter TTS with spot-listen batches; report triage; release with review, audio and succession gates; \`fixes.json\`; the private content repository and its Corpus workflow | 3, 7; real runs: **legal review** |`
- Add a row after it: `| 8b | Report fixed notices | \`web\` | Tell a reporter their report was fixed (spec §8.10), from the CDN's \`fixes.json\`; show the sources' attributions from \`release.json\` | 8 |`
- In *Blockers outside the code*, rewrite the **Legal review** bullet's first line as: "**Legal review** (spec §15) gates plan 8's real runs (the code is built and tested on fixtures): licences of candidate frequency lists and of the LLM and TTS output, and the per-country age-of-consent table the age gate in plan 6 needs." Keep the rest of that bullet.
- In the paragraph under the table, replace "Plan 8 can start as soon as its legal review clears and does not block 4–7, which run against the sample pack." with "Plan 8 was built before its legal review cleared; its first real run waits for it."

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all green. Then lint the template workflow the way CI will:
`docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color pipeline/template/.github/workflows/corpus.yml`
Expected: no output. Also `docker run --rm -v "$PWD:/repo" --workdir /repo rhysd/actionlint:1.7.7 -color`, with no output: `publish-content.yml` is gone and nothing refers to it.
`grep -rn "publish-content\|Publish content" --include=*.md --include=*.yml . | grep -v node_modules | grep -v docs/superpowers/plans/2026-09-25`: only historical mentions remain (deploy.md's step 9).

- [ ] **Step 6: Commit and open the pull request**

```bash
git rm .github/workflows/publish-content.yml
git add pipeline/template/.github/workflows/corpus.yml pipeline/README.md .github/workflows/ci.yml .gitignore docs/deploy.md docs/development.md docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md README.md
git commit -m "ci(pipeline): the content repository's Corpus workflow replaces Publish content; runbook"
git push -u origin plan-8-corpus-pipeline
gh pr create --title "Plan 8: the corpus pipeline" --body-file - <<'EOF'
The corpus pipeline (plan 8, `docs/superpowers/plans/2026-09-27-corpus-pipeline.md`): cleared frequency lists → lemmas → senses with CEFR banding → translations → units → spreadsheet review → OpenRouter TTS with spot-listens → report triage → a release gated on review, audio and succession, published by the private content repository's Corpus workflow.

Built and tested on fixtures; real runs wait for the legal review of the frequency lists.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
```

CI must be green before merge: the new ffmpeg step and the template's actionlint run in the `static` and `test` jobs.

---

### Task 19 (operator): The content repository, and the first real run

Outward-facing. The executing agent asks the product owner before each of these steps and does not run them unasked.

1. Merge the plan 8 pull request once CI is green.
2. Follow `pipeline/README.md` › *Setting up*: create `wordado/wordado-content` (private), `corpus init`, its Actions settings, variables and environments, the OpenRouter key and privacy setting, and the `corpus_reports` role.
3. **Stop here until the legal review clears FineWeb and Google Books GB** (Decisions 1 and 19). Then follow `pipeline/README.md` › *Preparing the frequency lists*: `count-text`, `sum-gbooks`, and their `sources.json` records with the clearance. Commit, then run **Corpus › draft**. Before the full run, a trial with `max_lemmas: 200` and `max_usd_per_run: 2` shows the proposals and the cost per item. Delete that trial's cache lines with its `pipeline.json` change if the prompts change afterwards.
4. The first review round, audio and release follow *Running a version*. The first release is version 1, checked against the sample (v0), which is what learners have today.

---

## Contracts this plan hands to the later plans

- **Plan 8b (web):** `fixes.json` at the CDN root beside `manifest.json` (`no-cache`): `{ schema_version: 1, corpus_version, fixes: [{ word_id, field, fixed_in }] }`, cumulative. A learner's report on `word_id` and `field`, made on `pack_version` p, is fixed once a fix with `fixed_in > p` exists and the learner's installed corpus version is at least `fixed_in`. `release.json` (not uploaded yet; 8b adds it to the release job if it wants it) carries `attributions`, which the app must show when non-empty.
- **Reports should carry the learner's L1** (server and web, with the next protocol change). Triage reopens every L1's translation set today. That is exact for Bulgarian alone, and too broad once Phase 1b adds L1s.
- **Phase 1b (new L1s):** add the L1's guide to `L1_GUIDES` (`pipeline/src/stages/translate.ts`), its code to `pipeline.json`'s `l1s`, and its names to every theme in `themes.json`. Then run `draft`, and have native speakers review `translation-<l1>` and `title-<l1>`. No code outside the guide changes. An L1 once published must stay in `l1s`.
- **Phase 2 cloze** needs three to five examples per entry (§5.2). The senses stage asks for three. Raising it is a prompt version bump (`SENSES_VERSION`), which re-asks every headword and sends every `english` item back to review.
- **Multi-word headwords** reach the corpus only as pinned sample entries today: frequency lists count single tokens. Phrasal verbs and fixed phrases need a source of their own (a later plan, with its own licence review).

## Run it

```bash
pnpm install
pnpm --filter @wordado/pipeline test        # the pipeline on fixtures, end to end
pnpm typecheck && pnpm lint && pnpm test    # everything
```
