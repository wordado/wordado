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

4. **Decide the rows.** Pick a queue at the top (`translation-bg`, then `title-bg`, then `level`); tick *show unflagged* to add the
   rows the AI passed. The screen shows one row at a time, with a bar for how far you are: the word and its example,
   then **Now** (the current values, a value a fix would replace struck through) beside **AI suggests** (the row with
   the ticked fixes applied), then the learners' notes, each objection's reason and the word's other senses. **All
   rows** (key `L`) opens the list, learner-reported rows first, then major and minor objections, with filters for
   level and severity; choosing a row there shows it.

   | Key | Button | What it writes |
   |---|---|---|
   | 1 | Accept fix | the ticked fix (one per field; ticking another objection on the same field unticks the first) |
   | 2 | Keep | the row as it is, marked ok |
   | 3 | Edit | the cells as you change them; press 3 again to save |
   | 4 | Drop | drops the sense (translations only) |
   | S, ↓ | Skip | nothing; moves to the next row |
   | ↑ | Previous | nothing; moves to the previous row |
   | L | All rows | nothing; opens the row list (Escape closes it, and cancels an edit) |

   A row with one objection has no tick: Accept fix takes its fix. With two or more, each objection has a tick and
   names its field and fix, so you can take one field's fix and leave another's.

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

## Hosted

A hosted copy of this app (spec 2026-10-05) runs at `https://review.wordado.com` as a Cloudflare Worker, behind
Cloudflare Access. Coordinators invite reviewers by email; each reviewer gets their own assignments and submits them
as a pull request against the content repository, with no local checkout and no CLI.

### One-time setup (operator)

1. `wrangler d1 create wordado-review`; put its id into `env.production.d1_databases[0].database_id` in
   `review-app/wrangler.jsonc`.
2. `wrangler r2 bucket create wordado-review` (no public access, no custom domain).
3. Cloudflare Zero Trust → Access → Applications → Self-hosted, domain `review.wordado.com`; login method
   *One-time PIN*; policy *Allow*, include *Everyone* (the Worker decides who is invited); a second application
   for the path `review.wordado.com/api/github/webhook` with a *Bypass* policy. Copy the application's AUD tag
   to `ACCESS_AUD` and the team domain (`<team>.cloudflareaccess.com`) to `ACCESS_TEAM_DOMAIN`.
4. GitHub App (organisation `wordado` → Settings → Developer settings → GitHub Apps → New): no homepage
   needed; webhook URL `https://review.wordado.com/api/github/webhook` with a secret; permissions *Contents:
   read and write*, *Pull requests: read and write*; event *Pull request*; install it on `wordado-content`
   only. Put the app id and installation id in `GITHUB_APP_ID` / `GITHUB_INSTALLATION_ID`. Generate a private
   key and convert it to PKCS#8 before it is ever pasted anywhere: `openssl pkcs8 -topk8 -nocrypt -in app.pem
   -out app-pkcs8.pem`.
5. Worker secrets, set in the Cloudflare dashboard (Workers → wordado-review → Settings → Variables and
   secrets) — never pasted into chat or committed: `GITHUB_APP_PRIVATE_KEY` (the PKCS#8 file's content),
   `GITHUB_WEBHOOK_SECRET`, `RESEND_API_KEY` (a new sending-only Resend key for `wordado.com`), `ADMIN_EMAIL`.
6. GitHub environment `production-review` in `wordado/wordado` with a required reviewer, limited to `main`, and
   its own secret `CLOUDFLARE_API_TOKEN` (environment secrets are not shared: the learner app's token lives in
   `production`). The token needs, on this account: *Workers Scripts: Edit*, *D1: Edit*, *Workers R2 Storage:
   Edit*, and on the `wordado.com` zone: *Workers Routes: Edit* (the custom domain). Then the repository variable
   `REVIEW_DEPLOY_ENABLED=true` once steps 1–5 are done.
7. In wordado-content: an R2 API token limited to the `wordado-review` bucket (read and write), set as
   secrets `R2_REVIEW_ACCESS_KEY_ID` / `R2_REVIEW_SECRET_ACCESS_KEY` in that repository's settings; variable
   `REVIEW_BUCKET=wordado-review`; variable `REVIEW_APP_BOT` set to the app's bot login (`<app-slug>[bot]`);
   and the two workflows from `pipeline/template/.github/workflows/review-snapshot.yml` and
   `review-import.yml`.

8. Optional, for the Feedback tab: the Worker secret `FEEDBACK_READ_TOKEN`, the same value as the learner app
   server's secret of that name (`docs/deploy.md`, step 6, has the commands that set both without showing the
   value), and the variable `LEARNER_APP_URL` in `wrangler.jsonc`, that server's origin. While either is missing
   the tab says feedback is not connected, and the rest of the app works. The same two settings, with
   `RESEND_API_KEY` (step 5), also carry the weekly feedback mail: on Monday at 06:00 UTC the Worker mails every
   admin how many messages learners sent in the week before, with a link to the tab and nothing a learner wrote.
   A week with no feedback sends no mail, and Tuesday tries again when Monday failed.
9. Optional, for AI help on the Feedback tab (a translation where one is needed, the AI's own category, a bug's
   severity and a one-line summary beside each message; design `2026-10-10-feedback-ai-help-design.md`). It
   needs step 8, and:
   - the Worker secret `FEEDBACK_AI_KEY`, the key of the service the model is reached through, set as the other
     secrets are (`wrangler secret put FEEDBACK_AI_KEY --env production`, never pasted or committed). A key made
     for this alone, with a spending limit of its own, is the safer choice. In the service's account, limit the
     key to model providers that neither keep requests nor train on them. Without the key there is no AI help,
     and the tab says so.
   - the variables in `wrangler.jsonc`: `FEEDBACK_AI_URL`, the service's address (https; `/chat/completions` is
     added to it; OpenRouter's by default, and any service that takes the same request can be named, with no
     change to the code); `FEEDBACK_AI_MODEL`, the model as that service names it; `FEEDBACK_AI_DAILY_CALLS`,
     the most calls a UTC day (200); `FEEDBACK_READS`, the languages the coordinator reads, which get no
     translation (`en,bg`). To OpenRouter the Worker also says that no provider that keeps what it is sent may
     serve the request; another service is not told so by the request, and must be chosen for it.
   - **the switch**, *AI help*, in the Feedback tab. It is off until an admin switches it on, and with it off no
     message is sent anywhere. **Before it is switched on in production, the privacy policy must name the AI
     service**: the service the model is reached through, the model's provider, and that they receive the text
     of a feedback message without the contact address.

   What is sent: a message's text with email addresses, web addresses and phone numbers masked, the kind the
   learner chose, the interface language and the screen. Never the address for an answer, the browser or the
   versions. What is kept in D1: the AI's reading of each message (it holds a translation and a summary, text
   derived from the message), until the message is gone from the learner app's server or an admin chooses
   **Forget the AI's results**. When the AI is switched off, not set up, over the day's limit or failing, the
   tab works as it does without it and says why in one line.

`scripts/check-config.ts` refuses to deploy while any of steps 1–4 is still a placeholder, a secret is written
as a variable, or `FEEDBACK_AI_URL` is not an https address; it runs in
`deploy-review.yml` before the Worker is built.

### Running it locally

    pnpm --filter @wordado/review-app snapshot "$PWD/content" /tmp/snap
    pnpm --filter @wordado/review-app e2e:hosted

The second command runs the full hosted flow against fakes (no real Cloudflare Access, GitHub App or Resend
account needed), on a desktop screen and on a phone-sized one.

    pnpm --filter @wordado/review-app screenshots

writes a picture of every screen of both modes (desktop and phone, light and dark) into
`review-app/.e2e/screenshots/`, for a pull request description or for a look at the whole app after a change to its
styles. The pictures are not committed. It ends by naming any screen where something is wider than the screen.

    pnpm --filter @wordado/review-app icons

draws `public/apple-touch-icon.png` again from `public/icon.svg` (the review app's own icon), after a change to
the SVG. The PNG is committed.

### How a reviewer works

A reviewer gets an invite email from the app, and signs in at `https://review.wordado.com` with a one-time code
that Cloudflare Access sends in a separate email when they ask for it; they land on *Your assignments*, one line
per assignment with its progress and **Start** or **Continue**. Deciding a row uses the same screen and keys as
the local app (see "Each session" above). The app works on a phone: the decisions are a bar at the bottom of the
screen, a swipe to the left goes to the next row and one to the right to the previous, and the row list has the
way back to the assignments. A reviewer signs out from the account menu: the round button with their initials at
the right end of the header, then **Sign out**. Each **Submit** opens a new pull request in
the content repository and emails every active admin a link to it. When that pull request is opened, the
content repository's `review-import.yml` runs `corpus import` on its branch and pushes the result onto the same
pull request as an extra commit, so merging it lands both the decisions and the import.

### The admin page

An admin has **Admin** in the header. The page has five tabs, kept in the address so a reload stays put:
**Overview** (rows to decide, decided and not submitted, open pull requests, active reviewers, then a line per
language with its progress and **Assign** where nobody holds it), **Reviewers**, **Assignments**,
**Submissions** and **Feedback** (what learners wrote about the app, read from the learner app's server each
time the tab is opened; the coordinator marks each message New, Looked at, Done or Not doing and can keep a note
on it; those marks are stored here, and, with the AI help switched on, the AI's reading of each message: spec §16). Inviting, assigning, splitting, reassigning and editing a reviewer's languages each open a dialog;
when the server refuses, the dialog stays open and says why. The page is made for a laptop and usable on a phone.

### Changing reviewers

- **Disable** a reviewer to revoke their access; their open assignments close and their unsubmitted decisions
  are kept (spec §5.1).
- **Reassign** moves an assignment, open or closed, to another reviewer with the language; its unsubmitted
  decisions move with it or are discarded (spec §5.1).
- **Close** ends an assignment and frees its files; its unsubmitted decisions are kept for a later reassignment
  (spec §5.1).
- **Split** divides a queue's free files between two or more reviewers (spec §5).

### Recovering work

Closing an assignment, disabling its reviewer or removing their language closes the assignment but keeps its
unsubmitted decisions; so does a pull request closed without merging, whose decisions become unsubmitted again.
To hand that work to someone, open *Admin → Assignments*, find the assignment under *Closed*, choose
**Reassign…**, pick the reviewer and *Move their decisions*. Reassigning to the same reviewer (after enabling them
again) works too. It is refused while another open assignment already holds any of its files; close or reassign
that one first.
