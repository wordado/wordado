# Client Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `@wordado/client-data`: the package web and mobile share, which owns the local SQLite schema and migrations, installs corpus packs, records answers into an append-only local log, derives review state with `core`, syncs through an outbox with the rebase rule, and exposes the result to React through one store.

**Architecture:** `client-data` talks to SQLite through a five-method `SqlDriver` and knows nothing about which SQLite it is; the suites run against Node's built-in SQLite in memory. The local database holds only what the server cannot give back: this device's events until the server's marks cover them, pending document patches, and the staged pack. Everything derived — current review state, today's counts, the session plan, progress — is recomputed in memory as `rebase(serverSnapshot, marks, localEvents)` and friends, so a pull can never roll back an answer and no derived number is ever stored. The sync wire format is a set of plain types in `core`, which plan 5's server implements; the tests here drive the engine against a fake server built from `core`'s own stamping and replay rules.

**Tech Stack:** Node 24 (`node:sqlite` for the in-process driver), pnpm 12, TypeScript 7, Vitest 5, React 19 (peer; `useSyncExternalStore`), `@testing-library/react` + `happy-dom` for the hook tests only. `core` gains no dependency.

**Spec:** `docs/superpowers/specs/2026-09-20-vocabulary-learning-app-design.md` — this plan implements §4.1 (`client-data` and `SqlDriver`), §4.3 (min sync version, the rebase rule), §5.1 and §9.3 (pack download, checksum, swap at next session), §6.1–§6.2 (local tables), §7.4 (session inputs, flags), §8.3–§8.4 (progress inputs, `day_complete` emission), §8.7 (provisional XP), §8.8 (cached entitlement), §8.10 (reports as documents), §9.1 (local storage), §9.2 (outbox, push pages, pull contents, versioned and server-owned documents) and the `client-data` tests of §13. It is plan 4 of 8; see `docs/superpowers/plans/2026-09-21-phase-1a-roadmap.md`. Plans 1–3 each hand this plan contracts, listed under "Contracts this plan honours" below.

## Global Constraints

- `core` stays pure (spec §4.1): the two modules this plan adds there (`settings.ts`, `syncProtocol.ts`) are types and validation only.
- `client-data` uses no platform API directly. The clock, time-zone offset, UUIDs, randomness and SHA-256 arrive through `ClientEnv`; SQLite through `SqlDriver`; the network through `SyncTransport`. The only Node imports allowed are in `src/drivers/nodeSqlite.ts` and `src/testing/`, which the web bundle never imports. `tsconfig` includes the DOM lib for `TextDecoder` and the hook tests; that is not a licence to call `fetch`, `localStorage` or `document` in `src/`.
- Events are immutable and append-only (spec §9.2). The local log is never edited; rows are deleted only once the server's marks cover them.
- Derived state is never stored (spec §6.2, §4.3). `review_state` holds the server's snapshot exactly as pulled; the current state is always `rebase(snapshot, marks, localEvents)`.
- Clients never compute authoritative XP (spec §10). Offline XP is provisional and says so.
- A completed day is recorded once, when the condition is first met, as a `day_complete` row (spec §8.4); nothing re-derives it.
- The schema is versioned from day one. `SCHEMA_VERSION` starts at 1; every later change is a migration, and the suite migrates from every shipped schema (spec §13).
- Settings and the time-zone offset are validated before they reach `core` (roadmap contract): `clientTzOffsetMin` is a finite integer in −720…+840; the new-word limit 0–30; the review cap 0–1000; the daily goal null or ≥ 1.
- Sync JSON is `camelCase` and mirrors `core`'s in-memory types field for field, because both ends are `core` consumers (pack JSON stays `snake_case`, as plan 3 decided for a hand-edited, long-lived format).
- Code style: no semicolons, single quotes, 2-space indent, named exports only, `readonly` on every interface field. Each new module has one test file beside it.
- Every task ends with `pnpm test` and `pnpm typecheck` green from the repository root.

## Tuning values settled here (spec §15)

| Item | Value | Where |
|---|---|---|
| Sync protocol version / page size | `1` / 500 events per page | `core/src/syncProtocol.ts` |
| Retry backoff | 1 s doubling to a 5 min ceiling, ×(0.5–1.5) jitter | `client-data/src/sync.ts` |
| Review cap maximum | 1 000 | `core/src/settings.ts` |
| Time-zone offset range | −720…+840 minutes, integer | `core/src/settings.ts` |
| Local schema version | 1 | `client-data/src/schema.ts` |
| Document types | `settings`, `word_flag`, `unit_unlock`, `word_alias`, `entitlement`, `content_report` | `client-data/src/documentTypes.ts` |

## Decisions recorded here

- **The corpus lives in memory; SQLite keeps the pack bytes.** A pack is a few megabytes of JSON that every session needs whole (session composition, distractors, the headword index), so the client keeps `loadCorpus(packs)` in memory and stores each pack's JSON in one row. Relational corpus tables would be a second copy with no reader yet; Phase 2's personal-dictionary search can add an index then.
- **The server's snapshot is stored; the current state is derived.** `review_state` holds what the last pull sent. Local events are replayed on top at load and after every answer (`deriveStates`), which keeps one code path for online, offline and demo, and makes "a pull never rolls back an answer" a property of the data rather than of careful bookkeeping.
- **Pending document edits are one patch per document.** Successive local edits merge into a single pending `DocumentPatch` whose `baseVersion` is the version the first edit was made against; the fields are applied optimistically to the stored copy. A pull replaces the stored copy with the server's and re-applies the pending fields on top; a push clears the patch with the server's result.
- **Push page 0 carries everything small.** `day_complete` events and document writes travel on the first page of a push; later pages carry events only. One `pushId` and one `clientNow` cover all pages (spec §9.2 step 1).
- **The fake server is shipped, not hidden in a test.** `src/testing/fakeServer.ts` implements `SyncTransport` with `openPushWindow`, `stampEvents`, `replay`, `summarizeDays`, `applyPatch` and `computeXp` from `core`. It is what the sync tests drive, and plan 5 has it as the executable statement of the endpoint contract.
- **`upgrade_required` stops sync until the app restarts.** The app's protocol version cannot change without a reload, so once the server refuses it, the engine sets `upgradeRequired` and does nothing more; the outbox stays intact (spec §4.3).
- **Hooks are selectors over one external store.** `Client` owns a `Store<ClientSnapshot>`; the hooks are `useSyncExternalStore` one-liners, so the React surface is tiny and everything testable lives below it.
- **Demo mode needs nothing special here.** A `Client` over an in-memory driver with no user is the demo; attaching a user later leaves every row in place, and the first push presents the device as never seen, which spec §9.2 step 3 covers. Plan 6 decides when to discard it.

## File Structure

```
core/src/
  settings.ts        Settings, DEFAULT_SETTINGS, validateSettingsPatch, isValidTzOffset   (new)  §7.4, §8.4
  syncProtocol.ts    wire types: PushPage, PushResponse, PullRequest, PullResponse …       (new)  §9.2, §4.3
  index.ts           re-exports both                                                       (modify)
client-data/
  package.json, tsconfig.json, vitest.config.ts
  src/
    index.ts           re-exports the public surface (not drivers/, not testing/)
    driver.ts          SqlDriver, SqlValue, SqlRow
    database.ts        Database: serialised transactions over a driver
    env.ts             ClientEnv
    schema.ts          SCHEMA_VERSION, SCHEMA_V1, SHIPPED_SCHEMAS, MIGRATIONS, migrate
    meta.ts            meta table: getMeta, setMeta, ensureDevice, nextDeviceSeq
    packs.ts           installPacks (verify, validate, stage), activateStagedPacks, loadActiveCorpus
    documents.ts       StoredDocument, local patches, server copies, pending writes
    documentTypes.ts   typed readers and writers: settings, flags, unlocks, entitlement, reports
    learner.ts         Learner: snapshot + marks + local events → derived state; appendAnswer; day complete
    study.ts           StudyContext → SessionPlan, DayCompleteInput, ProgressView
    sync.ts            SyncTransport, SyncStatus, syncOnce with paging, pull apply, backoff
    client.ts          Client facade over everything above, with a Store<ClientSnapshot>
    store.ts           createStore
    react.ts           ClientProvider, useClient, useClientSnapshot, useSessionPlan, useProgress, useSyncStatus
    drivers/nodeSqlite.ts   the in-process driver (Node only)
    testing/testEnv.ts      deterministic ClientEnv
    testing/fakeServer.ts   SyncTransport built from core's server rules
    *.test.ts
```

Dependency order: `driver` → `database` → `schema`, `meta` → `packs`, `documents` → `documentTypes` → `learner` → `study` → `sync` → `client` → `react`.

## Contracts this plan honours

From the roadmap and plan 2: `clientTzOffsetMin` validated at ingest; `today` computed once per call as `localDay(now, offset)`; `reviewsDoneToday` is `dayCounts(...).reviewsDone` from one helper; settings validated before `core`; an outbox event's `effectiveTs` is its `clientTs`; today's counts after a pull are the pulled `DaySummary` plus `dayCounts(classifyEvents(events above the marks, { prior }))`; offline XP is provisional; `ReviewState` is stored whole (both plan-2 fields included); the daily summary is merged with `mergeSummaries` before `retentionRate`.
From plan 3: verify `sha256` and `bytes` before `validatePack`; `unsupported_schema` keeps the installed pack; URLs resolve against the manifest's URL (the fetcher's job); the installed-packs table stores `pack_id`, `corpus_version`, `schema_version`, `sha256`; a fetched pack is swapped in at the next session start; `loadCorpus` feeds `PathContext` and `DistractorContext`; `themeEntries` is `collectionNew`; audio availability is per item through `entryClips`.

---

### Task 1: Package, `SqlDriver`, `Database` and the Node driver

**Files:**
- Modify: `pnpm-workspace.yaml`
- Create: `client-data/package.json`, `client-data/tsconfig.json`, `client-data/vitest.config.ts`
- Create: `client-data/src/driver.ts`, `client-data/src/database.ts`, `client-data/src/env.ts`, `client-data/src/drivers/nodeSqlite.ts`, `client-data/src/testing/testEnv.ts`, `client-data/src/index.ts`
- Test: `client-data/src/database.test.ts`

**Interfaces:**
- Produces, from `driver.ts`: `SqlValue = string | number | null | Uint8Array`; `SqlRow`; `SqlDriver { exec(sql), run(sql, params?), all<T>(sql, params?), close() }`.
- Produces, from `database.ts`: `Database` with `driver`, `exec`, `run`, `all`, `transaction(fn: (tx: SqlDriver) => Promise<T>)`, `close`.
- Produces, from `env.ts`: `ClientEnv { now(), tzOffsetMin(), uuid(), rng, sha256(bytes) }`.
- Produces, from `drivers/nodeSqlite.ts`: `nodeSqliteDriver(path?: string): SqlDriver`.
- Produces, from `testing/testEnv.ts`: `TestEnv extends ClientEnv { clock: { now, tzOffsetMin }, advance(ms) }`; `testEnv(start?, tzOffsetMin?, seed?)`.

- [ ] **Step 1: Scaffold the package**

`pnpm-workspace.yaml` — add the package:

```yaml
packages:
  - core
  - pipeline
  - client-data

# esbuild (via tsx and vitest) runs from its optional platform package; its postinstall is not needed.
allowBuilds:
  esbuild: false
```

`client-data/package.json`:

```json
{
  "name": "@wordado/client-data",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json"
  },
  "dependencies": {
    "@wordado/core": "workspace:*"
  },
  "peerDependencies": {
    "react": "^19.0.0"
  },
  "devDependencies": {
    "@testing-library/dom": "^10.4.0",
    "@testing-library/react": "^16.3.0",
    "@types/node": "^24.0.0",
    "@types/react": "^19.0.0",
    "happy-dom": "^20.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  }
}
```

`client-data/tsconfig.json`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node"],
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

`client-data/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
```

Run: `pnpm install && pnpm install --frozen-lockfile`
Expected: both exit 0; `client-data` linked; React, testing-library and happy-dom added to the lockfile. If pnpm writes a new `allowBuilds` placeholder into `pnpm-workspace.yaml`, resolve it to `false` and rerun.

- [ ] **Step 2: Write the failing test**

`client-data/src/database.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'

function open(): Database {
  return new Database(nodeSqliteDriver())
}

describe('Database', () => {
  it('runs statements and reads rows back', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, blob BLOB)')
    await db.run('INSERT INTO t (name, blob) VALUES (?, ?)', ['a', new Uint8Array([1, 2, 3])])
    const rows = await db.all<{ id: number; name: string; blob: Uint8Array }>('SELECT * FROM t')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.name).toBe('a')
    expect([...rows[0]!.blob]).toEqual([1, 2, 3])
    await db.close()
  })

  it('commits a transaction and returns its result', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    const result = await db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (1)')
      await tx.run('INSERT INTO t VALUES (2)')
      return 'done'
    })
    expect(result).toBe('done')
    expect(await db.all('SELECT count(*) AS c FROM t')).toEqual([{ c: 2 }])
  })

  it('rolls back when the function throws, and rethrows', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    await expect(
      db.transaction(async (tx) => {
        await tx.run('INSERT INTO t VALUES (1)')
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await db.all('SELECT count(*) AS c FROM t')).toEqual([{ c: 0 }])
    // The database is usable afterwards.
    await db.transaction((tx) => tx.run('INSERT INTO t VALUES (2)'))
    expect(await db.all('SELECT n FROM t')).toEqual([{ n: 2 }])
  })

  it('serialises transactions in call order', async () => {
    const db = open()
    await db.exec('CREATE TABLE t (n INTEGER)')
    const order: number[] = []
    const first = db.transaction(async (tx) => {
      await new Promise((r) => setTimeout(r, 20))
      await tx.run('INSERT INTO t VALUES (1)')
      order.push(1)
    })
    const second = db.transaction(async (tx) => {
      await tx.run('INSERT INTO t VALUES (2)')
      order.push(2)
    })
    await Promise.all([first, second])
    expect(order).toEqual([1, 2])
    expect(await db.all('SELECT n FROM t ORDER BY rowid')).toEqual([{ n: 1 }, { n: 2 }])
  })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test`
Expected: FAIL — cannot resolve `./database`.

- [ ] **Step 4: Write the driver interface, the database, the env, and the Node driver**

`client-data/src/driver.ts`:

```ts
export type SqlValue = string | number | null | Uint8Array
export type SqlRow = Record<string, SqlValue>

/**
 * The one thing web and mobile implement differently (spec §4.1): one SQLite
 * connection, statements run in call order, parameters positional.
 */
export interface SqlDriver {
  /** One or more statements with no result: DDL, PRAGMA, BEGIN/COMMIT. */
  exec(sql: string): Promise<void>
  run(sql: string, params?: readonly SqlValue[]): Promise<void>
  all<T extends object = SqlRow>(sql: string, params?: readonly SqlValue[]): Promise<T[]>
  close(): Promise<void>
}
```

`client-data/src/database.ts`:

```ts
import type { SqlDriver, SqlRow, SqlValue } from './driver'

/** A driver plus serialised write transactions. Everything in `client-data` goes through one of these. */
export class Database {
  private chain: Promise<unknown> = Promise.resolve()

  constructor(readonly driver: SqlDriver) {}

  exec(sql: string): Promise<void> {
    return this.driver.exec(sql)
  }

  run(sql: string, params: readonly SqlValue[] = []): Promise<void> {
    return this.driver.run(sql, params)
  }

  all<T extends object = SqlRow>(sql: string, params: readonly SqlValue[] = []): Promise<T[]> {
    return this.driver.all<T>(sql, params)
  }

  /**
   * Runs `fn` inside BEGIN IMMEDIATE … COMMIT, rolled back if it throws.
   * Transactions run one at a time in call order. Do not nest: a transaction
   * started inside another would wait for it forever.
   */
  transaction<T>(fn: (tx: SqlDriver) => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.driver.exec('BEGIN IMMEDIATE')
      try {
        const result = await fn(this.driver)
        await this.driver.exec('COMMIT')
        return result
      } catch (err) {
        await this.driver.exec('ROLLBACK')
        throw err
      }
    }
    const next = this.chain.then(run, run)
    this.chain = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  close(): Promise<void> {
    return this.driver.close()
  }
}
```

`client-data/src/env.ts`:

```ts
import type { Rng } from '@wordado/core'

/** Everything platform-specific that `client-data` needs, passed in by the app. */
export interface ClientEnv {
  /** Epoch milliseconds. */
  now(): number
  /** Minutes to ADD to UTC for local time now (UTC+2 → 120): the negation of getTimezoneOffset(). */
  tzOffsetMin(): number
  /** A v4 UUID. */
  uuid(): string
  readonly rng: Rng
  /** Lowercase hex SHA-256, for pack verification (Web Crypto on the web). */
  sha256(bytes: Uint8Array): Promise<string>
}
```

`client-data/src/drivers/nodeSqlite.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import type { SqlDriver, SqlValue } from '../driver'

/**
 * The in-process driver the suites run against (spec §4.1, §13). Node only:
 * the web driver (wa-sqlite over OPFS) is plan 6's, and nothing under `src/`
 * outside `drivers/` and `testing/` may import this.
 */
export function nodeSqliteDriver(path = ':memory:'): SqlDriver {
  const db = new DatabaseSync(path)
  db.exec('PRAGMA foreign_keys = ON')
  return {
    exec: async (sql) => {
      db.exec(sql)
    },
    run: async (sql, params: readonly SqlValue[] = []) => {
      db.prepare(sql).run(...params)
    },
    all: async <T extends object>(sql: string, params: readonly SqlValue[] = []) =>
      db.prepare(sql).all(...params) as unknown as T[],
    close: async () => {
      db.close()
    },
  }
}
```

`client-data/src/testing/testEnv.ts`:

```ts
import { createHash } from 'node:crypto'
import { seededRng } from '@wordado/core'
import type { ClientEnv } from '../env'

export interface TestClock {
  now: number
  tzOffsetMin: number
}

export interface TestEnv extends ClientEnv {
  readonly clock: TestClock
  advance(ms: number): void
}

/** A deterministic environment: a settable clock, counted UUIDs, a seeded rng, a real SHA-256. */
export function testEnv(start = Date.UTC(2026, 0, 5, 10), tzOffsetMin = 120, seed = 1): TestEnv {
  const clock: TestClock = { now: start, tzOffsetMin }
  let n = 0
  return {
    clock,
    advance: (ms) => {
      clock.now += ms
    },
    now: () => clock.now,
    tzOffsetMin: () => clock.tzOffsetMin,
    uuid: () => {
      n += 1
      return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
    },
    rng: seededRng(seed),
    sha256: async (bytes) => createHash('sha256').update(bytes).digest('hex'),
  }
}
```

`client-data/src/index.ts` (grows with every task; drivers and testing are deliberately not re-exported):

```ts
export * from './driver'
export * from './database'
export * from './env'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `database.test.ts` has 4 passing tests.

- [ ] **Step 6: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml client-data
git commit -m "feat(client-data): package, SqlDriver, serialised transactions, Node driver

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schema, migrations and the meta table

**Files:**
- Create: `client-data/src/schema.ts`, `client-data/src/meta.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/schema.test.ts`

**Interfaces:**
- Consumes: `Database`, `SqlDriver` (Task 1); `ClientEnv`.
- Produces, from `schema.ts`: `SCHEMA_VERSION = 1`; `SCHEMA_V1: string`; `SHIPPED_SCHEMAS: Record<number, string>`; `Migration { version, up(tx) }`; `MIGRATIONS`; `migrate(db): Promise<{ from: number; to: number }>`; `tableNames(db): Promise<string[]>`.
- Produces, from `meta.ts`: `getMeta(driver, key): Promise<string | null>`; `setMeta(driver, key, value)`; `ensureDevice(db, env): Promise<string>`; `nextDeviceSeq(tx): Promise<number>`; `getUserId(db)`, `setUserId(tx, userId)`.

The tables are the local half of spec §6: this device's events (`review_event`, the outbox being the unpushed rows), the server's snapshot (`review_state`, `device_mark`, `day_summary`), the `day_complete` dates, documents with a pending patch, and packs. `next_device_seq` lives in `meta` so that the per-device counter survives a restart (spec §6.2).

- [ ] **Step 1: Write the failing test**

`client-data/src/schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { ensureDevice, getMeta, getUserId, nextDeviceSeq, setMeta, setUserId } from './meta'
import { MIGRATIONS, migrate, SCHEMA_VERSION, SHIPPED_SCHEMAS, tableNames } from './schema'
import { testEnv } from './testing/testEnv'

const EXPECTED_TABLES = ['day_complete', 'day_summary', 'device_mark', 'document', 'meta', 'pack', 'review_event', 'review_state']

describe('migrate', () => {
  it('brings a fresh database to the current schema', async () => {
    const db = new Database(nodeSqliteDriver())
    expect(await migrate(db)).toEqual({ from: 0, to: SCHEMA_VERSION })
    expect(await tableNames(db)).toEqual(EXPECTED_TABLES)
    expect(await getMeta(db.driver, 'schema_version')).toBe(String(SCHEMA_VERSION))
  })

  it('is a no-op the second time', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    expect(await migrate(db)).toEqual({ from: SCHEMA_VERSION, to: SCHEMA_VERSION })
  })

  it('refuses a database newer than this build', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    await setMeta(db.driver, 'schema_version', String(SCHEMA_VERSION + 1))
    await expect(migrate(db)).rejects.toThrow(/newer/)
  })

  it('migrates from every shipped schema to the current one (spec §13)', async () => {
    for (const [version, ddl] of Object.entries(SHIPPED_SCHEMAS)) {
      const db = new Database(nodeSqliteDriver())
      await db.exec(ddl)
      await setMeta(db.driver, 'schema_version', version)
      expect(await migrate(db)).toEqual({ from: Number(version), to: SCHEMA_VERSION })
      expect(await tableNames(db)).toEqual(EXPECTED_TABLES)
    }
    expect(MIGRATIONS.map((m) => m.version)).toEqual(Object.keys(SHIPPED_SCHEMAS).map(Number))
  })
})

describe('meta', () => {
  it('mints one device id and keeps it', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    const env = testEnv()
    const id = await ensureDevice(db, env)
    expect(id).toBe('00000000-0000-4000-8000-000000000001')
    expect(await ensureDevice(db, env)).toBe(id)
  })

  it('hands out device sequence numbers from 1, persisted', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    const a = await db.transaction((tx) => nextDeviceSeq(tx))
    const b = await db.transaction((tx) => nextDeviceSeq(tx))
    expect([a, b]).toEqual([1, 2])
    expect(await getMeta(db.driver, 'next_device_seq')).toBe('3')
  })

  it('stores the user once attached', async () => {
    const db = new Database(nodeSqliteDriver())
    await migrate(db)
    expect(await getUserId(db)).toBeNull()
    await db.transaction((tx) => setUserId(tx, 'user-1'))
    expect(await getUserId(db)).toBe('user-1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- schema.test`
Expected: FAIL — cannot resolve `./meta`.

- [ ] **Step 3: Write `meta.ts` and `schema.ts`**

`client-data/src/meta.ts`:

```ts
import type { Database } from './database'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

export async function getMeta(driver: SqlDriver, key: string): Promise<string | null> {
  const rows = await driver.all<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key])
  return rows[0]?.value ?? null
}

export async function setMeta(driver: SqlDriver, key: string, value: string): Promise<void> {
  await driver.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value', [key, value])
}

/** The device's identity (spec §6.2). A browser whose storage was cleared becomes a new device. */
export async function ensureDevice(db: Database, env: ClientEnv): Promise<string> {
  const existing = await getMeta(db.driver, 'device_id')
  if (existing !== null) return existing
  const id = env.uuid()
  await db.transaction(async (tx) => {
    if ((await getMeta(tx, 'device_id')) === null) await setMeta(tx, 'device_id', id)
  })
  return (await getMeta(db.driver, 'device_id')) ?? id
}

/** The per-device monotonic counter (spec §6.2). Call inside the transaction that stores the event. */
export async function nextDeviceSeq(tx: SqlDriver): Promise<number> {
  const seq = Number((await getMeta(tx, 'next_device_seq')) ?? '1')
  await setMeta(tx, 'next_device_seq', String(seq + 1))
  return seq
}

export async function getUserId(db: Database): Promise<string | null> {
  return getMeta(db.driver, 'user_id')
}

export async function setUserId(tx: SqlDriver, userId: string): Promise<void> {
  await setMeta(tx, 'user_id', userId)
}
```

`client-data/src/schema.ts`:

```ts
import type { Database } from './database'
import type { SqlDriver } from './driver'
import { getMeta, setMeta } from './meta'

/** Bumped with every migration. The suite migrates from every version in SHIPPED_SCHEMAS (spec §13). */
export const SCHEMA_VERSION = 1

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE pack (
  pack_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'staged')),
  corpus_version INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (pack_id, status)
);
CREATE TABLE review_event (
  review_id TEXT PRIMARY KEY,
  word_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  direction TEXT NOT NULL,
  grade INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  practice INTEGER NOT NULL,
  client_ts INTEGER NOT NULL,
  client_tz_offset_min INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_seq INTEGER NOT NULL,
  scheduler_version TEXT NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX review_event_device ON review_event (device_id, device_seq);
CREATE INDEX review_event_outbox ON review_event (pushed);
CREATE TABLE review_state (
  word_id TEXT PRIMARY KEY,
  state TEXT NOT NULL
);
CREATE TABLE device_mark (
  device_id TEXT PRIMARY KEY,
  device_seq INTEGER NOT NULL
);
CREATE TABLE day_summary (
  day INTEGER PRIMARY KEY,
  reviews INTEGER NOT NULL,
  successes INTEGER NOT NULL,
  new_words INTEGER NOT NULL,
  answered INTEGER NOT NULL,
  practice INTEGER NOT NULL
);
CREATE TABLE day_complete (
  local_date TEXT PRIMARY KEY,
  rule_version TEXT NOT NULL,
  client_ts INTEGER NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE document (
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('versioned', 'server_owned')),
  version INTEGER NOT NULL,
  fields TEXT NOT NULL,
  field_versions TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  stale_after INTEGER,
  patch TEXT,
  PRIMARY KEY (type, key)
);
`

/** Every schema a build has shipped with, by version, so migrations from each can be tested. */
export const SHIPPED_SCHEMAS: Readonly<Record<number, string>> = { 1: SCHEMA_V1 }

export interface Migration {
  readonly version: number
  up(tx: SqlDriver): Promise<void>
}

export const MIGRATIONS: readonly Migration[] = [{ version: 1, up: (tx) => tx.exec(SCHEMA_V1) }]

/** Brings the database to SCHEMA_VERSION, one migration per transaction. */
export async function migrate(db: Database): Promise<{ from: number; to: number }> {
  await db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const from = Number((await getMeta(db.driver, 'schema_version')) ?? '0')
  if (from > SCHEMA_VERSION) throw new Error(`The database is schema ${from}, newer than this build reads (${SCHEMA_VERSION})`)
  for (const migration of MIGRATIONS) {
    if (migration.version <= from) continue
    await db.transaction(async (tx) => {
      await migration.up(tx)
      await setMeta(tx, 'schema_version', String(migration.version))
    })
  }
  return { from, to: SCHEMA_VERSION }
}

export async function tableNames(db: Database): Promise<string[]> {
  const rows = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
  return rows.map((r) => r.name)
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './schema'
export * from './meta'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `schema.test.ts` has 7 passing tests.

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): local schema v1, migrations and the meta table

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: `core` additions: settings validation and the sync wire types

**Files:**
- Create: `core/src/settings.ts`, `core/src/syncProtocol.ts`
- Modify: `core/src/index.ts`
- Test: `core/src/settings.test.ts`

**Interfaces:**
- Consumes: `CefrLevel`, `CEFR_LEVELS`, `RETENTION_TARGETS`, `RetentionSetting`, `DEFAULT_NEW_WORD_LIMIT`, `MAX_NEW_WORD_LIMIT`, `DEFAULT_REVIEW_CAP`, `ReviewEvent`, `ReviewState`, `DaySummary`, `DocumentPatch`, `DocumentClass`.
- Produces, from `settings.ts`: `Settings { declaredLevel, newWordLimit, reviewCap, retention, dailyGoal, activeTheme, audio }`; `DEFAULT_SETTINGS`; `MAX_REVIEW_CAP = 1000`; `SettingsValidation`; `validateSettingsPatch(patch: Record<string, unknown>): SettingsValidation`; `TZ_OFFSET_MIN = -720`, `TZ_OFFSET_MAX = 840`; `isValidTzOffset(minutes: number): boolean`.
- Produces, from `syncProtocol.ts`: `SYNC_PROTOCOL_VERSION = 1`; `SYNC_PAGE_SIZE = 500`; `WireDayComplete { localDate: string; ruleVersion }`; `DocumentWrite { type, key, patch }`; `WireDocument { type, key, class, version, fields, fieldVersions, deleted, staleAfter }`; `PushPage`; `PushResponse`; `PullRequest`; `PullResponse`; `DocumentRejection`.

`syncProtocol.ts` has no behaviour; the settings test is the task's test. The wire types are the contract plan 5 implements and `testing/fakeServer.ts` (Task 8) executes.

- [ ] **Step 1: Write the failing test**

`core/src/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, isValidTzOffset, MAX_REVIEW_CAP, validateSettingsPatch } from './settings'
import { MAX_NEW_WORD_LIMIT } from './session'

function errorsOf(patch: Record<string, unknown>): string[] {
  const result = validateSettingsPatch(patch)
  return result.ok ? [] : [...result.errors]
}

describe('validateSettingsPatch', () => {
  it('accepts a valid partial patch and returns only the named fields', () => {
    const result = validateSettingsPatch({ newWordLimit: 15, dailyGoal: null, activeTheme: 'food' })
    expect(result).toEqual({ ok: true, fields: { newWordLimit: 15, dailyGoal: null, activeTheme: 'food' } })
  })

  it('keeps every value inside the bounds core assumes', () => {
    expect(errorsOf({ newWordLimit: -1 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: MAX_NEW_WORD_LIMIT + 1 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: 2.5 })).toEqual(['newWordLimit'])
    expect(errorsOf({ newWordLimit: Number.NaN })).toEqual(['newWordLimit'])
    expect(errorsOf({ reviewCap: MAX_REVIEW_CAP + 1 })).toEqual(['reviewCap'])
    expect(errorsOf({ reviewCap: 0 })).toEqual([])
    expect(errorsOf({ retention: 'extreme' })).toEqual(['retention'])
    expect(errorsOf({ retention: 'relaxed' })).toEqual([])
    expect(errorsOf({ dailyGoal: 0 })).toEqual(['dailyGoal'])
    expect(errorsOf({ dailyGoal: 1 })).toEqual([])
    expect(errorsOf({ declaredLevel: 'Z9' })).toEqual(['declaredLevel'])
    expect(errorsOf({ activeTheme: 3 })).toEqual(['activeTheme'])
    expect(errorsOf({ audio: 'yes' })).toEqual(['audio'])
  })

  it('rejects unknown fields and collects every error', () => {
    expect(errorsOf({ newWordLimit: 99, colour: 'blue' })).toEqual(['newWordLimit', 'colour'])
  })

  it('has defaults that validate', () => {
    expect(validateSettingsPatch({ ...DEFAULT_SETTINGS }).ok).toBe(true)
  })
})

describe('isValidTzOffset', () => {
  it('accepts integers within −720…+840 and nothing else', () => {
    expect(isValidTzOffset(120)).toBe(true)
    expect(isValidTzOffset(-720)).toBe(true)
    expect(isValidTzOffset(840)).toBe(true)
    expect(isValidTzOffset(841)).toBe(false)
    expect(isValidTzOffset(-721)).toBe(false)
    expect(isValidTzOffset(90.5)).toBe(false)
    expect(isValidTzOffset(Number.NaN)).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/core test -- settings.test`
Expected: FAIL — cannot resolve `./settings`.

- [ ] **Step 3: Write `settings.ts` and `syncProtocol.ts`**

`core/src/settings.ts`:

```ts
import { RETENTION_TARGETS, type RetentionSetting } from './scheduler'
import { DEFAULT_NEW_WORD_LIMIT, DEFAULT_REVIEW_CAP, MAX_NEW_WORD_LIMIT } from './session'
import { CEFR_LEVELS, type CefrLevel } from './types'

/** The learner's settings document (spec §6.2, §7.4, §8.4). Validated before any rule reads it. */
export interface Settings {
  readonly declaredLevel: CefrLevel
  readonly newWordLimit: number
  readonly reviewCap: number
  readonly retention: RetentionSetting
  /** Answers per day; null for no goal. */
  readonly dailyGoal: number | null
  /** The active theme collection (spec §8.9); null for path order. */
  readonly activeTheme: string | null
  readonly audio: boolean
}

export const MAX_REVIEW_CAP = 1000

export const DEFAULT_SETTINGS: Settings = {
  declaredLevel: 'A1',
  newWordLimit: DEFAULT_NEW_WORD_LIMIT,
  reviewCap: DEFAULT_REVIEW_CAP,
  retention: 'standard',
  dailyGoal: null,
  activeTheme: null,
  audio: true,
}

export type SettingsValidation =
  | { readonly ok: true; readonly fields: Partial<Settings> }
  | { readonly ok: false; readonly errors: readonly string[] }

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/**
 * Checks a settings patch field by field (roadmap contract: settings are
 * validated before they reach `core`). Unknown fields are errors; the result
 * names only the fields the patch set.
 */
export function validateSettingsPatch(patch: Record<string, unknown>): SettingsValidation {
  const fields: Record<string, unknown> = {}
  const errors: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const valid =
      key === 'declaredLevel'
        ? typeof value === 'string' && (CEFR_LEVELS as readonly string[]).includes(value)
        : key === 'newWordLimit'
          ? isInt(value, 0, MAX_NEW_WORD_LIMIT)
          : key === 'reviewCap'
            ? isInt(value, 0, MAX_REVIEW_CAP)
            : key === 'retention'
              ? typeof value === 'string' && value in RETENTION_TARGETS
              : key === 'dailyGoal'
                ? value === null || isInt(value, 1, Number.MAX_SAFE_INTEGER)
                : key === 'activeTheme'
                  ? value === null || (typeof value === 'string' && value !== '')
                  : key === 'audio'
                    ? typeof value === 'boolean'
                    : false
    if (valid) fields[key] = value
    else errors.push(key)
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, fields: fields as Partial<Settings> }
}

/** Bounds of a real UTC offset in minutes (roadmap contract). */
export const TZ_OFFSET_MIN = -720
export const TZ_OFFSET_MAX = 840

/** A NaN offset would turn a word's stability into NaN for good; check before recording an event. */
export function isValidTzOffset(minutes: number): boolean {
  return isInt(minutes, TZ_OFFSET_MIN, TZ_OFFSET_MAX)
}
```

`core/src/syncProtocol.ts`:

```ts
import type { DaySummary } from './activity'
import type { DocumentClass, DocumentPatch } from './documents'
import type { ReviewState } from './scheduler'
import type { ReviewEvent } from './types'

/**
 * The sync wire format (spec §9.2, §4.3), camelCase and field-for-field the
 * in-memory types, because both ends are `core` consumers. `client-data`
 * (plan 4) speaks it through `SyncTransport`; the server (plan 5) serves it.
 * The reference implementation is `client-data/src/testing/fakeServer.ts`.
 */
export const SYNC_PROTOCOL_VERSION = 1

/** Events per push page (spec §15: sized against the Workers CPU limit). */
export const SYNC_PAGE_SIZE = 500

/** `day_complete` on the wire: the local date as YYYY-MM-DD (plan 2 contract). */
export interface WireDayComplete {
  readonly localDate: string
  readonly ruleVersion: string
}

/** A client write to a versioned document: the changed fields plus the version it edited. */
export interface DocumentWrite {
  readonly type: string
  readonly key: string
  readonly patch: DocumentPatch<Record<string, unknown>>
}

/** A document as the server holds it. */
export interface WireDocument {
  readonly type: string
  readonly key: string
  readonly class: DocumentClass
  readonly version: number
  readonly fields: Record<string, unknown>
  readonly fieldVersions: Record<string, number>
  readonly deleted: boolean
  /** Server-owned documents only: when the client should try to refresh (spec §9.2). */
  readonly staleAfter: number | null
}

export interface DocumentRejection {
  readonly type: string
  readonly key: string
  readonly reason: 'server_owned' | 'base_ahead_of_server' | 'version_not_newer' | 'invalid'
}

/**
 * One page of a push. Every page of one push shares `pushId` and `clientNow`,
 * so the server fixes the window once (spec §9.2 step 1). Page 0 also carries
 * the small things; later pages carry events only.
 */
export interface PushPage {
  readonly protocolVersion: number
  readonly pushId: string
  readonly clientNow: number
  readonly deviceId: string
  readonly page: number
  readonly lastPage: boolean
  readonly events: readonly ReviewEvent[]
  readonly dayComplete: readonly WireDayComplete[]
  readonly documents: readonly DocumentWrite[]
}

export type PushResponse =
  | {
      readonly status: 'ok'
      /** The server's copy of every document the page wrote, accepted or merged. */
      readonly documents: readonly WireDocument[]
      readonly rejected: readonly DocumentRejection[]
    }
  | { readonly status: 'upgrade_required'; readonly minProtocolVersion: number }

export interface PullRequest {
  readonly protocolVersion: number
  readonly deviceId: string
  /** Documents with a version above this are returned; 0 for everything. */
  readonly documentsSince: number
}

export type PullResponse =
  | {
      readonly status: 'ok'
      readonly serverNow: number
      readonly schedulerVersion: string
      /** The whole derived state: a new device is ready after one pull (spec §9.2). */
      readonly reviewStates: readonly ReviewState[]
      /** Per device, the highest deviceSeq the state includes (spec §4.3). */
      readonly deviceMarks: Readonly<Record<string, number>>
      /** The trailing 90 local days (spec §8.3). */
      readonly summaries: readonly DaySummary[]
      /** Every completed local date, YYYY-MM-DD (spec §8.4). */
      readonly dayComplete: readonly string[]
      readonly documents: readonly WireDocument[]
      /** The high-water mark to send as `documentsSince` next time. */
      readonly documentsVersion: number
      /** Authoritative XP (spec §8.7, §10): lifetime, and today's by UTC day. */
      readonly xp: { readonly total: number; readonly utcDay: number; readonly today: number }
    }
  | { readonly status: 'upgrade_required'; readonly minProtocolVersion: number }
```

Append to `core/src/index.ts`:

```ts
export * from './settings'
export * from './syncProtocol'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `settings.test.ts` has 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add core/src/settings.ts core/src/settings.test.ts core/src/syncProtocol.ts core/src/index.ts
git commit -m "feat(core): settings validation and the sync wire types

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pack installation: verify, validate, stage, activate, load

**Files:**
- Create: `client-data/src/packs.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/packs.test.ts`

**Interfaces:**
- Consumes: `selectPacks`, `validatePack`, `loadCorpus`, `PACK_SCHEMA_VERSION`, `canonicalJson`, `Pack`, `PackDescriptor`, `PackManifest`, `InstalledPack`, `Corpus` (plan 3); `Database`, `ClientEnv`.
- Produces: `PackFetcher = (descriptor: PackDescriptor) => Promise<Uint8Array>`; `InstallReport { staged, appUpdateNeeded, rejected: { packId, reason }[] }`; `installedPacks(db): Promise<InstalledPack[]>`; `installPacks(db, env, manifest, l1, fetchPack): Promise<InstallReport>`; `activateStagedPacks(db): Promise<string[]>`; `loadActiveCorpus(db): Promise<Corpus | null>`.

The fetcher resolves the descriptor's relative URL against the manifest's URL (plan 3 contract); on the web it is a `fetch` wrapper, and for the bundled demo sample it reads bundle assets. `installPacks` verifies size and SHA-256 before it parses anything, validates, checks the pack describes itself as the manifest does, checks it merges with the other active packs, and stages it. Nothing changes what a running session sees until `activateStagedPacks`, which the app calls at the start of a session (spec §5.1).

- [ ] **Step 1: Write the failing test**

`client-data/src/packs.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalJson, type Pack, type PackDescriptor, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { activateStagedPacks, installedPacks, installPacks, loadActiveCorpus, type PackFetcher } from './packs'
import { migrate } from './schema'
import { testEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1-bg/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

async function open() {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  return { db, env: testEnv() }
}

/** The sample pack at a higher corpus version, with its manifest, as the CDN would serve it. */
async function nextVersion(env: ReturnType<typeof testEnv>): Promise<{ manifest: PackManifest; fetch: PackFetcher; bytes: Uint8Array }> {
  const pack = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack
  const bytes = new TextEncoder().encode(canonicalJson({ ...pack, corpus_version: 1 }))
  const descriptor: PackDescriptor = { ...manifest.packs[0]!, corpus_version: 1, url: 'corpus-v1-bg.pack', sha256: await env.sha256(bytes), bytes: bytes.byteLength }
  return { manifest: { ...manifest, corpus_version: 1, packs: [descriptor] }, fetch: async () => bytes, bytes }
}

describe('installPacks', () => {
  it('stages the learner-L1 pack of a fresh install and activates it at the next session start', async () => {
    const { db, env } = await open()
    const report = await installPacks(db, env, manifest, 'bg', fromDisk)
    expect(report).toEqual({ staged: ['corpus-bg'], appUpdateNeeded: [], rejected: [] })
    expect(await loadActiveCorpus(db)).toBeNull()
    expect(await activateStagedPacks(db)).toEqual(['corpus-bg'])
    const corpus = await loadActiveCorpus(db)
    expect(corpus?.entries.size).toBe(60)
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 0, schema_version: 1 }])
  })

  it('does not fetch what is already installed, staged or active', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    let fetched = 0
    const counting: PackFetcher = (d) => {
      fetched += 1
      return fromDisk(d)
    }
    expect((await installPacks(db, env, manifest, 'bg', counting)).staged).toEqual([])
    await activateStagedPacks(db)
    expect((await installPacks(db, env, manifest, 'bg', counting)).staged).toEqual([])
    expect(fetched).toBe(0)
  })

  it('stages a newer version beside the active one; the session keeps the old one until activation', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    await activateStagedPacks(db)
    const next = await nextVersion(env)
    expect((await installPacks(db, env, next.manifest, 'bg', next.fetch)).staged).toEqual(['corpus-bg'])
    expect(await installedPacks(db)).toEqual([{ pack_id: 'corpus-bg', corpus_version: 1, schema_version: 1 }])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
    expect(await db.all("SELECT status, corpus_version FROM pack ORDER BY status")).toEqual([
      { status: 'active', corpus_version: 0 },
      { status: 'staged', corpus_version: 1 },
    ])
    await activateStagedPacks(db)
    expect(await db.all('SELECT status, corpus_version FROM pack')).toEqual([{ status: 'active', corpus_version: 1 }])
  })

  it('rejects bytes that do not match the manifest, before parsing them', async () => {
    const { db, env } = await open()
    const short: PackFetcher = async (d) => (await fromDisk(d)).slice(0, 100)
    expect((await installPacks(db, env, manifest, 'bg', short)).rejected[0]?.reason).toMatch(/size/)
    const tampered: PackFetcher = async (d) => {
      const bytes = await fromDisk(d)
      bytes[10] = bytes[10]! ^ 1
      return bytes
    }
    expect((await installPacks(db, env, manifest, 'bg', tampered)).rejected[0]?.reason).toMatch(/checksum/)
    const wrongHash = { ...manifest, packs: [{ ...manifest.packs[0]!, sha256: 'a'.repeat(64) }] }
    expect((await installPacks(db, env, wrongHash, 'bg', fromDisk)).rejected[0]?.reason).toMatch(/checksum/)
    expect(await installedPacks(db)).toEqual([])
  })

  it('rejects a pack that describes itself differently from the manifest', async () => {
    const { db, env } = await open()
    const next = await nextVersion(env)
    const lying = { ...next.manifest, packs: [{ ...next.manifest.packs[0]!, corpus_version: 2 }] }
    const report = await installPacks(db, env, lying, 'bg', next.fetch)
    expect(report.rejected[0]?.reason).toMatch(/manifest/)
  })

  it('keeps the installed pack and reports an app update when the schema is newer', async () => {
    const { db, env } = await open()
    await installPacks(db, env, manifest, 'bg', fromDisk)
    await activateStagedPacks(db)
    const newer = { ...manifest, corpus_version: 2, packs: [{ ...manifest.packs[0]!, corpus_version: 2, schema_version: 2 }] }
    const report = await installPacks(db, env, newer, 'bg', fromDisk)
    expect(report.staged).toEqual([])
    expect(report.appUpdateNeeded.map((d) => d.corpus_version)).toEqual([2])
    expect((await loadActiveCorpus(db))?.entries.size).toBe(60)
  })

  it('ignores packs for another L1', async () => {
    const { db, env } = await open()
    const report = await installPacks(db, env, manifest, 'es', fromDisk)
    expect(report).toEqual({ staged: [], appUpdateNeeded: [], rejected: [] })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- packs.test`
Expected: FAIL — cannot resolve `./packs`.

- [ ] **Step 3: Write `packs.ts`**

`client-data/src/packs.ts`:

```ts
import {
  loadCorpus,
  PACK_SCHEMA_VERSION,
  selectPacks,
  validatePack,
  type Corpus,
  type InstalledPack,
  type Pack,
  type PackDescriptor,
  type PackManifest,
} from '@wordado/core'
import type { Database } from './database'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

/** Fetches a pack's bytes; resolves `descriptor.url` against the manifest's URL (plan 3 contract). */
export type PackFetcher = (descriptor: PackDescriptor) => Promise<Uint8Array>

export interface InstallReport {
  readonly staged: readonly string[]
  /** Newer packs whose schema this build cannot read: the installed pack stays (spec §5.1). */
  readonly appUpdateNeeded: readonly PackDescriptor[]
  readonly rejected: readonly { readonly packId: string; readonly reason: string }[]
}

interface PackRow {
  pack_id: string
  corpus_version: number
  schema_version: number
}

/** What is installed, staged or active, highest version per pack, so nothing is fetched twice. */
export async function installedPacks(db: Database): Promise<InstalledPack[]> {
  const rows = await db.all<PackRow>('SELECT pack_id, corpus_version, schema_version FROM pack ORDER BY corpus_version')
  const best = new Map<string, InstalledPack>()
  for (const r of rows) best.set(r.pack_id, { pack_id: r.pack_id, corpus_version: r.corpus_version, schema_version: r.schema_version })
  return [...best.values()]
}

async function activePacks(driver: SqlDriver): Promise<Pack[]> {
  const rows = await driver.all<{ json: string }>("SELECT json FROM pack WHERE status = 'active' ORDER BY pack_id")
  return rows.map((r) => JSON.parse(r.json) as Pack)
}

/** Why a fetched pack cannot be staged, or null when it can. Verifies before it parses (plan 3 contract). */
async function checkFetched(
  env: ClientEnv,
  descriptor: PackDescriptor,
  bytes: Uint8Array,
  others: readonly Pack[],
): Promise<{ pack: Pack; text: string } | string> {
  if (bytes.byteLength !== descriptor.bytes) return `size ${bytes.byteLength} differs from the manifest's ${descriptor.bytes}`
  if ((await env.sha256(bytes)) !== descriptor.sha256) return 'checksum differs from the manifest'
  const text = new TextDecoder().decode(bytes)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return 'not JSON'
  }
  const result = validatePack(parsed)
  if (result.status === 'unsupported_schema') return `schema ${result.schemaVersion} is not supported`
  if (result.status === 'invalid') return `invalid: ${result.errors[0]?.path}: ${result.errors[0]?.message}`
  const pack = result.pack
  if (pack.pack_id !== descriptor.pack_id || pack.corpus_version !== descriptor.corpus_version || pack.l1 !== descriptor.l1) {
    return 'the pack describes itself differently from the manifest'
  }
  try {
    loadCorpus([...others.filter((p) => p.pack_id !== pack.pack_id), pack])
  } catch (err) {
    return `does not merge with the installed packs: ${(err as Error).message}`
  }
  return { pack, text }
}

/**
 * Fetches, verifies and stages the packs the manifest offers for `l1` and this
 * build can read (spec §5.1, §9.3). Staged packs become visible only through
 * `activateStagedPacks`, so a download never changes a running session.
 */
export async function installPacks(
  db: Database,
  env: ClientEnv,
  manifest: PackManifest,
  l1: string,
  fetchPack: PackFetcher,
): Promise<InstallReport> {
  const installed = await installedPacks(db)
  const selection = selectPacks({ manifest, l1, installed, supportedSchemaVersions: [PACK_SCHEMA_VERSION] })
  const others = await activePacks(db.driver)
  const staged: string[] = []
  const rejected: { packId: string; reason: string }[] = []
  for (const descriptor of selection.fetch) {
    let bytes: Uint8Array
    try {
      bytes = await fetchPack(descriptor)
    } catch (err) {
      rejected.push({ packId: descriptor.pack_id, reason: `fetch failed: ${(err as Error).message}` })
      continue
    }
    const checked = await checkFetched(env, descriptor, bytes, others)
    if (typeof checked === 'string') {
      rejected.push({ packId: descriptor.pack_id, reason: checked })
      continue
    }
    await db.transaction((tx) =>
      tx.run(
        `INSERT INTO pack (pack_id, status, corpus_version, schema_version, sha256, bytes, json)
         VALUES (?, 'staged', ?, ?, ?, ?, ?)
         ON CONFLICT (pack_id, status) DO UPDATE SET
           corpus_version = excluded.corpus_version, schema_version = excluded.schema_version,
           sha256 = excluded.sha256, bytes = excluded.bytes, json = excluded.json`,
        [descriptor.pack_id, checked.pack.corpus_version, checked.pack.schema_version, descriptor.sha256, descriptor.bytes, checked.text],
      ),
    )
    staged.push(descriptor.pack_id)
  }
  return { staged, appUpdateNeeded: selection.appUpdateNeeded, rejected }
}

/** Swaps staged packs in. Call at the start of a session, never in the middle of one (spec §5.1). */
export async function activateStagedPacks(db: Database): Promise<string[]> {
  return db.transaction(async (tx) => {
    const staged = await tx.all<{ pack_id: string }>("SELECT pack_id FROM pack WHERE status = 'staged' ORDER BY pack_id")
    for (const { pack_id } of staged) {
      await tx.run("DELETE FROM pack WHERE pack_id = ? AND status = 'active'", [pack_id])
      await tx.run("UPDATE pack SET status = 'active' WHERE pack_id = ? AND status = 'staged'", [pack_id])
    }
    return staged.map((s) => s.pack_id)
  })
}

/** The active packs as one corpus, or null before the first pack is activated. */
export async function loadActiveCorpus(db: Database): Promise<Corpus | null> {
  const packs = await activePacks(db.driver)
  return packs.length === 0 ? null : loadCorpus(packs)
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './packs'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `packs.test.ts` has 7 passing tests.

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): pack install with verification, staging and activation

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Documents: local patches, server copies, and the typed accessors

**Files:**
- Create: `client-data/src/documents.ts`, `client-data/src/documentTypes.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/documents.test.ts`

**Interfaces:**
- Consumes: `DocumentPatch`, `DocumentClass`, `DocumentWrite`, `WireDocument`, `mergeUnlockSets`, `Settings`, `DEFAULT_SETTINGS`, `validateSettingsPatch`, `Entitlement`, `WordFlag`, `WordId`, `isWordId`.
- Produces, from `documents.ts`: `Fields = Record<string, unknown>`; `StoredDocument { type, key, class, version, fields, fieldVersions, deleted, staleAfter, patch }`; `getDocument(driver, type, key)`; `listDocuments(driver, type)`; `writeLocalPatch(tx, type, key, fields, deleted?)`; `applyServerDocument(tx, wire)`; `confirmPushedDocument(tx, wire, sent: DocumentPatch<Fields>)`; `pendingDocumentWrites(driver): Promise<DocumentWrite[]>`; `UNLOCK_TYPE`.
- Produces, from `documentTypes.ts`: `DOC` (the six type names); `ReportField`; `readSettings(driver): Promise<Settings>`; `patchSettings(tx, patch): Promise<Settings>`; `readFlags(driver): Promise<Map<WordId, WordFlag>>`; `setFlag(tx, wordId, flag | null)`; `readUnlocks(driver): Promise<Set<string>>`; `addUnlocks(tx, unitIds)`; `readEntitlement(driver): Promise<Entitlement | null>`; `readAliases(driver): Promise<Map<WordId, WordId>>`; `addContentReport(tx, env, report): Promise<string>`.

One pending patch per document (decision above). `unit_unlock` is special in three places, all here: a local add unions, a server copy unions, and the pending patch holds only the local additions (spec §9.2: "merge is union, and nothing can re-lock a unit").

- [ ] **Step 1: Write the failing test**

`client-data/src/documents.test.ts`:

```ts
import type { WireDocument } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { applyServerDocument, confirmPushedDocument, getDocument, pendingDocumentWrites, writeLocalPatch } from './documents'
import { addContentReport, addUnlocks, patchSettings, readEntitlement, readFlags, readSettings, readUnlocks, setFlag } from './documentTypes'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { migrate } from './schema'
import { testEnv } from './testing/testEnv'

async function open() {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  return db
}

const wire = (over: Partial<WireDocument>): WireDocument => ({
  type: 'settings',
  key: '',
  class: 'versioned',
  version: 5,
  fields: { newWordLimit: 12, reviewCap: 80 },
  fieldVersions: { newWordLimit: 5, reviewCap: 3 },
  deleted: false,
  staleAfter: null,
  ...over,
})

describe('local patches', () => {
  it('creates a document locally at version 0 with the edit pending', async () => {
    const db = await open()
    const doc = await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 5 }))
    expect(doc).toMatchObject({ version: 0, fields: { newWordLimit: 5 }, patch: { baseVersion: 0, fields: { newWordLimit: 5 } } })
    expect(await pendingDocumentWrites(db.driver)).toEqual([{ type: 'settings', key: '', patch: { baseVersion: 0, fields: { newWordLimit: 5 } } }])
  })

  it('folds successive edits into one patch against the version the first edit saw', async () => {
    const db = await open()
    await db.transaction((tx) => applyServerDocument(tx, wire({})))
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    await db.transaction((tx) => applyServerDocument(tx, wire({ version: 6, fields: { newWordLimit: 12, reviewCap: 90 } })))
    const doc = await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { reviewCap: 50 }))
    expect(doc.version).toBe(6)
    expect(doc.fields).toEqual({ newWordLimit: 7, reviewCap: 50 })
    expect(doc.patch).toEqual({ baseVersion: 5, fields: { newWordLimit: 7, reviewCap: 50 } })
  })

  it('re-applies a pending edit on top of a pulled copy, and the pull otherwise wins', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    const doc = await db.transaction((tx) => applyServerDocument(tx, wire({})))
    expect(doc.fields).toEqual({ newWordLimit: 7, reviewCap: 80 })
    expect(doc.version).toBe(5)
    expect(doc.patch).toEqual({ baseVersion: 0, fields: { newWordLimit: 7 } })
  })

  it('clears the patch when the push confirms it, but keeps an edit made meanwhile', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 7 }))
    const sent = (await pendingDocumentWrites(db.driver))[0]!.patch
    const confirmed = await db.transaction((tx) => confirmPushedDocument(tx, wire({ version: 1, fields: { newWordLimit: 7 } }), sent))
    expect(confirmed.patch).toBeNull()
    expect(confirmed.version).toBe(1)
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { newWordLimit: 9 }))
    const sent2 = (await pendingDocumentWrites(db.driver))[0]!.patch
    await db.transaction((tx) => writeLocalPatch(tx, 'settings', '', { reviewCap: 40 }))
    const later = await db.transaction((tx) => confirmPushedDocument(tx, wire({ version: 2, fields: { newWordLimit: 9 } }), sent2))
    expect(later.version).toBe(2)
    expect(later.fields).toEqual({ newWordLimit: 9, reviewCap: 40 })
    expect(later.patch).toEqual({ baseVersion: 1, fields: { newWordLimit: 9, reviewCap: 40 } })
  })

  it('tombstones and undeletes through the patch', async () => {
    const db = await open()
    await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', { flag: 'known' }))
    const gone = await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', {}, true))
    expect(gone.deleted).toBe(true)
    expect(gone.patch).toEqual({ baseVersion: 0, fields: { flag: 'known' }, deleted: true })
    const back = await db.transaction((tx) => writeLocalPatch(tx, 'word_flag', 'c:hello-1', { flag: 'suspended' }, false))
    expect(back.deleted).toBe(false)
    expect(back.patch?.deleted).toBe(false)
  })

  it('unions unit unlocks locally and against the server, and never re-locks', async () => {
    const db = await open()
    await db.transaction((tx) => addUnlocks(tx, ['a1-02', 'a1-01']))
    await db.transaction((tx) => addUnlocks(tx, ['a1-03']))
    expect([...(await readUnlocks(db.driver))]).toEqual(['a1-01', 'a1-02', 'a1-03'])
    const doc = await db.transaction((tx) =>
      applyServerDocument(tx, wire({ type: 'unit_unlock', version: 3, fields: { units: ['a1-01', 'a1-09'] }, fieldVersions: { units: 3 } })),
    )
    expect(doc.fields).toEqual({ units: ['a1-01', 'a1-02', 'a1-03', 'a1-09'] })
    expect(doc.patch).toEqual({ baseVersion: 0, fields: { units: ['a1-01', 'a1-02', 'a1-03'] } })
  })

  it('refuses a local write to a server-owned document', async () => {
    const db = await open()
    await db.transaction((tx) => applyServerDocument(tx, wire({ type: 'entitlement', class: 'server_owned', fields: { tier: 'free' }, staleAfter: 99 })))
    await expect(db.transaction((tx) => writeLocalPatch(tx, 'entitlement', '', { tier: 'plus' }))).rejects.toThrow(/server-owned/)
    expect((await getDocument(db.driver, 'entitlement', ''))?.fields).toEqual({ tier: 'free' })
  })
})

describe('typed documents', () => {
  it('reads settings with defaults and ignores an invalid stored field', async () => {
    const db = await open()
    expect((await readSettings(db.driver)).newWordLimit).toBe(10)
    await db.transaction((tx) => applyServerDocument(tx, wire({ fields: { newWordLimit: 99, retention: 'relaxed' } })))
    const settings = await readSettings(db.driver)
    expect(settings.newWordLimit).toBe(10)
    expect(settings.retention).toBe('relaxed')
  })

  it('validates a settings patch before storing it', async () => {
    const db = await open()
    await expect(db.transaction((tx) => patchSettings(tx, { newWordLimit: 31 }))).rejects.toThrow(/newWordLimit/)
    const settings = await db.transaction((tx) => patchSettings(tx, { newWordLimit: 3, dailyGoal: 20 }))
    expect(settings).toMatchObject({ newWordLimit: 3, dailyGoal: 20, reviewCap: 100 })
  })

  it('sets and clears word flags', async () => {
    const db = await open()
    await db.transaction((tx) => setFlag(tx, 'c:hello-1', 'known'))
    await db.transaction((tx) => setFlag(tx, 'c:water-1', 'suspended'))
    expect([...(await readFlags(db.driver))]).toEqual([
      ['c:hello-1', 'known'],
      ['c:water-1', 'suspended'],
    ])
    await db.transaction((tx) => setFlag(tx, 'c:hello-1', null))
    expect([...(await readFlags(db.driver))]).toEqual([['c:water-1', 'suspended']])
  })

  it('reads the entitlement with its version and staleness', async () => {
    const db = await open()
    expect(await readEntitlement(db.driver)).toBeNull()
    await db.transaction((tx) =>
      applyServerDocument(
        tx,
        wire({
          type: 'entitlement',
          class: 'server_owned',
          version: 4,
          fields: { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } },
          fieldVersions: {},
          staleAfter: 1_000,
        }),
      ),
    )
    expect(await readEntitlement(db.driver)).toEqual({ tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 }, version: 4, staleAfter: 1_000 })
  })

  it('files a content report as a pending document', async () => {
    const db = await open()
    const env = testEnv()
    const key = await db.transaction((tx) => addContentReport(tx, env, { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0 }))
    const writes = await pendingDocumentWrites(db.driver)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ type: 'content_report', key, patch: { baseVersion: 0, fields: { wordId: 'c:hello-1', field: 'audio', note: 'robotic', packVersion: 0, createdAt: env.now() } } })
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- documents.test`
Expected: FAIL — cannot resolve `./documents`.

- [ ] **Step 3: Write `documents.ts`**

`client-data/src/documents.ts`:

```ts
import { mergeUnlockSets, type DocumentClass, type DocumentPatch, type DocumentWrite, type WireDocument } from '@wordado/core'
import type { SqlDriver } from './driver'

export type Fields = Record<string, unknown>

/** A document as the client holds it: the last server copy, with any unsynced edit applied and kept as `patch`. */
export interface StoredDocument {
  readonly type: string
  readonly key: string
  readonly class: DocumentClass
  readonly version: number
  readonly fields: Fields
  readonly fieldVersions: Record<string, number>
  readonly deleted: boolean
  readonly staleAfter: number | null
  /** The one pending write, or null when the server has everything. */
  readonly patch: DocumentPatch<Fields> | null
}

/** The grow-only set (spec §9.2): unioned locally and against the server, never re-locked. */
export const UNLOCK_TYPE = 'unit_unlock'

interface Row {
  type: string
  key: string
  class: DocumentClass
  version: number
  fields: string
  field_versions: string
  deleted: number
  stale_after: number | null
  patch: string | null
}

function fromRow(row: Row): StoredDocument {
  return {
    type: row.type,
    key: row.key,
    class: row.class,
    version: row.version,
    fields: JSON.parse(row.fields) as Fields,
    fieldVersions: JSON.parse(row.field_versions) as Record<string, number>,
    deleted: row.deleted === 1,
    staleAfter: row.stale_after,
    patch: row.patch === null ? null : (JSON.parse(row.patch) as DocumentPatch<Fields>),
  }
}

async function put(tx: SqlDriver, doc: StoredDocument): Promise<void> {
  await tx.run(
    `INSERT INTO document (type, key, class, version, fields, field_versions, deleted, stale_after, patch)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (type, key) DO UPDATE SET class = excluded.class, version = excluded.version, fields = excluded.fields,
       field_versions = excluded.field_versions, deleted = excluded.deleted, stale_after = excluded.stale_after, patch = excluded.patch`,
    [
      doc.type,
      doc.key,
      doc.class,
      doc.version,
      JSON.stringify(doc.fields),
      JSON.stringify(doc.fieldVersions),
      doc.deleted ? 1 : 0,
      doc.staleAfter,
      doc.patch === null ? null : JSON.stringify(doc.patch),
    ],
  )
}

export async function getDocument(driver: SqlDriver, type: string, key: string): Promise<StoredDocument | null> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE type = ? AND key = ?', [type, key])
  return rows[0] ? fromRow(rows[0]) : null
}

export async function listDocuments(driver: SqlDriver, type: string): Promise<StoredDocument[]> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE type = ? ORDER BY key', [type])
  return rows.map(fromRow)
}

const unitsOf = (fields: Fields): string[] => (Array.isArray(fields['units']) ? (fields['units'] as unknown[]).filter((u): u is string => typeof u === 'string') : [])

function unionUnits(a: Fields, b: Fields): Fields {
  return { units: [...mergeUnlockSets(unitsOf(a), unitsOf(b))].sort() }
}

function mergeFields(type: string, base: Fields, fields: Fields): Fields {
  return type === UNLOCK_TYPE ? unionUnits(base, fields) : { ...base, ...fields }
}

const EMPTY = (type: string, key: string): StoredDocument => ({
  type,
  key,
  class: 'versioned',
  version: 0,
  fields: {},
  fieldVersions: {},
  deleted: false,
  staleAfter: null,
  patch: null,
})

/**
 * A local edit (spec §9.2): applied to the stored copy at once and folded into
 * the one pending patch, whose `baseVersion` is the version the first pending
 * edit was made against. A document that does not exist yet is created at
 * version 0. `deleted` true tombstones, false undeletes, absent leaves it.
 */
export async function writeLocalPatch(tx: SqlDriver, type: string, key: string, fields: Fields, deleted?: boolean): Promise<StoredDocument> {
  const existing = await getDocument(tx, type, key)
  if (existing?.class === 'server_owned') throw new Error(`${type} is server-owned and cannot be written by a client`)
  const base = existing ?? EMPTY(type, key)
  const pendingDeleted = deleted ?? base.patch?.deleted
  const patch: DocumentPatch<Fields> = {
    baseVersion: base.patch?.baseVersion ?? base.version,
    fields: mergeFields(type, base.patch?.fields ?? {}, fields),
    ...(pendingDeleted === undefined ? {} : { deleted: pendingDeleted }),
  }
  const doc: StoredDocument = { ...base, fields: mergeFields(type, base.fields, fields), deleted: deleted ?? base.deleted, patch }
  await put(tx, doc)
  return doc
}

function fromWire(wire: WireDocument, fields: Fields, deleted: boolean, patch: DocumentPatch<Fields> | null): StoredDocument {
  return {
    type: wire.type,
    key: wire.key,
    class: wire.class,
    version: wire.version,
    fields,
    fieldVersions: wire.fieldVersions,
    deleted,
    staleAfter: wire.staleAfter,
    patch,
  }
}

/**
 * The server's copy, from a pull: it replaces the stored copy, and a pending
 * edit is re-applied on top so the learner's unsynced change stays visible
 * until the push settles it. Unit unlocks are unioned (spec §9.2).
 */
export async function applyServerDocument(tx: SqlDriver, wire: WireDocument): Promise<StoredDocument> {
  const existing = await getDocument(tx, wire.type, wire.key)
  const patch = existing?.patch ?? null
  const fields =
    wire.type === UNLOCK_TYPE && existing ? unionUnits(wire.fields, existing.fields) : patch ? mergeFields(wire.type, wire.fields, patch.fields) : wire.fields
  const doc = fromWire(wire, fields, patch?.deleted ?? wire.deleted, patch)
  await put(tx, doc)
  return doc
}

/**
 * The server's result for a pushed patch. If the stored patch is still the
 * one that was sent, it is cleared; if an edit was folded in meanwhile, the
 * result is applied like a pull and the newer patch stays pending.
 */
export async function confirmPushedDocument(tx: SqlDriver, wire: WireDocument, sent: DocumentPatch<Fields>): Promise<StoredDocument> {
  const existing = await getDocument(tx, wire.type, wire.key)
  if (existing?.patch && JSON.stringify(existing.patch) !== JSON.stringify(sent)) return applyServerDocument(tx, wire)
  const doc = fromWire(wire, wire.fields, wire.deleted, null)
  await put(tx, doc)
  return doc
}

/** Every pending patch, for page 0 of a push. */
export async function pendingDocumentWrites(driver: SqlDriver): Promise<DocumentWrite[]> {
  const rows = await driver.all<Row>('SELECT * FROM document WHERE patch IS NOT NULL ORDER BY type, key')
  return rows.map(fromRow).map((d) => ({ type: d.type, key: d.key, patch: d.patch! }))
}
```

- [ ] **Step 4: Write `documentTypes.ts`**

`client-data/src/documentTypes.ts`:

```ts
import {
  DEFAULT_SETTINGS,
  isWordId,
  validateSettingsPatch,
  type Entitlement,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { getDocument, listDocuments, UNLOCK_TYPE, writeLocalPatch, type Fields } from './documents'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'

/** The document types of Phase 1a (spec §6.2, §8.8, §8.10). */
export const DOC = {
  settings: 'settings',
  wordFlag: 'word_flag',
  unitUnlock: UNLOCK_TYPE,
  wordAlias: 'word_alias',
  entitlement: 'entitlement',
  contentReport: 'content_report',
} as const

/** Settings with defaults; a stored field that fails validation is ignored rather than trusted. */
export async function readSettings(driver: SqlDriver): Promise<Settings> {
  const doc = await getDocument(driver, DOC.settings, '')
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const [key, value] of Object.entries(doc?.fields ?? {})) {
    const result = validateSettingsPatch({ [key]: value })
    if (result.ok) Object.assign(out, result.fields)
  }
  return out as unknown as Settings
}

/** Validates (roadmap contract) and writes a settings patch. */
export async function patchSettings(tx: SqlDriver, patch: Record<string, unknown>): Promise<Settings> {
  const result = validateSettingsPatch(patch)
  if (!result.ok) throw new Error(`Invalid settings: ${result.errors.join(', ')}`)
  await writeLocalPatch(tx, DOC.settings, '', result.fields as Fields)
  return readSettings(tx)
}

export async function readFlags(driver: SqlDriver): Promise<Map<WordId, WordFlag>> {
  const out = new Map<WordId, WordFlag>()
  for (const doc of await listDocuments(driver, DOC.wordFlag)) {
    const flag = doc.fields['flag']
    if (!doc.deleted && (flag === 'known' || flag === 'suspended') && isWordId(doc.key)) out.set(doc.key, flag)
  }
  return out
}

/** A flag is a document per word; clearing it is a tombstone, so undoing restores it (spec §7.4, §9.2). */
export async function setFlag(tx: SqlDriver, wordId: WordId, flag: WordFlag | null): Promise<void> {
  if (flag === null) await writeLocalPatch(tx, DOC.wordFlag, wordId, {}, true)
  else await writeLocalPatch(tx, DOC.wordFlag, wordId, { flag }, false)
}

export async function readUnlocks(driver: SqlDriver): Promise<Set<string>> {
  const doc = await getDocument(driver, DOC.unitUnlock, '')
  const units = doc?.fields['units']
  return new Set(Array.isArray(units) ? units.filter((u): u is string => typeof u === 'string') : [])
}

export async function addUnlocks(tx: SqlDriver, unitIds: readonly string[]): Promise<void> {
  if (unitIds.length === 0) return
  await writeLocalPatch(tx, DOC.unitUnlock, '', { units: [...unitIds] })
}

/** The cached server-owned entitlement (spec §8.8), or null before the first pull. */
export async function readEntitlement(driver: SqlDriver): Promise<Entitlement | null> {
  const doc = await getDocument(driver, DOC.entitlement, '')
  if (!doc) return null
  const fields = doc.fields as unknown as Omit<Entitlement, 'version' | 'staleAfter'>
  return { ...fields, version: doc.version, staleAfter: doc.staleAfter ?? 0 }
}

/** user word → corpus entry merges (Phase 2); empty until then. */
export async function readAliases(driver: SqlDriver): Promise<Map<WordId, WordId>> {
  const out = new Map<WordId, WordId>()
  for (const doc of await listDocuments(driver, DOC.wordAlias)) {
    const target = doc.fields['target']
    if (!doc.deleted && isWordId(doc.key) && typeof target === 'string' && isWordId(target)) out.set(doc.key, target)
  }
  return out
}

export type ReportField = 'translation' | 'example' | 'audio' | 'level' | 'other'

export interface ContentReportInput {
  readonly wordId: WordId
  readonly field: ReportField
  readonly note: string
  readonly packVersion: number
}

/** A report works offline and syncs like any document (spec §8.10). Returns its key. */
export async function addContentReport(tx: SqlDriver, env: ClientEnv, report: ContentReportInput): Promise<string> {
  const key = env.uuid()
  await writeLocalPatch(tx, DOC.contentReport, key, { ...report, createdAt: env.now() })
  return key
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './documents'
export * from './documentTypes'
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `documents.test.ts` has 12 passing tests.

- [ ] **Step 6: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): documents with pending patches, server copies and typed accessors

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: The learner: snapshot, marks, local events, derived state, answers and completed days

**Files:**
- Create: `client-data/src/learner.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/learner.test.ts`

**Interfaces:**
- Consumes: `rebase`, `classifyEvents`, `dayCounts`, `summarizeDays`, `mergeSummaries`, `computeXp`, `isValidTzOffset`, `SCHEDULER_VERSION`, `DAY_COMPLETE_RULE_VERSION`, `dayToIsoDate`, `isoDateToDay`, `isAboveMark`, types `ReviewEvent`, `ReviewState`, `DaySummary`, `DayCounts`, `XpResult`, `AliasMap`, `WordId`, `Mode`, `Direction`, `Grade`; `nextDeviceSeq` (Task 2).
- Produces: `LocalEvent extends ReviewEvent { pushed }`; `Learner { deviceId, serverStates, marks, localEvents, states, summaries, completeDays, aliases, tombstoned }`; `LearnerOptions { aliases?, tombstoned? }`; `loadLearner(db, deviceId, options?)`; `reloadLearner(db, learner)`; `eventsAboveMarks(learner)`; `deriveStates(learner)`; `todayCounts(learner, today): DayCounts`; `allSummaries(learner): Map<number, DaySummary>`; `provisionalXp(learner): XpResult`; `AnswerInput { wordId, mode, direction, grade, latencyMs, practice }`; `appendAnswer(db, env, learner, input): Promise<ReviewEvent>`; `recordDayComplete(db, learner, day, now): Promise<boolean>`; `unpushedEvents(driver)`, `markEventsPushed(tx, reviewIds)`, `pendingDayComplete(driver)`, `markDayCompletePushed(tx, dates)`; `replaceSnapshot(tx, input: SnapshotInput)`.

The learner is the in-memory model of everything derived. `states` is recomputed by `deriveStates` (the rebase rule) after every append, so it is always `rebase(serverStates, marks, localEvents)` and never drifts from what a reload would give. Today's counts are the pulled summary for today plus the local events above the marks classified against the server snapshot (plan 2 contract).

- [ ] **Step 1: Write the failing test**

`client-data/src/learner.test.ts`:

```ts
import { applyGrade, Grade, localDay, type DaySummary, type ReviewState } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import {
  allSummaries,
  appendAnswer,
  eventsAboveMarks,
  loadLearner,
  pendingDayComplete,
  provisionalXp,
  recordDayComplete,
  reloadLearner,
  replaceSnapshot,
  todayCounts,
  unpushedEvents,
  markEventsPushed,
  type AnswerInput,
} from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { testEnv, type TestEnv } from './testing/testEnv'

const HELLO = 'c:hello-1'
const WATER = 'c:water-1'
const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as AnswerInput['wordId'],
  mode: 'multiple_choice',
  direction: 'en_to_l1',
  grade: Grade.Good,
  latencyMs: 1500,
  practice: false,
  ...over,
})

async function open(env: TestEnv = testEnv()) {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const deviceId = await ensureDevice(db, env)
  const learner = await loadLearner(db, deviceId)
  return { db, env, learner }
}

describe('appendAnswer', () => {
  it('stores the event with the next device sequence and derives the state', async () => {
    const { db, env, learner } = await open()
    const first = await appendAnswer(db, env, learner, answer(HELLO))
    env.advance(60_000)
    const second = await appendAnswer(db, env, learner, answer(WATER, { mode: 'flashcard', grade: Grade.Easy }))
    expect([first.deviceSeq, second.deviceSeq]).toEqual([1, 2])
    expect(first).toMatchObject({ deviceId: learner.deviceId, clientTzOffsetMin: 120, schedulerVersion: expect.stringMatching(/^fsrs/) })
    expect(learner.states.get(HELLO)?.reps).toBe(1)
    expect(learner.states.get(WATER)?.lastGrade).toBe(Grade.Easy)
    expect(await unpushedEvents(db.driver)).toHaveLength(2)
    const reloaded = await loadLearner(db, learner.deviceId)
    expect(reloaded.states).toEqual(learner.states)
  })

  it('logs practice and matching answers without touching the schedule', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO, { practice: true }))
    await appendAnswer(db, env, learner, answer(WATER, { mode: 'matching', practice: true }))
    expect(learner.states.size).toBe(0)
    expect(learner.localEvents).toHaveLength(2)
  })

  it('refuses an impossible time-zone offset before anything is written', async () => {
    const env = testEnv(Date.UTC(2026, 0, 5, 10), 900)
    const { db, learner } = await open(env)
    await expect(appendAnswer(db, env, learner, answer(HELLO))).rejects.toThrow(/offset/)
    expect(learner.localEvents).toHaveLength(0)
    expect(await db.all('SELECT count(*) AS c FROM review_event')).toEqual([{ c: 0 }])
  })
})

describe('the server snapshot and the rebase rule', () => {
  it('replaces state with the server\'s and re-applies the events above its marks', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    env.advance(1000)
    await appendAnswer(db, env, learner, answer(WATER))
    await db.transaction((tx) => markEventsPushed(tx, learner.localEvents.map((e) => e.reviewId)))
    // The server has seen only the first event and derived a different (older) state for hello.
    const serverHello: ReviewState = applyGrade(null, HELLO, Grade.Hard, env.now() - 5000, 120)
    await db.transaction((tx) =>
      replaceSnapshot(tx, { states: [serverHello], marks: { [learner.deviceId]: 1 }, summaries: [], dayComplete: [] }),
    )
    await reloadLearner(db, learner)
    expect(learner.serverStates.get(HELLO)).toEqual(serverHello)
    expect(learner.states.get(HELLO)).toEqual(serverHello)
    expect(learner.states.get(WATER)?.reps).toBe(1)
    expect(learner.localEvents.map((e) => e.deviceSeq)).toEqual([2])
    expect(eventsAboveMarks(learner).map((e) => e.deviceSeq)).toEqual([2])
  })

  it('keeps unpushed events even when a mark would cover their sequence', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    await db.transaction((tx) => replaceSnapshot(tx, { states: [], marks: { [learner.deviceId]: 5 }, summaries: [], dayComplete: [] }))
    await reloadLearner(db, learner)
    expect(learner.localEvents).toHaveLength(1)
    expect(await unpushedEvents(db.driver)).toHaveLength(1)
  })
})

describe('today', () => {
  it('adds today\'s pulled summary to the local events above the marks', async () => {
    const { db, env, learner } = await open()
    const today = localDay(env.now(), 120)
    const pulled: DaySummary = { day: today, reviews: 4, successes: 3, newWords: 2, answered: 7, practice: 1 }
    await db.transaction((tx) => replaceSnapshot(tx, { states: [], marks: {}, summaries: [pulled], dayComplete: [] }))
    await reloadLearner(db, learner)
    await appendAnswer(db, env, learner, answer(HELLO))
    await appendAnswer(db, env, learner, answer(WATER, { practice: true }))
    expect(todayCounts(learner, today)).toEqual({ reviewsDone: 4, newWordsDone: 3, practiceDone: 2, answered: 9 })
    expect(allSummaries(learner).get(today)).toEqual({ day: today, reviews: 4, successes: 3, newWords: 3, answered: 9, practice: 2 })
  })

  it('records a completed day once and lists it for the push', async () => {
    const { db, env, learner } = await open()
    const today = localDay(env.now(), 120)
    expect(await recordDayComplete(db, learner, today, env.now())).toBe(true)
    expect(await recordDayComplete(db, learner, today, env.now())).toBe(false)
    expect([...learner.completeDays]).toEqual([today])
    expect(await pendingDayComplete(db.driver)).toEqual([{ localDate: '2026-01-05', ruleVersion: 'r1' }])
  })

  it('shows provisional XP for the events the server has not counted', async () => {
    const { db, env, learner } = await open()
    await appendAnswer(db, env, learner, answer(HELLO))
    await appendAnswer(db, env, learner, answer(WATER, { practice: true }))
    expect(provisionalXp(learner).total).toBe(12)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- learner.test`
Expected: FAIL — cannot resolve `./learner`.

- [ ] **Step 3: Write `learner.ts`**

`client-data/src/learner.ts`:

```ts
import {
  classifyEvents,
  computeXp,
  DAY_COMPLETE_RULE_VERSION,
  dayCounts,
  dayToIsoDate,
  isAboveMark,
  isoDateToDay,
  isValidTzOffset,
  mergeSummaries,
  rebase,
  SCHEDULER_VERSION,
  summarizeDays,
  type AliasMap,
  type DayCounts,
  type DaySummary,
  type Direction,
  type Grade,
  type Mode,
  type ReviewEvent,
  type ReviewState,
  type WireDayComplete,
  type WordId,
  type XpResult,
} from '@wordado/core'
import type { Database } from './database'
import type { SqlDriver, SqlValue } from './driver'
import type { ClientEnv } from './env'
import { nextDeviceSeq } from './meta'

export interface LocalEvent extends ReviewEvent {
  readonly pushed: boolean
}

/**
 * Everything derived, in memory. `serverStates`, `marks`, `summaries` and the
 * pulled `completeDays` are what the last pull sent; `localEvents` is this
 * device's log; `states` is always `rebase(serverStates, marks, localEvents)`.
 */
export interface Learner {
  readonly deviceId: string
  serverStates: Map<WordId, ReviewState>
  marks: Map<string, number>
  localEvents: LocalEvent[]
  states: Map<WordId, ReviewState>
  summaries: Map<number, DaySummary>
  completeDays: Set<number>
  aliases: AliasMap
  tombstoned: ReadonlySet<WordId>
}

export interface LearnerOptions {
  readonly aliases?: AliasMap
  readonly tombstoned?: ReadonlySet<WordId>
}

interface EventRow {
  review_id: string
  word_id: string
  mode: string
  direction: string
  grade: number
  latency_ms: number
  practice: number
  client_ts: number
  client_tz_offset_min: number
  device_id: string
  device_seq: number
  scheduler_version: string
  pushed: number
}

function rowToEvent(row: EventRow): LocalEvent {
  return {
    reviewId: row.review_id,
    wordId: row.word_id as WordId,
    mode: row.mode as Mode,
    direction: row.direction as Direction,
    grade: row.grade as Grade,
    latencyMs: row.latency_ms,
    practice: row.practice === 1,
    clientTs: row.client_ts,
    clientTzOffsetMin: row.client_tz_offset_min,
    deviceId: row.device_id,
    deviceSeq: row.device_seq,
    schedulerVersion: row.scheduler_version,
    pushed: row.pushed === 1,
  }
}

/** An outbox event carries its clientTs as effectiveTs until the server stamps it (plan 2 contract). */
const asReplayEvent = (e: LocalEvent) => ({ ...e, effectiveTs: e.clientTs })

async function readEvents(driver: SqlDriver, where = '', params: readonly SqlValue[] = []): Promise<LocalEvent[]> {
  const rows = await driver.all<EventRow>(`SELECT * FROM review_event ${where} ORDER BY device_id, device_seq`, params)
  return rows.map(rowToEvent)
}

export async function loadLearner(db: Database, deviceId: string, options: LearnerOptions = {}): Promise<Learner> {
  const learner: Learner = {
    deviceId,
    serverStates: new Map(),
    marks: new Map(),
    localEvents: [],
    states: new Map(),
    summaries: new Map(),
    completeDays: new Set(),
    aliases: options.aliases ?? new Map(),
    tombstoned: options.tombstoned ?? new Set(),
  }
  await reloadLearner(db, learner)
  return learner
}

/** Re-reads every table into the learner, after a pull. */
export async function reloadLearner(db: Database, learner: Learner): Promise<void> {
  const states = await db.all<{ state: string }>('SELECT state FROM review_state')
  learner.serverStates = new Map(states.map((r) => JSON.parse(r.state) as ReviewState).map((s) => [s.wordId, s]))
  const marks = await db.all<{ device_id: string; device_seq: number }>('SELECT device_id, device_seq FROM device_mark')
  learner.marks = new Map(marks.map((m) => [m.device_id, m.device_seq]))
  learner.localEvents = await readEvents(db.driver)
  const summaries = await db.all<{ day: number; reviews: number; successes: number; new_words: number; answered: number; practice: number }>('SELECT * FROM day_summary')
  learner.summaries = new Map(
    summaries.map((s) => [s.day, { day: s.day, reviews: s.reviews, successes: s.successes, newWords: s.new_words, answered: s.answered, practice: s.practice }]),
  )
  const days = await db.all<{ local_date: string }>('SELECT local_date FROM day_complete')
  learner.completeDays = new Set(days.map((d) => isoDateToDay(d.local_date)))
  learner.states = deriveStates(learner)
}

/** The events the server's snapshot cannot contain (spec §4.3). */
export function eventsAboveMarks(learner: Learner): LocalEvent[] {
  return learner.localEvents.filter((e) => isAboveMark(e, learner.marks))
}

/** The rebase rule (spec §4.3): the server's state with this device's newer events on top. */
export function deriveStates(learner: Learner): Map<WordId, ReviewState> {
  return rebase(learner.serverStates, learner.marks, learner.localEvents.map(asReplayEvent), learner.aliases, learner.tombstoned)
}

function classifyLocal(learner: Learner) {
  return classifyEvents(eventsAboveMarks(learner).map(asReplayEvent), { aliases: learner.aliases, prior: learner.serverStates })
}

/** Today's counts after a pull: the pulled summary for today plus the local events above the marks (plan 2 contract). */
export function todayCounts(learner: Learner, today: number): DayCounts {
  const pulled = learner.summaries.get(today)
  const local = dayCounts(classifyLocal(learner), today)
  return {
    reviewsDone: (pulled?.reviews ?? 0) + local.reviewsDone,
    newWordsDone: (pulled?.newWords ?? 0) + local.newWordsDone,
    practiceDone: (pulled?.practice ?? 0) + local.practiceDone,
    answered: (pulled?.answered ?? 0) + local.answered,
  }
}

/** The pulled summary plus the days recorded since, for the retention rate (plan 2 contract). */
export function allSummaries(learner: Learner): Map<number, DaySummary> {
  return mergeSummaries(learner.summaries.values(), summarizeDays(classifyLocal(learner)).values())
}

/** XP for the events the server has not counted yet: provisional, may exceed the cap until the next pull (spec §8.7). */
export function provisionalXp(learner: Learner): XpResult {
  return computeXp(eventsAboveMarks(learner).map(asReplayEvent), { aliases: learner.aliases, prior: learner.serverStates })
}

export interface AnswerInput {
  readonly wordId: WordId
  readonly mode: Mode
  readonly direction: Direction
  readonly grade: Grade
  readonly latencyMs: number
  readonly practice: boolean
}

/**
 * Records one answer (spec §6.2, §9.2): the event is appended with the next
 * device sequence in one transaction, and the derived state is recomputed.
 */
export async function appendAnswer(db: Database, env: ClientEnv, learner: Learner, input: AnswerInput): Promise<ReviewEvent> {
  const tz = env.tzOffsetMin()
  if (!isValidTzOffset(tz)) throw new Error(`Impossible time-zone offset ${tz}`)
  const event = await db.transaction(async (tx) => {
    const deviceSeq = await nextDeviceSeq(tx)
    const e: ReviewEvent = {
      reviewId: env.uuid(),
      ...input,
      clientTs: env.now(),
      clientTzOffsetMin: tz,
      deviceId: learner.deviceId,
      deviceSeq,
      schedulerVersion: SCHEDULER_VERSION,
    }
    await tx.run(
      `INSERT INTO review_event (review_id, word_id, mode, direction, grade, latency_ms, practice, client_ts, client_tz_offset_min, device_id, device_seq, scheduler_version, pushed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [e.reviewId, e.wordId, e.mode, e.direction, e.grade, e.latencyMs, e.practice ? 1 : 0, e.clientTs, e.clientTzOffsetMin, e.deviceId, e.deviceSeq, e.schedulerVersion],
    )
    return e
  })
  learner.localEvents.push({ ...event, pushed: false })
  learner.states = deriveStates(learner)
  return event
}

/** Records the completed day once (spec §8.4). False when it was already recorded. */
export async function recordDayComplete(db: Database, learner: Learner, day: number, now: number): Promise<boolean> {
  if (learner.completeDays.has(day)) return false
  await db.transaction((tx) =>
    tx.run('INSERT OR IGNORE INTO day_complete (local_date, rule_version, client_ts, pushed) VALUES (?, ?, ?, 0)', [dayToIsoDate(day), DAY_COMPLETE_RULE_VERSION, now]),
  )
  learner.completeDays.add(day)
  return true
}

export async function unpushedEvents(driver: SqlDriver): Promise<LocalEvent[]> {
  return readEvents(driver, 'WHERE pushed = 0')
}

export async function markEventsPushed(tx: SqlDriver, reviewIds: readonly string[]): Promise<void> {
  for (const id of reviewIds) await tx.run('UPDATE review_event SET pushed = 1 WHERE review_id = ?', [id])
}

export async function pendingDayComplete(driver: SqlDriver): Promise<WireDayComplete[]> {
  const rows = await driver.all<{ local_date: string; rule_version: string }>('SELECT local_date, rule_version FROM day_complete WHERE pushed = 0 ORDER BY local_date')
  return rows.map((r) => ({ localDate: r.local_date, ruleVersion: r.rule_version }))
}

export async function markDayCompletePushed(tx: SqlDriver, dates: readonly string[]): Promise<void> {
  for (const date of dates) await tx.run('UPDATE day_complete SET pushed = 1 WHERE local_date = ?', [date])
}

export interface SnapshotInput {
  readonly states: readonly ReviewState[]
  readonly marks: Readonly<Record<string, number>>
  readonly summaries: readonly DaySummary[]
  /** YYYY-MM-DD. */
  readonly dayComplete: readonly string[]
}

/**
 * Stores what a pull sent (spec §9.2): the whole derived state, the marks,
 * the summary and the completed dates. Pushed events the marks cover are
 * dropped; unpushed ones are kept whatever the marks say.
 */
export async function replaceSnapshot(tx: SqlDriver, input: SnapshotInput): Promise<void> {
  await tx.run('DELETE FROM review_state')
  for (const s of input.states) await tx.run('INSERT INTO review_state (word_id, state) VALUES (?, ?)', [s.wordId, JSON.stringify(s)])
  await tx.run('DELETE FROM device_mark')
  for (const [deviceId, seq] of Object.entries(input.marks)) {
    await tx.run('INSERT INTO device_mark (device_id, device_seq) VALUES (?, ?)', [deviceId, seq])
    await tx.run('DELETE FROM review_event WHERE device_id = ? AND device_seq <= ? AND pushed = 1', [deviceId, seq])
  }
  await tx.run('DELETE FROM day_summary')
  for (const s of input.summaries) {
    await tx.run('INSERT INTO day_summary (day, reviews, successes, new_words, answered, practice) VALUES (?, ?, ?, ?, ?, ?)', [s.day, s.reviews, s.successes, s.newWords, s.answered, s.practice])
  }
  for (const date of input.dayComplete) {
    await tx.run('INSERT INTO day_complete (local_date, rule_version, client_ts, pushed) VALUES (?, ?, 0, 1) ON CONFLICT (local_date) DO UPDATE SET pushed = 1', [date, DAY_COMPLETE_RULE_VERSION])
  }
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './learner'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `learner.test.ts` has 8 passing tests. (Provisional XP of 12: one new word at 10 plus one practice answer at 2.)

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): the learner model, answers, derived state and completed days

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Study: the session plan, day-complete input, progress view and available modes

**Files:**
- Create: `client-data/src/study.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/study.test.ts`

**Interfaces:**
- Consumes: `composeSession`, `pathNewWords`, `computeUnlocks`, `isLive`, `themeEntries`, `entryClips`, `corpusWordId`, `parseWordId`, `masteryTier`, `retentionRate`, `streakStatus`, `unitProgress`, `levelCompletion`, `localDay`, `RETENTION_TARGETS`, `MAX_NEW_WORD_LIMIT`, and their types (plans 1–3); `Learner`, `todayCounts`, `allSummaries`, `provisionalXp` (Task 6).
- Produces: `StudyContext { corpus, learner, settings, flags, unlocked, now, tzOffsetMin }`; `today(ctx)`; `pathContext(ctx): PathContext`; `sessionPlan(ctx): SessionPlan`; `dayCompleteInput(ctx, plan): DayCompleteInput`; `newUnlocks(ctx): string[]`; `ProgressView`; `progressView(ctx, plan): ProgressView`; `entryOf(corpus, wordId): CorpusEntry | null`; `availableModes(ctx, wordId, cachedClips, online): Set<Mode>`.

Pure functions over the in-memory model: `today` is computed once per call from `now` and the device's current offset (roadmap contract), the same call serves the home screen and the session, and `reviewsDoneToday` comes from the one `todayCounts` helper.

- [ ] **Step 1: Write the failing test**

`client-data/src/study.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, Grade, loadCorpus, validatePack, type Corpus, type WordFlag, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { appendAnswer, loadLearner, type AnswerInput, type Learner } from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { availableModes, dayCompleteInput, newUnlocks, progressView, sessionPlan, type StudyContext } from './study'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE = fileURLToPath(new URL('../../pipeline/samples/a1-bg/corpus-v0-bg.pack', import.meta.url))
const parsed = validatePack(JSON.parse(readFileSync(SAMPLE, 'utf8')))
const corpus: Corpus = loadCorpus([parsed.status === 'ok' ? parsed.pack : (() => { throw new Error('sample invalid') })()])

const answer = (wordId: WordId, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId, mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

async function setup(env: TestEnv = testEnv()) {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const learner = await loadLearner(db, await ensureDevice(db, env))
  const ctx = (over: Partial<StudyContext> = {}): StudyContext => ({
    corpus,
    learner,
    settings: DEFAULT_SETTINGS,
    flags: new Map<WordId, WordFlag>(),
    unlocked: new Set<string>(),
    now: env.now(),
    tzOffsetMin: env.tzOffsetMin(),
    ...over,
  })
  return { db, env, learner, ctx }
}

async function learnUnit(db: Database, env: TestEnv, learner: Learner, unitId: string): Promise<void> {
  for (const wordId of corpus.units.find((u) => u.unitId === unitId)!.wordIds) {
    await appendAnswer(db, env, learner, answer(wordId))
    env.advance(5_000)
  }
}

describe('sessionPlan', () => {
  it('starts a fresh learner on the first unit with the default new-word limit', async () => {
    const { ctx } = await setup()
    const plan = sessionPlan(ctx())
    expect(plan.reviews).toEqual([])
    expect(plan.newWords).toHaveLength(10)
    expect(plan.newWords[0]).toBe('c:hello-1')
    expect(plan.backlogTotal).toBe(0)
    expect(plan.newWordsPaused).toBe(false)
  })

  it('honours settings, flags and an active theme', async () => {
    const { ctx } = await setup()
    const flagged = new Map<WordId, WordFlag>([['c:hello-1', 'known']])
    const plan = sessionPlan(ctx({ settings: { ...DEFAULT_SETTINGS, newWordLimit: 3 }, flags: flagged }))
    expect(plan.newWords).toEqual(['c:goodbye-1', 'c:please-1', 'c:thank_you-1'])
    const themed = sessionPlan(ctx({ settings: { ...DEFAULT_SETTINGS, newWordLimit: 3, activeTheme: 'daily-life' } }))
    expect(themed.newWords).toEqual(['c:breakfast-1', 'c:lunch-1', 'c:dinner-1'])
  })

  it('counts today\'s work so the limit and the cap hold across calls', async () => {
    const { db, env, learner, ctx } = await setup()
    for (const wordId of sessionPlan(ctx()).newWords.slice(0, 4)) await appendAnswer(db, env, learner, answer(wordId))
    const plan = sessionPlan(ctx({ now: env.now() }))
    expect(plan.newWords).toHaveLength(6)
    expect(plan.newWords).not.toContain('c:hello-1')
  })

  it('unlocks the next unit once every live word of the current one is introduced', async () => {
    const { db, env, learner, ctx } = await setup()
    expect(newUnlocks(ctx())).toEqual(['a1-01'])
    await learnUnit(db, env, learner, 'a1-01')
    expect(newUnlocks(ctx({ now: env.now() }))).toEqual(['a1-01', 'a1-02'])
    expect(newUnlocks(ctx({ now: env.now(), unlocked: new Set(['a1-01', 'a1-02']) }))).toEqual([])
  })
})

describe('dayCompleteInput and progressView', () => {
  it('reports the day complete after one answer when nothing is due', async () => {
    const { db, env, learner, ctx } = await setup()
    const before = dayCompleteInput(ctx(), sessionPlan(ctx()))
    expect(before).toEqual({ backlogTotal: 0, reviewCap: 100, reviewsDoneToday: 0, answeredToday: 0, dailyGoal: null })
    await appendAnswer(db, env, learner, answer('c:hello-1'))
    expect(dayCompleteInput(ctx(), sessionPlan(ctx())).answeredToday).toBe(1)
  })

  it('counts tiers over live entries, levels, units, retention and the streak', async () => {
    const { db, env, learner, ctx } = await setup()
    await learnUnit(db, env, learner, 'a1-01')
    const flagged = new Map<WordId, WordFlag>([['c:water-1', 'known']])
    const view = progressView(ctx({ now: env.now(), flags: flagged }), sessionPlan(ctx({ now: env.now(), flags: flagged })))
    expect(view.tiers).toEqual({ new: 39, learning: 20, young: 0, mature: 0 })
    expect(view.levels['A1']).toEqual({ kind: 'progress', live: 59, mature: 0, share: 0 })
    expect(view.units.get('a1-01')).toMatchObject({ live: 20, introduced: 20, complete: false })
    expect(view.retention).toBeNull()
    expect(view.streak).toEqual({ length: 0, todayComplete: false, freezesLeft: 2 })
    expect(view.xpProvisional).toBe(200)
    expect(view.dueToday).toBe(0)
  })
})

describe('availableModes', () => {
  it('offers listening only with a clip at hand and audio on', async () => {
    const { ctx } = await setup()
    const none = new Set<string>()
    expect([...availableModes(ctx(), 'c:hello-1', none, false)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...availableModes(ctx(), 'c:hello-1', none, true)]).toEqual(['flashcard', 'multiple_choice', 'listening_select'])
    expect([...availableModes(ctx(), 'c:hello-1', new Set(['hello-1-uk']), false)]).toContain('listening_select')
    const muted = ctx({ settings: { ...DEFAULT_SETTINGS, audio: false } })
    expect([...availableModes(muted, 'c:hello-1', new Set(['hello-1-uk']), true)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...availableModes(ctx(), 'u:nope', none, true)]).toEqual(['flashcard', 'multiple_choice'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- study.test`
Expected: FAIL — cannot resolve `./study`.

- [ ] **Step 3: Write `study.ts`**

`client-data/src/study.ts`:

```ts
import {
  composeSession,
  computeUnlocks,
  corpusWordId,
  entryClips,
  isLive,
  levelCompletion,
  localDay,
  masteryTier,
  MAX_NEW_WORD_LIMIT,
  parseWordId,
  pathNewWords,
  RETENTION_TARGETS,
  retentionRate,
  streakStatus,
  themeEntries,
  unitProgress,
  type CefrLevel,
  type Corpus,
  type CorpusEntry,
  type DayCompleteInput,
  type LevelCompletion,
  type MasteryTier,
  type Mode,
  type PathContext,
  type SessionPlan,
  type Settings,
  type StreakStatus,
  type UnitProgress,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { allSummaries, provisionalXp, todayCounts, type Learner } from './learner'

/** Everything a study rule reads, captured once per call so every number agrees (roadmap contract). */
export interface StudyContext {
  readonly corpus: Corpus
  readonly learner: Learner
  readonly settings: Settings
  readonly flags: ReadonlyMap<WordId, WordFlag>
  /** The persisted grow-only unlock set. */
  readonly unlocked: ReadonlySet<string>
  readonly now: number
  readonly tzOffsetMin: number
}

export function today(ctx: StudyContext): number {
  return localDay(ctx.now, ctx.tzOffsetMin)
}

export function pathContext(ctx: StudyContext): PathContext {
  return {
    units: ctx.corpus.units,
    retired: ctx.corpus.retired,
    flags: ctx.flags,
    // A word has review state only after a scheduled review, which is what "introduced" means (spec §7.2).
    introduced: new Set(ctx.learner.states.keys()),
    declaredLevel: ctx.settings.declaredLevel,
    unlocked: ctx.unlocked,
  }
}

/** The session, from the same inputs the home screen shows (spec §7.4). */
export function sessionPlan(ctx: StudyContext): SessionPlan {
  const day = today(ctx)
  const counts = todayCounts(ctx.learner, day)
  const theme = ctx.settings.activeTheme
  return composeSession({
    now: ctx.now,
    today: day,
    states: ctx.learner.states,
    flags: ctx.flags,
    retention: RETENTION_TARGETS[ctx.settings.retention],
    newWordLimit: ctx.settings.newWordLimit,
    reviewCap: ctx.settings.reviewCap,
    reviewsDoneToday: counts.reviewsDone,
    newWordsDoneToday: counts.newWordsDone,
    personalNew: [],
    collectionNew: theme === null ? null : themeEntries(ctx.corpus, theme).map((e) => corpusWordId(e.entryId)),
    pathNew: pathNewWords(pathContext(ctx), MAX_NEW_WORD_LIMIT),
  })
}

/** What `isDayComplete` reads, after the latest answer (spec §8.4). */
export function dayCompleteInput(ctx: StudyContext, plan: SessionPlan): DayCompleteInput {
  const counts = todayCounts(ctx.learner, today(ctx))
  return {
    backlogTotal: plan.backlogTotal,
    reviewCap: ctx.settings.reviewCap,
    reviewsDoneToday: counts.reviewsDone,
    answeredToday: counts.answered,
    dailyGoal: ctx.settings.dailyGoal,
  }
}

/** Unit IDs the current state unlocks beyond the persisted set, in path order (spec §7.2). */
export function newUnlocks(ctx: StudyContext): string[] {
  return computeUnlocks(pathContext(ctx))
}

export interface ProgressView {
  /** The home screen's primary figure: today's reviews within the cap (spec §8.3). */
  readonly dueToday: number
  readonly backlogTotal: number
  readonly newWordsPaused: boolean
  /** Live corpus entries by tier; flagged words are neither counted nor mature (spec §7.4). */
  readonly tiers: Readonly<Record<MasteryTier, number>>
  readonly levels: Readonly<Partial<Record<CefrLevel, LevelCompletion>>>
  readonly units: ReadonlyMap<string, UnitProgress>
  readonly retention: number | null
  readonly streak: StreakStatus
  /** XP the server has not confirmed: provisional (spec §8.7). */
  readonly xpProvisional: number
}

export function progressView(ctx: StudyContext, plan: SessionPlan): ProgressView {
  const day = today(ctx)
  const visibility = { retired: ctx.corpus.retired, flags: ctx.flags, declaredLevel: ctx.settings.declaredLevel }
  const tiers: Record<MasteryTier, number> = { new: 0, learning: 0, young: 0, mature: 0 }
  for (const entry of ctx.corpus.entries.values()) {
    const wordId = corpusWordId(entry.entryId)
    if (!isLive(wordId, visibility)) continue
    tiers[masteryTier(ctx.learner.states.get(wordId))] += 1
  }
  const levels: Partial<Record<CefrLevel, LevelCompletion>> = {}
  for (const level of new Set(ctx.corpus.units.map((u) => u.level))) {
    levels[level] = levelCompletion(level, ctx.corpus.units, ctx.learner.states, visibility)
  }
  const units = new Map(ctx.corpus.units.map((u) => [u.unitId, unitProgress(u, ctx.learner.states, visibility)]))
  return {
    dueToday: plan.reviews.length,
    backlogTotal: plan.backlogTotal,
    newWordsPaused: plan.newWordsPaused,
    tiers,
    levels,
    units,
    retention: retentionRate(allSummaries(ctx.learner).values(), day),
    streak: streakStatus(ctx.learner.completeDays, day),
    xpProvisional: provisionalXp(ctx.learner).total,
  }
}

export function entryOf(corpus: Corpus, wordId: WordId): CorpusEntry | null {
  const { kind, key } = parseWordId(wordId)
  return kind === 'corpus' ? (corpus.entries.get(key) ?? null) : null
}

/**
 * The modes one item can run in right now (spec §7.5, §9.3): listening only
 * with audio on and a clip either cached or fetchable. Matching is a practice
 * game and is never a session mode.
 */
export function availableModes(ctx: StudyContext, wordId: WordId, cachedClips: ReadonlySet<string>, online: boolean): Set<Mode> {
  const modes = new Set<Mode>(['flashcard', 'multiple_choice'])
  const entry = entryOf(ctx.corpus, wordId)
  if (!entry || !ctx.settings.audio) return modes
  const clips = entryClips(ctx.corpus, entry)
  if (clips.length > 0 && (online || clips.some((c) => cachedClips.has(c.clipId)))) modes.add('listening_select')
  return modes
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './study'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `study.test.ts` has 7 passing tests. (Tiers after learning unit 1 with `water` flagged: 59 live entries, 20 learning, 39 new; XP 20 new words × 10.)

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): session plan, day-complete input, progress view and available modes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: The sync engine and the fake server

**Files:**
- Create: `client-data/src/sync.ts`, `client-data/src/testing/fakeServer.ts`
- Modify: `client-data/src/documents.ts` (add `dropPendingPatch`), `client-data/src/index.ts`
- Test: `client-data/src/sync.test.ts`

**Interfaces:**
- Consumes: the wire types and `SYNC_PROTOCOL_VERSION`, `SYNC_PAGE_SIZE` (Task 3); `unpushedEvents`, `markEventsPushed`, `pendingDayComplete`, `markDayCompletePushed`, `replaceSnapshot`, `reloadLearner`, `Learner` (Task 6); `pendingDocumentWrites`, `confirmPushedDocument`, `applyServerDocument` (Task 5); `getMeta`, `setMeta` (Task 2); for the fake server `openPushWindow`, `stampEvents`, `replay`, `classifyEvents`, `summarizeDays`, `computeXp`, `applyPatch`, `createDocument`, `mergeUnlockSets`, `utcDay`, `localDay`, `dayToIsoDate`, `SCHEDULER_VERSION`.
- Produces, from `sync.ts`: `SyncTransport { push(page), pull(request) }`; `SyncStatus`; `INITIAL_SYNC_STATUS`; `SyncOutcome = 'synced' | 'skipped' | 'failed' | 'upgrade_required'`; `BACKOFF_BASE_MS`, `BACKOFF_MAX_MS`, `backoffMs(failures, rng)`; `PulledXp { total, utcDay, today }`; `readPulledXp(driver)`; `SyncEngine` with `status`, `onStatus`, `sync({ force? })`.
- Produces, from `documents.ts`: `dropPendingPatch(tx, type, key)`.
- Produces, from `testing/fakeServer.ts`: `FakeServer implements SyncTransport` with `events`, `devices`, `dayComplete`, `documents`, `pushes`, `failNext`, `failAfterNext`, `minProtocolVersion`, `setServerOwned(type, key, fields, staleAfter)`.

`SyncEngine.sync` pushes then pulls, coalesces concurrent calls, and backs off after a failure. The fake server is the endpoint contract as executable code: one window per `pushId` fixed on page 0 with the carry threaded across pages; duplicates on `reviewId` dropped before stamping; marks advanced; a `day_complete` accepted only with an answer on that date; documents through `applyPatch` with the unlock union; a server-owned write rejected; a pull that is the whole derived state plus documents since a version.

- [ ] **Step 1: Add `dropPendingPatch` to `documents.ts`**

Append to `client-data/src/documents.ts`:

```ts
/** Forgets a pending patch the server rejected; the next pull restores the server's fields. */
export async function dropPendingPatch(tx: SqlDriver, type: string, key: string): Promise<void> {
  await tx.run('UPDATE document SET patch = NULL WHERE type = ? AND key = ?', [type, key])
}
```

- [ ] **Step 2: Write the fake server**

`client-data/src/testing/fakeServer.ts`:

```ts
import {
  applyPatch,
  classifyEvents,
  computeXp,
  createDocument,
  dayToIsoDate,
  localDay,
  mergeUnlockSets,
  openPushWindow,
  replay,
  SCHEDULER_VERSION,
  stampEvents,
  summarizeDays,
  utcDay,
  type DeviceMark,
  type DocumentRejection,
  type PullRequest,
  type PullResponse,
  type PushPage,
  type PushResponse,
  type PushWindow,
  type StampCarry,
  type StampedReviewEvent,
  type WireDocument,
} from '@wordado/core'
import type { SyncTransport } from '../sync'

export interface FakeServerOptions {
  now(): number
  readonly accountCreatedAt?: number
  readonly minProtocolVersion?: number
}

const unitsOf = (fields: Record<string, unknown>): string[] =>
  Array.isArray(fields['units']) ? (fields['units'] as unknown[]).filter((u): u is string => typeof u === 'string') : []

/**
 * The sync endpoints as `core`'s rules define them (spec §9.2, §4.3, §8.4,
 * §10): what plan 5's server must do, executable. One user, in memory.
 */
export class FakeServer implements SyncTransport {
  readonly events = new Map<string, StampedReviewEvent>()
  readonly devices = new Map<string, DeviceMark>()
  readonly dayComplete = new Set<string>()
  readonly documents = new Map<string, WireDocument>()
  readonly pushes: PushPage[] = []
  private readonly windows = new Map<string, { window: PushWindow; carry: StampCarry }>()
  private documentVersion = 0
  /** Thrown by the next call before it does anything: a network failure. */
  failNext: Error | null = null
  /** The next push is applied, then the response is lost: a retry must be idempotent. */
  failAfterNext = false
  minProtocolVersion: number

  constructor(private readonly options: FakeServerOptions) {
    this.minProtocolVersion = options.minProtocolVersion ?? 1
  }

  private maybeFail(): void {
    if (this.failNext) {
      const err = this.failNext
      this.failNext = null
      throw err
    }
  }

  private hasAnswerOn(localDate: string): boolean {
    for (const e of this.events.values()) {
      if (dayToIsoDate(localDay(e.effectiveTs, e.clientTzOffsetMin)) === localDate) return true
    }
    return false
  }

  async push(page: PushPage): Promise<PushResponse> {
    this.maybeFail()
    this.pushes.push(page)
    if (page.protocolVersion < this.minProtocolVersion) return { status: 'upgrade_required', minProtocolVersion: this.minProtocolVersion }
    const serverNow = this.options.now()
    let entry = this.windows.get(page.pushId)
    if (!entry) {
      const window = openPushWindow({
        clientNow: page.clientNow,
        serverNow,
        lastAccepted: this.devices.get(page.deviceId) ?? null,
        accountCreatedAt: this.options.accountCreatedAt ?? 0,
      })
      entry = { window, carry: new Map() }
      this.windows.set(page.pushId, entry)
    }
    const fresh = page.events.filter((e) => !this.events.has(e.reviewId))
    const { events, carry } = stampEvents(fresh, entry.window, serverNow, entry.carry)
    entry.carry = carry
    for (const e of events) {
      this.events.set(e.reviewId, e)
      const mark = this.devices.get(e.deviceId)
      if (!mark || e.deviceSeq > mark.deviceSeq) this.devices.set(e.deviceId, { deviceSeq: e.deviceSeq, effectiveTs: e.effectiveTs })
    }
    for (const d of page.dayComplete) if (this.hasAnswerOn(d.localDate)) this.dayComplete.add(d.localDate)
    const documents: WireDocument[] = []
    const rejected: DocumentRejection[] = []
    for (const write of page.documents) {
      const id = `${write.type}/${write.key}`
      const existing = this.documents.get(id)
      if (existing?.class === 'server_owned') {
        rejected.push({ type: write.type, key: write.key, reason: 'server_owned' })
        continue
      }
      const current = existing
        ? { version: existing.version, fields: existing.fields, fieldVersions: existing.fieldVersions, deleted: existing.deleted }
        : createDocument<Record<string, unknown>>({}, 0)
      const patch =
        write.type === 'unit_unlock'
          ? { ...write.patch, fields: { units: [...mergeUnlockSets(unitsOf(current.fields), unitsOf(write.patch.fields))].sort() } }
          : write.patch
      const result = applyPatch(current, patch, this.documentVersion + 1)
      if (!result.accepted) {
        rejected.push({ type: write.type, key: write.key, reason: result.reason })
        continue
      }
      this.documentVersion += 1
      const doc: WireDocument = {
        type: write.type,
        key: write.key,
        class: 'versioned',
        version: result.document.version,
        fields: result.document.fields,
        fieldVersions: result.document.fieldVersions as Record<string, number>,
        deleted: result.document.deleted,
        staleAfter: null,
      }
      this.documents.set(id, doc)
      documents.push(doc)
    }
    if (this.failAfterNext) {
      this.failAfterNext = false
      throw new Error('connection lost after the server applied the push')
    }
    return { status: 'ok', documents, rejected }
  }

  async pull(request: PullRequest): Promise<PullResponse> {
    this.maybeFail()
    if (request.protocolVersion < this.minProtocolVersion) return { status: 'upgrade_required', minProtocolVersion: this.minProtocolVersion }
    const all = [...this.events.values()]
    const now = this.options.now()
    const xp = computeXp(all)
    const today = utcDay(now)
    const deviceMarks: Record<string, number> = {}
    for (const [deviceId, mark] of this.devices) deviceMarks[deviceId] = mark.deviceSeq
    return {
      status: 'ok',
      serverNow: now,
      schedulerVersion: SCHEDULER_VERSION,
      reviewStates: [...replay(all).values()],
      deviceMarks,
      summaries: [...summarizeDays(classifyEvents(all)).values()],
      dayComplete: [...this.dayComplete].sort(),
      documents: [...this.documents.values()].filter((d) => d.version > request.documentsSince),
      documentsVersion: this.documentVersion,
      xp: { total: xp.total, utcDay: today, today: xp.byUtcDay.get(today) ?? 0 },
    }
  }

  /** Writes a server-owned document as the server would (spec §8.8, §9.2). */
  setServerOwned(type: string, key: string, fields: Record<string, unknown>, staleAfter: number): WireDocument {
    this.documentVersion += 1
    const doc: WireDocument = { type, key, class: 'server_owned', version: this.documentVersion, fields, fieldVersions: {}, deleted: false, staleAfter }
    this.documents.set(`${type}/${key}`, doc)
    return doc
  }
}
```

- [ ] **Step 3: Write the failing test**

`client-data/src/sync.test.ts`:

```ts
import { Grade, localDay, SYNC_PAGE_SIZE, type WordId } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Database } from './database'
import { pendingDocumentWrites } from './documents'
import { patchSettings, readEntitlement, readSettings } from './documentTypes'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import { appendAnswer, loadLearner, recordDayComplete, unpushedEvents, type AnswerInput, type Learner } from './learner'
import { ensureDevice } from './meta'
import { migrate } from './schema'
import { backoffMs, readPulledXp, SyncEngine, type SyncTransport } from './sync'
import { FakeServer } from './testing/fakeServer'
import { testEnv, type TestEnv } from './testing/testEnv'

const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as WordId, mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

interface Device {
  db: Database
  env: TestEnv
  learner: Learner
  engine: SyncEngine
}

async function device(transport: SyncTransport, env: TestEnv): Promise<Device> {
  const db = new Database(nodeSqliteDriver())
  await migrate(db)
  const learner = await loadLearner(db, await ensureDevice(db, env))
  return { db, env, learner, engine: new SyncEngine({ db, env, learner, transport }) }
}

/** One clock for the server and both devices, so skew is a test's choice. */
function world(over: { minProtocolVersion?: number } = {}) {
  const env = testEnv()
  const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000, ...over })
  return { env, server }
}

describe('SyncEngine', () => {
  it('pushes the outbox, pulls the snapshot, and prunes what the marks cover', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    env.advance(2_000)
    await appendAnswer(a.db, env, a.learner, answer('c:water-1', { practice: true }))
    expect(await a.engine.sync()).toBe('synced')
    expect(server.events.size).toBe(2)
    expect(server.devices.get(a.learner.deviceId)?.deviceSeq).toBe(2)
    expect(await unpushedEvents(a.db.driver)).toEqual([])
    expect(a.learner.localEvents).toEqual([])
    expect(a.learner.marks.get(a.learner.deviceId)).toBe(2)
    expect(a.learner.states.get('c:hello-1')?.reps).toBe(1)
    expect(a.engine.status).toMatchObject({ phase: 'idle', pendingEvents: 0, failures: 0, lastError: null, upgradeRequired: false })
    expect(a.engine.status.lastSyncAt).toBe(env.now())
    expect(await readPulledXp(a.db.driver)).toEqual({ total: 12, utcDay: expect.any(Number), today: 12 })
  })

  it('carries progress, completed days and settings to a second device', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const b = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 4 }))
    await a.engine.sync()
    await b.engine.sync()
    expect(b.learner.states.get('c:hello-1')?.reps).toBe(1)
    expect([...b.learner.completeDays]).toEqual([localDay(env.now(), 120)])
    expect((await readSettings(b.db.driver)).newWordLimit).toBe(4)
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
  })

  it('merges settings field by field, later arrival winning a contested field', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    const b = await device(server, env)
    await a.engine.sync()
    await b.engine.sync()
    await a.db.transaction((tx) => patchSettings(tx, { newWordLimit: 3, reviewCap: 30 }))
    await b.db.transaction((tx) => patchSettings(tx, { newWordLimit: 7, dailyGoal: 25 }))
    await a.engine.sync()
    await b.engine.sync()
    await a.engine.sync()
    const merged = { newWordLimit: 7, reviewCap: 30, dailyGoal: 25 }
    expect(await readSettings(a.db.driver)).toMatchObject(merged)
    expect(await readSettings(b.db.driver)).toMatchObject(merged)
  })

  it('pages a large backlog under one push id, small things on page 0 only', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    for (let i = 0; i < SYNC_PAGE_SIZE * 2 + 5; i += 1) {
      await appendAnswer(a.db, env, a.learner, answer(`c:w${i}`))
      env.advance(3_000)
    }
    await recordDayComplete(a.db, a.learner, localDay(env.now(), 120), env.now())
    await a.engine.sync()
    expect(server.pushes).toHaveLength(3)
    expect(new Set(server.pushes.map((p) => p.pushId)).size).toBe(1)
    expect(server.pushes.map((p) => p.events.length)).toEqual([SYNC_PAGE_SIZE, SYNC_PAGE_SIZE, 5])
    expect(server.pushes.map((p) => p.lastPage)).toEqual([false, false, true])
    expect(server.pushes.map((p) => p.dayComplete.length)).toEqual([1, 0, 0])
    expect(server.events.size).toBe(SYNC_PAGE_SIZE * 2 + 5)
    expect([...server.events.values()].every((e) => e.xpEligible)).toBe(true)
  })

  it('retries idempotently when the response is lost after the server applied the push', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    server.failAfterNext = true
    expect(await a.engine.sync()).toBe('failed')
    expect(await unpushedEvents(a.db.driver)).toHaveLength(1)
    expect(await a.engine.sync({ force: true })).toBe('synced')
    expect(server.events.size).toBe(1)
    expect(server.pushes).toHaveLength(2)
  })

  it('backs off after a failure and honours force', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    server.failNext = new Error('offline')
    expect(await a.engine.sync()).toBe('failed')
    expect(a.engine.status).toMatchObject({ failures: 1, lastError: 'offline' })
    expect(a.engine.status.nextAttemptAt).toBeGreaterThan(env.now())
    expect(await a.engine.sync()).toBe('skipped')
    env.advance(10 * 60_000)
    expect(await a.engine.sync()).toBe('synced')
    expect(a.engine.status.failures).toBe(0)
    expect(a.engine.status.nextAttemptAt).toBeNull()
  })

  it('stops when the server requires an upgrade, keeping the outbox', async () => {
    const { env, server } = world({ minProtocolVersion: 2 })
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    expect(await a.engine.sync()).toBe('upgrade_required')
    expect(a.engine.status.upgradeRequired).toBe(true)
    expect(await unpushedEvents(a.db.driver)).toHaveLength(1)
    expect(await a.engine.sync({ force: true })).toBe('skipped')
  })

  it('caches the server-owned entitlement and drops a rejected write', async () => {
    const { env, server } = world()
    server.setServerOwned('entitlement', '', { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } }, env.now() + 86_400_000)
    const a = await device(server, env)
    await a.engine.sync()
    expect(await readEntitlement(a.db.driver)).toMatchObject({ tier: 'free', version: 1, staleAfter: env.now() + 86_400_000 })
    await a.db.transaction((tx) => tx.run("UPDATE document SET patch = ? WHERE type = 'entitlement'", [JSON.stringify({ baseVersion: 1, fields: { tier: 'plus' } })]))
    await a.engine.sync()
    expect(await pendingDocumentWrites(a.db.driver)).toEqual([])
    expect((await readEntitlement(a.db.driver))?.tier).toBe('free')
  })

  it('corrects a skewed clock as a whole and loses no XP', async () => {
    const { env, server } = world()
    const skewed = testEnv(env.now() + 3_600_000)
    const a = await device(server, skewed)
    await appendAnswer(a.db, skewed, a.learner, answer('c:hello-1'))
    skewed.advance(5_000)
    await appendAnswer(a.db, skewed, a.learner, answer('c:water-1'))
    await a.engine.sync()
    const stamped = [...server.events.values()].sort((x, y) => x.deviceSeq - y.deviceSeq)
    expect(stamped.map((e) => e.xpEligible)).toEqual([true, true])
    expect(stamped[1]!.effectiveTs - stamped[0]!.effectiveTs).toBe(5_000)
    expect(stamped[0]!.effectiveTs).toBeLessThanOrEqual(env.now())
  })

  it('coalesces concurrent calls into one run', async () => {
    const { env, server } = world()
    const a = await device(server, env)
    await appendAnswer(a.db, env, a.learner, answer('c:hello-1'))
    const [x, y] = await Promise.all([a.engine.sync(), a.engine.sync()])
    expect([x, y]).toEqual(['synced', 'synced'])
    expect(server.pushes).toHaveLength(1)
  })
})

describe('backoffMs', () => {
  it('doubles from a second to a five-minute ceiling with jitter', () => {
    const half = () => 0
    const full = () => 1
    expect(backoffMs(1, half)).toBe(500)
    expect(backoffMs(1, full)).toBe(1_500)
    expect(backoffMs(4, half)).toBe(4_000)
    expect(backoffMs(20, full)).toBe(450_000)
  })
})
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- sync.test`
Expected: FAIL — cannot resolve `./sync`.

- [ ] **Step 5: Write `sync.ts`**

`client-data/src/sync.ts`:

```ts
import { SYNC_PAGE_SIZE, SYNC_PROTOCOL_VERSION, type PullRequest, type PullResponse, type PushPage, type PushResponse, type Rng } from '@wordado/core'
import type { Database } from './database'
import { applyServerDocument, confirmPushedDocument, dropPendingPatch, pendingDocumentWrites } from './documents'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'
import {
  markDayCompletePushed,
  markEventsPushed,
  pendingDayComplete,
  reloadLearner,
  replaceSnapshot,
  unpushedEvents,
  type Learner,
} from './learner'
import { getMeta, setMeta } from './meta'

/** The network, as the app provides it: a `fetch` wrapper with the session's credentials (plan 6). Throws on failure. */
export interface SyncTransport {
  push(page: PushPage): Promise<PushResponse>
  pull(request: PullRequest): Promise<PullResponse>
}

export interface SyncStatus {
  readonly phase: 'idle' | 'pushing' | 'pulling'
  readonly pendingEvents: number
  readonly lastSyncAt: number | null
  readonly lastError: string | null
  readonly failures: number
  /** When the next unforced attempt may run; null when there is nothing to wait for. */
  readonly nextAttemptAt: number | null
  /** The server refused this build (spec §4.3); the outbox stays until the app is updated. */
  readonly upgradeRequired: boolean
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  phase: 'idle',
  pendingEvents: 0,
  lastSyncAt: null,
  lastError: null,
  failures: 0,
  nextAttemptAt: null,
  upgradeRequired: false,
}

export type SyncOutcome = 'synced' | 'skipped' | 'failed' | 'upgrade_required'

export const BACKOFF_BASE_MS = 1_000
export const BACKOFF_MAX_MS = 5 * 60_000

/** Doubling from a second to the ceiling, with ×0.5–1.5 jitter so devices do not retry in step. Tuning (§15). */
export function backoffMs(failures: number, rng: Rng): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1)) * (0.5 + rng())
}

/** Authoritative XP as of the last pull (spec §8.7, §10). */
export interface PulledXp {
  readonly total: number
  readonly utcDay: number
  readonly today: number
}

export async function readPulledXp(driver: SqlDriver): Promise<PulledXp | null> {
  const raw = await getMeta(driver, 'xp')
  return raw === null ? null : (JSON.parse(raw) as PulledXp)
}

export interface SyncDeps {
  readonly db: Database
  readonly env: ClientEnv
  readonly learner: Learner
  readonly transport: SyncTransport
}

/**
 * Push, then pull (spec §9.2). One run at a time: concurrent calls share it.
 * After a failure the engine backs off; `force` ignores the backoff, never
 * an upgrade requirement.
 */
export class SyncEngine {
  status: SyncStatus = INITIAL_SYNC_STATUS
  onStatus: ((status: SyncStatus) => void) | null = null
  private running: Promise<SyncOutcome> | null = null

  constructor(private readonly deps: SyncDeps) {}

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch }
    this.onStatus?.(this.status)
  }

  sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (this.running) return this.running
    this.running = this.run(options.force ?? false).finally(() => {
      this.running = null
    })
    return this.running
  }

  private async run(force: boolean): Promise<SyncOutcome> {
    const { env } = this.deps
    if (this.status.upgradeRequired) return 'skipped'
    if (!force && this.status.nextAttemptAt !== null && env.now() < this.status.nextAttemptAt) return 'skipped'
    try {
      this.set({ phase: 'pushing' })
      if ((await this.push()) === 'upgrade_required') return this.upgradeRequired()
      this.set({ phase: 'pulling' })
      if ((await this.pull()) === 'upgrade_required') return this.upgradeRequired()
      this.set({ phase: 'idle', pendingEvents: 0, lastSyncAt: env.now(), lastError: null, failures: 0, nextAttemptAt: null })
      return 'synced'
    } catch (err) {
      const failures = this.status.failures + 1
      this.set({
        phase: 'idle',
        lastError: err instanceof Error ? err.message : String(err),
        failures,
        nextAttemptAt: env.now() + backoffMs(failures, env.rng),
      })
      return 'failed'
    }
  }

  private upgradeRequired(): SyncOutcome {
    this.set({ phase: 'idle', upgradeRequired: true })
    return 'upgrade_required'
  }

  private async push(): Promise<'ok' | 'upgrade_required'> {
    const { db, env, learner, transport } = this.deps
    const events = await unpushedEvents(db.driver)
    const dayComplete = await pendingDayComplete(db.driver)
    const documents = await pendingDocumentWrites(db.driver)
    this.set({ pendingEvents: events.length })
    if (events.length === 0 && dayComplete.length === 0 && documents.length === 0) return 'ok'
    const pushId = env.uuid()
    const clientNow = env.now()
    const pageCount = Math.max(1, Math.ceil(events.length / SYNC_PAGE_SIZE))
    for (let page = 0; page < pageCount; page += 1) {
      const slice = events.slice(page * SYNC_PAGE_SIZE, (page + 1) * SYNC_PAGE_SIZE)
      const response = await transport.push({
        protocolVersion: SYNC_PROTOCOL_VERSION,
        pushId,
        clientNow,
        deviceId: learner.deviceId,
        page,
        lastPage: page === pageCount - 1,
        events: slice.map(({ pushed: _pushed, ...event }) => event),
        dayComplete: page === 0 ? dayComplete : [],
        documents: page === 0 ? documents : [],
      })
      if (response.status === 'upgrade_required') return 'upgrade_required'
      await db.transaction(async (tx) => {
        await markEventsPushed(tx, slice.map((e) => e.reviewId))
        if (page !== 0) return
        await markDayCompletePushed(tx, dayComplete.map((d) => d.localDate))
        for (const doc of response.documents) {
          const sent = documents.find((w) => w.type === doc.type && w.key === doc.key)
          if (sent) await confirmPushedDocument(tx, doc, sent.patch)
        }
        for (const r of response.rejected) await dropPendingPatch(tx, r.type, r.key)
      })
      const pushedIds = new Set(slice.map((e) => e.reviewId))
      learner.localEvents = learner.localEvents.map((e) => (pushedIds.has(e.reviewId) ? { ...e, pushed: true } : e))
      this.set({ pendingEvents: Math.max(0, events.length - (page + 1) * SYNC_PAGE_SIZE) })
    }
    return 'ok'
  }

  private async pull(): Promise<'ok' | 'upgrade_required'> {
    const { db, env, learner, transport } = this.deps
    const documentsSince = Number((await getMeta(db.driver, 'documents_since')) ?? '0')
    const response = await transport.pull({ protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: learner.deviceId, documentsSince })
    if (response.status === 'upgrade_required') return 'upgrade_required'
    await db.transaction(async (tx) => {
      await replaceSnapshot(tx, {
        states: response.reviewStates,
        marks: response.deviceMarks,
        summaries: response.summaries,
        dayComplete: response.dayComplete,
      })
      for (const doc of response.documents) await applyServerDocument(tx, doc)
      await setMeta(tx, 'documents_since', String(response.documentsVersion))
      await setMeta(tx, 'xp', JSON.stringify(response.xp))
      await setMeta(tx, 'last_pull_at', String(env.now()))
    })
    await reloadLearner(db, learner)
    return 'ok'
  }
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './sync'
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `sync.test.ts` has 11 passing tests.

- [ ] **Step 7: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): sync engine with paging, backoff and the upgrade gate; fake server from core's rules

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: The client facade and its store

**Files:**
- Create: `client-data/src/store.ts`, `client-data/src/client.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/client.test.ts`

**Interfaces:**
- Consumes: everything above; `canUse`, `isDayComplete`, `utcDay`, `Capability`, `Entitlement`, `ReviewState` from `core`.
- Produces, from `store.ts`: `Store<T> { get(), set(next), subscribe(listener): () => void }`; `createStore(initial)`.
- Produces, from `client.ts`: `ClientOptions { driver, env, l1, transport? }`; `ClientXp { total, today, provisional }`; `ClientSnapshot { deviceId, userId, corpus, states, settings, flags, unlocked, plan, progress, entitlement, xp, sync }`; `AnswerResult { event, dayCompleted, unlocked }`; `Client` with `open(options)`, `store`, `snapshot`, `installPacks(manifest, fetchPack)`, `startSession()`, `entry(wordId)`, `availableModes(wordId, cachedClips, online)`, `answer(input)`, `updateSettings(patch)`, `setFlag(wordId, flag)`, `report(input)`, `canUse(capability)`, `sync(options?)`, `attachUser(userId)`, `close()`.

The facade is what `web/` (plan 6) talks to. Every mutation goes through it, and every mutation ends in `refresh()`, which recomputes one immutable snapshot from the in-memory model and publishes it through the store. The snapshot carries `states` so the app can build `DistractorContext.encountered` and pick a mode per item with `core` directly; no learning rule lives here.

- [ ] **Step 1: Write the failing test**

`client-data/src/client.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Grade, type PackManifest } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { Client } from './client'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { AnswerInput } from './learner'
import type { PackFetcher } from './packs'
import { FakeServer } from './testing/fakeServer'
import { testEnv, type TestEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1-bg/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))
const answer = (wordId: string, over: Partial<AnswerInput> = {}): AnswerInput => ({
  wordId: wordId as AnswerInput['wordId'], mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1500, practice: false, ...over,
})

async function openClient(env: TestEnv = testEnv(), server?: FakeServer): Promise<Client> {
  const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg', ...(server ? { transport: server } : {}) })
  await client.installPacks(manifest, fromDisk)
  await client.startSession()
  return client
}

describe('Client', () => {
  it('opens empty, then serves a plan once a pack is active', async () => {
    const env = testEnv()
    const client = await Client.open({ driver: nodeSqliteDriver(), env, l1: 'bg' })
    expect(client.snapshot.corpus).toBeNull()
    expect(client.snapshot.plan).toBeNull()
    expect(client.snapshot.deviceId).toMatch(/^00000000/)
    await client.installPacks(manifest, fromDisk)
    expect(client.snapshot.corpus).toBeNull()
    expect(await client.startSession()).toEqual(['corpus-bg'])
    expect(client.snapshot.corpus?.entries.size).toBe(60)
    expect(client.snapshot.plan?.newWords).toHaveLength(10)
    expect(client.snapshot.progress?.tiers.new).toBe(60)
    expect(client.entry('c:hello-1')?.headword).toBe('hello')
  })

  it('records an answer, unlocks, completes the day and notifies subscribers', async () => {
    const client = await openClient()
    let notified = 0
    client.store.subscribe(() => {
      notified += 1
    })
    const first = await client.answer(answer('c:hello-1'))
    expect(first.unlocked).toEqual(['a1-01'])
    expect(first.dayCompleted).toBe(true)
    expect(client.snapshot.plan?.newWords).toHaveLength(9)
    expect(client.snapshot.plan?.newWords).not.toContain('c:hello-1')
    expect(client.snapshot.states.get('c:hello-1')?.reps).toBe(1)
    expect(client.snapshot.progress?.streak.todayComplete).toBe(true)
    expect(client.snapshot.xp).toEqual({ total: 10, today: 10, provisional: 10 })
    const second = await client.answer(answer('c:goodbye-1'))
    expect(second).toMatchObject({ dayCompleted: false, unlocked: [] })
    expect(notified).toBeGreaterThanOrEqual(2)
  })

  it('applies settings and flags to the plan', async () => {
    const client = await openClient()
    await client.updateSettings({ newWordLimit: 2 })
    expect(client.snapshot.settings.newWordLimit).toBe(2)
    expect(client.snapshot.plan?.newWords).toEqual(['c:hello-1', 'c:goodbye-1'])
    await client.setFlag('c:hello-1', 'known')
    expect(client.snapshot.plan?.newWords).toEqual(['c:goodbye-1', 'c:please-1'])
    expect(client.snapshot.progress?.tiers.new).toBe(59)
    await expect(client.updateSettings({ newWordLimit: 99 })).rejects.toThrow(/newWordLimit/)
  })

  it('syncs through the transport and reflects the server\'s XP and entitlement', async () => {
    const env = testEnv()
    const server = new FakeServer({ now: () => env.now(), accountCreatedAt: env.now() - 60_000 })
    server.setServerOwned('entitlement', '', { tier: 'free', source: 'default', expiresAt: null, quotas: { enrichmentPerDay: 20 } }, env.now() + 86_400_000)
    const client = await openClient(env, server)
    await client.answer(answer('c:hello-1'))
    expect(await client.sync()).toBe('synced')
    expect(client.snapshot.sync.lastSyncAt).toBe(env.now())
    expect(client.snapshot.xp).toEqual({ total: 10, today: 10, provisional: 0 })
    expect(client.snapshot.entitlement?.tier).toBe('free')
    expect(client.canUse('collections.theme')).toBe(true)
    expect(client.canUse('forecast')).toBe(false)
    expect(client.snapshot.plan?.newWords).toHaveLength(9)
  })

  it('files a report, attaches a user, and says listening needs a clip', async () => {
    const client = await openClient()
    expect(await client.report({ wordId: 'c:hello-1', field: 'audio', note: '', packVersion: 0 })).toMatch(/^00000000/)
    await client.attachUser('user-1')
    expect(client.snapshot.userId).toBe('user-1')
    expect([...client.availableModes('c:hello-1', new Set(), false)]).toEqual(['flashcard', 'multiple_choice'])
    expect([...client.availableModes('c:hello-1', new Set(['hello-1-uk']), false)]).toContain('listening_select')
    expect(await client.sync()).toBe('skipped')
    await client.close()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- client.test`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Write `store.ts` and `client.ts`**

`client-data/src/store.ts`:

```ts
/** A minimal external store: what `useSyncExternalStore` needs, and nothing React-specific. */
export interface Store<T> {
  get(): T
  set(next: T): void
  subscribe(listener: () => void): () => void
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: (next) => {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
```

`client-data/src/client.ts`:

```ts
import {
  canUse,
  isDayComplete,
  utcDay,
  type Capability,
  type Corpus,
  type CorpusEntry,
  type Entitlement,
  type Mode,
  type PackManifest,
  type ReviewEvent,
  type ReviewState,
  type SessionPlan,
  type Settings,
  type WordFlag,
  type WordId,
} from '@wordado/core'
import { Database } from './database'
import { addContentReport, addUnlocks, patchSettings, readAliases, readEntitlement, readFlags, readSettings, readUnlocks, setFlag, type ContentReportInput } from './documentTypes'
import type { SqlDriver } from './driver'
import type { ClientEnv } from './env'
import { appendAnswer, loadLearner, provisionalXp, recordDayComplete, type AnswerInput, type Learner } from './learner'
import { ensureDevice, getUserId, setUserId } from './meta'
import { activateStagedPacks, installPacks, loadActiveCorpus, type InstallReport, type PackFetcher } from './packs'
import { migrate } from './schema'
import { createStore, type Store } from './store'
import { availableModes, dayCompleteInput, entryOf, newUnlocks, progressView, sessionPlan, today, type ProgressView, type StudyContext } from './study'
import { INITIAL_SYNC_STATUS, readPulledXp, SyncEngine, type PulledXp, type SyncOutcome, type SyncStatus, type SyncTransport } from './sync'

export interface ClientOptions {
  readonly driver: SqlDriver
  readonly env: ClientEnv
  /** The learner's L1: which packs to install. */
  readonly l1: string
  /** Absent in demo mode and before sign-in: `sync` is then skipped. */
  readonly transport?: SyncTransport
}

/** Lifetime and today's XP: the server's figures plus what it has not counted yet (spec §8.7). */
export interface ClientXp {
  readonly total: number
  readonly today: number
  readonly provisional: number
}

export interface ClientSnapshot {
  readonly deviceId: string
  readonly userId: string | null
  readonly corpus: Corpus | null
  /** Current review state: the server's snapshot with this device's newer events on top. */
  readonly states: ReadonlyMap<WordId, ReviewState>
  readonly settings: Settings
  readonly flags: ReadonlyMap<WordId, WordFlag>
  readonly unlocked: ReadonlySet<string>
  readonly plan: SessionPlan | null
  readonly progress: ProgressView | null
  readonly entitlement: Entitlement | null
  readonly xp: ClientXp
  readonly sync: SyncStatus
}

export interface AnswerResult {
  readonly event: ReviewEvent
  /** True the one time an answer completes the day (spec §8.4). */
  readonly dayCompleted: boolean
  readonly unlocked: readonly string[]
}

/**
 * The one object `web/` talks to (spec §4.1). Every mutation ends in
 * `refresh`, which recomputes an immutable snapshot and publishes it.
 */
export class Client {
  readonly store: Store<ClientSnapshot>
  private corpus: Corpus | null = null
  private settings!: Settings
  private flags: Map<WordId, WordFlag> = new Map()
  private unlocked: Set<string> = new Set()
  private entitlement: Entitlement | null = null
  private userId: string | null = null
  private xp: PulledXp | null = null
  private readonly engine: SyncEngine | null

  private constructor(
    private readonly db: Database,
    private readonly env: ClientEnv,
    private readonly l1: string,
    private readonly learner: Learner,
    transport: SyncTransport | undefined,
  ) {
    this.engine = transport ? new SyncEngine({ db, env, learner, transport }) : null
    this.store = createStore<ClientSnapshot>(this.buildSnapshot())
    if (this.engine) this.engine.onStatus = () => this.refresh()
  }

  static async open(options: ClientOptions): Promise<Client> {
    const db = new Database(options.driver)
    await migrate(db)
    const deviceId = await ensureDevice(db, options.env)
    const learner = await loadLearner(db, deviceId, { aliases: await readAliases(db.driver) })
    const client = new Client(db, options.env, options.l1, learner, options.transport)
    client.corpus = await loadActiveCorpus(db)
    client.userId = await getUserId(db)
    client.xp = await readPulledXp(db.driver)
    await client.reloadDocuments()
    client.refresh()
    return client
  }

  get snapshot(): ClientSnapshot {
    return this.store.get()
  }

  private async reloadDocuments(): Promise<void> {
    this.settings = await readSettings(this.db.driver)
    this.flags = await readFlags(this.db.driver)
    this.unlocked = await readUnlocks(this.db.driver)
    this.entitlement = await readEntitlement(this.db.driver)
    this.learner.aliases = await readAliases(this.db.driver)
  }

  /** The study inputs as of now; null before a pack is active. */
  private context(): StudyContext | null {
    if (!this.corpus) return null
    return {
      corpus: this.corpus,
      learner: this.learner,
      settings: this.settings,
      flags: this.flags,
      unlocked: this.unlocked,
      now: this.env.now(),
      tzOffsetMin: this.env.tzOffsetMin(),
    }
  }

  private buildSnapshot(): ClientSnapshot {
    const ctx = this.context()
    const plan = ctx ? sessionPlan(ctx) : null
    const provisionalToday = provisionalXp(this.learner).byUtcDay.get(utcDay(this.env.now())) ?? 0
    const provisional = provisionalXp(this.learner).total
    const pulledToday = this.xp && this.xp.utcDay === utcDay(this.env.now()) ? this.xp.today : 0
    return {
      deviceId: this.learner.deviceId,
      userId: this.userId,
      corpus: this.corpus,
      states: this.learner.states,
      settings: this.settings,
      flags: this.flags,
      unlocked: this.unlocked,
      plan,
      progress: ctx && plan ? progressView(ctx, plan) : null,
      entitlement: this.entitlement,
      xp: { total: (this.xp?.total ?? 0) + provisional, today: pulledToday + provisionalToday, provisional },
      sync: this.engine?.status ?? INITIAL_SYNC_STATUS,
    }
  }

  private refresh(): void {
    this.store.set(this.buildSnapshot())
  }

  /** Fetches, verifies and stages newer packs for the learner's L1 (spec §5.1). Nothing changes until `startSession`. */
  installPacks(manifest: PackManifest, fetchPack: PackFetcher): Promise<InstallReport> {
    return installPacks(this.db, this.env, manifest, this.l1, fetchPack)
  }

  /** Swaps staged packs in and reloads the corpus. Call at the start of a session, never mid-session. */
  async startSession(): Promise<string[]> {
    const activated = await activateStagedPacks(this.db)
    if (activated.length > 0 || !this.corpus) this.corpus = await loadActiveCorpus(this.db)
    this.refresh()
    return activated
  }

  entry(wordId: WordId): CorpusEntry | null {
    return this.corpus ? entryOf(this.corpus, wordId) : null
  }

  availableModes(wordId: WordId, cachedClips: ReadonlySet<string>, online: boolean): Set<Mode> {
    const ctx = this.context()
    return ctx ? availableModes(ctx, wordId, cachedClips, online) : new Set<Mode>(['flashcard', 'multiple_choice'])
  }

  /** Records one answer, persists any new unit unlock, and records the completed day when it first becomes complete. */
  async answer(input: AnswerInput): Promise<AnswerResult> {
    const event = await appendAnswer(this.db, this.env, this.learner, input)
    const before = this.context()
    if (!before) {
      this.refresh()
      return { event, dayCompleted: false, unlocked: [] }
    }
    const unlocked = newUnlocks(before)
    if (unlocked.length > 0) {
      await this.db.transaction((tx) => addUnlocks(tx, unlocked))
      this.unlocked = new Set([...this.unlocked, ...unlocked])
    }
    const ctx = this.context()!
    const plan = sessionPlan(ctx)
    const dayCompleted = isDayComplete(dayCompleteInput(ctx, plan)) && (await recordDayComplete(this.db, this.learner, today(ctx), this.env.now()))
    this.refresh()
    return { event, dayCompleted, unlocked }
  }

  async updateSettings(patch: Record<string, unknown>): Promise<Settings> {
    this.settings = await this.db.transaction((tx) => patchSettings(tx, patch))
    this.refresh()
    return this.settings
  }

  async setFlag(wordId: WordId, flag: WordFlag | null): Promise<void> {
    await this.db.transaction((tx) => setFlag(tx, wordId, flag))
    this.flags = await readFlags(this.db.driver)
    this.refresh()
  }

  /** Files a content report; it syncs like any document (spec §8.10). */
  report(input: ContentReportInput): Promise<string> {
    return this.db.transaction((tx) => addContentReport(tx, this.env, input))
  }

  /** The one capability check (spec §8.8): the cached entitlement, honoured until its expiry. */
  canUse(capability: Capability): boolean {
    return canUse(capability, this.entitlement, this.env.now())
  }

  async sync(options: { force?: boolean } = {}): Promise<SyncOutcome> {
    if (!this.engine) return 'skipped'
    const outcome = await this.engine.sync(options)
    if (outcome === 'synced') {
      await this.reloadDocuments()
      this.xp = await readPulledXp(this.db.driver)
    }
    this.refresh()
    return outcome
  }

  /** Binds this database to an account (demo carry-over, spec §8.6). Every row stays. */
  async attachUser(userId: string): Promise<void> {
    await this.db.transaction((tx) => setUserId(tx, userId))
    this.userId = userId
    this.refresh()
  }

  close(): Promise<void> {
    return this.db.close()
  }
}
```

`buildSnapshot` runs once from the constructor before `reloadDocuments`; the definite-assignment assertion on `settings` covers that call, and nothing reads the field until `open` has finished.

Append to `client-data/src/index.ts`:

```ts
export * from './store'
export * from './client'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `client.test.ts` has 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): the Client facade and its snapshot store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: React hooks

**Files:**
- Create: `client-data/src/react.ts`
- Modify: `client-data/src/index.ts`
- Test: `client-data/src/react.test.tsx`

**Interfaces:**
- Consumes: `Client`, `ClientSnapshot` (Task 9); `react`.
- Produces: `ClientProvider({ client, children })`; `useClient(): Client`; `useClientSnapshot(): ClientSnapshot`; `useSessionPlan()`; `useProgress()`; `useSettings()`; `useSyncStatus()`.

Presentation-agnostic (spec §4.1): the hooks read the store and nothing else, so `web/` and a future `mobile/` render the same snapshot.

- [ ] **Step 1: Write the failing test**

`client-data/src/react.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, cleanup, render, screen } from '@testing-library/react'
import { Grade, type PackManifest } from '@wordado/core'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from './client'
import { nodeSqliteDriver } from './drivers/nodeSqlite'
import type { PackFetcher } from './packs'
import { ClientProvider, useClient, useProgress, useSessionPlan, useSyncStatus } from './react'
import { testEnv } from './testing/testEnv'

const SAMPLE_DIR = fileURLToPath(new URL('../../pipeline/samples/a1-bg/', import.meta.url))
const manifest = JSON.parse(readFileSync(join(SAMPLE_DIR, 'manifest.json'), 'utf8')) as PackManifest
const fromDisk: PackFetcher = async (d) => new Uint8Array(readFileSync(join(SAMPLE_DIR, d.url)))

function Home() {
  const plan = useSessionPlan()
  const progress = useProgress()
  const sync = useSyncStatus()
  return (
    <div>
      <span data-testid="new">{plan?.newWords.length ?? -1}</span>
      <span data-testid="tier-new">{progress?.tiers.new ?? -1}</span>
      <span data-testid="phase">{sync.phase}</span>
    </div>
  )
}

afterEach(cleanup)

describe('hooks', () => {
  it('render the snapshot and follow it as the client changes', async () => {
    const client = await Client.open({ driver: nodeSqliteDriver(), env: testEnv(), l1: 'bg' })
    await client.installPacks(manifest, fromDisk)
    await client.startSession()
    render(
      <ClientProvider client={client}>
        <Home />
      </ClientProvider>,
    )
    expect(screen.getByTestId('new').textContent).toBe('10')
    expect(screen.getByTestId('tier-new').textContent).toBe('60')
    expect(screen.getByTestId('phase').textContent).toBe('idle')
    await act(async () => {
      await client.answer({ wordId: 'c:hello-1', mode: 'multiple_choice', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 1200, practice: false })
    })
    expect(screen.getByTestId('new').textContent).toBe('9')
    expect(screen.getByTestId('tier-new').textContent).toBe('59')
  })

  it('refuse to run outside a provider', () => {
    function Bare() {
      useClient()
      return null
    }
    expect(() => render(<Bare />)).toThrow(/ClientProvider/)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wordado/client-data test -- react.test`
Expected: FAIL — cannot resolve `./react`.

- [ ] **Step 3: Write `react.ts`**

`client-data/src/react.ts`:

```ts
import { createContext, createElement, useContext, useSyncExternalStore, type ReactNode } from 'react'
import type { Client, ClientSnapshot } from './client'

const ClientContext = createContext<Client | null>(null)

export function ClientProvider(props: { readonly client: Client; readonly children?: ReactNode }) {
  return createElement(ClientContext.Provider, { value: props.client }, props.children)
}

export function useClient(): Client {
  const client = useContext(ClientContext)
  if (!client) throw new Error('useClient must be used inside a ClientProvider')
  return client
}

/** The whole snapshot; re-renders on every change. The narrower hooks below are the usual choice. */
export function useClientSnapshot(): ClientSnapshot {
  const { store } = useClient()
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

export function useSessionPlan(): ClientSnapshot['plan'] {
  return useClientSnapshot().plan
}

export function useProgress(): ClientSnapshot['progress'] {
  return useClientSnapshot().progress
}

export function useSettings(): ClientSnapshot['settings'] {
  return useClientSnapshot().settings
}

export function useSyncStatus(): ClientSnapshot['sync'] {
  return useClientSnapshot().sync
}
```

Append to `client-data/src/index.ts`:

```ts
export * from './react'
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test && pnpm typecheck`
Expected: all green; `react.test.tsx` has 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add client-data/src
git commit -m "feat(client-data): React hooks over the client store

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Contracts this plan hands to the later plans

- **The sync endpoints are `testing/fakeServer.ts`, made real** (plan 5): a window per `pushId` opened on page 0 and the `StampCarry` threaded across pages; duplicates on `reviewId` dropped before stamping; the device mark advanced to the highest stamped `(deviceSeq, effectiveTs)`; a `day_complete` accepted only when the log holds an answer on that local date; documents through `applyPatch` with `nextVersion` from one per-user counter and `unit_unlock` unioned before the patch; a write to a server-owned document rejected with `server_owned`; a pull that is the whole derived state, the marks, the trailing 90 days of summary, every completed date, documents above `documentsSince`, and XP; `upgrade_required` whenever `protocolVersion < min`. The server validates `clientTzOffsetMin` with `isValidTzOffset`, settings with `validateSettingsPatch` field by field, and aliases as `u:` → `c:` and acyclic (roadmap contracts).
- **Rejected document writes are dropped, not retried** (plans 5, 6): the client forgets the patch and the next pull restores the server's fields, so a server that rejects must do so deterministically.
- **`SqlDriver` is the whole platform contract** (plan 6): `exec`, `run`, `all`, `close` over one connection, statements in call order, parameters positional, `Uint8Array` for blobs. Transactions are `client-data`'s (`BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` through `exec`); the driver must not open its own.
- **`ClientEnv` on the web** (plan 6): `Date.now`, `-new Date().getTimezoneOffset()`, `crypto.randomUUID`, an `Rng` over `crypto.getRandomValues` or `Math.random`, and `crypto.subtle.digest('SHA-256')` as lowercase hex.
- **`SyncTransport` on the web** (plan 6): two `fetch` calls with the session's credentials that throw on any non-2xx or network failure; the engine treats every throw as a retryable failure.
- **`PackFetcher`** (plan 6) resolves `descriptor.url` against the manifest's URL with `new URL`, and reads the bundled demo sample from the app's own assets under the same layout.
- **Session lifecycle** (plan 6): `startSession()` at the start of every study session (it swaps in staged packs); `sync()` after every session and on `visibilitychange`; `installPacks` on launch and on a periodic check; `availableModes(wordId, cachedClips, online)` per item, with `chooseMode(masteryTier(states.get(wordId)), modes, rng)` from `core`; `DistractorContext` built from `snapshot.corpus.entries.values()` and `snapshot.states.keys()`.
- **Demo mode** (plan 6): a `Client` over an in-memory driver and no `transport`; on sign-up `attachUser` and open a `transport`, and the first push presents the device as never seen (spec §9.2 step 3). On sign-in to an existing account, discard the client.
- **Schema changes are migrations** (every later plan): append to `MIGRATIONS`, bump `SCHEMA_VERSION`, and add the previous DDL to `SHIPPED_SCHEMAS` so the migration test covers it.

Left for later plans: the audio prefetch horizon and clip cache (plan 6, spec §9.3); Web Push subscription documents (plans 5, 6, spec §8.11); user words and aliases beyond the read path (Phase 2); the client's data export and account deletion, which are server endpoints (plan 5, spec §11).
