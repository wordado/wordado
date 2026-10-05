# Hosted review app — design

Date: 2026-10-05. Status: draft for the product owner's review.
Builds on: `2026-10-04-ai-review-and-review-app-design.md` (the local review app, §5; "Remote reviewers later", §8).

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
  never reads `pipeline.json`), its language (`bg`, `de`, `es`, or `en` for `level` and `english`), and per file:
  path, row count, flagged count, reported count.
- A file's JSON: `{ "file": "review/translation-de/2026-10-03-01.csv", "version": "<sha256 of the CSV>", "rows":
  RowView[] }`, where each `RowView` (local `types.ts`) gains `rowHash`: `rowContent(queue, proposed, reopened)`,
  the same hash the AI-review store keys on. Rows in queues without AI review (`english`, `audio`) are included with
  `ai: 'unreviewed'` and no objections; `audio` is left out (§12).
- The snapshot holds rows only: never the draft, the decisions log, or the corpus as a whole.

### 4.2 Building

`review-app snapshot <content> <out>` needs `work/draft.json`, so the action runs `corpus draft --offline` first
(free, as the `ai-review` job does). It reuses `model.ts` with other senses included, so a row reads the same in both
apps.

### 4.3 Publishing

A `snapshot` job in `corpus.yml` builds from `main` only, so a reviewer never sees rows that are not merged. It
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

- **Languages:** a reviewer can be assigned a queue only in one of their languages. `en` covers `level` and
  `english`.
- **No overlap:** creating an assignment fails when another open assignment on the same queue shares a file; `"*"`
  shares every file. So a row has at most one reviewer. A flagged-only assignment takes a file list too, so the
  flagged rows of one queue can be shared out as well.
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
- **Change languages:** removing a language closes that reviewer's open assignments in it, as above.

## 6. API

The reviewer API is the local app's (spec 2026-10-04 §5.4), scoped to the signed-in reviewer:

| Route | Hosted behaviour |
|---|---|
| `GET /api/me` | email, name, role, languages; 403 when not invited or disabled |
| `GET /api/assignments` | the reviewer's open assignments with progress (§6.1) |
| `GET /api/queues` | summaries of the queues the reviewer has open assignments in |
| `GET /api/rows?assignment=<id>&all=1` | the assignment's rows from the current snapshot (flagged only unless `all`, and only flagged ones at all for a flagged-only assignment), each with the reviewer's unsubmitted decision as `decided` |
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
3. For each decision, compute the row's hash from the sidecar's `proposed` and the CSV's `reopened`. A missing row
   or a different hash is left out (`gone` / `changed`) and stays unsubmitted; the response lists it and the UI
   shows it again.
4. `applyDecisions` per file; commit all changed files as **one commit** (Git Data API: blobs, tree, commit) on a
   new branch `review/<queue>-<reviewer-slug>-<yyyymmdd>-<n>` from `main`'s current commit. Commit author: the
   reviewer's name with the app's noreply address; message `review: <queue>, <n> decisions by <name>`.
5. Open a pull request titled `<queue>: <n> decisions by <name>` whose body lists the counts per action and
   per file and the reviewer's notes. Record the submission and mark the decisions with it.
6. Email the admins (§8).

If any GitHub call fails before the pull request exists, nothing is recorded: the decisions stay unsubmitted, the
reviewer sees *could not reach GitHub, try again*, and a later Submit uses a new branch name (`<n>` + 1). A branch
left behind without a pull request is harmless; the admin page lists such branches for deletion.

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

A failed send never fails the action: the reviewer is still created (the admin page shows *invite not sent* and
the link to copy), and a submission is still recorded.

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
  `GITHUB_WEBHOOK_SECRET`, `RESEND_API_KEY` (Worker); `R2_REVIEW_ACCESS_KEY_ID`, `R2_REVIEW_SECRET_ACCESS_KEY`
  (wordado-content). Variables: `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `ADMIN_EMAIL`, `GITHUB_APP_ID`,
  `GITHUB_INSTALLATION_ID`, `CONTENT_REPO`, `APP_ORIGIN`.
- **Private content stays private:** the R2 bucket has no public access; the app repository holds code and test
  fixtures only, never corpus rows.

## 11. Errors

| Situation | What the reviewer sees |
|---|---|
| Row changed in a new snapshot after they decided it | *Changed since you decided it*, with the new proposal; the old decision is kept but not submitted until they decide again |
| Row gone (imported, dropped by a new draft) | the row disappears; an unsubmitted decision on it is discarded with a notice |
| No snapshot yet / R2 unreadable | *The review data is not available yet*; admin sees the snapshot status |
| GitHub unreachable at Submit | *Could not reach GitHub, try again*; nothing submitted |
| Not invited / disabled | a plain page: ask the coordinator for an invite |
| Access token missing or invalid | 401 (Access's own sign-in page normally comes first) |

## 12. Out of scope

- Several reviewers voting on one row (one reviewer per row, §5).
- Audio review in the browser (the `audio` queue stays on files).
- Polishing the layout for phones (it must work, not shine).
- Learner reports as an assignment source of their own (reported rows already come first in a queue).

## 13. Testing

- **Unit:** `applyDecisions` (all actions, columns outside the queue ignored, empty note keeps the old one, left-out
  rows), the snapshot builder against the local app's fixture, assignment overlap, row-hash checks, the Access JWT
  check (valid, wrong audience, expired, bad signature), the GitHub App JWT signing, the webhook signature.
- **Worker:** Vitest with Wrangler's Workers pool: local D1 and R2 holding a fixture snapshot, a fake GitHub API
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
- `review-app/README.md` gets a *Hosted* section with the one-time setup: the D1 database and R2 bucket, the
  Access application and policy, DNS for `review.wordado.com`, the GitHub App (permissions, webhook URL, install
  on wordado-content), the Resend key, the R2 keys in wordado-content, and the variables of §10.
- The steps that change wordado-content (`corpus.yml` snapshot job, `review-import.yml`) go in as a pull request
  there, with the product owner's go-ahead, and `PIPELINE_REF` moves to a commit that has `review-app snapshot`.
