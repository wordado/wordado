import type { Hono } from 'hono'
import type { DecisionResult } from '../../server/types'
import { invalidDecision } from '../../shared/apply'
import type { HostedDecisionRequest } from '../../shared/hosted'
import { apiError, jsonBody, type AppEnv, type Deps } from '../app'
import { deleteDecision, listDecisions, listSubmissions, upsertDecision } from '../db'
import { scopeFiles } from '../rows'
import { currentSnapshot } from '../snapshotStore'
import { NO_SNAPSHOT, ownAssignment } from './reviewer'

const fail = (reason: 'changed' | 'gone' | 'invalid', message: string): DecisionResult => ({ ok: false, reason, message })

export function decisionRoutes(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/api/decision', async (c) => {
    const req = await jsonBody<HostedDecisionRequest>(c)
    const a = await ownAssignment(deps, c.get('me').email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    const snap = await currentSnapshot(deps)
    if (!snap) return apiError(c, 503, NO_SNAPSHOT)
    if (req.queue !== a.queue || !scopeFiles(snap, a).includes(req.file)) return apiError(c, 403, 'this row is not in your assignment')
    const rules = snap.queue(a.queue)!
    const invalid = invalidDecision(rules, req.action)
    if (invalid) return c.json(fail('invalid', invalid), 400)
    const cells = req.cells ?? {}
    const bad = Object.keys(cells).find((k) => !rules.columns.includes(k) || typeof cells[k] !== 'string')
    if (bad !== undefined) return c.json(fail('invalid', `${bad} cannot be edited in ${a.queue}`), 400)
    if (req.note !== undefined && typeof req.note !== 'string') return c.json(fail('invalid', 'the note must be text'), 400)
    const file = await snap.file(req.file)
    if (!file) return apiError(c, 503, NO_SNAPSHOT)
    const row = file.rows.find((r) => r.key === req.key)
    if (!row) return c.json(fail('gone', `${req.key} is no longer in ${req.file}`), 410)
    if (row.rowHash !== req.rowHash) return c.json(fail('changed', `${req.key} changed since it was loaded`), 409)
    // A decision in an open or merged submission is final for the row it was made on; one in a closed (unmerged)
    // submission can be decided again. So can a merged one once the row has changed: a newer draft proposes
    // something else, the merged decision does not settle it, and the row waits in a fresh sheet (level queue, 2026-10-08).
    const status = new Map((await listSubmissions(deps.env.DB, { assignment: a.id })).map((s) => [s.id, s.status]))
    const existing = (await listDecisions(deps.env.DB, a.id)).find((d) => d.key === req.key)
    const of = existing?.submission != null ? status.get(existing.submission) : 'closed'
    const settled = of === 'open' || (of === 'merged' && existing!.rowHash === row.rowHash)
    if (settled) return c.json(fail('changed', `${req.key} is already submitted`), 409)
    await upsertDecision(deps.env.DB, {
      assignment: a.id, queue: a.queue, file: req.file, key: req.key, rowHash: req.rowHash, action: req.action,
      cells, note: req.note ?? '', decidedAt: deps.now().toISOString(), submission: null,
    })
    return c.json({ ok: true, version: row.rowHash } satisfies DecisionResult)
  })

  app.delete('/api/decision', async (c) => {
    const req = await jsonBody<{ assignment?: unknown; key?: unknown }>(c)
    const a = await ownAssignment(deps, c.get('me').email, Number(req.assignment))
    if (!a) return apiError(c, 403, 'not your assignment')
    if (typeof req.key !== 'string') return apiError(c, 400, 'a key is needed')
    await deleteDecision(deps.env.DB, a.id, req.key)
    return c.json({ ok: true })
  })
}
