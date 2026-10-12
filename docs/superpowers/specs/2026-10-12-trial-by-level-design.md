# The trial at the visitor's level: a level or the test, then one unit — design

**Date:** 2026-10-12 · **Status:** approved 2026-10-12, built by plan 2026-10-12-trial-by-level · **Issue:** #230
**Parent spec:** `2026-09-20-vocabulary-learning-app-design.md`, §5.1 (corpus packs), §7.2 (level path and
placement test), §8.6 (accounts and the demo), §9.3 (content sync).
**Related:** #213 (the placement test opened from the site).

## 1. Purpose

Without an account the app studies a built-in sample: 60 hand-made A1 words in three units. The setup's level
step and the placement test do not show there, because the sample has one level. A visitor above A1 meets only
beginner words and cannot tell whether the course suits them.

Decided by the product owner on 2026-10-12:

1. The trial asks for a level or offers the placement test, as the setup does for an account.
2. The test gives the real level, as reliably as the test after sign-in.
3. The trial then studies **one unit of that level**.
4. When that unit is finished, the visitor is invited to create an account. They can still practise the unit and
   take the test again. Nothing there offers another level's unit.
5. Creating an account opens the whole course. The level step shows once, with the trial's level selected and
   the test on offer. The level can be changed in Settings, as before.
6. The start stays quick and the download small: not the whole course.

Success: a visitor at B1 chooses B1 (or is placed there), studies real B1 words of the course within the first
minute, and after signing up continues the same unit with nothing lost.

## 2. What stays as it is

- The test itself (§7.2): 8 words per level asked, 6 right to pass, a binary search over the levels.
- The level step, the test's screens and Settings. They already show wherever the installed words span more
  than one level.
- The demo's storage and the carry-over (§8.6): a database of its own on the device, attached to the new account
  at sign-up, deleted when the visitor signs in to an existing account or leaves.
- The course's packs. Nothing in them changes, and the pack schema version does not move.
- The built-in sample. It stays for builds that name no content host (local development, the test suites), and
  for nothing else.

## 3. The trial file

### 3.1 What it holds

A release writes, beside the course's files, one **trial pack** per language and one manifest for them:

```
manifest.json            the course (unchanged)
corpus-v<n>-<l1>.pack    the course (unchanged)
trial-manifest.json      new
trial-v<n>-<l1>.trial    new, one per language
audio/                   shared; the trial names only the clips it uses
```

A trial pack is a pack (§5.1) with fewer units and one more field:

- **Units:** for every level the course has, its first unit (the lowest `order` of that level), whole, with its
  entries exactly as the course ships them: the same entry IDs, unit ID, order, examples, themes and clips.
- **Themes:** the definitions of the themes those entries name. Whether one is offered is the app's rule (§8.9),
  as for any pack.
- **`trial`**, an object that only a trial pack has:
  - `probes`: the test's words. For every level, 40 live entries drawn from **the whole level**, each with only
    what a test question needs: `entry_id`, `headword`, `pos`, `sense`, `level`, `translation`.
  - `course`: for every level, how many units and live words the whole course has. The invitation (§4.4) says
    it.

The extension differs from `.pack` so that nothing which handles the course's packs by name (the adopt step,
`last-published/`) takes a trial pack for one.

### 3.2 The draw

The test's quality rests on the probes being a fair sample of the level. The first unit alone would not do: it
is the easiest words of the level, and a test on them would place people too high.

- The draw is uniform over the level's live entries, first unit included.
- It is seeded by the corpus version and the level, so the same release gives the same bytes on every machine,
  as the manifest's checksum needs. A new release draws again.
- Every language gets the same entries, each with its own translation.
- A level with fewer than 40 live entries gives all of them.
- 40 is a setting of the pipeline (`trial.probes_per_level`, default 40).

The test asks 8 words of a level, chosen at random. Eight at random from forty at random is eight at random
from the level: the first test is as reliable as an account's. The one difference is variety on a second and
third take, which 40 words cover.

### 3.3 Size

About 100 unit entries and 200 probes per language. Estimated at well under 100 KB before compression; to be
measured on the first draft release and written here.

### 3.4 What the release checks

- Every level that has a unit in the course has its unit and its probes in the trial pack.
- Every entry and clip a trial pack names is in the course's pack of the same release, with the same content.
- A trial pack validates as a pack, and its `trial` field against its own rules.

A failure is a problem of the release, like any other: nothing is written.

## 4. The app

### 4.1 Which words the trial reads

Without an account the app installs from the trial manifest the build names (`VITE_TRIAL_MANIFEST_URL`, set by
the deploy from the environment's `TRIAL_MANIFEST_URL` variable). A build that names none uses the built-in
sample, as now: local development, the test suites, and a deployment made before the first trial files are
published (§8).

A trial pack has the course's pack ID for its language, so on a device that holds the sample it takes the
sample's place like any newer version of a pack.

The language step downloads the trial pack as it downloads the sample today, with the same progress and the
same *could not download, try again* when it fails. There is no fall-back to the built-in sample when a
download fails: two kinds of trial on one device would need rules for moving between them, and a visitor who has
just loaded the app is online.

Clips are fetched as a learner's are (ahead of need, §9.3), not all at once.

The trial follows new releases like any installed pack (§9.3). Its units are the course's units, so progress
stays with its words.

### 4.2 The setup

With a trial pack installed the words span every level, so the setup shows what an account's setup shows:
Language → **Level** → Theme (when one is offered) → Goal. The level step offers the levels and the test. No
new screen.

### 4.3 The test

When the installed pack has `trial.probes`, the test draws its words from them alone, never from the units'
entries. Wrong options come from the probes and the units' entries together, by the rules a question follows
today.

Probes are test words only. They are not in a unit, a theme, the search, the word lists or any count, and they
are never studied.

### 4.4 One unit

In the trial, study takes new words from **the unit of the declared level only**.

- **Path:** shows that one unit, and under it a line: *This is the demo: one unit of B1. The whole course has
  38 units at B1. Create an account to study all of it.* (numbers from `trial.course`), with the way to sign-up.
- Finishing the unit opens no other. The lower levels' units count as assumed known, as in the course; the
  higher ones are not shown.
- **Practice** of the unit works as everywhere.
- **Themes** are not offered in the trial: a theme would bring in words of the other levels' units.
- **Search** covers the trial's words and says so, as it does for the sample today.
- **Changing the level** in Settings, or taking the test again, changes which unit the trial studies. Words
  already started keep their reviews. Nothing blocks this and nothing advertises it.
- **The end of the unit:** once every word of the unit is started, the done screen and the home screen say so
  and invite: *You have started every word of the demo. Create an account to go on with the whole course.*
  Reviews of the started words keep coming on later days, as now.

### 4.5 Into an account

Sign-up from the trial carries the demo over as today (§8.6). What changes:

- The declared level is carried with the rest, so the account starts at the trial's level, not at A1.
- The level step still shows once on the home screen (`askLevel`, §7.2), now with that level selected and the
  test on offer. Continue ends it.
- The account's device installs the course's pack. The trial unit is the same unit there, with its progress.

Signing in to an existing account, or leaving the trial, deletes the trial's database, as now.

### 4.6 A trial begun on the built-in sample

A device that began the demo before this change holds the sample's words. At its next pack check it installs
the trial pack like any newer pack. Its level is A1 until chosen, and the level step shows once on the home
screen, as it does after a carry-over.

Answers on sample words that the trial pack does not hold are kept and not served: a run already skips a word
its corpus lacks. They go to the account with the rest at sign-up, as they do today.

## 5. Texts

New interface texts (the path's line, the invitation), in the four interface languages. The Bulgarian, German
and Spanish ones wait for a native reader, tracked on #102.

## 6. Changes to the main design

- §5.1: the trial pack and its manifest.
- §7.2: the test draws from `trial.probes` where a pack has them; the note that the demo's sample has one level
  goes.
- §8.6: the demo studies the trial pack; one unit of the declared level; the invitation. *Onboarding budget*:
  the demo needs no account and no test, and downloads one small file.
- §9.3: the trial manifest.
- §16: a revision-log entry.

## 7. Left out

- The test opened by a link from the site (#213). After this it can run without an account; the link and where
  it lands are that issue's.
- A limit on the trial by time or by number of sessions.
- Trial content inside the app bundle. The repository is public and the course's text is not committed to it.

## 8. Rollout

1. Pipeline and app merge. No environment names a trial manifest yet, so the deployed app keeps the built-in
   sample: nothing changes for a visitor.
2. **Operator, with the owner's go-ahead:** the content repository moves to the new pipeline version and
   publishes a release, which carries the trial files. Whether its publish step uploads files it does not know
   by name is to be read before this; if not, that workflow changes first.
3. **Owner:** the environment gets its `TRIAL_MANIFEST_URL` variable, and the app is deployed again. From then
   on a visitor gets the trial at their level.

## 9. Tests

- **Pipeline:** the trial pack holds the first unit of every level, with entries equal to the course's; the
  draw is uniform over the level, the same for the same version, different for the next; a small level gives
  all its words; the release fails when a level has a unit and no probes; the same release twice gives the same
  bytes; the adopt step leaves trial files out.
- **Core:** the test's pool comes from the probes when a pack has them, and from the entries when not; a probe
  is in no unit, theme, search result or count; study in a trial takes new words from the declared level's
  unit only and opens no other.
- **App:** the trial's setup shows the level step and the test; the path shows one unit and the line with the
  course's numbers; a level change moves the unit and keeps reviews; the invitation appears when the unit's
  words are all started; after sign-up the level step shows with the trial's level selected.
- **Browser:** a trial at B1 from the first screen to the first B1 word, with a trial fixture; the test taken
  in the trial; sign-up carries the level and the unit's progress (`accounts.spec.ts`, runs in CI).

## 10. Risks

| Risk | What limits it |
|---|---|
| The probes are a poor sample and place people wrongly | The draw is uniform and tested; 40 per level is a setting |
| The trial pack and the course disagree about a word | The release checks every trial entry against the course's pack |
| The first release with trial files is late | Until the variable of §8 is set, the app keeps the built-in sample |
| The content host is down at a first visit | *Try again* in the language step, as for an account |
