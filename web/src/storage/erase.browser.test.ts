import { describe, expect, it } from 'vitest'
import { deleteDatabase } from './erase'
import { openWorkerDriver } from './workerDriver'

const unique = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`

async function write(file: string, backend: 'opfs' | 'idb', value: string): Promise<void> {
  const { driver } = await openWorkerDriver(file, [backend])
  await driver.exec('CREATE TABLE t (v TEXT)')
  await driver.run('INSERT INTO t VALUES (?)', [value])
  await driver.close()
}

async function tables(file: string, backend: 'opfs' | 'idb'): Promise<unknown[]> {
  const { driver } = await openWorkerDriver(file, [backend])
  const rows = await driver.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
  await driver.close()
  return rows.map((r) => r.name)
}

describe('deleteDatabase (spec §8.6: leaving the demo deletes it)', () => {
  for (const backend of ['opfs', 'idb'] as const) {
    it(`leaves nothing of the file on ${backend}, and nothing else is touched`, async () => {
      const file = unique('erase')
      const neighbour = `${file}b`
      await write(file, backend, 'gone')
      await write(neighbour, backend, 'kept')
      await deleteDatabase(file)
      expect(await tables(file, backend)).toEqual([])
      const { driver } = await openWorkerDriver(neighbour, [backend])
      expect(await driver.all('SELECT v FROM t')).toEqual([{ v: 'kept' }])
      await driver.close()
    })
  }

  it('does nothing for a file that was never written', async () => {
    await expect(deleteDatabase(unique('never'))).resolves.toBeUndefined()
  })
})
