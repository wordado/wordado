# Web Client, Part A: Platform and Study Loop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@wordado/web`, the installable PWA, up to a complete offline study loop: SQLite in the browser (OPFS, then IndexedDB, then memory), one tab owning the database, the bundled Bulgarian sample pack and its audio, the four Phase 1 game modes, the home screen, the path, themes, progress, practice and matching, report-an-error, and a Bulgarian and English interface — all running as the demo, with no account.

**Architecture:** SQLite runs in a dedicated Worker (`@journeyapps/wa-sqlite`); the page talks to it through a message-passing `SqlDriver`, so `client-data` runs unchanged on top. The session state machine that every client needs — which word comes next, which mode it is asked in, what its options are, how an answer is graded and recorded — is added to `core` (`buildItem`) and `client-data` (`StudyRun`, `MatchingRun`), so the React views only render a snapshot and forward key presses. The app boots through one `Boot` object: take the tab lock, open the database, open the `Client`, install the bundled sample pack, and publish a state the root component renders.

**Tech Stack:** Node 24, pnpm 12, TypeScript 7, Vitest 5 (a `happy-dom` project and a Chromium browser project through `@vitest/browser-playwright`), Vite 8 with `@vitejs/plugin-react` 6, React 19, `@journeyapps/wa-sqlite` 2.0.6, `vite-plugin-pwa` 1.3 (`injectManifest`) with Workbox 7.4, Playwright 1.63 with `@axe-core/playwright` for the end-to-end run, and the Golos Text and Literata variable fonts from Fontsource.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` — this plan implements §4.1 (`web/` and its `SqlDriver`), §7.4 (session order, extra practice, single-mode sessions), §7.5 (mode escalation, per item), §8.1 (the four Phase 1 modes, their grading, matching as practice), §8.3 (the progress screens), §8.4 (the completed day, shown), §8.9 (theme collections), §8.10 (reporting an error), §9.1 (OPFS, the IndexedDB and in-memory fallbacks, single-tab ownership and take-over), §9.3 (audio caching and prefetch, listening only when playable), §11.1 (keyboard and screen-reader operation of every game mode, no colour-only signals, reduced motion) and §11.2 (Bulgarian and English interface, bundled Cyrillic fonts). It is plan **6a** of the roadmap (`docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`); plan 6b (accounts, sign-in, the age gate, demo carry-over, sync, settings, placement, reminders, deletion and export, installation) follows it. Plans 1–5 hand this plan contracts, listed under "Contracts this plan honours" below.

## Global Constraints

- No learning rule in `web/` (spec §4.1): which word comes next, which mode, which options, what grade, what unlocks, what completes a day — all come from `core` or `client-data`. A scheduling, grading or unlock condition written in `web/src` is a defect. The views read `ClientSnapshot`, `RunSnapshot` and `MatchingSnapshot` and call their methods.
- No outbox or sync logic in `web/` (spec §4.1). This plan opens no transport at all: the app is the demo.
- `core` stays pure (spec §4.1). `studyItems.ts` is a function of its inputs; randomness is passed in.
- The demo's database is its own file, `demo`, in whichever storage the browser gives (decision of 2026-09-24, spec §8.6 revised in Task 11). It is never uploaded by this plan.
- Every game mode is fully operable by keyboard and screen reader (spec §11.1): digits 1–4 answer, Space or Enter reveals and continues, focus moves to the new prompt, feedback is announced through a live region, correct and incorrect are marked by icon **and** text, and motion is off under `prefers-reduced-motion`.
- Listening is offered only when the clip can actually be played (spec §7.5, §9.3): the browser must play the clip's MIME type, and the clip must be cached or the device online. A failed playback still lets the learner answer.
- Interface strings live in `web/src/i18n/`, typed so a key missing from Bulgarian is a compile error. Unit titles and theme names come from the pack in `en` and `l1`, never from the string tables (plan 3 contract).
- Fonts are bundled (spec §11.2): Golos Text for the interface, Literata for headwords and translations, both with Cyrillic. No font is loaded from a third party.
- The only persistent browser storage is the SQLite file, the audio cache (`wordado-audio-v1`), the service worker's precache and one `localStorage` key for the interface language.
- Code style: no semicolons, single quotes, 2-space indent, named exports only (the Vite and Playwright configs, which must default-export, are the exceptions), `readonly` on every interface field. Tests sit beside their module; browser-only tests are named `*.browser.test.ts`.
- Every task ends with `pnpm test` and `pnpm typecheck` green from the repository root. The web suite's browser project needs Chromium once per machine: `pnpm --filter @wordado/web exec playwright install chromium`.

## Review Focus

- **A double key press on an answer.** A learner presses 2 twice in quick succession, or taps an option while the first answer is still being written: exactly one event is recorded, and the second press does nothing. Pinned in Task 2 (`StudyRun.choose` guard) and Task 8 (the view).
- **A word rated Again in a run that has nothing else due.** The run must end rather than wait or spin on a word due in ten minutes, and the word must come back in a run started after the relearn delay. Pinned in Task 2.
- **A second tab opened mid-session.** The second tab shows the notice and does not touch the database; taking over makes the first tab close its database before the second opens it, and the first then shows the notice. Pinned in Task 5 and the end-to-end run of Task 11.
- **A browser without OPFS** (private windows, older Safari). The app opens on IndexedDB without a word to the learner, and on memory with a banner that says progress will not be kept. Pinned in Task 4 (`openFirst`) and Task 10 (the banner).
- **Audio that cannot be played** — a browser without AAC, or offline with the clip not cached. Listening is never served; if a play still fails, the learner can answer and replay. Pinned in Task 6 (`AudioStore`) and Task 8 (the listening view).

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| Options in a choice item | 4 | `core/src/studyItems.ts` |
| Pairs on a matching board | 5 | `core/src/studyItems.ts` |
| Words in a practice run | 10 | `client-data/src/run.ts` |
| Audio prefetch horizon | today's session plus reviews due in the next 3 days | `client-data/src/study.ts` |
| Tab take-over wait before stealing the lock | 5 seconds | `web/src/storage/tabLock.ts` |

## Decisions recorded here

- **Plan 6 is split** (product owner, 2026-09-24). 6a ends with a complete study loop running as the demo; 6b adds accounts and everything that needs one. The roadmap is updated in Task 11.
- **The demo has its own database file** (product owner, 2026-09-24). Spec §8.6 said demo events are held in memory only, but Google sign-in is a full-page redirect that would lose them before they could be carried over. The demo database lives in the same storage as a learner's (`demo` beside 6b's per-account file), survives a reload and the redirect, is deleted when the demo is discarded (6b), and never leaves the device unless an account is created. Spec §8.6 is updated in Task 11.
- **`@journeyapps/wa-sqlite`, not `wa-sqlite`.** The `wa-sqlite` package on npm stopped at 1.0.0 (January 2024) and lacks `OPFSCoopSyncVFS`; PowerSync's fork is published from the same code line and maintained (2.0.6, September 2026). A prototype on 2026-09-24 ran the driver below in Chromium under Vitest's browser mode on all three backends, including reopening a persisted file, and built with Vite 8.
- **SQLite runs in a dedicated Worker, one connection.** OPFS synchronous access handles exist only in workers. The Worker tries `OPFSCoopSyncVFS` with the synchronous build, then `IDBBatchAtomicVFS` with the asynchronous build, then an in-memory database; it answers one request at a time in order, which is the `SqlDriver` contract (plan 4). Transactions stay `client-data`'s.
- **The session state machine is shared code.** Spec §4.1 puts "game session state machine" in `core`. `buildItem` (mode, direction, options) is pure and goes in `core`; `StudyRun` and `MatchingRun`, which call `Client.answer`, go in `client-data`, where the mobile client will reuse them. `web/` renders.
- **The next word is read from the live plan.** `StudyRun` asks `client.snapshot.plan` for its next word after every answer, instead of freezing a queue at the start: an answer changes what is due (a word rated Again returns after ten minutes), and the plan already encodes the order of spec §7.4. A run ends when the plan has nothing due now.
- **Listening needs a playable format.** The sample's clips are AAC (`audio/mp4`), which some browsers cannot decode — Firefox and Chromium builds without proprietary codecs on some Linux distributions among them. `AudioStore` asks `canPlayType` once per MIME type; if the answer is empty, it reports no cached clips and no streaming, so `client-data`'s `availableModes` never offers listening that would fail. (Playwright's Chromium 1.63 does play AAC, checked on 2026-09-24, so the end-to-end run covers listening.)
- **No router or i18n library.** Nine routes and two languages do not justify either: `router.ts` is `history.pushState` behind `useSyncExternalStore`, and `i18n/` is two typed message tables with `Intl.PluralRules`.
- **The service worker is Workbox through `vite-plugin-pwa`'s `injectManifest`,** built as a classic script (`iife`) so every browser can register it. It precaches the app shell, both SQLite builds and the bundled sample with its audio, so a second visit works offline. Plan 6b adds its `push` handler to the same file.
- **Visual direction: a dictionary entry.** The headword is the one memorable element — large Literata, IPA beneath it, the part of speech in italic — on a cool paper ground with deep ink text and a single rose accent for the primary action. Everything else is quiet lists and rules, not cards. Tokens are in `styles.css`; dark mode follows `prefers-color-scheme`.
- **One browser in this plan.** The end-to-end run uses Playwright's Chromium only: the demo in every mode, offline reload, a second tab and an accessibility scan of every screen. Plan 7 runs it across the browser matrix of spec §13.

## Contracts this plan honours

- From plan 3: packs and audio resolve against the manifest's URL; the bundled sample is served under one prefix with the same layout (`manifest.json`, `corpus-v0-bg.pack`, `audio/`); unit titles and theme names come from the pack; `offeredThemes` is the theme picker; `themeEntries` feeds the collection (through `client-data`).
- From plan 4: `SqlDriver` is `exec`, `run`, `all`, `close` over one connection in call order, with `Uint8Array` blobs, and opens no transactions of its own; `ClientEnv` on the web is `Date.now`, `0 - getTimezoneOffset()`, `crypto.randomUUID`, an `Rng` over `crypto.getRandomValues` and `crypto.subtle.digest` as lowercase hex; `startSession()` at the start of every run; `installPacks` on launch; `availableModes(wordId, cachedClips, online)` per item with `chooseMode(masteryTier(...))`; `DistractorContext` from the corpus and the learner's states. The demo is a `Client` with no `transport`.
- From plan 5: the web client serves the sample pack itself (the server does not serve packs); the Vite dev server will proxy `/api` and `/v1` to the Worker on :8787 once 6b opens a transport (the proxy is added in Task 3 so 6b needs no config change).

---

## File Structure

```
core/src/
  studyItems.ts         buildItem, StudyItem, practiceWords, matchingCandidates      (new)     §7.4, §7.5, §8.1
  index.ts              re-exports it                                                  (modify)
client-data/src/
  run.ts                StudyRun: the session and practice state machine              (new)     §7.4, §8.1
  matching.ts           MatchingRun: the practice-only matching board                 (new)     §8.1
  testing/sample.ts     the sample pack for the suites (Node only)                    (new)
  study.ts              pathView, upcomingClips, AUDIO_PREFETCH_DAYS                  (modify)  §7.2, §9.3
  packs.ts              activePackVersion                                              (modify)  §8.10
  client.ts             snapshot.path, snapshot.packVersion, upcomingClips            (modify)
  index.ts              re-exports run and matching                                    (modify)
pnpm-workspace.yaml     adds web                                                       (modify)
.gitignore              test-results/, playwright-report/, .vitest/                    (modify)
web/
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, playwright.config.ts, index.html, README.md
  public/icon.svg                     the app icon
  vite/samplePack.ts                  Vite plugin: serves and emits the bundled sample pack
  src/
    main.tsx                          the real dependencies, <Root>, the service worker
    env.ts                            webEnv(): ClientEnv
    router.tsx                        Route, parseRoute, routeHref, navigate, useRoute, Link
    useStore.ts                       useStore(store)
    labels.ts                         message keys for tiers, modes, grades, parts of speech
    i18n/en.ts, i18n/bg.ts            the message tables
    i18n/i18n.tsx                     translate, localized, I18nProvider, useT
    storage/protocol.ts               Backend, WorkerCall, WorkerRequest, WorkerResponse
    storage/open.ts                   StorageUnavailable, openFirst
    storage/waSqlite.ts               openOpfs, openIdb, openMemory, allRows (in the Worker)
    storage/vfs-shims.d.ts            type shim for OPFSCoopSyncVFS
    storage/sqlite.worker.ts          the Worker: one connection, requests in order
    storage/workerDriver.ts           openWorkerDriver(): SqlDriver over the Worker
    storage/tabLock.ts                TabLock: Web Locks + BroadcastChannel take-over
    content/packs.ts                  SAMPLE_MANIFEST_URL, fetchManifest, packFetcher, clipUrl
    content/audio.ts                  AudioStore, AudioPort, AUDIO_CACHE
    app/context.tsx                   AppServices, AppProvider, useApp
    app/boot.ts                       Boot: lock, driver, Client, sample pack, ready
    app/Root.tsx                      renders the boot state
    app/App.tsx                       the shell: wordmark, navigation, language, banner, routes
    screens/Home.tsx, Path.tsx, Themes.tsx, Progress.tsx, Study.tsx, Practice.tsx, Matching.tsx
    study/keys.ts                     keyAction(): the keyboard map
    study/Headword.tsx                the dictionary-entry block, Translation
    study/ReportDialog.tsx            report a problem (spec §8.10)
    study/RunView.tsx                 renders a StudyRun: prompt, options, feedback, done
    sw.ts                             the service worker (Workbox precache, offline shell)
    styles.css                        tokens and components
    test/fixtures.tsx                 setup, renderWith, fakeAudio, answerNew
  e2e/demo.spec.ts                    Playwright: the demo end to end, with axe
docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md                  the 6a/6b split     (modify)
docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md    §8.6 demo storage   (modify)
```

Every module has its test beside it (`*.test.ts(x)`, or `*.browser.test.ts` for what needs a real browser).

Task order: `core` study items (1) → `client-data` runs and views (2) → the `web` package, environment, language and router (3) → SQLite in a Worker (4) → the tab lock (5) → content and audio (6) → the read-only screens (7) → studying (8) → practice and matching (9) → boot, shell and design (10) → offline shell, end to end and documents (11). The screens come before the shell, so no task ships a placeholder screen.

---
### Task 1: `core`: study items, practice words and matching candidates

The pure half of the game-session state machine (spec §4.1, §7.5, §8.1): for one word, the mode it is asked in, its direction, and — for the two choice modes — four options with the answer's position. Also the two practice pickers of spec §7.4 and §8.1.

**Files:**
- Create: `core/src/studyItems.ts`
- Test: `core/src/studyItems.test.ts`
- Modify: `core/src/index.ts`

**Interfaces:**
- Consumes (existing `core`): `chooseMode(tier, available, rng)`, `masteryTier(state)`, `pickDistractors(target, ctx, count, rng)`, `shuffle(items, rng)`, `parseWordId`, `corpusWordId`, `Corpus`, `CorpusEntry`, `ReviewState`, `Mode`, `Direction`, `WordFlag`, `WordId`, `Rng`.
- Produces:
  - `CHOICE_OPTIONS = 4`, `MATCHING_PAIRS = 5`
  - `type ChoiceMode = 'multiple_choice' | 'listening_select'`
  - `type StudyItem = FlashcardItem | ChoiceItem` where `FlashcardItem = { mode: 'flashcard'; wordId: WordId; entry: CorpusEntry; direction: Direction }` and `ChoiceItem = { mode: ChoiceMode; wordId; entry; direction; options: readonly CorpusEntry[]; answerIndex: number }`
  - `interface ItemContext { corpus: Corpus; states: ReadonlyMap<WordId, ReviewState>; available: ReadonlySet<Mode>; preferred: Mode | null; rng: Rng }`
  - `buildItem(wordId: WordId, ctx: ItemContext): StudyItem | null`
  - `practiceWords(input: { states; flags: ReadonlyMap<WordId, WordFlag>; exclude: ReadonlySet<WordId>; count: number; rng: Rng }): WordId[]`
  - `matchingCandidates(corpus: Corpus, states, flags): CorpusEntry[]`

- [ ] **Step 1: Write the failing test**

`core/src/studyItems.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Corpus } from './corpus'
import { isValidDistractor } from './distractors'
import { seededRng } from './rng'
import type { ReviewState } from './scheduler'
import { buildItem, CHOICE_OPTIONS, matchingCandidates, practiceWords, type ItemContext } from './studyItems'
import { Grade, type CorpusEntry, type Mode, type WordFlag } from './types'
import { corpusWordId, type WordId } from './wordId'

let n = 0
function entry(headword: string, translation: string, over: Partial<CorpusEntry> = {}): CorpusEntry {
  n += 1
  return {
    entryId: `${headword}-${n}`,
    headword,
    variants: [],
    pos: 'noun',
    sense: '',
    level: 'A1',
    ipa: `/${headword}/`,
    unitId: 'a1-01',
    themes: [],
    translations: [translation],
    examples: [],
    audio: {},
    retired: false,
    ...over,
  }
}

const apple = entry('apple', 'ябълка')
const bread = entry('bread', 'хляб')
const cheese = entry('cheese', 'сирене')
const milk = entry('milk', 'мляко')
const water = entry('water', 'вода')
const their = entry('their', 'техен', { pos: 'det', ipa: '/ðeə/' })
const there = entry('there', 'там', { pos: 'adv', ipa: '/ðeə/' })
const old = entry('old', 'стар', { retired: true })
const ENTRIES = [apple, bread, cheese, milk, water, their, there, old]

const corpus = (entries: readonly CorpusEntry[] = ENTRIES): Corpus => ({
  l1: 'bg',
  entries: new Map(entries.map((e) => [e.entryId, e])),
  units: [],
  themes: [],
  clips: new Map(),
  retired: new Set(entries.filter((e) => e.retired).map((e) => corpusWordId(e.entryId))),
})

const id = (e: CorpusEntry): WordId => corpusWordId(e.entryId)

function state(wordId: WordId, stability: number): ReviewState {
  return {
    wordId,
    stability,
    difficulty: 5,
    introducedTs: 0,
    introducedDay: 0,
    lastReviewTs: 0,
    lastReviewDay: 0,
    lastGrade: Grade.Good,
    reps: 1,
    lapses: 0,
    passedOnLaterDay: false,
  }
}

const BOTH: ReadonlySet<Mode> = new Set<Mode>(['flashcard', 'multiple_choice'])

const ctx = (over: Partial<ItemContext> = {}): ItemContext => ({
  corpus: corpus(),
  states: new Map(),
  available: BOTH,
  preferred: null,
  rng: seededRng(1),
  ...over,
})

describe('buildItem', () => {
  it('asks a new word by recognition, with four unambiguous options and the answer among them', () => {
    const item = buildItem(id(apple), ctx())
    expect(item?.mode).toBe('multiple_choice')
    if (!item || item.mode === 'flashcard') throw new Error('expected a choice item')
    expect(item.options).toHaveLength(CHOICE_OPTIONS)
    expect(item.options[item.answerIndex]).toBe(apple)
    expect(new Set(item.options.map((o) => o.entryId)).size).toBe(CHOICE_OPTIONS)
    for (const option of item.options) if (option !== apple) expect(isValidDistractor(apple, option, false)).toBe(true)
  })

  it('asks a young or mature word by recall (spec §7.5)', () => {
    const item = buildItem(id(apple), ctx({ states: new Map([[id(apple), state(id(apple), 30)]]) }))
    expect(item).toEqual({ mode: 'flashcard', wordId: id(apple), entry: apple, direction: 'en_to_l1' })
  })

  it('honours a single-mode session when the mode can run, and ignores it when it cannot', () => {
    expect(buildItem(id(apple), ctx({ preferred: 'flashcard' }))?.mode).toBe('flashcard')
    expect(buildItem(id(apple), ctx({ preferred: 'listening_select' }))?.mode).toBe('multiple_choice')
  })

  it('never picks matching, which is a practice game', () => {
    const item = buildItem(id(apple), ctx({ available: new Set<Mode>(['matching', 'flashcard']), preferred: 'matching' }))
    expect(item?.mode).toBe('flashcard')
  })

  it('asks listening in English, with homophones left out of the options', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const item = buildItem(id(their), ctx({ available: new Set<Mode>(['listening_select']), preferred: 'listening_select', rng: seededRng(seed) }))
      if (!item || item.mode !== 'listening_select') throw new Error('expected a listening item')
      expect(item.direction).toBe('en_to_l1')
      expect(item.options.map((o) => o.headword)).not.toContain('there')
    }
  })

  it('uses both directions for multiple choice', () => {
    const directions = new Set<string>()
    for (let seed = 1; seed <= 20; seed += 1) directions.add(buildItem(id(apple), ctx({ rng: seededRng(seed) }))!.direction)
    expect(directions).toEqual(new Set(['en_to_l1', 'l1_to_en']))
  })

  it('falls back to a flashcard when the corpus cannot supply three distractors', () => {
    const item = buildItem(id(apple), ctx({ corpus: corpus([apple, bread, old]) }))
    expect(item?.mode).toBe('flashcard')
  })

  it('returns null for a word the corpus does not hold', () => {
    expect(buildItem('c:missing-1', ctx())).toBeNull()
    expect(buildItem('u:0f0f0f0f-0000-4000-8000-000000000000', ctx())).toBeNull()
  })
})

describe('practiceWords', () => {
  const states = new Map(ENTRIES.slice(0, 5).map((e) => [id(e), state(id(e), 10)]))

  it('draws introduced words that are neither flagged nor excluded, at most `count`', () => {
    const flags = new Map<WordId, WordFlag>([[id(bread), 'known']])
    const words = practiceWords({ states, flags, exclude: new Set([id(cheese)]), count: 10, rng: seededRng(1) })
    expect(new Set(words)).toEqual(new Set([id(apple), id(milk), id(water)]))
    expect(practiceWords({ states, flags: new Map(), exclude: new Set(), count: 2, rng: seededRng(1) })).toHaveLength(2)
  })

  it('is empty before any word is introduced', () => {
    expect(practiceWords({ states: new Map(), flags: new Map(), exclude: new Set(), count: 10, rng: seededRng(1) })).toEqual([])
  })
})

describe('matchingCandidates', () => {
  it('offers introduced, live corpus words only', () => {
    const states = new Map([apple, bread, old, cheese].map((e) => [id(e), state(id(e), 1)]))
    const flags = new Map<WordId, WordFlag>([[id(cheese), 'suspended']])
    expect(matchingCandidates(corpus(), states, flags)).toEqual([apple, bread])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- studyItems`
Expected: FAIL — `Cannot find module './studyItems'`.

- [ ] **Step 3: Write the implementation**

`core/src/studyItems.ts`:

```ts
import type { Corpus } from './corpus'
import { pickDistractors } from './distractors'
import { masteryTier } from './mastery'
import { chooseMode } from './modeSelection'
import { shuffle, type Rng } from './rng'
import type { ReviewState } from './scheduler'
import type { CorpusEntry, Direction, Mode, WordFlag } from './types'
import { corpusWordId, parseWordId, type WordId } from './wordId'

/** Options shown in a choice item, the answer included (spec §8.1). Tuning (§15). */
export const CHOICE_OPTIONS = 4

/** Pairs on a matching board (spec §8.1). Tuning (§15). */
export const MATCHING_PAIRS = 5

export type ChoiceMode = 'multiple_choice' | 'listening_select'

export interface FlashcardItem {
  readonly mode: 'flashcard'
  readonly wordId: WordId
  readonly entry: CorpusEntry
  readonly direction: Direction
}

export interface ChoiceItem {
  readonly mode: ChoiceMode
  readonly wordId: WordId
  readonly entry: CorpusEntry
  /** en_to_l1 shows the headword and offers translations; l1_to_en the reverse. Listening is always en_to_l1. */
  readonly direction: Direction
  /** English headwords, or for en_to_l1 multiple choice, entries whose primary translation is shown. */
  readonly options: readonly CorpusEntry[]
  readonly answerIndex: number
}

/** One question of a session: what is asked, and how (spec §8.1). */
export type StudyItem = FlashcardItem | ChoiceItem

export interface ItemContext {
  readonly corpus: Corpus
  readonly states: ReadonlyMap<WordId, ReviewState>
  /** What can run for this word right now: `client-data`'s `availableModes`. */
  readonly available: ReadonlySet<Mode>
  /** A learner-chosen single-mode session (spec §7.4); used when it can run, otherwise the mixed choice. */
  readonly preferred: Mode | null
  readonly rng: Rng
}

const flashcard = (wordId: WordId, entry: CorpusEntry): FlashcardItem => ({ mode: 'flashcard', wordId, entry, direction: 'en_to_l1' })

/**
 * Builds the item for one word (spec §7.5, §8.1): the preferred mode when it
 * can run, else `chooseMode` by mastery tier; distractors from `pickDistractors`,
 * homophones excluded for listening. A choice mode whose distractors the corpus
 * cannot supply falls back to a flashcard. Null for a word not in the corpus.
 */
export function buildItem(wordId: WordId, ctx: ItemContext): StudyItem | null {
  const { kind, key } = parseWordId(wordId)
  const entry = kind === 'corpus' ? ctx.corpus.entries.get(key) : undefined
  if (!entry) return null
  // Matching is a practice game with its own board, never a session item.
  const available: ReadonlySet<Mode> = new Set([...ctx.available].filter((mode) => mode !== 'matching'))
  const mode =
    ctx.preferred !== null && available.has(ctx.preferred)
      ? ctx.preferred
      : chooseMode(masteryTier(ctx.states.get(wordId)), available, ctx.rng)
  if (mode !== 'multiple_choice' && mode !== 'listening_select') return flashcard(wordId, entry)
  const listening = mode === 'listening_select'
  const distractors = pickDistractors(
    entry,
    { pool: [...ctx.corpus.entries.values()], encountered: new Set(ctx.states.keys()), listening },
    CHOICE_OPTIONS - 1,
    ctx.rng,
  )
  if (distractors.length < CHOICE_OPTIONS - 1) return flashcard(wordId, entry)
  const options = shuffle([entry, ...distractors], ctx.rng)
  const direction: Direction = listening || ctx.rng() < 0.5 ? 'en_to_l1' : 'l1_to_en'
  return { mode, wordId, entry, direction, options, answerIndex: options.indexOf(entry) }
}

export interface PracticeInput {
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** Words the schedule serves now; practising them would only duplicate the session. */
  readonly exclude: ReadonlySet<WordId>
  readonly count: number
  readonly rng: Rng
}

/** Words for extra practice (spec §7.4): introduced, not flagged, not in today's session. */
export function practiceWords(input: PracticeInput): WordId[] {
  const candidates = [...input.states.keys()].filter((id) => !input.flags.has(id) && !input.exclude.has(id))
  return shuffle(candidates, input.rng).slice(0, Math.max(0, input.count))
}

/** What a matching board may use (spec §8.1): introduced, live corpus words. */
export function matchingCandidates(
  corpus: Corpus,
  states: ReadonlyMap<WordId, ReviewState>,
  flags: ReadonlyMap<WordId, WordFlag>,
): CorpusEntry[] {
  return [...corpus.entries.values()].filter((e) => {
    const wordId = corpusWordId(e.entryId)
    return !e.retired && states.has(wordId) && !flags.has(wordId)
  })
}
```

Add to `core/src/index.ts`, after `export * from './syncValidation'`:

```ts
export * from './studyItems'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/core test -- studyItems`
Expected: PASS (11 tests).

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 6: Commit**

```bash
git add core/src/studyItems.ts core/src/studyItems.test.ts core/src/index.ts
git commit -m "feat(core): study items — mode, direction and options for one word; practice and matching pickers"
```

---
### Task 2: `client-data`: the study run, the matching board, and what the screens read

The half of the session state machine that records answers (spec §4.1, §7.4, §8.1), shared with the future mobile client: `StudyRun` serves a session or a practice run one item at a time and records each answer through `Client.answer`; `MatchingRun` plays one practice board. The client's snapshot gains the two things the web screens need and cannot compute without rules — the path's unlocked set and current unit, and the active pack version for reports — and a method listing the clips to prefetch.

**Files:**
- Create: `client-data/src/run.ts`, `client-data/src/matching.ts`, `client-data/src/testing/sample.ts`
- Modify: `client-data/src/study.ts`, `client-data/src/packs.ts`, `client-data/src/client.ts`, `client-data/src/index.ts`
- Test: `client-data/src/run.test.ts`, `client-data/src/matching.test.ts`, `client-data/src/client.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `buildItem`, `practiceWords`, `matchingCandidates`, `MATCHING_PAIRS`, `StudyItem`; `core`'s `gradeAnswer`, `buildMatchingBoard`, `computeUnlocks`, `currentUnit`, `dueDay`, `entryClips`, `RETENTION_TARGETS`, `shuffle`; `Client` (`snapshot`, `answer`, `availableModes`, `startSession`).
- Produces, from `study.ts`: `interface PathView { unlocked: ReadonlySet<string>; currentUnitId: string | null }`; `pathView(ctx: StudyContext): PathView`; `AUDIO_PREFETCH_DAYS = 3`; `upcomingClips(ctx: StudyContext, plan: SessionPlan, horizonDays?: number): AudioClip[]`.
- Produces, from `packs.ts`: `activePackVersion(db: Database): Promise<number | null>`.
- Produces, from `client.ts`: `ClientSnapshot.path: PathView | null`; `ClientSnapshot.packVersion: number | null`; `Client.upcomingClips(horizonDays?: number): AudioClip[]`.
- Produces, from `run.ts`: `PRACTICE_RUN_SIZE = 10`; `type RunKind = 'session' | 'practice'`; `interface RunOptions { kind: RunKind; mode: Mode | null; cachedClips(): ReadonlySet<string>; online(): boolean }`; `type RunPhase = 'prompt' | 'revealed' | 'feedback' | 'done'`; `interface RunFeedback { correct: boolean; chosen: number; grade: Grade }`; `interface RunSnapshot { phase; item: StudyItem | null; feedback: RunFeedback | null; answered: number; remaining: number; dayCompleted: boolean; unlocked: readonly string[]; error: string | null }`; `class StudyRun { static start(client, env: RunEnv, options): Promise<StudyRun>; store: Store<RunSnapshot>; snapshot; presented(); reveal(); rate(grade): Promise<void>; choose(index): Promise<void>; next(); finish() }`; `type RunEnv = Pick<ClientEnv, 'now' | 'rng'>`.
- Produces, from `matching.ts`: `type MatchingSide = 'left' | 'right'`; `interface MatchingSnapshot { left: readonly CorpusEntry[]; right: readonly CorpusEntry[]; matched: ReadonlySet<string>; selected: { side: MatchingSide; entryId: string } | null; miss: { left: string; right: string } | null; done: boolean; error: string | null }`; `class MatchingRun { static start(client, env: RunEnv): MatchingRun | null; store; snapshot; select(side, entryId): Promise<void> }`.
- Produces, from `testing/sample.ts` (Node only, like `testing/testEnv.ts`): `SAMPLE_DIR`, `sampleManifest`, `sampleFetcher`, `openSampleClient(env?: TestEnv): Promise<Client>`.

- [ ] **Step 1: Write the shared sample fixture**

The sample pack is loaded the same way in three suites now (this one, the web suite, and `client.test.ts`); one fixture keeps them alike.

`client-data/src/testing/sample.ts`:

```ts
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PackManifest } from '@wordado/core'
import { Client } from '../client'
import { nodeSqliteDriver } from '../drivers/nodeSqlite'
import type { PackFetcher } from '../packs'
import { testEnv, type TestEnv } from './testEnv'

/**
 * The bundled A1 Bulgarian sample (plan 3). Node only. Built from the string
 * form of import.meta.url: happy-dom replaces the global URL class.
 */
export const SAMPLE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'pipeline', 'samples', 'a1-bg')

export const sampleManifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest

export const sampleFetcher: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

/** A demo client over an in-memory database with the sample active. */
export async function openSampleClient(env: TestEnv = testEnv()): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
  await client.installPacks(sampleManifest, sampleFetcher)
  await client.startSession()
  return client
}
```

- [ ] **Step 2: Write the failing tests**

`client-data/src/run.test.ts`:

```ts
import { Grade, RELEARN_DELAY_MS, type Mode } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { PRACTICE_RUN_SIZE, StudyRun, type RunOptions } from './run'
import { openSampleClient } from './testing/sample'
import { testEnv } from './testing/testEnv'

const options = (over: Partial<RunOptions> = {}): RunOptions => ({
  kind: 'session',
  mode: null,
  cachedClips: () => new Set(),
  online: () => false,
  ...over,
})

/** Answers whatever is asked, correctly, until the run ends. */
async function playThrough(run: StudyRun, grade: Grade = Grade.Good): Promise<void> {
  for (let guard = 0; guard < 200 && run.snapshot.phase !== 'done'; guard += 1) {
    const { phase, item } = run.snapshot
    if (!item) break
    if (item.mode === 'flashcard') {
      if (phase === 'prompt') run.reveal()
      await run.rate(grade)
    } else if (phase === 'prompt') {
      await run.choose(grade === Grade.Again ? (item.answerIndex + 1) % item.options.length : item.answerIndex)
    } else {
      run.next()
    }
  }
}

describe('StudyRun', () => {
  it('serves the session plan in order, records each answer, and ends when nothing is due', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const planned = client.snapshot.plan!.newWords
    const run = await StudyRun.start(client, env, options())
    expect(run.snapshot).toMatchObject({ phase: 'prompt', remaining: 10, answered: 0 })
    expect(run.snapshot.item?.wordId).toBe(planned[0])
    await playThrough(run)
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 10, remaining: 0, dayCompleted: true })
    expect(run.snapshot.unlocked).toEqual(['a1-01'])
    expect(client.snapshot.progress?.tiers.new).toBe(50)
  })

  it('grades a choice from its latency, measured from when the prompt was presented', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(20_000) // e.g. the audio of a listening item
    run.presented()
    env.advance(9_000) // slower than the 8 s threshold
    await run.choose(item.answerIndex)
    expect(run.snapshot.feedback).toEqual({ correct: true, chosen: item.answerIndex, grade: Grade.Hard })
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Hard)
  })

  it('records a wrong choice as Again and shows which option was chosen', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const wrong = (item.answerIndex + 1) % item.options.length
    await run.choose(wrong)
    expect(run.snapshot).toMatchObject({ phase: 'feedback', feedback: { correct: false, chosen: wrong, grade: Grade.Again } })
    // Again brings the word back after the relearn delay, not now: 9 are left.
    expect(run.snapshot.remaining).toBe(9)
    run.next()
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('records one answer when the same choice arrives twice at once', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'multiple_choice' }))
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await Promise.all([run.choose(item.answerIndex), run.choose(item.answerIndex)])
    expect(run.snapshot.answered).toBe(1)
    expect(client.snapshot.states.get(item.wordId)?.reps).toBe(1)
  })

  it('passes a flashcard self-rating through, and only after the reveal', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const item = run.snapshot.item!
    expect(item.mode).toBe('flashcard')
    await run.rate(Grade.Easy)
    expect(run.snapshot.answered).toBe(0)
    run.reveal()
    expect(run.snapshot.phase).toBe('revealed')
    await run.rate(Grade.Easy)
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Easy)
    expect(run.snapshot).toMatchObject({ phase: 'prompt', answered: 1 })
  })

  it('ends a run whose only word left is due in ten minutes, and serves it again after', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await client.updateSettings({ newWordLimit: 1 })
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    const wordId = run.snapshot.item!.wordId
    await playThrough(run, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: 1 })
    env.advance(RELEARN_DELAY_MS)
    const again = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    expect(again.snapshot.item?.wordId).toBe(wordId)
  })

  it('records practice with practice = true and leaves the schedule alone', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    await playThrough(await StudyRun.start(client, env, options()))
    const states = client.snapshot.states
    const run = await StudyRun.start(client, env, options({ kind: 'practice' }))
    expect(run.snapshot.remaining).toBe(PRACTICE_RUN_SIZE)
    await playThrough(run, Grade.Again)
    expect(run.snapshot).toMatchObject({ phase: 'done', answered: PRACTICE_RUN_SIZE })
    expect(client.snapshot.states).toEqual(states)
  })

  it('offers listening only through availableModes: never without audio', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const seen = new Set<Mode>()
    const run = await StudyRun.start(client, env, options({ mode: 'listening_select' }))
    for (let i = 0; i < 5 && run.snapshot.item; i += 1) {
      seen.add(run.snapshot.item.mode)
      run.finish()
    }
    expect(seen.has('listening_select')).toBe(false)
    const online = await StudyRun.start(client, env, options({ mode: 'listening_select', online: () => true }))
    expect(online.snapshot.item?.mode).toBe('listening_select')
  })

  it('stops early on finish, keeping what was answered', async () => {
    const env = testEnv()
    const client = await openSampleClient(env)
    const run = await StudyRun.start(client, env, options({ mode: 'flashcard' }))
    run.reveal()
    await run.rate(Grade.Good)
    run.finish()
    expect(run.snapshot).toMatchObject({ phase: 'done', item: null, answered: 1 })
  })
})
```

`client-data/src/matching.test.ts`:

```ts
import { Grade, MATCHING_PAIRS } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { MatchingRun } from './matching'
import { openSampleClient } from './testing/sample'
import { testEnv } from './testing/testEnv'

async function clientWithWords(count: number) {
  const env = testEnv()
  const client = await openSampleClient(env)
  for (const wordId of client.snapshot.plan!.newWords.slice(0, count)) {
    await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2000, practice: false })
    env.advance(3_000)
  }
  return { env, client }
}

describe('MatchingRun', () => {
  it('needs five introduced words', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS - 1)
    expect(MatchingRun.start(client, env)).toBeNull()
  })

  it('matches pairs from either side, records each as practice, and grades a missed pair Again', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const states = client.snapshot.states
    const run = MatchingRun.start(client, env)!
    const { left, right } = run.snapshot
    expect(left).toHaveLength(MATCHING_PAIRS)
    expect(new Set(right)).toEqual(new Set(left))
    const [a, b] = [left[0]!.entryId, left[1]!.entryId]

    await run.select('left', a)
    await run.select('right', b)
    expect(run.snapshot).toMatchObject({ selected: null, miss: { left: a, right: b } })
    expect(run.snapshot.matched.size).toBe(0)

    await run.select('right', a)
    await run.select('left', a)
    expect(run.snapshot.matched).toEqual(new Set([a]))
    expect(run.snapshot.miss).toBeNull()

    for (const entry of left.slice(1)) {
      await run.select('left', entry.entryId)
      await run.select('right', entry.entryId)
    }
    expect(run.snapshot.done).toBe(true)
    // Practice never touches the schedule (spec §7.4).
    expect(client.snapshot.states).toEqual(states)
    const practiced = client.snapshot.progress
    expect(practiced).not.toBeNull()
  })

  it('ignores a matched word and a second selection on the same side replaces the first', async () => {
    const { env, client } = await clientWithWords(MATCHING_PAIRS)
    const run = MatchingRun.start(client, env)!
    const [a, b] = run.snapshot.left.map((e) => e.entryId)
    await run.select('left', a!)
    await run.select('left', b!)
    expect(run.snapshot.selected).toEqual({ side: 'left', entryId: b })
    await run.select('right', b!)
    await run.select('left', b!)
    expect(run.snapshot.selected).toBeNull()
    expect(run.snapshot.matched).toEqual(new Set([b]))
  })
})
```

Append to `client-data/src/client.test.ts`, after the last `describe` block:

```ts
describe('Client views for the screens', () => {
  it('shows the first unit unlocked and current before any answer', async () => {
    const client = await openClient()
    expect(client.snapshot.path).toEqual({ unlocked: new Set(['a1-01']), currentUnitId: 'a1-01' })
    expect(client.snapshot.packVersion).toBe(0)
  })

  it('lists the clips of the words about to be met, once each', async () => {
    const client = await openClient()
    const clips = client.upcomingClips()
    expect(clips).toHaveLength(10)
    expect(new Set(clips.map((c) => c.clipId)).size).toBe(10)
    expect(clips[0]?.url).toMatch(/^audio\/.+\.m4a$/)
  })

  it('has no path, pack version or clips before a pack is active', async () => {
    const client = await Client.open({ driver: nodeSqliteDriver(), env: testEnv(), l1: 'bg' })
    expect(client.snapshot.path).toBeNull()
    expect(client.snapshot.packVersion).toBeNull()
    expect(client.upcomingClips()).toEqual([])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/client-data test -- run matching client`
Expected: FAIL — `Cannot find module './run'`, `Cannot find module './matching'`, and `client.snapshot.path` undefined.

- [ ] **Step 4: Add the path view and the prefetch list to `study.ts`**

In `client-data/src/study.ts`, extend the import from `@wordado/core` with `computeUnlocks` (already there), `currentUnit`, `dueDay`, `type AudioClip`; then append:

```ts
/** What the path screen draws (spec §7.2): every unit open to the learner, and where new words come from. */
export interface PathView {
  /** The persisted grow-only set plus what the rules unlock now, so the first unit shows before any answer. */
  readonly unlocked: ReadonlySet<string>
  /** Null once every live word on the path has been introduced. */
  readonly currentUnitId: string | null
}

export function pathView(ctx: StudyContext): PathView {
  const path = pathContext(ctx)
  return { unlocked: new Set([...ctx.unlocked, ...computeUnlocks(path)]), currentUnitId: currentUnit(path)?.unitId ?? null }
}

/** Days of upcoming reviews whose audio is fetched ahead (spec §9.3). Tuning (§15). */
export const AUDIO_PREFETCH_DAYS = 3

/**
 * The clips of the words the learner is about to meet (spec §9.3): today's
 * session, and every unflagged word due within the horizon. Each clip once.
 */
export function upcomingClips(ctx: StudyContext, plan: SessionPlan, horizonDays: number = AUDIO_PREFETCH_DAYS): AudioClip[] {
  const day = today(ctx)
  const retention = RETENTION_TARGETS[ctx.settings.retention]
  const words = new Set<WordId>([...plan.reviews, ...plan.newWords])
  for (const [wordId, state] of ctx.learner.states) {
    if (!ctx.flags.has(wordId) && dueDay(state, retention) <= day + horizonDays) words.add(wordId)
  }
  const clips = new Map<string, AudioClip>()
  for (const wordId of words) {
    const entry = entryOf(ctx.corpus, wordId)
    if (entry) for (const clip of entryClips(ctx.corpus, entry)) clips.set(clip.clipId, clip)
  }
  return [...clips.values()]
}
```

- [ ] **Step 5: Add `activePackVersion` to `packs.ts`**

Append to `client-data/src/packs.ts`:

```ts
/** The corpus version of the active packs (the highest, when there are several): what a content report cites (spec §8.10). */
export async function activePackVersion(db: Database): Promise<number | null> {
  const rows = await db.all<{ v: number | null }>("SELECT MAX(corpus_version) AS v FROM pack WHERE status = 'active'")
  return rows[0]?.v ?? null
}
```

- [ ] **Step 6: Extend the client**

In `client-data/src/client.ts`:

1. Add `type AudioClip` to the `@wordado/core` import; add `activePackVersion` to the `./packs` import; add `pathView`, `upcomingClips`, `type PathView` to the `./study` import.
2. Add two fields to `ClientSnapshot`, after `progress`:

```ts
  /** Unlocked units and the current unit; null before a pack is active (spec §7.2). */
  readonly path: PathView | null
  /** The active corpus version, cited by content reports (spec §8.10); null before a pack is active. */
  readonly packVersion: number | null
```

3. Add a private field beside `corpus`:

```ts
  private packVersion: number | null = null
```

4. In `open`, after `client.corpus = await loadActiveCorpus(db)`:

```ts
    client.packVersion = await activePackVersion(db)
```

5. Replace the body of `startSession` with:

```ts
    const activated = await activateStagedPacks(this.db)
    if (activated.length > 0 || !this.corpus) {
      this.corpus = await loadActiveCorpus(this.db)
      this.packVersion = await activePackVersion(this.db)
    }
    this.refresh()
    return activated
```

6. In `buildSnapshot`, add after `progress: …`:

```ts
      path: ctx ? pathView(ctx) : null,
      packVersion: this.packVersion,
```

7. Add a method after `availableModes`:

```ts
  /** Clips worth fetching ahead (spec §9.3); empty before a pack is active. */
  upcomingClips(horizonDays?: number): AudioClip[] {
    const ctx = this.context()
    return ctx ? upcomingClips(ctx, sessionPlan(ctx), horizonDays) : []
  }
```

- [ ] **Step 7: Write the study run**

`client-data/src/run.ts`:

```ts
import { buildItem, gradeAnswer, practiceWords, type Grade, type Mode, type StudyItem, type WordId } from '@wordado/core'
import type { Client } from './client'
import type { ClientEnv } from './env'
import { createStore, type Store } from './store'

/** Words in one practice run (spec §7.4). Tuning (§15). */
export const PRACTICE_RUN_SIZE = 10

/** A run's clock and randomness: the app's `ClientEnv`. */
export type RunEnv = Pick<ClientEnv, 'now' | 'rng'>

/** A scheduled session, or extra practice, which never touches the schedule (spec §7.4). */
export type RunKind = 'session' | 'practice'

export interface RunOptions {
  readonly kind: RunKind
  /** A single-mode run by the learner's choice; null for the mixed default (spec §7.4). */
  readonly mode: Mode | null
  /** Asked per item, so a clip cached mid-run counts (spec §9.3). */
  cachedClips(): ReadonlySet<string>
  online(): boolean
}

/**
 * prompt → (flashcard) revealed → rated → next prompt;
 * prompt → (choice) feedback → next prompt; done when nothing is left.
 */
export type RunPhase = 'prompt' | 'revealed' | 'feedback' | 'done'

export interface RunFeedback {
  readonly correct: boolean
  readonly chosen: number
  readonly grade: Grade
}

export interface RunSnapshot {
  readonly phase: RunPhase
  readonly item: StudyItem | null
  readonly feedback: RunFeedback | null
  readonly answered: number
  /** Items left as of now. A word answered Again comes back after the relearn delay and raises it. */
  readonly remaining: number
  /** True once an answer in this run completed the day (spec §8.4). */
  readonly dayCompleted: boolean
  /** Units this run unlocked, in order (spec §7.2). */
  readonly unlocked: readonly string[]
  /** Why the last answer was not recorded; the item stays so it can be answered again. */
  readonly error: string | null
}

const INITIAL: RunSnapshot = {
  phase: 'done',
  item: null,
  feedback: null,
  answered: 0,
  remaining: 0,
  dayCompleted: false,
  unlocked: [],
  error: null,
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * One study run over a `Client` (spec §7.4, §8.1). A session reads its next
 * word from the live plan after every answer — reviews first, then new words —
 * so a word answered Again returns once it is due again, and the run ends when
 * nothing is due now. A practice run draws PRACTICE_RUN_SIZE introduced words
 * that today's session does not serve, and records them as practice.
 */
export class StudyRun {
  readonly store: Store<RunSnapshot> = createStore(INITIAL)
  private shownAt = 0
  private presentedAt: number | null = null
  private busy = false
  private readonly skipped = new Set<WordId>()
  private practiceQueue: WordId[] = []

  private constructor(
    private readonly client: Client,
    private readonly env: RunEnv,
    private readonly options: RunOptions,
  ) {}

  /** Starts a run: swaps in any staged pack first (spec §5.1), then shows the first item. */
  static async start(client: Client, env: RunEnv, options: RunOptions): Promise<StudyRun> {
    await client.startSession()
    const run = new StudyRun(client, env, options)
    if (options.kind === 'practice') {
      const { states, flags, plan } = client.snapshot
      const exclude = new Set<WordId>([...(plan?.reviews ?? []), ...(plan?.newWords ?? [])])
      run.practiceQueue = practiceWords({ states, flags, exclude, count: PRACTICE_RUN_SIZE, rng: env.rng })
    }
    run.advance()
    return run
  }

  get snapshot(): RunSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<RunSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  private queue(): WordId[] {
    if (this.options.kind === 'practice') return this.practiceQueue.filter((w) => !this.skipped.has(w))
    const plan = this.client.snapshot.plan
    return plan ? [...plan.reviews, ...plan.newWords].filter((w) => !this.skipped.has(w)) : []
  }

  private itemFor(wordId: WordId): StudyItem | null {
    const { corpus, states } = this.client.snapshot
    if (!corpus) return null
    const available = this.client.availableModes(wordId, this.options.cachedClips(), this.options.online())
    return buildItem(wordId, { corpus, states, available, preferred: this.options.mode, rng: this.env.rng })
  }

  private advance(): void {
    for (;;) {
      const queue = this.queue()
      const wordId = queue[0]
      if (wordId === undefined) {
        this.set({ phase: 'done', item: null, feedback: null, remaining: 0 })
        return
      }
      const item = this.itemFor(wordId)
      if (item === null) {
        // Not in the corpus (a Phase 2 user word): skip it rather than stall.
        this.skipped.add(wordId)
        continue
      }
      this.shownAt = this.env.now()
      this.presentedAt = null
      this.set({ phase: 'prompt', item, feedback: null, remaining: queue.length })
      return
    }
  }

  /** The prompt is fully presented (for listening, the audio has ended): latency counts from here (spec §7.3). */
  presented(): void {
    if (this.presentedAt === null) this.presentedAt = this.env.now()
  }

  private latency(): number {
    return Math.max(0, this.env.now() - (this.presentedAt ?? this.shownAt))
  }

  /** Shows a flashcard's answer. */
  reveal(): void {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || item?.mode !== 'flashcard') return
    this.presented()
    this.set({ phase: 'revealed' })
  }

  /** A flashcard's self-rating, passed through (spec §7.3). Moves straight on. */
  async rate(rating: Grade): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'revealed' || item?.mode !== 'flashcard') return
    const grade = gradeAnswer('flashcard', { kind: 'self_rated', rating }, { latencyGrading: true })
    if (await this.record(item, grade)) this.advance()
  }

  /** Picks an option of a choice item; binary grading with latency (spec §7.3). Shows feedback. */
  async choose(index: number): Promise<void> {
    const { phase, item } = this.snapshot
    if (phase !== 'prompt' || !item || item.mode === 'flashcard') return
    if (!Number.isInteger(index) || index < 0 || index >= item.options.length) return
    const correct = index === item.answerIndex
    const grade = gradeAnswer(item.mode, { kind: 'binary', correct, latencyMs: this.latency() }, { latencyGrading: true })
    if (await this.record(item, grade)) this.set({ phase: 'feedback', feedback: { correct, chosen: index, grade } })
  }

  /** Leaves the feedback for the next item. */
  next(): void {
    if (this.snapshot.phase === 'feedback') this.advance()
  }

  /** Ends the run now; every answer given so far is already recorded. */
  finish(): void {
    this.set({ phase: 'done', item: null, feedback: null, remaining: 0 })
  }

  /** One answer at a time: a second press while the first is being written is ignored. */
  private async record(item: StudyItem, grade: Grade): Promise<boolean> {
    if (this.busy) return false
    this.busy = true
    try {
      const practice = this.options.kind === 'practice'
      const result = await this.client.answer({
        wordId: item.wordId,
        mode: item.mode,
        direction: item.direction,
        grade,
        latencyMs: this.latency(),
        practice,
      })
      if (practice) this.practiceQueue = this.practiceQueue.filter((w) => w !== item.wordId)
      const s = this.snapshot
      this.set({
        answered: s.answered + 1,
        // The answered word has left the queue unless it is due again already.
        remaining: this.queue().length,
        dayCompleted: s.dayCompleted || result.dayCompleted,
        unlocked: [...s.unlocked, ...result.unlocked],
        error: null,
      })
      return true
    } catch (err) {
      this.set({ error: messageOf(err) })
      return false
    } finally {
      this.busy = false
    }
  }
}
```

- [ ] **Step 8: Write the matching board**

`client-data/src/matching.ts`:

```ts
import { buildMatchingBoard, corpusWordId, gradeAnswer, matchingCandidates, MATCHING_PAIRS, shuffle, type CorpusEntry } from '@wordado/core'
import type { Client } from './client'
import { createStore, type Store } from './store'
import type { RunEnv } from './run'

export type MatchingSide = 'left' | 'right'

export interface MatchingSnapshot {
  /** English headwords, in board order. */
  readonly left: readonly CorpusEntry[]
  /** The same entries, shuffled; shown by primary translation. */
  readonly right: readonly CorpusEntry[]
  /** Entry IDs matched so far. */
  readonly matched: ReadonlySet<string>
  readonly selected: { readonly side: MatchingSide; readonly entryId: string } | null
  /** The last pair that did not match, until the next selection. */
  readonly miss: { readonly left: string; readonly right: string } | null
  readonly done: boolean
  readonly error: string | null
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * One matching board (spec §8.1): a game, not a measurement, so every pair is
 * recorded with `practice = true` and never touches the schedule. A pair is
 * graded Again when either of its words was part of a wrong pairing first.
 */
export class MatchingRun {
  readonly store: Store<MatchingSnapshot>
  private readonly missed = new Set<string>()
  private lastAt: number
  private busy = false

  private constructor(
    private readonly client: Client,
    private readonly env: RunEnv,
    board: readonly CorpusEntry[],
  ) {
    this.lastAt = env.now()
    this.store = createStore<MatchingSnapshot>({
      left: board,
      right: shuffle(board, env.rng),
      matched: new Set(),
      selected: null,
      miss: null,
      done: false,
      error: null,
    })
  }

  /** A board of MATCHING_PAIRS introduced words, or null until the learner has that many. */
  static start(client: Client, env: RunEnv): MatchingRun | null {
    const { corpus, states, flags } = client.snapshot
    if (!corpus) return null
    const board = buildMatchingBoard(matchingCandidates(corpus, states, flags), MATCHING_PAIRS, env.rng)
    return board ? new MatchingRun(client, env, board) : null
  }

  get snapshot(): MatchingSnapshot {
    return this.store.get()
  }

  private set(patch: Partial<MatchingSnapshot>): void {
    this.store.set({ ...this.store.get(), ...patch })
  }

  /** Selects a word on one side; a selection on the other side completes a pairing. */
  async select(side: MatchingSide, entryId: string): Promise<void> {
    const s = this.snapshot
    if (s.done || this.busy || s.matched.has(entryId)) return
    if (!s.left.some((e) => e.entryId === entryId)) return
    if (s.selected === null || s.selected.side === side) {
      this.set({ selected: { side, entryId }, miss: null })
      return
    }
    const left = side === 'left' ? entryId : s.selected.entryId
    const right = side === 'right' ? entryId : s.selected.entryId
    if (left !== right) {
      this.missed.add(left)
      this.missed.add(right)
      this.set({ selected: null, miss: { left, right } })
      return
    }
    this.busy = true
    try {
      const now = this.env.now()
      const latencyMs = Math.max(0, now - this.lastAt)
      const grade = gradeAnswer('matching', { kind: 'binary', correct: !this.missed.has(left), latencyMs }, { latencyGrading: false })
      await this.client.answer({ wordId: corpusWordId(left), mode: 'matching', direction: 'en_to_l1', grade, latencyMs, practice: true })
      this.lastAt = now
      const matched = new Set([...this.snapshot.matched, left])
      this.set({ matched, selected: null, miss: null, done: matched.size === this.snapshot.left.length, error: null })
    } catch (err) {
      this.set({ selected: null, error: messageOf(err) })
    } finally {
      this.busy = false
    }
  }
}
```

- [ ] **Step 9: Export the new modules**

In `client-data/src/index.ts`, after `export * from './client'`:

```ts
export * from './run'
export * from './matching'
```

`testing/sample.ts` is not exported, like `testing/testEnv.ts`; suites import it by path.

- [ ] **Step 10: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/client-data test -- run matching client`
Expected: PASS — 9 in `run.test.ts`, 3 in `matching.test.ts`, 3 new in `client.test.ts`.

- [ ] **Step 11: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green. The server suite imports `client-data`; nothing it uses changed shape.

- [ ] **Step 12: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): study and matching runs, the path view, pack version and upcoming clips"
```

---
### Task 3: The `web` package: toolchain, the browser environment, the interface language, the router

The package and everything later tasks build on: Vite with React, the two Vitest projects (happy-dom for views, Chromium for storage), the `ClientEnv` of the browser (plan 4 contract), the Bulgarian and English message tables with a compile-time guarantee that neither lacks a key, and a small router over `history`.

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/vitest.config.ts`, `web/index.html`, `web/public/icon.svg`, `web/src/main.tsx`
- Create: `web/src/env.ts`, `web/src/useStore.ts`, `web/src/router.tsx`, `web/src/i18n/en.ts`, `web/src/i18n/bg.ts`, `web/src/i18n/i18n.tsx`
- Test: `web/src/env.test.ts`, `web/src/router.test.tsx`, `web/src/i18n/i18n.test.tsx`
- Modify: `pnpm-workspace.yaml`

**Interfaces:**
- Consumes: `ClientEnv` from `client-data`; `Mode`, `LocalizedText` from `core`; `Store` from `client-data`.
- Produces, from `env.ts`: `webEnv(): ClientEnv`; `toHex(buffer: ArrayBuffer): string`.
- Produces, from `useStore.ts`: `useStore<T>(store: Store<T>): T`.
- Produces, from `router.tsx`: `type Route = { name: 'home' } | { name: 'study'; mode: Mode | null } | { name: 'practice' } | { name: 'practice-words'; mode: Mode | null } | { name: 'matching' } | { name: 'path' } | { name: 'themes' } | { name: 'progress' }`; `parseRoute(pathname: string, search: string): Route`; `routeHref(route: Route): string`; `navigate(route: Route, options?: { replace?: boolean }): void`; `useRoute(): Route`; `Link` (props `to: Route`, `className?`, `children`, `aria-current?`).
- Produces, from `i18n/`: `type Locale = 'bg' | 'en'`; `LOCALES`; `type MessageKey`; `type Vars`; `translate(locale, key, vars?): string`; `I18nProvider` (props `storage?: Pick<Storage, 'getItem' | 'setItem'> | null`, `children`); `useT(): { t(key, vars?): string; locale: Locale; setLocale(locale: Locale): void }`; `localized(text: LocalizedText, locale: Locale): string`; `LOCALE_KEY = 'wordado.locale'`. Every later task's strings come from these tables.

- [ ] **Step 1: Add the package to the workspace**

`pnpm-workspace.yaml` — add `web` to `packages`:

```yaml
packages:
  - core
  - pipeline
  - client-data
  - server
  - web
```

`web/package.json`:

```json
{
  "name": "@wordado/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview --port 4173 --strictPort",
    "test": "vitest run",
    "e2e": "playwright test",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@fontsource-variable/golos-text": "^5.3.0",
    "@fontsource-variable/literata": "^5.3.0",
    "@journeyapps/wa-sqlite": "2.0.6",
    "@wordado/client-data": "workspace:*",
    "@wordado/core": "workspace:*",
    "react": "^19.3.0",
    "react-dom": "^19.3.0",
    "workbox-precaching": "^7.4.1",
    "workbox-routing": "^7.4.1"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.13.0",
    "@playwright/test": "^1.63.0",
    "@testing-library/dom": "^10.4.0",
    "@testing-library/react": "^16.3.3",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^6.1.1",
    "@vitest/browser-playwright": "^5.0.1",
    "happy-dom": "^20.14.5",
    "playwright": "^1.63.0",
    "vite": "^8.3.0",
    "vite-plugin-pwa": "^1.3.0",
    "workbox-build": "^7.4.1",
    "workbox-window": "^7.4.1"
  }
}
```

`@journeyapps/wa-sqlite` is pinned exactly: it is a fork, and the Worker (Task 4) reaches into its `src/examples/` files, which are not a stable API.

`web/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vite/client"],
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "jsx": "react-jsx"
  },
  "include": ["src", "vite", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`WebWorker` sits beside `DOM` for the SQLite Worker and the service worker; the base config's `skipLibCheck` absorbs the two libraries' overlapping globals, and the worker files cast `self` to their own scope type rather than redeclaring it.

`web/vite.config.ts`:

```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/** The Worker of plan 5, which 6b's transport calls through this proxy: one origin, no CORS. */
const API = 'http://localhost:8787'

export default defineConfig({
  plugins: [react()],
  // wa-sqlite locates its .wasm next to its own module; pre-bundling would move the module away from it.
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true, proxy: { '/api': API, '/v1': API } },
})
```

`web/vitest.config.ts`:

```ts
import { playwright } from '@vitest/browser-playwright'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  optimizeDeps: { exclude: ['@journeyapps/wa-sqlite'] },
  worker: { format: 'es' },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}', 'vite/**/*.test.ts'],
          exclude: ['src/**/*.browser.test.ts'],
          environment: 'happy-dom',
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include: ['src/**/*.browser.test.ts'],
          browser: { enabled: true, headless: true, provider: playwright(), instances: [{ browser: 'chromium' }] },
        },
      },
    ],
  },
})
```

`web/index.html`:

```html
<!doctype html>
<html lang="bg">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="Learn English words, a few minutes a day, online or off." />
    <meta name="theme-color" content="#f6f7fb" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#141c33" media="(prefers-color-scheme: dark)" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <title>Wordado</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`web/public/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#1d2b53"/>
  <path d="M13 21l8 25 11-19 11 19 8-25" fill="none" stroke="#f6f7fb" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="53" cy="11" r="4" fill="#e0567f"/>
</svg>
```

A placeholder entry, which Task 7 replaces with the real one.

`web/src/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'

createRoot(document.getElementById('root')!).render(<p>Wordado</p>)
```

Run: `pnpm install && pnpm --filter @wordado/web exec playwright install chromium`
Expected: the lockfile gains the web dependencies; Chromium downloads once. If pnpm lists ignored build scripts for a new dependency, add it to `allowBuilds` in `pnpm-workspace.yaml` with `false` — none of these packages needs one to run.

- [ ] **Step 2: Write the failing tests**

`web/src/env.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toHex, webEnv } from './env'

afterEach(() => vi.restoreAllMocks())

describe('webEnv', () => {
  it('reports the offset to ADD to UTC: the negation of getTimezoneOffset (plan 4 contract)', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-120)
    expect(webEnv().tzOffsetMin()).toBe(120)
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(300)
    expect(webEnv().tzOffsetMin()).toBe(-300)
  })

  it('reports UTC as 0, never -0', () => {
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(0)
    expect(Object.is(webEnv().tzOffsetMin(), 0)).toBe(true)
  })

  it('makes v4 UUIDs and floats in [0, 1)', () => {
    const env = webEnv()
    expect(env.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    for (let i = 0; i < 100; i += 1) {
      const r = env.rng()
      expect(r).toBeGreaterThanOrEqual(0)
      expect(r).toBeLessThan(1)
    }
  })

  it('hashes with SHA-256 as lowercase hex', async () => {
    expect(await webEnv().sha256(new TextEncoder().encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(toHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff')
  })
})
```

`web/src/i18n/i18n.test.tsx`:

```tsx
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { bg } from './bg'
import { en } from './en'
import { I18nProvider, LOCALE_KEY, localized, translate, useT, type MessageKey } from './i18n'

afterEach(cleanup)

const placeholders = (message: string | { one: string; other: string }): string[] => {
  const text = typeof message === 'string' ? message : `${message.one} ${message.other}`
  return [...new Set(text.match(/\{\w+\}/g) ?? [])].sort()
}

describe('the message tables', () => {
  it('have the same keys, the same shape and the same placeholders in both languages', () => {
    expect(Object.keys(bg).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as MessageKey[]) {
      expect(typeof bg[key], key).toBe(typeof en[key])
      expect(placeholders(bg[key]), key).toEqual(placeholders(en[key]))
    }
  })
})

describe('translate', () => {
  it('fills placeholders and picks the plural form by count', () => {
    expect(translate('en', 'home.newWords', { count: 1 })).toBe('1 new word')
    expect(translate('en', 'home.newWords', { count: 5 })).toBe('5 new words')
    expect(translate('bg', 'home.newWords', { count: 1 })).toBe('1 нова дума')
    expect(translate('bg', 'home.newWords', { count: 5 })).toBe('5 нови думи')
    expect(translate('en', 'home.xp', { today: 30, total: 120 })).toBe('30 XP today, 120 in all')
  })

  it('leaves a placeholder it was not given visible, rather than printing undefined', () => {
    expect(translate('en', 'home.xp', { today: 30 })).toBe('30 XP today, {total} in all')
  })

  it('reads pack text in the interface language', () => {
    expect(localized({ en: 'Food', l1: 'Храна' }, 'en')).toBe('Food')
    expect(localized({ en: 'Food', l1: 'Храна' }, 'bg')).toBe('Храна')
  })
})

function Probe() {
  const { t, locale, setLocale } = useT()
  return (
    <button type="button" onClick={() => setLocale(locale === 'bg' ? 'en' : 'bg')}>
      {t('nav.home')}
    </button>
  )
}

describe('I18nProvider', () => {
  it('starts in Bulgarian, switches, remembers the choice and sets the document language', () => {
    const saved = new Map<string, string>()
    const storage = { getItem: (k: string) => saved.get(k) ?? null, setItem: (k: string, v: string) => void saved.set(k, v) }
    render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Днес')
    expect(document.documentElement.lang).toBe('bg')
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Today')
    expect(document.documentElement.lang).toBe('en')
    expect(saved.get(LOCALE_KEY)).toBe('en')
  })

  it('starts in the remembered language, and ignores a value it does not know', () => {
    const { unmount } = render(
      <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Today')
    unmount()
    render(
      <I18nProvider storage={{ getItem: () => 'xx', setItem: () => undefined }}>
        <Probe />
      </I18nProvider>,
    )
    expect(screen.getByRole('button').textContent).toBe('Днес')
  })

  it('works when storage throws (a private window)', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('denied')
      },
    }
    render(
      <I18nProvider storage={storage}>
        <Probe />
      </I18nProvider>,
    )
    act(() => screen.getByRole('button').click())
    expect(screen.getByRole('button').textContent).toBe('Today')
  })
})
```

`web/src/router.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Link, navigate, parseRoute, routeHref, useRoute, type Route } from './router'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

const ROUTES: Route[] = [
  { name: 'home' },
  { name: 'study', mode: null },
  { name: 'study', mode: 'flashcard' },
  { name: 'study', mode: 'listening_select' },
  { name: 'practice' },
  { name: 'practice-words', mode: null },
  { name: 'practice-words', mode: 'multiple_choice' },
  { name: 'matching' },
  { name: 'path' },
  { name: 'themes' },
  { name: 'progress' },
]

describe('routes', () => {
  it('round-trip through their URLs', () => {
    for (const route of ROUTES) {
      const url = new URL(routeHref(route), 'http://localhost')
      expect(parseRoute(url.pathname, url.search)).toEqual(route)
    }
  })

  it('send an unknown path home and ignore an unknown mode', () => {
    expect(parseRoute('/nowhere', '')).toEqual({ name: 'home' })
    expect(parseRoute('/study', '?mode=matching')).toEqual({ name: 'study', mode: null })
    expect(parseRoute('/study/', '')).toEqual({ name: 'study', mode: null })
  })
})

function Where() {
  const route = useRoute()
  return (
    <>
      <output>{route.name}</output>
      <Link to={{ name: 'path' }}>path</Link>
    </>
  )
}

describe('navigation', () => {
  it('updates the route on navigate and on a link click', () => {
    render(<Where />)
    expect(screen.getByRole('status').textContent).toBe('home')
    act(() => navigate({ name: 'themes' }))
    expect(screen.getByRole('status').textContent).toBe('themes')
    expect(window.location.pathname).toBe('/themes')
    fireEvent.click(screen.getByRole('link', { name: 'path' }))
    expect(screen.getByRole('status').textContent).toBe('path')
    expect(window.location.pathname).toBe('/path')
  })

  it('leaves a modified click to the browser', () => {
    render(<Where />)
    fireEvent.click(screen.getByRole('link', { name: 'path' }), { ctrlKey: true })
    expect(screen.getByRole('status').textContent).toBe('home')
  })

  it('replaces the entry when asked', () => {
    const before = window.history.length
    act(() => navigate({ name: 'progress' }, { replace: true }))
    expect(window.history.length).toBe(before)
    expect(window.location.pathname).toBe('/progress')
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test`
Expected: FAIL — `Cannot find module './env'`, `'./router'`, `'./bg'`.

- [ ] **Step 4: Write the browser environment and the store hook**

`web/src/env.ts`:

```ts
import type { ClientEnv } from '@wordado/client-data'

export function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The browser's ClientEnv (plan 4 contract). */
export function webEnv(): ClientEnv {
  const word = new Uint32Array(1)
  return {
    now: () => Date.now(),
    // `0 -` rather than unary minus, so UTC is 0 and not -0.
    tzOffsetMin: () => 0 - new Date().getTimezoneOffset(),
    uuid: () => crypto.randomUUID(),
    rng: () => {
      crypto.getRandomValues(word)
      return word[0]! / 4_294_967_296
    },
    // A copy, so the digest sees an ArrayBuffer-backed view whatever the caller passed.
    sha256: async (bytes) => toHex(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))),
  }
}
```

`web/src/useStore.ts`:

```ts
import type { Store } from '@wordado/client-data'
import { useSyncExternalStore } from 'react'

/** Subscribes a component to one of client-data's stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
```

- [ ] **Step 5: Write the router**

`web/src/router.tsx`:

```tsx
import type { Mode } from '@wordado/core'
import { useMemo, useSyncExternalStore, type MouseEvent, type ReactNode } from 'react'

export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'study'; readonly mode: Mode | null }
  | { readonly name: 'practice' }
  | { readonly name: 'practice-words'; readonly mode: Mode | null }
  | { readonly name: 'matching' }
  | { readonly name: 'path' }
  | { readonly name: 'themes' }
  | { readonly name: 'progress' }

/** Modes a learner can choose for a run; matching has its own route. */
const RUN_MODES: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select']

function modeParam(search: string): Mode | null {
  const mode = new URLSearchParams(search).get('mode')
  return RUN_MODES.find((m) => m === mode) ?? null
}

export function parseRoute(pathname: string, search: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  switch (path) {
    case '/study':
      return { name: 'study', mode: modeParam(search) }
    case '/practice':
      return { name: 'practice' }
    case '/practice/words':
      return { name: 'practice-words', mode: modeParam(search) }
    case '/practice/matching':
      return { name: 'matching' }
    case '/path':
      return { name: 'path' }
    case '/themes':
      return { name: 'themes' }
    case '/progress':
      return { name: 'progress' }
    default:
      return { name: 'home' }
  }
}

const withMode = (path: string, mode: Mode | null) => (mode === null ? path : `${path}?mode=${mode}`)

export function routeHref(route: Route): string {
  switch (route.name) {
    case 'home':
      return '/'
    case 'study':
      return withMode('/study', route.mode)
    case 'practice':
      return '/practice'
    case 'practice-words':
      return withMode('/practice/words', route.mode)
    case 'matching':
      return '/practice/matching'
    default:
      return `/${route.name}`
  }
}

const NAVIGATE = 'wordado:navigate'

export function navigate(route: Route, options: { readonly replace?: boolean } = {}): void {
  const href = routeHref(route)
  if (options.replace) window.history.replaceState(null, '', href)
  else window.history.pushState(null, '', href)
  window.dispatchEvent(new Event(NAVIGATE))
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('popstate', listener)
  window.addEventListener(NAVIGATE, listener)
  return () => {
    window.removeEventListener('popstate', listener)
    window.removeEventListener(NAVIGATE, listener)
  }
}

const location = () => `${window.location.pathname}${window.location.search}`

export function useRoute(): Route {
  const current = useSyncExternalStore(subscribe, location, location)
  return useMemo(() => {
    const url = new URL(current, 'http://local')
    return parseRoute(url.pathname, url.search)
  }, [current])
}

export interface LinkProps {
  readonly to: Route
  readonly className?: string
  readonly children?: ReactNode
  readonly 'aria-current'?: 'page'
}

/** An ordinary link that navigates in place; a modified click opens a tab as usual. */
export function Link(props: LinkProps) {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(props.to)
  }
  return (
    <a href={routeHref(props.to)} className={props.className} aria-current={props['aria-current']} onClick={onClick}>
      {props.children}
    </a>
  )
}
```

- [ ] **Step 6: Write the message tables and the provider**

The Bulgarian table addresses the learner formally (Вие) throughout. It has not been reviewed by a native speaker; plan 8's review pass covers it with the pack.

`web/src/i18n/en.ts`:

```ts
export interface Plural {
  readonly one: string
  readonly other: string
}

export type Message = string | Plural

/** The interface in English (spec §11.2). Keys are grouped by screen. `{name}` is a placeholder. */
export const en = {
  'app.name': 'Wordado',
  'nav.label': 'Main',
  'nav.skip': 'Skip to content',
  'nav.home': 'Today',
  'nav.path': 'Path',
  'nav.themes': 'Themes',
  'nav.progress': 'Progress',
  'lang.label': 'Interface language',

  'boot.starting': 'Opening your words…',
  'boot.failed': 'The words could not be loaded. Check your connection and try again.',
  'boot.retry': 'Try again',
  'tab.elsewhere': 'Wordado is open in another tab.',
  'tab.elsewhereHint': 'Only one tab can hold your progress at a time.',
  'tab.takeOver': 'Use Wordado here',
  'banner.demo': 'You are trying Wordado. Your progress stays on this device.',
  'banner.memory': 'This browser can’t keep your progress. Everything you study here is lost when you close the tab.',

  'home.reviews': { one: '{count} word to review', other: '{count} words to review' },
  'home.newWords': { one: '{count} new word', other: '{count} new words' },
  'home.allDone': 'Nothing left for today.',
  'home.allDoneHint': 'Come back tomorrow, or practise words you already know.',
  'home.backlog': { one: '{count} due in all. The rest wait for another day.', other: '{count} due in all. The rest wait for another day.' },
  'home.paused': 'New words wait until your reviews are under today’s limit.',
  'home.start': 'Start studying',
  'home.oneWay': 'Study one way',
  'home.practice': 'Practise words you know',
  'home.streak': { one: '{count}-day streak', other: '{count}-day streak' },
  'home.noStreak': 'Study today to start a streak.',
  'home.todayComplete': 'Today counts.',
  'home.freezes': { one: '{count} streak freeze left this month', other: '{count} streak freezes left this month' },
  'home.xp': '{today} XP today, {total} in all',
  'home.xpProvisional': 'XP is confirmed when your progress syncs.',

  'mode.flashcard': 'Flashcards',
  'mode.multiple_choice': 'Multiple choice',
  'mode.listening_select': 'Listening',
  'mode.matching': 'Matching',

  'study.loading': 'Getting your words ready…',
  'study.progress': '{answered} done, {remaining} to go',
  'study.finish': 'Stop for now',
  'study.reveal': 'Show answer',
  'study.rateLabel': 'How well did you know it?',
  'grade.1': 'Again',
  'grade.2': 'Hard',
  'grade.3': 'Good',
  'grade.4': 'Easy',
  'study.chooseTranslation': 'Choose the translation',
  'study.chooseWord': 'Choose the English word',
  'study.listenPrompt': 'Which word did you hear?',
  'study.play': 'Play the word',
  'study.playAgain': 'Play again',
  'study.audioFailed': 'The audio didn’t play. You can still answer.',
  'study.correct': 'Correct',
  'study.incorrect': 'Not quite. The answer is {answer}.',
  'study.slow': 'Correct, but slow, so it counts as hard.',
  'study.continue': 'Continue',
  'study.keysHint': 'Keys: 1 to 4 answer, Space continues.',
  'study.error': 'Your answer wasn’t saved: {message}',
  'done.session': 'Session complete',
  'done.practice': 'Practice complete',
  'done.answered': { one: 'You answered {count} word.', other: 'You answered {count} words.' },
  'done.dayComplete': 'Today counts toward your streak.',
  'done.unlocked': 'New unit open: {title}',
  'done.practiceMore': 'Practise more',
  'done.home': 'Back to today',
  'done.nothing': 'Nothing to study right now.',

  'practice.title': 'Practice',
  'practice.intro': 'Practice doesn’t change when words come back for review.',
  'practice.matching': 'Match words with their translations',
  'practice.needWords': 'Learn a few words first: matching needs five.',
  'practice.noneYet': 'Nothing to practise yet. Study a few new words first.',
  'matching.title': 'Matching',
  'matching.instructions': 'Pick an English word, then its translation.',
  'matching.english': 'English',
  'matching.translation': 'Bulgarian',
  'matching.miss': '{left} and {right} aren’t a pair.',
  'matching.matched': 'Matched',
  'matching.done': 'All pairs matched.',
  'matching.again': 'Play again',

  'path.title': 'Your path',
  'path.skipped': 'Skipped: you placed above this level.',
  'path.levelProgress': '{mature} of {live} words learned well',
  'path.locked': 'Locked',
  'path.current': 'Current',
  'path.introduced': '{introduced} of {live} started',
  'path.complete': 'Complete',
  'path.mastered': 'Mastered',

  'themes.title': 'Themes',
  'themes.intro': 'Pick a theme and its words come first. Your reviews stay the same.',
  'themes.count': { one: '{count} word', other: '{count} words' },
  'themes.aboveLevel': 'Includes words above your level',
  'themes.choose': 'Study this theme',
  'themes.active': 'Studying now',
  'themes.clear': 'Back to the path',
  'themes.none': 'No themes are big enough yet.',

  'progress.title': 'Progress',
  'progress.tiers': 'Your words',
  'tier.new': 'New',
  'tier.learning': 'Learning',
  'tier.young': 'Young',
  'tier.mature': 'Mature',
  'progress.levels': 'Levels',
  'progress.retention': 'Remembered on the first try',
  'progress.retentionValue': '{percent}% over the last 30 days',
  'progress.retentionNone': 'Not enough reviews yet.',
  'progress.retentionHint': 'This is the honest measure: reviews of words you last saw on an earlier day.',
  'progress.motivation': 'Streak and XP',

  'report.open': 'Report a problem',
  'report.title': 'Report a problem with “{word}”',
  'report.field': 'What is wrong?',
  'report.translation': 'Wrong or odd translation',
  'report.example': 'Bad example sentence',
  'report.audio': 'Bad audio',
  'report.level': 'Wrong level',
  'report.other': 'Something else',
  'report.note': 'Details (optional)',
  'report.send': 'Send report',
  'report.cancel': 'Cancel',
  'report.sent': 'Report saved. Thank you.',

  'pos.noun': 'noun',
  'pos.verb': 'verb',
  'pos.adj': 'adjective',
  'pos.adv': 'adverb',
  'pos.pron': 'pronoun',
  'pos.prep': 'preposition',
  'pos.det': 'determiner',
  'pos.num': 'number',
  'pos.conj': 'conjunction',
  'pos.intj': 'interjection',
  'pos.phrase': 'phrase',
} satisfies Record<string, Message>

export type MessageKey = keyof typeof en

/** Every table has every key, with a plural wherever English has one. */
export type Messages = { readonly [K in MessageKey]: (typeof en)[K] extends string ? string : Plural }
```

`web/src/i18n/bg.ts`:

```ts
import type { Messages } from './en'

/** The interface in Bulgarian (spec §11.2). Formal address. Awaiting a native speaker's review (plan 8). */
export const bg: Messages = {
  'app.name': 'Wordado',
  'nav.label': 'Основна навигация',
  'nav.skip': 'Към съдържанието',
  'nav.home': 'Днес',
  'nav.path': 'Път',
  'nav.themes': 'Теми',
  'nav.progress': 'Напредък',
  'lang.label': 'Език на интерфейса',

  'boot.starting': 'Отваряме думите ви…',
  'boot.failed': 'Думите не можаха да се заредят. Проверете връзката си и опитайте отново.',
  'boot.retry': 'Опитайте отново',
  'tab.elsewhere': 'Wordado е отворено в друг раздел.',
  'tab.elsewhereHint': 'Само един раздел може да пази напредъка ви в даден момент.',
  'tab.takeOver': 'Използвайте Wordado тук',
  'banner.demo': 'Пробвате Wordado. Напредъкът ви остава на това устройство.',
  'banner.memory': 'Този браузър не може да запази напредъка ви. Всичко, което учите тук, се губи, когато затворите раздела.',

  'home.reviews': { one: '{count} дума за преговор', other: '{count} думи за преговор' },
  'home.newWords': { one: '{count} нова дума', other: '{count} нови думи' },
  'home.allDone': 'За днес няма нищо повече.',
  'home.allDoneHint': 'Върнете се утре или упражнете думи, които вече знаете.',
  'home.backlog': { one: 'Общо {count} е за преговор. Останалите изчакват друг ден.', other: 'Общо {count} са за преговор. Останалите изчакват друг ден.' },
  'home.paused': 'Новите думи изчакват, докато прегледите ви слязат под дневния лимит.',
  'home.start': 'Започнете',
  'home.oneWay': 'Учете по един начин',
  'home.practice': 'Упражнете думи, които знаете',
  'home.streak': { one: '{count} ден поред', other: '{count} дни поред' },
  'home.noStreak': 'Учете днес, за да започнете серия.',
  'home.todayComplete': 'Днешният ден се брои.',
  'home.freezes': { one: 'Остава ви {count} замразяване на серията този месец', other: 'Остават ви {count} замразявания на серията този месец' },
  'home.xp': '{today} XP днес, {total} общо',
  'home.xpProvisional': 'XP се потвърждава, когато напредъкът ви се синхронизира.',

  'mode.flashcard': 'Карти',
  'mode.multiple_choice': 'Избор на отговор',
  'mode.listening_select': 'Слушане',
  'mode.matching': 'Свързване',

  'study.loading': 'Подготвяме думите ви…',
  'study.progress': '{answered} готови, остават {remaining}',
  'study.finish': 'Спрете засега',
  'study.reveal': 'Покажете отговора',
  'study.rateLabel': 'Колко добре я знаехте?',
  'grade.1': 'Отново',
  'grade.2': 'Трудно',
  'grade.3': 'Добре',
  'grade.4': 'Лесно',
  'study.chooseTranslation': 'Изберете превода',
  'study.chooseWord': 'Изберете английската дума',
  'study.listenPrompt': 'Коя дума чухте?',
  'study.play': 'Пуснете думата',
  'study.playAgain': 'Пуснете отново',
  'study.audioFailed': 'Аудиото не се възпроизведе. Можете да отговорите и така.',
  'study.correct': 'Вярно',
  'study.incorrect': 'Не съвсем. Отговорът е {answer}.',
  'study.slow': 'Вярно, но бавно, затова се брои като трудно.',
  'study.continue': 'Продължете',
  'study.keysHint': 'Клавиши: от 1 до 4 за отговор, интервал за продължаване.',
  'study.error': 'Отговорът ви не беше запазен: {message}',
  'done.session': 'Сесията приключи',
  'done.practice': 'Упражнението приключи',
  'done.answered': { one: 'Отговорихте на {count} дума.', other: 'Отговорихте на {count} думи.' },
  'done.dayComplete': 'Днешният ден се брои към серията ви.',
  'done.unlocked': 'Нов урок: {title}',
  'done.practiceMore': 'Упражнете още',
  'done.home': 'Обратно към днес',
  'done.nothing': 'В момента няма какво да учите.',

  'practice.title': 'Упражнения',
  'practice.intro': 'Упражненията не променят кога думите се връщат за преговор.',
  'practice.matching': 'Свържете думите с преводите им',
  'practice.needWords': 'Първо научете няколко думи: за свързването трябват пет.',
  'practice.noneYet': 'Все още няма какво да упражнявате. Първо научете няколко нови думи.',
  'matching.title': 'Свързване',
  'matching.instructions': 'Изберете английска дума, после превода ѝ.',
  'matching.english': 'Английски',
  'matching.translation': 'Български',
  'matching.miss': '{left} и {right} не са двойка.',
  'matching.matched': 'Свързано',
  'matching.done': 'Всички двойки са свързани.',
  'matching.again': 'Играйте отново',

  'path.title': 'Вашият път',
  'path.skipped': 'Пропуснато: вие сте над това ниво.',
  'path.levelProgress': '{mature} от {live} думи са добре научени',
  'path.locked': 'Заключен',
  'path.current': 'Текущ',
  'path.introduced': 'Започнати {introduced} от {live}',
  'path.complete': 'Завършен',
  'path.mastered': 'Усвоен',

  'themes.title': 'Теми',
  'themes.intro': 'Изберете тема и думите ѝ идват първи. Прегледите ви остават същите.',
  'themes.count': { one: '{count} дума', other: '{count} думи' },
  'themes.aboveLevel': 'Включва думи над вашето ниво',
  'themes.choose': 'Учете тази тема',
  'themes.active': 'Учите сега',
  'themes.clear': 'Обратно към пътя',
  'themes.none': 'Все още няма достатъчно големи теми.',

  'progress.title': 'Напредък',
  'progress.tiers': 'Вашите думи',
  'tier.new': 'Нови',
  'tier.learning': 'Учат се',
  'tier.young': 'Затвърждават се',
  'tier.mature': 'Усвоени',
  'progress.levels': 'Нива',
  'progress.retention': 'Запомнени от първия опит',
  'progress.retentionValue': '{percent}% за последните 30 дни',
  'progress.retentionNone': 'Все още няма достатъчно прегледи.',
  'progress.retentionHint': 'Това е честната мярка: прегледи на думи, които сте видели за последно в по-ранен ден.',
  'progress.motivation': 'Серия и XP',

  'report.open': 'Съобщете за проблем',
  'report.title': 'Проблем с „{word}“',
  'report.field': 'Какво не е наред?',
  'report.translation': 'Грешен или странен превод',
  'report.example': 'Лош пример',
  'report.audio': 'Лошо аудио',
  'report.level': 'Грешно ниво',
  'report.other': 'Нещо друго',
  'report.note': 'Подробности (по желание)',
  'report.send': 'Изпратете',
  'report.cancel': 'Отказ',
  'report.sent': 'Сигналът е запазен. Благодарим ви.',

  'pos.noun': 'съществително',
  'pos.verb': 'глагол',
  'pos.adj': 'прилагателно',
  'pos.adv': 'наречие',
  'pos.pron': 'местоимение',
  'pos.prep': 'предлог',
  'pos.det': 'определител',
  'pos.num': 'числително',
  'pos.conj': 'съюз',
  'pos.intj': 'междуметие',
  'pos.phrase': 'израз',
}
```

`web/src/i18n/i18n.tsx`:

```tsx
import type { LocalizedText } from '@wordado/core'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { bg } from './bg'
import { en, type Message, type MessageKey, type Messages } from './en'

export type { MessageKey }

export const LOCALES = ['bg', 'en'] as const
export type Locale = (typeof LOCALES)[number]

/** The one localStorage key the app uses (spec §11.2: the interface language is the learner's choice). */
export const LOCALE_KEY = 'wordado.locale'

/** The lead L1 is the default until 6b reads the learner's own (spec §11.2). */
const DEFAULT_LOCALE: Locale = 'bg'

const MESSAGES: Readonly<Record<Locale, Messages>> = { bg, en }

export type Vars = Readonly<Record<string, string | number>>

export function translate(locale: Locale, key: MessageKey, vars: Vars = {}): string {
  const message: Message = MESSAGES[locale][key]
  const template =
    typeof message === 'string'
      ? message
      : new Intl.PluralRules(locale).select(Number(vars['count'] ?? 0)) === 'one'
        ? message.one
        : message.other
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = vars[name]
    return value === undefined ? match : String(value)
  })
}

/** Pack text (unit titles, theme names) in the interface language: `l1` is the pack's own language (plan 3). */
export function localized(text: LocalizedText, locale: Locale): string {
  return locale === 'en' ? text.en : text.l1
}

type LocaleStorage = Pick<Storage, 'getItem' | 'setItem'>

function readLocale(storage: LocaleStorage | null): Locale {
  try {
    const saved = storage?.getItem(LOCALE_KEY)
    return LOCALES.find((l) => l === saved) ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

interface I18nValue {
  readonly locale: Locale
  readonly setLocale: (locale: Locale) => void
  readonly t: (key: MessageKey, vars?: Vars) => string
}

const I18nContext = createContext<I18nValue | null>(null)

function defaultStorage(): LocaleStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function I18nProvider(props: { readonly storage?: LocaleStorage | null; readonly children?: ReactNode }) {
  const storage = props.storage === undefined ? defaultStorage() : props.storage
  const [locale, setState] = useState<Locale>(() => readLocale(storage))
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  const setLocale = useCallback(
    (next: Locale) => {
      setState(next)
      try {
        storage?.setItem(LOCALE_KEY, next)
      } catch {
        // A private window may refuse storage; the choice then lasts for this visit.
      }
    },
    [storage],
  )
  const value = useMemo<I18nValue>(() => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }), [locale, setLocale])
  return <I18nContext.Provider value={value}>{props.children}</I18nContext.Provider>
}

export function useT(): I18nValue {
  const value = useContext(I18nContext)
  if (!value) throw new Error('useT must be used inside an I18nProvider')
  return value
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test`
Expected: PASS — 4 in `env.test.ts`, 7 in `i18n.test.tsx`, 5 in `router.test.tsx`. The browser project reports no test files yet, which Vitest accepts.

- [ ] **Step 8: Check the dev server and the build start**

Run: `pnpm --filter @wordado/web build`
Expected: `dist/index.html` and one JS asset; no errors.

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green, `@wordado/web` included.

- [ ] **Step 10: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml web
git commit -m "feat(web): the package — Vite, React, the browser env, Bulgarian and English tables, the router"
```

---
### Task 4: SQLite in a Worker: OPFS, then IndexedDB, then memory

The web `SqlDriver` (spec §4.1, §9.1; plan 4 contract). A dedicated Worker holds one wa-sqlite connection and answers requests one at a time, in order. It opens the first storage the browser supports: OPFS through `OPFSCoopSyncVFS` (synchronous build), then IndexedDB through `IDBBatchAtomicVFS` (asynchronous build), then an in-memory database. It falls back only when a storage is **unsupported** — its VFS cannot be created. A supported storage that fails to open its file is an error, never a quiet switch to an empty second database.

**Files:**
- Create: `web/src/storage/protocol.ts`, `web/src/storage/open.ts`, `web/src/storage/waSqlite.ts`, `web/src/storage/vfs-shims.d.ts`, `web/src/storage/sqlite.worker.ts`, `web/src/storage/workerDriver.ts`
- Test: `web/src/storage/open.test.ts`, `web/src/storage/workerDriver.browser.test.ts`

**Interfaces:**
- Consumes: `SqlDriver`, `SqlValue` from `client-data`; `@journeyapps/wa-sqlite`.
- Produces, from `protocol.ts`: `BACKENDS = ['opfs', 'idb', 'memory'] as const`; `type Backend`; `type WorkerCall`; `type WorkerRequest`; `type WorkerResponse`; `interface OpenResult { backend: Backend; failures: readonly string[] }`.
- Produces, from `open.ts`: `class StorageUnavailable extends Error`; `openFirst<C>(file, backends, openers: Readonly<Record<Backend, (file: string) => Promise<C>>>): Promise<{ connection: C; backend: Backend; failures: string[] }>`.
- Produces, from `workerDriver.ts`: `interface OpenedDriver { driver: SqlDriver; backend: Backend; failures: readonly string[] }`; `type WorkerFactory = () => Worker`; `openWorkerDriver(file: string, backends?: readonly Backend[], makeWorker?: WorkerFactory): Promise<OpenedDriver>`. Task 7 opens `openWorkerDriver('demo')`.

- [ ] **Step 1: Write the failing tests**

`web/src/storage/open.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { openFirst, StorageUnavailable } from './open'

const unsupported = (why: string) => async () => {
  throw new StorageUnavailable(why)
}

describe('openFirst', () => {
  it('opens the first storage the browser supports, and says why it skipped the others', async () => {
    const opened = await openFirst('demo', ['opfs', 'idb', 'memory'], {
      opfs: unsupported('no sync access handles'),
      idb: async (file) => `idb:${file}`,
      memory: async () => 'memory',
    })
    expect(opened).toEqual({ connection: 'idb:demo', backend: 'idb', failures: ['opfs: no sync access handles'] })
  })

  it('falls through to memory when nothing persistent is supported', async () => {
    const opened = await openFirst('demo', ['opfs', 'idb', 'memory'], {
      opfs: unsupported('no OPFS'),
      idb: unsupported('no IndexedDB'),
      memory: async () => 'memory',
    })
    expect(opened.backend).toBe('memory')
    expect(opened.failures).toHaveLength(2)
  })

  it('does not fall back when a supported storage fails to open: that would start an empty second database', async () => {
    await expect(
      openFirst('demo', ['opfs', 'memory'], {
        opfs: async () => {
          throw new Error('database disk image is malformed')
        },
        idb: async () => 'idb',
        memory: async () => 'memory',
      }),
    ).rejects.toThrow('malformed')
  })

  it('fails when every storage it may use is unsupported', async () => {
    await expect(openFirst('demo', ['opfs'], { opfs: unsupported('no OPFS'), idb: unsupported('x'), memory: unsupported('x') })).rejects.toThrow(
      'No storage could be opened (opfs: no OPFS)',
    )
  })
})
```

`web/src/storage/workerDriver.browser.test.ts`:

```ts
import { Client, Database } from '@wordado/client-data'
import { describe, expect, it } from 'vitest'
import { webEnv } from '../env'
import { openWorkerDriver } from './workerDriver'

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID()}`

describe('openWorkerDriver', () => {
  for (const backend of ['opfs', 'idb', 'memory'] as const) {
    it(`round-trips every SqlValue type on ${backend}, and keeps the file when it persists`, async () => {
      const file = unique(backend)
      const first = await openWorkerDriver(file, [backend])
      expect(first.backend).toBe(backend)
      const { driver } = first
      await driver.exec('CREATE TABLE t (a INTEGER, b TEXT, c BLOB, d REAL, e TEXT)')
      await driver.run('INSERT INTO t VALUES (?, ?, ?, ?, ?)', [1_790_000_000_123, 'ябълка', new Uint8Array([1, 2, 3]), 0.5, null])
      expect(await driver.all('SELECT * FROM t')).toEqual([{ a: 1_790_000_000_123, b: 'ябълка', c: new Uint8Array([1, 2, 3]), d: 0.5, e: null }])
      await driver.close()
      if (backend === 'memory') return
      const again = await openWorkerDriver(file, [backend])
      expect(await again.driver.all('SELECT b FROM t')).toEqual([{ b: 'ябълка' }])
      await again.driver.close()
    })
  }

  it('prefers OPFS in Chromium', async () => {
    const { driver, backend, failures } = await openWorkerDriver(unique('pref'))
    expect(backend).toBe('opfs')
    expect(failures).toEqual([])
    await driver.close()
  })

  it('rejects a bad statement with SQLite’s message and keeps working', async () => {
    const { driver } = await openWorkerDriver(unique('err'), ['memory'])
    await expect(driver.exec('CREATE TABLE')).rejects.toThrow(/syntax error|incomplete input/)
    await driver.exec('CREATE TABLE t (x)')
    await driver.run('INSERT INTO t VALUES (?)', [1])
    expect(await driver.all('SELECT x FROM t')).toEqual([{ x: 1 }])
    await driver.close()
  })

  it('refuses calls after close', async () => {
    const { driver } = await openWorkerDriver(unique('closed'), ['memory'])
    await driver.close()
    await expect(driver.all('SELECT 1')).rejects.toThrow('closed')
  })

  it('carries client-data’s transactions: a throw rolls back', async () => {
    const { driver } = await openWorkerDriver(unique('tx'), ['opfs'])
    const db = new Database(driver)
    await db.exec('CREATE TABLE t (x INTEGER)')
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (?)', [1])
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    await db.transaction((tx) => tx.run('INSERT INTO t VALUES (?)', [2]))
    expect(await db.all('SELECT x FROM t')).toEqual([{ x: 2 }])
    await db.close()
  })

  it('runs the Client: migrations, a settings write, and the same device after reopening', async () => {
    const file = unique('client')
    const env = webEnv()
    const first = await Client.open({ driver: (await openWorkerDriver(file, ['opfs'])).driver, env, l1: 'bg' })
    await first.updateSettings({ newWordLimit: 7 })
    const deviceId = first.snapshot.deviceId
    await first.close()
    const second = await Client.open({ driver: (await openWorkerDriver(file, ['opfs'])).driver, env, l1: 'bg' })
    expect(second.snapshot.settings.newWordLimit).toBe(7)
    expect(second.snapshot.deviceId).toBe(deviceId)
    await second.close()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test`
Expected: FAIL — `Cannot find module './open'` and `'./workerDriver'`.

- [ ] **Step 3: Write the message protocol and the storage chooser**

`web/src/storage/protocol.ts`:

```ts
import type { SqlValue } from '@wordado/client-data'

/** In order of preference (spec §9.1). */
export const BACKENDS = ['opfs', 'idb', 'memory'] as const
export type Backend = (typeof BACKENDS)[number]

export type WorkerCall =
  | { readonly op: 'open'; readonly file: string; readonly backends: readonly Backend[] }
  | { readonly op: 'exec'; readonly sql: string }
  | { readonly op: 'run'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly op: 'all'; readonly sql: string; readonly params: readonly SqlValue[] }
  | { readonly op: 'close' }

export type WorkerRequest = WorkerCall & { readonly id: number }

export type WorkerResponse =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string }

export interface OpenResult {
  readonly backend: Backend
  /** Why each storage before it was skipped. */
  readonly failures: readonly string[]
}
```

`web/src/storage/open.ts`:

```ts
import type { Backend } from './protocol'

/** A storage this browser does not support. The only failure that moves on to the next storage. */
export class StorageUnavailable extends Error {}

/**
 * Opens `file` on the first supported storage of `backends`. A storage that
 * is supported but fails to open is an error: falling back would open an
 * empty second database beside the learner's real one.
 */
export async function openFirst<C>(
  file: string,
  backends: readonly Backend[],
  openers: Readonly<Record<Backend, (file: string) => Promise<C>>>,
): Promise<{ connection: C; backend: Backend; failures: string[] }> {
  const failures: string[] = []
  for (const backend of backends) {
    try {
      return { connection: await openers[backend](file), backend, failures }
    } catch (err) {
      if (!(err instanceof StorageUnavailable)) throw err
      failures.push(`${backend}: ${err.message}`)
    }
  }
  throw new Error(`No storage could be opened (${failures.join('; ')})`)
}
```

- [ ] **Step 4: Write the wa-sqlite side**

The package declares `IDBBatchAtomicVFS` without its static `create`, and does not declare `OPFSCoopSyncVFS` at all; the shim covers the second, a cast the first. The shim must not be named after `waSqlite.ts`: TypeScript ignores a `.d.ts` that shares its base name with a `.ts` file.

`web/src/storage/vfs-shims.d.ts`:

```ts
declare module '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js' {
  export class OPFSCoopSyncVFS {
    static create(name: string, module: unknown): Promise<SQLiteVFS>
  }
}
```

`web/src/storage/waSqlite.ts`:

```ts
import * as SQLite from '@journeyapps/wa-sqlite'
import SQLiteAsyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite-async.mjs'
import SQLiteSyncFactory from '@journeyapps/wa-sqlite/dist/wa-sqlite.mjs'
import { IDBBatchAtomicVFS } from '@journeyapps/wa-sqlite/src/examples/IDBBatchAtomicVFS.js'
import { OPFSCoopSyncVFS } from '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js'
import type { SqlValue } from '@wordado/client-data'
import { StorageUnavailable } from './open'

/** One open database. Runs inside the Worker only. */
export interface Connection {
  readonly api: SQLiteAPI
  readonly db: number
}

// The package's declaration of IDBBatchAtomicVFS predates its async `create`.
const IdbVfs = IDBBatchAtomicVFS as unknown as { create(name: string, module: unknown): Promise<SQLiteVFS> }

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Creating the VFS is where an unsupported storage shows itself; anything after that is a real error. */
async function vfs(what: string, create: () => Promise<SQLiteVFS>): Promise<SQLiteVFS> {
  try {
    return await create()
  } catch (err) {
    throw new StorageUnavailable(`${what}: ${messageOf(err)}`)
  }
}

/** OPFS with synchronous access handles: the fastest, and Worker-only (spec §9.1). */
export async function openOpfs(file: string): Promise<Connection> {
  if (typeof navigator.storage?.getDirectory !== 'function') throw new StorageUnavailable('OPFS is not available')
  const module = await SQLiteSyncFactory()
  const api = SQLite.Factory(module)
  api.vfs_register(await vfs('OPFS', () => OPFSCoopSyncVFS.create('opfs', module)), true)
  return { api, db: await api.open_v2(`${file}.sqlite`) }
}

/** IndexedDB, for browsers without OPFS: slower, with the same guarantees (spec §9.1). */
export async function openIdb(file: string): Promise<Connection> {
  if (typeof indexedDB === 'undefined') throw new StorageUnavailable('IndexedDB is not available')
  const module = await SQLiteAsyncFactory()
  const api = SQLite.Factory(module)
  api.vfs_register(await vfs('IndexedDB', () => IdbVfs.create(`wordado-${file}`, module)), true)
  return { api, db: await api.open_v2(`${file}.sqlite`) }
}

/** The last resort: nothing survives the tab (spec §9.1). */
export async function openMemory(): Promise<Connection> {
  const module = await SQLiteSyncFactory()
  const api = SQLite.Factory(module)
  return { api, db: await api.open_v2(':memory:') }
}

/** Runs one or more statements with positional parameters; returns the rows of all of them. */
export async function allRows(c: Connection, sql: string, params: readonly SqlValue[]): Promise<Record<string, SqlValue>[]> {
  const rows: Record<string, SqlValue>[] = []
  for await (const stmt of c.api.statements(c.db, sql)) {
    if (params.length > 0) c.api.bind_collection(stmt, [...params])
    const columns = c.api.column_names(stmt)
    while ((await c.api.step(stmt)) === SQLite.SQLITE_ROW) {
      const values = c.api.row(stmt)
      rows.push(Object.fromEntries(columns.map((name, i) => [name, (values[i] ?? null) as SqlValue])))
    }
  }
  return rows
}
```

`bind_collection` binds a whole-number JavaScript number that does not fit in 32 bits as a double; SQLite's `INTEGER` affinity stores it back as an integer, and `row` returns it as a number while it is below 2⁵³, which every epoch-millisecond value is. The test above pins this with `1_790_000_000_123`.

- [ ] **Step 5: Write the Worker**

`web/src/storage/sqlite.worker.ts`:

```ts
import { openFirst } from './open'
import type { OpenResult, WorkerCall, WorkerRequest, WorkerResponse } from './protocol'
import { allRows, openIdb, openMemory, openOpfs, type Connection } from './waSqlite'

const scope = self as unknown as DedicatedWorkerGlobalScope
let connection: Connection | null = null

function open(): Connection {
  if (!connection) throw new Error('The database is not open')
  return connection
}

async function handle(call: WorkerCall): Promise<unknown> {
  switch (call.op) {
    case 'open': {
      if (connection) throw new Error('The database is already open')
      const opened = await openFirst(call.file, call.backends, { opfs: openOpfs, idb: openIdb, memory: openMemory })
      connection = opened.connection
      await connection.api.exec(connection.db, 'PRAGMA foreign_keys = ON')
      const result: OpenResult = { backend: opened.backend, failures: opened.failures }
      return result
    }
    case 'exec': {
      const c = open()
      await c.api.exec(c.db, call.sql)
      return null
    }
    case 'run':
      await allRows(open(), call.sql, call.params)
      return null
    case 'all':
      return allRows(open(), call.sql, call.params)
    case 'close': {
      const c = open()
      connection = null
      await c.api.close(c.db)
      return null
    }
  }
}

// One request at a time, in arrival order: the SqlDriver contract (plan 4).
let queue: Promise<void> = Promise.resolve()

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, ...call } = event.data
  queue = queue.then(async () => {
    let response: WorkerResponse
    try {
      response = { id, ok: true, value: await handle(call as WorkerCall) }
    } catch (err) {
      response = { id, ok: false, error: err instanceof Error ? err.message : String(err) }
    }
    scope.postMessage(response)
  })
}
```

- [ ] **Step 6: Write the page side**

`web/src/storage/workerDriver.ts`:

```ts
import type { SqlDriver, SqlValue } from '@wordado/client-data'
import { BACKENDS, type Backend, type OpenResult, type WorkerCall, type WorkerResponse } from './protocol'

export interface OpenedDriver {
  readonly driver: SqlDriver
  readonly backend: Backend
  readonly failures: readonly string[]
}

export type WorkerFactory = () => Worker

const sqliteWorker: WorkerFactory = () =>
  new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module', name: 'wordado-sqlite' })

/**
 * The web SqlDriver (plan 4 contract): every call is a message to the Worker,
 * answered in order. `close` terminates the Worker, which releases the OPFS
 * file for another tab (spec §9.1).
 */
export async function openWorkerDriver(
  file: string,
  backends: readonly Backend[] = BACKENDS,
  makeWorker: WorkerFactory = sqliteWorker,
): Promise<OpenedDriver> {
  const worker = makeWorker()
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  let nextId = 1
  let broken: Error | null = null

  const failAll = (error: Error) => {
    broken = error
    for (const p of pending.values()) p.reject(error)
    pending.clear()
  }

  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data
    const waiting = pending.get(response.id)
    if (!waiting) return
    pending.delete(response.id)
    if (response.ok) waiting.resolve(response.value)
    else waiting.reject(new Error(response.error))
  }
  worker.onerror = (event) => {
    event.preventDefault()
    failAll(new Error(`The database worker failed: ${event.message || 'unknown error'}`))
  }

  const call = (message: WorkerCall): Promise<unknown> => {
    if (broken) return Promise.reject(broken)
    return new Promise((resolve, reject) => {
      const id = nextId
      nextId += 1
      pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id })
    })
  }

  let opened: OpenResult
  try {
    opened = (await call({ op: 'open', file, backends })) as OpenResult
  } catch (err) {
    worker.terminate()
    throw err
  }

  const driver: SqlDriver = {
    exec: async (sql) => {
      await call({ op: 'exec', sql })
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      await call({ op: 'run', sql, params: [...params] })
    },
    all: async <T extends object>(sql: string, params: readonly SqlValue[] = []) => (await call({ op: 'all', sql, params: [...params] })) as T[],
    close: async () => {
      try {
        await call({ op: 'close' })
      } finally {
        worker.terminate()
        failAll(new Error('The database is closed'))
      }
    },
  }
  return { driver, backend: opened.backend, failures: opened.failures }
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test`
Expected: PASS — the unit project adds 4 (`open.test.ts`); the browser project runs 8 in Chromium. On a machine's first run Vitest may print "Vite unexpectedly reloaded a test" while it pre-bundles dependencies for the browser; the run still passes, and later runs are quiet.

- [ ] **Step 8: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 9: Commit**

```bash
git add web/src/storage
git commit -m "feat(web): SQLite in a Worker — OPFS, then IndexedDB, then memory, falling back only when unsupported"
```

---
### Task 5: One tab owns the database

Spec §9.1: OPFS access handles are exclusive, so one tab holds a Web Lock and owns the database; any other tab shows "Wordado is open in another tab" with a take-over button. Taking over asks the owner, over a `BroadcastChannel`, to let go: the owner runs its `release` callback (6b flushes the outbox there; this plan closes the database), then releases the lock, and the new tab opens the database. An owner that does not answer within five seconds — a frozen background tab — has the lock stolen; it notices, closes what it can, and shows the notice.

**Files:**
- Create: `web/src/storage/tabLock.ts`
- Test: `web/src/storage/tabLock.browser.test.ts`

**Interfaces:**
- Consumes: `createStore`, `Store` from `client-data`.
- Produces: `type LockState = 'idle' | 'owner' | 'elsewhere'`; `TAKE_OVER_WAIT_MS = 5000`; `DEFAULT_LOCK_NAME = 'wordado-db'`; `interface TabLockOptions { name?: string; release(): Promise<void>; waitMs?: number; locks?: LockManager; channel?: BroadcastChannel }`; `class TabLock { constructor(options); store: Store<LockState>; state: LockState; acquire(): Promise<boolean>; takeOver(): Promise<void>; dispose(options?: { keepLock?: boolean }): Promise<void> }`. Task 7's `Boot` uses exactly `acquire`, `takeOver`, `store` and the `release` option.

- [ ] **Step 1: Write the failing test**

Both "tabs" live in one page here: Web Locks are per origin and two `BroadcastChannel` objects with one name hear each other, so this is the same contention two tabs have.

`web/src/storage/tabLock.browser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TabLock } from './tabLock'

const unique = () => `lock-${crypto.randomUUID()}`

function tab(name: string, log: string[], label: string, release: () => Promise<void> = async () => undefined) {
  const lock = new TabLock({
    name,
    waitMs: 300,
    release: async () => {
      log.push(`${label} releasing`)
      await release()
      log.push(`${label} released`)
    },
  })
  lock.store.subscribe(() => log.push(`${label} ${lock.state}`))
  return lock
}

describe('TabLock', () => {
  it('lets one tab own the database and tells the other it is open elsewhere', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    expect(await a.acquire()).toBe(true)
    expect(await b.acquire()).toBe(false)
    expect([a.state, b.state]).toEqual(['owner', 'elsewhere'])
    await a.dispose()
    await b.dispose()
  })

  it('takes over politely: the owner releases first, then the new tab owns it', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    const b = tab(name, log, 'b')
    await a.acquire()
    await b.acquire()
    log.length = 0
    await b.takeOver()
    expect(log).toEqual(['b idle', 'a releasing', 'a released', 'a elsewhere', 'b owner'])
    // And back again.
    log.length = 0
    await a.takeOver()
    expect(log).toEqual(['a idle', 'b releasing', 'b released', 'b elsewhere', 'a owner'])
    await a.dispose()
    await b.dispose()
  })

  it('steals the lock from an owner that does not answer, which then closes and says so', async () => {
    const name = unique()
    const log: string[] = []
    const frozen = tab(name, log, 'a', () => new Promise<void>(() => undefined))
    // A tab that does not hear the request at all: its channel is closed.
    await frozen.acquire()
    await frozen.dispose({ keepLock: true })
    const b = tab(name, log, 'b')
    await b.acquire()
    log.length = 0
    await b.takeOver()
    expect(b.state).toBe('owner')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(frozen.state).toBe('elsewhere')
    expect(log).toContain('a releasing')
    await b.dispose()
  })

  it('does nothing when the owner asks to take over', async () => {
    const name = unique()
    const log: string[] = []
    const a = tab(name, log, 'a')
    await a.acquire()
    log.length = 0
    await a.takeOver()
    expect(log).toEqual([])
    await a.dispose()
  })

  it('frees the lock on dispose', async () => {
    const name = unique()
    const a = tab(name, [], 'a')
    await a.acquire()
    await a.dispose()
    const b = tab(name, [], 'b')
    expect(await b.acquire()).toBe(true)
    await b.dispose()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/web test -- tabLock`
Expected: FAIL — `Cannot find module './tabLock'`.

- [ ] **Step 3: Write the lock**

`web/src/storage/tabLock.ts`:

```ts
import { createStore, type Store } from '@wordado/client-data'

/** idle: asking; owner: this tab holds the database; elsewhere: another tab does (spec §9.1). */
export type LockState = 'idle' | 'owner' | 'elsewhere'

/** How long a take-over waits for the owner before stealing the lock. Tuning (§15). */
export const TAKE_OVER_WAIT_MS = 5_000

export const DEFAULT_LOCK_NAME = 'wordado-db'

const TAKE_OVER = 'take-over'

export interface TabLockOptions {
  readonly name?: string
  /**
   * Gives the database up: flush what can be flushed, then close it. Called
   * before the lock is released when another tab asks, and after the fact
   * when the lock is stolen. Errors are swallowed: the tab lets go regardless.
   */
  release(): Promise<void>
  readonly waitMs?: number
  readonly locks?: LockManager
  readonly channel?: BroadcastChannel
}

/** Single-tab ownership of the database: a Web Lock, and a BroadcastChannel to ask for it (spec §9.1). */
export class TabLock {
  readonly store: Store<LockState> = createStore<LockState>('idle')
  private readonly name: string
  private readonly waitMs: number
  private readonly locks: LockManager
  private readonly channel: BroadcastChannel
  private letGo: (() => void) | null = null
  /** Settles once the lock this tab holds has been released. */
  private holding: Promise<unknown> = Promise.resolve()

  constructor(private readonly options: TabLockOptions) {
    this.name = options.name ?? DEFAULT_LOCK_NAME
    this.waitMs = options.waitMs ?? TAKE_OVER_WAIT_MS
    this.locks = options.locks ?? navigator.locks
    this.channel = options.channel ?? new BroadcastChannel(this.name)
    this.channel.onmessage = (event: MessageEvent<unknown>) => {
      if (event.data === TAKE_OVER && this.state === 'owner') void this.handOver()
    }
  }

  get state(): LockState {
    return this.store.get()
  }

  private async giveUp(): Promise<void> {
    try {
      await this.options.release()
    } catch {
      // Nothing more can be done for the database; letting go matters more.
    }
  }

  /** Another tab asked: release, then let go of the lock. */
  private async handOver(): Promise<void> {
    await this.giveUp()
    this.store.set('elsewhere')
    const letGo = this.letGo
    this.letGo = null
    letGo?.()
  }

  /** The lock was stolen: the other tab already has it. Close, and say so. */
  private async stolen(): Promise<void> {
    this.letGo = null
    if (this.state !== 'owner') return
    this.store.set('elsewhere')
    await this.giveUp()
  }

  /** Resolves true once held, false when `ifAvailable` found it taken; rejects if the request fails. */
  private request(options: LockOptions): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      let held = false
      const request = this.locks
        .request(this.name, options, async (lock) => {
          if (!lock) {
            resolve(false)
            return
          }
          held = true
          this.store.set('owner')
          resolve(true)
          await new Promise<void>((release) => {
            this.letGo = release
          })
        })
        .catch((err: unknown) => {
          if (held) void this.stolen()
          else reject(err)
        })
      this.holding = request
    })
  }

  /** Takes the lock if no other tab holds it. */
  async acquire(): Promise<boolean> {
    this.store.set('idle')
    const held = await this.request({ ifAvailable: true })
    if (!held) this.store.set('elsewhere')
    return held
  }

  /** Asks the owner to let go and waits for the lock; steals it if the owner does not answer in time. */
  async takeOver(): Promise<void> {
    if (this.state === 'owner') return
    this.store.set('idle')
    this.channel.postMessage(TAKE_OVER)
    try {
      await this.request({ signal: AbortSignal.timeout(this.waitMs) })
    } catch {
      await this.request({ steal: true })
    }
  }

  /**
   * Stops listening and lets go of the lock, resolving once the browser has
   * released it. `keepLock` keeps holding it (tests use it to play a frozen tab).
   */
  async dispose(options: { readonly keepLock?: boolean } = {}): Promise<void> {
    this.channel.close()
    if (options.keepLock) return
    const letGo = this.letGo
    this.letGo = null
    letGo?.()
    await this.holding
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wordado/web test -- tabLock`
Expected: PASS (5 tests, browser project).

- [ ] **Step 5: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 6: Commit**

```bash
git add web/src/storage/tabLock.ts web/src/storage/tabLock.browser.test.ts
git commit -m "feat(web): one tab owns the database; take-over asks first and steals from a frozen tab"
```

---
### Task 6: Content: the bundled sample pack, pack fetching, and the audio cache

The app ships the A1 Bulgarian sample (spec §8.6: demo mode needs no download) at `/content/sample/`, with the layout the CDN will use (plan 3 contract), so the loader has one code path. A Vite plugin serves the directory in development and emits it into the build. `packs.ts` fetches and validates a manifest and resolves every pack and clip URL against it. `AudioStore` keeps verified clips in Cache Storage, prefetches the ones about to be needed, plays them, and — the rule of spec §7.5 and §9.3 — reports a clip as available only when this browser can play its format.

**Files:**
- Create: `web/vite/samplePack.ts`, `web/src/content/packs.ts`, `web/src/content/audio.ts`
- Modify: `web/vite.config.ts`
- Test: `web/vite/samplePack.test.ts`, `web/src/content/packs.test.ts`, `web/src/content/audio.browser.test.ts`

**Interfaces:**
- Consumes: `validateManifest`, `PackManifest`, `AudioClip`, `Corpus` from `core`; `PackFetcher` from `client-data`.
- Produces, from `vite/samplePack.ts`: `SAMPLE_PREFIX = 'content/sample/'`; `sampleFiles(dir: string): string[]`; `contentType(file: string): string`; `samplePack(dir: string): Plugin`.
- Produces, from `content/packs.ts`: `SAMPLE_MANIFEST_URL = '/content/sample/manifest.json'`; `type Fetch`; `manifestBase(manifestUrl: string, page?: string): URL`; `fetchManifest(manifestUrl: string, fetchFn?: Fetch): Promise<PackManifest>`; `packFetcher(manifestUrl: string, fetchFn?: Fetch): PackFetcher`; `clipUrl(clip: AudioClip, manifestUrl: string): string`.
- Produces, from `content/audio.ts`: `AUDIO_CACHE = 'wordado-audio-v1'`; `interface AudioPort { cachedClips(): ReadonlySet<string>; streamable(): boolean; play(clip: AudioClip): Promise<void> }`; `interface PlayerLike`; `interface AudioStoreOptions`; `class AudioStore implements AudioPort { refresh(corpus: Corpus): Promise<void>; prefetch(clips: readonly AudioClip[]): Promise<number> }`. The views depend on `AudioPort` only; tests supply a fake.

- [ ] **Step 1: Write the failing tests**

`web/vite/samplePack.test.ts`:

```ts
import { SAMPLE_DIR } from '@wordado/client-data/src/testing/sample'
import { describe, expect, it } from 'vitest'
import { contentType, sampleFiles, samplePack, SAMPLE_PREFIX } from './samplePack'

describe('sampleFiles', () => {
  it('lists what the manifest can reach, and not the pipeline’s source', () => {
    const files = sampleFiles(SAMPLE_DIR)
    expect(files).toContain('manifest.json')
    expect(files).toContain('corpus-v0-bg.pack')
    expect(files.filter((f) => f.startsWith('audio/') && f.endsWith('.m4a'))).toHaveLength(60)
    expect(files).not.toContain('source.json')
  })

  it('names content types the browser needs', () => {
    expect(contentType('manifest.json')).toBe('application/json')
    expect(contentType('corpus-v0-bg.pack')).toBe('application/json')
    expect(contentType('audio/apple-1-uk.m4a')).toBe('audio/mp4')
  })
})

type Middleware = (req: { url?: string }, res: FakeResponse, next: () => void) => void

class FakeResponse {
  statusCode = 200
  headers = new Map<string, string>()
  body: Buffer | null = null
  setHeader(name: string, value: string) {
    this.headers.set(name, value)
  }
  end(body?: Buffer) {
    this.body = body ?? null
  }
}

describe('samplePack in development', () => {
  const middleware = (): Middleware => {
    let installed: Middleware | null = null
    const plugin = samplePack(SAMPLE_DIR)
    const hook = plugin.configureServer as unknown as (server: { middlewares: { use(m: Middleware): void } }) => void
    hook({ middlewares: { use: (m) => (installed = m) } })
    return installed!
  }

  it('serves sample files with their type, and 404s anything else under the prefix', () => {
    const serve = middleware()
    const ok = new FakeResponse()
    serve({ url: `/${SAMPLE_PREFIX}manifest.json?v=1` }, ok, () => {
      throw new Error('should not fall through')
    })
    expect(ok.headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(ok.body!.toString('utf8')).packs[0].pack_id).toBe('corpus-bg')
    const missing = new FakeResponse()
    serve({ url: `/${SAMPLE_PREFIX}source.json` }, missing, () => undefined)
    expect(missing.statusCode).toBe(404)
  })

  it('passes other requests on', () => {
    let passed = false
    middleware()({ url: '/src/main.tsx' }, new FakeResponse(), () => {
      passed = true
    })
    expect(passed).toBe(true)
  })
})
```

`web/src/content/packs.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_DIR } from '@wordado/client-data/src/testing/sample'
import { describe, expect, it } from 'vitest'
import { clipUrl, fetchManifest, packFetcher, type Fetch } from './packs'

const PAGE = 'https://wordado.test/study'

/** Serves the sample directory as if it were at https://wordado.test/content/sample/. */
const serveSample: Fetch = async (input) => {
  const url = new URL(input)
  const path = url.pathname.replace('/content/sample/', '')
  try {
    return new Response(readFileSync(join(SAMPLE_DIR, path)))
  } catch {
    return new Response('missing', { status: 404 })
  }
}

describe('fetchManifest', () => {
  it('fetches and validates the manifest', async () => {
    const manifest = await fetchManifest(new URL('/content/sample/manifest.json', PAGE).href, serveSample)
    expect(manifest.packs.map((p) => p.pack_id)).toEqual(['corpus-bg'])
  })

  it('refuses a missing, invalid or too-new manifest with a reason', async () => {
    await expect(fetchManifest('https://wordado.test/content/none/manifest.json', serveSample)).rejects.toThrow('404')
    const json = (body: unknown): Fetch => async () => new Response(JSON.stringify(body))
    await expect(fetchManifest('https://x.test/m.json', json({ schema_version: 1, corpus_version: 0, packs: 'no' }))).rejects.toThrow('invalid')
    await expect(fetchManifest('https://x.test/m.json', json({ schema_version: 99, corpus_version: 0, packs: [] }))).rejects.toThrow('newer app')
  })
})

describe('packFetcher and clipUrl', () => {
  it('resolve pack and clip URLs against the manifest’s URL (plan 3 contract)', async () => {
    const manifestUrl = new URL('/content/sample/manifest.json', PAGE).href
    const manifest = await fetchManifest(manifestUrl, serveSample)
    const bytes = await packFetcher(manifestUrl, serveSample)(manifest.packs[0]!)
    expect(bytes.byteLength).toBe(manifest.packs[0]!.bytes)
    const clip = { clipId: 'apple-1-uk', url: 'audio/apple-1-uk.m4a', sha256: '0'.repeat(64), bytes: 1, mime: 'audio/mp4' }
    expect(clipUrl(clip, manifestUrl)).toBe('https://wordado.test/content/sample/audio/apple-1-uk.m4a')
  })

  it('throws on a failed pack fetch, which client-data records as a rejected pack', async () => {
    const fail: Fetch = async () => new Response('', { status: 503 })
    const descriptor = { pack_id: 'p', l1: 'bg', corpus_version: 1, schema_version: 1, url: 'p.pack', sha256: '0'.repeat(64), bytes: 1 }
    await expect(packFetcher('https://x.test/m.json', fail)(descriptor)).rejects.toThrow('503')
  })
})
```

`web/src/content/audio.browser.test.ts`:

```ts
import type { AudioClip, Corpus } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { webEnv } from '../env'
import { AUDIO_CACHE, AudioStore, type AudioStoreOptions, type PlayerLike } from './audio'
import type { Fetch } from './packs'

const env = webEnv()
const MANIFEST = 'https://cdn.wordado.test/v1/manifest.json'

async function clip(id: string, body: string, over: Partial<AudioClip> = {}): Promise<AudioClip> {
  const bytes = new TextEncoder().encode(body)
  return { clipId: id, url: `audio/${id}.m4a`, sha256: await env.sha256(bytes), bytes: bytes.byteLength, mime: 'audio/mp4', ...over }
}

const corpusOf = (clips: readonly AudioClip[]): Corpus => ({
  l1: 'bg',
  entries: new Map(),
  units: [],
  themes: [],
  clips: new Map(clips.map((c) => [c.clipId, c])),
  retired: new Set(),
})

/** Serves each clip's body from a fixed table. */
function server(bodies: Record<string, string>): Fetch & { calls: string[] } {
  const calls: string[] = []
  const fetchFn = (async (input: string) => {
    calls.push(input)
    const id = /audio\/(.+)\.m4a$/.exec(input)?.[1]
    const body = id === undefined ? undefined : bodies[id]
    return body === undefined ? new Response('', { status: 404 }) : new Response(body)
  }) as Fetch & { calls: string[] }
  fetchFn.calls = calls
  return fetchFn
}

const store = (over: Partial<AudioStoreOptions> = {}) =>
  new AudioStore({ manifestUrl: MANIFEST, sha256: env.sha256, canPlay: () => true, online: () => true, fetch: server({}), ...over })

afterEach(async () => {
  await caches.delete(AUDIO_CACHE)
})

describe('AudioStore', () => {
  it('prefetches verified clips into the cache, once, and a new store finds them', async () => {
    const a = await clip('a', 'aaa')
    const b = await clip('b', 'bbb')
    const fetchFn = server({ a: 'aaa', b: 'bbb' })
    const first = store({ fetch: fetchFn })
    expect(await first.prefetch([a, b])).toBe(2)
    expect(await first.prefetch([a, b])).toBe(0)
    expect(fetchFn.calls).toHaveLength(2)
    expect(first.cachedClips()).toEqual(new Set(['a', 'b']))
    const second = store()
    await second.refresh(corpusOf([a, b]))
    expect(second.cachedClips()).toEqual(new Set(['a', 'b']))
  })

  it('refuses a clip whose bytes do not match the pack’s checksum', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'tampered' }) })
    expect(await s.prefetch([a])).toBe(0)
    expect(s.cachedClips().size).toBe(0)
  })

  it('reports nothing playable when the browser cannot play the format (spec §7.5)', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'aaa' }), canPlay: () => false })
    await s.prefetch([a])
    await s.refresh(corpusOf([a]))
    expect(s.cachedClips().size).toBe(0)
    expect(s.streamable()).toBe(false)
  })

  it('streams only when online and the format plays', async () => {
    const a = await clip('a', 'aaa')
    let online = true
    const s = store({ online: () => online })
    await s.refresh(corpusOf([a]))
    expect(s.streamable()).toBe(true)
    online = false
    expect(s.streamable()).toBe(false)
  })

  it('plays from the cache without the network, resolving when the clip ends', async () => {
    const a = await clip('a', 'aaa')
    const fetchFn = server({ a: 'aaa' })
    const player = fakePlayer('ends')
    const s = store({ fetch: fetchFn, player: () => player })
    await s.prefetch([a])
    fetchFn.calls.length = 0
    await s.play(a)
    expect(fetchFn.calls).toEqual([])
    expect(player.played).toBe(1)
  })

  it('rejects when the clip cannot play, so the view can say so', async () => {
    const a = await clip('a', 'aaa')
    const s = store({ fetch: server({ a: 'aaa' }), player: () => fakePlayer('fails') })
    await expect(s.play(a)).rejects.toThrow()
  })
})

function fakePlayer(outcome: 'ends' | 'fails'): PlayerLike & { played: number } {
  const target = new EventTarget()
  const player = {
    src: '',
    played: 0,
    addEventListener: target.addEventListener.bind(target),
    removeEventListener: target.removeEventListener.bind(target),
    pause: () => undefined,
    play: async () => {
      player.played += 1
      if (outcome === 'fails') throw new DOMException('no decoder', 'NotSupportedError')
      setTimeout(() => target.dispatchEvent(new Event('ended')), 5)
    },
  }
  return player
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test`
Expected: FAIL — `Cannot find module './samplePack'`, `'./packs'`, `'./audio'`.

- [ ] **Step 3: Write the Vite plugin**

`web/vite/samplePack.ts`:

```ts
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Where the app finds the bundled sample, with the CDN's layout (plan 3 contract). */
export const SAMPLE_PREFIX = 'content/sample/'

const TYPES: Readonly<Record<string, string>> = { '.json': 'application/json', '.pack': 'application/json', '.m4a': 'audio/mp4' }

export function contentType(file: string): string {
  return TYPES[extname(file)] ?? 'application/octet-stream'
}

/** Every file of the sample the manifest can reach, relative and with forward slashes; not the pipeline's `source.json`. */
export function sampleFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.filter((file) => file !== 'source.json')
}

/**
 * Serves `dir` at /content/sample/ in development and emits it into the build
 * (spec §8.6: the demo sample ships inside the app). Files keep their names:
 * the manifest's checksums are over exactly these bytes.
 */
export function samplePack(dir: string): Plugin {
  return {
    name: 'wordado-sample-pack',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        if (!path.startsWith(`/${SAMPLE_PREFIX}`)) {
          next()
          return
        }
        const file = path.slice(SAMPLE_PREFIX.length + 1)
        if (!sampleFiles(dir).includes(file)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('content-type', contentType(file))
        res.end(readFileSync(join(dir, file)))
      })
    },
    generateBundle() {
      for (const file of sampleFiles(dir)) {
        this.emitFile({ type: 'asset', fileName: `${SAMPLE_PREFIX}${file}`, source: readFileSync(join(dir, file)) })
      }
    },
  }
}
```

In `web/vite.config.ts`, add the import and the plugin:

```ts
import { fileURLToPath } from 'node:url'
import { samplePack } from './vite/samplePack'

const SAMPLE_DIR = fileURLToPath(new URL('../pipeline/samples/a1-bg/', import.meta.url))
```

and change `plugins: [react()]` to `plugins: [react(), samplePack(SAMPLE_DIR)]`.

- [ ] **Step 4: Write pack fetching**

`web/src/content/packs.ts`:

```ts
import type { PackFetcher } from '@wordado/client-data'
import { validateManifest, type AudioClip, type PackManifest } from '@wordado/core'

/** The bundled sample (spec §8.6). Plan 7 adds the CDN's manifest beside it. */
export const SAMPLE_MANIFEST_URL = '/content/sample/manifest.json'

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>

const pageUrl = () => globalThis.location?.href ?? 'http://localhost/'

/** The manifest's absolute URL: what every pack and clip URL is relative to (plan 3 contract). */
export function manifestBase(manifestUrl: string, page: string = pageUrl()): URL {
  return new URL(manifestUrl, page)
}

/** Fetches and validates a manifest (plan 3 contract: the manifest goes through `validateManifest` first). */
export async function fetchManifest(manifestUrl: string, fetchFn: Fetch = (i, init) => fetch(i, init)): Promise<PackManifest> {
  const response = await fetchFn(manifestBase(manifestUrl).href, { cache: 'no-cache' })
  if (!response.ok) throw new Error(`The manifest could not be fetched (${response.status})`)
  const result = validateManifest(await response.json())
  if (result.status === 'ok') return result.manifest
  if (result.status === 'unsupported_schema') throw new Error(`The manifest's schema ${result.schemaVersion} needs a newer app`)
  throw new Error(`The manifest is invalid: ${result.errors[0]?.path}: ${result.errors[0]?.message}`)
}

/** client-data's PackFetcher on the web: the pack's URL resolved against the manifest's. Throws on any failure. */
export function packFetcher(manifestUrl: string, fetchFn: Fetch = (i, init) => fetch(i, init)): PackFetcher {
  return async (descriptor) => {
    const response = await fetchFn(new URL(descriptor.url, manifestBase(manifestUrl)).href)
    if (!response.ok) throw new Error(`The pack could not be fetched (${response.status})`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

export function clipUrl(clip: AudioClip, manifestUrl: string): string {
  return new URL(clip.url, manifestBase(manifestUrl)).href
}
```

- [ ] **Step 5: Write the audio store**

`web/src/content/audio.ts`:

```ts
import type { AudioClip, Corpus } from '@wordado/core'
import { clipUrl, type Fetch } from './packs'

/** The one cache the app writes audio to (spec §9.3). Bump the suffix to drop every clip. */
export const AUDIO_CACHE = 'wordado-audio-v1'

/** What the study views and runs need from audio. */
export interface AudioPort {
  /** Clips that can be played offline: empty when this browser cannot play the pack's format (spec §7.5). */
  cachedClips(): ReadonlySet<string>
  /** Whether a clip that is not cached can be played now: the format plays and the device is online. */
  streamable(): boolean
  /** Plays a clip; resolves when it ends, rejects when it cannot be played. */
  play(clip: AudioClip): Promise<void>
}

/** The part of HTMLAudioElement the store uses. */
export interface PlayerLike {
  src: string
  play(): Promise<void>
  pause(): void
  addEventListener(type: 'ended' | 'error', listener: () => void): void
  removeEventListener(type: 'ended' | 'error', listener: () => void): void
}

export interface AudioStoreOptions {
  readonly manifestUrl: string
  readonly sha256: (bytes: Uint8Array) => Promise<string>
  readonly caches?: CacheStorage
  readonly fetch?: Fetch
  readonly online?: () => boolean
  /** Whether the browser plays a MIME type; `canPlayType` by default. */
  readonly canPlay?: (mime: string) => boolean
  readonly player?: () => PlayerLike
}

const browserCanPlay = (mime: string): boolean => {
  try {
    return new Audio().canPlayType(mime) !== ''
  } catch {
    return false
  }
}

/**
 * Clips verified against the pack's checksum and kept in Cache Storage
 * (spec §9.3). Every question about availability is answered for clips this
 * browser can play, so `client-data` never offers listening that would fail.
 */
export class AudioStore implements AudioPort {
  private readonly cached = new Map<string, string>()
  private readonly playable = new Map<string, boolean>()
  private formatsPlay = false
  private player: PlayerLike | null = null

  constructor(private readonly options: AudioStoreOptions) {}

  private canPlay(mime: string): boolean {
    let known = this.playable.get(mime)
    if (known === undefined) {
      known = (this.options.canPlay ?? browserCanPlay)(mime)
      this.playable.set(mime, known)
    }
    return known
  }

  private url(clip: AudioClip): string {
    return clipUrl(clip, this.options.manifestUrl)
  }

  private open(): Promise<Cache> {
    return (this.options.caches ?? caches).open(AUDIO_CACHE)
  }

  private fetch(url: string): Promise<Response> {
    return (this.options.fetch ?? ((i, init) => fetch(i, init)))(url)
  }

  /** Re-reads which of the corpus's clips are cached; call after a pack is activated. */
  async refresh(corpus: Corpus): Promise<void> {
    const cache = await this.open()
    const keys = new Set((await cache.keys()).map((request) => request.url))
    const clips = [...corpus.clips.values()]
    this.cached.clear()
    for (const clip of clips) if (keys.has(this.url(clip))) this.cached.set(clip.clipId, clip.mime)
    this.formatsPlay = clips.length > 0 && clips.every((clip) => this.canPlay(clip.mime))
  }

  cachedClips(): ReadonlySet<string> {
    return new Set([...this.cached].filter(([, mime]) => this.canPlay(mime)).map(([clipId]) => clipId))
  }

  streamable(): boolean {
    return this.formatsPlay && (this.options.online ?? (() => navigator.onLine))()
  }

  /**
   * Fetches, verifies and caches the clips not cached yet, one at a time
   * (spec §9.3). A clip that fails to fetch or to verify is skipped; it is
   * tried again at the next prefetch. Returns how many were added.
   */
  async prefetch(clips: readonly AudioClip[]): Promise<number> {
    const cache = await this.open()
    let added = 0
    for (const clip of clips) {
      if (this.cached.has(clip.clipId)) continue
      try {
        const response = await this.fetch(this.url(clip))
        if (!response.ok) continue
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (bytes.byteLength !== clip.bytes || (await this.options.sha256(bytes)) !== clip.sha256) continue
        await cache.put(this.url(clip), new Response(bytes, { headers: { 'content-type': clip.mime } }))
        this.cached.set(clip.clipId, clip.mime)
        added += 1
      } catch {
        // Offline, or the CDN failed: the next prefetch tries again.
      }
    }
    return added
  }

  async play(clip: AudioClip): Promise<void> {
    const cache = await this.open()
    const response = (await cache.match(this.url(clip))) ?? (await this.fetch(this.url(clip)))
    if (!response.ok) throw new Error(`The clip could not be fetched (${response.status})`)
    const source = URL.createObjectURL(await response.blob())
    this.player?.pause()
    const player = (this.options.player ?? (() => new Audio()))()
    this.player = player
    try {
      await new Promise<void>((resolve, reject) => {
        const ended = () => resolve()
        const failed = () => reject(new Error('The clip could not be played'))
        player.addEventListener('ended', ended)
        player.addEventListener('error', failed)
        player.src = source
        player.play().catch(reject)
      })
    } finally {
      URL.revokeObjectURL(source)
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test`
Expected: PASS — `samplePack.test.ts` 4 and `packs.test.ts` 4 in the unit project; `audio.browser.test.ts` 6 in Chromium.

- [ ] **Step 7: Check that the build carries the sample**

Run: `pnpm --filter @wordado/web build && ls web/dist/content/sample web/dist/content/sample/audio | head`
Expected: `manifest.json`, `corpus-v0-bg.pack` and `audio/` with the 60 clips; no `source.json`.

- [ ] **Step 8: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 9: Commit**

```bash
git add web/vite web/vite.config.ts web/src/content
git commit -m "feat(web): the bundled sample pack, manifest and pack fetching, and a verified audio cache"
```

---
### Task 7: The home screen, the path, themes and progress

The four screens that read the client's snapshot and change nothing but the active theme (spec §7.2, §7.4, §8.3, §8.4, §8.9). Every number on them is computed by `core` or `client-data`: the capped due figure and the backlog, the paused flag, tiers, level completion, retention, the streak, XP, the unlocked set and current unit, offered themes and their sizes. The views choose words and layout.

**Files:**
- Create: `web/src/app/context.tsx`, `web/src/labels.ts`, `web/src/test/fixtures.tsx`
- Create: `web/src/screens/Home.tsx`, `web/src/screens/Path.tsx`, `web/src/screens/Themes.tsx`, `web/src/screens/Progress.tsx`
- Test: `web/src/screens/Home.test.tsx`, `web/src/screens/Path.test.tsx`, `web/src/screens/Themes.test.tsx`, `web/src/screens/Progress.test.tsx`

**Interfaces:**
- Consumes: `useClient`, `useClientSnapshot`, `ClientProvider` from `client-data`; `offeredThemes`, `themeEntries`, `levelIndex`, `MasteryTier`, `PartOfSpeech`, `Mode`, `Grade` from `core`; Task 3's `useT`, `localized`, `I18nProvider`, `Link`; Task 6's `AudioPort`; Task 4's `Backend`.
- Produces, from `app/context.tsx`: `interface AppServices { env: ClientEnv; audio: AudioPort; backend: Backend; afterRun(): void }`; `AppProvider` (props `value: AppServices`, `children`); `useApp(): AppServices`.
- Produces, from `labels.ts`: `TIER_LABEL: Record<MasteryTier, MessageKey>`, `MODE_LABEL: Record<Mode, MessageKey>`, `GRADE_LABEL: Record<Grade, MessageKey>`, `POS_LABEL: Record<PartOfSpeech, MessageKey>`.
- Produces, from `test/fixtures.tsx`: `fakeAudio(over?: Partial<AudioPort>): AudioPort & { played: AudioClip[] }`; `setup(options?: { env?: TestEnv; audio?: AudioPort }): Promise<{ env: TestEnv; client: Client; audio: AudioPort }>`; `renderWith(ui: ReactElement, ctx: { client; env; audio; backend?: Backend; locale?: Locale }): RenderResult`; `answerNew(client, env, count, grade?): Promise<void>`.
- Produces the screens `Home`, `Path`, `Themes`, `Progress` (no props). CSS classes used here — `today`, `today-more`, `note`, `button`, `primary`, `one-way`, `motivation`, `visually-hidden`, `level`, `level-code`, `units`, `unit`, `unit-status`, `themes`, `theme`, `active`, `tiers`, `tier-bar`, `stat` — are styled in Task 10.

- [ ] **Step 1: Write the app context, the label maps and the test fixtures**

`web/src/app/context.tsx`:

```tsx
import type { ClientEnv } from '@wordado/client-data'
import { createContext, useContext, type ReactNode } from 'react'
import type { AudioPort } from '../content/audio'
import type { Backend } from '../storage/protocol'

/** What the screens need beside the Client. */
export interface AppServices {
  readonly env: ClientEnv
  readonly audio: AudioPort
  /** Which storage the database opened on (spec §9.1): memory shows a banner. */
  readonly backend: Backend
  /**
   * Called when a run ends: fetches the clips of the words about to be met
   * (spec §9.3), and asks once for persistent storage (spec §9.1) — after the
   * learner has studied, because some browsers ask the learner to allow it.
   */
  afterRun(): void
}

const AppContext = createContext<AppServices | null>(null)

export function AppProvider(props: { readonly value: AppServices; readonly children?: ReactNode }) {
  return <AppContext.Provider value={props.value}>{props.children}</AppContext.Provider>
}

export function useApp(): AppServices {
  const value = useContext(AppContext)
  if (!value) throw new Error('useApp must be used inside an AppProvider')
  return value
}
```

`web/src/labels.ts`:

```ts
import type { Grade, MasteryTier, Mode, PartOfSpeech } from '@wordado/core'
import type { MessageKey } from './i18n/i18n'

export const TIER_LABEL: Readonly<Record<MasteryTier, MessageKey>> = {
  new: 'tier.new',
  learning: 'tier.learning',
  young: 'tier.young',
  mature: 'tier.mature',
}

export const MODE_LABEL: Readonly<Record<Mode, MessageKey>> = {
  flashcard: 'mode.flashcard',
  multiple_choice: 'mode.multiple_choice',
  listening_select: 'mode.listening_select',
  matching: 'mode.matching',
}

export const GRADE_LABEL: Readonly<Record<Grade, MessageKey>> = { 1: 'grade.1', 2: 'grade.2', 3: 'grade.3', 4: 'grade.4' }

export const POS_LABEL: Readonly<Record<PartOfSpeech, MessageKey>> = {
  noun: 'pos.noun',
  verb: 'pos.verb',
  adj: 'pos.adj',
  adv: 'pos.adv',
  pron: 'pos.pron',
  prep: 'pos.prep',
  det: 'pos.det',
  num: 'pos.num',
  conj: 'pos.conj',
  intj: 'pos.intj',
  phrase: 'pos.phrase',
}
```

`web/src/test/fixtures.tsx`:

```tsx
import { render, type RenderResult } from '@testing-library/react'
import { ClientProvider, type Client } from '@wordado/client-data'
import { openSampleClient } from '@wordado/client-data/src/testing/sample'
import { testEnv, type TestEnv } from '@wordado/client-data/src/testing/testEnv'
import { Grade, type AudioClip } from '@wordado/core'
import type { ReactElement } from 'react'
import { AppProvider } from '../app/context'
import type { AudioPort } from '../content/audio'
import { I18nProvider, type Locale } from '../i18n/i18n'
import type { Backend } from '../storage/protocol'

/** Audio that is never available unless a test says so, and records what it was asked to play. */
export function fakeAudio(over: Partial<AudioPort> = {}): AudioPort & { played: AudioClip[] } {
  const played: AudioClip[] = []
  return {
    played,
    cachedClips: () => new Set(),
    streamable: () => false,
    play: async (clip) => {
      played.push(clip)
    },
    ...over,
  }
}

/** A demo client over the sample, with a deterministic clock (plan 4's test env). */
export async function setup(options: { readonly env?: TestEnv; readonly audio?: AudioPort } = {}) {
  const env = options.env ?? testEnv()
  const client = await openSampleClient(env)
  return { env, client, audio: options.audio ?? fakeAudio() }
}

export interface RenderContext {
  readonly client: Client
  readonly env: TestEnv
  readonly audio: AudioPort
  readonly backend?: Backend
  readonly locale?: Locale
}

/** Renders inside every provider the app has, in English unless told otherwise. */
export function renderWith(ui: ReactElement, ctx: RenderContext): RenderResult {
  const storage = { getItem: () => ctx.locale ?? 'en', setItem: () => undefined }
  return render(
    <I18nProvider storage={storage}>
      <ClientProvider client={ctx.client}>
        <AppProvider value={{ env: ctx.env, audio: ctx.audio, backend: ctx.backend ?? 'opfs', afterRun: () => undefined }}>{ui}</AppProvider>
      </ClientProvider>
    </I18nProvider>,
  )
}

/** Introduces the next `count` new words of the plan, a few seconds apart. */
export async function answerNew(client: Client, env: TestEnv, count: number, grade: Grade = Grade.Good): Promise<void> {
  for (const wordId of client.snapshot.plan!.newWords.slice(0, count)) {
    await client.answer({ wordId, mode: 'flashcard', direction: 'en_to_l1', grade, latencyMs: 2_000, practice: false })
    env.advance(3_000)
  }
}
```

- [ ] **Step 2: Write the failing tests**

`web/src/screens/Home.test.tsx`:

```tsx
import { act, cleanup, screen } from '@testing-library/react'
import { DAY_MS } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, fakeAudio, renderWith, setup } from '../test/fixtures'
import { Home } from './Home'

afterEach(cleanup)

describe('Home', () => {
  it('leads with today’s new words and starts a session', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(screen.getByRole('link', { name: 'Start studying' }).getAttribute('href')).toBe('/study')
    expect(screen.getByText('Study today to start a streak.')).toBeTruthy()
    expect(screen.getByText('0 XP today, 0 in all')).toBeTruthy()
  })

  it('offers single-mode sessions, listening only when audio can play', async () => {
    const ctx = await setup()
    const { unmount } = renderWith(<Home />, ctx)
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/study?mode=flashcard')
    expect(screen.getByRole('link', { name: 'Multiple choice' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Listening' })).toBeNull()
    unmount()
    renderWith(<Home />, { ...ctx, audio: fakeAudio({ streamable: () => true }) })
    expect(screen.getByRole('link', { name: 'Listening' }).getAttribute('href')).toBe('/study?mode=listening_select')
  })

  it('says the day is done, and points to practice, once today’s words are answered', async () => {
    const ctx = await setup()
    renderWith(<Home />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 10))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Nothing left for today.')
    expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice')
    expect(screen.getByText(/1-day streak/).textContent).toContain('Today counts.')
    expect(screen.getByText('100 XP today, 100 in all')).toBeTruthy()
    expect(screen.getByText('XP is confirmed when your progress syncs.')).toBeTruthy()
  })

  it('shows the capped figure first and the whole backlog second, and says new words wait', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 10)
    ctx.env.advance(30 * DAY_MS)
    await ctx.client.updateSettings({ reviewCap: 3 })
    renderWith(<Home />, ctx)
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('3 words to review')
    expect(screen.getByText('10 due in all. The rest wait for another day.')).toBeTruthy()
    expect(screen.getByText('New words wait until your reviews are under today’s limit.')).toBeTruthy()
  })

  it('speaks Bulgarian by default', async () => {
    const ctx = await setup()
    renderWith(<Home />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 нови думи')
  })
})
```

`web/src/screens/Path.test.tsx`:

```tsx
import { act, cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Path } from './Path'

afterEach(cleanup)

const unit = (title: string) => screen.getByRole('heading', { name: title }).closest('li')!

describe('Path', () => {
  it('shows the first unit current and the rest locked before any answer', async () => {
    const ctx = await setup()
    renderWith(<Path />, ctx)
    expect(within(unit('People and greetings')).getByText('Current')).toBeTruthy()
    expect(within(unit('People and greetings')).getByText('0 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Locked')).toBeTruthy()
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })

  it('moves the current unit on once every word of the first is introduced', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 30 })
    renderWith(<Path />, ctx)
    await act(() => answerNew(ctx.client, ctx.env, 20))
    expect(within(unit('People and greetings')).getByText('20 of 20 started')).toBeTruthy()
    expect(within(unit('Food and drink')).getByText('Current')).toBeTruthy()
    expect(within(unit('Home and every day')).getByText('Locked')).toBeTruthy()
  })

  it('shows a level below the declared one as skipped, never as complete (spec §7.2)', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    renderWith(<Path />, ctx)
    expect(screen.getByText('Skipped: you placed above this level.')).toBeTruthy()
  })

  it('uses the pack’s own unit titles in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Path />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { name: 'Хора и поздрави' })).toBeTruthy()
  })
})
```

`web/src/screens/Themes.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { corpusWordId, themeEntries } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Themes } from './Themes'

afterEach(cleanup)

describe('Themes', () => {
  it('lists only the themes big enough to offer, with their size', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['Daily life'])
    expect(screen.getByText('25 words')).toBeTruthy()
  })

  it('makes a theme’s words come first, and clears it again', async () => {
    const ctx = await setup()
    renderWith(<Themes />, ctx)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Study this theme' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBe('daily-life')
    const theme = new Set(themeEntries(ctx.client.snapshot.corpus!, 'daily-life').map((e) => corpusWordId(e.entryId)))
    expect(ctx.client.snapshot.plan!.newWords.every((w) => theme.has(w))).toBe(true)
    expect(screen.getByText('Studying now')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Back to the path' })))
    expect(ctx.client.snapshot.settings.activeTheme).toBeNull()
  })

  it('names themes from the pack in Bulgarian', async () => {
    const ctx = await setup()
    renderWith(<Themes />, { ...ctx, locale: 'bg' })
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Всекидневие')
  })
})
```

`web/src/screens/Progress.test.tsx`:

```tsx
import { act, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Progress } from './Progress'

afterEach(cleanup)

const stat = (label: string) => screen.getByText(label).nextElementSibling?.textContent

describe('Progress', () => {
  it('counts every live word by tier', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(stat('New')).toBe('60')
    expect(stat('Mature')).toBe('0')
    await act(() => answerNew(ctx.client, ctx.env, 3))
    expect(stat('New')).toBe('57')
    expect(stat('Learning')).toBe('3')
  })

  it('says retention needs reviews before it shows a number (spec §8.3)', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(screen.getByText('Not enough reviews yet.')).toBeTruthy()
  })

  it('shows level completion by CEFR band', async () => {
    const ctx = await setup()
    renderWith(<Progress />, ctx)
    expect(screen.getByText('0 of 60 words learned well')).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test -- screens`
Expected: FAIL — `Cannot find module './Home'` and the three others.

- [ ] **Step 4: Write the home screen**

`web/src/screens/Home.tsx`:

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'

const ONE_WAY: readonly Mode[] = ['flashcard', 'multiple_choice', 'listening_select']

/** Today (spec §8.3): the capped due figure first, the backlog second, then the day's motivation. */
export function Home() {
  const { t } = useT()
  const { audio } = useApp()
  const { plan, progress, xp } = useClientSnapshot()
  if (!plan || !progress) return null
  const reviews = plan.reviews.length
  const fresh = plan.newWords.length
  const nothing = reviews + fresh === 0
  const canListen = audio.streamable() || audio.cachedClips().size > 0
  const modes = ONE_WAY.filter((mode) => mode !== 'listening_select' || canListen)
  const { streak } = progress
  return (
    <section className="home" aria-labelledby="today">
      <h1 id="today" className="today">
        {nothing ? t('home.allDone') : reviews > 0 ? t('home.reviews', { count: reviews }) : t('home.newWords', { count: fresh })}
      </h1>
      {nothing && <p className="today-more">{t('home.allDoneHint')}</p>}
      {!nothing && reviews > 0 && fresh > 0 && <p className="today-more">{t('home.newWords', { count: fresh })}</p>}
      {progress.backlogTotal > progress.dueToday && <p className="note">{t('home.backlog', { count: progress.backlogTotal })}</p>}
      {progress.newWordsPaused && <p className="note">{t('home.paused')}</p>}

      {nothing ? (
        <Link className="button primary" to={{ name: 'practice' }}>
          {t('home.practice')}
        </Link>
      ) : (
        <Link className="button primary" to={{ name: 'study', mode: null }}>
          {t('home.start')}
        </Link>
      )}

      {!nothing && (
        <nav className="one-way" aria-labelledby="one-way">
          <h2 id="one-way">{t('home.oneWay')}</h2>
          <ul>
            {modes.map((mode) => (
              <li key={mode}>
                <Link to={{ name: 'study', mode }}>{t(MODE_LABEL[mode])}</Link>
              </li>
            ))}
            <li>
              <Link to={{ name: 'practice' }}>{t('home.practice')}</Link>
            </li>
          </ul>
        </nav>
      )}

      <section className="motivation" aria-labelledby="motivation">
        <h2 id="motivation" className="visually-hidden">
          {t('progress.motivation')}
        </h2>
        <p>
          {streak.length > 0 ? t('home.streak', { count: streak.length }) : t('home.noStreak')}
          {streak.todayComplete && ` ${t('home.todayComplete')}`}
        </p>
        <p>{t('home.freezes', { count: streak.freezesLeft })}</p>
        <p>{t('home.xp', { today: xp.today, total: xp.total })}</p>
        {xp.provisional > 0 && <p className="note">{t('home.xpProvisional')}</p>}
      </section>
    </section>
  )
}
```

- [ ] **Step 5: Write the path**

`web/src/screens/Path.tsx`:

```tsx
import { useClientSnapshot, type PathView } from '@wordado/client-data'
import type { UnitProgress, Unit } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'

type UnitStatus = 'locked' | 'current' | 'complete' | 'mastered' | 'open'

function statusOf(unit: Unit, progress: UnitProgress | undefined, path: PathView): UnitStatus {
  if (!path.unlocked.has(unit.unitId)) return 'locked'
  if (progress?.mastered) return 'mastered'
  if (progress?.complete) return 'complete'
  if (path.currentUnitId === unit.unitId) return 'current'
  return 'open'
}

/** Icons repeat the text, never replace it (spec §11.1). */
const ICON: Readonly<Record<UnitStatus, string>> = { locked: '○', current: '●', complete: '✓', mastered: '★', open: '◐' }

/** The level path (spec §7.2): units in order, what is open, where new words come from. */
export function Path() {
  const { t, locale } = useT()
  const { corpus, progress, path } = useClientSnapshot()
  if (!corpus || !progress || !path) return null
  const levels = [...new Set(corpus.units.map((u) => u.level))]
  return (
    <section aria-labelledby="path-title">
      <h1 id="path-title">{t('path.title')}</h1>
      {levels.map((level) => {
        const completion = progress.levels[level]
        return (
          <section key={level} className="level" aria-labelledby={`level-${level}`}>
            <h2 id={`level-${level}`} className="level-code">
              {level}
            </h2>
            <p className="note">
              {completion?.kind === 'skipped'
                ? t('path.skipped')
                : t('path.levelProgress', { mature: completion?.mature ?? 0, live: completion?.live ?? 0 })}
            </p>
            <ol className="units">
              {corpus.units
                .filter((unit) => unit.level === level)
                .map((unit) => {
                  const unitProgress = progress.units.get(unit.unitId)
                  const status = statusOf(unit, unitProgress, path)
                  return (
                    <li key={unit.unitId} className={`unit unit-${status}`}>
                      <h3>{localized(unit.title, locale)}</h3>
                      <p className="unit-status">
                        <span aria-hidden="true">{ICON[status]} </span>
                        {status === 'locked' && t('path.locked')}
                        {status === 'current' && t('path.current')}
                        {status === 'complete' && t('path.complete')}
                        {status === 'mastered' && t('path.mastered')}
                      </p>
                      {status !== 'locked' && unitProgress && (
                        <p className="note">{t('path.introduced', { introduced: unitProgress.introduced, live: unitProgress.live })}</p>
                      )}
                    </li>
                  )
                })}
            </ol>
          </section>
        )
      })}
    </section>
  )
}
```

The `open` status has no label of its own — an unlocked unit that is neither current nor complete is shown by its "started" count alone.

- [ ] **Step 6: Write the themes screen**

`web/src/screens/Themes.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { levelIndex, offeredThemes, themeEntries } from '@wordado/core'
import { localized, useT } from '../i18n/i18n'

/** Theme collections (spec §8.9): choosing one puts its words first; nothing else changes. */
export function Themes() {
  const { t, locale } = useT()
  const client = useClient()
  const { corpus, settings } = useClientSnapshot()
  if (!corpus) return null
  const offered = offeredThemes(corpus)
  const active = settings.activeTheme
  const choose = (activeTheme: string | null) => void client.updateSettings({ activeTheme })
  return (
    <section aria-labelledby="themes-title">
      <h1 id="themes-title">{t('themes.title')}</h1>
      <p className="lede">{t('themes.intro')}</p>
      {active !== null && !offered.some((theme) => theme.themeId === active) && (
        <button type="button" className="button" onClick={() => choose(null)}>
          {t('themes.clear')}
        </button>
      )}
      {offered.length === 0 ? (
        <p>{t('themes.none')}</p>
      ) : (
        <ul className="themes">
          {offered.map((theme) => {
            const entries = themeEntries(corpus, theme.themeId)
            const aboveLevel = entries.some((e) => levelIndex(e.level) > levelIndex(settings.declaredLevel))
            const isActive = active === theme.themeId
            return (
              <li key={theme.themeId} className={isActive ? 'theme active' : 'theme'}>
                <h2>{localized(theme.name, locale)}</h2>
                <p>{localized(theme.description, locale)}</p>
                <p className="note">{t('themes.count', { count: entries.length })}</p>
                {aboveLevel && <p className="note">{t('themes.aboveLevel')}</p>}
                {isActive ? (
                  <>
                    <p className="stat">
                      <span aria-hidden="true">✓ </span>
                      {t('themes.active')}
                    </p>
                    <button type="button" className="button" onClick={() => choose(null)}>
                      {t('themes.clear')}
                    </button>
                  </>
                ) : (
                  <button type="button" className="button" onClick={() => choose(theme.themeId)}>
                    {t('themes.choose')}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 7: Write the progress screen**

`web/src/screens/Progress.tsx`:

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import type { MasteryTier } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { TIER_LABEL } from '../labels'

const TIERS: readonly MasteryTier[] = ['new', 'learning', 'young', 'mature']

/** The four metrics of spec §8.3, with motivation kept apart from learning. */
export function Progress() {
  const { t } = useT()
  const { progress, xp } = useClientSnapshot()
  if (!progress) return null
  const total = TIERS.reduce((sum, tier) => sum + progress.tiers[tier], 0)
  return (
    <section aria-labelledby="progress-title">
      <h1 id="progress-title">{t('progress.title')}</h1>

      <section aria-labelledby="tiers">
        <h2 id="tiers">{t('progress.tiers')}</h2>
        <div className="tier-bar" aria-hidden="true">
          {TIERS.map((tier) => (
            <span key={tier} className={`tier-${tier}`} style={{ flexGrow: total === 0 ? 0 : progress.tiers[tier] }} />
          ))}
        </div>
        <dl className="tiers">
          {TIERS.map((tier) => (
            <div key={tier} className={`tier tier-${tier}`}>
              <dt>{t(TIER_LABEL[tier])}</dt>
              <dd>{progress.tiers[tier]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="levels">
        <h2 id="levels">{t('progress.levels')}</h2>
        <dl className="levels">
          {Object.entries(progress.levels).map(([level, completion]) => (
            <div key={level}>
              <dt className="level-code">{level}</dt>
              <dd>
                {completion.kind === 'skipped'
                  ? t('path.skipped')
                  : t('path.levelProgress', { mature: completion.mature, live: completion.live })}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">{t('progress.retention')}</h2>
        <p className="stat">
          {progress.retention === null
            ? t('progress.retentionNone')
            : t('progress.retentionValue', { percent: Math.round(progress.retention * 100) })}
        </p>
        <p className="note">{t('progress.retentionHint')}</p>
      </section>

      <section aria-labelledby="motivation">
        <h2 id="motivation">{t('progress.motivation')}</h2>
        <p>{progress.streak.length > 0 ? t('home.streak', { count: progress.streak.length }) : t('home.noStreak')}</p>
        <p>{t('home.freezes', { count: progress.streak.freezesLeft })}</p>
        <p>{t('home.xp', { today: xp.today, total: xp.total })}</p>
      </section>
    </section>
  )
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test -- screens`
Expected: PASS — Home 5, Path 4, Themes 3, Progress 3.

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 10: Commit**

```bash
git add web/src/app web/src/labels.ts web/src/test web/src/screens
git commit -m "feat(web): today, the path, themes and progress, over the client's snapshot"
```

---
### Task 8: Studying: flashcards, multiple choice, listening, feedback and reporting an error

The study screen renders a `StudyRun` (Task 2) and forwards the learner's input to it; it grades nothing and chooses nothing (spec §4.1). Every mode is fully operable by keyboard and screen reader (spec §11.1): digits 1–4 answer or rate, Space and Enter reveal and continue, focus moves to each new prompt, feedback is announced, and correct and incorrect carry an icon and words, not colour alone. Every card has "Report a problem" (spec §8.10), which files a `content_report` document that syncs later.

**Files:**
- Create: `web/src/study/keys.ts`, `web/src/study/Headword.tsx`, `web/src/study/ReportDialog.tsx`, `web/src/study/RunView.tsx`, `web/src/screens/Study.tsx`
- Test: `web/src/study/keys.test.ts`, `web/src/study/RunView.test.tsx`, `web/src/screens/Study.test.tsx`

**Interfaces:**
- Consumes: Task 2's `StudyRun`, `RunSnapshot`, `RunKind`, `RunPhase`; `core`'s `StudyItem`, `ChoiceItem`, `CorpusEntry`, `Grade`, `entryClips`, `REPORT_FIELDS`, `ReportField`; `Client.report`; Task 7's `useApp`, `POS_LABEL`, `GRADE_LABEL`, fixtures; Task 3's `useStore`, `Link`, `useT`, `localized`.
- Produces, from `keys.ts`: `type KeyAction = { kind: 'choose'; index: number } | { kind: 'rate'; grade: Grade } | { kind: 'reveal' } | { kind: 'next' }`; `keyAction(key: string, phase: RunPhase, item: StudyItem | null): KeyAction | null`.
- Produces, from `Headword.tsx`: `Headword` (props `entry`, `id?`); `Translation` (props `entry`, `lang`).
- Produces, from `ReportDialog.tsx`: `ReportDialog` (props `wordId`, `entry`, `onClose()`).
- Produces, from `RunView.tsx`: `RunView` (props `run: StudyRun`, `kind: RunKind`).
- Produces, from `screens/Study.tsx`: `Study` (props `kind: RunKind`, `mode: Mode | null`) — Task 9's practice route renders it with `kind: 'practice'`.
- CSS classes styled in Task 10: `study`, `study-bar`, `card`, `headword`, `hw-word`, `hw-meta`, `hw-ipa`, `hw-pos`, `translation`, `sense`, `example`, `prompt-text`, `instruction`, `options`, `option`, `option-key`, `is-answer`, `is-wrong`, `ratings`, `rating`, `feedback`, `correct`, `incorrect`, `play`, `report`, `done`, `actions`, `link-button`.

- [ ] **Step 1: Write the failing tests**

`web/src/study/keys.test.ts`:

```ts
import type { ChoiceItem, CorpusEntry, FlashcardItem } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { keyAction } from './keys'

const entry = { entryId: 'a-1', headword: 'a' } as CorpusEntry
const flashcard: FlashcardItem = { mode: 'flashcard', wordId: 'c:a-1', entry, direction: 'en_to_l1' }
const choice: ChoiceItem = { mode: 'multiple_choice', wordId: 'c:a-1', entry, direction: 'en_to_l1', options: [entry, entry, entry], answerIndex: 0 }

describe('keyAction', () => {
  it('answers a choice with digits, within its options', () => {
    expect(keyAction('1', 'prompt', choice)).toEqual({ kind: 'choose', index: 0 })
    expect(keyAction('3', 'prompt', choice)).toEqual({ kind: 'choose', index: 2 })
    expect(keyAction('4', 'prompt', choice)).toBeNull()
  })

  it('reveals a flashcard with Space or Enter, then rates it 1–4', () => {
    expect(keyAction(' ', 'prompt', flashcard)).toEqual({ kind: 'reveal' })
    expect(keyAction('Enter', 'prompt', flashcard)).toEqual({ kind: 'reveal' })
    expect(keyAction('1', 'prompt', flashcard)).toBeNull()
    expect(keyAction('1', 'revealed', flashcard)).toEqual({ kind: 'rate', grade: 1 })
    expect(keyAction('4', 'revealed', flashcard)).toEqual({ kind: 'rate', grade: 4 })
  })

  it('continues from feedback with Space or Enter, and ignores digits there', () => {
    expect(keyAction('Enter', 'feedback', choice)).toEqual({ kind: 'next' })
    expect(keyAction(' ', 'feedback', choice)).toEqual({ kind: 'next' })
    expect(keyAction('2', 'feedback', choice)).toBeNull()
  })

  it('does nothing when the run is done or for other keys', () => {
    expect(keyAction('1', 'done', null)).toBeNull()
    expect(keyAction('a', 'prompt', choice)).toBeNull()
    expect(keyAction('Enter', 'prompt', choice)).toBeNull()
  })
})
```

`web/src/study/RunView.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { StudyRun, type RunOptions } from '@wordado/client-data'
import { Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioPort } from '../content/audio'
import { fakeAudio, renderWith, setup } from '../test/fixtures'
import { RunView } from './RunView'

afterEach(cleanup)

async function start(mode: RunOptions['mode'], audio: AudioPort = fakeAudio()) {
  const ctx = await setup({ audio })
  const run = await StudyRun.start(ctx.client, ctx.env, {
    kind: 'session',
    mode,
    cachedClips: () => audio.cachedClips(),
    online: () => audio.streamable(),
  })
  renderWith(<RunView run={run} kind="session" />, ctx)
  return { ...ctx, run }
}

const press = (key: string) => act(async () => void fireEvent.keyDown(document.body, { key }))

/** The option buttons. Their digit hints are aria-hidden, so a screen reader hears only the option itself. */
const options = () => [...document.querySelectorAll<HTMLButtonElement>('button.option')]

describe('RunView: multiple choice', () => {
  it('answers with a digit, marks the answer by icon and words, and continues with Enter', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    expect(options()).toHaveLength(4)
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('status').textContent).toContain('Correct')
    expect(document.querySelector('.is-answer')?.textContent).toContain('✓')
    expect(document.activeElement?.textContent).toBe('Continue')
    await press('Enter')
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('names the right answer after a wrong one', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const wrong = (item.answerIndex + 1) % item.options.length
    await act(async () => fireEvent.click(options()[wrong]!))
    expect(screen.getByRole('status').textContent).toMatch(/^✗ Not quite\. The answer is .+\.$/)
    expect(document.querySelector('.is-wrong')?.textContent).toContain('✗')
  })

  it('records one answer for a double press', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await act(async () => {
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
    })
    expect(run.snapshot.answered).toBe(1)
  })

  it('moves focus to each new prompt', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await press(String(item.answerIndex + 1))
    await press('Enter')
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })
})

describe('RunView: flashcards', () => {
  it('reveals with Space and passes the self-rating through', async () => {
    const { run, client } = await start('flashcard')
    const item = run.snapshot.item!
    expect(screen.queryByRole('group', { name: 'How well did you know it?' })).toBeNull()
    await press(' ')
    expect(screen.getByText(item.entry.translations[0]!)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'How well did you know it?' })).toBeTruthy()
    await press('4')
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Easy)
    expect(run.snapshot.answered).toBe(1)
  })
})

describe('RunView: listening', () => {
  it('plays the word, then counts latency from the end of the audio', async () => {
    const audio = fakeAudio({ streamable: () => true })
    const { run } = await start('listening_select', audio)
    expect(run.snapshot.item?.mode).toBe('listening_select')
    await waitFor(() => expect(audio.played).toHaveLength(1))
    expect(screen.getByText('Which word did you hear?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy()
  })

  it('still lets the learner answer when the audio fails', async () => {
    const audio = fakeAudio({
      streamable: () => true,
      play: async () => {
        throw new Error('no decoder')
      },
    })
    const { run } = await start('listening_select', audio)
    await screen.findByText('The audio didn’t play. You can still answer.')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await press(String(item.answerIndex + 1))
    expect(run.snapshot.answered).toBe(1)
  })
})

describe('RunView: the end of a run', () => {
  it('stops on request and says what was done', async () => {
    const { run } = await start('flashcard')
    await press(' ')
    await press('3')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(run.snapshot.phase).toBe('done')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Session complete')
    expect(screen.getByText('You answered 1 word.')).toBeTruthy()
    expect(screen.getByText('Today counts toward your streak.')).toBeTruthy()
    expect(screen.getByText('New unit open: People and greetings')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to today' }).getAttribute('href')).toBe('/')
  })
})

describe('RunView: reporting a problem', () => {
  it('files a report for the word on the card, and keys do not answer while the dialog is open', async () => {
    const { run, client } = await start('flashcard')
    const report = vi.spyOn(client, 'report')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await press(' ')
    expect(run.snapshot.phase).toBe('prompt')
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Bad audio' })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Details (optional)' }), { target: { value: 'Too quiet' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send report' })))
    expect(report).toHaveBeenCalledWith({ wordId: run.snapshot.item!.wordId, field: 'audio', note: 'Too quiet', packVersion: 0 })
    expect(screen.getByText('Report saved. Thank you.')).toBeTruthy()
  })
})
```

`web/src/screens/Study.test.tsx`:

```tsx
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { renderWith, setup } from '../test/fixtures'
import { Study } from './Study'

afterEach(cleanup)

describe('Study', () => {
  it('starts a run in the chosen mode', async () => {
    const ctx = await setup()
    renderWith(<Study kind="session" mode="flashcard" />, ctx)
    expect(await screen.findByRole('button', { name: 'Show answer' })).toBeTruthy()
  })

  it('says so when there is nothing to study', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ newWordLimit: 0 })
    renderWith(<Study kind="session" mode={null} />, ctx)
    expect(await screen.findByText('Nothing to study right now.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test -- keys RunView Study`
Expected: FAIL — `Cannot find module './keys'`, `'./RunView'`, `'./Study'`.

- [ ] **Step 3: Write the keyboard map**

`web/src/study/keys.ts`:

```ts
import type { RunPhase } from '@wordado/client-data'
import type { Grade, StudyItem } from '@wordado/core'

export type KeyAction =
  | { readonly kind: 'choose'; readonly index: number }
  | { readonly kind: 'rate'; readonly grade: Grade }
  | { readonly kind: 'reveal' }
  | { readonly kind: 'next' }

const DIGITS: Readonly<Record<string, number>> = { '1': 1, '2': 2, '3': 3, '4': 4 }

/** The keyboard for every mode (spec §11.1): 1–4 answer or rate, Space and Enter reveal and continue. */
export function keyAction(key: string, phase: RunPhase, item: StudyItem | null): KeyAction | null {
  if (!item) return null
  const digit = DIGITS[key]
  const confirm = key === ' ' || key === 'Enter'
  if (item.mode === 'flashcard') {
    if (phase === 'prompt' && confirm) return { kind: 'reveal' }
    if (phase === 'revealed' && digit !== undefined) return { kind: 'rate', grade: digit as Grade }
    return null
  }
  if (phase === 'prompt' && digit !== undefined && digit <= item.options.length) return { kind: 'choose', index: digit - 1 }
  if (phase === 'feedback' && confirm) return { kind: 'next' }
  return null
}
```

- [ ] **Step 4: Write the headword block**

`web/src/study/Headword.tsx`:

```tsx
import type { CorpusEntry } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { POS_LABEL } from '../labels'

/** The dictionary entry (the one memorable element of the design): headword, IPA, part of speech. */
export function Headword(props: { readonly entry: CorpusEntry; readonly id?: string }) {
  const { t } = useT()
  const { entry } = props
  const ipa = entry.ipa.replace(/^\/|\/$/g, '')
  return (
    <div className="headword">
      <p className="hw-word" lang="en" id={props.id}>
        {entry.headword}
      </p>
      <p className="hw-meta">
        {ipa !== '' && (
          <span className="hw-ipa" lang="en-fonipa">
            /{ipa}/
          </span>
        )}{' '}
        <i className="hw-pos">{t(POS_LABEL[entry.pos])}</i>
      </p>
    </div>
  )
}

/** The primary translation, with the sense gloss where the headword alone is ambiguous (spec §5.2). */
export function Translation(props: { readonly entry: CorpusEntry; readonly lang: string }) {
  const { entry } = props
  return (
    <span className="translation" lang={props.lang}>
      {entry.translations[0]}
      {entry.sense !== '' && <span className="sense"> ({entry.sense})</span>}
    </span>
  )
}
```

- [ ] **Step 5: Write the report dialog**

`web/src/study/ReportDialog.tsx`:

```tsx
import { useClient, useClientSnapshot } from '@wordado/client-data'
import { MAX_REPORT_NOTE_LENGTH, REPORT_FIELDS, type CorpusEntry, type ReportField, type WordId } from '@wordado/core'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { useT, type MessageKey } from '../i18n/i18n'

const FIELD_LABEL: Readonly<Record<ReportField, MessageKey>> = {
  translation: 'report.translation',
  example: 'report.example',
  audio: 'report.audio',
  level: 'report.level',
  other: 'report.other',
}

/** Report a problem with a card (spec §8.10). Works offline: the report is a document that syncs later. */
export function ReportDialog(props: { readonly wordId: WordId; readonly entry: CorpusEntry; readonly onClose: () => void }) {
  const { t } = useT()
  const client = useClient()
  const { packVersion } = useClientSnapshot()
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [field, setField] = useState<ReportField>('translation')
  const [note, setNote] = useState('')
  const [sent, setSent] = useState(false)

  useEffect(() => {
    const element = dialog.current
    if (element && !element.open) element.showModal()
    return () => element?.close()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    await client.report({ wordId: props.wordId, field, note: note.trim(), packVersion: packVersion ?? 0 })
    setSent(true)
  }

  return (
    <dialog ref={dialog} className="report" aria-labelledby={titleId} onCancel={props.onClose}>
      <h2 id={titleId}>{t('report.title', { word: props.entry.headword })}</h2>
      {sent ? (
        <>
          <p role="status">{t('report.sent')}</p>
          <button type="button" className="button" onClick={props.onClose}>
            {t('study.continue')}
          </button>
        </>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <fieldset>
            <legend>{t('report.field')}</legend>
            {REPORT_FIELDS.map((value) => (
              <label key={value}>
                <input type="radio" name="field" value={value} checked={field === value} onChange={() => setField(value)} />
                {t(FIELD_LABEL[value])}
              </label>
            ))}
          </fieldset>
          <label>
            {t('report.note')}
            <textarea value={note} maxLength={MAX_REPORT_NOTE_LENGTH} rows={3} onChange={(event) => setNote(event.target.value)} />
          </label>
          <div className="actions">
            <button type="submit" className="button primary">
              {t('report.send')}
            </button>
            <button type="button" className="button" onClick={props.onClose}>
              {t('report.cancel')}
            </button>
          </div>
        </form>
      )}
    </dialog>
  )
}
```

- [ ] **Step 6: Write the run view**

`web/src/study/RunView.tsx`:

```tsx
import { useClientSnapshot, type RunKind, type RunSnapshot, type StudyRun } from '@wordado/client-data'
import { entryClips, Grade, type ChoiceItem, type CorpusEntry } from '@wordado/core'
import { useEffect, useRef, useState } from 'react'
import { useApp } from '../app/context'
import { localized, useT } from '../i18n/i18n'
import { GRADE_LABEL } from '../labels'
import { Link } from '../router'
import { useStore } from '../useStore'
import { Headword, Translation } from './Headword'
import { keyAction } from './keys'
import { ReportDialog } from './ReportDialog'

const GRADES: readonly Grade[] = [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]

/** Renders a StudyRun and forwards the learner's input to it (spec §8.1, §11.1). */
export function RunView(props: { readonly run: StudyRun; readonly kind: RunKind }) {
  const { run } = props
  const { t } = useT()
  const snapshot = useStore(run.store)
  const [reporting, setReporting] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  // Keys work anywhere on the page, except in a form field or while the report dialog is open.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (reporting || event.altKey || event.ctrlKey || event.metaKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select')) return
      // A focused button already answers Enter and Space itself.
      if ((event.key === 'Enter' || event.key === ' ') && target?.closest('button, a')) return
      const s = run.snapshot
      const action = keyAction(event.key, s.phase, s.item)
      if (!action) return
      event.preventDefault()
      if (action.kind === 'choose') void run.choose(action.index)
      else if (action.kind === 'rate') void run.rate(action.grade)
      else if (action.kind === 'reveal') run.reveal()
      else run.next()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [run, reporting])

  // Each new prompt takes focus, so a screen reader reads it (spec §11.1).
  const item = snapshot.item
  useEffect(() => {
    if (item && snapshot.phase === 'prompt') card.current?.focus()
  }, [item, snapshot.phase])

  if (snapshot.phase === 'done') return <Done snapshot={snapshot} kind={props.kind} />
  if (!item) return null

  return (
    <section className="study" aria-label={t('app.name')}>
      <div className="study-bar">
        <p>{t('study.progress', { answered: snapshot.answered, remaining: snapshot.remaining })}</p>
        <button type="button" className="link-button" onClick={() => run.finish()}>
          {t('study.finish')}
        </button>
      </div>
      <div className="card" ref={card} tabIndex={-1} data-mode={item.mode} data-phase={snapshot.phase}>
        {item.mode === 'flashcard' ? <Flashcard run={run} snapshot={snapshot} entry={item.entry} /> : <Choice run={run} snapshot={snapshot} item={item} />}
        {snapshot.error !== null && <p role="alert">{t('study.error', { message: snapshot.error })}</p>}
        <button type="button" className="link-button report-open" onClick={() => setReporting(true)}>
          {t('report.open')}
        </button>
      </div>
      <p className="note keys-hint">{t('study.keysHint')}</p>
      {reporting && <ReportDialog wordId={item.wordId} entry={item.entry} onClose={() => setReporting(false)} />}
    </section>
  )
}

function Flashcard(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly entry: CorpusEntry }) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { entry, snapshot, run } = props
  return (
    <>
      <Headword entry={entry} />
      {snapshot.phase === 'prompt' ? (
        <button type="button" className="button primary" onClick={() => run.reveal()}>
          {t('study.reveal')}
        </button>
      ) : (
        <>
          <p className="prompt-text">
            <Translation entry={entry} lang={corpus?.l1 ?? 'bg'} />
          </p>
          {entry.examples[0] !== undefined && (
            <p className="example" lang="en">
              {entry.examples[0]}
            </p>
          )}
          <div className="ratings" role="group" aria-labelledby="rate-label">
            <p id="rate-label">{t('study.rateLabel')}</p>
            {GRADES.map((grade) => (
              <button key={grade} type="button" className={`rating rating-${grade}`} onClick={() => void run.rate(grade)}>
                <span className="option-key" aria-hidden="true">
                  {grade}
                </span>{' '}
                {t(GRADE_LABEL[grade])}
              </button>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function useListening(item: ChoiceItem, run: StudyRun): { replay: () => void; failed: boolean } {
  const { audio } = useApp()
  const { corpus } = useClientSnapshot()
  const [failed, setFailed] = useState(false)
  const clip = corpus ? entryClips(corpus, item.entry)[0] : undefined
  const play = () => {
    if (!clip) {
      setFailed(true)
      run.presented()
      return
    }
    setFailed(false)
    audio.play(clip).then(
      () => run.presented(),
      () => {
        setFailed(true)
        run.presented()
      },
    )
  }
  useEffect(() => {
    // Once per item: `play` is rebuilt every render, and the item is what matters.
    if (item.mode === 'listening_select') play()
  }, [item])
  return { replay: play, failed }
}

function Choice(props: { readonly run: StudyRun; readonly snapshot: RunSnapshot; readonly item: ChoiceItem }) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { run, snapshot, item } = props
  const l1 = corpus?.l1 ?? 'bg'
  const listening = item.mode === 'listening_select'
  const { replay, failed } = useListening(item, run)
  const feedback = snapshot.phase === 'feedback' ? snapshot.feedback : null
  const continueButton = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (feedback) continueButton.current?.focus()
  }, [feedback])
  const showsTranslations = !listening && item.direction === 'en_to_l1'
  const answerText = showsTranslations ? item.entry.translations[0] : item.entry.headword

  return (
    <>
      {listening ? (
        <>
          <button type="button" className="button play" onClick={replay}>
            <span aria-hidden="true">▶ </span>
            {t('study.playAgain')}
          </button>
          <p className="instruction">{t('study.listenPrompt')}</p>
          {failed && <p className="note">{t('study.audioFailed')}</p>}
        </>
      ) : item.direction === 'en_to_l1' ? (
        <>
          <Headword entry={item.entry} />
          <p className="instruction">{t('study.chooseTranslation')}</p>
        </>
      ) : (
        <>
          <p className="prompt-text">
            <Translation entry={item.entry} lang={l1} />
          </p>
          <p className="instruction">{t('study.chooseWord')}</p>
        </>
      )}

      <ol className="options">
        {item.options.map((option, index) => {
          const isAnswer = feedback !== null && index === item.answerIndex
          const isWrong = feedback !== null && !feedback.correct && index === feedback.chosen
          return (
            <li key={option.entryId}>
              <button
                type="button"
                className={`option${isAnswer ? ' is-answer' : ''}${isWrong ? ' is-wrong' : ''}`}
                disabled={feedback !== null}
                onClick={() => void run.choose(index)}
              >
                <span className="option-key" aria-hidden="true">
                  {index + 1}
                </span>{' '}
                {showsTranslations ? <Translation entry={option} lang={l1} /> : <span lang="en">{option.headword}</span>}
                {isAnswer && <span aria-hidden="true"> ✓</span>}
                {isWrong && <span aria-hidden="true"> ✗</span>}
              </button>
            </li>
          )
        })}
      </ol>

      <div className="feedback" role="status">
        {feedback && (
          <p className={feedback.correct ? 'correct' : 'incorrect'}>
            {feedback.correct
              ? `✓ ${t('study.correct')}${feedback.grade === Grade.Hard ? `. ${t('study.slow')}` : ''}`
              : `✗ ${t('study.incorrect', { answer: answerText ?? '' })}`}
          </p>
        )}
      </div>
      {feedback && (
        <button type="button" ref={continueButton} className="button primary" onClick={() => run.next()}>
          {t('study.continue')}
        </button>
      )}
    </>
  )
}

function Done(props: { readonly snapshot: RunSnapshot; readonly kind: RunKind }) {
  const { t, locale } = useT()
  const { afterRun } = useApp()
  const { corpus } = useClientSnapshot()
  const { snapshot } = props
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    heading.current?.focus()
    afterRun()
  }, [afterRun])
  const unitTitle = (unitId: string) => {
    const unit = corpus?.units.find((u) => u.unitId === unitId)
    return unit ? localized(unit.title, locale) : unitId
  }
  return (
    <section className="done" aria-labelledby="done-title">
      <h1 id="done-title" ref={heading} tabIndex={-1}>
        {t(props.kind === 'practice' ? 'done.practice' : 'done.session')}
      </h1>
      <p>{snapshot.answered === 0 ? t('done.nothing') : t('done.answered', { count: snapshot.answered })}</p>
      {snapshot.dayCompleted && <p>{t('done.dayComplete')}</p>}
      {snapshot.unlocked.map((unitId) => (
        <p key={unitId}>{t('done.unlocked', { title: unitTitle(unitId) })}</p>
      ))}
      <div className="actions">
        <Link className="button primary" to={{ name: 'practice' }}>
          {t('done.practiceMore')}
        </Link>
        <Link className="button" to={{ name: 'home' }}>
          {t('done.home')}
        </Link>
      </div>
    </section>
  )
}
```

- [ ] **Step 7: Write the study screen**

`web/src/screens/Study.tsx`:

```tsx
import { StudyRun, useClient, type RunKind } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useEffect, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { RunView } from '../study/RunView'

/** A session or a practice run (spec §7.4), in one mode or mixed. */
export function Study(props: { readonly kind: RunKind; readonly mode: Mode | null }) {
  const { t } = useT()
  const client = useClient()
  const { env, audio } = useApp()
  const [run, setRun] = useState<StudyRun | null>(null)
  const { kind, mode } = props

  useEffect(() => {
    let live = true
    setRun(null)
    void StudyRun.start(client, env, {
      kind,
      mode,
      cachedClips: () => audio.cachedClips(),
      online: () => audio.streamable(),
    }).then((started) => {
      if (live) setRun(started)
    })
    return () => {
      live = false
    }
  }, [client, env, audio, kind, mode])

  if (!run) return <p role="status">{t('study.loading')}</p>
  return <RunView key={`${kind}:${mode ?? 'mixed'}`} run={run} kind={kind} />
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test -- keys RunView Study`
Expected: PASS — keys 4, RunView 9, Study 2.

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 10: Commit**

```bash
git add web/src/study web/src/screens/Study.tsx web/src/screens/Study.test.tsx
git commit -m "feat(web): the study view — flashcards, multiple choice, listening, feedback, keyboard, and reporting a problem"
```

---
### Task 9: Practice and the matching game

Extra practice (spec §7.4) is any answer outside the schedule, and matching (spec §8.1) is a game whose answers are always practice. The practice menu offers a practice run — a `StudyRun` of kind `practice`, rendered by Task 8's `Study` — and the matching board, a `MatchingRun` (Task 2). Both columns of the board are keyboard buttons; a selected word is `aria-pressed`, a matched pair is marked by icon and words, and a wrong pairing is announced.

**Files:**
- Create: `web/src/screens/Practice.tsx`, `web/src/screens/Matching.tsx`
- Test: `web/src/screens/Practice.test.tsx`, `web/src/screens/Matching.test.tsx`

**Interfaces:**
- Consumes: Task 2's `MatchingRun`, `MatchingSnapshot`, `MatchingSide`; Task 8's `Translation`; Task 7's `useApp`, fixtures; Task 3's `Link`, `useStore`, `useT`.
- Produces: `Practice` and `Matching` screens (no props). CSS classes styled in Task 10: `practice-list`, `matching`, `board`, `column`, `pair`, `is-selected`, `is-matched`.

- [ ] **Step 1: Write the failing tests**

`web/src/screens/Practice.test.tsx`:

```tsx
import { cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Practice } from './Practice'

afterEach(cleanup)

describe('Practice', () => {
  it('asks for a few new words first when none has been studied', async () => {
    const ctx = await setup()
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Nothing to practise yet. Study a few new words first.')).toBeTruthy()
  })

  it('offers a practice run and the matching game, and says practice leaves the schedule alone', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    renderWith(<Practice />, ctx)
    expect(screen.getByText('Practice doesn’t change when words come back for review.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Practise words you know' }).getAttribute('href')).toBe('/practice/words')
    expect(screen.getByRole('link', { name: 'Flashcards' }).getAttribute('href')).toBe('/practice/words?mode=flashcard')
    expect(screen.getByRole('link', { name: 'Match words with their translations' }).getAttribute('href')).toBe('/practice/matching')
  })
})
```

`web/src/screens/Matching.test.tsx`:

```tsx
import { act, cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { answerNew, renderWith, setup } from '../test/fixtures'
import { Matching } from './Matching'

afterEach(cleanup)

const english = () => [...document.querySelectorAll<HTMLButtonElement>('[data-side="left"] button')]
const translationFor = (entryId: string) => document.querySelector<HTMLButtonElement>(`[data-side="right"] button[data-entry="${entryId}"]`)!
const click = (button: HTMLElement) => act(async () => void fireEvent.click(button))

describe('Matching', () => {
  it('needs five studied words', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 4)
    renderWith(<Matching />, ctx)
    expect(screen.getByText('Learn a few words first: matching needs five.')).toBeTruthy()
  })

  it('pairs words with translations, announces a wrong pair, and finishes the board', async () => {
    const ctx = await setup()
    await answerNew(ctx.client, ctx.env, 5)
    const states = ctx.client.snapshot.states
    renderWith(<Matching />, ctx)
    const left = english()
    expect(left).toHaveLength(5)
    const second = left[1]!.dataset.entry!

    await click(left[0]!)
    expect(left[0]!.getAttribute('aria-pressed')).toBe('true')
    await click(translationFor(second))
    expect(screen.getByRole('status').textContent).toMatch(/^✗ .+ and .+ aren’t a pair\.$/)

    for (const button of english()) {
      await click(button)
      await click(translationFor(button.dataset.entry!))
    }
    expect(screen.getByRole('status').textContent).toBe('✓ All pairs matched.')
    expect(english().every((b) => b.disabled && b.textContent!.includes('Matched'))).toBe(true)
    // Matching is practice: the schedule is untouched (spec §8.1).
    expect(ctx.client.snapshot.states).toEqual(states)
    await click(screen.getByRole('button', { name: 'Play again' }))
    expect(english().every((b) => !b.disabled)).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test -- Practice Matching`
Expected: FAIL — `Cannot find module './Practice'` and `'./Matching'`.

- [ ] **Step 3: Write the practice menu**

`web/src/screens/Practice.tsx`:

```tsx
import { useClientSnapshot } from '@wordado/client-data'
import type { Mode } from '@wordado/core'
import { useT } from '../i18n/i18n'
import { MODE_LABEL } from '../labels'
import { Link } from '../router'

const ONE_WAY: readonly Mode[] = ['flashcard', 'multiple_choice']

/** Extra practice (spec §7.4): outside the schedule, at reduced XP, never touching review state. */
export function Practice() {
  const { t } = useT()
  const { states } = useClientSnapshot()
  return (
    <section aria-labelledby="practice-title">
      <h1 id="practice-title">{t('practice.title')}</h1>
      <p className="lede">{t('practice.intro')}</p>
      {states.size === 0 ? (
        <p>{t('practice.noneYet')}</p>
      ) : (
        <ul className="practice-list">
          <li>
            <Link className="button primary" to={{ name: 'practice-words', mode: null }}>
              {t('home.practice')}
            </Link>
          </li>
          {ONE_WAY.map((mode) => (
            <li key={mode}>
              <Link to={{ name: 'practice-words', mode }}>{t(MODE_LABEL[mode])}</Link>
            </li>
          ))}
          <li>
            <Link to={{ name: 'matching' }}>{t('practice.matching')}</Link>
          </li>
        </ul>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Write the matching board**

`web/src/screens/Matching.tsx`:

```tsx
import { MatchingRun, useClient, useClientSnapshot, type MatchingSide } from '@wordado/client-data'
import type { CorpusEntry } from '@wordado/core'
import { useMemo, useState } from 'react'
import { useApp } from '../app/context'
import { useT } from '../i18n/i18n'
import { Link } from '../router'
import { Translation } from '../study/Headword'
import { useStore } from '../useStore'

/** The practice-only matching game (spec §8.1). A new board each round. */
export function Matching() {
  const { t } = useT()
  const client = useClient()
  const { env } = useApp()
  const [round, setRound] = useState(0)
  // `round` is a dependency on purpose: "Play again" deals a new board.
  const run = useMemo(() => MatchingRun.start(client, env), [client, env, round])
  if (!run) {
    return (
      <section aria-labelledby="matching-title">
        <h1 id="matching-title">{t('matching.title')}</h1>
        <p>{t('practice.needWords')}</p>
        <Link to={{ name: 'home' }}>{t('done.home')}</Link>
      </section>
    )
  }
  return <Board key={round} run={run} onAgain={() => setRound((r) => r + 1)} />
}

function Board(props: { readonly run: MatchingRun; readonly onAgain: () => void }) {
  const { t } = useT()
  const { corpus } = useClientSnapshot()
  const { run } = props
  const s = useStore(run.store)
  const l1 = corpus?.l1 ?? 'bg'
  const byId = (entryId: string) => s.left.find((e) => e.entryId === entryId)

  const pair = (side: MatchingSide, entry: CorpusEntry) => {
    const selected = s.selected?.side === side && s.selected.entryId === entry.entryId
    const matched = s.matched.has(entry.entryId)
    return (
      <li key={entry.entryId}>
        <button
          type="button"
          className={`pair${selected ? ' is-selected' : ''}${matched ? ' is-matched' : ''}`}
          aria-pressed={selected}
          disabled={matched}
          data-entry={entry.entryId}
          onClick={() => void run.select(side, entry.entryId)}
        >
          {side === 'left' ? <span lang="en">{entry.headword}</span> : <Translation entry={entry} lang={l1} />}
          {matched && (
            <>
              <span aria-hidden="true"> ✓</span>
              <span className="visually-hidden"> {t('matching.matched')}</span>
            </>
          )}
        </button>
      </li>
    )
  }

  return (
    <section className="matching" aria-labelledby="matching-title">
      <h1 id="matching-title">{t('matching.title')}</h1>
      <p className="lede">{t('matching.instructions')}</p>
      <div className="board">
        <div className="column" role="group" aria-labelledby="matching-en" data-side="left">
          <h2 id="matching-en">{t('matching.english')}</h2>
          <ul>{s.left.map((entry) => pair('left', entry))}</ul>
        </div>
        <div className="column" role="group" aria-labelledby="matching-l1" data-side="right">
          <h2 id="matching-l1">{t('matching.translation')}</h2>
          <ul>{s.right.map((entry) => pair('right', entry))}</ul>
        </div>
      </div>
      <div className="feedback" role="status">
        {s.miss && (
          <p className="incorrect">
            ✗ {t('matching.miss', { left: byId(s.miss.left)?.headword ?? '', right: byId(s.miss.right)?.translations[0] ?? '' })}
          </p>
        )}
        {s.done && <p className="correct">✓ {t('matching.done')}</p>}
        {s.error !== null && <p>{t('study.error', { message: s.error })}</p>}
      </div>
      {s.done && (
        <div className="actions">
          <button type="button" className="button primary" onClick={props.onAgain}>
            {t('matching.again')}
          </button>
          <Link className="button" to={{ name: 'home' }}>
            {t('done.home')}
          </Link>
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test -- Practice Matching`
Expected: PASS — Practice 2, Matching 2.

- [ ] **Step 6: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 7: Commit**

```bash
git add web/src/screens/Practice.tsx web/src/screens/Practice.test.tsx web/src/screens/Matching.tsx web/src/screens/Matching.test.tsx
git commit -m "feat(web): the practice menu and the matching game"
```

---
### Task 10: Boot, the app shell, and the design

Everything is wired together here. `Boot` takes the tab lock, opens the database in the Worker, opens the `Client`, installs the bundled sample pack and starts the session; when another tab takes over it closes the client and says so (spec §9.1). `Root` renders the boot state; `App` is the shell: the wordmark, navigation, the interface-language switch, the demo or memory banner, and the routed screens. `main.tsx` builds the real dependencies. `styles.css` carries the design recorded at the top of this plan.

**Files:**
- Create: `web/src/app/boot.ts`, `web/src/app/Root.tsx`, `web/src/app/App.tsx`, `web/src/styles.css`
- Modify: `web/src/main.tsx` (replace the placeholder)
- Test: `web/src/app/boot.test.ts`, `web/src/app/Root.test.tsx`

**Interfaces:**
- Consumes: Task 4's `openWorkerDriver`, `Backend`; Task 5's `TabLock`; Task 6's `AudioStore`, `fetchManifest`, `packFetcher`, `SAMPLE_MANIFEST_URL`; Task 7's `AppProvider`, `AppServices`, screens; Task 8's `Study`; Task 9's `Practice`, `Matching`; Task 3's `webEnv`, `I18nProvider`, `useRoute`, `Link`.
- Produces, from `boot.ts`: `type BootState = { status: 'starting' } | { status: 'elsewhere' } | { status: 'ready'; client: Client; backend: Backend } | { status: 'failed'; message: string }`; `interface LockPort { acquire(): Promise<boolean>; takeOver(): Promise<void> }`; `interface BootDeps { env; l1; openDriver(): Promise<{ driver: SqlDriver; backend: Backend }>; fetchManifest(): Promise<PackManifest>; fetchPack: PackFetcher; prepare?(client: Client): Promise<void>; onReady?(client: Client): Promise<void> }`; `class Boot { constructor(deps, makeLock: (release: () => Promise<void>) => LockPort); store: Store<BootState>; start(); takeOver(); retry(); release() }`. Plan 6b extends `BootDeps` with the account and the transport.
- Produces, from `Root.tsx`: `Root` (props `boot: Boot`, `services: Omit<AppServices, 'backend'>`). From `App.tsx`: `App`.

- [ ] **Step 1: Write the failing tests**

`web/src/app/boot.test.ts`:

```ts
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Client } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { describe, expect, it } from 'vitest'
import { Boot, type BootDeps, type LockPort } from './boot'

/** A boot over an in-memory database and the sample; `release` plays another tab taking over. */
function boot(over: Partial<BootDeps> = {}, free = true) {
  const deps: BootDeps = {
    env: testEnv(),
    l1: 'bg',
    openDriver: async () => ({ driver: nodeSqliteDriver(), backend: 'opfs' }),
    fetchManifest: async () => sampleManifest,
    fetchPack: sampleFetcher,
    ...over,
  }
  let owner = false
  let release: () => Promise<void> = async () => undefined
  const lock: LockPort = {
    acquire: async () => (owner = free),
    takeOver: async () => {
      owner = true
    },
  }
  const b = new Boot(deps, (r) => {
    release = r
    return lock
  })
  return { boot: b, release: () => release() }
}

const ready = (b: Boot): Client => {
  const state = b.store.get()
  if (state.status !== 'ready') throw new Error(`not ready: ${state.status}`)
  return state.client
}

describe('Boot', () => {
  it('opens the database, installs the bundled pack and starts a session', async () => {
    const calls: string[] = []
    const { boot: b } = boot({
      prepare: async () => {
        calls.push(`prepare while ${b.store.get().status}`)
      },
      onReady: async () => {
        calls.push(`onReady while ${b.store.get().status}`)
      },
    })
    await b.start()
    const client = ready(b)
    expect(client.snapshot.corpus?.entries.size).toBe(60)
    expect(client.snapshot.plan?.newWords).toHaveLength(10)
    expect(calls).toEqual(['prepare while starting', 'onReady while ready'])
  })

  it('shows the database as open elsewhere, then takes it over on request', async () => {
    const { boot: b } = boot({}, false)
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
    await b.takeOver()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('closes the client when another tab takes over', async () => {
    const { boot: b, release } = boot()
    await b.start()
    const client = ready(b)
    await release()
    expect(b.store.get().status).toBe('elsewhere')
    await expect(client.updateSettings({ newWordLimit: 5 })).rejects.toThrow()
  })

  it('starts offline from the pack it already has', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'wordado-boot-')), 'demo.sqlite')
    const first = boot({ openDriver: async () => ({ driver: nodeSqliteDriver(file), backend: 'opfs' }) })
    await first.boot.start()
    await first.release()
    const offline = boot({
      openDriver: async () => ({ driver: nodeSqliteDriver(file), backend: 'opfs' }),
      fetchManifest: async () => {
        throw new TypeError('Failed to fetch')
      },
    })
    await offline.boot.start()
    expect(ready(offline.boot).snapshot.corpus?.entries.size).toBe(60)
  })

  it('fails with a reason when there is no pack and none can be fetched, and recovers on retry', async () => {
    let online = false
    const { boot: b } = boot({
      fetchManifest: async () => {
        if (!online) throw new TypeError('Failed to fetch')
        return sampleManifest
      },
    })
    await b.start()
    expect(b.store.get()).toEqual({ status: 'failed', message: 'Failed to fetch' })
    online = true
    await b.retry()
    expect(ready(b).snapshot.corpus).not.toBeNull()
  })

  it('does not become ready when the lock is lost while it is still opening', async () => {
    const other: { takeOver?: () => Promise<void> } = {}
    const { boot: b, release } = boot({
      fetchManifest: async () => {
        await other.takeOver!()
        return sampleManifest
      },
    })
    other.takeOver = release
    await b.start()
    expect(b.store.get().status).toBe('elsewhere')
  })
})
```

`web/src/app/Root.test.tsx`:

```tsx
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import { sampleFetcher, sampleManifest } from '@wordado/client-data/src/testing/sample'
import { testEnv } from '@wordado/client-data/src/testing/testEnv'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/i18n'
import { fakeAudio } from '../test/fixtures'
import type { Backend } from '../storage/protocol'
import { Boot, type LockPort } from './boot'
import { Root } from './Root'

beforeEach(() => window.history.replaceState(null, '', '/'))
afterEach(cleanup)

async function renderRoot(options: { free?: boolean; backend?: Backend } = {}) {
  let owner = options.free ?? true
  const lock: LockPort = {
    acquire: async () => owner,
    takeOver: async () => {
      owner = true
    },
  }
  const env = testEnv()
  const boot = new Boot(
    {
      env,
      l1: 'bg',
      openDriver: async () => ({ driver: nodeSqliteDriver(), backend: options.backend ?? 'opfs' }),
      fetchManifest: async () => sampleManifest,
      fetchPack: sampleFetcher,
    },
    () => lock,
  )
  render(
    <I18nProvider storage={{ getItem: () => 'en', setItem: () => undefined }}>
      <Root boot={boot} services={{ env, audio: fakeAudio(), afterRun: () => undefined }} />
    </I18nProvider>,
  )
  await act(() => boot.start())
  return boot
}

describe('Root', () => {
  it('opens on today, in the demo', async () => {
    await renderRoot()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
    expect(screen.getByText('You are trying Wordado. Your progress stays on this device.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Today' }).getAttribute('aria-current')).toBe('page')
  })

  it('says when the database is open in another tab, and takes it over', async () => {
    await renderRoot({ free: false })
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Wordado is open in another tab.')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use Wordado here' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 new words')
  })

  it('warns that nothing will be kept on the in-memory fallback (spec §9.1)', async () => {
    await renderRoot({ backend: 'memory' })
    expect(screen.getByText(/can’t keep your progress/)).toBeTruthy()
  })

  it('navigates between screens and marks the current one', async () => {
    await renderRoot()
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Path' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Your path')
    expect(screen.getByRole('link', { name: 'Path' }).getAttribute('aria-current')).toBe('page')
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Wordado' })))
    await act(async () => fireEvent.click(screen.getByRole('link', { name: 'Start studying' })))
    expect(await screen.findByText(/done, \d+ to go/)).toBeTruthy()
  })

  it('switches the interface language', async () => {
    await renderRoot()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Български' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('10 нови думи')
    expect(screen.getByRole('button', { name: 'Български' }).getAttribute('aria-pressed')).toBe('true')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @wordado/web test -- boot Root`
Expected: FAIL — `Cannot find module './boot'` and `'./Root'`.

- [ ] **Step 3: Write the boot sequence**

`web/src/app/boot.ts`:

```ts
import { Client, createStore, type ClientEnv, type PackFetcher, type SqlDriver, type Store } from '@wordado/client-data'
import type { PackManifest } from '@wordado/core'
import type { Backend } from '../storage/protocol'

export type BootState =
  | { readonly status: 'starting' }
  /** Another tab owns the database (spec §9.1). */
  | { readonly status: 'elsewhere' }
  | { readonly status: 'ready'; readonly client: Client; readonly backend: Backend }
  | { readonly status: 'failed'; readonly message: string }

/** What Boot needs of the tab lock (Task 5's TabLock). */
export interface LockPort {
  acquire(): Promise<boolean>
  takeOver(): Promise<void>
}

export interface BootDeps {
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. Bulgarian in Phase 1a. */
  readonly l1: string
  openDriver(): Promise<{ readonly driver: SqlDriver; readonly backend: Backend }>
  fetchManifest(): Promise<PackManifest>
  readonly fetchPack: PackFetcher
  /** Quick work before the app shows, such as reading the audio cache's index. Its failure never fails the boot. */
  prepare?(client: Client): Promise<void>
  /** Background work once ready, such as prefetching audio. Its failure never fails the boot. */
  onReady?(client: Client): Promise<void>
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Starts the app (spec §9.1, §5.1): take the tab lock, open the database,
 * open the Client, install newer packs (a failure is fine if a pack is
 * already installed: the learner may be offline), start the session.
 */
export class Boot {
  readonly store: Store<BootState> = createStore<BootState>({ status: 'starting' })
  private readonly lock: LockPort
  private client: Client | null = null
  private backend: Backend = 'memory'
  /** Bumped when the database is given up, so an open still in flight does not become ready. */
  private generation = 0

  constructor(
    private readonly deps: BootDeps,
    makeLock: (release: () => Promise<void>) => LockPort,
  ) {
    this.lock = makeLock(() => this.release())
  }

  async start(): Promise<void> {
    this.store.set({ status: 'starting' })
    if (!(await this.lock.acquire())) {
      this.store.set({ status: 'elsewhere' })
      return
    }
    await this.open()
  }

  /** The learner chose to use Wordado in this tab (spec §9.1). */
  async takeOver(): Promise<void> {
    this.store.set({ status: 'starting' })
    await this.lock.takeOver()
    await this.open()
  }

  /** After a failed start: the lock is still held, so only the opening is tried again. */
  async retry(): Promise<void> {
    this.store.set({ status: 'starting' })
    await this.open()
  }

  /** Called by the lock when another tab takes over: close, and say so. 6b flushes the outbox first. */
  async release(): Promise<void> {
    this.generation += 1
    const client = this.client
    this.client = null
    this.store.set({ status: 'elsewhere' })
    await client?.close()
  }

  private async open(): Promise<void> {
    const generation = this.generation
    try {
      if (!this.client) {
        const { driver, backend } = await this.deps.openDriver()
        this.backend = backend
        this.client = await Client.open({ driver, env: this.deps.env, l1: this.deps.l1 })
        if (generation !== this.generation) {
          await this.client.close()
          this.client = null
          return
        }
      }
      const client = this.client
      let installFailure: unknown = null
      try {
        await client.installPacks(await this.deps.fetchManifest(), this.deps.fetchPack)
      } catch (err) {
        installFailure = err
      }
      await client.startSession()
      if (generation !== this.generation) return
      if (!client.snapshot.corpus) throw installFailure ?? new Error('No words are installed')
      await this.deps.prepare?.(client).catch(() => undefined)
      if (generation !== this.generation) return
      this.store.set({ status: 'ready', client, backend: this.backend })
      void this.deps.onReady?.(client).catch(() => undefined)
    } catch (err) {
      if (generation === this.generation) this.store.set({ status: 'failed', message: messageOf(err) })
    }
  }
}
```

- [ ] **Step 4: Write the root and the shell**

`web/src/app/Root.tsx`:

```tsx
import { ClientProvider } from '@wordado/client-data'
import { useT } from '../i18n/i18n'
import { useStore } from '../useStore'
import { App } from './App'
import type { Boot } from './boot'
import { AppProvider, type AppServices } from './context'

/** Renders the boot state: starting, open in another tab, failed, or the app. */
export function Root(props: { readonly boot: Boot; readonly services: Omit<AppServices, 'backend'> }) {
  const { t } = useT()
  const state = useStore(props.boot.store)
  switch (state.status) {
    case 'ready':
      return (
        <ClientProvider client={state.client}>
          <AppProvider value={{ ...props.services, backend: state.backend }}>
            <App />
          </AppProvider>
        </ClientProvider>
      )
    case 'elsewhere':
      return (
        <main className="notice">
          <h1>{t('tab.elsewhere')}</h1>
          <p>{t('tab.elsewhereHint')}</p>
          <button type="button" className="button primary" onClick={() => void props.boot.takeOver()}>
            {t('tab.takeOver')}
          </button>
        </main>
      )
    case 'failed':
      return (
        <main className="notice">
          <h1>{t('boot.failed')}</h1>
          <button type="button" className="button primary" onClick={() => void props.boot.retry()}>
            {t('boot.retry')}
          </button>
        </main>
      )
    default:
      return (
        <main className="notice">
          <p role="status">{t('boot.starting')}</p>
        </main>
      )
  }
}
```

`web/src/app/App.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { LOCALES, useT, type Locale, type MessageKey } from '../i18n/i18n'
import { Link, useRoute, type Route } from '../router'
import { Home } from '../screens/Home'
import { Matching } from '../screens/Matching'
import { Path } from '../screens/Path'
import { Practice } from '../screens/Practice'
import { Progress } from '../screens/Progress'
import { Study } from '../screens/Study'
import { Themes } from '../screens/Themes'
import { useApp } from './context'

const NAV: readonly { readonly route: Route; readonly label: MessageKey }[] = [
  { route: { name: 'home' }, label: 'nav.home' },
  { route: { name: 'path' }, label: 'nav.path' },
  { route: { name: 'themes' }, label: 'nav.themes' },
  { route: { name: 'progress' }, label: 'nav.progress' },
]

/** Each language named in itself, as language pickers do. The visible name is the accessible name (WCAG 2.5.3). */
const ENDONYM: Readonly<Record<Locale, string>> = { bg: 'Български', en: 'English' }

function Screen(props: { readonly route: Route }) {
  const { route } = props
  switch (route.name) {
    case 'study':
      return <Study kind="session" mode={route.mode} />
    case 'practice':
      return <Practice />
    case 'practice-words':
      return <Study kind="practice" mode={route.mode} />
    case 'matching':
      return <Matching />
    case 'path':
      return <Path />
    case 'themes':
      return <Themes />
    case 'progress':
      return <Progress />
    default:
      return <Home />
  }
}

function LanguageSwitch() {
  const { t, locale, setLocale } = useT()
  return (
    <div className="lang" role="group" aria-label={t('lang.label')}>
      {LOCALES.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={l === locale} onClick={() => setLocale(l)}>
          {ENDONYM[l]}
        </button>
      ))}
    </div>
  )
}

/** The shell: wordmark, navigation, language, banner, and the routed screen. */
export function App() {
  const { t } = useT()
  const { backend } = useApp()
  const route = useRoute()
  const main = useRef<HTMLElement>(null)
  const first = useRef(true)

  // After an in-app navigation, focus the new screen, as a page load would (spec §11.1).
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    main.current?.focus()
  }, [route])

  return (
    <div className="app">
      <a className="skip" href="#main">
        {t('nav.skip')}
      </a>
      <header className="masthead">
        <Link className="wordmark" to={{ name: 'home' }}>
          {t('app.name')}
        </Link>
        <nav className="nav" aria-label={t('nav.label')}>
          <ul>
            {NAV.map((item) => (
              <li key={item.label}>
                <Link to={item.route} aria-current={item.route.name === route.name ? 'page' : undefined}>
                  {t(item.label)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <LanguageSwitch />
      </header>
      {backend === 'memory' ? <p className="banner warning">{t('banner.memory')}</p> : <p className="banner">{t('banner.demo')}</p>}
      <main id="main" ref={main} tabIndex={-1}>
        <Screen route={route} />
      </main>
    </div>
  )
}
```

`aria-current` is typed `'page' | undefined` on `Link`; with `exactOptionalPropertyTypes` an explicit `undefined` needs the prop typed as `'page' | undefined`. Change the `Link` props in `web/src/router.tsx` accordingly:

```ts
  readonly 'aria-current'?: 'page' | undefined
```

- [ ] **Step 5: Write the entry point**

It replaces Task 3's placeholder.

`web/src/main.tsx`:

```tsx
import '@fontsource-variable/golos-text'
import '@fontsource-variable/literata'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Boot } from './app/boot'
import { Root } from './app/Root'
import { AudioStore } from './content/audio'
import { fetchManifest, packFetcher, SAMPLE_MANIFEST_URL } from './content/packs'
import { webEnv } from './env'
import { I18nProvider } from './i18n/i18n'
import { TabLock } from './storage/tabLock'
import { openWorkerDriver } from './storage/workerDriver'

const env = webEnv()
const audio = new AudioStore({ manifestUrl: SAMPLE_MANIFEST_URL, sha256: env.sha256 })

const boot = new Boot(
  {
    env,
    l1: 'bg',
    // The demo's own database (decision of 2026-09-24); 6b adds the learner's.
    openDriver: () => openWorkerDriver('demo'),
    fetchManifest: () => fetchManifest(SAMPLE_MANIFEST_URL),
    fetchPack: packFetcher(SAMPLE_MANIFEST_URL),
    // Before the app shows, so the first session already knows which clips can play (spec §9.3).
    prepare: async (client) => {
      if (client.snapshot.corpus) await audio.refresh(client.snapshot.corpus)
    },
    onReady: async (client) => {
      if (navigator.onLine) await audio.prefetch(client.upcomingClips())
    },
  },
  (release) => new TabLock({ release }),
)

let persistenceAsked = false

/** After a run: fetch ahead (spec §9.3), and ask once to keep storage (spec §9.1). */
function afterRun(): void {
  const state = boot.store.get()
  if (state.status === 'ready' && navigator.onLine) void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
  if (!persistenceAsked) {
    persistenceAsked = true
    void navigator.storage?.persist?.().catch(() => false)
  }
}

window.addEventListener('online', () => {
  const state = boot.store.get()
  if (state.status === 'ready') void audio.prefetch(state.client.upcomingClips()).catch(() => undefined)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <Root boot={boot} services={{ env, audio, afterRun }} />
    </I18nProvider>
  </StrictMode>,
)

void boot.start()
```

- [ ] **Step 6: Write the stylesheet**

The design recorded at the top of this plan: one memorable element — the headword, large in Literata with its IPA and italic part of speech, set like a dictionary entry — on a cool paper ground, deep ink text and a single rose accent for the primary action. Everything else is quiet: lists divided by rules, no card grid, no shadows. Dark mode swaps the tokens. The only motion is a short entrance of each new card, and only when the learner has not asked for reduced motion (spec §11.1). Every text colour pair meets WCAG AA (4.5:1) on its ground in both themes.

`web/src/styles.css`:

```css
:root {
  --paper: #f6f7fb;
  --paper-raised: #ffffff;
  --ink: #1d2b53;
  --ink-soft: #4b5675;
  --rule: #d9deea;
  --rose: #b8325a;
  --rose-ink: #ffffff;
  --leaf: #2e7d5b;
  --leaf-soft: #e1f1e9;
  --amber: #9a4f0c;
  --amber-soft: #fbeedd;

  --font-ui: 'Golos Text Variable', system-ui, sans-serif;
  --font-entry: 'Literata Variable', Georgia, serif;

  /* A major-third scale (1.25). */
  --step--1: 0.875rem;
  --step-0: 1rem;
  --step-1: 1.25rem;
  --step-2: 1.5625rem;
  --step-3: 1.953rem;
  --step-4: 2.441rem;
  --step-5: 3.052rem;

  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 2rem;
  --space-6: 3rem;

  --measure: 36rem;
  --radius: 0.5rem;
  color-scheme: light dark;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #141c33;
    --paper-raised: #1b2542;
    --ink: #e8ebf5;
    --ink-soft: #a9b1c9;
    --rule: #2e3a5c;
    --rose: #f07a9a;
    --rose-ink: #141c33;
    --leaf: #74cfa3;
    --leaf-soft: #17372b;
    --amber: #f2a863;
    --amber-soft: #3b2a17;
  }
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font: 400 var(--step-0) / 1.5 var(--font-ui);
  -webkit-text-size-adjust: 100%;
}

:focus-visible {
  outline: 3px solid var(--rose);
  outline-offset: 2px;
}

a {
  color: var(--rose);
}

h1 {
  font: 600 var(--step-3) / 1.15 var(--font-entry);
  letter-spacing: -0.01em;
  margin: 0 0 var(--space-3);
}

h2 {
  font: 600 var(--step-1) / 1.3 var(--font-ui);
  margin: var(--space-5) 0 var(--space-2);
}

h3 {
  font: 600 var(--step-0) / 1.4 var(--font-ui);
  margin: 0;
}

p {
  margin: 0 0 var(--space-2);
  max-width: var(--measure);
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.skip {
  position: absolute;
  left: -9999px;
}

.skip:focus {
  left: var(--space-3);
  top: var(--space-3);
  padding: var(--space-2) var(--space-3);
  background: var(--paper-raised);
  z-index: 1;
}

/* The shell */

.app {
  max-width: 44rem;
  margin: 0 auto;
  padding: var(--space-3) var(--space-4) var(--space-6);
}

.masthead {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-3) var(--space-5);
  padding-bottom: var(--space-3);
  border-bottom: 1px solid var(--rule);
}

.wordmark {
  font: 600 var(--step-2) / 1 var(--font-entry);
  letter-spacing: -0.01em;
  color: var(--ink);
  text-decoration: none;
}

.nav ul {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav a {
  display: inline-block;
  padding-block: var(--space-2);
  color: var(--ink-soft);
  text-decoration: none;
  border-bottom: 2px solid transparent;
}

.nav a[aria-current='page'] {
  color: var(--ink);
  border-bottom-color: var(--rose);
}

.lang {
  display: flex;
  gap: var(--space-1);
  margin-left: auto;
}

.lang button {
  min-height: 2.75rem;
  padding: 0 var(--space-3);
  font: 500 var(--step--1) / 1 var(--font-ui);
  color: var(--ink-soft);
  background: none;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  cursor: pointer;
}

.lang button[aria-pressed='true'] {
  color: var(--ink);
  border-color: var(--ink);
}

.banner {
  margin: var(--space-3) 0 0;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.banner.warning {
  padding: var(--space-2) var(--space-3);
  color: var(--amber);
  background: var(--amber-soft);
  border-radius: var(--radius);
}

main {
  padding-top: var(--space-5);
}

main:focus,
.card:focus,
.done h1:focus {
  outline: none;
}

.notice {
  max-width: var(--measure);
  margin: 20vh auto 0;
  padding: 0 var(--space-4);
}

.lede,
.note {
  color: var(--ink-soft);
}

.note {
  font-size: var(--step--1);
}

.stat {
  font-weight: 600;
}

/* Controls */

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  min-height: 2.75rem;
  padding: var(--space-2) var(--space-4);
  font: 500 var(--step-0) / 1.2 var(--font-ui);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  text-decoration: none;
  cursor: pointer;
}

.button:hover {
  border-color: var(--ink-soft);
}

.button.primary {
  color: var(--rose-ink);
  background: var(--rose);
  border-color: var(--rose);
}

.link-button {
  padding: var(--space-1) 0;
  font: inherit;
  font-size: var(--step--1);
  color: var(--ink-soft);
  background: none;
  border: none;
  text-decoration: underline;
  cursor: pointer;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
  margin-top: var(--space-4);
}

/* Today */

.today {
  max-width: 14ch;
  font-size: clamp(var(--step-4), 9vw, var(--step-5));
  line-height: 1.05;
}

.today-more {
  font: 400 var(--step-2) / 1.25 var(--font-entry);
  color: var(--ink-soft);
}

.home > .button.primary {
  margin: var(--space-4) 0;
}

.one-way ul,
.practice-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-4);
  list-style: none;
  margin: 0;
  padding: 0;
}

.motivation {
  margin-top: var(--space-5);
  padding-top: var(--space-4);
  border-top: 1px solid var(--rule);
  color: var(--ink-soft);
}

/* The dictionary entry: the one memorable element */

.study-bar {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.card {
  padding: var(--space-5) 0 var(--space-4);
  border-top: 3px solid var(--ink);
  border-bottom: 1px solid var(--rule);
}

.headword {
  margin-bottom: var(--space-4);
}

.hw-word {
  margin: 0;
  font: 500 clamp(2.5rem, 10vw, 4rem) / 1 var(--font-entry);
  letter-spacing: -0.02em;
}

.hw-meta {
  margin-top: var(--space-2);
  font: 400 var(--step-1) / 1.3 var(--font-entry);
  color: var(--ink-soft);
}

.prompt-text {
  margin: 0 0 var(--space-3);
  font: 500 clamp(2rem, 8vw, 3rem) / 1.1 var(--font-entry);
}

.sense {
  font-size: 0.6em;
  color: var(--ink-soft);
}

.example {
  font-family: var(--font-entry);
  font-style: italic;
  color: var(--ink-soft);
}

.instruction {
  margin-top: var(--space-3);
  color: var(--ink-soft);
}

.options {
  display: grid;
  gap: var(--space-2);
  margin: var(--space-3) 0;
  padding: 0;
  list-style: none;
}

.option,
.rating,
.pair {
  display: flex;
  align-items: baseline;
  gap: var(--space-3);
  width: 100%;
  min-height: 3rem;
  padding: var(--space-3) var(--space-4);
  font: 400 var(--step-1) / 1.3 var(--font-entry);
  text-align: left;
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  cursor: pointer;
}

.option:hover:not(:disabled),
.pair:hover:not(:disabled),
.rating:hover {
  border-color: var(--ink);
}

.option:disabled,
.pair:disabled {
  cursor: default;
}

.option-key {
  min-width: 1ch;
  font: 500 var(--step--1) / 1 var(--font-ui);
  color: var(--ink-soft);
}

.option.is-answer,
.pair.is-matched {
  color: var(--ink);
  background: var(--leaf-soft);
  border-color: var(--leaf);
}

.option.is-wrong {
  background: var(--amber-soft);
  border-color: var(--amber);
}

.ratings {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--space-2);
  margin-top: var(--space-4);
}

.ratings > p {
  grid-column: 1 / -1;
  margin: 0;
  color: var(--ink-soft);
}

.rating {
  justify-content: center;
  font: 500 var(--step-0) / 1.2 var(--font-ui);
}

.feedback p {
  margin-top: var(--space-3);
  font-weight: 600;
}

.feedback .correct {
  color: var(--leaf);
}

.feedback .incorrect {
  color: var(--amber);
}

.play {
  margin-bottom: var(--space-2);
}

.report-open {
  display: block;
  margin-top: var(--space-4);
}

.keys-hint {
  margin-top: var(--space-3);
}

@media (hover: none) {
  .keys-hint {
    display: none;
  }
}

@media (min-width: 40rem) {
  .options {
    grid-template-columns: 1fr 1fr;
  }

  .ratings {
    grid-template-columns: repeat(4, 1fr);
  }
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: card-in 180ms ease-out;
  }

  @keyframes card-in {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
}

/* Report a problem */

dialog.report {
  max-width: min(32rem, calc(100vw - 2rem));
  padding: var(--space-5);
  color: var(--ink);
  background: var(--paper-raised);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

dialog.report::backdrop {
  background: rgb(20 28 51 / 0.45);
}

dialog.report fieldset {
  display: grid;
  gap: var(--space-2);
  margin: 0 0 var(--space-3);
  padding: 0;
  border: none;
}

dialog.report legend {
  margin-bottom: var(--space-2);
  font-weight: 600;
}

dialog.report label {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

dialog.report label:has(textarea) {
  display: block;
}

dialog.report textarea {
  display: block;
  width: 100%;
  margin-top: var(--space-1);
  padding: var(--space-2);
  font: inherit;
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
}

/* The path */

.level-code {
  font: 600 var(--step-2) / 1 var(--font-entry);
}

.units,
.themes {
  margin: 0;
  padding: 0;
  list-style: none;
  border-top: 1px solid var(--rule);
}

.unit {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-3);
  padding: var(--space-3) 0;
  border-bottom: 1px solid var(--rule);
}

.unit h3 {
  font: 500 var(--step-1) / 1.3 var(--font-entry);
}

.unit .note {
  grid-column: 1 / -1;
}

.unit-status {
  margin: 0;
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.unit-locked h3 {
  color: var(--ink-soft);
}

.unit-current .unit-status {
  font-weight: 600;
  color: var(--rose);
}

.unit-complete .unit-status,
.unit-mastered .unit-status {
  font-weight: 600;
  color: var(--leaf);
}

/* Themes */

.theme {
  padding: var(--space-4) 0;
  border-bottom: 1px solid var(--rule);
}

.theme h2 {
  margin: 0 0 var(--space-1);
  font: 500 var(--step-2) / 1.2 var(--font-entry);
}

.theme.active {
  padding-left: var(--space-3);
  border-left: 3px solid var(--rose);
}

/* Progress */

.tier-bar {
  display: flex;
  height: 0.75rem;
  margin-bottom: var(--space-3);
  overflow: hidden;
  background: var(--rule);
  border-radius: 999px;
}

.tier-bar .tier-new {
  background: var(--rule);
}

.tier-bar .tier-learning {
  background: var(--amber);
}

.tier-bar .tier-young {
  background: var(--rose);
}

.tier-bar .tier-mature {
  background: var(--leaf);
}

.tiers,
.levels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
  gap: var(--space-3);
  margin: 0;
}

.tiers dt,
.levels dt {
  font-size: var(--step--1);
  color: var(--ink-soft);
}

.tiers dd {
  margin: 0;
  font: 500 var(--step-3) / 1.1 var(--font-entry);
}

.levels dd {
  margin: 0;
}

/* Matching */

.board {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-3);
}

.column h2 {
  margin-top: var(--space-3);
  font-size: var(--step-0);
  color: var(--ink-soft);
}

.column ul {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.pair {
  font-size: var(--step-0);
}

.pair.is-selected {
  border-color: var(--rose);
  box-shadow: inset 0 0 0 1px var(--rose);
}

.pair.is-matched {
  color: var(--ink-soft);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter @wordado/web test -- boot Root`
Expected: PASS — boot 6, Root 5.

- [ ] **Step 8: Look at it**

Run: `pnpm --filter @wordado/web dev` and open `http://localhost:5173` in Chrome.
Expected: the home screen in Bulgarian with "10 нови думи"; "Започнете" starts a session; the study card shows the headword large in Literata. Check the design by eye at 360 px and 1280 px wide, in light and dark mode: nothing overflows, the focus ring is visible on every control, and the rose accent appears only on the primary action and the current navigation item. Open a second tab: it shows "Wordado е отворено в друг раздел." and taking over works. Stop the server.

- [ ] **Step 9: Run the whole suite and the type check**

Run: `pnpm test && pnpm typecheck`
Expected: every package green.

- [ ] **Step 10: Commit**

```bash
git add web/src/app web/src/main.tsx web/src/styles.css web/src/router.tsx
git commit -m "feat(web): boot, the app shell and the design — the demo runs end to end"
```

---
### Task 11: Offline shell, the end-to-end run, and the documents

The app becomes an installable PWA that works offline after the first visit (spec §9.1): a Workbox service worker precaches the shell, both SQLite builds, the fonts, and the bundled sample with its audio. Then the whole demo is driven in a real Chromium by Playwright: a session by keyboard to a completed day, each mode, offline reload, a second tab and its take-over, the matching board, and an axe scan of every screen for WCAG 2.2 A and AA (spec §11.1, §13). Last, the roadmap records the 6a/6b split and the spec records the demo-storage decision.

**Files:**
- Create: `web/src/sw.ts`, `web/playwright.config.ts`, `web/e2e/demo.spec.ts`, `web/README.md`
- Modify: `web/vite.config.ts`, `web/src/main.tsx`, `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`

**Interfaces:**
- Consumes: everything above. The end-to-end run reads the `data-mode` and `data-phase` attributes of `.card` (Task 8), `.study-bar`, `.done`, and the `data-side` and `data-entry` attributes of the matching board (Task 9).
- Produces: `pnpm --filter @wordado/web e2e`, which builds, serves the build on :4173 and runs `e2e/` in Chromium. Plan 7 runs it in CI across the browser matrix. The service worker file `src/sw.ts`, to which plan 6b adds a `push` handler.

- [ ] **Step 1: Write the service worker and register it**

`web/src/sw.ts`:

```ts
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

// Workbox injects the precache list at the literal `self.__WB_MANIFEST`; the cast compiles away and leaves it intact.
const manifest = (self as unknown as { __WB_MANIFEST: (string | PrecacheEntry)[] }).__WB_MANIFEST

cleanupOutdatedCaches()
// The shell, both SQLite builds, the fonts and the bundled sample with its audio (spec §8.6, §9.1).
precacheAndRoute(manifest)
// Every in-app URL is the shell; the router takes it from there. The API is never the shell.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/v1\//] }))
```

A new service worker waits until every tab of the old one has closed, which is Workbox's default: swapping the shell under a running session could load a Worker from one build into a page from another. Plan 6b adds the "a new version is ready" prompt.

In `web/vite.config.ts`, add the import:

```ts
import { VitePWA } from 'vite-plugin-pwa'
```

and add the plugin after `samplePack(SAMPLE_DIR)` in `plugins`:

```ts
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      injectRegister: false,
      manifest: {
        name: 'Wordado',
        short_name: 'Wordado',
        description: 'Learn English words, a few minutes a day, online or off.',
        lang: 'bg',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f7fb',
        theme_color: '#1d2b53',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      injectManifest: {
        // A classic script, so every browser can register it.
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg,json,pack,m4a,webmanifest}'],
        // The asynchronous SQLite build is about 2.3 MB.
        maximumFileSizeToCacheInBytes: 4_000_000,
      },
    }),
```

In `web/src/main.tsx`, after `void boot.start()`:

```ts
// Offline after the first visit (spec §9.1). Not in development, where it would cache the dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
}
```

Run: `pnpm --filter @wordado/web build`
Expected: the PWA plugin reports `mode injectManifest` and about 80 precache entries (about 4.5 MB); `dist/sw.js` and `dist/manifest.webmanifest` exist.

- [ ] **Step 2: Configure Playwright**

`web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure' },
  // Chromium only here; plan 7 runs the browser matrix of spec §13.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 3: Write the end-to-end run**

Every Playwright test runs in a fresh browser context, so each starts with empty storage — OPFS included — as a first visit does.

`web/e2e/demo.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ context }) => {
  // English, so the assertions read plainly; the Bulgarian default is covered by the unit suite.
  await context.addInitScript(() => {
    if (localStorage.getItem('wordado.locale') === null) localStorage.setItem('wordado.locale', 'en')
  })
})

const heading = (page: Page) => page.getByRole('heading', { level: 1 })

/** Answers the item on screen by keyboard, as a learner would (spec §11.1); returns its mode. */
async function answer(page: Page): Promise<string> {
  const prompt = page.locator('.card[data-phase="prompt"]')
  await expect(prompt).toBeVisible()
  const mode = (await prompt.getAttribute('data-mode'))!
  const before = Number(((await page.locator('.study-bar p').textContent()) ?? '0').split(' ')[0])
  if (mode === 'flashcard') {
    await page.keyboard.press('Space')
    await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
    await page.keyboard.press('3')
  } else {
    await page.keyboard.press('1')
    await expect(page.getByRole('button', { name: 'Continue' })).toBeFocused()
    await page.keyboard.press('Enter')
  }
  await expect(page.locator('.study-bar p', { hasText: new RegExp(`^${before + 1} done`) }).or(page.locator('.done'))).toBeVisible()
  return mode
}

async function studyNew(page: Page, count: number): Promise<void> {
  await page.goto('/study')
  for (let i = 0; i < count; i += 1) await answer(page)
  await page.getByRole('button', { name: 'Stop for now' }).click()
  await expect(page.locator('.done')).toBeVisible()
}

async function expectAccessible(page: Page): Promise<void> {
  // Past the card's entrance animation, so colours are measured at rest.
  await page.waitForTimeout(250)
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([])
}

test('studies the demo by keyboard from the first visit to a completed day', async ({ page }) => {
  await page.goto('/')
  await expect(heading(page)).toHaveText('10 new words')
  await page.getByRole('link', { name: 'Start studying' }).click()
  for (let i = 0; i < 40 && !(await page.locator('.done').isVisible()); i += 1) await answer(page)
  await expect(heading(page)).toHaveText('Session complete')
  await expect(page.getByText('Today counts toward your streak.')).toBeVisible()
  await page.getByRole('link', { name: 'Back to today' }).click()
  await expect(heading(page)).toHaveText('Nothing left for today.')
  await expect(page.getByText('1-day streak Today counts.')).toBeVisible()
})

for (const mode of ['flashcard', 'multiple_choice', 'listening_select']) {
  test(`answers a ${mode} item by keyboard`, async ({ page }) => {
    await page.goto(`/study?mode=${mode}`)
    await expect(page.locator('.card')).toHaveAttribute('data-mode', mode)
    expect(await answer(page)).toBe(mode)
  })
}

test('keeps progress, and works offline after the first visit', async ({ page, context }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await studyNew(page, 3)
  await context.setOffline(true)
  await page.goto('/')
  await expect(heading(page)).toHaveText('7 new words')
  await page.goto('/path')
  await expect(page.getByText('3 of 20 started')).toBeVisible()
})

test('a second tab says Wordado is open elsewhere, and can take over', async ({ page, context }) => {
  await page.goto('/')
  await expect(heading(page)).toHaveText('10 new words')
  const second = await context.newPage()
  await second.goto('/')
  await expect(heading(second)).toHaveText('Wordado is open in another tab.')
  await second.getByRole('button', { name: 'Use Wordado here' }).click()
  await expect(heading(second)).toHaveText('10 new words')
  await expect(heading(page)).toHaveText('Wordado is open in another tab.')
})

test('plays a matching board once five words are known', async ({ page }) => {
  await studyNew(page, 5)
  await page.goto('/practice/matching')
  const left = page.locator('[data-side="left"] button')
  await expect(left).toHaveCount(5)
  for (const entry of await left.evaluateAll((buttons) => buttons.map((b) => (b as HTMLElement).dataset.entry!))) {
    await page.locator(`[data-side="left"] button[data-entry="${entry}"]`).click()
    await page.locator(`[data-side="right"] button[data-entry="${entry}"]`).click()
  }
  await expect(page.getByRole('status')).toHaveText('✓ All pairs matched.')
})

test('meets WCAG 2.2 A and AA on every screen (spec §11.1)', async ({ page }) => {
  await page.goto('/')
  await expect(heading(page)).toHaveText('10 new words')
  await expectAccessible(page)

  await page.goto('/study?mode=multiple_choice')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await expectAccessible(page)
  await page.keyboard.press('1')
  await expect(page.locator('.card[data-phase="feedback"]')).toBeVisible()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'Report a problem' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expectAccessible(page)
  await page.keyboard.press('Escape')

  await page.goto('/study?mode=flashcard')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await page.keyboard.press('Space')
  await expect(page.locator('.card[data-phase="revealed"]')).toBeVisible()
  await expectAccessible(page)

  await studyNew(page, 5)
  await expectAccessible(page)
  for (const path of ['/path', '/themes', '/progress', '/practice', '/practice/matching']) {
    await page.goto(path)
    await expect(heading(page)).toBeVisible()
    await expectAccessible(page)
  }

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/study?mode=multiple_choice')
  await expect(page.locator('.card[data-phase="prompt"]')).toBeVisible()
  await expectAccessible(page)
})
```

- [ ] **Step 4: Run the end-to-end run**

Run: `pnpm --filter @wordado/web e2e`
Expected: 8 passed. A failure leaves a trace under `web/test-results/`; open it with `pnpm --filter @wordado/web exec playwright show-trace <path>`.

Add the test tools' output to the repository's `.gitignore`, after `dist/`:

```
test-results/
playwright-report/
.vitest/
```

(`.vitest/` holds the browser project's failure screenshots.)

- [ ] **Step 5: Write the package README**

`web/README.md`:

````markdown
# @wordado/web

The web client (spec §4.1): a Vite + React PWA over `client-data`, with SQLite in a Worker
(OPFS, then IndexedDB, then memory). Until plan 6b adds accounts, the app is the demo: it runs
on the bundled A1 Bulgarian sample, in its own `demo` database, and syncs nothing.

```bash
pnpm --filter @wordado/web dev        # http://localhost:5173, with /api and /v1 proxied to :8787
pnpm --filter @wordado/web test       # unit views (happy-dom) and storage (Chromium)
pnpm --filter @wordado/web e2e        # the built app in Chromium, with an axe scan
pnpm --filter @wordado/web exec playwright install chromium   # once per machine
```

The service worker exists only in a build (`pnpm build && pnpm preview`, on :4173).
````

- [ ] **Step 6: Record the split in the roadmap**

In `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`, replace the row for plan 6:

```markdown
| 6 | Web client | `web` | Vite + React PWA; wa-sqlite over OPFS with IndexedDB and in-memory fallbacks; single-tab lock; the four game modes; onboarding, demo carry-over and age gate; path, themes, dashboard and settings; Bulgarian and English interface; WCAG 2.2 AA | 4, 5 |
```

with two rows:

```markdown
| 6a | **Web client: platform and study loop** — `2026-09-24-web-platform-and-study.md` | `web`, `core`, `client-data` | Vite + React PWA; wa-sqlite over OPFS with IndexedDB and in-memory fallbacks; single-tab lock and take-over; the bundled sample and a verified audio cache; the shared study-run state machine; the four game modes; today, path, themes, progress, practice; report an error; Bulgarian and English interface; offline shell; the demo end to end in Chromium with an axe scan | 4 |
| 6b | Web client: accounts and settings | `web` | Sign-in (emailed code, Google); the age gate; demo carry-over and discard; the transport, sync lifecycle and status; settings (level, retention, limits, goal, audio, latency grading); the placement test; known and suspended words; reminders; account deletion and export; installation and update prompts; the WCAG 2.2 AA pass over its screens | 5, 6a |
```

In the same file, change plan 7's "Needs" cell from `5, 6` to `5, 6a, 6b`, and change the sentence "Phase 1a (the MVP, spec §14) is split into eight plans." to:

```markdown
Phase 1a (the MVP, spec §14) is split into eight plans; plan 6 was split again into 6a and 6b
when it was written (2026-09-24), because it was as large as plan 5.
```

- [ ] **Step 7: Record the demo-storage decision in the spec**

In `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md`, §8.6, replace:

```markdown
sample session so a prospective user can study before committing. Demo events
are held in memory only. If the learner then **creates an account** from the
demo, those events are attached to the new account — there is nothing to
merge, because a new account has no prior data. If they instead sign in to an
existing account, or leave, demo progress is discarded, and this is stated
plainly.
```

with:

```markdown
sample session so a prospective user can study before committing. Demo events
are kept on the device in a database of their own, apart from any learner's,
and are never uploaded unless an account is created; the demo survives a reload
and the redirect of a Google sign-in. If the learner then **creates an account**
from the demo, those events are attached to the new account — there is nothing
to merge, because a new account has no prior data. If they instead sign in to
an existing account, or choose to leave the demo, the demo database is deleted,
and this is stated plainly.
```

In §16, before `### Approval status`, add:

```markdown
**2026-09-24 — demo storage.** Decided by the product owner while planning the
web client (plan 6a).

- **Demo mode (§8.6):** demo answers are kept in a separate on-device database
  instead of in memory only, so that a reload or a Google sign-in redirect does
  not lose them before they can carry over. They are still never uploaded
  unless an account is created, and the database is deleted when the demo is
  discarded.
```

- [ ] **Step 8: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm --filter @wordado/web e2e`
Expected: every package green; 8 end-to-end tests pass.

- [ ] **Step 9: Commit**

```bash
git add web docs .gitignore
git commit -m "feat(web): offline shell and the demo end to end in Chromium; record the 6a/6b split and demo storage"
```

---
## Contracts this plan hands to the later plans

- **Accounts extend `Boot`** (plan 6b). `BootDeps` gains the signed-in learner and a `SyncTransport` (plan 5's `POST /v1/sync/push` and `/v1/sync/pull`, `credentials: 'include'`, any non-200 thrown). The demo stays in the file `demo`; a learner's database gets a file of its own, and `openWorkerDriver(file)` opens either. Carrying the demo over is plan 4's recipe: a `Client` over the demo's driver *with* a transport, `attachUser`, `sync()`, then open the learner's database and pull. Discarding the demo deletes its file, which needs a `deleteDatabase(file)` beside `openWorkerDriver` (OPFS: remove `demo.sqlite` and its journal from `navigator.storage.getDirectory()`; IndexedDB: `indexedDB.deleteDatabase('wordado-demo')`), run with the database closed.
- **Letting go flushes first** (plan 6b, spec §9.1). `TabLock`'s `release` is where the outbox is flushed: `Boot.release` should `await client.sync()` (bounded by a short timeout) before `client.close()`. Flush also after every run (`afterRun`) and on `visibilitychange` to hidden.
- **The in-memory fallback is online-only** (plan 6b, spec §9.1). With a transport, a `memory` backend syncs after every answer, and its banner says study needs a connection. Today's banner says only that nothing is kept.
- **Latency grading becomes a setting** (plan 6b, spec §11.1). `StudyRun` and `MatchingRun` pass `{ latencyGrading: true }` to `gradeAnswer`; 6b adds `latencyGrading` to `core`'s `Settings` (validated like the others, default true) and passes `settings.latencyGrading`. The same plan adds the settings screen for level, retention, the new-word limit, the review cap, the daily goal and audio — every field already validated by `validateSettingsPatch` — and the placement test (`placementProgress`, `nextPlacementWords`).
- **Packs beyond the sample** (plans 6b, 7). `Boot` installs from `SAMPLE_MANIFEST_URL` at launch only. 6b adds the CDN manifest (a second `fetchManifest`/`packFetcher` pair, and an `AudioStore` per manifest, or one keyed by manifest URL), the periodic check of spec §9.3, the "update the app" message for `InstallReport.appUpdateNeeded`, and the whole-level audio download over Wi-Fi.
- **The service worker grows** (plan 6b). `src/sw.ts` gains the `push` handler of plan 5's contract (fetch `GET /v1/reminder?tz=<offset>&lang=<bg|en>` with credentials, show `{ title, body }`) and a `message` handler for "skip waiting", which the new-version prompt sends. iOS installation needs PNG icons (`apple-touch-icon`, 180 px), which the manifest does not have yet.
- **Every new screen joins the accessibility scan** (plan 6b). `e2e/demo.spec.ts`'s `expectAccessible` runs axe with the WCAG 2.2 A and AA tags; 6b's screens are added to that test, in light and dark.
- **The browser matrix** (plan 7, spec §13). CI installs Chromium for the web suite's browser project (`playwright install --with-deps chromium`) and runs `pnpm --filter @wordado/web e2e` across desktop Chrome, Firefox and Safari (WebKit) and mobile Chrome and Safari. Where a browser lacks OPFS the same run exercises the IndexedDB path; add "storage cleared between sessions" (a new context with the same user) and "no OPFS" (a WebKit or Firefox project) as spec §13 asks.
- **Deploying the web app** (plan 7). The build is static assets for Workers static assets, with single-page-application fallback for in-app URLs; `/sw.js` must be served uncached, as must `manifest.webmanifest`; `/content/sample/` is part of the build. No cross-origin isolation headers are needed (no `SharedArrayBuffer`).
- **The interface strings need a native reader** (plan 8). `web/src/i18n/bg.ts` was written without one, like the sample pack's Bulgarian (plan 3).

Left for later plans: telling a reporter that their report was fixed (spec §8.10; needs the pipeline's triage, plan 8); known and suspended words in the study view and the path (plan 6b); the onboarding question that picks a first theme (plan 6b, spec §8.6).
