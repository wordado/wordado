# Levels and coverage: the common words, the easy words, and a two-step level limit — design

**Date:** 2026-10-06 · **Status:** draft for the product owner's review
**Parent spec:** `2026-09-20-vocabulary-learning-app-design.md`, §5.1 (stable IDs and units), §5.3 (level
targets), §5.4 (banding).
**Changes:** `plans/2026-09-27-corpus-pipeline.md` Decision 7 (one band becomes two) and, for one release only,
Decision 9 (published units and levels stay).
**Evidence:** the level check of 2026-10-06 in the research repository (`2026-10-06-level-check/report.md`,
reproduced by its `check.py`).

## 1. Purpose

The level check compared corpus version 5 with an open reference list and with the model's own levels. For the
words that are in the course, levels are mostly reasonable. But the way the corpus is built causes three
problems:

1. **The common words are missing.** The first batch of the lemmas stage came back with empty lemma lists for 91
   of the 100 most frequent forms. `rankLemmas` skips such forms. 66 of those words have no entry (*the, of, and,
   my, we, they*), and 8 more have a wrong level because their frequency is wrong (*you* and *new* are B1, *in*
   is B2). Ten month names were classed as names and dropped.
2. **Easy words are left out when their level is full.** `targets` caps each level. An entry that does not fit is
   left out of the course, not moved: 127 entries rated A1, 664 rated A2 and 1,363 rated B1 (*cat, seven, mouth,
   village*). 35% of the reference's A1 words and 48% of its A2 words are not in the course.
3. **The one-band limit puts everyday words too high.** Web and book text mentions *pen* and *spoon* rarely, so
   the limit moves them to B1 and B2. Among easy words (reference A1–A2), 294 land two or more levels too high.

This design fixes all three in corpus version 6.

Success:

- Every one of the 66 common words has a live entry, and *you, new, in, up, will* are A1 or A2.
- `check.py` reports at most 12% of the reference's A1 words and at most 26% of its A2 words not in the course
  (today 35% and 48%).
- The course has between 8,700 and 9,200 live entries.
- No entry of version 5 is removed, and no entry ID changes.
- No level is copied from an outside list. The reference lists are a yardstick only.

## 2. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Which left-out words come back | Every main meaning rated A1 or A2, and the B1 main meanings of the 5,100 most frequent words (about 550). Later meanings stay out |
| Course size | About 8,950 entries, from 7,100 |
| The level rule | The model's level, at most **two** steps from the frequency band (today: one) |
| Published words whose level changes | They move. Each is a proposal in the `level` queue; the AI reviewer checks every one, and a person decides only its objections |
| Published units | Rebuilt once. The app is not officially published, so losing saved unit unlocks is accepted **for this release only** |
| The empty lemma lists | A rule in code, not a new question to the model |
| Months | Added to `essentials.txt`, as the days of the week are |

What a learner keeps through the rebuild: every word's memory state, streaks, XP, settings and the declared
level. These hang on entry IDs, which do not change. What is lost: the saved `unit_unlock` set, because the old
unit IDs are gone. The app derives the path again from the words already introduced (`core/src/path.ts`), so a
learner finds some early units unfinished: the ones that now hold new easy words.

## 3. Pipeline changes

All in `pipeline/` unless noted. Each rule is a pure function with a test written first.

### 3.1 An empty lemma list means the form is its own headword

`rankLemmas` (`src/stages/lemmas.ts`): for a result of kind `word` with an empty `lemmas` list, the form itself
is the lemma. A form that contains an apostrophe is still skipped (*they're, i'll, c'mon*: the stage should have
called these fragments).

No cache line changes and `LEMMAS_VERSION` stays 1, so nothing is asked again. The 146 affected forms gain their
frequency. Every other lemma's rank shifts by at most about 130 places.

### 3.2 The two-step limit

`bandLevel` (`src/stages/senses.ts`) keeps the model's level within `LEVEL_LIMIT_STEPS = 2` bands of the
frequency band, where it was 1. `flagged` is still "the limit changed the level". C2 from the model still drops
the sense. Essential first senses keep the model's level, as today.

Measured on 5,929 main meanings with a model level and a reference level: the share at the same level stays the
same (45% and 44%), and the easy words two or more levels too high fall from 294 to 68.

### 3.3 Selection: easy main meanings are always in, and sizes are set apart from boundaries

`targets` keeps one job: the frequency boundaries between bands (`frequencyBand`). It does not change, so no band
moves because of this design.

Two optional settings in `pipeline.json` (`src/config.ts`):

```json
"sizes": { "A1": 600, "A2": 1000, "B1": 1500, "B2": 1600, "C1": 2000 },
"main_meanings": { "A1": "all", "A2": "all", "B1": 5100 }
```

- `sizes`: how many entries the frequency fill may bring a level to. Default: `targets`. Every level needs a
  positive integer.
- `main_meanings`: per level, which main meanings (sense order 0) are live whatever the level's size. `"all"`, or
  a positive integer N meaning "the word's frequency rank is at most N". Default: none. Keys must be levels the
  corpus ships.

`selectLive` (`src/select.ts`) then works in this order:

1. Leave out dropped entries and entries of a level the corpus does not ship.
2. Pinned entries and entries live in the last published pack are live (unchanged).
3. **New:** a main meaning whose level has a `main_meanings` rule that it meets is live.
4. The rest, most frequent first, fill each level until it holds `sizes[level]` entries (unchanged, but against
   `sizes`).

The result does not depend on what earlier drafts did, so running the draft twice gives the same course.

### 3.4 A one-time rebuild: `corpus draft --rebuild`

By default nothing changes: an entry keeps its unit, and so its level, and published units keep their words.

With `--rebuild` (`src/cli.ts`, `src/draft.ts`):

- **Levels.** Every entry's proposal is the banded level of §3.2. The unit it sits in is not consulted.
- **Units.** All units are built again by `assignUnits` from the live entries. The old units stay in
  `registry.json` with an empty `entry_ids` list. They are a record that their IDs were used, so new unit numbers
  continue after them and no unit ID is ever reused. A unit without live entries is not written to a pack, as
  today.
- **Entries.** Nothing changes for entry IDs. An entry live in the last published pack stays live.

`--rebuild` cannot be combined with `--regroup`. It is run locally, as `--regroup` is.

After the run, `registry.json` holds the new units. A later plain `corpus draft --offline` (the **ai-review** and
**release** actions run one) reads them and gives the same draft.

### 3.5 A published entry whose level changed is in the `level` queue

`level_flagged` (`src/draft.ts`) is true today when the limit changed a new entry's level. It becomes true also
when a live entry's proposal differs from its level in the last published pack. This holds in every draft, not
only with `--rebuild`, so the rows stay in the queue for the actions that follow, and leave it by themselves once
version 6 is published.

Nothing else changes in the queue: `level` is one of the queues the AI reviewer covers, the release waits until
every open row has a verdict, and a row with a major objection waits for a person.

### 3.6 The release accepts removed units once

`checkPackSuccession` (`core/src/packStability.ts`) gets an option that skips the "unit was removed" check. The
entry check stays: a removed entry is always an error.

`planRelease` (`src/release.ts`) passes the option only when `pipeline.json` says so:

```json
"units_rebuilt_after": 5
```

The setting names the corpus version the rebuilt units follow. It has an effect only while the last published
version is exactly that number, so it works for version 6 and for nothing after it. `corpus status` prints a
line when it is in effect. No workflow file changes.

## 4. Content changes

One pull request in `wordado-content`, after the pipeline change is merged:

- `pipeline.json`: `sizes`, `main_meanings` and `units_rebuilt_after` as above.
- `essentials.txt`: the twelve month names.
- The repository variable `PIPELINE_REF` moves to the merged commit.

`pipeline/template/pipeline.json` does not get the new settings: a new content repository starts with the
defaults. `pipeline/README.md` describes them.

## 5. What the draft is expected to give

From a simulation on the version 5 draft. The rank shift of §3.1 is not simulated, so real numbers will differ a
little.

| Level | Version 5 | After the level moves | New entries | Version 6, about |
|---|---:|---:|---:|---:|
| A1 | 600 | 621 | 239, plus the common words and months | 950 |
| A2 | 1,000 | 938 | 969 | 1,900 |
| B1 | 1,500 | 1,870 | about 550 | 2,450 |
| B2 | 2,000 | 1,649 | 0 | 1,650 |
| C1 | 2,000 | 2,022 | 0 | 2,020 |
| **Total** | **7,100** | 7,100 | about 1,850 | **about 8,950** |

- 838 published entries change level, nearly all by one step: 426 from B2 to B1, 157 from A2 to B1, 113 from B1
  to A2, 95 from B1 to B2.
- About 450 units, all new.
- `sizes.B2` is 1,600 on purpose: below the expected 1,649, so the frequency fill adds no B2 entries.

## 6. Rollout

| Step | Who | What |
|---|---|---|
| 1 | Pull request in `wordado` | §3, with tests and the README. CI must be green |
| 2 | Pull request in `wordado-content` | §4. Move `PIPELINE_REF` |
| 3 | Operator, locally | `corpus draft "$PWD/content" --rebuild`, with `OPENROUTER_API_KEY` or `CORPUS_LLM=claude-code`. Commit the caches and `registry.json`; pull request |
| 4 | Operator | `python3 check.py` from the level check, to compare with §1 and §5 before spending more |
| 5 | Actions | **ai-review**, one queue at a time |
| 6 | Product owner | Decide the rows with a major objection in the review app; import; pull request |
| 7 | Actions | **audio**, then listen to the sample |
| 8 | Product owner | `corpus status`, then **release** |
| 9 | Pull request in `wordado-content` | Remove `units_rebuilt_after` |

What step 3 asks the model: meanings and translations for the roughly 130 restored words and 12 months, themes
for about 1,850 new live entries, and a title in three languages for every themed unit (all units are new).
Everything else is in the caches.

Estimated API cost for steps 3, 5 and 7 together: 15 to 25 dollars. The audio price is not verified.

## 7. Errors and edge cases

| Situation | What happens |
|---|---|
| `--rebuild` with `--regroup` | Refused with a usage error |
| `--rebuild` with `--offline` while an answer is missing | Stops with the stage's name, as any offline draft does |
| `main_meanings` names a level the corpus does not ship, or a value that is not `"all"` or a positive integer | `ConfigError` at start |
| `units_rebuilt_after` is not the last published version | No effect: removed units are refused as today, and `status` does not print the line |
| A rebuilt draft is released without `units_rebuilt_after` | Refused: "unit … was removed" |
| An entry of version 5 is no longer proposed after the rank shift | It is published, so it stays live (existing rule) |
| The budget stops the draft | Run it again: every answer already paid for is in the caches (existing behaviour) |
| A person fixes a level in the queue | The entry gets that level; at the next draft it joins a unit of that level (existing behaviour) |

## 8. Testing

- `lemmas.test.ts`: an empty list makes the form its own lemma and counts its rate; a form with an apostrophe is
  skipped; a non-empty list is unchanged.
- `senses.test.ts`: `bandLevel` at each band, two steps down and two steps up, `flagged` only when limited.
- `select.test.ts`: `"all"`; a rank bound; a later meaning is not covered by `main_meanings`; `sizes` caps the
  fill; the defaults give today's result; the result is the same when run twice.
- `config.test.ts`: the three new settings, valid and invalid.
- `draft.test.ts`: with `--rebuild`, a published entry gets the banded level, joins a new unit whose number
  follows the old ones, and is `level_flagged`; the old unit stays in the registry, empty; a plain draft after it
  gives the same units; without `--rebuild`, nothing moves.
- `release.test.ts`: removed units are refused; accepted when `units_rebuilt_after` equals the last published
  version; refused again when it does not; a removed entry is refused in both cases.
- `core/src/packStability.test.ts`: the new option.
- `e2e.test.ts`: version 1, then a rebuild, then version 2 with units replaced and every entry ID kept.
- `fixture.ts`: the fake lemmatiser returns an empty list for one form, so the case of §3.1 is always exercised.

## 9. Out of scope

- Second and third meanings of the easy words.
- Coverage of B2 and C1, and the 152 course words the reference puts at C2.
- Setting any level by hand, or from an outside list.
- Asking the lemmas stage again (a `LEMMAS_VERSION` bump).
- The size or the order of units, and the themes.
- Any change in the web app or the server: they read the pack as before.
