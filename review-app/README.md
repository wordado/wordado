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
   - the variable `FEEDBACK_AI_AUTH`, how the Worker signs in to the service the model is reached through. There
     are two ways:
     - `key` (the default): the secret `FEEDBACK_AI_KEY` is the service's key and is sent as it is.
       `FEEDBACK_AI_URL` is OpenRouter's address when it is not set, and any service that takes the same request
       at an https address can be named, with no change to the code. To OpenRouter the Worker also says that no
       provider that keeps what it is sent may serve the request; another service is not told so by the request,
       and must be chosen for it. In the service's account, limit the key to model providers that neither keep
       requests nor train on them.
     - `google-service-account`: for Gemini on Google Cloud's Vertex AI, asked directly. The secret
       `FEEDBACK_AI_KEY` is the whole content of the service account's JSON key file (`client_email`,
       `private_key` and, when it has one, `token_uri` are read). The Worker signs a short-lived JWT with that
       key, changes it at Google's token endpoint for an access token that lives an hour, keeps the token in
       memory only, and asks the model with it. `FEEDBACK_AI_URL` must be set (there is no default) and must be
       an https address on `googleapis.com`: the address of Vertex AI's OpenAI-compatible endpoint, with the
       project and the location in it. `{project}` in its path is replaced with the key file's `project_id`, so
       that no project is written in this public repository; a key file with none is a failing call. A key
       file that names another token address is refused.

     **Learners' feedback is meant to go the second way, to Vertex AI's endpoint for the European Union,** so
     that the text is processed in the EU: `env.production` in `wrangler.jsonc` is set so. The defaults in the
     code and for a local run (`key`, OpenRouter's address) are left as they are for a setup like the corpus
     review's.
   - the Worker secret `FEEDBACK_AI_KEY`, set as the other secrets are (`wrangler secret put FEEDBACK_AI_KEY
     --env production`, never pasted or committed; a key file is piped in from the file, and the file deleted).
     A key or a service account made for this alone, with a spending limit and the least permission of its own,
     is the safer choice. Without the secret there is no AI help, and the tab says so, naming the setting that
     is missing or wrong.
   - the other variables in `wrangler.jsonc`: `FEEDBACK_AI_URL`, the service's address (https;
     `/chat/completions` is added to it); `FEEDBACK_AI_MODEL`, the model as that service names it;
     `FEEDBACK_AI_DAILY_CALLS`, the most calls a UTC day (200); `FEEDBACK_READS`, the languages the coordinator
     reads, which get no translation (`en,bg`).
   - the variable `APP_REPO`, the public app repository as `owner/name` (`wordado/wordado`). Once a day, at
     05:00 UTC, the Worker reads the numbers and titles of its open issues from GitHub's public API, so that the
     AI can say a topic "looks like #94". It needs no access and sends no token: the issues of a public
     repository are public. GitHub allows few such requests an hour, so a read is refused now and then; it is
     not tried again that day, and once the list is two days old no match is proposed until a read works.
     Without `APP_REPO` nothing is read and no match is proposed.
   - **the switch**, *AI help*, in the Feedback tab. It is off until an admin switches it on, and with it off no
     message is sent anywhere. **Before it is switched on in production, the privacy policy must name the AI
     service** (the company that runs the model, and that it receives the text of a feedback message without
     the contact address), **and the transfer of the text to it must be covered**: by the EU–US Data Privacy
     Framework or by standard contractual clauses.

   With the help on, the tab also has *View: By topic*: messages about the same thing share a topic, a short
   title in English that the AI writes or picks from the ones there are. A topic can be renamed, merged into
   another, marked and noted like a message (marking it Done marks its messages done), and a message can be
   moved to another topic, after which the AI leaves it there. The match with an issue is a proposal until the
   coordinator confirms or removes it. **This needs the learner app's server from the same change** (it gives
   messages by id): deploy that server first (`docs/deploy.md`). With an older server a topic opens with
   messages missing and says so.

   Above the filters the tab then shows **the week**: how many messages of the last seven days the AI read, by
   its category, the topics with the most messages, the bugs it reads as blocking, the new topics, and a few
   sentences it wrote from those numbers and titles alone (asked for once a day). The weekly mail gains the
   same for its week: the job has the AI read up to 50 of the week's messages that nobody opened, in at most
   two calls, and makes one more for the paragraph, all counted against the day's limit (two calls are what
   the Free plan's 50 database statements an invocation leave room for). When the help is
   off, a call fails or the limit is reached, the mail is the plain one.

   On an opened topic, **Draft an issue** has the AI write a title and a text from the topic's messages, in its
   own words: a draft that repeats a learner's words, or holds an address, a link or an account's name, is
   dropped, and the dialog says so. Read the draft and change it; **Open on GitHub** opens the new-issue page
   of `APP_REPO` in your own browser with the title and the text filled in, and you file it under your own
   name. **The review app has no permission to write to that repository and never asks GitHub to:** the link
   is all there is. A text too long for a link is copied with **Copy the text** and pasted there. When the
   issue is filed, paste its number or its address into the dialog: it becomes the topic's match. The draft
   is kept nowhere; closing the dialog loses it.

   What is sent: a message's text with email addresses, web addresses and phone numbers masked, the kind the
   learner chose, the interface language and the screen, and with them the titles of the topics so far and of
   the open issues. Never the address for an answer, the browser or the
   versions. What is kept in D1: the AI's reading of each message (it holds a translation and a summary, text
   derived from the message) and the topics' titles, until the message is gone from the learner app's server or an admin chooses
   **Forget the AI's results**. When the AI is switched off, not set up, over the day's limit or failing, the
   tab works as it does without it and says why in one line. A key file that cannot be read, a token Google
   refuses and a call the model refuses are all "failing": the Worker's log has one line for each, with the
   step (`key file`, `token` or `model`) and a status, and nothing of the secret, the token or a message.

10. Optional, for the Accounts tab (deleting a learner's account by hand, and the counts of the sweep of
    inactive accounts; spec §17): the Worker secret `ADMIN_WRITE_TOKEN`, the same value as the learner app
    server's secret of that name and **not** the value of `FEEDBACK_READ_TOKEN` (`docs/deploy.md`, step 6, has
    the commands), and `LEARNER_APP_URL` as in step 8. While either is missing the tab says accounts are not
    connected, and the rest of the app works. **This needs the learner app's server from the same change**:
    deploy that server first.

11. Optional, for the Announcements tab (a mail to learners' account holders: a service notice to everyone, or
    news to those who agreed to it; spec §18): nothing more than step 10. The tab uses the same
    `ADMIN_WRITE_TOKEN` and `LEARNER_APP_URL`, and says announcements are not connected while either is missing.
    The mails are sent by the learner app's server, with its mailer and under its limits (`docs/deploy.md`,
    "Announcements"); this Worker sends none of them. **Deploy that server first.**

`scripts/check-config.ts` refuses to deploy while any of steps 1–4 is still a placeholder, a secret is written
as a variable, `FEEDBACK_AI_AUTH` is neither of its two values, `APP_REPO` is not `owner/name`, or `FEEDBACK_AI_URL` is not an https address
(on `googleapis.com`, when the sign-in is `google-service-account`); it runs in
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

An admin has **Admin** in the header. The page has six tabs, kept in the address so a reload stays put:
**Overview** (rows to decide, decided and not submitted, open pull requests, active reviewers, then a line per
language with its progress and **Assign** where nobody holds it), **Reviewers**, **Assignments**,
**Submissions**, **Feedback** (what learners wrote about the app, read from the learner app's server each
time the tab is opened; the coordinator marks each message New, Looked at, Done or Not doing and can keep a note
on it; those marks are stored here, and, with the AI help switched on, the AI's reading of each message: spec §16),
**Accounts** (spec §17: how many accounts the sweep of inactive accounts would delete next and how many it
deleted, and one account deleted by hand, for an erasure asked for by mail or an account closed. The account is
looked up by its whole address, which shows only when it was made and last signed in, and is deleted after a
question answered by typing the address again. Nothing of an account is stored here) and **Announcements** (spec §18:
a mail to learners' account holders, written here for each language and sent by the learner app's server. A
service notice goes to every account holder; news goes only to the accounts that agreed to it, with a link to
stop it. A version can be sent only after it went to one address as a test, and only by typing the kind and the
number of accounts shown; it is sent once, a few at a time, and the list shows how far it is and lets it be
stopped. Nothing of it is stored here). Inviting, assigning, splitting, reassigning and editing a reviewer's languages each open a dialog;
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
