import { csvRecords } from '@wordado/pipeline/csv'
import { applyDecisions, type QueueRules } from '../shared/apply'
import type { SubmitResult } from '../shared/hosted'
import { rowHash } from '../shared/rowHash'
import type { Deps } from './app'
import { claimSubmission, completeSubmission, listDecisions, listReviewers, listSubmissions, pendingClaim, releaseSubmission, setSubmissionBranch, type AssignmentRow, type DecisionRow, type ReviewerRow, type SubmissionRow } from './db'
import type { GitHub } from './github'
import { reviewMailer } from './mail'

export function branchSlug(name: string, email: string): string {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug(name) || slug(email.split('@')[0] ?? '') || 'reviewer'
}

const AUTHOR_EMAIL = 'review@wordado.com'
const IN_PROGRESS = 'A submit is already in progress for this assignment. Try again in a minute.'
/** How long a claim with no pull request is taken for a submit still running, before it is given up. */
const CLAIM_GRACE_MS = 2 * 60_000

/**
 * Settles a claim that has no pull request recorded (a submit cut off mid-way, or one whose record failed after
 * the pull request opened): completes it when GitHub has a pull request for its branch, releases it once it is
 * older than the grace period, and otherwise leaves it as a submit still running.
 */
export async function settleClaim(deps: Deps, gh: GitHub, claim: SubmissionRow): Promise<{ state: 'completed'; pr: number; url: string } | { state: 'released' } | { state: 'running' }> {
  const found = await gh.findPr(claim.branch)
  if (found) {
    await completeSubmission(deps.env.DB, claim.id, found.number, found.url)
    return { state: 'completed', pr: found.number, url: found.url }
  }
  if (deps.now().getTime() - Date.parse(claim.createdAt) < CLAIM_GRACE_MS) return { state: 'running' }
  await releaseSubmission(deps.env.DB, claim.id)
  return { state: 'released' }
}

/** Spec §7.2: the assignment's unsubmitted decisions, checked against main, as one commit and one pull request. */
export async function submit(deps: Deps, me: ReviewerRow, a: AssignmentRow, gh: GitHub, rules: QueueRules): Promise<SubmitResult | { status: 400 | 409; message: string }> {
  // An earlier submit may have left a claim: finish it rather than send the same decisions again.
  const earlier = await pendingClaim(deps.env.DB, a.id)
  if (earlier) {
    const settled = await settleClaim(deps, gh, earlier)
    if (settled.state === 'completed') return { pr: settled.pr, url: settled.url, count: earlier.count, leftOut: [] }
    if (settled.state === 'running') return { status: 409, message: IN_PROGRESS }
  }
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
  // Claim before any write to GitHub: one submit at a time per assignment, and a retry after a failure that
  // comes once the pull request exists finds the claim instead of opening a second pull request.
  const claim = await claimSubmission(deps.env.DB, { assignment: a.id, branch, count: sent.length, leftOut: leftOut.length, createdAt: deps.now().toISOString() }, sent.map((d) => d.key))
  if (claim === null) return { status: 409, message: IN_PROGRESS }
  let pr: { number: number; url: string }
  try {
    for (;;) {
      const made = await gh.commitFiles({ parent: head, branch, message, author: { name: me.name, email: AUTHOR_EMAIL }, files })
      if ('commit' in made) break
      n += 1
      if (n > 20) throw new Error('could not find a free branch name')
      branch = `${base}-${n}`
      await setSubmissionBranch(deps.env.DB, claim, branch)
    }
    const counts = (['accept', 'keep', 'edit', 'drop'] as const).map((k) => `${k} ${sent.filter((d) => d.action === k).length}`).join(', ')
    const perFile = files.map((f) => `- ${f.path}: ${sent.filter((d) => d.file === f.path).length}`).join('\n')
    const notes = sent.filter((d) => d.note !== '').map((d) => `- ${d.key}: ${d.note}`).join('\n')
    const body = `Submitted by ${me.name} in the review app.\n\n${counts}\n\n${perFile}${notes ? `\n\nNotes:\n${notes}` : ''}${leftOut.length ? `\n\nLeft out (changed or gone since decided): ${leftOut.map((l) => l.key).join(', ')}` : ''}`
    pr = await gh.openPr({ title: `${a.queue}: ${sent.length} decisions by ${me.name}`, head: branch, body })
  } catch (err) {
    // No pull request exists: give the claim up, so the decisions can be submitted again.
    await releaseSubmission(deps.env.DB, claim)
    throw err
  }
  try {
    await completeSubmission(deps.env.DB, claim, pr.number, pr.url)
  } catch (err) {
    // The pull request exists and the claim still holds its decisions: settleClaim records the number later.
    deps.log(`pull request ${pr.url} opened but not recorded yet: ${err instanceof Error ? err.message : String(err)}`)
  }
  const admins = (await listReviewers(deps.env.DB)).filter((r) => r.role === 'admin' && !r.disabledAt).map((r) => r.email)
  try {
    await reviewMailer(deps).submitted(admins, { name: me.name, count: sent.length, queue: a.queue, url: pr.url })
  } catch (err) {
    deps.log(`submit notice not sent: ${err instanceof Error ? err.message : String(err)}`)
  }
  return { pr: pr.number, url: pr.url, count: sent.length, leftOut }
}
