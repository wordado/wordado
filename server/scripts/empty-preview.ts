import { createPool, pgDb } from '../src/db/db'
import { emptyPreview } from '../src/db/emptyPreview'

/** Empties the preview's database before its migrations run (#205); refuses any database not marked as the preview. */
const url = process.env['DATABASE_URL']
if (!url) throw new Error('DATABASE_URL is not set')
const db = pgDb(createPool(url, 1))
try {
  const dropped = await emptyPreview(db)
  console.log(dropped.length === 0 ? 'Preview database: already empty' : `Preview database emptied: ${dropped.length} tables dropped`)
} finally {
  await db.end()
}
