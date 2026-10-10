# Hosted review app — design

Date: 2026-10-05. Status: draft for the product owner's review.
Builds on: `2026-10-04-ai-review-and-review-app-design.md` (the local review app, §5; "Remote reviewers later", §8).
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
- The Worker has two cron triggers in `wrangler.jsonc`, written at the top level and in `env.production`:
  `0 6 * * 1` (Monday 06:00 UTC), the weekly feedback mail (§8), and `0 6 * * 2`, its second try on Tuesday. Each
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
(`limit`, 50 when not named), older ones with `before=<id>`, filtered with `kind` and `since`. It answers
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
- **UI:** the card and its details, a state saved and one refused, a note saved and one refused, the filters, Load
  more, not connected, unreachable with Try again, empty.
- **E2E:** against a fake learner app server, on a desktop screen and a phone: an admin opens the tab, sees two
  messages, marks one done, writes a note, filters, and finds the marks after a reload.

### 16.9 AI help

Designed in `2026-10-10-feedback-ai-help-design.md`; this is what is built of it so far (its §3.1: per message).
Off until an admin switches it on, and absent without the secret `FEEDBACK_AI_KEY`.

- **Routes,** admins only, answered with `cache-control: no-store`, registered before the mark's route so that
  `/api/admin/feedback/ai` is not read as a message called "ai":
  - `GET /api/admin/feedback/ai`: `{ setUp, needs, on, model, callsToday, dailyCalls, reads }`; `needs` is the
    setting that is missing or wrong while it is not set up.
  - `PUT /api/admin/feedback/ai` takes exactly `{ on }`; on while it is not set up is a 409 that names that setting.
  - `POST /api/admin/feedback/ai/read` takes exactly `{ kind, before }`, the page as the list names it, and never
    a message: the Worker reads that page again from the learner app's server, sends the messages with no result
    of the current prompt version to the model in one call (at most 25, the newest first), keeps what fits and
    answers `{ results, asked, left, why }`. Two requests go out at most.
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
