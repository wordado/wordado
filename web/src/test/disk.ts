import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SqlDriver, SyncTransport } from '@wordado/client-data'
import { nodeSqliteDriver } from '@wordado/client-data/src/drivers/nodeSqlite'
import type { FakeServer } from '@wordado/client-data/src/testing/fakeServer'
import { Grade, type WordId } from '@wordado/core'

/**
 * A SQLite file on disk without the durability a real device needs. With
 * SQLite's defaults every commit creates, fsyncs and unlinks a rollback
 * journal and fsyncs the file, and a test over `disk()` makes up to 25
 * commits: those tests were the slow ones on a loaded CI runner (one timed out
 * at 5 s while a Postgres image was being extracted beside the suite), and
 * under local load their journal files made them far slower than the same
 * work in memory. The suites close a file before reopening it and never crash a
 * process mid-write, so neither the journal on disk nor the fsyncs are part of
 * what they prove: a commit is in the file for the next open either way, and
 * a rollback still undoes a failed transaction.
 */
export async function fileDriver(path: string): Promise<SqlDriver> {
  const driver = nodeSqliteDriver(path)
  await driver.exec('PRAGMA synchronous = OFF; PRAGMA journal_mode = MEMORY')
  return driver
}

/** Database files on disk, one per name, as OPFS would keep them: they survive a close and a reopen. */
export function disk() {
  const dir = mkdtempSync(join(tmpdir(), 'wordado-web-'))
  const path = (file: string) => join(dir, `${file}.sqlite`)
  return {
    path,
    exists: (file: string) => existsSync(path(file)),
    openDriver: async (file: string) => ({ driver: await fileDriver(path(file)), backend: 'opfs' as const }),
    deleteDatabase: async (file: string) => rmSync(path(file), { force: true }),
    /** Every file kept, by the name `openDriver` takes, as `listDatabases` reads OPFS. */
    listDatabases: async () =>
      readdirSync(dir)
        .filter((name) => name.endsWith('.sqlite'))
        .map((name) => name.slice(0, -'.sqlite'.length))
        .sort(),
  }
}

/** One answer to a word of the sample. */
export const answerTo = (wordId: string) => ({
  wordId: wordId as WordId,
  mode: 'flashcard' as const,
  direction: 'en_to_l1' as const,
  grade: Grade.Good,
  latencyMs: 2_000,
  practice: false,
})

/** A transport over `server` that fails while `online` is false, as a device offline would. */
export function flaky(server: FakeServer): SyncTransport & { online: boolean } {
  const t = {
    online: false,
    push: (page: Parameters<SyncTransport['push']>[0]) => (t.online ? server.push(page) : Promise.reject(new Error('offline'))),
    pull: (request: Parameters<SyncTransport['pull']>[0]) => (t.online ? server.pull(request) : Promise.reject(new Error('offline'))),
  }
  return t
}
