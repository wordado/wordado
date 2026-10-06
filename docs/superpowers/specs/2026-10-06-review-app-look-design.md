# Review app: look and layout — design

Date: 2026-10-06. Status: approved by the product owner in brainstorming (mockups in
`2026-10-06-review-app-look-mockups/`).
Revised 2026-10-06: §4.2 and §5 follow the rulings made during the build (what is struck under *Now*, when an
objection has a tick, when the reviewer shows, the way back on a phone; how the Overview counts, the review-data
listing, errors in a dialog) and the final review (a level row's sense, the focus after a dialog, a failed load, no
row list during an edit).
Builds on: `2026-10-05-hosted-review-app-design.md` §9 (UI) and `2026-10-04-ai-review-and-review-app-design.md` §5.2.

## 1. Purpose

The review app works but looks unfinished: browser-default buttons and inputs, the translation as plain text lines,
a narrow one-column admin page, no phone layout. Reviewers spend hours on the review screen, and the coordinator
asks "how far is each language?" many times a day. This change gives the app the learner app's look and a layout
built for those two jobs. Nothing behind the screens changes: the API, the keys, Submit and the local mode stay as
they are.

## 2. Decisions

| Question | Decision |
|---|---|
| Look | The learner app's: its tokens (`web/src/styles.css` `:root`, light and dark), Golos Text for the interface, Literata for the English word and example, white panels on the paper, rose for the one main action of a screen |
| Dark mode | The review app's own dark colours: deeper navy in three clear layers (page, card, box in a card), stronger borders, a soft lift under cards, brighter accents. The learner app's dark colours, copied at first, left the nested screens flat (decided 2026-10-06 from three mockups). Light mode is the learner app's unchanged |
| A colour of its own for the review app | No (tried in mockups, rejected): same scheme as the learner app, no accent of its own, no "REVIEW" tag |
| Coloured decision buttons | No (tried, rejected): **Accept fix** is the one primary (rose) button; Keep, Edit, Drop are plain |
| Review screen | Layout B: one row at a time in a centred card with a progress bar; "Now" beside "AI suggests"; the row list in a drawer |
| Admin | Tabs: Overview, Reviewers, Assignments, Submissions; forms in a dialog |
| Phones | Reviewer screens fully usable on a phone; admin usable, designed for a laptop |

## 3. Shared look

- **Tokens:** the learner app's colour, type-scale and spacing variables, copied into `review-app/src/app.css` with
  the same names (`--paper`, `--paper-raised`, `--ink`, `--ink-soft`, `--rule`, `--rose`, `--rose-ink`,
  `--rose-soft`, `--leaf`, `--leaf-soft`, `--leaf-ink`, `--amber`, `--amber-soft`, `--blue`, `--blue-soft`,
  `--font-ui`, `--font-entry`, `--step-*`, `--space-*`), light (`prefers-color-scheme`); the dark values are the review app's own (§2), with three more tokens: `--paper-inset` (a box inside a card), `--paper-head` (the header) and `--lift` (a card's shadow), which in the light equal the card and no shadow. The old
  `--bg/--fg/--muted/--border/--panel/--accent` names go.
- **Fonts:** `@fontsource-variable/golos-text` and `@fontsource-variable/literata` (already used by `web`), imported
  in `main.tsx`.
- **Components (CSS classes, no component library):** `.button` (plain, pill-shaped in headers and lists),
  `.button.primary` (rose), `.button.ghost`, `.button.danger` (rose outline, for Disable/Close/Drop confirmations),
  `.panel`, `.eyebrow` (small uppercase label), `.chip` (`.major` rose, `.minor` amber, `.report` blue, `.ok` leaf,
  `.off` grey), `.note`, `.field` (label above control; inputs and selects styled, 1rem text so phones do not zoom),
  `.segmented`, `.settings-rows`/`.settings-row`, `.progress` (a bar with a leaf part for decided and a blue part
  for submitted), `.tabs`, `.dialog` (native `<dialog>`, full-screen below 40rem), `.notice`.
- **Header (`AppHeader`):** "Word**ado** review" (the "ado" in rose), then what the screen passes in (breadcrumb,
  tabs, actions), then the signed-in name. One component for the local and the hosted mode.
- **Focus rings** as in the learner app (`2px solid var(--rose)`, offset 2px). Every control keeps a visible label
  or `aria-label`.

## 4. Reviewer

### 4.1 Your assignments

A page titled **Your assignments** with one row per open assignment: a plain name, a note line, a progress bar and
one button.

- **Name:** `queueLabel(queue)` + scope: "German translations · flagged rows", "German unit titles · flagged rows",
  "English levels · flagged rows", "German translations · 12 files" (all rows). `queueLabel`: `translation-<l1>` →
  "<Language> translations", `title-<l1>` → "<Language> unit titles", `level` → "English levels"; languages from
  `LANGUAGE_NAMES` (bg Bulgarian, de German, es Spanish). The raw queue name stays as the row's `title` attribute.
- **Note:** "741 rows · 212 decided · 60 submitted" (zero parts left out; "none decided yet" when nothing is).
- **Button:** **Continue** (primary) when anything is decided or submitted, else **Start**.
- Below: one line with the keys (1 accept, 2 keep, 3 edit, 4 drop, S skip).
- No snapshot: "The review data is not available yet." No assignments: "Nothing is assigned to you yet."

### 4.2 Reviewing (layout B)

One row at a time, in a centred column (max 48rem):

1. **Progress line:** a bar and "13 of 624" (position among the shown rows), and the row's chip (`report`, `major`,
   `minor`).
2. **The card:**
   - eyebrow: part of speech · level · English sense (`pos`, `level`, `sense_en`); for a title row: level · "unit
     title"; for a level row: part of speech · "level" · English sense (the sense says which meaning is being
     graded). Parts that are empty are left out;
   - the word in Literata (`headword`; a title row shows the unit's key), the example in Literata italics-free
     quotes, a title row's `words`, a level row's frequency band;
   - **Now** beside **AI suggests** (stacked below 40rem). *Now* lists the row's fields (translation, alternates,
     sense; title_en, title_l1; level) with their current values; a value is struck through in rose when a ticked
     fix replaces it (not merely because an objection targets its field; an empty field a fix fills has nothing to
     strike). *AI suggests* (leaf border and background) lists the same fields with the ticked fixes applied,
     changed values in bold. With no objections there is no *AI suggests* box and *Now* takes the full width;
   - **the objections:** one line each: a chip with the category and the reason. When the row has two or more
     objections in all, every line has a tick and names its field and fix, so the reviewer can take one field's fix
     and leave another's; at most one fix per field is ticked (the existing rule). A row with a single objection has
     no tick: Accept or Keep is the choice. The reviewer and model show as a muted suffix when more than one
     reviewer objected on the row;
   - **learner reports** (when any) in a blue-tinted box above the objections;
   - **other senses** of the word as one muted line each;
   - the stale-file notice, as today;
   - **Note for the coordinator:** a one-line input, collapsed behind "Add a note" until used.
3. **Actions:** four large buttons in a row (two by two below 40rem, fixed to the bottom of the screen on a phone):
   **Accept fix** `1` (primary; disabled without objections, and then **Keep** is the primary), **Keep as it is**
   `2`, **Edit** `3`, **Drop** `4` (only where the queue has drop). Under them, muted: "Skip S · previous ↑ ·
   next ↓". While a decision saves, the buttons are disabled.
4. **Editing** (Edit, or key 3): the *Now*/*AI suggests* boxes give way to one labelled input per field, prefilled
   with the ticked fixes; **Save** (primary, key 3 again) and **Cancel** (Escape). On a phone it fills the screen.
5. **All rows** (header button, key `L`): a drawer from the left (a full-screen sheet on a phone) with the level and
   severity filters and the row list (key, level, chip, the decision when decided); choosing a row closes it. On a
   phone the header has no room for what is reviewed and for **Back to my assignments**: both are in the row list.
   The local mode's queue picker and *show unflagged* live in the header as today. While a row is being edited the
   row list is off (the button is disabled, `L` does nothing): choosing another row would drop the edit. When the
   drawer or a dialog closes, the focus goes back to what opened it.
6. **Header actions:** hosted: **Submit n decisions** (primary when n > 0) and the name; local: **Import
   decisions**. After a submit: a notice with the pull request link and any left-out rows with their reasons.
7. **Done state:** "Nothing left to decide here." with **Submit** (hosted) or **Import decisions** (local) and
   **Back to my assignments**. When the rows could not be loaded at all it is not the done state: the error, "The
   rows could not be loaded." and **Try again** (and the way back), without Submit or Import.
8. **Phone gestures:** swipe left for the next undecided row, right for the previous (horizontal movement over
   60px that is larger than the vertical one). Keys are unchanged.

Decided rows are skipped by next/previous as today; a decided row opened from the list shows its decision as a chip
on the card and can be decided again until submitted.

## 5. Admin

Tabs in the header: **Overview**, **Reviewers**, **Assignments**, **Submissions**, plus **My assignments** (back
to the reviewer view). The tab is kept in the URL hash (`#overview`, `#reviewers`, …) so a reload stays put.

- **Overview:** four numbers (rows to decide, decided and not submitted, pull requests open, active reviewers;
  "rows to decide" sums the flagged and the reported rows of every file, so a row that is both counts twice: the
  review data carries no count of their union), then
  **By language**: one row per language with open rows (Bulgarian, German, Spanish, English levels): "741
  translations · 8 titles · Anna, Hans", a progress bar over that language's flagged rows, and a chip (*on track*
  when someone is assigned, *done* when nothing is left) or an **Assign** button when nobody is. Then the snapshot
  line ("Review data built <time> from commit <7 chars>"). The per-file listing of the review data is not on the
  page: the files and who holds them show in the Assign dialog.
  All of it is computed in the browser from what the API already returns (`/api/admin/snapshot`,
  `/api/admin/assignments`, `/api/admin/submissions`, `/api/admin/reviewers`); no API change.
- **Reviewers:** **Invite a reviewer** (primary) opens a dialog (email, name, languages, admin). A row per person:
  name, languages, status chip (*invite not sent*, *disabled*), and **Resend invite**, **Edit** (languages, in a
  dialog), **Disable**/**Enable**.
- **Assignments:** **Assign work** and **Split a queue** open dialogs (the current forms). Open assignments as
  rows: plain name, reviewer, progress bar and counts, **Reassign…** (dialog) and **Close**; closed ones under
  "Closed" with **Reassign…**.
- **Submissions:** rows with reviewer, plain queue name, counts, status chip, link.
- One page notice (`<p role="status" class="notice">`) for errors, as today; it goes when the tab changes. An action
  that fails inside a dialog keeps the dialog open and repeats the message there (the page's notice is behind it).
  Confirmations stay `window.confirm`.

## 6. Kept as is

- Every accessible name the tests and the two browser runs use: the forms' `aria-label`s (*Invite a reviewer*,
  *Assign*, *Split a queue*), labels (*Email*, *Name*, language names, *Reviewer*, *Queue*, *All files*), buttons
  (*Invite*, *Assign*, *Propose*, *Create these assignments*, *Disable <name>*, *Admin*), `article` *Row <key>*, the
  list *Rows*, *Accept fix*, *Keep*, *Skip*, *Import decisions*, *Submit n decision(s)*, `p.notice`. Where a visible
  label changes (e.g. "Keep as it is"), the old name must still match the tests' patterns (`/Keep/`).
- The API, `hostedApi`, `api`, the keys (1–4, S, ↑, ↓), the one-fix-per-field rule, saving and reload behaviour.

## 7. Testing

- Existing unit tests and both browser runs stay green; tests are updated only where the structure they assert
  changed (e.g. the list now being in a drawer), never weakened.
- New unit tests: `queueLabel`; the Overview's per-language numbers from sample API data; the *Now*/*AI suggests*
  values for one and for two objections on a field; Keep becoming primary without objections; the drawer opening
  with `L` and closing on choosing a row; the swipe handler (left → next, right → previous, vertical ignored).
- The hosted browser run gains a phone project (viewport 390×844): a reviewer decides a row with the bottom
  buttons and opens the row list.
- Screenshots of every screen and dialog of both modes in light and dark, desktop and phone, are produced by a
  script (`pnpm --filter @wordado/review-app screenshots`) for the pull request description; they are not committed.

## 8. Out of scope

Translating the interface (it stays English); a logo; changing the learner app; keyboard shortcuts beyond `L`;
admin tables tuned for phones beyond stacking.
