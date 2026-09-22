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
  grade INTEGER NOT NULL CHECK (grade BETWEEN 1 AND 4),
  latency_ms INTEGER NOT NULL,
  practice INTEGER NOT NULL CHECK (practice IN (0, 1)),
  client_ts INTEGER NOT NULL,
  client_tz_offset_min INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  device_seq INTEGER NOT NULL,
  scheduler_version TEXT NOT NULL,
  pushed INTEGER NOT NULL DEFAULT 0 CHECK (pushed IN (0, 1))
);
CREATE UNIQUE INDEX review_event_device ON review_event (device_id, device_seq);
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
  pushed INTEGER NOT NULL DEFAULT 0 CHECK (pushed IN (0, 1))
);
CREATE TABLE document (
  type TEXT NOT NULL,
  key TEXT NOT NULL,
  class TEXT NOT NULL CHECK (class IN ('versioned', 'server_owned')),
  version INTEGER NOT NULL,
  fields TEXT NOT NULL,
  field_versions TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
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
