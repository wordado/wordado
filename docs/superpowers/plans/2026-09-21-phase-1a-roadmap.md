# Phase 1a — Plan Roadmap

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`

The spec covers six packages and is too large for one implementation plan.
Phase 1a (the MVP, spec §14) is split into eight plans. Each produces working,
tested software on its own, and each is written just before it is executed, so
that it can use the real interfaces of the plans before it.

## Sequence

| # | Plan | Package | Delivers | Needs |
|---|---|---|---|---|
| 1 | **Core learning engine** — `2026-09-21-core-learning-engine.md` | `core` | Workspace; word IDs; grade mapping; FSRS scheduler and desired retention; event replay; mastery tiers; level path and unit unlocks; session composition; mode selection; distractors and matching boards | — |
| 2 | **Core rules: motivation and sync** — `2026-09-22-core-motivation-and-sync.md` | `core` | XP and daily cap; streaks from `day_complete`; event stamping (§9.2); the rebase rule (§4.3); document field-merge and tombstones; entitlement and the capability check; retention rate and level completion; placement test scoring | 1 |
| 3 | Pack format and sample pack | `core`, `pipeline` | Pack schema (`schema_version`, entries, units, themes, audio manifest), validator, checksum, manifest-as-list; a hand-made ~60-entry A1 Bulgarian sample pack with audio, used by demo mode and by every later test | 1 |
| 4 | Client data layer | `client-data` | `SqlDriver` interface and in-memory driver; local schema and migrations; pack loader; repositories; outbox; sync engine (push, pull, retry, backoff, min-version gate); React hooks | 1–3 |
| 5 | Server | `server` | Postgres schema and forward-only migrations; Better Auth (email OTP, Google); sync endpoints; server-side stamping, replay and XP; re-derivation through Queues; entitlement; content reports; account deletion and JSON export; Web Push reminders by Cron Trigger | 1–3 |
| 6 | Web client | `web` | Vite + React PWA; wa-sqlite over OPFS with IndexedDB and in-memory fallbacks; single-tab lock; the four game modes; onboarding, demo carry-over and age gate; path, themes, dashboard and settings; Bulgarian and English interface; WCAG 2.2 AA | 4, 5 |
| 7 | CI and deploy | repo | GitHub Actions: typecheck, lint, suites, server tests against a Postgres service; Wrangler deploy and preview deployments; end-to-end browser matrix | 5, 6 |
| 8 | Corpus pipeline | `pipeline` | Frequency data → CEFR banding → translation → review queues → TTS → packs → R2; pipeline tests (§13); the manually started workflow | 3, **legal review** |

Plans 4 and 5 are independent of each other and can run in parallel. Plan 8 can
start as soon as its legal review clears and does not block 4–7, which run
against the sample pack.

## Blockers outside the code

- **Legal review** (spec §15) gates plan 8: licences of candidate frequency
  lists, and the per-country age-of-consent table the age gate in plan 6 needs.
- **Docker is not installed on this machine.** Plan 5 runs Postgres in Docker
  (spec §4.4). Install Docker Desktop, OrbStack or Colima before plan 5.
- **A name and domain.** Resend needs a verified sending domain before sign-in
  emails can be sent from a deployed beta (`docs/research/2026-09-21-app-name-research.md`).
  Local development prints codes to the console and is not blocked.
- **Spec approval table (§16).** Several † rows still read "Pending". The plans
  follow the spec as written; update the table when the sign-off is formal.

## Contracts `core` hands to the later plans

Found while reviewing plan 1. `core` cannot enforce these itself; each is a requirement on the plan named.

- **Time-zone offset is validated at ingest** (plans 4, 5). `clientTzOffsetMin` is minutes to add to UTC
  (UTC+2 → `120`; the negation of `getTimezoneOffset()`), a finite integer within −720…+840. A `NaN` offset
  turns a word's stability into `NaN` silently and for good.
- **`today` is computed once per render or session** as `localDay(now, offset)` with the device's *current*
  offset (plans 4, 6). The home screen and a session make the same `composeSession` call.
- **`reviewsDoneToday` is one shared helper** over today's events: distinct words, introduced before today,
  with their first scheduled review today (plans 2, 4). Two implementations would make the cap and the backlog drift.
- **Settings are validated before they reach `core`** (plan 4): new-word limit finite and 0–30; desired
  retention within (0, 1].
- **The server enforces `review_id` uniqueness, first write wins** (plan 5). Replay resolves a collision
  deterministically, but a collision is corruption, not sync.
- **Alias writes are validated** as `u:` → `c:` and acyclic (plan 5). `resolveAlias` throws on a cycle, which
  would abort a learner's whole replay.
- **Tombstoned user words derive no state** (plan 2): filter them out of replay's result.
- **Relearning across local midnight** counts as one elapsed day (23:55 *Again*, 00:05 retry). It follows from
  spec §8.4's local date. If it proves too generous, add a day-rollover hour as a scheduler rule (a version bump).
- **First edits of plan 2:** the stale `SessionPlan.reviews` comment; `lastReviewDay >= today` for the
  relearning group; one off-24h step in the `SCHEDULER_VERSION` pin.

## Open items from spec §15

Each is resolved in the plan that first needs it, and recorded in that plan's
header. Plan 1 settles: slow-answer thresholds, desired-retention targets,
mastery-tier thresholds, the new-word limit and review cap defaults, the
same-day relearn delay, what a scheduling day is, and what counts as a lapse.
