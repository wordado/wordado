# Hosted review app — design

Date: 2026-10-05. Status: draft for the product owner's review.
Builds on: `2026-10-04-ai-review-and-review-app-design.md` (the local review app, §5; "Remote reviewers later", §8).
Revised 2026-10-11: §18 added, the Announcements tab (issue #185): a mail to learners' account holders, written
here and sent by the learner app's server in batches, as a service notice to everyone or as news to those who
consented, with an unsubscribe link.
Revised 2026-10-11: §17 added, the Accounts tab (issue #187): an account of the learner app deleted by hand, and
the counts of the sweep of inactive accounts, behind a second token that is not the one that reads feedback.
Revised 2026-10-10: the week and the drafted issue (issue #158, stage D): §8's weekly mail gains the AI's part,
§16.9 gains the week's summary, the draft, their routes and the table `feedback_week_texts`; §16.8 follows.
Revised 2026-10-10: topics and known issues on the Feedback tab (issue #158, stage C): §16.9 gains the topics, their
routes and tables, the daily read of the open issues and the setting `APP_REPO`; §16.2 gains `ids`; §14's cron
triggers gain the daily line.
Revised 2026-10-10: AI help on the Feedback tab, per message (issue #158, stage B): §16.9 added, with its routes
and its three tables; §16.3, §16.7 and §16.8 follow. With the help switched on, D1 holds text derived from a
learner's message (a translation, a summary); with it off, nothing changes.
Revised 2026-10-10: the weekly feedback mail and the Worker's first timed job (issue #158): §8 gains the mail, §14
the cron triggers, §16.3 the table that keeps it to one a week, §16.6 and §16.8 follow. The learner app's server
mails no feedback, so this mail is the only notice that feedback came. AI help on the Feedback tab is designed in
`2026-10-10-feedback-ai-help-design.md`.
Revised 2026-10-09: §15 added, the spot check (issue #129): an assignment over a random sample of the rows the AI
review passed, with the reviewer's word on how serious each fault was. §5's *No overlap* and §12 point to it.
Revised 2026-10-08: §7.2 and §11, after a Submit failed three times at the pull request on 2026-10-07 with nothing
to say why: the error carries GitHub's own explanation, opening the pull request is tried once more, and a branch
left by a failed submit is used again when it holds the same commit. Checked read-only against wordado-content:
the three branches that incident left have the same tree sha, one parent each (the same commit) and a message with
no trailing newline, and `git/matching-refs/heads/<base>-` returns exactly them, so the reuse test holds on GitHub.
After review: the claim is kept when GitHub cannot say whether the pull request exists.
Revised 2026-10-06: §7.2 gains the submission claim (one submit at a time; no duplicate pull request after a
failure that follows the pull request).
Revised 2026-10-05 after the implementation's final review: §7.2 defers listing branches left without a pull
request; §5.1 notes that a closed assignment can be reassigned.

## 1. Purpose

The local review app lets the product owner decide AI-flagged rows on their own machine. Native reviewers for
Bulgarian, German and Spanish need the same screens online, without a git checkout, a GitHub account or a
spreadsheet. The hosted review app puts the review app on `review.wordado.com`: the coordinator invites reviewers
by email, assigns them work, and each reviewer's decisions come back to wordado-content as a pull request the
coordinator merges.

It serves both kinds of review:

- **Flagged rows:** the rows the AI reviewer objected to (spec 2026-10-04 §3), as in the local app.
- **Full native review:** every row of a review file, with the AI's objections shown where there are any. This is
  the review that gates the general launch (main spec §5.4) and replaces editing CSV files (the reviewer guides'
  `editing-review-files.md` stays as a fallback).

Success: a German teacher with only an email address signs in, works through their assigned files with the keyboard,
clicks Submit, and the coordinator gets an email with a pull request whose import is already done.

## 2. Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Sign-in | Email one-time code (Cloudflare Access); no GitHub account needed |
| What reviewers do | Both flagged-rows and whole-file review, chosen per assignment |
| Write-back | One pull request per Submit, opened by a GitHub App; the coordinator merges |
| Managing reviewers | An admin page in the app (invite, assign, progress) |
| Where rows come from | A snapshot the Corpus action builds and uploads to a private R2 bucket (approach A) |
| Email | Resend, already verified for `wordado.com`, with its own sending-only key |
| Hosting | Its own Worker `wordado-review` on `review.wordado.com`, apart from the learner app |

## 3. Components

```
wordado-content (GitHub)                 Cloudflare
  corpus.yml ── snapshot ──────────────▶ R2 wordado-review (private)
  review-import.yml ◀── PR ──┐                  │ read
                              │                  ▼
                       GitHub App ◀────── Worker wordado-review ── D1 wordado-review
                                                 │        ▲
                                   Resend ◀──────┘        │ Access JWT
                                                   reviewer's browser (review.wordado.com)
```

1. **Snapshot builder** (`review-app/server/snapshot.ts`, CLI `review-app snapshot <content> <out>`): runs the
   local app's row model (`model.ts`) over every open review file and writes the rows as the app shows them (§4).
2. **Publishing** (wordado-content `corpus.yml`): builds the snapshot and uploads it to R2 (§4.3).
3. **Review Worker** (`review-app/worker/`, Wrangler project `wordado-review`): serves the UI and the API (§6),
   keeps reviewers, assignments, decisions and submissions in D1 (§5), opens pull requests through a GitHub App
   (§7), sends email through Resend (§8).
4. **UI** (`review-app/src`): the local app's screens, plus *My assignments* and *Admin* (§9).
5. **Import workflow** (wordado-content `review-import.yml`): runs `corpus import` on the app's pull requests (§7.3).

The local app keeps working unchanged; both modes share the UI, the row model and the decision-writing function.

## 4. The snapshot

### 4.1 Contents

```
snapshots/<id>/index.json
snapshots/<id>/<queue>/<file-stem>.json      e.g. translation-de/2026-10-03-01.json
current.json                                  { "id": "<id>", "built": "<iso>", "commit": "<content sha>" }
```

- `<id>` is the content commit's short sha plus the build time (`3f2a91c-20261005T1012Z`).
- `index.json`: for every queue with open files, its `columns` and `verdicts` (from `queueSpecs`, so the Worker
  never reads `pipeline.json`), its language (`bg`, `de`, `es`, or `en` for `level`), and per file:
  path, row count, flagged count, reported count.
- A file's JSON: `{ "file": "review/translation-de/2026-10-03-01.csv", "version": "<sha256 of the CSV>", "rows":
  RowView[] }`, where each `RowView` (local `types.ts`) gains `rowHash`: `rowContent(queue, proposed, reopened)`,
  the same hash the AI-review store keys on. The snapshot covers the queues the review app can show: `translation-<l1>`,
  `title-<l1>` and `level`, whether or not AI review covers them (rows it does not cover read `ai: 'unreviewed'`).
  `english` and `audio` stay on files (§12).
- The snapshot holds rows only: never the draft, the decisions log, or the corpus as a whole.

### 4.2 Building

`review-app snapshot <content> <out>` needs `work/draft.json`, so the action runs `corpus draft --offline` first
(free, as the `ai-review` job does). It reuses `model.ts` with other senses included, so a row reads the same in both
apps.

### 4.3 Publishing

A workflow of its own, `review-snapshot.yml` (beside `corpus.yml`, which stays started by hand), builds from `main` only, so a reviewer never sees rows that are not merged. It
runs on every push to `main` that touches `review/`, `decisions/`, `ai-review/` or `pipeline.json` (which is how the
`draft`, `queues` and `ai-review` pull requests reach it once merged), and by hand (`workflow_dispatch`).

It uploads `snapshots/<id>/` with `aws s3 sync` (as `release` already does for packs), then writes `current.json`
last, so the switch is atomic: the Worker reads either the whole old snapshot or the whole new one. It then deletes
snapshots other than the newest two. Its keys (`R2_REVIEW_ACCESS_KEY_ID`, `R2_REVIEW_SECRET_ACCESS_KEY`) are
limited to the `wordado-review` bucket. The Worker caches `current.json` for 30 seconds.

## 5. D1 schema

```sql
reviewers   (email TEXT PRIMARY KEY, name TEXT NOT NULL, languages TEXT NOT NULL,   -- JSON, e.g. ["de"]
             role TEXT NOT NULL CHECK (role IN ('reviewer','admin')),
             invited_at TEXT NOT NULL, invite_sent_at TEXT, disabled_at TEXT)
assignments (id INTEGER PRIMARY KEY, reviewer TEXT NOT NULL REFERENCES reviewers(email),
             queue TEXT NOT NULL, files TEXT NOT NULL,          -- JSON list of review/... paths, or "*"
             flagged_only INTEGER NOT NULL, created_at TEXT NOT NULL, closed_at TEXT)
decisions   (assignment INTEGER NOT NULL REFERENCES assignments(id), queue TEXT NOT NULL, file TEXT NOT NULL,
             key TEXT NOT NULL, row_hash TEXT NOT NULL, action TEXT NOT NULL, cells TEXT, note TEXT,
             decided_at TEXT NOT NULL, submission INTEGER REFERENCES submissions(id),
             PRIMARY KEY (assignment, queue, key))
submissions (id INTEGER PRIMARY KEY, assignment INTEGER NOT NULL REFERENCES assignments(id),
             branch TEXT NOT NULL, pr INTEGER, count INTEGER NOT NULL, left_out INTEGER NOT NULL,
             status TEXT NOT NULL CHECK (status IN ('open','merged','closed')), created_at TEXT NOT NULL)
```

- **Languages:** a reviewer can be assigned a queue only in one of their languages. `en` covers `level`.
- **No overlap:** creating an assignment fails when another open assignment on the same queue shares a file; `"*"`
  shares every file. So a row has at most one reviewer. A flagged-only assignment takes a file list too, so the
  flagged rows of one queue can be shared out as well. A spot check (§15) is the one exception: it stands beside
  a flagged-only assignment of the same files.
- **Splitting a queue:** the admin page's *Split* picks a queue, *all rows* or *flagged rows only*, and two or more
  reviewers with that language, and creates one assignment per reviewer, dealing out the queue's files that no
  open assignment holds so each gets about the same number of rows (whole files, never a file cut in two). The
  coordinator can adjust the proposed split before confirming.
- **The first admin** is the email in the Worker variable `ADMIN_EMAIL` (the product owner), created on first
  request if missing. Other admins can be added on the admin page.

### 5.1 Changing or stopping a reviewer

- **Disable a reviewer:** from that request on, every API call of theirs gets 403 (the Access sign-in still works,
  the app does not). Their open assignments close, which frees the files for someone else. Their unsubmitted
  decisions are kept; pull requests they already submitted are unaffected (merge or close them as usual).
  *Enable* reverses it, but closed assignments stay closed; assign again.
- **Reassign an assignment:** pick another reviewer with the same language. The assignment's unsubmitted
  decisions either move with it (the new reviewer sees them as decided and can change them) or are discarded, the
  coordinator's choice; submitted ones stay with the original reviewer's pull request. Under the hood the old
  assignment closes and a new one opens on the same files.
- **Close an assignment:** frees its files; its unsubmitted decisions are kept on the closed assignment (visible to
  the admin, never submitted) so a later reassignment can still take them over.
  The admin page's closed assignments therefore offer *Reassign* too; reassigning a closed assignment opens a new
  one on the same files (refused while another open assignment holds any of them) and moves or discards its
  unsubmitted decisions as above.
- **Change languages:** removing a language closes that reviewer's open assignments in it, as above.

## 6. API

The reviewer API is the local app's (spec 2026-10-04 §5.4), scoped to the signed-in reviewer:

| Route | Hosted behaviour |
|---|---|
| `GET /api/me` | email, name, role, languages; 403 when not invited or disabled |
| `GET /api/assignments` | the reviewer's open assignments with progress (§6.1) |
| `GET /api/rows?assignment=<id>` | `{ rows, discarded }`: the assignment's rows from the current snapshot (a flagged-only assignment: rows the AI flagged or a learner reported, worst first; otherwise every row, in file order), each with the reviewer's decision on it; `discarded` names unsubmitted decisions just deleted because their row left the snapshot |
| `POST /api/decision` | `{ assignment, queue, file, key, rowHash, action, cells?, note? }` → stores or replaces the decision in D1; 409 `changed` when the snapshot's `rowHash` for the key differs, 410 `gone` when the row left the snapshot, 400 `invalid` as locally (unknown action, `drop` where the queue has none, a cell outside the queue's columns), 403 when the row is outside the assignment |
| `DELETE /api/decision` | `{ assignment, key }` → undoes an unsubmitted decision |
| `POST /api/submit` | `{ assignment }` → §7; returns `{ pr, count, leftOut: [{ key, reason }] }` |

The local `/api/reviewer` (name prompt) and `/api/import` do not exist in hosted mode.

Admin API (`role = admin`): `GET/POST /api/admin/reviewers`, `PATCH /api/admin/reviewers/<email>` (name,
languages, role, disable), `POST /api/admin/reviewers/<email>/invite` (resend), `GET/POST
/api/admin/assignments`, `POST /api/admin/assignments/<id>/close`, `GET /api/admin/submissions`, `GET
/api/admin/snapshot` (current id, build time, content commit, queue counts).

### 6.1 Progress

Per assignment: rows in scope (from the snapshot), decided (unsubmitted), submitted (open PR), merged, and
remaining. Submitted and merged come from `submissions`; once the snapshot drops the merged rows, *remaining*
falls by itself.

### 6.2 Request rules

Kept from the local server: POST, PATCH and DELETE need `Content-Type: application/json` (else 415) and a well-formed
body (else 400); in place of the local Host check, the `Origin` header must be `https://review.wordado.com` (or the
configured origin) on every non-GET request (else 403).

## 7. Submitting

### 7.1 The shared write function

`saveDecision` in `review-app/server/decisions.ts` is split: a pure `applyDecisions(csvText, spec, decisions) →
{ text, applied, leftOut }` (no file system, no Node imports, so the Worker can bundle it), and the local
`saveDecision` that reads, calls it with one decision, and writes. `spec` is `{ columns, verdicts }` from the
snapshot index locally or the same values from `queueSpecs`. The pure function sets the cells (only the queue's
columns), the verdict (`drop` or `ok`) and the note (an empty note keeps the existing one), exactly as today.

### 7.2 Submit

1. Collect the assignment's decisions with no submission. None → 400 *nothing to submit*.
2. Through the GitHub App, read each affected CSV and its JSON sidecar from wordado-content `main`.
   All of them are read together, a few requests for the whole submit and not one per file: a spot check touches
   files from all over its queue, and a Worker may make only so many requests while it answers one. While the
   submit runs the screen says so, with a moving bar.
3. For each decision, compute the row's hash from the sidecar's `proposed` and the CSV's `reopened`. A missing row
   or a different hash is left out (`gone` / `changed`) and stays unsubmitted; the response lists it and the UI
   shows it again.
4. `applyDecisions` per file; commit all changed files as **one commit** (Git Data API: blobs, tree, commit) on a
   new branch `review/<queue>-<reviewer-slug>-<yyyymmdd>-<n>` from `main`'s current commit. Commit author: the
   reviewer's name with the app's noreply address; message `review: <queue>, <n> decisions by <name>`.
5. Open a pull request titled `<queue>: <n> decisions by <name>` whose body lists the counts per action and
   per file and the reviewer's notes. Record the submission and mark the decisions with it.
6. Email the admins (§8).

If any GitHub call fails before the pull request exists, nothing is recorded: the decisions stay unsubmitted and
the reviewer is told what GitHub said, e.g. *GitHub did not accept the pull request (422: Validation Failed: …).
Your decisions are saved; try Submit again.* (another call: *GitHub refused the submit (<call>, <status>:
<detail>)…*; GitHub not reached: *Could not reach GitHub. Your decisions are saved; try Submit again.*; a failure
that is not GitHub's: *The submit failed. Your decisions are saved; try again.*). The detail
is GitHub's own `message` and its `errors[]` messages or codes from the response body, at most 300 characters,
and nothing of the request. The Worker logs the same with the call that failed, the branch and the status.

**One more try at the pull request.** When opening the pull request fails with a 5xx, a 429, a 403 that is a rate
limit (its message says *rate limit* or *abuse*, or it has `retry-after`), or because GitHub was not reached,
Submit waits 2 seconds (or GitHub's `retry-after`, when that is at most 5 seconds; a longer one means no retry)
and tries once more. Before that second try, and after any such failure or a 422, it looks for a pull request
already opened from the branch (the failed call may have opened it) and uses it instead of failing.

**When GitHub cannot say.** After a failure that may have opened the pull request all the same (a 5xx, a 429, a
422, GitHub not reached), the claim is released only when that look-up answered *none*. When the look-up failed
too, the outcome is unknown: the claim is kept, the reviewer reads *GitHub did not confirm the pull request
(<status>: <detail>). Your decisions are saved; try Submit again in a couple of minutes.*, and the next Submit or
the admin's list settles the claim as below (the pull request found, or released after two minutes). A plain
refusal (any other 4xx) and every failure before the pull request is asked for release the claim at once.

**A branch left behind.** A submit that fails after its commit leaves its branch without a pull request. Before
committing, Submit looks at the branches `review/<queue>-<reviewer-slug>-<yyyymmdd>-<n>` of today: one whose head
commit has exactly the tree, the parent (`main`'s current commit) and the message this submit would write, and
from which no pull request was ever opened and which no other claim names, is used as it is, with no new commit,
and the submission names it. Messages are compared without trailing whitespace. A failure of this look-up is
logged and means no reuse, never a failed submit. Any other is not touched (never updated, never deleted), and the submit writes a new branch (`<n>` + 1) as before.
A branch left behind without a pull request is harmless. Listing such branches on the admin page for deletion is
deferred (not built in the first version); until then they are deleted by hand in wordado-content.

Subrequests: a submit makes about two GitHub calls per file plus a fixed dozen (up to two more per branch left
behind, three more when the pull request is retried); the Workers free plan allows 50 per request.

**One submit at a time (the claim).** Before any write to GitHub, Submit records the submission with no pull
request number and marks its decisions with it; a unique index allows one such claim per assignment, so a second
Submit at the same moment is refused (409, *a submit is already in progress*). When GitHub fails before the pull
request exists, the claim is released. When something fails after it exists, the claim stays, so a retry cannot open
a second pull request; the next Submit of that assignment, or the admin's submissions list, settles it: a pull
request found on GitHub for the claimed branch completes the claim, and a claim older than two minutes with none is
released.

### 7.3 Import, in wordado-content

`review-import.yml` runs on `pull_request` (opened) for branches `review/*` whose author is the GitHub App. It
checks out the branch, builds the pipeline at `PIPELINE_REF`, runs `corpus draft --offline` and `corpus import
--by "<name>"` (the name from the commit author), commits `import: <queue> by <name>` onto the same branch, and
comments with the import's errors, if any (rows it could not apply stay in the review file, as locally).

### 7.4 After the pull request

- **Merged:** the push to `main` rebuilds the snapshot; the imported rows are gone from the review files and so
  from the app. The submission becomes `merged`.
- **Closed unmerged:** its decisions lose their submission and show as unsubmitted again, so the reviewer can fix
  and resubmit.
- The Worker learns both through a GitHub App webhook (`pull_request` closed), checked with the webhook secret;
  as a fallback, the admin page refreshes the status of open submissions when it loads.

## 8. Email

Resend, through the `resendMailer` shape in `server/src/mail.ts` (copied into the Worker, not imported across
packages), from `Wordado Review <review@wordado.com>`, with the Worker's own sending-only key `RESEND_API_KEY`.

- **Invite** (on creating a reviewer, and *Resend invite*): "You are invited to review <language> for Wordado", the
  link `https://review.wordado.com`, and one line: sign in with this address; you get a code by email.
- **Submitted** (to every admin): "<name> submitted <n> decisions on <queue>", with the pull request link.
- **Weekly feedback** (to every admin who is not disabled; `2026-10-10-feedback-ai-help-design.md` §3.4): "Wordado
  feedback: <n> messages this week", then how many messages learners sent in the week (Monday to Sunday, UTC), a
  line for each of the learner's own kinds (*Something isn't working*, *An idea*, *Something else*) with its
  count, and a link to the Feedback tab. Nothing a learner wrote is in it, and no address a learner gave: a mail
  stays with the mail service, and the messages are read in the tab only. It is sent by a timed job on Monday at
  06:00 UTC for the week that ended that day. A week with no feedback sends no mail. The job reads at most ten
  pages of 100 messages; past that the mail says "more than". A second trigger on Tuesday tries again after a
  Monday that failed (the app's server not reached, the mail refused); a row for each week (§16.3) makes it do
  nothing after a Monday that worked. The job needs `RESEND_API_KEY`, and `FEEDBACK_READ_TOKEN` with
  `LEARNER_APP_URL` (§16.2); while the last two are not both set it does nothing and logs one line.

With the AI help set up and switched on (§16.9), the same job first has the AI read the week's messages that have
no reading yet (at most 2 calls of 25 messages, the newest first), counts the week from the readings, and asks
once more for a paragraph written from those counts and the topics' titles alone. The mail then holds, between the
counts by kind and the link: the paragraph, named as written by the AI; "Read by the AI: <n> of <total>" with a
line for each of its categories; *Most messages* (up to five topics with their counts); "Bugs that block
learners: <n>"; and *New topics*. A topic's title and the paragraph are the only free text, and both are refused
in code when they hold an address, a link or a phone number. Every call counts against the day's limit. When the
help is off or not set up, when a call fails, or when the limit is reached, the mail is the one above, byte for
byte; a paragraph that was written and refused leaves the AI's numbers in the mail without it. A second run of
the same week asks the model nothing it already has.

A failed send never fails the action: the reviewer is still created (the admin page shows *invite not sent* and
the link to copy), and a submission is still recorded. A weekly mail that was not sent is tried once more, the
next day.

## 9. UI

- **Reviewer:** *My assignments* (each with queue, scope, progress, and Open) → the local app's review screen for
  that assignment (layout B, same keys), with **Submit** in place of *Import decisions*, showing *n decided, not
  submitted*. After Submit: the pull request link and any left-out rows. No name prompt: the name comes from the
  invite.
- **Admin:** reviewers (invite with email, name, languages; disable or enable; resend invite), assignments (reviewer → queue
  in their languages → files or *flagged rows only*; the overlap error in words), *Split* (§5), progress, reassign or close an assignment (§5.1), submissions with links,
  snapshot status (built when, from which commit).
- The new screens use the web app's Settings look (panel sections, segmented controls, settings rows).
- The local and hosted modes are one build: `api.ts` asks `GET /api/me`; a 404 means local mode.

## 10. Security

- **Cloudflare Access** guards `review.wordado.com` with the one-time PIN method and an *everyone* include rule:
  Access proves the person owns the email; the Worker decides who is invited.
- **The Worker verifies the Access JWT** (`Cf-Access-Jwt-Assertion`) on every request: signature against the team's
  keys (cached), audience `ACCESS_AUD`, expiry. Without a valid token: 401. The webhook route instead checks the
  GitHub signature.
- **Scope:** every reviewer route checks the assignment belongs to the signed-in reviewer and is open, and that the
  row is in the assignment's files.
- **GitHub App** installed on wordado-content only, with contents and pull requests read and write, and the
  `pull_request` webhook. The Worker signs its own JWT with the app's private key (WebCrypto) and exchanges it
  for an installation token.
- **Secrets**, all set in the Cloudflare or GitHub UI, never in chat: `GITHUB_APP_PRIVATE_KEY`,
  `GITHUB_WEBHOOK_SECRET`, `RESEND_API_KEY`, `FEEDBACK_READ_TOKEN` (Worker; the last is §16's and optional);
  `R2_REVIEW_ACCESS_KEY_ID`, `R2_REVIEW_SECRET_ACCESS_KEY` (wordado-content). Variables: `ACCESS_TEAM_DOMAIN`,
  `ACCESS_AUD`, `ADMIN_EMAIL`, `GITHUB_APP_ID`, `GITHUB_INSTALLATION_ID`, `CONTENT_REPO`, `APP_ORIGIN`,
  `LEARNER_APP_URL`.
- **Private content stays private:** the R2 bucket has no public access; the app repository holds code and test
  fixtures only, never corpus rows.

## 11. Errors

| Situation | What the reviewer sees |
|---|---|
| Row changed in a new snapshot after they decided it | *Changed since you decided it*, with the new proposal; the old decision is kept but not submitted until they decide again |
| Row gone (imported, dropped by a new draft) | the row disappears; an unsubmitted decision on it is discarded with a notice |
| No snapshot yet / R2 unreadable | *The review data is not available yet*; admin sees the snapshot status |
| GitHub unreachable at Submit, or it refuses a call | after one more try at the pull request (§7.2): *Could not reach GitHub…* or *GitHub did not accept the pull request (<status>: <GitHub's message>). Your decisions are saved; try Submit again.*; nothing submitted. When GitHub cannot say whether the pull request exists: *GitHub did not confirm the pull request (…). … try Submit again in a couple of minutes.* |
| Not invited / disabled | a plain page: ask the coordinator for an invite |
| Access token missing or invalid | 401 (Access's own sign-in page normally comes first) |

## 12. Out of scope

- Several reviewers voting on one row (one reviewer per row, §5).
- Audio review in the browser, and the `english` queue (both stay on files).
- Polishing the layout for phones (it must work, not shine).
- Learner reports as an assignment source of their own (reported rows already come first in a queue).
- For a spot check (§15): choosing its rows by hand, and comparing two AI reviewers.

## 13. Testing

- **Unit:** `applyDecisions` (all actions, columns outside the queue ignored, empty note keeps the old one, left-out
  rows), the snapshot builder against the local app's fixture, assignment overlap, row-hash checks, the Access JWT
  check (valid, wrong audience, expired, bad signature), the GitHub App JWT signing, the webhook signature.
- **Worker:** Vitest in Node with Wrangler's `getPlatformProxy` (local D1 and R2 bindings): local D1 and R2 holding a fixture snapshot, a fake GitHub API
  (records blobs, trees, commits, pull requests) and a fake Resend; reviewer and admin flows end to end at the API
  level, including 403 outside an assignment, a submit with a changed row, a disabled reviewer's 403, and a
  reassignment that moves and one that discards unsubmitted decisions.
- **Split:** files dealt out by row count (or flagged count) across reviewers, files already assigned skipped,
  fewer files than reviewers refused in words.
- **E2E:** Playwright against `wrangler dev` with the fixture snapshot and test JWTs: a reviewer decides three
  rows with the keys and submits (the fake GitHub receives one commit); an admin invites a reviewer and assigns
  files; an overlapping assignment is refused. Runs in CI with the local review app's e2e.
- **Content repo:** the import workflow is tried once on a real test pull request, with the product owner's
  go-ahead.

## 14. Deploy

- CI (the app repo's `ci.yml`): typecheck, lint, unit, Worker tests, e2e, on every pull request.
- A deploy workflow deploys `wordado-review` on merges to `main`, behind the GitHub environment
  `production-review` (manual approval), and applies D1 migrations first.
- The Worker has three cron triggers in `wrangler.jsonc`, written at the top level and in `env.production`:
  `0 6 * * 1` (Monday 06:00 UTC), the weekly feedback mail (§8), `0 6 * * 2`, its second try on Tuesday, and
  `0 5 * * *`, the daily read of the app repository's open issues (§16.9). Each
  line has its job in `worker/index.ts`, and a test fails when the two lists differ.
- `review-app/README.md` gets a *Hosted* section with the one-time setup: the D1 database and R2 bucket, the
  Access application and policy, DNS for `review.wordado.com`, the GitHub App (permissions, webhook URL, install
  on wordado-content), the Resend key, the R2 keys in wordado-content, and the variables of §10.
- The steps that change wordado-content (`corpus.yml` snapshot job, `review-import.yml`) go in as a pull request
  there, with the product owner's go-ahead, and `PIPELINE_REF` moves to a commit that has `review-app snapshot`.

## 15. Spot check

The assignments of §5 hand out the rows the AI review flagged, or whole files. Neither says how much the AI review
lets through. A **spot check** does: an assignment over a random sample of the rows the AI review *passed*, which a
reviewer works through like any other. What they change is a real correction, submitted as §7 has it; what they
answer about each change is the measure.

### 15.1 The sample

The coordinator picks a reviewer, a queue in one of their languages and a number of rows (50 unless changed, at
most 500). The Worker draws from the queue's open files the rows that

- the AI review passed with **no objection at all** (`ai = passed`, no severity, an empty `objections` list: a row
  under the flagging threshold with a minor objection is left out, its objection would steer the reviewer),
- no learner reported (`reports` empty),
- are not stale (spec 2026-10-04: the file is older than the draft),
- hold no verdict yet (one written into the file outside this app), and
- no open or merged submission has decided already, for the row as it is now (one query over `decisions` and
  `submissions`).

The sample is spread evenly over the levels found on the rows (`context.level`): the number is divided as equally
as possible, the remainder goes to the levels in their order, and what a level is too small to take is shared out
among the others the same way. Within a level the rows are drawn at random, and the whole sample is then mixed, so
the reviewer does not meet the levels in blocks. The generator is seeded (mulberry32) and the **seed is stored**
with the sample: the same rows and seed give the same sample in the same order, so a draw can be made again and
explained. When fewer rows qualify than were asked for, all of them are taken and the answer says how many; when
none does, the request is refused.

The sample is fixed when the assignment is made: `GET /api/rows` returns exactly its rows, in the stored order
(never worst first), on every load. A sampled row that has since been flagged or reported stays in the sample; one
that changed stays too, and its row hash does what it does for any decision (§11); one that has left the snapshot
drops out, and an unsubmitted decision on it is discarded as usual.

### 15.2 Storage

Migration `0003_spot_check.sql` (forward-only, every column nullable or defaulted, so the rows there and the
previous Worker are unaffected):

```sql
assignments ADD spot_check INTEGER NOT NULL DEFAULT 0,   -- 1 for a spot check
            ADD seed INTEGER,                            -- what the sample was drawn with
            ADD sample TEXT                              -- JSON list of { file, key }, in the order shown
decisions   ADD severity TEXT CHECK (severity IN ('major','minor'))
```

A spot check's `files` are the files its sample came from, and `flagged_only` is 0.

### 15.3 Overlap, reassign, split

- A spot check **stands beside flagged-only assignments** of the same files: at the draw they share no row.
- It is **refused beside an open all-rows assignment** that shares a file with it (before the draw: any file of the
  queue), and creating an all-rows assignment over a file a spot check sampled from is refused the same way. The
  message names who has the other one.
- **One open spot check per queue.**
- Everything else keeps §5's rule. The snapshot status's *assigned to* names who holds a file's rows to decide,
  not a spot check on some of them.
- **Reassign** moves a spot check as §5.1 moves any assignment: the new one has the same seed and sample. A spot
  check is never part of a **split**; its files count as taken there only for an all-rows split.

### 15.4 The severity question

In a spot check, **Keep** means the row is fine and is stored as it always was. A decision that changes the row
(**Edit**, **Drop**; **Accept fix** too, should a sampled row have gained an objection since) is followed by one
question in the card, in the place of the decisions:

> **How serious was it?**
> **Serious** — a learner would be taught something wrong, or marked wrong for a right answer.
> **Minor** — right, but could be better.

Keys `1` and `2` answer, `Esc` (Cancel) goes back with nothing lost: an edit is as it was typed. While the question
is open the other keys, the swipe and the row list are off, as during an edit. The decision is sent only with the
answer. A decided row shows it (*rated serious*, *rated minor*); deciding the row again before Submit replaces it.

`POST /api/decision` takes `severity: 'major' | 'minor'` (*serious* is stored as `major`, the word the AI review
uses): required in a spot check with every action but `keep`, refused with `keep`, and refused outside a spot check,
each a 400 `invalid` in words. A row of the sample's files that is not in the sample is outside the assignment (403).

The severity is the app's own record. It is **not written into the review files**: Submit writes a spot check's
decisions like any others (only the decided rows of the sample; the rest of each file is untouched), and adds one
line to the pull request's description with the counts.

### 15.5 The result

`POST /api/admin/spot-checks` `{ reviewer, queue, rows }` makes one and answers `{ assignment, asked, drawn }`.
Every assignment view carries `spotCheck: { sample, result }` (null for the others), and the admin page shows it
on the spot check's row:

*50 in the sample · checked 12 · fine 9 · minor 2 · serious 1*, and under it the keys of the serious rows.

*Checked* counts the decisions on rows of the sample, submitted or not; a decision whose row changed since is left
out, and so is an unsubmitted one whose row is gone. A submitted decision on a row that is gone counts: a merged row
leaves the review files. *Fine* is a row kept as it is. The Overview's language rows do not count a spot check as
someone working on the language's flagged rows.

### 15.6 Left out

- Choosing the rows by hand.
- Comparing two AI reviewers.
- A result across several spot checks, or over time: each row of the admin list stands for one sample. After a
  reassignment that moves decisions, the ones already submitted stay with the closed assignment and its row.
- The rating in the row list; it is on the card.

### 15.7 Testing

- **Unit:** the share-out (even, remainder in order, redistribution), the draw (same seed same sample, fewer
  eligible than asked, ineligible rows never drawn), the overlap rule, the result's counting, its line of text.
- **Worker:** making a spot check and its refusals both ways, the rows served and their order, 403 for a row of
  the same file outside the sample, the severity required, refused and stored, a reassignment that keeps the
  sample, a submit that writes only the decided rows of the sample.
- **UI:** the question on Save and on Drop, both answers, Cancel, the keys; the admin form and the result.
- **E2E:** an admin makes a spot check beside a flagged-only assignment and is refused a second one and one beside
  an all-rows assignment; the reviewer drops, edits and keeps with the keys and submits; the admin reads the result.

## 16. Feedback

Decided by the product owner on 2026-10-10. Learners send feedback about the app itself to the learner app's server
(the learner app's design, §8.12). The coordinator reads it and works through it in the admin area's **Feedback**
tab.

### 16.1 Read live, keep only our own marks

The review app does not copy feedback. When the tab is opened, the Worker asks the learner app's server for the
messages and shows them. What the review app keeps is only what the coordinator adds: where a message stands and a
note, by the message's id.

A copy of learners' messages and contact addresses in a second database would have to be kept in step with account
deletion and export for ever. Read live, the address of a deleted account is gone from the tab the moment it is
gone from the server.

### 16.2 The link between the two services

`GET /v1/admin/feedback` on the learner app's server gives the messages newest first, in pages of at most 100
(`limit`, 50 when not named), older ones with `before=<id>`, filtered with `kind` and `since`, or the messages of
some ids alone with `ids` (1 to 100 ids with commas; an id it does not have is simply absent). It answers
`{ items, nextBefore }`; an item has the message, its kind, when it was received, the address given for an answer
(or none), whether the sender was signed in (never who), and the technical details the form showed. The route is
read-only.

It answers only to a request that carries the shared token (`authorization: Bearer …`), compared in constant time.
Without the token, with a wrong one, or while the server has none, it answers 404 with the body of a route that
does not exist. It is registered ahead of the browser guard on `/v1/*`, because its caller is a server and sends
no Origin; it reads no cookie, and the guard is unchanged for every other route and method.

The token is one random value of at least 32 characters, a secret named `FEEDBACK_READ_TOKEN` in both deployments,
set by the owner and never in the repository. The review app also needs the server's address, the variable
`LEARNER_APP_URL`. The Worker sends the token to that address alone and follows no redirect.

### 16.3 Storage

Migration `0004_feedback_marks.sql`:

```sql
CREATE TABLE feedback_marks (
  feedback_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('new', 'seen', 'done', 'declined')),
  note TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES reviewers(email)
);
```

A message with no row is new and has no note. Nothing a learner sent is in the table. (The AI help, §16.9, keeps
its own tables; with it switched on, `feedback_ai` holds text derived from a message.)

Migration `0005_weekly_mails.sql` adds `weekly_mails`, a row for each week the weekly mail (§8) was looked at:
`week` (the UTC date of the Monday the week ended on), `claimed_at`, `messages` (the count; null while a run holds
the row) and `sent_at` (null when no mail went, because no feedback came). A run takes the week by inserting its
row before it reads anything, so a job run twice sends one mail; a run that fails gives the row back, and a row
left unfinished for an hour is given up. It holds numbers and times only.

### 16.4 API

Both routes are for admins only, behind the same check as the rest of `/api/admin/*`.

- `GET /api/admin/feedback?kind=&state=&before=` makes one request to the learner app's server for a page of 50,
  joins each message with its mark and answers `{ connected: true, items, read, nextBefore }`. `kind` is `bug`,
  `idea` or `other`, and is filtered by that server. `state` is `open` (new or looked at), `all`, `done` or
  `declined`, and is filtered by the Worker after the page is read, because only the review app knows the marks.
  A filtered page can therefore be shorter than 50, or empty, while older messages remain: `read` says how many
  messages the page held before the filter, and `nextBefore` always leads on to the older ones.
- `PUT /api/admin/feedback/:id` takes exactly `{ state, note }`, with a note of at most 2,000 characters, and
  stores the mark with the admin and the time. Anything else is a 400. It sends nothing to the learner app's
  server, and it does not check that the server still has the message.

### 16.5 Not connected, or down

- **Not connected.** While `FEEDBACK_READ_TOKEN` or `LEARNER_APP_URL` is not set for the review app, the list
  answers `{ connected: false }` and the tab says, in one sentence, that feedback is not connected and names the
  two settings. Everything else in the app works.
- **Down.** When the learner app's server cannot be reached, answers anything but 200, or answers something that
  is not a page of feedback, the list answers 502 with a short message: that it could not be reached, or the
  status it answered. A 404 adds a reminder that the token must be the same in both deployments. Neither the token
  nor the server's own answer is passed on or logged. The tab says so and offers **Try again**; the marks already
  made stay in D1.

### 16.6 The tab

Newest first. Each message is a card: its kind as a chip (*Bug*, *Idea*, *Other*), when it was received in local
time, *signed in* or *not signed in*, the message with the learner's own line breaks, the address for an answer
as text with a link that opens a mail to it, and the technical details behind **Details** (app version, word list
version, language, screen, browser).

Under them is the coordinator's mark. **State** (*New*, *Looked at*, *Done*, *Not doing*) saves as soon as it is
chosen, and says *Saving…*, then *Saved*; when the save fails the control goes back to what it was and says why.
**Note** is saved with **Save note**; when that fails, what was typed stays. A message marked done stays on the
page until the list is read again.

Two filters: **Kind** (*All*, *Bug*, *Idea*, *Other*) and **Show** (*Open*, *All*, *Done*, *Not doing*), with
*Open* first. **Load more** reads the next, older page. With nothing at all the tab says *No feedback yet.* The
tab is in the address (`#feedback`), like the others, and the review app's own weekly mail (§8) links to it.

### 16.7 Left out

- Searching old feedback, and a count of open messages on the tab.
- More than one coordinator working at once: the last mark saved wins.
- Answering from the app: the address opens the coordinator's own mail program.
- Removing the mark of a message the server no longer has. (The AI's reading of such a message is removed: §16.9.)

### 16.8 Testing

- **Server:** the page and its order, the cursor, the filters, 404 with the body of an unknown route for every
  wrong or missing token and while no token is set, a request with no Origin, the guard unchanged for the other
  routes, nothing changed and the token never logged.
- **Worker:** admins only, one request a page with the token in a header, the join, each state filter, a short and
  an empty page that still lead on, not connected, unreachable, an error status, an answer that is not a page,
  the strict `PUT`; no table holds anything a learner sent.
- **The weekly job:** the week from the moment it runs (Monday, Tuesday, Sunday); the count by kind, with what
  came after the week's end left out and nothing older asked for; every active admin and nobody else; no message
  text and no contact address in the request to the mail service or in any log line; no mail in a week with none;
  a second run that asks nothing of anyone; the week given back when the server is not reached or the mail is
  refused; not connected; the cap. Every cron line of the config has a job and every job a cron line. The hosted
  browser run fires the trigger once and sees one read of the learner app's server, and none the second time.
- **The weekly job with the AI help:** the mail byte for byte the same while the help is off or not set up; the
  added lines; no message, address, translation or summary in the mail or the logs; at most 2 calls and one for
  300 unread messages, and "50 of 300"; the model down, the limit reached, and a failure of its own, each ending
  in the plain mail; a refused paragraph; the paragraph's request holding titles and counts only; a title written
  as an instruction changing no recipient.
- **UI:** the card and its details, a state saved and one refused, a note saved and one refused, the filters, Load
  more, not connected, unreachable with Try again, empty.
- **E2E:** against a fake learner app server, on a desktop screen and a phone: an admin opens the tab, sees two
  messages, marks one done, writes a note, filters, and finds the marks after a reload.

### 16.9 AI help

Designed in `2026-10-10-feedback-ai-help-design.md`; this is what is built of it so far (its §3.1: per message;
§3.2 and §3.3: topics and known issues, at the end of this section).
Off until an admin switches it on, and absent without the secret `FEEDBACK_AI_KEY`.

- **Routes,** admins only, answered with `cache-control: no-store`, registered before the mark's route so that
  `/api/admin/feedback/ai` is not read as a message called "ai":
  - `GET /api/admin/feedback/ai`: `{ setUp, needs, on, model, callsToday, dailyCalls, reads, repo }`; `needs` is
    the setting that is missing or wrong while it is not set up; `repo` is `APP_REPO`, for the links to issues.
  - `PUT /api/admin/feedback/ai` takes exactly `{ on }`; on while it is not set up is a 409 that names that setting.
  - `POST /api/admin/feedback/ai/read` takes exactly `{ kind, before }`, the page as the list names it, and never
    a message: the Worker reads that page again from the learner app's server, sends the messages with no result
    of the current prompt version to the model in one call (at most 25, the newest first), keeps what fits and
    answers `{ results, asked, left, why }`. Two requests go out at most. `results` holds the readings of the
    page's messages, the new ones and those kept before, so a tab whose list was read a moment before another
    request kept a reading still shows it.
  - `DELETE /api/admin/feedback/ai/results` forgets every result.
  - `GET /api/admin/feedback` gives each message its stored result as `ai`, and asks the model nothing.
- **Tables,** migration `0006_feedback_ai.sql`: `feedback_ai` (by message id: language, translation, category,
  severity, summary, the message's own time, the model, the prompt version, when); `feedback_ai_calls` (a row a
  call, counted before it is made, for the limit a UTC day); `settings` (the switch, with who set it and when).
- **A result goes when its message does:** reading a page of the list with no filter by kind removes the results
  kept between the page's ends for messages the server did not give. *Forget the AI's results* removes all.
- **Settings:** `FEEDBACK_AI_AUTH` (`key`, the default, or `google-service-account`), `FEEDBACK_AI_KEY` (secret: the
  key, or a service account's JSON key file), `FEEDBACK_AI_URL` (https; OpenRouter's by default with a key, on
  `googleapis.com` and with no default with a service account), `FEEDBACK_AI_MODEL`, `FEEDBACK_AI_DAILY_CALLS`,
  `FEEDBACK_READS`. With a service account the Worker makes an access token from the key file and keeps it in
  memory (design `2026-10-10-feedback-ai-help-design.md` §4).
- **Testing:** the masking; one call for a page with stored and new messages; the address for an answer, the
  browser and the versions in no request; a message written as an instruction, with an answer that obeys it,
  changes no mark and no setting; an answer that does not fit stores nothing; the limit and the next UTC day; the
  20 seconds; each failure said once; no log line with a message, a translation or the key; the request with and
  without what only OpenRouter knows; an address that is not https; the tab without the AI as it was. For the
  service account: the JWT's header, claims and signature, checked with a key made in the test; the token kept
  across two reads and made again after its hour; a key file, a token and a call that are refused. The hosted
  browser run reads the tab with a stand-in model, signed in as a service account, desktop and phone.

**Topics and known issues** (design §3.2, §3.3; prompt version 2):

- **What the model is given and answers.** With a page's messages the one call also carries `topics` (id and title
  of the 150 used most recently) and `issues` (number and title of at most 100 open issues, only while the list is
  less than 48 hours old; addresses in a title are masked). Each result has three more fields, flat, with one
  plain type each: `topic_id` (0 for none), `topic_new` (empty for none) and `issue` (0 for none). The check after
  the answer decides: a `topic_id` counts only when it was sent, and then the title is not read; with 0, a title
  counts when it is one line of 3 to 80 characters that masking would not change; an id that was not sent gives no
  topic; an `issue` counts only when it was sent; junk gets neither. A title some topic has (without regard to
  case) is that topic. Readings of prompt version 1 are asked again as pages are read, and shown until then; a
  reading whose topic was refused is kept and not asked again.
- **What an answer can change:** the row of each message asked about; a new topic; and a *proposed* match on a
  topic that has none. Never a mark, a topic's state, note or title, a confirmed or removed match, or the topic of
  a message the coordinator moved (`topic_by = 'coordinator'`).
- **Routes,** admins only, `no-store`, none of them asks the model:
  - `GET /api/admin/feedback/topics`: one line a topic (`count`, `newestAt`, `worst`, state, note, match), from D1
    alone; at most 500, the one with the newest message first.
  - `GET /api/admin/feedback/topics/:id`: `{ topic, items, more, incomplete }`: its 50 newest messages, read from
    the learner app's server by `ids` in one request. A reading whose message that server no longer has is
    dropped. A server from before `ids` gives its newest page instead: then nothing is dropped and `incomplete`
    is true.
  - `PUT /api/admin/feedback/topics/:id` takes exactly `{ title, state, note }`; a title another topic has is a
    409 that says to merge; a topic that becomes Done marks its messages done (those with a reading, keeping their
    notes); Not doing marks none.
  - `POST /api/admin/feedback/topics/:id/merge` takes exactly `{ into }`.
  - `PUT /api/admin/feedback/:id/topic` takes exactly `{ topic }`: the coordinator moves a message.
  - `PUT /api/admin/feedback/topics/:id/issue` takes exactly `{ issue }`: a number confirms, null removes, and
    after a removal the AI proposes none for that topic.
- **Tables,** migration `0007_feedback_topics.sql`: `feedback_topics` (title, unique without regard to case; state;
  note; issue and its state; whether it was renamed; who last worked on it); `feedback_ai` gains `topic_id` and
  `topic_by`; `open_issues` (number, title, when read); `open_issues_reads` (a row a UTC day, taken before the
  read). *Forget the AI's results* also drops the topics nobody has worked on.
- **The daily read.** Cron `0 5 * * *`: `GET /repos/{APP_REPO}/issues?state=open&per_page=100`, at most 3 pages,
  from GitHub's public API with no token (`GITHUB_API_URL` in tests). Pull requests are skipped. One read a UTC
  day at most, whatever comes of it; a refused read keeps what is stored and logs the status. `APP_REPO` is the
  public app repository as `owner/name`; without it no issue is read and no match is proposed.
- **The tab:** a *View* select, *Messages* or *By topic*. By topic: a line a topic, with *looks like #N* as a link
  and *Confirm* / *Remove* while proposed; opened, its messages as cards, *Rename*, *Merge into…*, state, note
  and *Issue number*. A card names its message's topic and has *Move to…*.
- **Testing:** an existing topic picked, a new one made and shared by two messages; a title with an address, and
  an id that was not sent, give no topic and are not asked again; a moved message stays moved through a new
  reading; a match proposed only from an issue that was sent, never over the coordinator's answer, and none once
  the list is 48 hours old; a message that orders topics, matches and marks, with an answer that obeys, changes
  nothing but the topic of the messages asked about; the routes' bodies; one outbound request to open a topic and
  none otherwise; the daily read without a token, once a day, keeping the list when refused. The hosted browser
  run reads By topic, confirms a match, renames, notes and marks a topic, desktop and phone, and fires the daily
  line.

**What an invocation asks of D1.** The Workers Free plan allows 50 queries of D1 in one invocation, and the
documentation does not say that a batch counts as one, so each statement of a batch is counted. Every path is
held to 40 in its worst case by `worker/d1Budget.test.ts`, with a counter around the test database
(`worker/d1Count.ts`): rows are written several a statement, under the 100 bound values a statement may have. A
page read by the AI runs 13 at its worst, the daily read of 300 issues 13, the weekly job 36. The weekly job reads
at most 2 calls' worth of unread messages for that reason, and its AI part runs under an allowance of 32
statements: the one that would go over is not run, the mail goes without the AI's part, and the record of the
mail always has its statement.

**The week and the drafted issue** (design §3.4, §3.5):

- **The week** is counted from `feedback_ai` alone: the readings whose message came in the period, by category;
  the five topics with the most messages; the blocking bugs by topic; the new topics. A topic is new in the period
  its first message came in (and never when it was made before the period): the AI makes a topic when it reads a
  message, which for the weekly job is after the week has ended. The tab's period is the seven days up to now; the
  mail's is the week that ended on the Monday.
- **The paragraph** is one call, counted, whose input is `{ messages, byCategory, topTopics, blockingBugs,
  newTopics }`: counts and titles, with no field a message, a translation or a summary could travel in. The
  answer is `{ paragraph }`; it is kept only when it is one paragraph of at most 600 characters that masking would
  not change. It is kept by period in `feedback_week_texts` (migration `0008_feedback_week_texts.sql`): `d:<UTC
  day>` for the tab, so it is asked for at most once a day, `w:<Monday>` for the mail. *Forget the AI's results*
  removes them; the weekly job removes those older than 30 days, and with them the counts of calls that old.
- **The draft** is one read of the topic's 30 newest messages by `ids` and one call, counted. The model is given
  the topic's title and count and each message as it gets any message (masked text, kind, language, screen). The
  answer is `{ title, body }`. It is dropped as `personal` when masking would change it or it names an account
  (`@name`), and as `quoted` when the title or the body shares a run of 6 or more words with a message as it was
  written or with its stored translation (case, punctuation and spacing aside). **Nothing of a draft is stored or
  logged,** and nothing is written to GitHub: the page links to `https://github.com/{APP_REPO}/issues/new` with
  the title and the body in the address, for the coordinator's own browser. Beyond 6,000 characters the body is
  left out of the address and the page offers **Copy the text**.
- **Routes,** admins only, `no-store`:
  - `GET /api/admin/feedback/week`: the numbers of the last seven days and the day's paragraph when one is kept;
    D1 only.
  - `POST /api/admin/feedback/week/paragraph` takes exactly `{}` and answers `{ paragraph, why }`: the kept one, or
    one call.
  - `POST /api/admin/feedback/topics/:id/draft` takes exactly `{}` and answers `{ ok: true, title, body, messages }`
    or `{ ok: false, why }`, where `why` is one of the AI's reasons, `quoted`, `personal` or `no-messages`.
- **The tab:** above the filters, a section *This week*, shown when the AI has read something of the last seven
  days: the paragraph under *Written by the AI*, the count, the categories, *Most messages*, *Blocking bugs*, *New
  topics*; a topic there opens By topic at that topic. With no paragraph kept and the help on, the tab asks for it
  once. On an opened topic, **Draft an issue** opens a dialog with the draft in two fields, **Open on GitHub**,
  and a field for the filed issue's number or address, which becomes the topic's confirmed match. The note on the
  privacy policy stands beside the switch only while the switch is off.
- **Testing:** the numbers of a seeded week; the paragraph's request holding titles and counts only, with the
  learner app's server not asked; a kept paragraph asking nobody; a paragraph with an address, of two paragraphs
  or too long not kept; a title written as an instruction changing nothing but the paragraph's words. The draft:
  `quotes` through case and punctuation, in Cyrillic, against a translation; a draft that quotes, and one with an
  address, a link or an account, dropped; the instructions tested for the rule; no table changed but the count of
  calls; a message written as an instruction, with an answer that obeys, changing nothing. The page: the link
  following the fields, the long text and the copy, each failure, the number saved. The hosted browser run reads
  the week and opens a draft, desktop and phone; the desktop run edits it, checks the link's address without
  following it, and pastes the number.

## 17. Accounts

Issue #187. The learner can delete their account in the app. The provider needs to do it too: for an erasure asked
for by mail, for an account closed, and for accounts not signed in to for 24 months, which the terms say may be
deleted and the privacy policy gives as the retention period. The accounts live on the learner app's server; the
review app keeps nothing of them.

### 17.1 The last sign-in

The server kept no date of a last sign-in, and sessions cannot give it: they go 60 days after their last use.
Migration `0010_last_sign_in.sql` adds `last_sign_in_at` to the `user` table. It is written when a session is made
(a sign-in) and when one is extended, which Better Auth does once a day of use: a learner who never signs out is
here, not away. No client reads or sets it.

**The accounts already there** when the migration runs are dated from that day. When they last signed in was not
kept, and no row left says it for certain: a session that was signed out of is gone, so the newest session left, or
the day the account was made, can both be earlier than the true last sign-in. Dating from the day of the migration
means no account is deleted sooner than 24 months after its last sign-in; the cost is that an account already
abandoned is kept that much longer than 24 months, at most by the age of the service on that day.

### 17.2 The sweep

A step of the learner app server's cron (`server/src/account/sweep.ts`), with the others in `runScheduled`:

- **The threshold** is a named constant, 24 months, counted as 731 days: the longest 24 months there are, so
  never a day early.
- **What it takes:** an account whose `last_sign_in_at` is before the threshold. Never one with no date. Never one
  with a session used since the threshold, whatever its date says: if the date were ever not written, a learner
  who is here is still not deleted.
- **Once a day, in batches.** The cron comes every 15 minutes. The first run of a UTC day takes that day's row in
  the table `account_sweep (utc_day, ran_at, deleted)`; every other run that day does nothing. A run deletes at
  most 50 accounts, the longest away first; the rest wait for the next day.
- **The same deletion** as the learner's own (`server/src/account/deletion.ts`), each account in a transaction of
  its own in which it is checked again, so one that signs in meanwhile is kept, and the day's count is exact
  wherever a run stops. One account that cannot be deleted does not keep the others.
- **No mail before.** Decided by the owner: the rule is in the terms, and that is the notice.
- **The log** has a count and nothing of an account.

### 17.3 The link between the two services

Four routes on the learner app's server, for the review app's server alone:

- `POST /v1/admin/accounts/lookup` with `{ email }` → `{ found: false }` or `{ found: true, createdAt, lastSignInAt }`.
- `POST /v1/admin/accounts/delete` with `{ email, confirm: true }` → `{ deleted }`.
- `GET /v1/admin/accounts/sweep` → `{ months, batch, due, undated, taken, lastRunAt, lastTaken }`.
- `GET /v1/admin/accounts/stats` → `{ readAt, accounts, made7, made30, studied7, studied30, newsGiven,
  newsWithdrawn, newsNone, reminders }` (#206): counts of now and the time they were read, never a list. `made`
  is by the account's creation; `studied` is the accounts with at least one answer in the last 7 and 30 days,
  read from the `device` rows (the time of the last answer accepted from each device), not from the answer log;
  the three `news` counts are the accounts by their consent to news; `reminders` is the accounts with at least
  one push subscription. On the edge counts as within. Nothing is logged.

The address is the whole address, compared without regard to capitals, and travels in the body: paths and queries
are logged. Two accounts that answer to one address are refused (409). Nothing is answered about an account beyond
the two dates.

They answer only to `authorization: Bearer …` with **`ADMIN_WRITE_TOKEN`**, a second secret of at least 32
characters, the same in both deployments. It is not `FEEDBACK_READ_TOKEN`: that one is named and documented as
read-only, it is sent by a timed job as well as by the tab, and a leak of what reads messages must not be able to
delete accounts. Neither token opens the other's routes; the server reads a write token equal to the read token
as none, and a deploy refuses it. Without the token, with a wrong one, or while the server has none, the routes
answer 404 with the body of a route that does not exist. Unlike `GET /v1/admin/feedback` they are registered
behind the guard on `/v1/*`: they change something, so the body is limited and a form post from another site is
refused like any other. They read no cookie.

### 17.4 The review app

Routes, admins only (behind the same middleware as every `/api/admin/*`), which run no statement of their own
against D1: `GET /api/admin/accounts/sweep` (`{ connected: false }` while `ADMIN_WRITE_TOKEN` or `LEARNER_APP_URL`
is not set), `GET /api/admin/accounts/stats` (the same when not set), `POST /api/admin/accounts/lookup` and
`POST /api/admin/accounts/delete`. The Worker passes on, field
by field, only what §17.3 names; its log has a status or a count, never an address.

The **Accounts** tab: first the accounts in eight numbers (#206: how many there are, made in the last 7 and 30
days, with reminders on, studied in the last 7 and 30 days, agreed to news, withdrew from news), with how many
have said nothing about news and when the numbers were counted; when they cannot be read the tab says so and the
rest of it works. Then the sweep in four numbers (past 24 months now, the next run deletes, deleted by the last
run, deleted so far) with the day of the last run, and the count of accounts with no date when there are any.
Under it, an address field and **Look up**: the account's address, when it was made and when it last signed in,
or that no account has the address. **Delete this account…** opens a question that says what goes and what stays;
its button is closed until the address is typed again. What is deleted is the account that was looked up: changing
the address in the field forgets it.

### 17.5 Left out

- A warning mail before the sweep.
- Blocking an address from signing up again after an account is closed.
- A record of who deleted which account: the logs say only that one was deleted.

### 17.6 Testing

- **Server:** the migration dating the accounts that are there; the date written at sign-in and when a session is
  extended, and unreachable by a client; the sweep taking only accounts past the threshold, never one with no date
  or with a session used since, never more than a batch, once a day, scrubbing like the learner's own deletion,
  logging a count; the routes' answers, 404 without the token and with the token that reads feedback, the
  confirmation, the ambiguous address.
- **Worker:** admins only; the address in the body and the write token in a header; only the named fields passed
  on; not connected; each failure in words; the three routes under the count of D1 statements.
- **Page:** the numbers, the lookup, the question and the typed address, each failure. The hosted browser run
  deletes an account on the desktop and opens the question on a phone, against the fake server.

## 18. Announcements

Issue #185. The provider has to be able to tell account holders something at once: that the terms change on a
date, that the service will be down, that a feature has shipped. The only channel that reaches every account
holder is the sign-in address. An announcement is written in the review app and sent by the learner app's server,
which holds the accounts and the mailer; the review app keeps nothing of it.

### 18.1 Two kinds, kept apart

- **Service notice** (changed terms or privacy policy, planned downtime, shutdown): part of providing the service.
  It goes to every account holder, carries no unsubscribe link, and says in one line that it goes to every account
  holder.
- **News** (new features): direct marketing. It goes only to accounts whose consent to news stands
  (`news_consent = 'given'`, issue #186), and every mail carries a link that withdraws that consent.

The kind is chosen when the announcement is written, shown in the question before the send, and typed by the owner
to confirm it. One announcement is of one kind.

### 18.2 What is kept (`server/migrations/0011_announcements.sql`)

- `announcement`: the kind, the texts (`{"en": {"subject", "body"}, …}`), a `version` raised by every change of a
  draft, `tested_version`, the status (`draft` → `sending` ⇄ `stopped`, `sending` → `sent`), the times, why the
  last run was held, and four counts (`recipients`, `sent`, `failed`, `skipped`). The counts are kept here so that
  they stay when an account is deleted.
- `announcement_delivery`: one row for each account an announcement goes to, with the account's language, its
  state (`queued`, `sent`, `failed`, `skipped`) and a random `send_key`. It references the account with
  `on delete cascade`: the learner's own deletion, the provider's by hand and the sweep (§17) all take it.
- `announcement_mail_day`: how many announcement mails went on each UTC day. A number.

### 18.3 The text

Plain text, and nothing else: the mail has no HTML part, so nothing written is markup to a mail program, and a link
is its address written out. A subject is one line of at most 150 characters with no control character, so it
cannot start a header; a body is at most 10,000 characters with no control character but the new line and the tab.
The rules are `validateAnnouncementTexts` in `core/src/announcement.ts`, used by the page's server and by the
learner app's server alike. English is needed; Bulgarian, German and Spanish are optional.

Under the text, after a signature line, the server adds why the mail came (for news, with the unsubscribe link) and
who sent it: the name of the service, the website and the public contact address. The sender is the server's
`EMAIL_FROM`, as for sign-in codes; `Reply-To` is the contact address, since the sending address has no mailbox.

**Language.** The app keeps the interface language on the device and does not send it as such. The server reads it
from what the app did send, the most direct first: the language the account's newest device asks its reminders
in; the language the account read the question about news in (`news-1.bg`); its native language from the synced
settings. An account that left none of these gets English. The account then gets the announcement's text in that
language where there is one, and the English one otherwise; the footer and the unsubscribe page follow the text.

### 18.4 The safeguards on a send

A mail cannot be taken back, so:

1. **A test send first.** `test` mails every language of the version to one address, made as the real mails are
   (the subject marked `[Test]`; a news mail's link is one that withdraws nobody's consent). Only when the mailer
   took them is `tested_version` set. A change of the draft is a new version, which needs its own test send.
2. **A confirmation that is typed.** The page reads from the server the kind and how many accounts would get the
   announcement now, shows both, and the owner types them (`service 1204`). The page's server refuses a send whose
   typed text is not that; the learner app's server is told the version, the kind and the number, and starts
   nothing if any is no longer so (the number is given back, to be read and typed again).
3. **Once.** Sending starts in one transaction with the announcement's row locked. From then on nothing of it can
   be changed, it cannot be tested or deleted, and it cannot be started again.
4. **Stop.** `stop` halts a send where it is; `resume` goes on with those not yet reached. A mail already handed to
   the mailer when stop is pressed still goes.

### 18.5 Who gets it, and how it is sent

**Who gets it is fixed when the send starts**: one `announcement_delivery` row an account, written in the
transaction that starts the send. An account made later is not among them. The one thing asked again is consent:
as each news mail is about to go, the account's consent is read, and one that was withdrawn since gets nothing
(`skipped`).

The press itself mails nobody. A step of the server's cron (`server/src/announcements/send.ts`, every 15 minutes)
sends, one mail at a time:

| Limit | Value | Why |
|---|---|---|
| Mails a run | 20 (`ANNOUNCEMENT_BATCH`) | One run is one invocation of the Worker, which on the free plan may make 50 requests to other services; the reminders of the same run are among them. |
| Wait between two mails | 500 ms (`ANNOUNCEMENT_SEND_INTERVAL_MS`) | The mail provider allows 10 requests a second for the whole account, shared with sign-in codes and the review app's own mails. |
| Mails a UTC day | 50 (`ANNOUNCEMENT_MAILS_PER_DAY`, a setting) | The provider's free plan sends 100 mails a day, sign-in codes among them, and a code must never be the one to wait. Test sends count. |
| A key holds | 23 hours (`ANNOUNCEMENT_KEY_WINDOW_MS`) | The provider keeps an idempotency key for 24 hours. |

Every mail is sent under a key (`announcement/<id>/<send_key>`): asked twice with one key, the provider sends one
mail. With the row, that makes a run safe to stop anywhere:

- the provider took the mail: the row is `sent` in the transaction that counts it, and no run takes it again;
- it will never take it (the address is none): `failed`, and the run goes on;
- it takes nothing now, or its allowance is used up: the mail waits as if untried, the run stops, and the tab
  says why. This is held against no account, however long it lasts. After "allowance used up" no run asks again
  that day;
- no answer came (a crash, the network): whether the mail went is not known. It is asked for again after 30
  minutes with the same key, at most five times and only while the key holds; after that it is `failed` rather
  than risked twice.

An announcement with no mail left waiting is `sent`.

### 18.6 The unsubscribe link

`GET` and `POST /v1/news/unsubscribe?t=<token>&l=<language>` on the learner app's server. The token names the
account and carries an HMAC-SHA-256 of that under the server's secret: it works without a sign-in, and nobody
without the secret can make one for an account. `GET` shows a small page with a question, in the language of the
mail, and changes nothing: mail scanners open every link. `POST` withdraws the consent through the same function
as the switch in the app's settings (`setNewsConsent`), and shows that it is done. Every news mail also carries
`List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so a mail program's own
button posts to the same address. That post is a form with no Origin, so the two routes stand before the guard on
`/v1/*`; they read no cookie, and the answer never says whether the account exists or had consented.

### 18.7 The link between the two services

On the learner app's server, behind `ADMIN_WRITE_TOKEN` like §17.3 (writing, testing and sending are all changes;
the token that reads feedback opens none of them):

- `GET /v1/admin/announcements` → `{ announcements, limits: { perDay, sentToday, batch } }`, the newest 50.
- `POST /v1/admin/announcements/save` `{ id?, kind, texts }`, `…/delete` `{ id }`, `…/preview` `{ id }`,
  `…/test` `{ id, version, email }`, `…/send` `{ id, version, kind, recipients }`, `…/stop` `{ id }`,
  `…/resume` `{ id }`.

Nothing answered is of an account: counts and times. The address of a test send travels in the body, is used for
that send and is kept nowhere. Logs on both sides have counts and statuses.

### 18.8 The review app

Routes, admins only, which run no statement of their own against D1: `GET /api/admin/announcements`
(`{ connected: false }` while `ADMIN_WRITE_TOKEN` or `LEARNER_APP_URL` is not set) and `POST
/api/admin/announcements/{save,delete,preview,test,send,stop,resume}`. Each passes on only the fields it names,
checks the texts as the server does, and says a refusal in words.

The **Announcements** tab: the list of what was written and sent (the kind, the state, `40 of 120 sent · 77 waiting
· 1 failed · …`, when, and what holds a send), with **Stop sending** and **Resume**. An announcement opens as a
form: the kind, a subject and a text for each language, then **Preview** (each language as it is mailed, and how
many accounts get which), the test send, and **Send…**, closed until this version's test went and nothing has been
changed since.

### 18.9 Left out

- Mail to learners without an account: there is no address.
- Scheduling a send for later, and recurring mails.
- Rich templates and HTML.
- The notice in the app when the terms change (issue #184).
- A record of who wrote or sent an announcement.
- Reading bounces and complaints back from the mail provider: a mail it accepted counts as sent.

### 18.10 Testing

- **Shared:** the check of the texts: English needed, the lengths, a subject that cannot break into a header.
- **Server:** the mail of each kind in each language; the token (made for one account, refused for another, refused
  without the secret); the page on GET changing nothing and the POST withdrawing, with no session and no Origin;
  the routes closed without the write token; the test send and the version; each refusal of a send; two presses at
  once; the recipients of each kind, fixed at the press; consent asked again; the language; the batch, the day's
  allowance, each kind of failure and the same key on a repeat; stop and resume; the rows going with a deleted
  account by the learner's deletion and by the sweep; logs with counts only.
- **Worker:** admins only; only the named fields passed on; the typed confirmation; each refusal in words; not
  connected; the routes under the count of D1 statements.
- **Page:** the list, writing and saving, the preview, the send closed until tested and saved, the question and the
  typed kind and count, a changed count, stop and resume. The hosted browser run writes, tests and sends a service
  notice on the desktop and opens the question for news on a phone, against the fake server. No test sends a mail.
