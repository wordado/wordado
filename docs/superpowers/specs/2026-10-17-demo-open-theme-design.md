# One open theme in the demo — design

**Date:** 2026-10-17 · **Status:** approved 2026-10-17, built by plan 2026-10-17-demo-open-theme · **Issue:** #290
**Parent spec:** `2026-10-12-trial-by-level-design.md` (the trial), §3.1 (the trial pack) and §4.4 (one unit).
**Related:** #244 (the demo's Themes screen), #289 (what an account gives).

## 1. Why

In the demo every theme is closed. The Themes screen lists the whole course's themes as cards with no page and
no button, each tagged *With an account* (#289). A visitor never sees what a theme does, so themes do nothing to
persuade them to make an account. One theme that works, fully, shows the feature better than any description.

## 2. What the owner decided (2026-10-17)

- **One theme is open in the demo.** The other themes stay closed, as now.
- **The theme is daily life** (`daily-life`). It is set in the pipeline's configuration, not chosen by the
  learner.
- **The whole theme ships**, with no cap. In the published course it has 79 live words (A1 16, A2 36, B1 20,
  B2 5, C1 2), about 40 KB of entries per language: small next to the trial pack.
- Set aside: themes limited to the demo unit's words (tiny, and they would change nothing within one unit), and
  opening every theme (too much of the course).

## 3. Goals, non-goals, anti-goals

**Goals**

- In the demo, the open theme works as it does in an account: its card has the course's buttons, its page
  opens, it can be chosen (*its words come first*) and practised.
- Choosing it, studying it and then signing up keeps everything. The theme stays chosen, and its words keep
  their reviews.

**Non-goals**

- More than one open theme, or the learner choosing which one.
- A cap on the theme's words.
- Native mobile apps.

**Anti-goals** (failures even if it works)

- The demo says something untrue, for example *You have started every word of the demo* while theme words are
  still unstarted.
- A trial pack the device refuses, or one the release cannot check against the course.
- The open theme breaking a trial built before this change, or the trial on the built-in sample (§4.6 of the
  parent spec).

## 4. The trial pack

**Configuration.** `pipeline.json` gains `trial.open_theme`, a theme ID (optional). `trial.probes_per_level`
becomes optional too, so `trial` may hold either field or both. The pipeline checks the following, and the
release fails if one does not hold:

- the ID is a non-empty string;
- it names a theme the course pack defines;
- the course offers that theme (at least `MIN_THEME_SIZE` live words).

**Contents.** With `open_theme` set, the trial pack adds:

- **Entries:** every live, taught entry tagged with that theme, whole, exactly as the course ships it (same
  entry ID, `unit_id`, examples, themes, clips). Retired entries are not added: no learner has answered them in
  a demo before.
- **Clips:** the clips those entries name.
- **Themes:** the definitions of every theme those entries name, beside the ones the pack already has.
- **The marker:** `trial.open_theme: "<id>"`.

**Units.** The units of those entries are **not** added. An entry may therefore name a `unit_id` that is not in
the pack.

**Validation** (`core/src/packValidation.ts`; it runs in the pipeline and on the device). The rule that every
entry's `unit_id` is one of the pack's units gets one exception: an entry tagged with `trial.open_theme`. Every
other check on such an entry stays. `trial.open_theme` must name a theme in `pack.themes`. A pack without the
field validates as today.

**Schema version** (builder's call, made in review). `schema_version` is not raised. The trial pack keeps the
course's version, and older apps are protected by the deploy order of §8. Checked in the code: an app from before
this change refuses the new trial pack in `validatePack` (`unknown unit` on an entry), and `checkFetched` returns
that reason (`client-data/src/packs.ts:65`), so `installPacks` records it in `rejected` and stages nothing
(`packs.ts:103-106`). The installed pack stays active and the demo keeps working. The failure is not shown: the
app acts only on `appUpdateNeeded` (`web/src/app/content.ts:9-11`; callers `web/src/main.tsx:126`, `:196`) and
ignores `rejected`, so such an app neither offers its update nor says why. A device with no pack yet, on an old
app, gets no demo until the app is updated (`web/src/app/boot.ts:381`). Hence §8: the app ships first.

**Release check.** `trialProblems` already compares every trial entry with the course's entry of the same ID,
so the added entries are covered.

## 5. The app in a trial with an open theme

`CorpusTrial` gains `openTheme: string | null` (null when the pack has no marker).

- **Which themes are offered.** In a trial, `offeredThemes` returns the open theme alone, or nothing when there
  is none, instead of always nothing. `trialThemes` (the closed cards) leaves the open theme out.
- **Themes screen.** The open theme's card comes first and is a course card (`ThemeCard`), with the course's
  buttons for its group (*Study this next*, *Practise*, *Back to the path*). Below it, the closed cards as now,
  under their line and link (#244, #289).
- **Theme page.** It opens for the open theme as it does in a course. *Learn this word* is offered on its
  words.
- **Study.** `sessionPlan` uses `activeTheme` in a trial only when it equals the open theme. Any other value
  is ignored, as it is today. The settings may name another theme left over from a setup on the built-in
  sample. If the leftover names the open theme itself, it counts as chosen: the learner chose it, and
  nothing is cleared (builder's call, made in review). With the open theme chosen, its words come first, then the declared level's unit, as in a course. The
  theme's words of every level are served, as in a course.
- **Practice** of the theme works as in a course.
- **Setup.** The Theme step stays out of a trial's setup: the open theme is found on the Themes screen. The
  step is shown today when `offeredThemes` is not empty, which would now be true in a trial, so it needs an
  explicit check.
- **End of the demo** (owner's choice, 2026-10-17). `trialFinished` holds when the declared level's unit has no
  word left to start, and, **only while the open theme is chosen**, the theme has none left either. A chosen
  theme with words left keeps the demo going: those words are what the next session serves. An unchosen theme
  does not hold the end back, since its words are not served.
  - When the demo ends with the open theme **not** chosen, and it still has words to start, the invitation
    adds one line before the account list: *Try a theme too: Daily life is open in the demo.* The theme's name
    is a link to its page. This is the one new text (§7).
  - `trialFinished` therefore reads the settings' `activeTheme` as well as the path.
- **Progress screen.** In a trial, the tiers count the words of the declared level's unit plus the open
  theme's words. The level and unit counts keep to the unit, as now.
- **Search.** A theme word whose unit is not loaded shows its level and its theme. Its theme chip links to the
  theme, since that theme is offered. It names no unit, because the unit's title is not in the pack, and it
  offers *Learn this word*, as the theme page does. The demo's search note counts the words searched, theme
  words included.
- **The path** is unchanged: one unit. Theme words are in no unit there.

## 6. Into an account

Nothing new is built. The settings document carries `activeTheme` with the rest, so the chosen theme stays
chosen. The account's course pack holds the same entries with their units, so the theme words studied in the
demo count on the path as introduced. The parent spec's §4.5 gains a sentence saying so.

## 7. Texts

One new text: the line of §5's end of the demo, with the theme's name as a parameter, in the four interface
languages. Otherwise the open theme uses the course's texts. The Bulgarian, German and Spanish ones wait for a
native reader (#102).

## 8. Rollout

1. The pipeline and the app merge. Nothing changes for a visitor until a release carries a trial pack with
   the marker.
2. **Owner's go-ahead first:** the content repository's `pipeline.json` gets
   `"trial": { "open_theme": "daily-life" }`, its workflows' pinned pipeline commit moves to this change, and a
   release is published.
3. The deployed app must already be the one that accepts the marker (step 1 deployed) before step 2's release
   goes out. Otherwise a device on the old app would refuse the new trial pack.

## 9. Tests

- **Pipeline:**
  - config: the field is optional; a bad ID fails; a theme the course does not offer fails.
  - with the field set, the trial pack holds every live, taught entry of the theme, equal to the course's,
    with their clips and theme definitions, and no added unit.
  - without the field, the pack is the same as before, byte for byte.
- **Core:**
  - validation: a pack with an open theme accepts that theme's unit-less entries, and still refuses a
    unit-less entry of any other theme; it refuses a marker naming an undefined theme.
  - corpus: `openTheme` is loaded; `offeredThemes` and `trialThemes` behave as in §5.
  - `trialFinished`: with the theme chosen, the unit's words and the theme's are both needed. Unchosen, the
    unit alone decides.
- **Client data:** in a trial with the theme chosen, its words come first, then the unit's; another
  `activeTheme` is ignored; the Progress tiers count both sets.
- **App:**
  - the Themes screen shows the open card with its buttons first, then the closed cards;
  - the theme page opens; practice works;
  - the setup has no Theme step in a trial;
  - the demo's end waits for a chosen theme; unchosen, the end shows the line pointing to it;
  - search shows a theme word with its theme and no unit.
- **Browser:**
  - in the trial fixture with an open theme: choose it on Themes, study, and the first new word is a theme
    word; then the closed cards still have no button;
  - the accessibility check on the Themes screen;
  - sign-up keeps the theme chosen (`accounts.spec.ts`, runs in CI).

## 10. Left to the builder

- The exact name and place of the new fields and functions, within the shapes above.
- How the test fixtures (`client-data/src/testing/sample.ts`, `web/e2e/helpers.ts`) build a trial with an
  open theme from the bundled sample.
- Whether the open card shows the course's size of the theme or its live size in the pack. These are the same
  when the whole theme ships.
