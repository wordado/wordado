import { afterAll, beforeEach } from 'vitest'
import { closeTestDb, resetDb } from './db'

beforeEach(async () => {
  await resetDb()
})

afterAll(async () => {
  await closeTestDb()
})
