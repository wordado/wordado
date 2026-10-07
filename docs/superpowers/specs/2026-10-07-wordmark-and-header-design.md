# The wordmark, the review app's icon and its header

Date: 2026-10-07. Decided with the product owner from mockups. Revises the "Header" line of §3 in
[2026-10-06-review-app-look-design.md](2026-10-06-review-app-look-design.md).

## 1. The wordmark

One wordmark in the learner app (`web/`), the review app (`review-app/`) and the marketing site (a separate
repository, which follows the same rule).

- **Icon first**, then the name.
- **Two colours where there is room:** "Word" in ink (`var(--ink)`), "ado" in rose (`var(--rose)`), light and dark.
- **One colour otherwise:** where two cannot be used (`forced-colors: active`, print, a one-colour mark), "ado"
  takes the colour of "Word".
- **Serif:** `var(--font-entry)` (Literata Variable), weight 600, letter-spacing -0.01em.
- **Plain in running text:** in sentences, titles and emails the name is plain "Wordado". Only the header
  wordmarks are in two colours.
- **One word to a screen reader:** the text is `Word<span class="wordmark-ado">ado</span>`, so the name reads as
  "Wordado", not as two items. The icon beside it has an empty `alt`.

The review app's wordmark adds "review" **under** the name, as a stacked lockup: the icon, then a block of two
lines, "Wordado" and directly under it "review" in the interface typeface (`var(--font-ui)`, 0.72rem, weight 500,
`var(--ink-soft)`), starting at the left edge of the "W". The two lines together are as tall as the icon (1rem and
0.75rem of line beside a 1.75rem icon), so the header keeps its height. The whole mark reads "Wordado review", one
phrase. On a phone's review screen "review" is left out, as before.

## 2. The review app's icon

The Wordado icon with the colours turned round: a rose square, a white W, a navy dot (`review-app/public/icon.svg`).
It differs so that a review tab is told apart from a learner app tab at a glance; the shape stays, so it is still
Wordado's.

- The same file is the tab's icon and the icon in the header.
- `apple-touch-icon.png` (180×180) is drawn from the SVG with the rose filling the whole picture, since iOS rounds
  the corners itself: `pnpm --filter @wordado/review-app icons`.
- The page's theme colours are the page backgrounds, light and dark.
- The rose square stands out from the dark header on its own; it needs no hairline as the learner app's navy
  square does.

## 3. The review app's header

- The bar's background and bottom border span the window. What is in it sits in a centred column of **60rem**, the
  width of the learner app's masthead.
- `.page.wide` (the admin pages) is 60rem too, so the tabs line up with the tables under them. `.page` (the review
  card, the assignments list) stays 48rem, centred.
- Below 40rem nothing changes: the header fills the screen.
- The review screen's header carries the most. From 60rem up it is one line; between 40rem and 60rem it wraps. To
  fit, the way back shows as "Back" in the header; the button's name stays "Back to my assignments". (Measured
  again with "review" under the name and the account as a circle: at 1280px the full label still needs about 90px
  more than the column has beside "Bulgarian translations · flagged rows", so it stays "Back".)
- The local mode's header holds only the mark, **All rows**, **Import decisions** and the account. Its queue picker,
  *show unflagged* and "n open in all" are a slim toolbar at the top of the review column (48rem), above the
  card's progress line, on a phone too (the picker takes the whole line there). The header had no room for them
  in 60rem.

## 4. The account: a circle and its menu

Added 2026-10-07. Where the header showed the signed-in name as text, it shows a round button with the person's
initials (`AccountMenu`), on every screen and on a phone too, at the right end of the header.

- **Initials** (`initials(name)`): the first letter of the first word and of the last word, upper-cased; one word
  gives one letter. Words are split on whitespace (a hyphen is part of a word); a word's letter is its first
  Unicode letter, so quotes and brackets are skipped; a name without a letter gives "?". "Anna Schmidt" → "AS",
  "Мария Петрова" → "МП", "'Quoted' Name" → "QN".
- **The button:** a 2.25rem circle, `var(--paper-inset)` with a `var(--rule)` border, the initials in `var(--ink)`,
  weight 600, the focus ring of the other buttons. Its name is "Account: <full name>"; it has
  `aria-haspopup="menu"` and `aria-expanded`.
- **The menu** hangs under the button, its right edge on the button's, never wider than the screen: the full name
  (bold), the email under it (muted), a rule, then the actions.
  - Hosted: **Sign out**, a plain link to `/cdn-cgi/access/logout`, Cloudflare Access's sign-out on the protected
    host: the browser leaves the app.
  - Local: no actions and no email. The menu shows the name and "Running on this computer."
- **Behaviour:** a click, Enter or Space opens and closes it; the down arrow opens it and goes to the first
  action. Escape and a press outside close it and give the focus back to the button (a press on another control
  leaves the focus there). It closes when the focus goes elsewhere, so the row list or a dialog opening closes it.
  While it is open the review keys (1–4, S, L, the arrows) do nothing: the menu marks itself `data-menu-open`,
  which `useKeys` looks for beside an open dialog.
- **On a phone** the review header stays one line at 390px: icon and name, the row list, **Submit n**, the circle.
  For the local mode's header to do the same, **Import decisions** shows as "Import" there; the button's name
  stays "Import decisions".
- `AppHeader` takes `account?: { name; email?; signOutHref? }` in place of `who`. The hosted mode fills it from
  `/api/me`, the local mode from the reviewer's name.
