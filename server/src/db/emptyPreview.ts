import type { Db } from './db'

/** The one-time SQL that marks a database as the preview's (docs/deploy.md, step 2). */
export const PREVIEW_MARKER_SQL =
  "create schema wordado_env; create table wordado_env.environment (name text not null); insert into wordado_env.environment values ('preview');"

/**
 * Drops every table in `public`, the migration record included, and then every function in `public`
 * that no extension owns (a migration's trigger function would otherwise survive the tables and stop
 * the same migration from running again), so that the preview deploy then
 * applies its own branch's migrations from the start (#205): the preview database is shared by every
 * pull request, and another branch's migration, or one edited during review, would otherwise stop the
 * strict check in `migrate`. Refuses a database without the preview marker, which lives outside
 * `public` and so survives: a production URL in the preview's secret fails the deploy instead.
 * Takes the migration lock. Returns the names it dropped: the tables, then the functions.
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
    const functions = await tx.query<{ name: string; args: string }>(
      `select p.proname as name, pg_get_function_identity_arguments(p.oid) as args
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        order by p.proname, args`,
    )
    for (const f of functions) {
      await tx.query(`drop function public."${f.name.replaceAll('"', '""')}"(${f.args}) cascade`)
    }
    return [...tables.map((t) => t.name), ...functions.map((f) => f.name)]
  })
}
