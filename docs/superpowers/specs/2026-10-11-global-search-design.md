# A search for the whole app: find any word of the course — design

**Date:** 2026-10-11 · **Status:** draft for the product owner's review
**Issue:** #144 (milestone Launch).
**Parent spec:** `2026-09-20-vocabulary-learning-app-design.md`, §7.2 (level path), §7.4 (the word-list row and
"Learn this word"), §8 (features), §11.1 (accessibility).
**Builds on:** the Themes search and the theme page of #142 (`core/src/search.ts`, `web/src/screens/Themes.tsx`,
`web/src/screens/Theme.tsx`), which the parent spec does not yet describe.
**Mock screens:** `2026-10-11-global-search-mockups/` (five pictures, drawn with the app's stylesheet; the words
in them are invented).

## 1. Purpose

A learner who meets a word outside the app cannot ask the app about it. The Themes search finds a word only
through a theme, and 174 of the 8,909 words of the current pack are in no theme. The Path has no search at all.

The product owner decided on 2026-10-10 (issue #144): one search for the whole app, not one per screen. The Path
gets no search field; a result links to the word's unit.

Success:

- From any screen with a top bar, the learner reaches a search in one press, types part of a word, a translation
  or a sense note, and sees the matching words of the course, best match first.
- Each result says where the word is (level, unit, themes), links there, and offers the same actions as the
  Path's word row.
- It works offline, with no server change, no pack change and no new dependency.

## 2. Decisions

Made by the product owner on 2026-10-10 and 2026-10-11, in this order.

| # | Question | Decision |
|---|---|---|
| 1 | What the unit link does | It opens the Path at that unit (`/path?unit=<unitId>`), locked or not. |
| 2 | Where the control sits | A magnifier button in the top row, on every screen size. No sixth tab, no field in the bar. |
| 3 | Which actions a result offers | All three on every result: learn this word, I know it, set aside. As the theme page does. |
| 4 | Order and length of the list | Best match first; 30 results, and "Show more" adds 30; a count above the list. |
| 5 | The query in the address | `/search?q=<query>`, replaced in place while typing. The "Show more" position is not kept. |
| 6 | How it is built | A flat word index in `core`, built once per pack, with the ranking in `core` (§3). |
| 7 | The top row signed out on a narrow phone | Under 25rem wide and signed out, the wordmark shows its icon without the name (§5). |

Smaller points, agreed with decision 6:

- A retired word is not found.
- The shortest query is two letters, as in the Themes search (`MIN_QUERY_LENGTH`).
- A theme is a link only when the app offers it (25 words or more, `MIN_THEME_SIZE`); other themes are plain text.
- The listen button behaves as everywhere else: absent when the clip is neither reachable nor downloaded.
- Signed out, search covers the bundled sample, and the nothing-found text says so.
- A locked unit reached from a result is shown as locked. Search adds no way to unlock it.

## 3. The search code in `core`

File: `core/src/search.ts`, tests in `core/src/search.test.ts`.

### 3.1 What is added

```ts
/** One word of the course, ready to be matched. */
interface IndexedWord {
  readonly entryId: string
  readonly level: CefrLevel
  /** The folded headword, whole: for the exact match and the alphabetical order. */
  readonly head: string
  /** The folded tokens of the headword. */
  readonly headTokens: readonly string[]
  /** The folded tokens of the variants, the translations and the sense note. */
  readonly otherTokens: readonly string[]
}

export interface WordIndex {
  readonly words: readonly IndexedWord[]
}

/** Every word of the corpus that is not retired, in the corpus's order. */
export function wordIndex(corpus: Corpus): WordIndex

/** The matching entry IDs, best match first; null when the query is shorter than MIN_QUERY_LENGTH. */
export function searchWordIndex(index: WordIndex, query: string): readonly string[] | null
```

`WordIndex`, `wordIndex` and `searchWordIndex` are exported from `core/src/index.ts`.

### 3.2 Matching

Unchanged from the Themes search. Text is folded with `foldText` (accents removed, lower case). The query is
split into words with `searchWords`. An entry matches when every query word is the start of one of its tokens.

### 3.3 Ranking

Three groups, in this order:

1. The folded headword equals the folded query (the whole query, with single spaces).
2. Every query word is the start of a headword token.
3. Every other match: a variant, a translation or the sense note carries at least one query word.

Inside a group: level from A1 to C1, then the folded headword in code-point order, then `entryId`. The order is
the same on every run and in every interface language.

### 3.4 What changes for the existing search

- The private `entryTokens` is split in two (headword tokens; variant, translation and sense tokens) and stays the
  one place that says what is searchable. `wordIndex`, `searchIndex` and `searchEntries` all use it.
- `searchIndex(corpus)` (the Themes search) builds its theme-shaped index from the same tokens. Its results and its
  existing tests do not change.
- `searchEntries` (the theme page's filter over one theme) keeps its signature and its input order.

### 3.5 In the web app

A helper, `web/src/study/wordIndex.ts`, returns the `WordIndex` of a `Corpus` and builds it once per corpus object
(a `WeakMap` keyed by the corpus). Nothing is stored on the device: the index is rebuilt in memory when a pack
loads.

## 4. The search screen

File: `web/src/screens/Search.tsx`.

### 4.1 Route

- `Route` gains `{ name: 'search'; q: string }`; `parseRoute` reads `/search` and its `q` (absent means `''`);
  `routeHref` writes `q` only when it is not empty.
- `navigate` already takes `{ replace: true }`. Typing calls it with `replace`, so one history entry holds the
  whole typing.
- The screen needs a corpus. With none (before the first pack), it shows nothing, as the Path does.

### 4.2 Layout, top to bottom

1. A heading, "Search" (`h1`).
2. A form with `role="search"`: a labelled field of type `search`, a magnifier inside it, and a clear button when
   the field is not empty. Escape clears the field. The form never submits.
3. A status line with `role="status"`, so a change is announced.
4. The list, `<ul className="panel unit-words search-words">`.
5. "Show more", when more results exist than are shown.

### 4.3 States

| State | Status line | Under it |
|---|---|---|
| Empty field | none | A hint: find any word of the course by the word, its translation or its note. |
| One letter | "Type at least two letters." | nothing |
| No match | "No word in the course matches “…”." | Signed out: "The sample has {count} words. Sign in to search the whole course." |
| Matches | "1 word" / "{count} words" (the full count, not the number shown) | The first 30 rows; "Show more" adds 30. |

The field's value is applied to the list through `useDeferredValue`, so typing stays responsive while rows redraw.
A new query resets the list to 30.

### 4.4 Focus

- Arriving with an empty query (the magnifier): the field takes focus after the shell has focused `main`.
- Arriving with a query (Back from a unit or a theme, or a link): focus stays on `main`, as after any navigation.
- "Show more": focus moves to the first new row's first control.
- Clearing with the clear button: focus returns to the field.

### 4.5 A result row

`WordRow` gains an optional `where` slot (a `ReactNode`). The Path and the theme page do not pass it and do not
change. The search passes a line with:

- the level, as a small tag (`A1` … `C1`);
- the unit's title, a link to `/path?unit=<unitId>`; when the unit is locked, a lock icon before the title and
  "locked" in its accessible name;
- each theme of the word: a link to `/themes/<themeId>` for an offered theme, plain text for any other.

The row keeps, from `WordRow`: the listen button, the headword, the translation with its sense note, the standing
mark, and the ⋯ menu. The row is rendered with `learn`, so a word never started offers "Learn this word"
whatever its unit or level (decision 3).

Styles: the list reuses the word-list rules through `unit-words`, as the theme page does, with `search-words` for
its panel padding. The `where` line takes the full width under the word; on a phone it is the row's third grid
line, starting under the word.

### 4.6 The link from the Themes search

The Themes search's "in no theme" line becomes a link to `/search?q=<the same query>`. Its "+N more" text stays
as it is.

## 5. The top-bar button

File: `web/src/app/App.tsx` (and a small `SearchButton` beside `LanguageMenu`).

- A `Link` to `{ name: 'search', q: '' }`, drawn as a round button the size of the language button (2.75rem), with
  a magnifier icon. It stands first in `.masthead-actions`, before the language button.
- Accessible name: "Search". `aria-current="page"` on the search screen.
- Not rendered during the first-run setup. The study, practice, matching and placement screens have no masthead,
  so it is absent there.
- **Narrow phone, signed out.** At 360px the wordmark, the three controls and their gaps need about 357px, and
  328px are free; "Sign in" wraps. So under 25rem wide, when the account control is the "Sign in" button, the
  wordmark's name is hidden and its icon stays. The link keeps its accessible name. "Sign in" does not wrap
  (`white-space: nowrap`). Signed in, the row fits and nothing changes.
- No keyboard shortcut.

## 6. The Path opens at a unit

Files: `web/src/router.tsx`, `web/src/screens/Path.tsx`.

- `Route`'s `path` member gains an optional `unit: string | null`; `parseRoute` reads `?unit=`; `routeHref`
  writes it when set. `/path` alone behaves as today.
- Each unit's `<li>` gets `id="unit-<unitId>"`, and its `<h3>` gets `tabIndex={-1}`.

When the Path renders with a unit ID that names a unit of the corpus, it does this once per arrival (once per
change of the route's unit):

1. Opens the unit's level (`levelChoice`), whatever level is being studied.
2. If that level is the studied one, shows what the short view hides: the finished units (`doneOpen`) when the
   unit is among them, or every unit (`showAll`) when it lies beyond the next few.
3. Opens the unit's word list (`openUnits`).
4. After the render, scrolls the unit into view and focuses its `<h3>`. With `prefers-reduced-motion: reduce` the
   scroll does not animate. This focus runs after the shell's focus on `main`.

Rules:

- Afterwards the learner folds and unfolds freely; the Path does not return to the unit by itself.
- The address keeps `?unit=`: a reload, or Back to the Path, lands on the same unit.
- A locked unit is drawn as today (its status, its word list). Nothing new unlocks it.
- An ID that names no unit is ignored.
- The Path's word rows keep their own rule for "Learn this word" (a skipped level's unit only). Only the search
  and the theme page offer it everywhere.

## 7. Strings

New keys under `search.*` in `web/src/i18n/en.ts`, `bg.ts`, `de.ts` and `es.ts`:

| Key | English |
|---|---|
| `search.open` | Search |
| `search.title` | Search |
| `search.label` | Search the course |
| `search.placeholder` | A word, a translation or a note |
| `search.clear` | Clear |
| `search.hint` | Find any word of the course: by the word, its translation or its note. |
| `search.tooShort` | Type at least two letters. |
| `search.found` | `{ one: '{count} word', other: '{count} words' }` |
| `search.none` | No word in the course matches “{query}”. |
| `search.sample` | The sample has {count} words. Sign in to search the whole course. |
| `search.more` | Show more |
| `search.unitLocked` | {title}, locked |

The Bulgarian, German and Spanish texts are written with the build and are not checked by a native reader. The
keys are listed on issue #102, which tracks that check. The parity test (`web/src/i18n/i18n.test.tsx`) fails if a
language lacks a key.

## 8. Testing

**`core/src/search.test.ts`**

- Each ranking group; the order inside a group (level, then headword, then ID).
- Accents and capitals, in the query and in the word.
- A query of several words; a query under two letters returns `null`.
- A retired word is not found.
- `searchThemes` and `searchEntries` return what they returned before.

**`web/src/router.test.tsx`:** `/search`, `/search?q=`, `/path?unit=` parse and print back.

**`web/src/screens/Search.test.tsx`**

- The four states of §4.3, signed in and signed out.
- A row's `where` line: level, unit link, an offered theme as a link, a small theme as text, a locked unit.
- "Learn this word" from a result's menu marks the word.
- Typing replaces the address and adds no history entry.
- "Show more" adds 30 and moves focus.

**`web/src/screens/Path.test.tsx`:** arriving with a unit of another level opens the level and the word list and
focuses the unit; a unit hidden by the short view is shown; an unknown ID changes nothing.

**App and Themes:** the button is present on a normal screen, absent in the setup, current on the search screen;
the "in no theme" line links to the search.

**Browser (`web/e2e/demo.spec.ts`, the 60-word sample)**

- Open the search from the magnifier, type, see the count and the ranked rows.
- Follow a unit link: the Path shows that unit, focused. Back: the same query and rows.
- Follow a theme link to the theme page.
- Mark a found word "Learn this word".
- Nothing found shows the sample line.
- `expectAccessible` on the search screen, at a phone size and a wide size.
- At 360px, signed out, no control of the top row wraps or is clipped.

**Not automated:** the list at full pack size. The index build and one query are timed once by hand on the
current pack and the numbers go into the pull request.

## 9. Documents

- The parent spec gets a section in §8 on search: this design in short, and the Themes search and theme page of
  #142, which it never described. §7.4 is corrected where it limits "Learn this word" in lists to a skipped
  level's unit: the theme page and the search offer it for any word. §16 gets a revision-log entry.
- Issue #144 carries the decisions of §2, a link to this file, and the plan as a checklist.

## 10. Delivery

One branch (`feat/global-search`) and one pull request that closes #144, built in this order:

1. `core`: the word index and the ranking.
2. The router: `search`, and `unit` on `path`.
3. The Path opens at a unit.
4. The search screen and the row's `where` slot.
5. The top-bar button and the narrow signed-out row.
6. The link from the Themes search.
7. Strings in four languages.
8. Browser tests and the parent spec.

## 11. Left out

- Words that are not in the course.
- Search history and suggestions.
- A keyboard shortcut for the search.
- Highlighting the matched letters in a result.
- Keeping the "Show more" position in the address.
- Any change to the server, the pack format or the pipeline.
