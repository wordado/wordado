# The corpus pipeline

Turns open frequency data into Wordado's corpus: lemmas, English senses banded to CEFR levels, L1 translations,
units, native-speaker review, TTS audio and learners' error reports, up to a published corpus version (spec §5,
§8.10). The code is here, under the MIT licence. The content lives in the private repository
`wordado/wordado-content`, cloned into `content/` beside this repository's packages and ignored by it.

```
frequency lists ─► lemmas ─► senses + banding ─► translations ─► IDs, selection, themes, units, titles   (corpus draft)
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
| `draft <dir> [--offline] [--regroup]` | Every LLM stage, then IDs, selection, themes, units and titles. Needs `OPENROUTER_API_KEY`, except `--offline`, which uses the caches only. `--regroup` rebuilds every unit no published pack carries. |
| `audio <dir> [--batch <id>]` | Clips for live entries that have none, whose voice settings changed, or that were marked `redo`. Needs ffmpeg and `OPENROUTER_API_KEY`. |
| `queues <dir>` | Writes pending review items to `review/<queue>/`. |
| `import <dir> --by <name>` | Applies every reviewed row as a decision. |
| `compare <dir> [--sample <n>] [--stage <stage>]` | Asks the chosen LLM a sample of the draft's questions in a throwaway cache; writes `work/compare.md` beside the draft's answers. |
| `reopen <dir> <queue> --by <name> (--all \| --keys <file>) [--note <text>]` | Sends reviewed items of one queue back for a second review; `queues` then writes them out again. |
| `triage <dir>` | Reads `content_report` (`REPORTS_DATABASE_URL`); reopens fields at the threshold, remakes reported clips. |
| `status <dir>` | What stands between the content and a release. |
| `release <dir> <out> [--draft]` | The next corpus version, if every gate passes; `--draft` skips only the review gates and cannot be published. |
| `credits <dir> <out.json>` | The sources' attributions at the last published version (`credits.json`). |
| `published <dir> <out>` | After a publish: `<out>` becomes `last-published/`. |
| `live <dir> <manifest-url>` | Whether the CDN serves `last-published/`. |

## Setting up (once)

1. **The content repository.** `gh repo create wordado/wordado-content --private`, then from this repository's root:
   `pnpm --filter @wordado/pipeline corpus init "$PWD/content"`, and in `content/`: `git init -b main`, commit, and
   `git remote add origin https://github.com/wordado/wordado-content.git && git push -u origin main`.
2. **Its Actions.** The repository is private on GitHub Free, which offers neither environment secrets nor
   required reviewers in private repositories, so everything is repository-level and the workflow gates the release
   itself. Settings › Actions › General › *Allow GitHub Actions to create and approve pull requests*. Then, from
   inside `content/`:
   - Variables: `gh variable set PIPELINE_REF --body <commit of wordado/wordado>` (move it forward on purpose),
     `CLOUDFLARE_ACCOUNT_ID`, `CONTENT_BUCKET` (`wordado-content`), `CONTENT_MANIFEST_URL`
     (`https://content.wordado.com/manifest.json`), and `RELEASE_ACTORS`: the GitHub users allowed to publish,
     separated by spaces or commas (`danchom`).
   - Secrets: `gh secret set OPENROUTER_API_KEY`, `gh secret set REPORTS_DATABASE_URL`,
     `gh secret set R2_ACCESS_KEY_ID` and `gh secret set R2_SECRET_ACCESS_KEY` (the R2 token of `docs/deploy.md`
     step 5). Each step of the workflow receives only the secrets it uses.
   Give native-speaker reviewers write access to open pull requests: without being in `RELEASE_ACTORS`, they cannot
   publish. **Before adding anyone else to `RELEASE_ACTORS`**, either the legal review has cleared every source (no
   `cleared_by` starting with `Provisional:`, see *The legal gate*), or add a release check that refuses provisional
   sources first. Today only the product owner can publish, and knows which clearances are provisional.
3. **OpenRouter.** Create a key with a monthly credit limit. In Settings › Privacy, turn off providers that may
   train on inputs (the chat requests also send `data_collection: "deny"`; the speech endpoint does not document
   that field). Leave *zero data retention* off: Google's endpoint for Gemini TTS keeps data for a while, and ZDR
   filters it out ("ZDR violation (account settings)"); nothing about learners is ever sent. Check `llm.model` and
   `tts.model` in `pipeline.json` against openrouter.ai/models.
4. **The report reader.** In Neon (production branch, SQL editor):
   `create role corpus_reports login password '<generated>'; grant select on content_report to corpus_reports;`
   `REPORTS_DATABASE_URL` is its direct connection string, with `sslmode=require`. It can read reports and nothing else.
5. **Voices.** Try the UK voice on a dozen words before the first `audio` run, and change `tts.accents.uk` until a
   native listener is happy. Every later change remakes every clip. The 2026-09-28 trial chose Gemini 3.8 Flash TTS,
   voice Aoede, steered to a British accent through `provider_options` (the template's default). OpenAI's
   `gpt-4o-mini-tts` is not on OpenRouter, and MAI-Voice-2 has US voices only (a candidate for a later US accent).
   Gemini speaks raw PCM only, so its voice sets `"response_format": "pcm"`; the TTS client wraps the PCM as WAV at
   the rate the response names, and the encoder takes it from there.

## The legal gate (spec §5.4, §15)

`sources.json` lists every frequency list: its licence, whether it allows commercial use, whether it is
share-alike, any attribution it requires, and who cleared it and when. **The pipeline reads nothing until every
listed source is cleared, commercial and not share-alike.** Put the list itself in `sources/` as
`form<TAB>count` lines. The legal review also covers the terms of OpenRouter, of the LLM and TTS providers behind
it, and of the chosen voice, for commercial use of their output. Record that outcome in `sources.json`'s `notes`
field for the first source, or in the content repository's README. A source that needs attribution appears in
each release's `release.json`, and the app must show it (a follow-up).

**A provisional clearance.** The product owner may clear a source before the legal review answers, so that drafting,
audio and review can start. Write it so it can be found again: `cleared_by` starts with `Provisional:` and says the
legal review is pending, with the date in `cleared_on`. The pipeline treats it like any clearance, including at
release, so publishing waits on the release actors (setup step 2). When the review answers, replace both fields with
the reviewer's name and date. If it rejects a source, remove the source, draft again, and review the entries whose
selection or level changes.

**Attributions reach the app** as `credits.json` beside the manifest, from each cleared source's `attribution`.
Every release writes and uploads it. After changing an attribution without a release (or for a version published
before 8b), run Actions › Corpus › `credits`. Removing a source from `sources.json` must go with a release (draft
and release), not only a `credits` run, because `credits` stamps today's register onto the published version and
the published corpus still owes the removed source's attribution until a release rebuilds it.

## Preparing the frequency lists

The pilot (`docs/research/2026-09-27-frequency-pilot/` in the research repository) chose two sources: our own count of
FineWeb, and Google Books GB for 2000–2019 (Decision 19). Both need the legal review's clearance and an attribution.
On a workstation, not in Actions:

1. **FineWeb.** Stream 10 of the shards of `HuggingFaceFW/fineweb` `sample/10BT`, about 5 billion tokens, straight
   from Hugging Face: `count-text` reads each one by byte ranges into memory and **saves no copy of the web text**
   (the licence review's question 8). Nothing to download or delete:
   ```bash
   pnpm --filter @wordado/pipeline corpus count-text "$PWD/content/sources/fineweb.tsv" \
     https://huggingface.co/datasets/HuggingFaceFW/fineweb/resolve/main/sample/10BT/00{0..9}_00000.parquet
   ```
   It takes about as long as the network allows, 20–40 minutes for the ten. The word table stays within Node's
   default memory: when it reaches 12 million forms, the rarest are dropped, which leaves the 200,000 kept forms'
   counts untouched. The 2026-09-28 count was made from downloaded shards, before streaming existed, and they were
   deleted afterwards (`sources.json` notes).
2. **Google Books GB.** Stream the four British English 1-gram files (listed at
   `https://storage.googleapis.com/books/ngrams/books/20200217/eng-gb/eng-gb-1-ngrams_exports.html`, about 4 GB
   compressed): each is decompressed and counted as it downloads, and only the counts are kept. Nothing to delete:

   ```bash
   pnpm --filter @wordado/pipeline corpus sum-gbooks "$PWD/content/sources/google-books-gb.tsv" \
     https://storage.googleapis.com/books/ngrams/books/20200217/eng-gb/1-0000{0..3}-of-00004.gz
   ```
   The 2026-09-28 count was made from downloaded files, before streaming existed, and they were deleted afterwards
   (`sources.json` notes).

   Both commands take **URLs only** and refuse a local file: counting streams, keeps the counts and nothing else,
   so no downloaded copy of a corpus exists to be kept or deleted. A new frequency source must stream the same way.
   To try a small local sample, serve it over HTTP (`python3 -m http.server`) and pass its `http://localhost` URL.
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
   it is described whatever its frequency. Its first sense, the everyday one, is live and goes to banding review;
   its other senses (the *bed* of a garden) compete by frequency like any word's.

## Running a version

1. **Draft** (Actions › Corpus › `draft`). It opens a pull request with the caches, the registry and new review
   files. Merge it.
2. **Review.** Reviewers edit `review/**/*.csv` (the content README says how) and open pull requests. Then run
   `corpus import "$PWD/content" --by <name>` locally, commit and push. Import rejects a row it cannot apply, names
   it, and leaves it in the file.
3. **Draft again** (Actions › Corpus › `draft`, or `corpus draft "$PWD/content"` locally), before audio or
   release: a drop or a level fix reshapes units, whose titles must then be asked again. Skipping this is not
   silent: `release` refuses with "decided since the draft; run corpus draft" and names the entry.
4. **Audio** (`audio`), then listen: its review files are under `review/audio/`. Merge. Repeat for clips marked
   `redo`.
5. **Triage** (`triage`) whenever reports have come in, before a release. It reopens items and marks clips
   `redo`: run `audio` and review again.
6. **Status**, locally, until it says `0 problems, 0 items awaiting review`. It reads `work/draft.json`, which is
   not committed, so first pull `main` (the Corpus › `draft` action's merged caches) and run
   `corpus draft "$PWD/content" --offline`, which rebuilds the draft from the caches without spending money.
7. **Release** (`release`, with `release` typed in the *confirm* field; only users in `RELEASE_ACTORS` can run it). It checks that the CDN serves
   `last-published/`, rebuilds the draft `--offline` from the committed caches (never spending money, and never
   publishing a proposal nobody has seen), builds with every gate, uploads packs, audio, `fixes.json` and
   `credits.json`, then the manifest, checks that the CDN serves it, and commits the new `last-published/` to main.

## An MVP release: shipping some queues unreviewed

`accept_unreviewed` in `pipeline.json` lists review queues whose open items do not block a release, for example
`["english", "level", "title-bg", "audio"]`: the release ships their proposals as they are. Nothing is recorded as
reviewed, so the items stay open, `queues` keeps writing them out, and a later review picks them up. `status` lists
them under *ships unreviewed*, and `release.json` counts them per queue. Missing clips, clips marked `redo` and
decisions made since the draft still block.

Learners are marked right or wrong against the translation and its alternates, so a translation queue is listed
here only under the beta's review tiers (spec §5.4): every row AI-reviewed, and every row the AI review flags checked
by a native speaker before the release. Remove a queue from the list once its native-speaker review is complete, to
gate it again; its open items then block the next release.

The content repository ships A1–C1: `"levels"` lists all five since 2026-10-02, and `max_lemmas` is 11,000 and
`max_forms` 25,000 since v5, enough to fill every level's target. It also lists every translation queue in
`accept_unreviewed`. Up to v5 (2026-10-04) nothing has been AI-reviewed either; the review tiers apply from the
release that follows the AI review's pilot, before the beta opens.

## A second review

`corpus reopen "$PWD/content" <queue> --by <name> --all --note "second review"` sends every reviewed item of a
queue back; `--keys <file>` sends only the keys listed in the file, one per line. Dropped items stay dropped, and
open items are already open. Then run `queues`: the items come out with their current values, fixes included,
and the note in the **reopened** column. The release waits for them again, unless the queue is in
`accept_unreviewed`. Audio is not reopened; mark a clip `redo` instead. A corrected field is listed in the next
version's `fixes.json`.

## AI review

The beta's review tiers (spec §5.4, and `docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`): a
model from another family than the one that wrote the corpus checks every open row of the queues in
`ai_review.queues`, and a native speaker decides the rows it flags.

    "ai_review": {
      "queues": ["translation-bg", "title-bg", "level"],
      "reviewers": { "flash": { "provider": "openrouter", "model": "google/gemini-3.8-flash" },
                     "bggpt": { "provider": "local", "url": "http://127.0.0.1:8091", "model": "bggpt" } },
      "default": "flash",
      "flag_when": 1
    }

`corpus ai-review "$PWD/content" [--queue <q>] [--reviewer <name>]` reviews every open row the reviewer has not judged
in its current form, and appends the verdicts to `ai-review/<queue>.jsonl`. A row whose proposal or learner note
changes is reviewed again. `required` (default: the default reviewer) lists whose verdicts every row needs; a row is
flagged when `flag_when` of them object. A `local` reviewer is any OpenAI-compatible server, for example llama.cpp's
`llama-server -m <model.gguf> --port 8091 --jinja`; start it first.

The Actions workflow's `ai-review` action runs `draft --offline` first, so it only rebuilds from the caches already
on disk: after an import that reshapes units (a drop or a level fix), run the `draft` action before `ai-review`, or
it reviews stale proposals. The workflow also runs only the configured default reviewer; other reviewers listed in
`required` must be run locally, one at a time, with `--reviewer <name>`.

`status` lists, per AI-reviewed queue, the rows not yet AI-reviewed and the flagged rows awaiting a decision;
`release` refuses while either is open, even for queues in `accept_unreviewed`. Decide the flagged rows in the review
app (`review-app/README.md`), then `corpus import`.

## Themes and units

`themes.json` is the curated theme list, each theme named and described in English and every L1. The *themes*
stage asks, for every live sense, which themes fit (up to three, most relevant first); the English descriptions
are part of the question, so write them to say what belongs and what does not ("Jobs, workplaces and colleagues;
not business or the economy in general"). Changing the list asks the themes stage again for every live sense
(about $3 for 3,100), and nothing else: the senses question keeps the 24 ids it was first asked with.

Units are sticky: a word keeps its unit from draft to draft, so new themes only group words not yet in a unit.
To regroup, run `corpus draft "$PWD/content" --regroup` locally: every unit no published pack carries is rebuilt
from the current themes, and its title is asked again. A published unit keeps its words; a learner's path does
not change under them.

## Running locally on your Claude plan

`draft` and `compare` can answer on your own Claude plan instead of OpenRouter, through Claude Code's print mode:

```bash
CORPUS_LLM=claude-code pnpm --filter @wordado/pipeline corpus draft "$PWD/content"
```

It needs Claude Code installed and signed in (`claude` on the PATH); an `ANTHROPIC_API_KEY` in the environment is
removed for these calls, so they never bill an API account. Each request runs `claude -p` in an empty temporary
directory with no tools, the stage's instructions as the system prompt and its schema as `--json-schema`. The model
is `llm.model` without `anthropic/` (`claude-sonnet-5`, the model the caches were made with), or `CORPUS_LLM_MODEL`.

- The answers go into the same caches, each recorded with the model that gave it (`claude-code:claude-sonnet-5`),
  so a later run on OpenRouter reuses them, and CI never needs your plan.
- The calls count against the plan's usage limits. When one is reached the run stops with "usage limit is reached";
  everything answered so far is cached, so rerun after the limit resets. `llm.max_usd_per_run` does not apply; the
  spend printed is Claude Code's API-equivalent estimate.
- Almost all of a call's time is the model writing its answer (about 37 s for a batch of senses; starting Claude
  Code adds about 3 s), so more calls at a time is what makes a run faster. `CORPUS_LLM_CONCURRENCY=8` overrides
  `llm.concurrency` (4) for `draft` and `compare`; how many help depends on the plan's rate limits. Try it on
  `compare` first. One long Claude session for many batches would be slower on the whole: every batch would carry
  the earlier ones in its context, using the plan's limits up faster and making answers depend on each other.
- Audio still needs `OPENROUTER_API_KEY`: Claude does not speak.
- Your own `~/.claude` settings and CLAUDE.md still load with each call (only `--bare` would skip them, and it does
  not work with a plan's login). Check your claude.ai privacy settings if training on these prompts matters.

**Before trusting another model or provider**, run `corpus compare "$PWD/content" --sample 20` with it chosen
(`--stage senses|translate|themes` for one). It asks a sample of the draft's live words in a throwaway cache and
writes `work/compare.md`, its answers beside the draft's. Nothing goes into the content caches.

## Adding an L1

One draft serves every L1: senses, themes, levels, audio, IDs and units are shared, and only translations and unit
titles are asked per L1. To add one (German, `de`, is the model):

1. **Code** (this repository): a translation guide in `L1_GUIDES` (`pipeline/src/stages/translate.ts`), unit-group
   names in `GROUP_NAMES` (`pipeline/src/units.ts`), and the L1's language in `L1_NAMES` (`pipeline/src/stages/titles.ts`).
   An L1 missing from `L1_NAMES` falls back to its bare code in the unit-titles prompt without a word of warning, so
   it must be set.
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

## When something is wrong

- **"pinned entry … is not live: the senses stage no longer proposes it".** The senses stage proposed no sense
  of that sample word with the sample's part of speech. (A sample entry takes the first sense of its part of
  speech, however many there are.) Find the lemma's line in `cache/senses.jsonl` and restore a sense with the
  sample's part of speech. That file is plain JSON, one item per line. Then run `draft` again.
- **A stale decision.** A prompt version was bumped, so proposals changed, and their earlier verdicts no longer
  apply (Decision 5). `queues` offers them again. Open files under `review/` still hold the old proposals, so
  delete them before running `corpus queues` again.
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
