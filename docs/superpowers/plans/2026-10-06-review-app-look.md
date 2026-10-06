# Review App Look and Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the review app (local and hosted) the learner app's look, a one-row-at-a-time review screen, a
tabbed admin with an overview, and phone layouts, without changing anything behind the screens.

**Architecture:** One stylesheet (`review-app/src/app.css`) carries the learner app's tokens and a small set of
component classes; React components keep their data flow and accessible names and change their markup. The shared
`ReviewScreen` is rebuilt around a row card and a drawer; the hosted admin page becomes tabs with dialogs. No API,
Worker or server change.

**Tech Stack:** React 19, TypeScript strict, Vite 8, plain CSS (no library), Vitest 5 with @testing-library/react in
happy-dom, Playwright 1.63, oxlint `--deny-warnings`.

**Spec:** `docs/superpowers/specs/2026-10-06-review-app-look-design.md`. Mockups (open in a browser; they are
the visual reference for every task): `docs/superpowers/specs/2026-10-06-review-app-look-mockups/` —
`1-review-screen-A-and-B.html` (**use layout B, the second mockup, in its colours**), `2-assignments-and-admin.html`
(**admin option A, tabs**), `3-phone-reviewer.html`, `4-phone-admin.html`.

## Global Constraints

- Only `review-app/src/**`, `review-app/e2e/**`, `review-app/index.html`, `review-app/package.json`,
  `review-app/playwright*.config.ts`, `review-app/scripts/**` and `pnpm-lock.yaml` change. Nothing under
  `review-app/worker`, `review-app/server`, `review-app/shared` (except adding pure UI helpers is NOT allowed there
  either: put them in `src/`).
- New dependencies: `@fontsource-variable/golos-text` ^5.3.0 and `@fontsource-variable/literata` ^5.3.0 only.
- Colours: the learner app's scheme exactly (tokens from `web/src/styles.css` `:root`, light and dark). No accent
  of its own, no "REVIEW" tag. **Accept fix** is the one primary (rose) decision button; Keep, Edit, Drop are plain.
- Accessible names in spec §6 stay as they are; where a visible label changes, existing test patterns must still
  match. Tests are updated only where the structure they assert changed, never weakened.
- Keys unchanged: 1 accept, 2 keep, 3 edit/save, 4 drop, S and ↓ next, ↑ previous; new: `L` opens the row list,
  Escape closes a drawer/dialog/edit. Keys do nothing while typing in a field.
- Inputs and selects use at least 1rem text (no zoom on phones). Breakpoint for stacked/phone layouts: 40rem.
- Interface text is English, plain and short. No real email addresses; fixtures use `example.com`.
- Commits use `11029931+danchom@users.noreply.github.com`.
- Before every commit: `pnpm --filter @wordado/review-app test`, `pnpm --filter @wordado/review-app typecheck`,
  `pnpm lint`; before the last commit of a task that touches screens the browser runs cover:
  `pnpm --filter @wordado/review-app e2e` and `e2e:hosted`.

## Review Focus

1. **A row with two objections on one field and one on another:** *AI suggests* shows exactly the ticked fixes, and
   Accept sends them. Test in Task 2.
2. **A row with no objections** (full review of rows the AI passed): no *AI suggests* box, Accept disabled, Keep is
   the primary. Test in Task 2.
3. **Typing in the note or an edit field must not trigger 1–4, S, L or a swipe.** Test in Task 2 (keys) and Task 3
   (swipe starting on an input).
4. **Long values** (a 60-character translation, five alternates, a long objection reason) wrap inside the card on a
   390px screen without horizontal scrolling. Checked in Task 3's phone run (assert `scrollWidth <= clientWidth`).
5. **Dark mode:** every new class reads its colours from tokens (no hex colours outside `:root`). Checked in Task 1
   by a test that scans `app.css`.

---

### Task 1: Tokens, fonts, components and the shared header

**Files:**
- Modify: `review-app/package.json` (the two font packages), `pnpm-lock.yaml`, `review-app/src/main.tsx` (font
  imports), `review-app/src/app.css` (rewritten), `review-app/index.html` (title "Wordado review", `lang="en"`,
  viewport meta if missing)
- Create: `review-app/src/AppHeader.tsx`, `review-app/src/labels.ts`, `review-app/src/labels.test.ts`,
  `review-app/src/app.css.test.ts`
- Modify (class names only, no behaviour): `App.tsx`, `Root.tsx`, `hosted/HostedApp.tsx`, `hosted/Assignments.tsx`,
  `hosted/Admin*.tsx`, `ReviewScreen.tsx`, `RowView.tsx`, `RowList.tsx`, `Objections.tsx`

**Interfaces:**
- Produces:
  - CSS tokens and classes per spec §3: `.button` `.primary` `.ghost` `.danger`, `.panel`, `.eyebrow`, `.chip`
    (+ `.major` `.minor` `.report` `.ok` `.off`), `.note`, `.field`, `.segmented`, `.settings-rows`, `.settings-row`
    (+ `-title`, `-text`), `.progress` (children `.decided`, `.submitted` with inline width), `.tabs`, `.dialog`,
    `.notice`, `.page` (centred column, max 48rem), `.page.wide` (max 72rem)
  - `AppHeader(props: { children?: ReactNode; who?: string })` → `<header class="app-header">` with the wordmark
    (`Word<b>ado</b> review`), the children, and the name
  - `labels.ts`: `queueLabel(queue: string): string`, `scopeLabel(a: { files: readonly string[] | '*'; flaggedOnly: boolean }): string`,
    `assignmentLabel(a): string` (= `${queueLabel} · ${scopeLabel}`)

- [ ] **Step 1: Failing tests**

`src/labels.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { assignmentLabel, queueLabel, scopeLabel } from './labels'

describe('labels', () => {
  it('names queues in plain words', () => {
    expect(queueLabel('translation-de')).toBe('German translations')
    expect(queueLabel('title-bg')).toBe('Bulgarian unit titles')
    expect(queueLabel('level')).toBe('English levels')
    expect(queueLabel('something-else')).toBe('something-else')
  })
  it('names an assignment’s scope', () => {
    expect(scopeLabel({ files: '*', flaggedOnly: true })).toBe('flagged rows')
    expect(scopeLabel({ files: '*', flaggedOnly: false })).toBe('all rows')
    expect(scopeLabel({ files: ['a', 'b'], flaggedOnly: false })).toBe('2 files')
    expect(scopeLabel({ files: ['a'], flaggedOnly: true })).toBe('flagged rows in 1 file')
    expect(assignmentLabel({ queue: 'translation-es', files: '*', flaggedOnly: true })).toBe('Spanish translations · flagged rows')
  })
})
```

`src/app.css.test.ts` (dark mode can only work when colours come from tokens):

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(join(import.meta.dirname, 'app.css'), 'utf8')

describe('app.css', () => {
  it('uses colour tokens everywhere outside :root', () => {
    const withoutRoot = css.replace(/(?:@media \(prefers-color-scheme: dark\) \{\s*)?:root \{[^}]*\}\s*\}?/g, '')
    expect(withoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([])
  })
  it('has the learner app’s tokens, light and dark', () => {
    for (const t of ['--paper', '--paper-raised', '--ink', '--ink-soft', '--rule', '--rose', '--leaf', '--blue', '--font-ui', '--font-entry']) expect(css).toContain(`${t}:`)
    expect(css).toMatch(/prefers-color-scheme: dark/)
  })
})
```

(The `ui` Vitest project already includes `src/**/*.test.ts`; `app.css.test.ts` reads a file, so add
`// @vitest-environment node` as its first line.)

- [ ] **Step 2: Run them, see them fail** — `pnpm --filter @wordado/review-app test -- --project ui`.

- [ ] **Step 3: Implement**
  - Add the two font packages; import them at the top of `main.tsx`.
  - Rewrite `app.css`: copy `:root` (light) and the dark `:root` from `web/src/styles.css` (colours, fonts, steps,
    spaces, `--radius`), then the base (`body` on `--paper`, `--font-ui`, `--ink`), then the component classes
    listed above, taking sizes and radii from the mockups (pill buttons in headers and lists, 0.875rem-radius large
    buttons for decisions, 1.125rem-radius panels). Shadows and translucent overlays use `rgb(… / alpha)` built
    from tokens or `color-mix`, never hex.
  - `AppHeader`, `labels.ts`.
  - Apply classes to the existing markup **without restructuring it**: every `<button>` gets `button` (+ `primary`
    for the screen's main action: Import decisions, Submit, Invite, Assign, Create these assignments, Start), every
    form control sits in a `.field`, list containers use `.settings-rows`, both apps render `AppHeader`. The old
    class names that the rebuilt screens will drop in later tasks may stay until then.
  - Remove the old tokens and any rule that no markup uses.

- [ ] **Step 4:** all unit tests, typecheck, lint, `e2e` and `e2e:hosted` pass. Open the mockups and the running
  app (`pnpm --filter @wordado/review-app e2e:hosted` leaves nothing running; for a manual look use
  `pnpm exec tsx e2e/hosted/start.ts` and the tokens in `.e2e/tokens.json`) and compare buttons, panels and type.

- [ ] **Step 5: Commit** — `feat(review-app): the learner app's look: tokens, fonts, components, header`

---

### Task 2: The review screen, layout B

**Files:**
- Create: `review-app/src/RowCard.tsx` (replaces `RowView.tsx`'s panel), `review-app/src/Compare.tsx` (Now / AI
  suggests), `review-app/src/RowDrawer.tsx`, tests beside each
- Modify: `review-app/src/ReviewScreen.tsx`, `review-app/src/RowView.tsx` (keep `applyFixes`, `firstPerField` and
  the decide logic; the component is renamed/moved into `RowCard.tsx`, `RowView.tsx` keeps the pure helpers and
  their tests), `review-app/src/RowList.tsx` (used inside the drawer), `review-app/src/Objections.tsx`,
  `review-app/src/App.tsx`, `review-app/src/hosted/AssignmentReview.tsx`, `review-app/src/app.css`
- Modify tests: `App.test.tsx`, `RowView.test.tsx`, `hosted/HostedApp.test.tsx`, `e2e/review.spec.ts`,
  `e2e/hosted/hosted.spec.ts` only where the list is now behind **All rows**

**Interfaces:**
- Consumes: Task 1's classes, `AppHeader`, `labels`.
- Produces:
  - `ReviewScreen` keeps its props (`rows`, `onDecide`, `onReload`, `controls`, `actions`, `notice`, `who`) and adds
    `title?: string` (shown in the header breadcrumb) and `onBack?: () => void`.
  - `RowCard(props: { row: RowView; position: { index: number; total: number }; onDecide; onSkip; onPrev; saving })`
    renders spec §4.2 items 1–4 and owns the per-row keys (1–4).
  - `Compare(props: { row: RowView; ticked: ReadonlySet<number> })` renders *Now* and, when the row has objections,
    *AI suggests*.
  - `RowDrawer(props: { open: boolean; rows; selected; onSelect(key); onClose(); level; severity; onLevel; onSeverity })`.

- [ ] **Step 1: Failing tests** (testing-library; build `RowView` literals as `RowView.test.tsx` does, with
  `rowHash: 'h'`):
  - `Compare.test.tsx`: (a) translation row with one objection on `translation` (fix `бряг`): *Now* shows `банка`
    inside an element with class `struck`; *AI suggests* shows `бряг`; unchanged fields equal on both sides.
    (b) two objections on `translation` (fixes `бряг`, `крайбрежие`) and one on `sense`: with ticked = first of
    each field → *AI suggests* has `бряг` and the sense fix; with the second translation objection ticked →
    `крайбрежие`. (c) no objections: no element labelled *AI suggests*.
  - `RowCard.test.tsx`: eyebrow shows `noun · A2 · edge of river`; the heading is the headword; without objections
    **Accept fix** is disabled and **Keep** has class `primary`, with objections **Accept fix** has it; pressing `1`
    calls `onDecide('accept', {translation:'бряг', …}, '')`; pressing `2` while focus is in the note input does
    nothing; Edit shows one input per field prefilled with the ticked fixes, `3` saves with the typed values,
    Escape cancels; Drop is absent for a title row; a decided row shows its decision chip.
  - `RowDrawer.test.tsx`: closed → the list *Rows* is not in the document; open → it is, with the filters; choosing
    a row calls `onSelect` then `onClose`; Escape closes.
  - `ReviewScreen` (extend `App.test.tsx`/`HostedApp.test.tsx`): the progress text is `1 of 2`; `L` opens the
    drawer; filters inside the drawer still narrow the shown rows; after deciding, the next undecided row is shown;
    with every row decided the done state shows *Nothing left to decide here.*

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement** per spec §4.2 and mockup 1 (layout B). Keep `article aria-label="Row <key>"`, the list
  `aria-label="Rows"`, the button names (`Accept fix`, `Keep as it is`, `Edit`/`Save`, `Drop`, `Skip`), and show the
  keys as `<kbd>` inside the buttons (`aria-hidden`, so names stay clean). The drawer is a `<dialog>` opened with
  `showModal()` when available (happy-dom: fall back to the `open` attribute) so focus is trapped and Escape closes
  it. The local `App` passes its queue picker and *show unflagged* as `controls`, and **Import decisions** as
  `actions`; the hosted `AssignmentReview` passes the assignment's `assignmentLabel` as `title`, **Submit n
  decision(s)** as `actions`, and `onBack`.

- [ ] **Step 4:** update the existing tests and the two browser specs where they reached the list directly (open
  **All rows** first, or use the card); all suites, typecheck, lint, `e2e`, `e2e:hosted` pass.

- [ ] **Step 5: Commit** — `feat(review-app): one row at a time: Now beside AI suggests, the row list in a drawer`

---

### Task 3: Reviewer screens on a phone, and the assignments page

**Files:**
- Modify: `review-app/src/hosted/Assignments.tsx`, `review-app/src/hosted/HostedApp.tsx`, `review-app/src/app.css`,
  `review-app/src/RowCard.tsx`, `review-app/src/ReviewScreen.tsx`
- Create: `review-app/src/useSwipe.ts`, `review-app/src/useSwipe.test.tsx`, `review-app/src/hosted/Assignments.test.tsx`
- Modify: `review-app/playwright.hosted.config.ts` (a `phone` project, viewport 390×844, `hasTouch: true`),
  `review-app/e2e/hosted/hosted.spec.ts` (phone test)

**Interfaces:**
- Produces: `useSwipe(ref, handlers: { onLeft(): void; onRight(): void })` — pointer events; fires when the
  horizontal movement exceeds 60px and is larger than the vertical one; ignores gestures that start on
  `input, textarea, select, button, [role=dialog]`.

- [ ] **Step 1: Failing tests**
  - `useSwipe.test.tsx`: left swipe → `onLeft`; right → `onRight`; 30px → nothing; mostly vertical → nothing;
    starting on an `<input>` → nothing.
  - `Assignments.test.tsx` (mock `hostedApi.assignments`): a row reads *German translations · flagged rows* with
    the note *741 rows · 212 decided · 60 submitted* and a **Continue** button; an untouched one reads *none decided
    yet* with **Start**; the raw queue name is the row's `title`; empty list → *Nothing is assigned to you yet.*;
    `progress: null` → *The review data is not available yet.*
  - `hosted.spec.ts`, project `phone`: the reviewer opens the assignment, the page has no horizontal scroll
    (`document.documentElement.scrollWidth <= clientWidth`), taps **Keep** in the bottom bar, sees *1 of 3 decided*
    or the next row, opens **All rows** and sees the list.

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement** per spec §4.1, §4.2 items 3, 4, 8 and mockup 3: the assignments page (`.page`,
  `.settings-rows`, `.progress`); below 40rem the *Now*/*AI suggests* boxes stack, the action buttons sit two by
  two in a bar fixed to the bottom (with bottom padding on the page so content is not hidden, and
  `env(safe-area-inset-bottom)`), edit fills the screen, the drawer is a full-screen sheet, the header keeps only
  the wordmark, the list button and Submit. Wire `useSwipe` on the card: left → next, right → previous.

- [ ] **Step 4:** all suites, typecheck, lint, `e2e`, `e2e:hosted` (both projects) pass.

- [ ] **Step 5: Commit** — `feat(review-app): assignments page and phone layout for reviewers`

---

### Task 4: Admin as tabs, with an overview and dialogs

**Files:**
- Create: `review-app/src/hosted/AdminOverview.tsx`, `review-app/src/hosted/overview.ts`,
  `review-app/src/hosted/overview.test.ts`, `review-app/src/Dialog.tsx`, `review-app/src/Dialog.test.tsx`
- Modify: `review-app/src/hosted/Admin.tsx`, `AdminReviewers.tsx`, `AdminAssignments.tsx`, `AdminSubmissions.tsx`,
  `HostedApp.tsx`, `Admin.test.tsx`, `review-app/src/app.css`, `review-app/e2e/hosted/hosted.spec.ts`

**Interfaces:**
- Produces:
  - `overview.ts`: `overviewOf(data: { snapshot: SnapshotStatus | null; assignments: readonly AssignmentView[]; submissions: readonly SubmissionView[]; reviewers: readonly ReviewerView[] }): { toDecide: number; decided: number; openPrs: number; activeReviewers: number; languages: { language: Language; label: string; parts: string; reviewers: string[]; flagged: number; decided: number; submitted: number; state: 'unassigned' | 'on track' | 'done' }[] }`
    — `toDecide` = flagged + reported rows in the snapshot (per file: `flagged + reported`); a language's `parts`
    like `741 translations · 8 titles`; `reviewers` = names with an open assignment on one of its queues; `decided`
    and `submitted` summed from those assignments' `progress`; `state`: `done` when flagged is 0, `unassigned` when
    nobody holds any of its queues, else `on track`. Languages with no queue in the snapshot are left out.
  - `Dialog(props: { open: boolean; title: string; onClose(): void; children })` — native `<dialog>`, labelled by
    its title, Escape and a **Close** button call `onClose`.
  - `Admin` renders the tabs (`role="tablist"`, tabs named *Overview*, *Reviewers*, *Assignments*, *Submissions*)
    and keeps the tab in `location.hash`.

- [ ] **Step 1: Failing tests**
  - `overview.test.ts`: from a snapshot with `translation-de` (2 files: 5+1 and 3+0 flagged+reported), `title-de`
    (1 file, 2 flagged) and `translation-es` (1 file, 4 flagged), one open assignment (Anna, `translation-de`,
    progress decided 2, submitted 1), one open submission and three reviewers (one disabled): `toDecide` 15,
    `decided` 2, `openPrs` 1, `activeReviewers` 2; German: parts `9 translations · 2 titles`, reviewers `['Anna']`,
    state `on track`; Spanish: state `unassigned`; a language whose flagged is 0 → `done`.
  - `Dialog.test.tsx`: closed → content absent; open → a dialog with the accessible name of its title; Escape and
    **Close** call `onClose`.
  - `Admin.test.tsx` (extend): the page opens on *Overview* showing the four numbers and a row per language;
    clicking *Reviewers* shows the list; **Invite a reviewer** opens a dialog containing the form *Invite a
    reviewer* (same fields and behaviour as today's test); *Assignments* → **Assign work** opens the form *Assign*,
    **Split a queue** the form *Split a queue*; the Overview's **Assign** on an unassigned language opens the
    *Assign* dialog with that language's translation queue preselected; the tab survives a re-render via the hash.
  - `hosted.spec.ts`: the admin test goes through the tabs and dialogs (same assertions as today: the invited
    email appears; the overlap error shows in `p.notice`).

- [ ] **Step 2: Run, see them fail.**

- [ ] **Step 3: Implement** per spec §5 and mockups 2 (option A) and 4: `Admin` owns the data loading and `act()`
  as today and renders one tab at a time in `.page.wide`; the three forms move into `Dialog`s unchanged in fields,
  names and calls; rows use plain names (`assignmentLabel`), `.progress`, chips; below 40rem the tab strip scrolls
  sideways, the stat tiles go two by two, row actions wrap under the text, dialogs fill the screen.

- [ ] **Step 4:** all suites, typecheck, lint, `e2e`, `e2e:hosted` pass.

- [ ] **Step 5: Commit** — `feat(review-app): admin as tabs with a per-language overview; forms in dialogs`

---

### Task 5: Screenshots script and README

**Files:**
- Create: `review-app/scripts/screenshots.ts` (starts `e2e/hosted/start.ts`'s server as the hosted run does, then
  with Playwright captures assignments, reviewing, editing, overview and reviewers at 1280×800 and 390×844, in
  light and dark (`colorScheme`), into `review-app/.e2e/screenshots/`; stops the server)
- Modify: `review-app/package.json` (script `"screenshots": "pnpm build && tsx scripts/screenshots.ts"`),
  `review-app/README.md` (the key table gains `L`; "Each session" step 4 describes the new screen in three
  sentences; the Hosted section mentions the tabs and that the app works on a phone)

- [ ] **Step 1:** write the script; run `pnpm --filter @wordado/review-app screenshots`; expect 20 PNG files and no
  process left running (`pgrep -f "wrangler dev --port 4181"` prints nothing).
- [ ] **Step 2:** look at every screenshot: no overlapping text, no horizontal scroll on phone shots, dark shots
  readable (text contrast), the primary action rose on each screen. Fix what is off in `app.css`/components and
  rerun until clean; list what was fixed in the report.
- [ ] **Step 3:** README edits; all suites, typecheck, lint, both browser runs.
- [ ] **Step 4: Commit** — `docs(review-app): the new screens; a screenshots script`
