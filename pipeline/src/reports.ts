import { LEGACY_L1, REPORT_FIELDS, type ReportField } from '@wordado/core'
import pg from 'pg'
import { currentClips, type AudioRecord } from './audio'
import { sha256Hex } from './checksum'
import { QUEUES, type DecisionEvent, type Decisions } from './decisions'
import type { Fix } from './lastPublished'

/** A content report as triage sees it: the reporter pseudonymous, never the user ID (spec §11). */
export interface ReportRow {
  readonly id: number
  readonly word_id: string
  readonly field: ReportField
  readonly note: string
  /** The corpus version the learner was looking at. */
  readonly pack_version: number
  /** A hash of the reporter, or `deleted:<report id>` once the account is gone (each counts once). */
  readonly reporter: string
  /** Epoch milliseconds. */
  readonly received_at: number
  /** The L1 the report was made in, or null for one made before plan 10. */
  readonly l1: string | null
}

/** Plan 5's table (server/migrations/0001_init.sql), plan 10's l1 column. The role that runs this can select from it and nothing else. */
export const REPORTS_SQL = 'select id, word_id, field, note, pack_version, reporter_id, received_at, l1 from content_report order by id'

const hash = (s: string) => sha256Hex(new TextEncoder().encode(s)).slice(0, 16)

export async function pullReports(query: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>): Promise<ReportRow[]> {
  const { rows } = await query(REPORTS_SQL)
  return rows.flatMap((row) => {
    const field = String(row['field'])
    if (!(REPORT_FIELDS as readonly string[]).includes(field)) return []
    const id = Number(row['id'])
    const reporter = row['reporter_id']
    const l1 = row['l1']
    return [
      {
        id,
        word_id: String(row['word_id']),
        field: field as ReportField,
        note: String(row['note'] ?? ''),
        pack_version: Number(row['pack_version']),
        reporter: typeof reporter === 'string' && reporter !== '' ? hash(reporter) : `deleted:${id}`,
        received_at: Number(row['received_at']),
        l1: typeof l1 === 'string' && l1 !== '' ? l1 : null,
      },
    ]
  })
}

export interface TriageInput {
  readonly reports: readonly ReportRow[]
  readonly decisions: Decisions
  readonly records: readonly AudioRecord[]
  readonly fixes: readonly Fix[]
  readonly live: ReadonlySet<string>
  readonly l1s: readonly string[]
  readonly threshold: number
  readonly now: string
}

const NOTE_LIMIT = 280

/** Which queue a report sends its entry to, which fixes reset its count, and (for translation) which L1 those fixes must be. Audio is handled apart. */
function routes(field: ReportField, l1s: readonly string[], reportL1: string | null): { queue: string; fixField: ReportField; l1: string }[] {
  if (field === 'example') return [{ queue: QUEUES.english, fixField: 'example', l1: '' }]
  if (field === 'level') return [{ queue: QUEUES.level, fixField: 'level', l1: '' }]
  // A report names the L1 it was made in; one from before plan 10 names none, and counts as Bulgarian (every
  // report made before plan 10 came from a Bulgarian learner, the same reading core/src/fixes.ts gives a fix
  // with no l1). A report naming an L1 the pipeline no longer carries reopens no translation queue.
  const own = [reportL1 ?? LEGACY_L1].filter((l1) => l1s.includes(l1))
  return own.map((l1) => ({ queue: QUEUES.translation(l1), fixField: 'translation' as ReportField, l1 }))
}

/**
 * Reports since a field last changed and since its last reopen, from
 * distinct reporters, reopen the field at the threshold (spec §8.10). A
 * single audio report remakes the entry's current clips made before it.
 */
export function triage(input: TriageInput): { events: { queue: string; event: DecisionEvent }[]; summary: string[] } {
  const events: { queue: string; event: DecisionEvent }[] = []
  const summary: string[] = []
  const lastFix = new Map<string, number>()
  for (const f of input.fixes) {
    const l1 = f.field === 'translation' ? (f.l1 ?? LEGACY_L1) : ''
    const key = `${f.word_id}|${f.field}|${l1}`
    lastFix.set(key, Math.max(lastFix.get(key) ?? 0, f.fixed_in))
  }

  const groups = new Map<string, { queue: string; entryId: string; reports: ReportRow[] }>()
  const audio = new Map<string, ReportRow[]>()
  for (const report of input.reports) {
    if (!report.word_id.startsWith('c:')) continue
    const entryId = report.word_id.slice(2)
    if (!input.live.has(entryId)) continue
    if (report.field === 'audio') {
      audio.set(entryId, [...(audio.get(entryId) ?? []), report])
      continue
    }
    for (const { queue, fixField, l1 } of routes(report.field, input.l1s, report.l1)) {
      if (report.pack_version < (lastFix.get(`${report.word_id}|${fixField}|${l1}`) ?? 0)) continue
      const key = `${queue}|${entryId}`
      const g = groups.get(key) ?? { queue, entryId, reports: [] }
      g.reports.push(report)
      groups.set(key, g)
    }
  }

  for (const g of [...groups.values()].sort((a, b) => (a.queue === b.queue ? (a.entryId < b.entryId ? -1 : 1) : a.queue < b.queue ? -1 : 1))) {
    const reopenedAt = Math.max(0, ...input.decisions.for(g.queue, g.entryId).filter((e) => e.verdict === 'reopen').map((e) => Date.parse(e.at)))
    const fresh = g.reports.filter((x) => x.received_at > reopenedAt)
    const reporters = new Set(fresh.map((x) => x.reporter))
    if (reporters.size < input.threshold) continue
    const fields = [...new Set(fresh.map((x) => x.field))].sort().join(', ')
    const notes = fresh.map((x) => x.note.trim()).filter((n) => n !== '').join(' / ')
    const note = `${reporters.size} reports (${fields})${notes ? `: ${notes}` : ''}`.slice(0, NOTE_LIMIT)
    events.push({ queue: g.queue, event: { key: g.entryId, at: input.now, verdict: 'reopen', by: 'reports', note } })
    summary.push(`${g.entryId}: ${g.queue} reopened (${reporters.size} reports)`)
  }

  const current = currentClips(input.records)
  for (const [entryId, reports] of [...audio].sort(([a], [b]) => (a < b ? -1 : 1))) {
    for (const clip of [...current.values()].filter((c) => c.entry_id === entryId)) {
      if (input.decisions.for(QUEUES.audio, clip.clip_id).some((e) => e.verdict === 'redo')) continue
      const after = reports.filter((x) => x.received_at > Date.parse(clip.created_at))
      if (after.length === 0) continue
      events.push({
        queue: QUEUES.audio,
        event: { key: clip.clip_id, at: input.now, verdict: 'redo', proposed: clip.clip_id, by: 'reports', note: `${after.length} report${after.length === 1 ? '' : 's'}` },
      })
      summary.push(`${clip.clip_id}: remade at the next corpus audio (${after.length} report${after.length === 1 ? '' : 's'})`)
    }
  }
  return { events, summary }
}

/** A read-only connection to the store of record (runbook: the corpus_reports role). */
export async function pgQuery(url: string) {
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  return {
    query: (sql: string) => client.query(sql) as Promise<{ rows: Record<string, unknown>[] }>,
    close: () => client.end(),
  }
}
