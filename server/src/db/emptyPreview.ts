import type { Db } from './db'

/** The one-time SQL that marks a database as the preview's (docs/deploy.md, step 2). */
export const PREVIEW_MARKER_SQL =
  "create schema wordado_env; create table wordado_env.environment (name text not null); insert into wordado_env.environment values ('preview');"

/**
 * Drops every table in `public`, the migration record included, so that the preview deploy then
 * applies its own branch's migrations from the start (#205): the preview database is shared by every
 * pull request, and another branch's migration, or one edited during review, would otherwise stop the
 * strict check in `migrate`. Refuses a database without the preview marker, which lives outside
 * `public` and so survives: a production URL in the preview's secret fails the deploy instead.
 * Takes the migration lock. Returns the names it dropped.
 */
export async function emptyPreview(db: Db): Promise<string[]> {
  return db.transaction(async (tx) => {
    await tx.query('select pg_advisory_xact_lock(7271)')
    const marked = await tx.query<{ preview: boolean }>(
      `select to_regclass('wordado_env.environment') is not null as preview`,
    )
    const names = marked[0]?.preview
      ? await tx.query<{ name: string }>('select name from wordado_env.environment')
      : []
    if (names.length !== 1 || names[0]?.name !== 'preview') {
      throw new Error(`This database is not marked as the preview: refusing to empty it. Mark the preview's once with: ${PREVIEW_MARKER_SQL}`)
    }
    const tables = await tx.query<{ name: string }>(
      `select tablename as name from pg_tables where schemaname = 'public' order by tablename`,
    )
    if (tables.length > 0) {
      await tx.query(`drop table ${tables.map((t) => `public."${t.name.replaceAll('"', '""')}"`).join(', ')} cascade`)
    }
    return tables.map((t) => t.name)
  })
}
