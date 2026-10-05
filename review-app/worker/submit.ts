import { csvRecords } from '@wordado/pipeline/csv'
import { applyDecisions, type QueueRules } from '../shared/apply'
import type { SubmitResult } from '../shared/hosted'
import { rowHash } from '../shared/rowHash'
import type { Deps } from './app'
import { insertSubmission, listDecisions, listReviewers, listSubmissions, markSubmitted, type AssignmentRow, type DecisionRow, type ReviewerRow } from './db'
import type { GitHub } from './github'
import { reviewMailer } from './mail'

export function branchSlug(name: string, email: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug(name) || slug(email.split('@')[0] ?? '') || 'reviewer'
}

const AUTHOR_EMAIL = 'review@wordado.com'

/** Spec §7.2: the assignment's unsubmitted decisions, checked against main, as one commit and one pull request. */
export async function submit(deps: Deps, me: ReviewerRow, a: AssignmentRow, gh: GitHub, rules: QueueRules): Promise<SubmitResult | { status: 400; message: string }> {
  const pending = (await listDecisions(deps.env.DB, a.id)).filter((d) => d.submission === null)
  if (pending.length === 0) return { status: 400, message: 'nothing to submit' }
  const head = await gh.headSha()
  const byFile = new Map<string, DecisionRow[]>()
  for (const d of pending) byFile.set(d.file, [...(byFile.get(d.file) ?? []), d])
  const leftOut: { key: string; reason: 'changed' | 'gone' }[] = []
  const files: { path: string; content: string }[] = []
  const sent: DecisionRow[] = []
  for (const [file, decisions] of byFile) {
    const csv = await gh.readText(file, head)
    const sidecarText = await gh.readText(file.replace(/\.csv$/, '.json'), head)
    if (csv === null || sidecarText === null) {
      for (const d of decisions) leftOut.push({ key: d.key, reason: 'gone' })
      continue
    }
    const proposals = new Map((JSON.parse(sidecarText) as { items: { key: string; proposed: unknown }[] }).items.map((i) => [i.key, i.proposed]))
    const reopened = new Map(csvRecords(csv).rows.map((r) => [(r['key'] ?? '').trim(), r['reopened'] ?? '']))
    const ok: DecisionRow[] = []
    for (const d of decisions) {
      if (!proposals.has(d.key) || !reopened.has(d.key)) leftOut.push({ key: d.key, reason: 'gone' })
      else if ((await rowHash(a.queue, proposals.get(d.key), reopened.get(d.key)!)) !== d.rowHash) leftOut.push({ key: d.key, reason: 'changed' })
      else ok.push(d)
    }
    if (ok.length === 0) continue
    const out = applyDecisions(csv, rules, ok.map((d) => ({ key: d.key, action: d.action, cells: d.cells, note: d.note })))
    for (const key of out.missing) leftOut.push({ key, reason: 'gone' })
    if (out.applied.length === 0) continue
    files.push({ path: file, content: out.text })
    sent.push(...ok.filter((d) => out.applied.includes(d.key)))
  }
  if (sent.length === 0) return { status: 400, message: `nothing could be submitted: ${leftOut.length} rows changed or are gone` }

  const day = deps.now().toISOString().slice(0, 10).replaceAll('-', '')
  const base = `review/${a.queue}-${branchSlug(me.name, me.email)}-${day}`
  const message = `review: ${a.queue}, ${sent.length} decisions by ${me.name}`
  let n = (await listSubmissions(deps.env.DB, { assignment: a.id })).filter((s) => s.branch.startsWith(`${base}-`)).length + 1
  let branch = `${base}-${n}`
  for (;;) {
    const made = await gh.commitFiles({ parent: head, branch, message, author: { name: me.name, email: AUTHOR_EMAIL }, files })
    if ('commit' in made) break
    n += 1
    if (n > 20) throw new Error('could not find a free branch name')
    branch = `${base}-${n}`
  }
  const counts = (['accept', 'keep', 'edit', 'drop'] as const).map((k) => `${k} ${sent.filter((d) => d.action === k).length}`).join(', ')
  const perFile = files.map((f) => `- ${f.path}: ${sent.filter((d) => d.file === f.path).length}`).join('\n')
  const notes = sent.filter((d) => d.note !== '').map((d) => `- ${d.key}: ${d.note}`).join('\n')
  const body = `Submitted by ${me.name} in the review app.\n\n${counts}\n\n${perFile}${notes ? `\n\nNotes:\n${notes}` : ''}${leftOut.length ? `\n\nLeft out (changed or gone since decided): ${leftOut.map((l) => l.key).join(', ')}` : ''}`
  const pr = await gh.openPr({ title: `${a.queue}: ${sent.length} decisions by ${me.name}`, head: branch, body })
  const submission = await insertSubmission(deps.env.DB, { assignment: a.id, branch, pr: pr.number, url: pr.url, count: sent.length, leftOut: leftOut.length, status: 'open', createdAt: deps.now().toISOString() })
  await markSubmitted(deps.env.DB, a.id, sent.map((d) => d.key), submission)
  const admins = (await listReviewers(deps.env.DB)).filter((r) => r.role === 'admin' && !r.disabledAt).map((r) => r.email)
  try {
    await reviewMailer(deps).submitted(admins, { name: me.name, count: sent.length, queue: a.queue, url: pr.url })
  } catch (err) {
    deps.log(`submit notice not sent: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { pr: pr.number, url: pr.url, count: sent.length, leftOut }
}
