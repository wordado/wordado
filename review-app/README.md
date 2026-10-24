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

**A second target language** (German, in the content repository's `de/`, spec §5.5) is served beside English
(#317). Its queues carry the target in front of their names — `de/translation-bg`, `de/translation-en`, `de/level`
("German levels"), `de/grammar` ("German grammar") — in the snapshot, the assignments, the branches
(`review/de/translation-bg-<name>-<day>-<n>`) and the commit subjects, and its rows are written to `de/review/…`;
English's queues, keys and paths are as they were. A reviewer gets a German queue only when their languages hold
German as well as the queue's own (Bulgarian for `de/translation-bg`); the language *English* covers English's
levels and English as an L1 of the German course. The Overview lists the German course's languages after
English's. `de/grammar` can be left to the local app by taking `grammar` out of `HOSTED_KINDS`
(`shared/hosted.ts`). The headword queues (`english`, `german`) are not served: they have no AI review, and are
reviewed as CSV. The content repository's `review-snapshot.yml` and `review-import.yml` must be the templates'
versions from the same change (they draft `de/` and import a `de/…` queue there); until they are, German rows are
reviewed locally (`review "$PWD/content/de"`).

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

10. Optional, for the Accounts tab (deleting a learner's account by hand, the counts of the sweep of
    inactive accounts, and the counts of accounts and their use; spec §17): the Worker secret `ADMIN_WRITE_TOKEN`, the same value as the learner app
    server's secret of that name and **not** the value of `FEEDBACK_READ_TOKEN` (`docs/deploy.md`, step 6, has
    the commands), and `LEARNER_APP_URL` as in step 8. While either is missing the tab says accounts are not
    connected, and the rest of the app works. **This needs the learner app's server from the same change**:
    deploy that server first. Against a server from before the charts (#209) the counts, the lookup and the
    deletion work as before; the panel under the counts says its numbers could not be read, and the lookup
    shows the two dates only.

11. Optional, for the Mail tab (a mail to learners' account holders: a service notice to everyone, or
    news to those who agreed to it; spec §18): nothing more than step 10. The tab uses the same
    `ADMIN_WRITE_TOKEN` and `LEARNER_APP_URL`, and says announcements are not connected while either is missing.
    The mails are sent by the learner app's server, with its mailer and under its limits (`docs/deploy.md`,
    "Announcements"); this Worker sends none of them. **Deploy that server first.**

12. Optional, for the Mail tab to offer a service notice the notice prepared with a change (#215): `NOTICES_REPO`,
    the repository that holds the prepared notices as `owner/name`, and `NOTICES_PATH`, the folder in it, both in
    `vars` of the `production` block. They are read through the GitHub App of step 4, so **the App must be
    installed on that repository too** (its installation's list of repositories, in the organization's
    settings), where it needs to read the contents and nothing more; it is asked for the head of `main`, the
    folder's list and the files, and writes nothing there. While either variable is empty, the App has no access,
    or nothing in the folder is in the format ("Prepared notices" below), nothing is offered and nothing else
    changes. **Translate**, the form's other help, needs no setting of its own: it uses the AI help of step 9,
    its switch and its daily allowance.

`scripts/check-config.ts` refuses to deploy while any of steps 1–4 is still a placeholder, a secret is written
as a variable, `FEEDBACK_AI_AUTH` is neither of its two values, `APP_REPO` is not `owner/name`, `NOTICES_REPO` and `NOTICES_PATH` are not a repository and a folder (or one is set without the other), or `FEEDBACK_AI_URL` is not an https address
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

An admin starts on the admin page (a reviewer starts on their assignments). The page has four tabs in the
header, and the page shown is kept in the address so a reload stays put: **Feedback**, which it opens on,
**Accounts**, **Mail** and **Review**. Review holds the pages of the word review as a second row of tabs, under
addresses like `#review/reviewers` (the addresses they had before, like `#reviewers`, still open them), and reads
the review's data when one of them is opened: **Overview** (rows to decide, decided and not submitted, open pull
requests, active reviewers, then a line per language with its progress and **Assign** where nobody holds it),
**Reviewers**, **Assignments**, **Submissions** and **My work** (the admin's own assignments, as a reviewer sees
theirs). The other tabs: **Feedback** (what learners wrote about the app, read from the learner app's server each
time the tab is opened; the coordinator marks each message New, Looked at, Done or Not doing and can keep a note
on it; those marks are stored here, and, with the AI help switched on, the AI's reading of each message: spec §16),
**Accounts** (spec §17: how many accounts there are and how many are used, in counts only, each count opening
what is behind it: the accounts over time as a chart, or by language; how many accounts the
sweep of inactive accounts would delete next and how many it deleted; and one account deleted by hand, for an erasure asked for by mail or an account closed. The account is
looked up by its whole address, which shows when it was made and last signed in and how it is used (its study,
its consent to news, its reminders, its devices), and is deleted after a
question answered by typing the address again. Nothing of an account is stored here) and **Mail** (spec §18;
its address is still `#announcements`: a mail to learners' account holders, written here and sent by the learner
app's server. A service notice goes to every account holder; news goes only to the accounts that agreed to it,
with a link to stop it. The form has one editor and a box for the language; marks say which languages are
written. A service notice is offered the newest prepared notice that no announcement has used, and **Translate**
fills the empty languages from the English text with the AI help; neither saves anything. A version can be sent
only after it went to one address as a test, and only by typing the kind and the number of accounts shown; it is
sent once, a few at a time, and the list shows how far it is and lets it be stopped. Nothing of it is stored
here). Inviting, assigning, splitting, reassigning and editing a reviewer's languages each open a dialog;
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
To hand that work to someone, open *Review → Assignments*, find the assignment under *Closed*, choose
**Reassign…**, pick the reviewer and *Move their decisions*. Reassigning to the same reviewer (after enabling them
again) works too. It is refused while another open assignment already holds any of its files; close or reassign
that one first.

### Prepared notices

A notice about a change (new terms, say) is written with that change, in the repository that holds what changed,
and the Mail tab's form offers it to a service notice so that nobody pastes it language by language (step 12
above). The form reads the files of one folder, `NOTICES_PATH`, on `main`; folders inside it are not read. This is
the format, and a file that is not in it is passed over whole, with its name in the Worker's log: nothing is ever
half-read.

**The file's name** is the day of the change and, if wanted, a few words: `YYYY-MM-DD.md` or
`YYYY-MM-DD-some-words.md`, the words in small Latin letters and digits with hyphens between
(`2026-10-11-new-terms.md`). The day has to be one the calendar has. Any other file in the folder, a `README.md`
say, is not a notice. The newest notice is the one whose name sorts last; only the five newest are read.

**The file** is UTF-8 text:

``````markdown
# The title, on one line

Anything here is for people and is not read: a status line, who checked it, notes.

## English (en)

Subject:

```text
The subject, on one line
```

Body:

```text
The body, exactly as it is to be mailed.
A link is its address written out.
```

## Bulgarian (bg)

Subject:

```text
…
```

Body:

```text
…
```
``````

1. The first line that is not blank is the title: `# `, then at most 200 characters.
2. Everything from there to the first line that starts with `## ` is not read. No line of it may start with `## `.
3. Each language is a section whose heading is `## `, any name for people, a space, and the language's code in
   round brackets at the end of the line: `(en)`, `(bg)`, `(de)` or `(es)`, in small letters. The form reads the
   code, never the name. English is needed; the others may be left out; none may be there twice, and the order is
   free.
4. A section holds, in this order and nothing else but blank lines: a line that is exactly `Subject:`, a fenced
   block, a line that is exactly `Body:`, a fenced block. A block opens with a line of three or more backticks,
   with or without a word such as `text` after them, and closes with a line of exactly as many backticks; what
   is between them is the text, line for line. (A body that itself holds a line of three backticks goes in a
   block of four.)
5. From the first language heading on, the file holds nothing but such sections and blank lines: no closing
   note, no other heading.
6. Every text has to be one an announcement may hold, as a save checks it: a subject of one line, at most 150
   characters; a body of at most 10,000 characters; plain text, with no control character but the new line and
   the tab; neither of them empty. Blank lines and spaces at the ends of a subject and of a body are dropped.
7. Line ends may be of either kind, a byte order mark at the start is ignored, and spaces at the end of a line
   are dropped, in a block's text too.

**Not used yet** needs nothing written anywhere: a notice counts as used once an announcement, a draft too and of
either kind, has the notice's English subject, letter for letter. So a prepared notice whose subject is changed in
the form before it is saved is still offered afterwards, and two notices should not share an English subject. The
form offers the newest one that is not used, and no list of the others.
