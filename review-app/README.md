# Review app

A local web app for deciding the rows `corpus ai-review` flags (spec
`docs/superpowers/specs/2026-10-04-ai-review-and-review-app-design.md`). It shows each flagged row beside the AI
reviewer's objections and any learner reports, and writes your decisions into the content repository's review files,
which `corpus import` then records. It runs on your machine only (127.0.0.1); nothing leaves it.

## Once: set up AI review

1. The content repository's `pipeline.json` has an `ai_review` block (see `pipeline/README.md`, "AI review"): the
   reviewer (Gemini 3.8 Flash by default), and the queues it covers (`translation-<l1>`, `title-<l1>`, `level`).
2. Run the **ai-review** action (Actions › Corpus › `ai-review`) and merge the pull request it opens. The verdicts
   land in `ai-review/<queue>.jsonl`.

## Each session

1. **Update the content checkout and start a branch:**

       cd content
       git checkout main && git pull
       git checkout -b review/bg-<date>

2. **Rebuild the local draft** (free, no LLM calls). The app needs `work/draft.json`, which is not committed:

       cd .. && pnpm --filter @wordado/pipeline corpus draft "$PWD/content" --offline

3. **Start the app** from the repository root:

       pnpm --filter @wordado/review-app review "$PWD/content"

   It builds the UI, starts a server on 127.0.0.1 and opens the browser. The first time it asks your name, which
   `corpus import` records with every decision (kept in `~/.config/wordado/review-app.json`).

4. **Decide the rows.** Pick a queue at the top (`translation-bg`, then `title-bg`, then `level`). The list shows
   learner-reported rows first, then major and minor objections; filter it by level or severity, or tick
   *show unflagged* to add the rows the AI passed. For each row you see the English sense and example, the word's
   other senses, the current values with the questioned field highlighted, each objection's reason and proposed fix,
   and the learners' notes.

   | Key | Button | What it writes |
   |---|---|---|
   | 1 | Accept fix | the ticked fix (one per field; ticking another objection on the same field unticks the first) |
   | 2 | Keep | the row as it is, marked ok |
   | 3 | Edit | the cells as you change them; press 3 again to save |
   | 4 | Drop | drops the sense (translations only) |
   | S, ↓ | Skip | nothing; moves to the next row |
   | ↑ | | moves to the previous row |

   What a row shows depends on its queue:
   - **Translations:** the translation, its alternates and its sense gloss, the word's other senses, and objections
     such as a wrong sense, a wrong alternate or a missing gloss.
   - **Titles:** the unit's English and native-language titles beside the unit's words. There is no Drop.
   - **Levels** (the `level` queue: about 335 rows, the uncertain cases and a 1-in-20 sample): the meaning, an example,
     the frequency band and the proposed level, with an objection *too low* or *too high* and the level the AI
     proposes. Accept sets that level; Edit takes `A1`–`C1`; there is no Drop. A level change moves the word to another
     unit at the next draft, so change one only when you are sure (the level reviewer guide in the research
     repository, `levels.md`, has the descriptors).

   Add a note when something needs the coordinator's attention. Every decision is written into the review file at
   once, so you can stop at any point. Keys do nothing while you type in a field or a picker.

   A row marked *"This file is older than the draft"* was proposed again by a newer draft: import your decisions,
   run `corpus queues`, and come back to it. If a file changes on disk while the app is open (a new draft, a
   spreadsheet save), the app reloads it instead of overwriting it.

5. **Import:** click **Import decisions**. It records your decisions in `decisions/`, removes the rows you finished
   from the review files, and lists any row it could not apply (they stay in the file).

6. **Commit and open a pull request in the content repository**, then merge it:

       cd content
       git add -A review decisions && git commit -m "review: translation-bg by <name>"
       git push -u origin review/bg-<date> && gh pr create --fill

## After a round

- **Drops or level changes** reshape units and bring in replacement words: run the **draft** action, then
  **ai-review** again. It reviews only what is new or changed, so it costs little. Then hold another session for the
  new flags.
- **Learner reports:** **triage** reopens reported rows; after the next **ai-review** they come first in the app,
  with the learners' notes, and the reviewer has seen the notes too.
- **Release:** `corpus status` shows the AI lines (*not yet AI-reviewed*, *flagged by AI review, awaiting a
  decision*). When they are gone, run **release** as usual.

## What the AI reviews, and when

`corpus ai-review` reviews every *open* row of the queues in `ai_review.queues`: rows no human has decided, and rows a
learner report sent back. Each verdict belongs to exactly what the reviewer saw: the proposed value and any learner
note. A row is asked again only when that changes (a new or re-proposed word after a draft, a new report) or when the
reviewer's instructions change. Rows a human has decided are never sent. A change only to a row's surroundings (its
example sentence, the word's other senses) does not send it again.
