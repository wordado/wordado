# The AI reviewer judges reports and applies small fixes — design

**Date:** 2026-10-10 · **Status:** agreed with the product owner on 2026-10-10 (§15); not built
**Issues:** #138 (this design), #137 (the learner's suggestion, built), #139 (the list of automatic changes).
**Parent specs:** `2026-09-20-vocabulary-learning-app-design.md` §5.4 and §8.10;
`2026-10-04-ai-review-and-review-app-design.md` (the AI review, its storage, the release gate).

## 1. Purpose

The parent spec sent every reported row to a native speaker, and planned a full native-speaker review before the
general launch. Decided by the product owner on 2026-10-09: there is no full native review. Quality comes from the
AI review of every row, spot checks in the review app, and learners' reports. A spot check on 2026-10-10 of 50
Bulgarian rows the AI review had passed found no serious fault and four minor ones.

Reports are now the main way faults are found, so they must not wait for a person each. This design lets the one
AI reviewer settle most of them:

1. **`corpus judge`**: a pipeline command that judges each reported row in two steps and ends in one of three
   outcomes: the fix is applied, the report is closed, or the row waits for a native speaker.
2. **Small fixes without a report** (decided 2026-10-10): the AI reviewer may apply a narrow class of its own
   objections by itself.
3. **A record of every automatic change**, old text beside new, which #139 turns into a weekly list and a mail to
   the coordinator, with a way to take a change back.

**Success:** a learner's correct report reaches every device in the next corpus version without anyone deciding
it; a wrong report changes nothing; a person sees only what the reviewer could not settle; and every automatic
change can be read and undone.

## 2. Decisions

| Question | Decision |
|---|---|
| Who judges | The default AI reviewer of `pipeline.json` (`ai_review.default`), no second model. A second reviewer stays possible by configuration and is not built here. |
| How | Two steps, so the reviewer does not lean towards the text it is shown (§4). |
| Outcomes | Applied, closed, or a native speaker in the review app (§5). |
| Which reports | Translation reports only, in this version (§3). |
| Small fixes without a report | Allowed, for the classes of §7. |
| A person's decision | Never overwritten by the reviewer (§6). |
| Publishing | Unchanged: a corpus version is released by the owner. The judge changes the content repository, not what learners have (§9). |

## 3. Scope

**In:** reports on a translation (`field: translation`, and `other` when it names a translation queue through
triage), for every L1 the pipeline carries. These are the rows of the `translation-<l1>` queues: translation,
alternates and sense.

**Out, unchanged from today:**

- `audio` reports: `triage` already remakes the clip.
- `example` and `level` reports: they reopen the `english` and `level` queues and wait for a person. They are few,
  and the example is English text, which the translation reviewer is not set up to judge.
- Unit titles: learners cannot report them.

## 4. The two steps

`corpus judge <dir> [--queue <queue>] [--dry-run]` runs after `corpus triage`. It takes every row that `triage`
reopened and that has no current judgement (§8).

**Step one: is the current text right?** The reviewer gets what the translation review gets for a row (the English
sense, its example, the word's other live senses, the current translation, alternates and sense, the L1 guide),
plus what the learners said is wrong: the report fields and their notes. **It does not get the suggestions.** It
answers:

```json
{ "finding": "fault" | "no-fault" | "unsure",
  "field": "translation" | "alternates" | "sense",
  "reason": "…",
  "fix": "…" }
```

`fix` is the reviewer's own correction, asked for here, before it has seen anyone else's.

**Step two: is the new text right?** Only after `fault`. The reviewer gets the row again, with the faulty field
left blank, and the candidates: each distinct suggestion of the learners and the reviewer's own fix from step one,
in a shuffled order and without saying whose is whose. It answers, per candidate, `right`, `wrong` or `unsure` for
this sense, and names the best of the right ones.

Splitting it this way costs a second call for the rows with a fault only. A row with no suggestion still goes
through step two, with the reviewer's fix as the one candidate: a second look at its own answer, asked a different
way.

For that to work, `triage` keeps what learners said in a form the judge can take apart. The reopen event gains an
optional `reports` list (`field`, `note`, `suggestion` each); the `reopened` text that people read stays as it is.

## 5. The three outcomes

| Step one | Step two | Outcome |
|---|---|---|
| `fault` | a candidate is `right`, and §6 allows | **Applied.** A `fix` event by `ai-judge` with the chosen text. |
| `no-fault` | — | **Closed.** An `ok` event by `ai-judge`; the row is no longer reopened. |
| `unsure`, or `fault` with no `right` candidate, or §6 refuses | — | **Native speaker.** The row stays reopened. The review app shows the judge's finding and reason beside the report. |

- An applied fix reaches the reporter the way a person's fix does: the field's value changes in the next version,
  `fixes.json` names it, and the app tells the reporter. A closed report is answered too, in the app (§5.1).
- Closed is not silent for us: the count and the rows are in the run's summary and in the list of #139, so a
  reviewer that closes too readily is seen.
- A report with nothing to check ("bad", an empty note, no suggestion) goes through step one like any other. When
  the reviewer finds no fault by itself, it is closed.

### 5.1 Telling the reporter that a report was not accepted

Decided by the owner on 2026-10-10: a learner whose report was closed is told so, politely, and can object.

- **In the app, not by mail.** Many learners have no account, and those who have gave their address to sign in.
  The message appears where "It is fixed now. Thank you!" appears today.
- **How the app knows.** A release writes `closed.json` beside `fixes.json`: the word, the field, the L1, the
  version it was closed in, and a reason code. Like `fixes.json` it names no learner; a device matches it against
  its own reports made before that version.
- **Fixed sentences, not the reviewer's own words.** The reviewer's reason is written in English for us, and a
  sentence it wrote for the learner would be unchecked AI text in the app. The reason code picks one of a few
  sentences that are part of the interface text, for example: "Thank you for your report on "{word}". We checked
  it and kept the translation for this meaning: {sense}." Codes: `right-for-this-sense`, `nothing-to-check`
  (the report said nothing that could be checked), `other`.
- **"Still looks wrong".** A button on the message files a second report on the same word, marked as an objection
  (`objects: true` on the report document). `judge` never judges an objection: the row goes to a native speaker,
  with both reports. So the reviewer cannot close the same learner's complaint twice.
- The wording is modest ("we kept it for now"): the reviewer is sometimes wrong, and the button is the remedy.

## 6. When a fix may be applied without a person

All of these hold, or the row goes to a native speaker:

1. **No person decided the current value.** If the newest decision on the row before the reopen is a person's
   (`ok` or `fix` by anyone but `ai-judge` and the bulk acceptance of AI fixes), the reviewer may not change it.
2. **The reporters do not contradict each other.** Two suggestions that step two both calls `right` but that are
   different translations (not one main, one alternate) go to a person.
3. **The new value passes the rules a person's edit passes** (the review app's cell rules: non-empty, the
   separators of alternates, length).
4. **The changed row then passes the ordinary AI review.** Its content changed, so `corpus ai-review` asks again;
   a `major` objection to the new content withdraws the fix (a `reopen` event by `ai-judge`, the earlier value
   restored) and the row waits for a person.
5. **The run's cap is not reached.** `judge.max_applied_per_run` (default 50). More than that in one run is more
   likely a fault of ours than of the corpus; the rest wait and the run says so.
6. **The row was not taken back before.** A fix the coordinator took back (#139) is never applied again with the
   same text.

## 7. Small fixes without a report

The ordinary AI review leaves objections of severity `minor` on rows that are not flagged. Decided 2026-10-10: the
reviewer may apply some of them by itself. "Small" is exactly this, and nothing else:

| Category | What changes | Bound |
|---|---|---|
| `spelling` | A misspelt translation, alternate or sense | The fix differs from the current text by at most 2 characters and not in more than one word |
| `alternate-missing` | One alternate is added | The main translation and the other alternates stay as they are |
| `alternate-wrong` | One alternate is removed | The same |

Never without a report: a different main translation, a different sense, anything `major` (those rows are flagged
and wait for a decision, as today), anything on a row a person decided.

Each small fix goes through step two as its one candidate (the row with the field blank, "is this text right?")
and through conditions 1 and 3 to 6 of §6. It is recorded as a `fix` event by `ai-review-small`, apart from the
judge's, so the two can be counted and switched off separately (`judge.small_fixes: false`).

**The first run is a dry run.** The current corpus carries the minor objections of every earlier review, so the
first pass could change far more rows than a week of reports would. `corpus judge --dry-run` prints the counts per
category and language and writes the proposed changes to a file without applying anything. The owner reads the
counts and a sample before the first real run; the cap of §6 applies per run after that.

## 8. Storage

`judge/<queue>.jsonl` in the content repository, appended, one line per judgement:

```json
{"key":"<row key>","model":"…","prompt_version":1,
 "content":"<sha256 of the row's cells and its reports>",
 "kind":"report" | "small-fix",
 "step1":{"finding":"fault","field":"translation","reason":"…","fix":"…"},
 "step2":[{"text":"…","from":"learner" | "reviewer","verdict":"right"}],
 "outcome":"applied" | "closed" | "native" | "withdrawn",
 "old":"…","new":"…","at":"2026-10-10T08:00:00Z"}
```

- A row is judged again only when its content hash or the prompt version changes: a new report on it, or a new
  value.
- `old` and `new` are what #139 lists. `fixes.json` cannot serve: it names the field and the version, not the
  text.
- The decisions themselves (`fix`, `ok`, `reopen`) go where a person's go, so `corpus status`, `release` and the
  review app need no second source of truth.

## 9. When it runs, and publishing

- **Checking:** a scheduled action in the content repository, daily: `triage`, `judge`, then `ai-review` on what
  changed. It opens a pull request like the other corpus actions.
- **That pull request merges by itself** when its checks pass. It changes decisions in the private content
  repository only; every change in it is in the list of #139 and can be taken back.
- **Publishing stays the owner's action.** `corpus release` is run by the owner as today, about weekly, after the
  mail of #139; at once for something embarrassing. Releasing automatically can come later, once the list has been
  read for some weeks without surprises.

## 10. The review app

- A row that waits for a native speaker shows, beside "Learner reports", the judge's finding: `unsure` or `fault`,
  the reason, and the candidates with their verdicts. The reviewer decides as today.
- The snapshot carries the newest judgement per row with a matching content hash.
- The page with the list of automatic changes, the weekly mail and "take back" are #139.

## 11. Errors

- The reviewer cannot be reached, or an answer does not fit the schema after the pipeline's retries: the row is
  left as it is (reopened) and the run names it. Nothing is applied on a partial answer.
- The cap is reached: the rest wait for the next run; the summary says how many.
- A fix withdrawn by §6.4 is recorded as `withdrawn`, with the objection that withdrew it.
- `--dry-run` writes nothing but its report file.

## 12. Testing

- Unit tests with recorded answers for each row of the table in §5 and each condition of §6.
- `closed.json`: a closed report is listed with its reason code; an objection is never judged and reaches a
  native speaker; the app shows the sentence for the code once, and the button files the objection.
- The bounds of §7 (two characters, one word; one alternate added or removed) as table tests.
- A run is repeatable: the same input and the same recorded answers give no new lines.
- `triage` with the `reports` list, and an event without it (written before this design) still read.
- The pipeline's end-to-end test: a reported row is applied, a second is closed, a third stays reopened, and a
  release tells the first reporter.
- Before the first real run: `--dry-run` on the real reports and the real minor objections, read by the owner.

## 13. Changes to the parent specs

- `2026-09-20-vocabulary-learning-app-design.md` §5.4 and §14: the general launch no longer waits for a full
  native-speaker review; §8.10: a report is judged by the AI reviewer first.
- `2026-10-04-ai-review-and-review-app-design.md` §3.3: the minor objections do not "go to native review"; the
  small ones are applied (§7 here), the rest stay visible under *show unflagged*.

## 14. Out of scope

- Reports on examples and levels (§3).
- A second reviewer from another model family, voting with the first.
- Releasing a corpus version without the owner (§9).
- A random sample re-reviewed with every run. The spot check in the review app does this by hand.

## 15. Decided by the owner, 2026-10-10

1. **The pull request of §9 merges by itself.**
2. **The first run of the small fixes is a dry run** (§7); the owner reads the counts and decides: all, by
   category, or a level at a time.
3. **The native speaker for the rows in between:** the owner for Bulgarian. German and Spanish have nobody yet;
   those rows stay reopened and ship with their current text.
4. **A closed report is answered in the app, with a way to object** (§5.1).
