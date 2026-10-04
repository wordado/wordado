# AI review and the review app — design

**Date:** 2026-10-04 · **Status:** draft for the product owner's review
**Parent spec:** `2026-09-20-vocabulary-learning-app-design.md`, §5.4 *Review tiers* and §8.10 (as amended
2026-10-04: the beta opens on AI-reviewed content).

## 1. Purpose

The corpus was written by one LLM (Claude Sonnet 5). The parent spec now says a release is gated by **AI
review**: reviewer models from other families check every row, and a native speaker decides every row the review
flags. This design delivers that:

1. **`corpus ai-review`**, a pipeline command that reviews the open rows of the review queues with a configurable
   reviewer and stores its verdicts in the content repository.
2. **A release gate** in `corpus status` and `corpus release`: no release while rows are unreviewed or flagged rows
   are undecided.
3. **`review-app/`**, a local web app in which a native speaker sees each flagged row beside the reviewer's
   objections, and any learner reports, and decides it in one keystroke.

**First user:** the product owner, reviewing Bulgarian on their own machine. **Designed to grow into** remote
native reviewers (German, Spanish) on a hosted version later, without redesign (§8).

**Success:** the flagged Bulgarian rows (about a quarter of ~7,100) are cleared much faster than in a spreadsheet;
every decision lands in the content repository through the existing `corpus import`; nothing private leaves the
machine except the reviewer's API calls; and `release` enforces the parent spec's rule.

## 2. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Where the code lives | The main repository: a new package `review-app/`, and the command in `pipeline/`. Private data stays in the content repository and on the reviewer's machine. |
| Where the AI review runs | A pipeline command; verdicts stored in the content repository, shared and versioned. Not from inside the app. |
| The app's form | A local web app: a small Node server on the content checkout, a browser UI. Same stack as `web/` (React, Vite). |
| The release gate | Included. It applies to every AI-reviewed queue, **including queues in `accept_unreviewed`** (that list means "ships without native review"). |
| Default reviewer | Gemini 3.8 Flash (`google/gemini-3.8-flash`). Others are configurable: further OpenRouter models, or a local OpenAI-compatible server such as BgGPT under llama.cpp. |
| Learner reports | Reopened rows (`corpus triage`) appear first in the app, with the learners' notes beside the AI's objections. The reviewer is shown the notes. Reports do not block a release by themselves. |
| Queues in scope | `translation-*`, `title-*` and `level` (the level queue only, not all levels). `english` and `audio` later. |
| Layout | A list of rows on the left, the selected row on the right (mockup B). |

Pilot evidence behind the default (Bulgarian, 200 rows, 40 per level): Gemini 3.8 Flash cost $0.25 for 200 rows
and raised specific, mostly alternate-level objections; BgGPT 3.0 27B (local) raised objections that agreed with the
other reviewers at about chance (κ ≈ 0.07), with many false or empty "fixes". Flash's miss rate is still to be
measured on native-labelled rows; the voting rule (§3.3) is configurable for that reason.

## 3. `corpus ai-review`

### 3.1 Command

```
corpus ai-review <dir> [--queue <queue>] [--reviewer <name>]
```

- Reviews every **open** row (no verdict yet, or reopened) in the review files of the configured queues, or of
  `--queue` alone, with the configured default reviewer or `--reviewer`. Rows a human has already decided are
  skipped.
- Batches of 10 rows, with the pipeline's retries and the split-on-unfit behaviour of `cachedBatch` (#60). Spend is
  printed and capped by `llm.max_usd_per_run`. `CORPUS_LLM=claude-code` does not apply: a Claude reviewer would
  review Claude's own work.
- A new Corpus action in the content repository's workflow, `ai-review`, runs it in Actions and opens a pull
  request with the results, like `draft` and `audio`.

### 3.2 Configuration (`pipeline.json`)

```json
"ai_review": {
  "queues": ["translation-bg", "title-bg", "translation-de", "title-de", "translation-es", "title-es", "level"],
  "reviewers": {
    "flash": { "provider": "openrouter", "model": "google/gemini-3.8-flash" },
    "bggpt": { "provider": "local", "url": "http://127.0.0.1:8091", "model": "bggpt-gemma-3-27b" }
  },
  "default": "flash",
  "required": ["flash"],
  "flag_when": 1
}
```

- `provider: "openrouter"` uses the existing OpenRouter client (`OPENROUTER_API_KEY`).
- `provider: "local"` calls an OpenAI-compatible `/v1/chat/completions` (llama.cpp, Ollama, vLLM), with the answer
  held to the JSON schema by `response_format`. No key, no spend.
- `required` lists the reviewers whose verdict every row needs; it defaults to `[default]`. Other configured
  reviewers can be run for comparison without gating anything.
- `configProblems` validates the block: known queues, a default and `required` that name configured reviewers,
  and 1 ≤ `flag_when` ≤ the number of required reviewers.

### 3.3 What a row is flagged by

A reviewer's verdict on a row is `ok`, `minor` or `major`, with a list of objections. A row is **AI-reviewed**
when every `required` reviewer has a verdict on its **current content**, and then **flagged** when at least
`flag_when` of those verdicts are `minor` or `major`. With Flash alone, `flag_when: 1` means "flagged if Flash
objects". With three required reviewers, `2` is a majority. The app shows the objections of every configured
reviewer that has a current verdict, required or not.

### 3.4 Reviewer instructions, per queue

Each queue kind has its own system prompt and JSON schema, versioned like the stage prompts (bump the version and
every row is asked again). They state the same rules as the human reviewer guides:

| Queue kind | Judged | Objection categories |
|---|---|---|
| `translation-<l1>` | translation, alternates, sense, against the English sense, its example, and the word's other live senses (from the draft) | wrong-sense, form, aspect, register, alternate-wrong, alternate-missing, sense, unnatural, spelling, other |
| `title-<l1>` | title_en, title_l1, against the unit's words | inaccurate, unnatural, mismatch (the two titles say different things), style, other |
| `level` | level, against the sense, its example, the frequency band and the CEFR descriptors | too-low, too-high, other |

Every objection carries: field, category, severity, a short reason in English, and the corrected value (which must
differ from the current one; an objection whose fix equals the current value is dropped as invalid). The prompt
asks for the errors before the verdict, says that "no errors" is normal, and that near-synonyms correct in this
sense are fine. For a reopened row, the learners' notes from the `reopened` column are part of the input ("learners
reported: …"). The translation prompt includes the L1 guide the translate stage uses (`L1_GUIDES`). The level
prompt judges from the CEFR descriptors only; it must not copy licensed lists (parent spec §5.4).

### 3.5 Storage

`ai-review/<queue>.jsonl` in the content repository, appended, one line per verdict:

```json
{"key":"<row key>","reviewer":"flash","model":"google/gemini-3.8-flash","prompt_version":1,
 "content":"<sha256 of the row's reviewed cells and its reopened note>","verdict":"major",
 "objections":[{"field":"translation","category":"wrong-sense","severity":"major","reason":"…","fix":"…"}],
 "at":"2026-10-05T08:00:00Z"}
```

- A row is reviewed again only when its content hash, the reviewer or the prompt version changes. A draft that
  changes a row (or a new learner report) therefore makes its verdict stale, and the next run asks again.
- The newest verdict per (key, reviewer) whose content hash matches the row's current content is the one that
  counts. Verdicts for rows that no longer exist are ignored.

## 4. The release gate

`corpus status` gains, per AI-reviewed queue:

- `N × not yet AI-reviewed` — open rows that are not AI-reviewed (§3.3): some required reviewer has no verdict on
  their current content.
- `N × flagged by AI review, awaiting a decision` — open rows flagged under §3.3.

`corpus release` refuses while either is above zero, for every queue in `ai_review.queues`, whether or not it is in
`accept_unreviewed`. A row decided by a human (any imported verdict) needs no AI review. A reopened row needs a
current AI verdict like any open row; being reported does not block by itself (the parent spec's §8.10: a single
report must not hold up a release).

## 5. The review app (`review-app/`)

### 5.1 Running it

```
pnpm --filter @wordado/review-app review "$PWD/content"
```

starts a local server on `127.0.0.1` (a free port), opens the browser, and serves the UI. It reads the content
checkout's review files, `ai-review/*.jsonl`, the draft (`work/draft.json`, for other live senses) and
`pipeline.json`. The reviewer's name is asked once and stored in a local settings file outside the repository.

### 5.2 Layout (mockup B)

- **Header:** language and queue picker (translations, titles, levels), progress ("37 of 1,812 decided").
- **Left: the list** of rows to decide, filterable by level, severity (major, minor) and source (learner report, AI),
  and a toggle for unflagged rows. Learner-reported rows first, then majors, then minors.
- **Right: the selected row.**
  - The English side: headword, part of speech, sense, example, level, and the word's other live senses with their
    translations (for translations); the unit's words (for titles); the frequency band (for levels).
  - The current row (Claude's): its editable cells, the field each objection targets highlighted.
  - Objections: each reviewer's objections (severity, category, reason, proposed fix, an accept tick), and the
    learners' notes from reports.
  - Actions: **Accept fix** (ticked objections, or all), **Keep**, **Edit** (inline), **Drop** (translations only),
    **Skip**, a note field. Keys 1–4 and S; arrows move through the list.

### 5.3 Writing decisions back

Each action writes what a human reviewer would type into the review CSV, immediately:

| Action | Written to the row | `corpus import` then records |
|---|---|---|
| Accept fix | the fixed values in their cells, verdict `ok` | a `fix` with the new value |
| Keep | verdict `ok`, cells unchanged | `ok` |
| Edit | the reviewer's values, verdict `ok` | a `fix` |
| Drop | verdict `drop` | `drop` |
| Skip | nothing | (still open) |

- Files are written through the pipeline's CSV module, keeping the byte-order mark, line endings and column order.
  If a file changed on disk since it was loaded (a new draft), the app reloads it rather than overwrite it.
- **Import decisions** runs `corpus import` in-process under the stored reviewer name and shows its summary,
  including rows it could not apply (they stay in the file). Committing and pushing the content repository stays a
  manual step.

### 5.4 Package shape

- `review-app/server/` — a small HTTP API over the checkout: list queues and rows (with objections, reports and
  context), save a decision, run import. It imports the pipeline's modules (review files, CSV, decisions, config,
  AI-review store) rather than reimplementing them.
- `review-app/src/` — the React UI, talking only to that API.

The API boundary is what makes the hosted version (§8) a server swap, not a rewrite.

## 6. Errors

- A reviewer that fails or runs out of budget leaves rows unreviewed; `status` shows them, and a rerun continues.
- A `local` reviewer whose server is not running fails the run at once with the URL it tried.
- An unknown queue, reviewer or a malformed `ai_review` block is a configuration problem, reported before any call.
- The app refuses to start outside a content checkout (no `pipeline.json`), and shows import's rejected rows
  instead of hiding them.

## 7. Testing

- **Pipeline:** unit tests with fake LLMs for the command (batching, per-queue prompts and schemas, invalid-fix
  filtering, learner notes in the input, caching by content hash, staleness after a change), for the store, the
  voting rule, the local provider (against a fake OpenAI-compatible server), and the gate in `status` and `release`
  (including queues in `accept_unreviewed`).
- **Review app:** server tests on fixture review files (listing, ordering, each action's CSV output, reload on
  change, import); component tests for the list, the row view and the keyboard actions; one end-to-end run in
  Chromium: open a fixture checkout, accept a fix, keep a row, import, and see the decisions recorded.
- CI runs both with the existing suites.

## 8. Remote reviewers later (designed for, not built)

- The UI talks only to the §5.4 API; a hosted server implements the same API.
- Reviewer identity is already explicit (the stored name becomes the signed-in GitHub user).
- Instead of writing the checkout, the hosted server would commit a reviewer's decisions to a branch and open a
  pull request, the same files `corpus import` reads today.
- Out of scope now: hosting, sign-in, permissions per language, concurrent reviewers on one file.

## 9. Out of scope

- AI review of the `english` and `audio` queues, and of all levels (only the `level` queue).
- Changing the pipeline's review-file format or `corpus import`.
- Choosing the final voting rule: it is configuration, set from the pilot's native-labelled rows.
