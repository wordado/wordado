# Working in this repository

Wordado is an English vocabulary app. This repository holds the learner app (`web/`), its server (`server/`),
the shared logic (`core/`, `client-data/`), the content pipeline (`pipeline/`) and the review app
(`review-app/`). The designs are in `docs/superpowers/specs/`, the build plans in `docs/superpowers/plans/`.

## GitHub issues are the record of work

Issues are how work is planned and remembered between sessions. A session does not know what an earlier one
did unless it is written there.

- **At the start,** read what is open: `gh issue list --state open` (and the issue you are asked about, with
  its comments: `gh issue view <n> --comments`). Milestones `Beta` and `Launch` say what is planned for when;
  no milestone means later.
- **Before building,** there is an issue for the work. If there is none, open one: the problem, what was
  decided and by whom, what is in scope, what is left out. Labels: an area (`app`, `review-app`, `site`,
  `corpus`) and a kind (`bug`, `feature`, `chore`).
- **While working,** keep the issue true: the plan as a checklist, decisions as they are made, and a comment
  when work stops part-way saying what is done, what is next and where the branch is. A later session picks
  up from that comment.
- **The pull request** says `Closes #<n>`. What a review leaves for later becomes its own issue, not a line
  in a report.
- A design that needs more than an issue goes in `docs/superpowers/specs/`; the issue links to it.

## This repository is public

Never write in its issues, pull requests, commits or files: business plans, pricing or launch dates;
reviewers' or learners' names or email addresses; text from the private corpus; anything about keys,
tokens or accounts. Corpus and review work is tracked in the private content repository, the marketing
site in its own private repository.

## How changes land

- Work on a branch in a worktree under `.worktrees/`, never on `main`. Changes go through pull requests;
  the owner merges and approves deployments.
- Before a pull request: the tests of every package touched, `pnpm -r typecheck`, `pnpm lint`, and the
  browser run for the app that changed. Some browser tests (`web/e2e/accounts.spec.ts`) need the real
  server and run only in CI: read them when a change touches what they assert.
- Say plainly what was checked and what was not.
