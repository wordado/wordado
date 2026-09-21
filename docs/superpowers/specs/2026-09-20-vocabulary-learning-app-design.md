# Vocabulary Learning App — Design Specification

**Status:** Revised after design review — pending re-approval (see §16)
**Date:** 2026-09-20
**Working name:** VocApp

---

## 1. Summary

A cross-platform application for learning English vocabulary. Learners study a
curated, CEFR-levelled corpus of English words with translations into their
native language, maintain a personal dictionary of their own words, and
practise through game modes driven by a spaced-repetition scheduler. Progress
is tracked honestly, and weekly leagues provide social motivation.

Target language is always English. The learner's native language (L1) varies.
The data model carries an explicit target-language field so additional target
languages can be added later without migration, but only English ships.

**Platforms:** browser (desktop and mobile web) first; iOS and Android follow
the MVP (§14).

---

## 2. Goals and non-goals

### Goals

1. A learner can go from zero to studying in under two minutes. The onboarding
   budget that makes this true is in §8.6.
2. Study works with no network connection; progress reconciles on reconnect.
3. The built-in corpus is identical on every device and every platform running
   the same corpus version.
4. Words a learner adds themselves are first-class — usable in every game mode,
   scheduled by the same algorithm as built-in words.
5. Progress reporting distinguishes motivation metrics (XP, streaks) from
   learning metrics (retention, mastery).
6. Competition is always plausibly winnable, for a beginner and a veteran alike.
7. No learning data is ever discarded by the system. Anti-cheat, clock
   problems, and version skew may cost a learner XP; they never cost a review.

### Non-goals

Explicitly out of scope for this specification. Each is a plausible future
product; none belongs here.

- Grammar instruction or explanation
- Conversation or speaking practice
- Teacher, classroom, or organisation accounts
- User-to-user content sharing or community-authored word lists
- Pricing, subscriptions, or payment handling. (The free-tier principle, the
  entitlement architecture, and a proposed model are in §8.8, so that charging
  later needs no migration; prices, providers, and checkout are not specified
  here.)
- Target languages other than English
- Native desktop applications (macOS/Windows binaries)

---

## 3. Product decisions

These were settled during design and are not open questions, with one
exception: rows marked † were changed after the original approval and are
awaiting confirmation. §16 lists every such change and its status.

| Decision | Choice | Rationale |
|---|---|---|
| Language direction | English target only; multi-target-ready schema | Single corpus, N translation columns. Avoids a migration if scope grows. |
| Core loop | FSRS spaced repetition, with a CEFR level path layered on top | Scheduler decides *what* to study; the level path decides what is *available* to study by default. Collections and linked personal words can pull a word forward (§8.9, §6.1). |
| Memory model | One FSRS state per word, not per (word, skill) | Per-skill state multiplies review load by the number of skills. Mode escalation compensates; see §7.5. |
| Offline | Offline-first with sync | Retrofitting offline support is far more expensive than building it in. |
| Desktop | Browser web app | No install, instant updates, doubles as the marketing surface. |
| Accounts † | Account required to persist; demo session carries over on sign-up | Every persisted record has a `user_id` from creation; no anonymous-profile claim/merge logic. See §8.6. |
| Personal words | Server-side auto-enrichment, user-editable | Makes user-added words usable by listening and context games. |
| Leaderboards | Weekly leagues (default) + friends + opt-in global | Leagues keep competition winnable and bound cheating payoff. |
| Architecture | Shared TypeScript core and client data layer; React web; Expo mobile (after the MVP); Hono on Cloudflare Workers with Postgres | The expensive-to-get-wrong logic exists exactly once. |
| MVP client | Web only (decided 2026-09-21) | One client proves the core loop. `core` and `client-data` make mobile mostly view work afterwards. Replaces the earlier decision to launch on all three platforms. |
| Hosting | Cloudflare: Workers, R2, Queues, Hyperdrive | One platform, free egress for audio and packs, generous free tiers. Constraints in §4.4. |
| Spend | The MVP runs on free service tiers | A beta should cost almost nothing to keep alive. Every vendor sits behind an interface and is listed, with its limits, in §17. |
| Build | GitHub, with GitHub Actions for CI, deploy, and the corpus pipeline | One place for code, checks, and releases (§4.4). |

### Launch configuration

The full product is described first; the MVP subset follows.

- **MVP (Phase 1a):** web client only; Bulgarian; A1–B1; flashcard, multiple
  choice, listening by selection, matching. See §14.
- **CEFR levels:** A1, A2, B1, B2, C1. (C2 is out of scope.)
- **Native languages (L1):** Bulgarian, Spanish, German, French, Russian.
  Bulgarian is the lead language and ships first (§14): competitor research
  found it the least-served of the five by a wide margin, and Russian the most
  contested.
- **Game modes:** flashcard, multiple choice, listening, typing/fill-in-the-blank,
  matching (practice only).

---

## 4. Architecture

### 4.1 Package layout

A monorepo with six packages.

```
core/         Pure TypeScript. No I/O, no framework, no platform APIs.
              SRS scheduler, level gating, game session state machine,
              distractor generation, sync reconciliation, XP and streak
              derivation, validation.

client-data/  Shared by web and mobile. Local schema and migrations,
              repositories, outbox, sync engine (push/pull, retry,
              backoff), corpus pack loader. Talks to SQLite through a
              small SqlDriver interface; knows nothing about which
              SQLite it is. Also holds presentation-agnostic React hooks
              (session, progress, sync status).

web/          React + Vite. Implements SqlDriver with wa-sqlite over OPFS.
              Service worker for offline shell and asset caching.

mobile/       Expo (React Native). Implements SqlDriver with expo-sqlite.
              OTA updates via Expo Updates. Not part of the MVP (§14).

server/       Hono on Cloudflare Workers. Postgres through Hyperdrive
              (sole store of record). R2 + CDN (audio, packs).
              Queues for batch jobs. See §4.4.

pipeline/     Build-time corpus pipeline (§5.4). Runs in GitHub Actions,
              never at runtime. Produces packs and uploads them to R2.
```

`core` is the only place learning rules exist. Clients are renderers over it.
This is the central architectural constraint: if a scheduling or grading rule
appears in `web/` or `mobile/`, it is a defect.

`client-data` exists for the same reason. The outbox and sync engine do I/O,
so they cannot live in `core` — but they are exactly the code where two
implementations would diverge silently. If outbox or sync logic appears in
`web/` or `mobile/`, it is a defect. The two clients differ only in their
`SqlDriver` implementation and their views.

Because `core` has no I/O, the majority of the test suite runs in-process with
no device, emulator, or database. `client-data` is tested in-process against an
in-memory SQLite driver.

### 4.2 Why the UI is written twice

The choice was between sharing the UI (Flutter, a Capacitor-wrapped PWA, or
Expo for web via react-native-web) and sharing the logic. Logic sharing won:
the scheduler, the sync protocol, and the grading rules are where divergence is
expensive and bugs are silent, and they are shared completely. The UI is
comparatively cheap, and writing it natively per platform gives a real browser
experience on desktop (where a canvas-rendered or webview-wrapped app is
noticeably worse) and a real native feel on mobile.

Expo for web deserves a specific answer because the stack is already React on
both sides. It was rejected for the views — react-native-web output is a poor
fit for the desktop browser, which doubles as the marketing surface — but most
of its benefit is captured anyway: both clients are React, so everything below
the view layer (hooks, view-models, session and sync state) is shared through
`client-data`. Only the leaf components are written twice.

The MVP ships the web client alone (§3). Nothing above changes: the argument
is about where sharing pays, and `client-data` is built against the `SqlDriver`
interface from the start so that the mobile client, when it comes, is views and
one driver.

### 4.3 Version skew

`core` exists once in source but in many deployed versions: the server runs
one, and every installed client runs whichever it shipped with. Three rules
keep that safe.

1. **Every `review_event` records the `scheduler_version`** of the `core` that
   produced it. The grade stored in the event is a fact about what happened;
   it is never recomputed.
2. **The server's derivation is authoritative.** Clients derive review state
   locally for offline use and replace it with the server's on pull (§9.2).
   When the server's scheduler version changes — a new FSRS release or new
   parameters — it re-derives all review state from the event log, and clients
   receive the result on their next pull. Any change to scheduling rules or
   parameters is a version bump. Mastery-tier thresholds are presentational:
   changing them re-labels existing state and needs no re-derivation.
3. **A minimum client version gates sync.** The sync API refuses clients below
   `min_sync_version` with an upgrade-required response. The client keeps its
   outbox intact and uploads after upgrading. Study continues offline in the
   meantime.

**The rebase rule.** Every derived state the server returns carries, per
device, the highest `device_seq` it included. A client replacing its local
state with the server's then re-applies its own events above that mark — the
ones still in its outbox or pushed after the server's snapshot — so a pull
never rolls back answers the learner has just given.

**A client older than the server's scheduler** keeps working. Its local
derivations are provisional, and the server's replace them at the next pull;
due dates may differ by a day or so in between, which is tolerable. When a
scheduler change is large enough for that to matter, `min_sync_version` is
raised with it.

**What the learner sees after a re-derivation** is, at most, a changed
due-today figure. Re-derivations are rare and deliberate, are run when few
learners are active, and are noted in the release notes; they never discard an
answer.

Floating-point results may differ in the last bits across JavaScript engines
(Hermes, V8, JavaScriptCore). This is harmless because of rule 2; conformance
tests compare client and server derivations within a tolerance (same due day,
stability within a small relative epsilon) rather than bit-for-bit.

### 4.4 Platform and build

**Cloudflare Workers shape the server.** A Worker is a request handler, not a
long-running process, and that has four consequences.

1. *No Node-only APIs in `server/`.* `core` is already pure TypeScript, which
   is what lets the same replay code run in the browser and in a Worker. Hono
   also runs on Node, so the exit path from Workers is a change of adapter,
   not a rewrite.
2. *Postgres is reached through Hyperdrive*, which pools connections to a
   managed Postgres in an EU region. The data model in §6 is unchanged:
   transactions, ICU collations, and a large `review_event` table all remain
   available. D1 was considered and rejected for the store of record — it is
   SQLite with a single writer and a small size cap — though it would do for
   a beta if Postgres hosting ever became the obstacle.
3. *CPU time per request is capped*, tightly on the free plan. Request
   handlers must stay light: sync ingests a page of events and re-derives only
   the words those events touch. Anything heavier is a batch job.
4. *Batch jobs run through Queues.* The full re-derivation of §4.3 is fanned
   out as one message per user, each small enough to finish inside a consumer's
   limits and safe to retry. League rollover (Phase 2) uses the same pattern,
   started by a Cron Trigger.

Audio and corpus packs live in R2 behind Cloudflare's CDN; R2 charges nothing
for egress, which is what makes lazy audio fetching (§9.3) cheap.

**GitHub and GitHub Actions carry the build.**

- *CI on every pull request:* typecheck, lint, the `core` and `client-data`
  suites, and server integration tests against a Postgres service container.
  Nothing merges red.
- *Deploy on merge to `main`:* database migrations (forward-only), then the
  Worker and the web app's static assets, through Cloudflare's Wrangler action.
  Pull requests get a preview deployment.
- *The corpus pipeline is a manually started workflow.* It builds the packs,
  runs the corpus pipeline tests (§13), uploads packs and audio to R2, and
  only then publishes the new version manifest — so a client can never see a
  version whose files are not all in place.
- *Secrets* (Cloudflare API token, database URL, vendor keys) live in GitHub
  environment secrets, never in the repository. Production deploys use a
  protected environment.
- Mobile builds are out of scope until the mobile client exists.

**Local development.** The whole MVP runs on a developer's machine, with no
cloud account and no network connection. Cloudflare hosts the deployed product;
it is not needed to build or run it.

- *One command starts everything:* the web app on the Vite dev server, the
  Worker beside it, and a Postgres container.
- *The Worker runs locally in the production runtime.* Wrangler (or the
  Cloudflare Vite plugin) runs it through Miniflare on `workerd`, the same
  runtime Cloudflare uses, with R2 and Queues simulated on disk.
- *The database is Postgres in Docker* — the same image CI uses. Hyperdrive is
  bypassed locally: the binding is pointed straight at the container through
  its local connection string, supplied as an environment variable so that no
  credentials reach the repository.
- *External services are stubbed.* Sign-in codes are printed to the console
  instead of being emailed; the LLM gateway and TTS are replaced by fixtures;
  Google sign-in works against a `localhost` redirect registered for
  development. A seeded sample pack and its audio load from the local R2
  simulation.
- *Browser features work on `localhost`,* which browsers treat as a secure
  context: OPFS, the service worker, installation, and Web Push.
- `core` and `client-data` need only Node: their suites run without the Worker,
  the database, or a browser.

**What local runs do not prove.** Platform limits — above all the CPU cap
(§17) — and Hyperdrive's pooling are only real on Cloudflare. Every pull
request therefore gets a preview deployment, and anything CPU-sensitive (event
replay on sync, queued re-derivation) is exercised there before merge, not only
locally.

---

## 5. Content

### 5.1 Corpus packs

Built-in content is a **versioned build artifact, not editable rows**.

A build-time pipeline produces numbered corpus packs, one per (version, L1)
pair, each containing every level:

```
corpus-v7-bg.pack
corpus-v7-es.pack
...
```

At ~7,100 text entries a full pack is on the order of a megabyte or two, so
packs are not split by level and updates are whole-pack refetches, not deltas.
Shipping every level in one pack also gives the client a complete headword
index, which personal-word linking depends on (§8.2).

A client's content is described by a **pack manifest, which is a list**. At
launch the list has one item — the corpus pack for the learner's L1 — but the
loader accepts several, each with its own version and checksum, and entry IDs
are unique across packs. This costs nothing now and keeps separately
distributed content possible later (§8.8) without changing the loader or the
ID scheme.

Each pack contains entry records, unit definitions, theme definitions (§8.9),
and an audio manifest (URLs
and checksums; audio files themselves live on the CDN and are fetched
separately). Clients download the pack for their L1, verify a checksum, and
load it into local SQLite as read-only data.

Publishing new content means publishing version *n+1*. A given corpus version
is immutable and byte-identical everywhere — which matters, because
spaced-repetition state points at corpus entries by stable ID for years.

**Stability rules across versions:**

- Entry IDs and unit IDs are stable. An ID is never reused.
- A **revised** entry (corrected translation, new example) keeps its ID and its
  learners' review state.
- A **retired** entry stays in the pack flagged `retired`. It is never
  introduced as a new word and never used as a distractor, but learners who
  already have review state for it keep reviewing it.
- An entry that **moves** to another unit or level carries its review state
  with it. Unit unlocks are never revoked by a corpus update; completion
  percentages are simply recomputed.
- **Retired entries are invisible to every progress rule** — unit unlocking,
  unit and level completion, theme size. A rule that waited for a retired word
  to be introduced would wait forever (§7.2).

**Versions and compatibility.** The corpus version number is global; the
manifest lists which L1 packs exist at each version, since L1s are released at
different times (§14). Every pack carries a `schema_version`. A client that
meets a pack schema newer than it understands keeps its current pack and asks
the learner to update the app. A downloaded pack is swapped in at the start of
the next session, never in the middle of one.

### 5.2 Entry contents

**An entry is one sense of a headword**, not a headword. *bank* (noun, money)
and *bank* (noun, river) are two entries with two IDs, two translation sets,
and independent review state. Identity is (headword, part of speech, sense).
Most headwords at A1–B1 need only one entry; the pipeline splits only where
the L1 translations genuinely diverge.

Each corpus entry carries:

- Headword (English), plus accepted spelling variants (*colour* / *color*)
- Part of speech
- Sense gloss — a few words, per L1, shown wherever the headword alone is
  ambiguous ("bank — *money*")
- IPA transcription
- CEFR level (A1–C1)
- Audio reference (TTS-generated at build time, UK and US where sensible)
- Example sentences in English: at least one when a level first ships, three
  to five by the time cloze ships for that level (§14). With only one or two,
  learners memorise the cloze sentence instead of the word.
- Optional image, for concrete A1–A2 nouns only (Phase 2). Images must be
  generated in-house or carry a licence permitting commercial use (§5.4).
- Per supported L1: one primary translation plus accepted alternates
- Theme tags, drawn from a curated theme list. An entry may carry several.
  Themes group words into units and are offered to the learner as theme
  collections (§8.9).
- Exam tags (Phase 3; see §8.9)
- `retired` flag

### 5.3 Corpus scale

Approximate targets per level, counted in entries (senses):

| Level | Entries |
|---|---|
| A1 | ~600 |
| A2 | ~1,000 |
| B1 | ~1,500 |
| B2 | ~2,000 |
| C1 | ~2,000 |
| **Total** | **~7,100** |

### 5.4 Sourcing and licensing

The corpus is built in-house:

1. Candidate headwords drawn from open frequency data (e.g. subtitle- and
   web-derived open frequency lists).
2. CEFR banding assigned by frequency band plus LLM classification.
3. Native-speaker spot-check of banding and of every translation set.
4. Example sentences generated and human-reviewed.
5. Audio generated by batch TTS at pipeline time, to a **quality bar**: a
   neural voice, a native-speaker spot-listen of a sample from every batch, and
   automatic re-generation of any clip reported through the in-app
   report-an-error path. Robotic audio is a named complaint against
   competitors that use TTS, and several rivals advertise human recordings.

**Constraint:** the Oxford 3000/5000 and the English Vocabulary Profile are
licensed works. Their word lists and level assignments must not be copied. See
§12, Risk R1.

**Constraint:** "open" does not mean "commercially usable". Several widely used
frequency lists are share-alike (CC-BY-SA) or research/non-commercial only.
Every input to the pipeline needs a licence that permits commercial use
without imposing share-alike on the resulting corpus. The same check applies
to the dictionary API used for enrichment (§8.2), many of which forbid
permanent caching of results. Both are legal-review items in §15.

---

## 6. Data model

### 6.1 Two word tables, one review table

```
corpus_entry        Read-only shipped content. Keyed by stable entry_id.
                    Carries target_language (always 'en' at launch).

user_word           Anything the user added or customised.
                    Either a standalone word, or a sparse patch over a
                    corpus_entry (their own translation, mnemonic, or note).
                    A patch stores only changed fields — never a copy.

review_state        One row per (user, word_id). Holds FSRS memory
                    parameters: stability, difficulty, due date, review
                    count, lapses. Agnostic as to whether the word came
                    from corpus_entry or user_word.
```

`review_state` being source-agnostic is what makes personal words genuinely
first-class: every game mode, every progress metric, and the scheduler itself
operate on review state without caring where the word originated.

**`word_id` is a single namespaced identifier**, so that "agnostic" has a
concrete representation:

- `c:<entry_id>` — a corpus entry.
- `u:<uuid>` — a standalone user word.

A sparse patch over a corpus entry does **not** mint a new ID: review state and
events stay on `c:<entry_id>`, and the patch only changes what is displayed.
Review state, review events, and game sessions reference `word_id` and nothing
else.

**One word, one review state.** Two paths could otherwise create duplicates:

- *Learner adds a word the corpus already has* (at any level, locked or not).
  The client checks the full-corpus headword index, and the learner links the
  matching entry instead of creating a `u:` word. The entry becomes available
  to that learner immediately, ahead of its unit, under its `c:` ID. When the
  unit later unlocks, the word is simply already in review.
- *A later corpus version adds a word the learner already has as `u:`.* The
  client offers a merge (the learner confirms, because the senses may differ).
  A merge writes a `word_alias` record (`u:… → c:…`). Events are immutable and
  are not rewritten; replay resolves aliases before grouping events by word.

### 6.2 Other principal entities

- `user` — identity, display name, L1, UI language, declared level (which also
  defines which units are *assumed known*; §7.2), settings, privacy flags.
- `review_event` — immutable append-only log of individual answers. Fields:
  `review_id` (client UUID), `user_id`, `word_id`, `mode`, `direction`,
  `grade`, `latency_ms`, `practice` flag (§7.4), `client_ts`,
  `client_tz_offset`, `device_id`, `device_seq` (per-device monotonic counter),
  `scheduler_version`; plus server-assigned `received_at`, `effective_ts`
  (immutable once assigned), and `xp_eligible` (§9.2, §10).
- `day_complete` — immutable event: (user, `local_date`, rule version). The
  only input to streaks; see §8.4.
- `device` — (user, `device_id`): the last accepted `device_seq` and
  `effective_ts`, used by the sync window (§9.2). A browser whose storage was
  cleared simply becomes a new device.
- `word_flag` — versioned document per (user, `word_id`): *known* or
  *suspended*; see §7.4.
- `unit_unlock` — grow-only set of (user, unit). Mastery and completion are
  derived from `review_state`, never stored.
- `word_alias` — user-word-to-corpus-entry merges; see §6.1.
- `enrichment_cache` — globally shared, in two parts (language-independent,
  and per L1); see §8.2.
- `league_membership` — user, week, cohort, tier.
- `league_xp` — (user, week) XP total, recomputed from events whenever that
  week's events change; a cache, not a counter. See §8.5.
- `xp_total` — per-user lifetime XP; likewise derived.
- `friendship` and `invite` — Phase 2; see §8.5.
- `content_report` — a learner's report of a wrong translation, sentence, or
  audio clip; see §8.10.
- `push_subscription` — a browser's Web Push endpoint, for reminders; see §8.11.
- `entitlement` — per user: tier, quotas, `source`, `expires_at`. Server-owned;
  read-only on clients. One tier exists at launch; see §8.8.

---

## 7. Learning engine

### 7.1 Scheduler: FSRS

FSRS with default parameters. Chosen over SM-2 because it is an open algorithm
with mature TypeScript implementations, delivers better retention per review,
and requires no per-user training data to work well from day one.

Each answer produces a grade (Again / Hard / Good / Easy). FSRS returns an
updated stability and difficulty and the next due date. Per-user parameter
optimisation — refitting the model to an individual's review history — is
deferred to Phase 3.

The FSRS library version and parameter set are part of `scheduler_version`
(§4.3).

**Desired retention.** FSRS schedules each review for the moment predicted
recall falls to a target. The learner chooses that target as a plain-language
setting — *relaxed*, *standard* (default), or *intensive* — trading daily
workload against how much is remembered. The setting affects only the interval
computed from a word's stability, never the stability itself, so changing it
reschedules due dates immediately and needs no replay. It syncs with other
settings (§9.2). Target values are tuning items (§15).

### 7.2 Level path

The learner declares a CEFR level, or takes a **placement test**: roughly 30
words, binary-searching across frequency bands to estimate a level in about two
minutes. The placement test is optional and can be taken later from settings;
it is never a blocking onboarding step (§8.6).

**Placement consequences.** A learner placed at level *L* has every unit below
*L* unlocked and marked *assumed known*. Those words are **not** fed into the
new-word queue — a B1 learner is not made to grind 1,600 A-level words. They
remain available and are eligible as distractors. Level completion for an
assumed-known band is shown as "skipped — placed above", never as 100%.

*Assumed known* is not stored per word: it is every never-introduced word in a
unit below the learner's declared level (§6.2), so it follows the level if the
learner changes it. Raising the level skips more; lowering it returns
never-introduced words to the queue. No review state is ever deleted either
way. "Review this level" uses the collection mechanism (§8.9): a level can be
chosen as a collection, which puts its words at the front of the new-word
queue.

Words are grouped into **units** of approximately 20 thematically related words.

**Unit unlock rule.** The next unit unlocks as soon as every live word of the
current unit has been introduced. *Live* excludes retired entries (§5.1) and
words the learner has flagged known or suspended (§7.4). The *current unit* is
the earliest unlocked unit in path order that still has a live, never-introduced
word; words pulled forward by a collection or a personal-word link count as
introduced in whichever unit holds them.

The gate is about *introduction* only, so that the new-word queue never runs
dry. An earlier draft also required a successful later-day review of 80% of the
unit; FSRS schedules the first review two to four days out, and longer after an
*Easy*, so that rule would have left the learner with no new words for days
after every unit. Two cosmetic markers carry the sense of progress instead:
*unit complete* when 80% of a unit's live words have a successful non-practice
review on a later day, and *unit mastered* when 90% are mature.

The critical separation: **units control what is available; FSRS controls what
is due.** A study session draws from everything the learner has ever unlocked,
scheduled by FSRS — not from the current unit. The unit path exists to give the
learner a visible map and a sense of place, not to constrain daily review.

### 7.3 Grading inputs

Every game mode reports a grade plus response latency. A correct-but-slow
answer grades *Hard* rather than *Good*. Latency is a meaningful retention
signal and capturing it is free.

The mapping, which lives in `core`:

| Outcome | Grade |
|---|---|
| Flashcard self-rating | Passed through (Again / Hard / Good / Easy) |
| Incorrect | Again |
| Correct, slower than the mode's slow threshold | Hard |
| Correct, accepted with a distance-1 typo (§8.1) | Hard |
| Correct | Good |

Binary modes never assign *Easy*; only a learner's own self-rating can.

Latency is measured from the prompt being fully presented (for listening, from
the end of the audio) to the answer being committed. The slow threshold is
per-mode, and for typing modes includes a per-character allowance so long
words are not penalised. Threshold values are tuning items (§15).

### 7.4 Session composition

FSRS says when a word is due; it says nothing about words that have never been
seen. `core` composes each session as follows.

1. **Due reviews first**, lowest predicted retrievability first.
2. **Then new words**, up to the learner's **daily new-word limit** (default
   10, configurable 0–30). New words come from personal words first (from
   Phase 2; the step is empty before then), then the learner's chosen
   collection if they have one (§8.9), then the current unit (§7.2). While a
   collection is active it takes the whole quota and the path waits — that is
   the learner's choice, and the path resumes when the collection is exhausted
   or cleared. With a limit of 0 the learner only reviews.
3. **Backlog protection.** Reviews shown per day are capped (default 100). When
   the backlog exceeds the cap — typically after an absence — new words pause
   until it clears, and the home screen shows the day's capped figure with the
   total backlog as a secondary number. Returning to 400 due cards is how
   spaced-repetition apps lose people.
4. **Extra practice.** Practice is any answer outside the schedule: a word
   that is not due, or any answer in the matching game. It is available at any
   time from the practice menu, and the default session offers it once due
   reviews and new words are done. Practice events are logged with
   `practice = true`, earn reduced XP (§8.7), are **excluded from FSRS
   replay**, and never count as a successful review for any progress rule — so
   grinding cannot distort the schedule. A learner-chosen single-mode session
   is not practice: it serves due words, in that mode, and counts normally.

**Known and suspended words.** A learner can flag any word *known* ("I don't
need this") or *suspended* ("not now"). Either removes it from the new-word
queue and from review; neither deletes its review state, and both can be
undone. A known word is shown as known-by-declaration and never counted as
mature. Flags are versioned documents (§9.2).

### 7.5 One memory state, several skills

Recognition (multiple choice), production (typing), and listening differ
sharply in difficulty, and multiple choice has a 25% guess floor. With one
FSRS state per word (§3), a word could otherwise mature on lucky recognition
alone and then collapse at its first typing review. Three mitigations:

1. **`core` picks the mode.** In the default mixed session the mode is chosen
   per item by stability: *recognition* modes (multiple choice, listening by
   selection) while a word is new or learning, *recall* modes once it is young
   or better. Recall modes are those with no options to choose from: the
   flashcard (free recall, self-rated) in Phase 1, joined by typing, cloze, and
   typed listening in Phase 2. `core` is told which modes are possible right
   now — listening only when the clip is cached or the device is online (§9.3)
   — and chooses among those. Learners can still start a single-mode session
   by choice.
2. **Recognition never grades above Good.** (This follows from §7.3, where only
   a self-rating can produce *Easy*; it is restated here because it is what
   keeps a lucky guess from inflating stability.)
3. **From Phase 2, the *mature* tier requires at least one successful
   production-mode review** (typing, cloze, or typed listening). Words already
   mature when Phase 2 ships are not demoted. They meet production modes at
   their next due date, but gradually: for the first weeks after Phase 2 ships,
   production modes take no more than a fifth of any session, so that a
   learner's whole mature vocabulary does not hit typing at once.

---

## 8. Features

### 8.1 Game modes

A game mode is a **renderer plus a grade mapping**. `core` exposes one
interface: a session asks for the next due item, and the mode returns a grade.
All scheduling, selection, and state transitions live in `core`.

| Mode | Prompt → response | Grading | Phase |
|---|---|---|---|
| Flashcard | Word → reveal → self-rate | Self-rating passed through directly | 1 |
| Multiple choice | EN→L1 and L1→EN, 4 options | Binary, plus latency | 1 |
| Listening (select) | Audio → select the word, 4 options | Binary, plus latency | 1 |
| Matching | Pair five English words with their translations | None — practice only | 1 |
| Listening (type) | Audio → type the word | Binary with typo tolerance, plus latency | 2 |
| Typing / cloze | Translation → type English word; or fill the gap in an example sentence | Binary with typo tolerance, plus latency | 2 |

Grades follow the table in §7.3.

Two modes at launch is thin — competitors ship six to nine — so two cheap ones
join Phase 1. **Listening (select)** needs no new content: every entry already
has audio, listed in the pack's manifest and fetched from the CDN (§9.3). The
options are written English words, from the same distractor generator, biased
toward similar-sounding ones. It counts as a recognition mode (§7.5), and is
offered only when the clip is cached or the device is online. **Matching** is
a game, not a measurement: once a few pairs are gone the rest fall to
elimination, so its answers say little about memory. Matching events are
therefore always logged with `practice = true` (§7.4) — they earn practice XP
and never touch the schedule.

**Distractor generation** (shared in `core`). Wrong options are drawn from the
same CEFR band and the same part of speech, preferring words the learner has
already encountered, with a same-first-letter or similar-length bias. Poor
distractors are the single most common way a vocabulary app feels fake, and the
rule belongs in one place.

"Same band, same part of speech" is also exactly where synonyms live, so a
candidate is **excluded** if it shares any translation — primary or alternate —
with the target in the learner's L1, or is another sense of the same headword.
A distractor must be unambiguously wrong. Retired entries are never used. In
listening modes a candidate is also excluded if it sounds the same as the
target — identical IPA, as with *their* and *there* — because no one can tell
them apart by ear. On a matching board, no two pairs may share a translation.

**Synonyms in typing modes.** In translation → English, the L1 prompt is shown
with its sense gloss. If the learner types an English word that is a
*different* corpus entry sharing that L1 translation (*large* when the target
is *big*), the answer is not marked wrong: the app says it is a correct word
but not the one being asked for, reveals the first letter, and allows a retry
without penalty. Cloze prompts need this less, since the sentence constrains
the answer.

**Typo tolerance.** Typing modes use Damerau-Levenshtein distance, compared
case-insensitively after trimming, with listed spelling variants counting as
exact matches.

- Words of four letters or fewer require an exact match.
- For longer words, distance 1 accepts the answer but surfaces the correction,
  rather than silently passing it, and grades *Hard*.
- A typed string that is itself an English headword is never accepted as a
  typo (*from* for *form*, *than* for *then*) — that is a wrong word, not a
  slip.
- Distance ≥ 2 is incorrect.

### 8.2 Personal dictionary

The whole personal dictionary is Phase 2: standalone user words, sparse patches
over corpus entries, corpus linking, and enrichment alike. Phase 1 has no
`user_word` rows, and the personal-word step of the new-word queue (§7.4) is
empty until then.

A learner adds a word. The client first checks the full-corpus headword index.
If the word exists in the corpus — at any level — the learner picks the
matching sense, the entry is linked directly (§6.1), and any customisation is
stored as a sparse patch. If it does not, the server enriches it:

1. **Input validation.** At most 64 characters and four tokens (phrasal verbs
   and short expressions are allowed), Latin letters, apostrophes, hyphens,
   and spaces only. Input that fails validation is never sent onward.
2. Dictionary API lookup for part of speech, IPA, and definition, returning up
   to a handful of candidate senses.
3. LLM fallback for fields the dictionary lacks, plus translation into the
   learner's L1, an example sentence, and an estimated CEFR level per sense.
   The headword is passed to the model as delimited data, never as
   instructions, and the response is schema-validated. A headword that neither
   the dictionary nor the model recognises as English gets a **negative cache
   entry** — so that the same junk costs a lookup once, not every time it is
   typed — and the learner is offered manual entry instead.
4. TTS audio generation.
5. The result is written to `enrichment_cache` and shared globally — the same
   word is enriched once for all users. The cache has two parts, so that work
   which does not depend on the learner's language is not repeated five times:
   a language-independent part (senses, part of speech, IPA, definition,
   audio) keyed by (normalised headword, enrichment version), and a per-L1
   part (translations and glosses) keyed by (normalised headword, L1,
   enrichment version).

The learner picks the sense they meant, reviews the result, and may edit any
field. The chosen sense is **copied** into their `user_word` row: the cache is
a cache, not a source of record, so later invalidation never changes a
learner's word underneath them, and a learner's edits never flow back into the
shared cache. Generated audio files are immutable and are never deleted when a
cache entry is invalidated, so the audio reference copied into a `user_word`
cannot dangle. Enriched words carry a provenance marker so an estimated CEFR
level is never presented as authoritative.

**Adding a word offline** saves it at once as a manual entry marked *pending
enrichment*; it is studyable immediately with whatever the learner typed, and
is enriched at the next sync, when the learner is shown the result to accept.

**Abuse.** The quota is per account, and accounts are cheap to create only in
appearance: every account has a verified email address or a Google identity
(§8.6), enrichment requires one, and the server also rate-limits enrichment
per IP address.

**The cache is not forever.** A bad model output must not be permanent. Every
cached entry carries the enrichment version that produced it; bumping the
version invalidates lazily. The in-app report-an-error path applies to
enriched words too, and a reported entry is queued for re-enrichment or human
correction.

No user identifier accompanies a word sent to the dictionary or LLM provider.

**Capturing words where learners meet them.** Typing words in one at a time is
the slowest way to build a dictionary, and the strongest personal-dictionary
competitors all offer something faster. Every capture path ends in the same
place — the link-or-enrich flow above — so none adds a second pipeline.

- *Paste text* (Phase 2). The learner pastes a passage; the client tokenises
  it, drops words they already have, links those the corpus knows, and lists
  the rest as candidates to add. Nothing is enriched until the learner picks
  it, which keeps quota use deliberate (§8.8).
- *Share sheet* (Phase 2, mobile). "Share to VocApp" from any app delivers a
  word or a passage into the same flow.
- *Bulk import* (Phase 2; moved up from Phase 3). CSV, and Anki text export.
  Imported rows that already carry a translation skip enrichment for that
  field.
- *Browser extension* (Phase 3). Select a word on any page to add it, with the
  surrounding sentence kept as the learner's own example.

Enrichment is the only feature with an unbounded external dependency (API cost,
latency, and availability), which is why it lands in Phase 2 rather than Phase 1.
The app is coherent without it.

### 8.3 Progress

Four metrics, deliberately chosen:

1. **Due today** — the actionable number. The home screen's primary figure.
   Subject to the daily cap in §7.4.
2. **Mastery tiers** — new / learning / young / mature, derived from FSRS
   stability thresholds (and, from Phase 2, the production requirement in §7.5).
3. **Level completion** — the share of a CEFR band's live entries that are
   mature.
4. **Retention rate** — share of reviews answered correctly on first attempt
   over the trailing 30 days, counting only reviews of words last seen on an
   earlier day. First exposures, same-day relearning, and practice events are
   excluded; including them would flatter the number.

A new device cannot compute the last two from nothing, so a pull includes a
compact **daily summary** for the trailing 90 days (per local date: reviews,
first-attempt successes, new words) alongside derived review state. The full
event log stays on the server and is available through data export (§11).

Retention is the honest metric. XP and streaks are motivation; they are
presented as such and never conflated with learning. A forecast chart of
upcoming review load is deferred to Phase 3.

### 8.4 Streaks

A day counts when the learner finishes that day's due reviews (the capped
figure of §7.4) **or** meets a configurable daily goal, and in either case has
answered at least one item. If nothing is due, new words or practice satisfy
the day. Two streak freezes accrue automatically per month and are consumed
silently on a missed day.

**A completed day is recorded, not re-derived.** Whether "today's due reviews
are finished" depends on what was due, which depends on the scheduler version,
the desired-retention setting, the backlog cap, and the goal in force at that
moment. Re-deriving it later — after a settings change or a server
re-derivation (§4.3) — would rewrite past streaks. So the client evaluates the
condition once, when it is first met, and emits an immutable `day_complete`
event carrying the `local_date`. The server accepts it if the log holds at
least one answer for that date. Streak length and freeze consumption are then
a pure function of the set of `day_complete` dates, which never changes
retroactively except by a late-syncing device *adding* a date — which repairs
a streak, never breaks one.

A "day" is the learner's **local calendar date** at the moment of the answer.
Travel across time zones can make a date short or long; it cannot make one
count twice, because the streak is over distinct dates. Streaks carry no
competitive payoff, so nothing stronger than the server's one check is needed.

Streak loss is a leading cause of churn in this category, and the freeze
mechanic costs almost nothing to provide.

### 8.5 Leaderboards

Three surfaces.

**Weekly leagues** — the default view. Every Monday at 00:00 UTC, active users
are bucketed into cohorts of roughly 30, grouped by recent activity level.
Ranking is by XP earned during that week. Approximately the top 7 are promoted
and the bottom 5 relegated across named tiers. Everyone is always plausibly
near the top of their own bracket.

A single global rollover means the week ends on Sunday evening in the Americas.
This is an accepted trade against per-region cohorts; the UI shows the
countdown in local time so the deadline is never a surprise.

**Friends** — a second tab, ranked identically, populated by invite code or
username search. Username search only finds users who have turned on
*discoverable by username* (off by default); invite codes always work.

**Global weekly top-100** — opt-in, off by default. Participation requires
explicitly choosing a public display name.

**Inactive members.** A learner who earns no XP in a week is neither promoted
nor relegated, and is left out of next week's cohorting until they return.
Coming back from a holiday to find yourself demoted is a reason to stay away.

**Display names.** League cohorts are strangers, so the default display name is
a generated pseudonym. It is never pre-filled from an Apple or Google profile,
which would put real names in front of strangers without consent. The learner
may change it at any time.

**Late events.** XP counts toward a league week only if the event is received
before that week closes. Events that arrive later — a phone that was offline
over the rollover — still count fully for learning, streaks, and lifetime XP,
but earn no league XP. This is a real cost to offline learners and is accepted:
crediting late events to the current week would let a week of offline study be
banked into the next league, and reopening closed weeks would un-promote people.

**Joining mid-week.** A learner who becomes active after Monday's cohorting
joins a league at the next rollover. Until then they see their XP and a
countdown, not an empty board.

**Below the cohort threshold** (R6) there is a single weekly board for all
league participants. It is not the opt-in global board: it shows pseudonymous
display names, is visible only to learners who are on it, and disappears once
cohorts are viable.

Implementation is a Postgres `league_xp` row per (user, week). It is a cached
total, **recomputed** from that user's events for the open week in the same
transaction that ingests them — not incremented — because a second device's
late events can push an earlier day over the daily cap or the density check
(§10) and change what earlier events were worth. A closed week is never
recomputed. A cohort's standings are one indexed query over ~30 rows. The server computes XP from events that are
already in Postgres, so Postgres is the source of truth and no second store is
needed. If the Phase 3 global board needs it, a cache may be added in front —
as a cache, never as a store.

### 8.6 Accounts

Sign-in is **passwordless**: Google, or a one-time code sent by email. There
are no passwords to hash, store, leak, or reset, and a code sent to an address
verifies that address as a side effect. Sign in with Apple is added with the
iOS app, where the App Store requires it alongside Google; on the web it would
cost a paid Apple developer membership for no gain, so the MVP omits it.

Sessions are long-lived and refreshed on use, so a returning learner is not
asked for a new code; this also keeps sign-in email volume inside the email
provider's daily free allowance (§17).

A **demo mode** offers a small
sample session so a prospective user can study before committing. Demo events
are held in memory only. If the learner then **creates an account** from the
demo, those events are attached to the new account — there is nothing to
merge, because a new account has no prior data. If they instead sign in to an
existing account, or leave, demo progress is discarded, and this is stated
plainly.

Every persisted record therefore carries a `user_id` from creation, and no
anonymous-profile claim or merge path is needed.

**Changing language or level.** A learner may change their L1 at any time: the
client fetches the other pack, and because review state is keyed by entry, not
by translation, all progress carries over. Their own words and patches keep the
translations they were written with, marked as being in the earlier language.
Changing the declared level moves the *assumed known* line (§7.2) and deletes
nothing.

**Onboarding budget (Goal 1).** Demo mode is the first screen's primary action
and needs no account, no placement test, and no download: a small A1 sample for
each L1 ships inside the app bundle. The full pack downloads in the background
during the demo or sign-up. The placement test is offered, not required.
Sign-up itself asks only for L1, credentials, and the age check (§11). One
optional, skippable question — "What do you want English for?" — sets the
learner's first theme (§8.9); it costs a tap and makes the first session feel
chosen rather than assigned.

### 8.7 XP

XP is the motivation currency: it drives leagues and nothing else. It is
computed by the server from review events (§10) and mirrored locally by `core`
for offline display.

- A fixed amount per **due review** and per **new word introduced**.
- **XP does not depend on the grade**, nor on whether the answer was correct.
  Flashcards are self-rated; if rating yourself *Good* paid more than *Again*,
  XP would bribe learners to corrupt their own scheduling data.
- **Only a word's first scheduled review of the day earns XP.** Without this,
  the rule above backfires: rating *Again* brings the word back the same day,
  so dishonest *Again*s would pay the most. Same-day repeats are learning, and
  are recorded as such, but earn nothing.
- **Practice events** (§7.4) earn a reduced amount.
- A **daily XP cap**, per UTC day, bounds grinding and cheating alike. The
  boundary is the server's, not the client's reported time zone, so it cannot
  be moved. The cap also bounds what the *intensive* retention setting or a
  high new-word limit can earn.
- Events marked `xp_eligible = false` (§10) earn nothing.

Amounts and the cap are tuning items (§15). XP is earned from Phase 1, before
leagues ship, so that lifetime totals exist when they do.

### 8.8 Free tier and entitlements

Pricing and payments are out of scope (§2), but a principle and three
architectural decisions cannot be retrofitted cheaply and are settled now.

**The free-tier principle.** Studying is never paywalled: the full corpus,
theme collections,
every game mode, the scheduler, offline use, sync, reminders, and the four
progress metrics of §8.3 are free for every learner, permanently. Most competitors charge for offline, and
several have removed free features after launch; shrinking free tiers and
auto-renewal traps are the most common complaints in the category. Holding
this line is a product position, not only a courtesy.

**What may be charged for** falls into two groups, neither of which is
studying:

- *Metered features* — anything with a real per-use cost. Enrichment lookups
  (dictionary, LLM, TTS) are the first; the per-user daily enrichment quota
  (R4) is the mechanism.
- *Extras* — conveniences and depth features around the core loop: word-capture
  tools, exam collections, forecasts. A learner without them still has the
  whole product.

**Three decisions taken now.** Everything else about monetisation can wait
until there is something to sell. These cannot, because each is cheap today
and a migration later.

1. *The entitlement is a server-owned synced document.* Each user has one
   `entitlement`: tier, quotas, `source`, `expires_at`. The client needs it
   offline but must never be able to write it, so it syncs through the
   server-owned document class in §9.2 and is cached locally. Two dates are
   involved and must not be confused: `expires_at` is when the entitlement
   itself ends (a subscription's paid-through date); the cached copy's
   `stale_after` (§9.2) is only when the client should try to refresh it.
   At launch there is exactly one tier, every user holds it, and it never
   expires. Introducing a paid tier later is a data change.
2. *One capability check.* Code never asks "is this user paying?". It asks one
   function in `core` whether the current entitlement allows a named
   capability (`capture.paste`, `collections.exam`, …), and `client-data` supplies
   the cached entitlement. A paid-or-free condition written directly in `web/`
   or `mobile/` is a defect, for the same reason a scheduling rule there is.
3. *The entitlement is provider-agnostic.* `source` records where it came from
   (`default`, `app_store`, `play`, `web`, `grant`). Payment providers, when
   they exist, report to the server, and the server writes the entitlement;
   nothing else in the system knows a provider exists.

**Enforcement.** Quotas and metered features are enforced by the server, which
is where their cost is incurred. Extras that run on the client are gated by the
cached entitlement, and the rule is simple: the client honours the cached copy
until its `expires_at`, online or off. A stale copy (past `stale_after`, no
connection) is still honoured until then; a learner who renewed while offline
gets the extras back at the next sync. After `expires_at` the client falls back
to the default tier. None of this needs to be tamper-proof, because nothing
essential is ever gated: the free-tier principle removes the hard problem of
enforcing a paywall on an offline client.

**Proposed model — not approved (†).** Recorded so the decisions above can be
checked against a concrete plan. Pricing and payment handling remain out of
scope for this specification (§2) and need their own.

- *Free, permanently:* everything in the free-tier principle, plus a small
  daily enrichment allowance.
- *Plus*, from Phase 2, its contents growing as features ship (§14): a high
  daily enrichment quota; the capture tools (paste text, share sheet, bulk
  import, browser extension); exam collections (theme collections are
  free — they only reorder the free corpus); the review-load forecast;
  extra streak freezes. Per-user FSRS optimisation is a candidate but a
  borderline one — the scheduler is promised free, and although default-
  parameter FSRS always will be, selling a better scheduler sits uneasily with
  that promise. To be decided with the model.
- *Indicative pricing:* about $30–40 a year with regional pricing, against a
  market of $50–120 for mainstream apps, $50–80 for vocabulary apps, and $16
  for the closest personal-dictionary rival. A lifetime option around $80–100,
  which still carries a daily enrichment cap because enrichment costs money
  for as long as it is used.
- *Nothing is charged in Phase 1.* Nothing meterable exists yet, and a free
  launch builds the active base that leagues need (R6).
- *Rejected:* advertising (conflicts with offline use; low yield in the lead
  market); energy or hearts caps; paywalled offline; trials that charge on
  day one. These are the category's most common complaints.
- *Kept open:* separately sold content, such as packs aligned to a national
  exam or a textbook. This is why a client can load more than one pack (§5.1).

### 8.9 Collections: themes and exams

Learners rarely want "A2". They want English for a trip next month, a
restaurant job, a doctor's appointment abroad, an exam. A **collection** is a
named tag over existing corpus entries — not new content, and not a second
level path.

**The mechanism** is the same for every collection. Choosing one changes one
thing: its words go to the front of the new-word queue (§7.4), pulled forward
ahead of their units exactly as a linked personal word is (§6.1). Scheduling,
review state, and unit progress are untouched; a pulled-forward word simply
counts toward its unit early. A learner has at most one active collection, can
change or clear it at any time, and falls back to path order when it is
exhausted.

**Theme collections — Phase 1a, free.** *Restaurant, travel, doctor, shopping,
work, home, family …* These cost almost nothing, because the content already
exists: every entry carries theme tags, and units are built from them. What is
new is that the tags become learner-facing, which has three consequences.

- *A curated theme list.* Roughly 20–30 themes, chosen deliberately rather
  than emerging from whatever tags the pipeline produced, each with a name and
  a one-line description translated into every L1. Theme definitions ship in
  the corpus pack (§5.1), so a new L1 needs no code.
- *A level rule.* A theme spans levels — *menu* is A1, *reservation* is B1. A
  theme's words are served in level order, and words above the learner's
  level are marked as such rather than hidden: someone flying next week may
  reasonably want them.
- *A minimum size.* A theme is offered only if it has at least about 25
  entries in the levels shipped so far; the pipeline enforces this, so a theme
  can appear as the corpus grows.

Theme-first organisation is table stakes among competitors; a bare level path
looks thin beside them. Themes are part of studying and fall under the
free-tier principle (§8.8).

**Exam collections — Phase 3.** *IELTS, TOEFL, academic.* These wait because
they need B2–C1 entries, which arrive in Phase 2, and separate curation.
Collections are assembled in-house by tagging our own entries. Published exam
and academic word lists are licensed works like any other (§5.4) and must not
be copied. Exam collections are a candidate for the Plus tier (§8.8).

### 8.10 Reporting an error

Phase 1a. Five other parts of this design rely on it — translation quality
(R2), the audio quality bar (§5.4), enrichment correction (§8.2, R4) — so it
is a feature, not an afterthought.

From any card the learner can report a problem: wrong or odd translation, bad
example sentence, bad audio, wrong level, or other, with an optional note. A
`content_report` records the `word_id`, the field, the pack or enrichment
version, and the reporter. Reports work offline and sync like any other
document.

Triage happens in the content pipeline, not in the app. Reports are grouped by
entry and field; an entry crossing a small threshold of independent reports
enters the native-speaker review queue, and a bad-audio report re-generates the
clip automatically. Corrections ship in the next corpus version (§5.1), or, for
enriched words, as a re-enrichment (§8.2). The reporter is told, in the app,
when something they reported has been fixed — it is the cheapest way to make
learners feel the corpus is alive.

### 8.11 Reminders

Phase 1a, opt-in. A product built on daily review and streaks needs a way to
say "you have twelve words due". The MVP uses **Web Push**: one reminder a day
at a time the learner chooses, skipped if they have already studied, plus an
optional evening nudge when a streak is about to need a freeze. On iOS, Web
Push works only for an installed PWA, which is one more reason the app prompts
for installation (§9.1).

Reminders are sent by a Cron Trigger that finds the learners due a reminder in
the current window. There are no email reminders in the MVP: the email
allowance is reserved for sign-in codes (§17). Reminders are free (§8.8), and
a learner who ignores several in a row stops receiving them until they return,
rather than being trained to dismiss them.

---

## 9. Offline and synchronisation

### 9.1 Local storage

Each client holds a local SQLite database containing the corpus pack for its
L1, the learner's words, review state, and a pending outbox. All study
functionality works with no network. Leaderboards require connectivity and
degrade to a last-known-standings view with a staleness indicator.

Local schema migrations live in `client-data` and run identically on both
clients.

**Web-specific constraints.** Browser storage is weaker than native storage,
and the design accounts for it rather than assuming it away. Because the MVP
is web-only, this list is the whole offline story at launch, not an edge case.
The web app is an installable PWA, and it prompts for installation once a
learner has come back a second day — on iOS that is also what exempts it from
eviction.

- *Eviction.* Safari deletes script-writable storage for sites not visited in
  seven days, unless the site is installed to the home screen. The web client
  requests `navigator.storage.persist()`, flushes the outbox eagerly (after
  every session and on `visibilitychange`), and encourages installation on
  iOS. Because the server holds everything that has been synced, eviction
  costs a re-download, not progress — provided the outbox was flushed.
- *Multiple tabs.* OPFS access handles are exclusive. One tab holds a Web Lock
  and owns the database; any other tab shows "VocApp is open in another tab"
  with a take-over button.
- *No OPFS* (private browsing, older browsers). The web client falls back to
  SQLite over IndexedDB — slower, but with the same guarantees. Only if that
  also fails does it run an in-memory database in online-only mode, syncing
  after every answer, with a banner explaining that offline study is
  unavailable.
- *Taking over from another tab.* Every answer is written to the database as it
  is given, so nothing is in flight. The tab losing ownership flushes its
  outbox, releases the lock, and shows the notice; the session resumes in the
  new tab from the next item.

### 9.2 Sync protocol

Two mechanisms, chosen to avoid a CRDT layer entirely. Neither trusts a client
clock for ordering across devices.

**Append-only events for reviews.** Each answer produces a `review_event` with
a client-generated UUID. Events are immutable, so merging is the union of both
sides — inherently conflict-free. The server accepts the union, deduplicates
idempotently on `review_id`, and replays events to derive authoritative
`review_state`. Clients keep their locally derived state and accept the
server's on next pull, re-applying their own newer events on top (the rebase
rule, §4.3).

**What a pull contains.** Derived review state, the daily summary (§8.3), the
set of `day_complete` dates (§8.4), and changed documents — not the event log.
A new device is therefore ready after one pull whose size does not grow with
the learner's history.

**The server never refuses a review event** on plausibility grounds (Goal 7).
Implausible events are kept and marked XP-ineligible (§10); an event with a bad
timestamp has the timestamp corrected, as follows.

*Effective time.* FSRS is sensitive to the order of, and gaps between, reviews,
and device clocks are wrong more often than one would like. The server assigns
every event an `effective_ts` when it first accepts it, as follows.

1. **A push is one unit.** The client sends `client_now` — its clock at the
   moment of sending — and a `push_id` shared by every page of a paginated
   push. The window below is fixed when the first page arrives and applies to
   all of them, so the pages of one backlog are never judged against each
   other.
2. **Correct the clock, not the events.** The server compares `client_now` with
   its own clock. If they differ by more than a small tolerance, the difference
   is this device's clock offset, and it is added to every `client_ts` in the
   push. A phone whose clock is an hour fast is thereby corrected as a whole,
   with its spacing intact, and **offset-corrected events stay XP-eligible** —
   a wrong clock is not cheating.
3. **The window.** After correction, an event must fall between the device's
   last accepted event (from `device`, §6.2) and the server's time now. A
   device the server has never seen — a first sign-in, a reinstall, a browser
   whose storage was cleared, or a demo session being carried over (§8.6) — has
   no last event; its lower bound is the account's creation time less one day,
   which comfortably covers a demo.
4. **Clamp only what is left.** An event still outside the window is moved to
   the nearest bound, individually; `device_seq` order is then restored by
   making timestamps non-decreasing. Only these individually clamped events
   are marked XP-ineligible (§10).
5. **`effective_ts` is immutable.** It is never recomputed, even in a
   re-derivation (§4.3).

Replay is per (user, `word_id`) after alias resolution, ordered by
(`effective_ts`, `device_id`, `device_seq`) — a total, deterministic order over
stamped events. (Stamping itself depends on when a push arrives, which is why
the stamp is kept rather than recomputed.) Practice events are skipped. A
late-arriving event triggers a re-derivation of that one word's state.

**Versioned documents for mutable data.** User words, settings, unit unlocks,
and word aliases carry a server-assigned monotonic `version`. A client write
includes the `base_version` it was editing.

- A client write is a **patch**: the changed fields only, plus `base_version`.
  The server keeps, for each field, the version at which it last changed —
  that is all the history a merge needs.
- `base_version` current → accepted.
- `base_version` stale → **field-level merge**: a patched field that has not
  changed on the server since `base_version` is applied; for a field changed
  on both sides, the write that reaches the server later wins. Ordering by
  server arrival rather than by `updated_at` means a device with a fast clock
  cannot win every conflict.
- **Deletes are tombstones**, retained indefinitely (they are tiny). A
  tombstoned user word's review events stay in the log but derive no state;
  undeleting restores it.
- **Merging a user word into a corpus entry** (§6.1) writes the alias, turns
  the user word's custom fields into a sparse patch over the entry, and
  tombstones the user word. Deleting the alias undoes all three: events were
  never rewritten, so they regroup under the user word again.
- `unit_unlock` is a grow-only set: merge is union, and nothing can re-lock a
  unit.

**Server-owned documents.** A second document class for state the client must
be able to read offline but must never write: the `entitlement` (§8.8) is the
first, and league membership is another. These sync in one direction only. The
server assigns versions exactly as for versioned documents; the client stores
the latest copy, never includes the class in a push, and the server rejects any
write to it. Each copy carries a `stale_after` time, after which the client
tries to refresh it. A stale copy is still used while the device is offline;
what it *means* for a document to have ended is that document's own business
(for the entitlement, `expires_at`; §8.8).

The one genuinely lossy case — the same *field* of the same user word edited on
two devices while both are offline — is rare and low-stakes: a user loses one
edit to their own note. This is an accepted trade against the complexity of a
CRDT.

### 9.3 Content sync

Clients check for a newer corpus version on launch and on a periodic interval,
fetch the new pack, and swap it in atomically at the start of the next session
(§5.1).

**Audio is not in the pack.** The pack lists each clip's URL and checksum; the
files are fetched from the CDN and cached. Three rules keep that from
undermining offline study. Audio for the words a learner is about to meet —
the next new words and the coming days' due reviews — is prefetched whenever
the device is online. The learner can pre-download a whole level over Wi-Fi.
And `client-data` tells `core` which clips are present, so a listening item is
only ever chosen when it can actually be played (§7.5). The bundled demo sample
(§8.6) includes its audio.

---

## 10. Anti-cheat

Sized to the actual threat. Leagues already bound the payoff — cheating buys
first place in a bracket of thirty strangers.

**Anti-cheat governs XP, never learning data.** A suspicious event is kept,
replayed into review state like any other, and marked `xp_eligible = false`.
Rejecting it instead would mean that a false positive — a genuinely fast
answer, a phone with a wrong clock — silently rolls back a learner's progress
on their next pull. That failure is far worse than the cheating it prevents.

- **Clients never report XP.** They report review events; the server computes XP.
- Events are XP-ineligible when: answer latency is below the mode's
  plausibility floor (~400ms for multiple choice; per-mode values in §15); the
  event had to be individually clamped (§9.2, step 4 — a whole-push clock
  correction does not count); or the density of events in effective time
  exceeds what a person can do.
- Density is measured over **event timestamps, not submission rate**. A phone
  returning from a week offline legitimately uploads hundreds of events in one
  request, and must not be throttled for it. Transport-level rate limiting
  exists only to protect the service and is sized to allow a full backlog flush.
- A daily XP cap, and XP only for a word's first scheduled review of the day
  (§8.7) — which closes the *Again* loophole.
- XP totals are recomputed, not incremented, so late events from a second
  device cannot slip past the cap (§8.5).
- League XP only for events received before the week closes (§8.5), which
  removes any payoff from backdating.
- No device attestation. The cost-benefit does not justify it here.

---

## 11. Privacy and compliance

- Global leaderboard participation is opt-in and requires an explicit public
  display name. League and friends standings are visible only within the
  relevant cohort or friend graph, and league display names default to
  pseudonyms (§8.5).
- Username discoverability is off by default (§8.5).
- **Account deletion** is self-service, in the app, from Phase 1a. It removes
  all user rows — including the event log, which is append-only in normal
  operation but not exempt from erasure — and purges the user from leaderboard
  history. What remains holds no personal data: anonymous, aggregated
  corpus-difficulty statistics, and the shared enrichment cache, whose entries
  are dictionary words with no record of who asked for them. Content reports
  are kept with the reporter removed.
- **Data export** is available from Phase 1a, because the right to a portable
  copy applies from the first day of processing, not from Phase 3: a JSON
  download of the learner's settings, review events, and (from Phase 2) words.
  Friendlier formats and *import* come later (§14).
- **Analytics without a consent banner.** Product metrics come from the
  first-party event log, in aggregate, and from cookieless page analytics.
  There are no advertising or third-party tracking scripts and no non-essential
  cookies, so no consent prompt is needed. Adding any such script later is a
  privacy decision, not a marketing one.
- **Age gate.** The launch L1s put the primary markets inside the GDPR, where
  the age of digital consent is set per member state — 16 in Germany, 15 in
  France, 14 in Spain and Bulgaria — not the COPPA figure of 13. Sign-up asks
  for birth year and applies a per-country threshold: the member-state age in
  the EEA (16 where the country is unknown), 13 elsewhere. Country is
  self-declared at sign-up, pre-filled from the request's country as reported
  by the hosting platform; only the country is kept. There is no
  parental-consent flow at launch; learners below the threshold are turned
  away.
- Words a learner submits for enrichment are sent to third-party processors
  (dictionary, LLM, TTS) without any user identifier; the privacy policy says
  so.
- **Where data lives.** The store of record is Postgres in an EU region.
  Two processors in §17 do not keep data in the EU by default: the email
  provider stores message content and logs in the US whatever its sending
  region, and the LLM gateway may route requests outside the EU unless a paid
  in-region plan is used. Both are disclosed in the privacy policy, and both
  are kept thin: sign-in emails carry a code and nothing else, and enrichment
  requests carry a word and no identifier.
- Data-residency obligations in the launch markets are a legal-review item
  (§15).

### 11.1 Accessibility

The web client targets WCAG 2.2 level AA. In particular: every game mode is
fully operable by keyboard and by screen reader; no information is carried by
colour alone (correct and incorrect are also marked by icon and text); motion
respects the reduced-motion preference; and a learner who turns audio off, or
cannot use it, is never served listening items — `core` treats audio as
unavailable for them (§7.5). Latency-based grading (§7.3) can be switched off
in settings, so that a learner who needs more time is graded on correctness
alone.

### 11.2 Internationalisation

The **app's own interface** is localised into each supported L1 and English.
Interface strings ship with the app, not the corpus pack; the learner's UI
language defaults to their L1 and can be changed independently of it. Phase 1a
ships Bulgarian and English.

Bulgarian and Russian are Cyrillic-script languages. Consequences:

- Cyrillic-capable fonts must be bundled on every client; web must not
  depend on a system font being present.
- Sorting and searching the personal dictionary uses locale-aware collation:
  ICU collations in Postgres, `Intl.Collator` on clients.
- Typing game modes are unaffected — the learner always types **English**, so
  no non-Latin input method is ever required. Cyrillic appears only on the
  prompt side.

---

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Corpus licensing. Oxford 3000/5000 and the English Vocabulary Profile are licensed; copying their lists or level assignments creates legal exposure. "Open" frequency lists may be share-alike or non-commercial. | Build from frequency data whose licence permits commercial use without share-alike, with independently derived CEFR banding. Document provenance and licence for every input and every entry. Native-speaker review. Legal review before the pipeline is built (§15). |
| R2 | Translation quality. Five L1s × ~7,100 entries is ~35,500 translations. Machine translation alone will produce embarrassing errors, especially for polysemous words. | Entries are senses, not headwords (§5.2). Machine-translate with sense disambiguation from the example sentence, then native-speaker review. Budget review time per level. In-app report-an-error path feeding the content pipeline. |
| R3 | Offline sync complexity. The most likely source of hard-to-reproduce, data-losing bugs. | Append-only events remove the hard case. No client clock is trusted for ordering (§9.2). The sync engine exists once, in `client-data`. Property-based tests over `core`'s reconciliation with generated out-of-order, duplicate, and clock-skewed event streams. |
| R4 | Enrichment cost, latency, and quality. Unbounded external API dependency; a bad result is shared with everyone. | Global `enrichment_cache`, versioned and invalidatable. Input validation. Per-user daily enrichment quota. Report-an-error path. Graceful degradation to manual entry when the service is unavailable. Dictionary API terms must permit caching (§5.4). |
| R5 | UI divergence between web and mobile. Two UI codebases drift. | All rules live in `core`; all data and sync logic in `client-data`; UI holds neither. Shared design tokens. Cross-platform conformance tests over `core`. |
| R6 | Cold-start on leagues. Cohorts of 30 require enough active users. | Leagues ship in Phase 2, after Phase 1 has built an active base. Below threshold, fall back to a single pseudonymous board for league participants (§8.5) — not the opt-in global board; switch to cohorts once volume supports it. |
| R7 | Browser storage is evictable. Safari's seven-day rule, private browsing, and multi-tab OPFS locking can each lose or block local data. | Persistent-storage request, eager outbox flush, single-tab ownership, online-only fallback (§9.1). The server is the store of record, so the exposure is limited to unsynced events. |
| R8 | Version skew. Old clients, a newer server, and a changed scheduler derive different state from the same events. | `scheduler_version` on every event, server-authoritative re-derivation, minimum sync version (§4.3). |
| R10 | Platform limits and lock-in. Free-tier caps (CPU time, requests, database size) can be hit without warning, and Workers is not Node. | Light request handlers and queued batch jobs (§4.4). Hono, Postgres, and R2's S3-compatible API are all portable. Limits and the price of the next tier up are recorded in §17; the first paid step is small. |
| R11 | Reachability in Russia. Cloudflare-fronted traffic has been throttled by Russian ISPs since June 2025, and Apple stopped processing payments there in April 2026. | The Russian L1 is aimed at Russian speakers outside Russia, ships last of the five, and is not counted on for revenue. |
| R9 | Content cost growth. Three to five reviewed sentences per entry, images, and an audio quality bar each multiply pipeline effort across ~7,100 entries. | Staged by phase and by L1 (§14): Bulgarian first, extra sentences only when cloze ships for a level, images only for concrete A1–A2 nouns. |

---

## 13. Testing strategy

- **`core` unit tests** — the bulk of the suite. Scheduler behaviour, level
  gating, session composition and backlog capping, distractor quality
  invariants (including: no distractor shares a translation with its target),
  typo tolerance boundaries (short words, real-word collisions, spelling
  variants), grade mapping, streak and XP derivation. Unit unlocking: a unit
  containing a retired, known, or suspended word still unlocks its successor,
  and the new-word queue is never empty while live words remain. Streaks are
  unchanged by a settings change or a re-derivation. XP: a word answered
  *Again* five times in a day earns once. Mode selection never picks listening
  when audio is unavailable. No I/O, no device.
- **Property-based tests** on sync reconciliation: generated event streams with
  duplicates, reordering, and aliases must converge to identical state
  regardless of the order in which already-stamped events are replayed.
  Separately, for stamping (§9.2): a skewed device clock is corrected as a
  whole and loses no XP; the pages of one push share one window; a never-seen
  device and a carried-over demo are accepted; individual clamping preserves
  per-device order; `effective_ts` never changes once assigned. And for the
  rebase rule (§4.3): a pull never loses events above the server's per-device
  mark.
- **Version-skew tests** — events produced under scheduler version *n* replayed
  under *n+1*; client and server derivations agree within tolerance (§4.3);
  a below-minimum client keeps its outbox intact.
- **`client-data` tests** — outbox and sync engine against an in-memory driver;
  **local schema migration tests** from every previously shipped schema version.
- **Corpus pipeline tests** — schema validation, referential integrity of audio
  manifests, entry and unit ID stability across versions, no duplicate
  (headword, part of speech, sense) anywhere in the corpus, retired entries
  never removed, every theme named in every L1, no theme offered below the
  minimum size.
- **Server integration tests** — sync endpoints, XP computation, XP-ineligible
  marking (and that marked events still update review state), league rollover
  and late-event handling, document merge and tombstones, league XP
  recomputed correctly when a second device's late events arrive, account
  deletion leaving no personal data behind, data export round-trip.
- **Accessibility tests** — automated WCAG checks in CI, plus a keyboard-only
  and a screen-reader pass through every game mode before each release.
- **Rules added after competitor research** — matching events never alter
  review state; changing desired retention moves due dates but not stability;
  inactive league members are not moved; an active collection reorders the
  new-word queue and changes nothing else; quota checks read `entitlement`;
  a client write to a server-owned document is rejected; a cached entitlement
  is honoured offline until `expires_at` and not after, however stale the
  copy; every paid-or-free decision
  goes through the single capability check;
  every capture path (paste, share, import) lands in the same link-or-enrich
  flow and never creates a duplicate of a corpus word.
- **Client end-to-end tests** — for the MVP, "platform" means browser: desktop
  Chrome, Firefox and Safari, plus mobile Safari and Chrome. One happy path per
  platform per game mode, plus
  an airplane-mode study-then-reconnect scenario. On web, additionally: second
  tab, storage cleared between sessions, and no-OPFS fallback.

---

## 14. Phasing

The release plan with rationale per item is in
`docs/research/2026-09-20-release-plan.html`.

### Phase 1a — Bulgarian beta

This is the MVP: the whole Phase 1 product, for one L1. Bulgarian is the least-served of the
five languages and the clearest opening, so it ships first and gets the
highest content quality bar; the other four L1s are not a dependency for
learning whether the core loop works.

- Accounts with passwordless sign-in (Google, emailed code), the age gate, and
  a demo mode that carries over on sign-up (†). Self-service account deletion
  and a JSON data export (§11).
- Corpus A1–B1, Bulgarian translations, audio to the quality bar (§5.4).
  Interface in Bulgarian and English (§11.2).
- Game modes: flashcard, multiple choice, listening by selection, matching
  (practice only). Mode escalation from recognition to flashcard recall (§7.5).
- FSRS with the desired-retention setting (§7.1); the optional placement test
  and the unit path (§7.2); session composition, new-word limit, backlog cap,
  known and suspended words (§7.4).
- Offline-first with sync. Progress dashboard. Streaks. XP (earned and
  displayed; no leagues yet).
- Reporting an error (§8.10). Opt-in Web Push reminders (§8.11).
- Accessibility to WCAG 2.2 AA (§11.1).
- The free-tier principle; the `entitlement` as a server-owned synced
  document; the single capability check (§8.8, §9.2). One tier, nothing sold.
- Pack manifest as a list (§5.1).
- Theme collections, with the optional onboarding question (§8.9, §8.6).
- **Web only**, as an installable PWA (§9.1).
- Hosted on Cloudflare, within free service tiers (§4.4, §17).
- CI, deploy, and the corpus pipeline in GitHub Actions (§4.4).

**This is a heavy MVP,** and the design review said so. What makes it heavy is
mostly not optional — offline-first sync, the scheduler, and the content are
the product — but these can be cut without touching the core loop if time runs
short, cheapest first: the matching game, the placement test (learners can
declare a level), the desired-retention setting, reminders' streak-at-risk
nudge, theme collections' onboarding question. The `entitlement` plumbing
stays: it is small, and retrofitting it means a sync-protocol change.

### Phase 1b — General launch

- Spanish, German, French, and Russian translations for A1–B1, each released
  when its native-speaker review is complete. No code change: a new pack per
  L1. Russian ships last (R11).
- iOS and Android apps (Expo), built alongside the language releases and
  shipped when ready, with Sign in with Apple. They are views and a
  `SqlDriver` over the shared `core` and `client-data`.

### Phase 2

- Corpus B2–C1 in all five L1s.
- Example sentences brought up to three to five per entry, all levels.
- Images for concrete A1–A2 nouns.
- Personal dictionary with auto-enrichment, metered through `entitlement`.
- The Plus tier, if the proposed model in §8.8 is approved. Payment
  integration is specified separately.
- Word capture: paste text, mobile share sheet, bulk import (CSV, Anki).
- Listening by typing; typing and cloze modes.
- Weekly leagues (†), including the inactive-member rule. Friends leaderboard.
- Email reminders, if Web Push proves insufficient and the email allowance
  permits.

Leagues moved here from Phase 1. They need an active user base to fill cohorts
(R6), which Phase 1 exists to build; shipping them at launch means building
cohorting, promotion, and rollover for a feature that would run in its
fallback mode.

### Phase 3

- Opt-in global leaderboard.
- Review-load forecast.
- Per-user FSRS parameter optimisation.
- Friendlier data export formats, and data import beyond CSV and Anki.
- Exam collections (§8.9).
- Browser extension for word capture (a seventh package, `extension/`).
- Evaluate further under-served L1s (Romanian and Greek are the first
  candidates).

---

## 15. Open items for implementation planning

These are implementation and tuning decisions, not design gaps. They are
resolved when the implementation plan is written.

- Concrete Postgres schema with indexes and partitioning strategy for
  `review_event`.
- Sync endpoint contracts and pagination for large event backlogs.
- Corpus pack binary format.
- TTS vendor selection and per-entry audio cost (the LLM gateway in §17 also
  offers TTS models, which may make this one vendor rather than two).
- Managed Postgres provider and region, confirmed against free-tier limits.
- Size of a sync page and of a re-derivation queue message, set against the
  Workers CPU limit.
- Placement test item selection and scoring thresholds.
- FSRS stability thresholds defining the four mastery tiers.
- League tier names, count, and promotion/relegation counts per tier.
- XP amounts (due review, new word, practice) and the daily XP cap.
- Per-mode latency values: slow threshold, per-character typing allowance,
  anti-cheat plausibility floor, and event-density ceiling.
- Defaults for the daily new-word limit and daily review cap.
- Clock-offset and window tolerances for event stamping. (The procedure itself
  is design and is fixed in §9.2.)
- Desired-retention targets for the relaxed, standard, and intensive settings.
- The curated theme list, and the minimum theme size.
- Enrichment quota per entitlement tier.
- The list of named capabilities for the capability check.
- `stale_after` interval for server-owned documents.
- Report threshold for sending an entry to review (§8.10).
- Reminder windows, and how many ignored reminders pause them (§8.11).
- Audio prefetch horizon: how many days of due reviews to fetch ahead (§9.3).
- How long the gradual introduction of production modes lasts (§7.5).
- Lifetime of a negative enrichment-cache entry (§8.2).
- Monetisation, in its own specification: approval of the proposed model
  (§8.8), tier contents, prices and regional price tables, the lifetime
  option, payment providers, web checkout versus app-store purchase rules.
- Image sourcing (generated or licensed) and the list of entries that get one.
- Tokenisation and lemmatisation approach for paste-text capture.

**Legal review, required before the corpus pipeline and enrichment are built:**

- Licences of candidate frequency lists (commercial use, share-alike).
- Dictionary API terms regarding permanent caching and redistribution.
- Per-country age-of-consent table for the age gate.
- Data-residency obligations in the launch markets.

---

## 16. Revision log

**2026-09-20 — design review.** Changes from the originally approved draft.
Items marked † alter a previously settled product decision or the phasing and
need explicit re-approval.

- **Sync (§9.2):** no client clock is trusted for cross-device ordering.
  Server-computed `effective_ts` with clamping; mutable documents merge by
  server version and field, not by `updated_at`; tombstones; grow-only unit
  unlocks.
- **Anti-cheat (§10), Goal 7:** suspicious events lose XP, never learning
  data. Density measured in event time, not submission rate.
- **Version skew (§4.3), R8:** `scheduler_version` on events,
  server-authoritative re-derivation, minimum sync version.
- **Word identity (§5.2, §6.1):** entries are senses; namespaced `word_id`;
  link-don't-duplicate for personal words; `word_alias` for later merges.
- **Enrichment (§8.2):** input validation, sense selection, versioned and
  invalidatable cache, copy-on-add, no user identifiers sent to providers.
- **Core loop, previously undefined:** session composition, new-word limit,
  and backlog cap (§7.4); unit unlock rule and placement consequences (§7.2);
  grade mapping (§7.3); XP (§8.7); streak day boundary and derivation (§8.4);
  retention definition (§8.3).
- **Skills (§7.5):** one memory state kept, with mode escalation and a
  production requirement for the mature tier.
- **Game modes (§8.1):** synonym-safe distractors, synonym handling in typing,
  length-scaled typo tolerance with real-word rejection.
- **Architecture (§4.1, §4.2):** new `client-data` package so the sync engine
  exists once; Expo-for-web considered and answered.
- **Leaderboards (§8.5):** Postgres only, Redis removed; pseudonymous default
  display names; opt-in username discovery; late-event policy.
- **Web storage (§9.1), R7:** eviction, multi-tab, and no-OPFS handling.
- **Compliance (§11, §5.4):** per-country age gate; licence constraints on
  frequency lists and dictionary APIs; legal-review items in §15.
- **Corpus packs (§5.1, §9.3):** one pack per (version, L1), whole-pack
  updates, no delta encoding; rules for revised, retired, and moved entries.
- † **Demo mode (§3, §8.6):** demo progress carries over when the learner
  creates an account from the demo, instead of always being discarded.
- † **Phasing (§14):** weekly leagues moved from Phase 1 to Phase 2.

**2026-09-20 — competitor research.** Changes drawn from
`docs/research/2026-09-20-competitor-research.html`. Items marked † alter a
previously settled product decision or the phasing and need explicit
re-approval.

- **Game modes (§8.1):** listening by selection and a practice-only matching
  game join Phase 1; listening by typing stays in Phase 2.
- **Desired retention (§7.1):** a relaxed / standard / intensive setting, Phase 1.
- **Audio quality bar (§5.4):** neural voice, spot-listening, re-generation of
  reported clips, Phase 1.
- **Entry contents (§5.2):** three to five example sentences and optional
  images (Phase 2); collection tags (Phase 3). New risk R9 for content cost.
- **Word capture (§8.2):** paste text, share sheet, and bulk import in Phase 2
  (import moved up from Phase 3); browser extension in Phase 3.
- **Leagues (§8.5):** inactive members are neither promoted nor relegated.
- **Goal collections (§8.9):** new, Phase 3.
- † **Free tier and entitlements (§8.8, §2, §6.2):** studying is never
  paywalled; only per-use-cost features may be metered; an `entitlement` hook
  ships in Phase 1. The monetisation non-goal is narrowed to pricing and
  payment handling.
- † **L1 rollout (§3, §14):** Phase 1 splits into 1a (Bulgarian beta) and 1b
  (the other four L1s). Further under-served L1s are evaluated in Phase 3.

**2026-09-20 — monetisation architecture.** Items marked † need explicit
approval.

- **Entitlement architecture (§8.8, §6.2):** the entitlement becomes a
  server-owned synced document with `source` and `expires_at`; one capability
  check in `core`; provider-agnostic shape. All Phase 1a.
- **Server-owned documents (§9.2):** new one-way document class in the sync
  protocol, read-only on clients, with expiry.
- **Pack manifest (§5.1):** a list rather than a single pack, so separately
  distributed content stays possible.
- **What may be charged for (§8.8):** widened from per-use-cost features only
  to metered features plus extras around the core loop. The free-tier
  principle is unchanged.
- † **Proposed model (§8.8):** a Plus tier from Phase 2 at about $30–40 a
  year, a capped lifetime option, nothing charged in Phase 1. Recorded as a
  proposal; pricing and payments still need their own specification.

**2026-09-20 — theme collections.**

- **Collections (§8.9):** split into theme collections (restaurant, travel,
  doctor …), which are free and move to Phase 1a, and exam collections, which
  stay in Phase 3 and remain a Plus candidate. One mechanism serves both.
- **Supporting changes:** theme tags and a curated theme list (§5.2), theme
  definitions in the pack (§5.1), collection priority in the new-word queue
  (§7.4), an optional onboarding question (§8.6), themes named under the
  free-tier principle (§8.8), pipeline tests for theme naming and size (§13).

**2026-09-21 — stack, web-only MVP, and build process.** Decisions made by the
product owner; none needs further approval.

- **Web-only MVP (§1, §3, §4.1, §14):** Phase 1a ships the web client alone,
  as an installable PWA. iOS and Android move to Phase 1b, built alongside the
  language releases. Replaces the decision to launch on three platforms.
- **Platform (§3, §4.1, §4.4):** Hono on Cloudflare Workers replaces Node and
  Fastify; Postgres is kept and reached through Hyperdrive; R2 for files;
  Queues for batch jobs. New §4.4 records what Workers imposes on the server.
- **Build (§4.1, §4.4):** GitHub and GitHub Actions for CI, deploy, and the
  corpus pipeline; new `pipeline/` package, making six.
- **Minimal spend (§3, §17):** the MVP runs on free tiers. New §17 names each
  vendor, its verified free allowance, what binds first, and the next step.
- **Passwordless sign-in (§8.6):** Google or an emailed one-time code; no
  passwords; Apple sign-in deferred to the iOS app.
- **Privacy (§11):** where data lives; two processors that do not keep data in
  the EU by default.
- **Risks (§12):** R10 platform limits and lock-in; R11 reachability in
  Russia, which ships last and targets Russian speakers abroad.
- **Launch configuration (§3):** now states the MVP subset explicitly.
- **Local development (§4.4), added 2026-09-21:** the whole MVP runs on a
  developer's machine with services stubbed; preview deployments are where
  platform limits are tested.

**2026-09-21 — second design review applied.** An independent read of the whole
document found three high-severity problems and about twenty others. All are
addressed here.

- **Event stamping (§9.2, §10):** the window is now well-defined. A push is one
  unit with one window; a wrong device clock is corrected as a whole and costs
  no XP; never-seen devices and carried-over demos have a lower bound; only
  individually clamped events lose XP; `effective_ts` is immutable. The
  procedure moved out of the open items, where it had been filed as tuning.
- **Unit unlocking (§7.2, §5.1):** a unit unlocks its successor once its live
  words are introduced. Retired, known, and suspended words are excluded, which
  removes a permanent dead-end; the later-day-success condition is gone, which
  removes a multi-day drought of new words after every unit.
- **XP (§8.7, §8.5, §10):** only a word's first scheduled review of the day
  earns XP, closing a loophole in which rating *Again* paid the most. The daily
  cap uses the server's day. League XP is recomputed, not incremented.
- **Streaks (§8.4):** a completed day is an immutable recorded event, so
  settings changes and re-derivations cannot rewrite past streaks.
- **Pull and rebase (§4.3, §9.2):** a pull carries a per-device mark and the
  client re-applies newer local events; a pull carries summaries rather than
  the event log. Tier thresholds no longer force a re-derivation.
- **Phase 1 no longer depends on Phase 2:** mode escalation uses flashcard
  recall until production modes exist, and those are then introduced
  gradually (§7.5); the personal dictionary is wholly Phase 2 and its queue
  step is empty until then (§7.4, §8.2).
- **Audio (§9.3, §8.1, §7.5):** corrected the claim that audio ships in the
  pack. Audio is prefetched, and `core` is told what can be played.
- **Entitlement expiry (§8.8, §9.2):** `expires_at` and `stale_after` are
  separated and the offline rule is stated once.
- **Documents (§9.2):** writes are patches with per-field versions; alias
  merge and undo are defined.
- **Enrichment (§8.2):** negative cache; two-part cache so language-independent
  work is not repeated per L1; offline add; audio references cannot dangle.
- **Smaller fixes:** homophones and matching boards in distractor rules (§8.1);
  tab take-over and an IndexedDB fallback (§9.1); the below-threshold league
  board is not the global board (§8.5, R6); level completion, practice, and
  the recognition rule reworded (§8.3, §7.4, §7.5); free-tier wording squared
  with the Plus proposal, and its quota made daily throughout (§8.8); corpus
  versioning and mid-session swaps (§5.1); new entities (§6.2).
- **Gaps filled, all Phase 1a unless noted:** reporting an error (§8.10);
  opt-in Web Push reminders (§8.11); known and suspended words (§7.4);
  changing L1 or level (§8.6, §7.2); self-service account deletion, JSON data
  export, analytics without consent prompts, how country is determined (§11);
  accessibility (§11.1); interface localisation (§11.2).
- **Phasing (§14):** Phase 1a now lists everything it depends on, says plainly
  that it is a heavy MVP, and names what can be cut first.
- **Housekeeping:** the MVP label added on 2026-09-20 had no log entry; this
  is it.

### Approval status

Every change since the original approval that alters a settled product
decision, the phasing, or scope. † in the body marks those still pending.

| Change | Status |
|---|---|
| Web-only MVP; Cloudflare stack; free tiers; GitHub Actions; passwordless sign-in | Decided by the product owner, 2026-09-21 |
| Theme collections in Phase 1a, free | Requested by the product owner, 2026-09-21 |
| Entitlement architecture (server-owned document, capability check) | Added at the product owner's request, 2026-09-21 |
| † Demo progress carries over on sign-up (§8.6) | Pending |
| † Weekly leagues moved from Phase 1 to Phase 2 (§14) | Pending |
| † Bulgarian first: Phase 1 split into 1a and 1b (§14) | Later decisions build on it; formal sign-off pending |
| † Free-tier principle; monetisation non-goal narrowed (§8.8, §2) | Discussed and welcomed; formal sign-off pending |
| † Proposed Plus model and indicative pricing (§8.8) | Pending; needs its own specification |
| † Phases chosen for the research improvements: new Phase 1 modes, desired retention, import moved up, images, extra sentences (§14) | Pending |
| † Scope added to Phase 1a by the second review: error reporting, reminders, known/suspended words, account deletion, data export, accessibility target, interface localisation (§14) | Pending |

---

## 17. Technology choices

The sections above describe roles; this appendix names who fills them today.
Every vendor here sits behind an interface in our code and can be replaced
without touching the design. Allowances were checked against vendor pages on
**2026-09-21** and must be re-checked before launch — free tiers change.

### 17.1 Choices

| Role | Choice | Notes |
|---|---|---|
| Source control, CI, deploy, corpus pipeline | GitHub + GitHub Actions | Linux runners only. Deploys use `cloudflare/wrangler-action` (v4). Bulk upload of audio to R2 goes through R2's S3-compatible API; `wrangler r2 object put` handles one object at a time. |
| API runtime | Cloudflare Workers + Hono | Hono also runs on Node — the exit path. |
| Web app hosting | Workers static assets | Static requests are free and unmetered. |
| Files and CDN | Cloudflare R2 | Audio and corpus packs. No egress charge. |
| Store of record | Managed Postgres in an EU region (Neon, Frankfurt), through Cloudflare Hyperdrive | Region availability on the free plan to be confirmed directly. Supabase is the alternative, but its free databases pause after a week of inactivity. D1 is the fallback (§4.4). |
| Batch jobs | Cloudflare Queues, started by Cron Triggers | Re-derivation (§4.3), league rollover (Phase 2). |
| Authentication | Better Auth (MIT, runs inside our Worker), with its email-OTP plugin and Google sign-in | User data stays in our database. Apple sign-in is added with the iOS app. |
| Transactional email | Resend | Sign-in codes only. Stores content and logs in the US (§11). Needs a verified sending domain. |
| LLM gateway (Phase 2 enrichment; build-time pipeline) | OpenRouter | One API across models, with structured output. Also offers TTS models. EU in-region routing is a paid business feature (§11). Requests are sent with data collection denied. |
| Payments (Phase 2, if the Plus model is approved) | A merchant of record — Creem or Paddle, decided then | A merchant of record handles EU VAT. **Not Lemon Squeezy:** it is being folded into Stripe Managed Payments, with 2026 reports of frozen payouts. Creem's payout support for Bulgaria is unconfirmed. External web checkout is now permitted from iOS apps in the US and EU, under terms still in flux. |

### 17.2 Free allowances and the first ceiling

Sized against a beta of about 500 daily learners making about 30 API requests
each: roughly 15,000 requests a day.

| Service | Free allowance | What binds first | Next step |
|---|---|---|---|
| Workers | 100,000 requests/day; **10 ms CPU per request**; 5 Cron Triggers | CPU, not requests. Password hashing is documented to exceed it, which is one reason sign-in is passwordless (§8.6). Replay on sync is the next candidate. | Workers Paid, $5/month: 10M requests and 30M CPU-ms included, up to 5 min CPU per request |
| Hyperdrive | 100,000 queries/day | Several queries per request; keep sync to a few statements per page | Unlimited with Workers Paid |
| Postgres (Neon) | 0.5 GB storage; 100 compute-hours/month; suspends after 5 min idle and wakes in a few hundred ms | Compute-hours under steady traffic. Clients sync in batches at session end, not per answer, which keeps the database asleep more of the day. | Neon's paid plan (price to be confirmed) |
| Queues | 10,000 operations/day (about 3,300 messages); 24 h retention | A full re-derivation of a large user base in one day | Paid Queues pricing (to be confirmed) |
| R2 | 10 GB storage; 1M write-class and 10M read-class operations/month; free egress | Not expected for A1–B1 audio and packs | Pay per GB beyond 10 GB |
| Resend | 3,000 emails/month; **100/day**; 3 domains | The daily cap, on a day many new learners sign up by email. Google sign-in and long sessions carry most of the load. | Resend's paid plan (price to be confirmed) |
| GitHub Actions | 2,000 minutes/month on private repositories; unmetered on public ones; 500 MB artifacts | Frequent CI plus pipeline runs | Pay per minute (Linux is cheapest) |
| Better Auth, Hono, React, Vite | Open source | — | — |

**Expected running cost of the MVP:** nothing, moving to $5 a month when the
Workers CPU cap is first hit. Outside the service tiers: a domain name, the
one-off LLM and TTS cost of building the corpus, and human review. The $99 a
year Apple Developer Program fee is deferred with the mobile apps.
