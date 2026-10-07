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

The review app's wordmark adds "review" after the name: a smaller word in the interface typeface
(`var(--font-ui)`, `var(--ink-soft)`, weight 500). The whole mark reads "Wordado review".

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
  fit, the way back shows as "Back" in the header; the button's name stays "Back to my assignments".
