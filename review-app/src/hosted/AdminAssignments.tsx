import { type FormEvent, useState } from 'react'
import { type AssignmentView, languageOf, type ReviewerView, type SnapshotStatus, type SplitProposal } from '../../shared/hosted'
import { Dialog } from '../Dialog'
import { hostedApi } from '../hostedApi'
import { assignmentLabel, queueLabel } from '../labels'
import { type Act, count, dateOf, fileName, type PageNotice, share } from './adminUtil'

type Queue = SnapshotStatus['queues'][number]

const active = (reviewers: readonly ReviewerView[] | undefined) => (reviewers ?? []).filter((r) => !r.disabledAt)

/** Active reviewers who can review a queue (they have its language). */
const reviewersFor = (reviewers: readonly ReviewerView[] | undefined, queue: string) => {
  const language = languageOf(queue)
  return active(reviewers).filter((r) => language !== null && r.languages.includes(language))
}

/** A two-button segmented control; `value` is the pressed side. */
function Segmented<T extends string>(props: { label: string; options: readonly (readonly [T, string])[]; value: NoInfer<T>; onChange: (v: NoInfer<T>) => void }) {
  return (
    <span className="segmented" role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {text}
        </button>
      ))}
    </span>
  )
}

const ROWS_OPTIONS = [
  ['all', 'All rows'],
  ['flagged', 'Flagged rows only'],
] as const

/** How far an assignment is: "741 rows · 212 decided · 60 submitted · 469 to go"; what is nought is left out. */
function countsOf(a: AssignmentView): string {
  const p = a.progress
  if (!p) return 'the review data is not available yet'
  const parts = [`${p.decided} decided`, `${p.changed} changed`, `${p.submitted} submitted`, `${p.merged} merged`].filter((part) => !part.startsWith('0 '))
  return [count(p.inScope, 'row'), ...parts, `${p.remaining} to go`].join(' · ')
}

interface Props extends PageNotice {
  snapshot: SnapshotStatus | null | undefined
  reviewers: readonly ReviewerView[] | undefined
  assignments: readonly AssignmentView[] | undefined
  act: Act
  /** the Assign dialog: open when not null, with this queue chosen ('' for none) */
  assigning: { readonly queue: string } | null
  onAssigning(next: { readonly queue: string } | null): void
}

/** The Assignments tab: Assign work and Split a queue (dialogs), then the open and the closed assignments. */
export function AdminAssignments(props: Props) {
  const { assignments, reviewers, act, notice, assigning, onAssigning } = props
  const [splitting, setSplitting] = useState(false)
  const [reassigning, setReassigning] = useState<AssignmentView | null>(null)
  const open = (assignments ?? []).filter((a) => !a.closedAt)
  const closed = (assignments ?? []).filter((a) => a.closedAt)
  const show = (what: () => void) => {
    props.clearNotice()
    what()
  }
  const item = (a: AssignmentView) => <AssignmentItem key={a.id} assignment={a} act={act} onReassign={() => show(() => setReassigning(a))} />
  return (
    <>
      <div className="tab-actions">
        <button className="button primary" onClick={() => show(() => onAssigning({ queue: '' }))}>
          Assign work
        </button>
        <button className="button" onClick={() => show(() => setSplitting(true))}>
          Split a queue
        </button>
      </div>
      {assignments === undefined && <p className="note">Loading…</p>}
      {assignments !== undefined && open.length === 0 && <p className="note">No open assignments.</p>}
      {open.length > 0 && (
        <>
          <p className="eyebrow">Open</p>
          <ul className="settings-rows">{open.map(item)}</ul>
        </>
      )}
      {closed.length > 0 && (
        <>
          <h3 className="eyebrow">Closed</h3>
          <ul className="settings-rows">{closed.map(item)}</ul>
        </>
      )}
      <Dialog open={assigning !== null} title="Assign work" onClose={() => onAssigning(null)} error={notice}>
        <AssignForm snapshot={props.snapshot} reviewers={reviewers} act={act} queue={assigning?.queue ?? ''} onDone={() => onAssigning(null)} />
      </Dialog>
      <Dialog open={splitting} title="Split a queue" onClose={() => setSplitting(false)} error={notice}>
        <SplitForm snapshot={props.snapshot} reviewers={reviewers} act={act} onDone={() => setSplitting(false)} />
      </Dialog>
      <Dialog open={reassigning !== null} title="Reassign" onClose={() => setReassigning(null)} error={notice}>
        {reassigning && <ReassignForm assignment={reassigning} reviewers={reviewers} act={act} onDone={() => setReassigning(null)} />}
      </Dialog>
    </>
  )
}

interface FormProps {
  snapshot: SnapshotStatus | null | undefined
  reviewers: readonly ReviewerView[] | undefined
  act: Act
  /** the form did what it is for: its dialog closes */
  onDone(): void
}

/** Assign: a reviewer, a queue in one of their languages, all rows or the flagged ones, and the files. `queue` is
 * chosen from the start (the Overview's Assign on a language); it stays when the reviewer picked has its language. */
function AssignForm(props: FormProps & { queue: string }) {
  const { snapshot, reviewers, act } = props
  const [reviewer, setReviewer] = useState('')
  const [queue, setQueue] = useState(props.queue)
  const [rows, setRows] = useState<'all' | 'flagged'>('all')
  const [allFiles, setAllFiles] = useState(false)
  const [files, setFiles] = useState<string[]>([])

  const who = active(reviewers).find((r) => r.email === reviewer)
  const has = (r: ReviewerView | undefined, q: string) => {
    const l = languageOf(q)
    return r !== undefined && l !== null && r.languages.includes(l)
  }
  // Without a reviewer the list holds only the queue chosen from the start, so the control can show it.
  const queues = (snapshot?.queues ?? []).filter((q) => (who ? has(who, q.queue) : q.queue === queue))
  const chosen: Queue | undefined = who ? queues.find((q) => q.queue === queue) : undefined

  const pickReviewer = (email: string) => {
    setReviewer(email)
    if (!has(active(reviewers).find((r) => r.email === email), queue)) setQueue('')
    setFiles([])
    setAllFiles(false)
  }
  const pickQueue = (q: string) => {
    setQueue(q)
    setFiles([])
    setAllFiles(false)
  }
  const toggle = (file: string) => setFiles((fs) => (fs.includes(file) ? fs.filter((f) => f !== file) : [...fs, file]))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!chosen) return
    void act(() => hostedApi.admin.assign({ reviewer, queue: chosen.queue, files: allFiles ? '*' : files, flaggedOnly: rows === 'flagged' })).then((ok) => ok && props.onDone())
  }

  return (
    <form aria-label="Assign" className="form" onSubmit={submit}>
      <label className="field">
        Reviewer
        <select value={reviewer} onChange={(e) => pickReviewer(e.target.value)}>
          <option value="">Choose a reviewer</option>
          {active(reviewers).map((r) => (
            <option key={r.email} value={r.email}>
              {r.name} ({r.email})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Queue
        <select value={queue} onChange={(e) => pickQueue(e.target.value)} disabled={!who}>
          <option value="">Choose a queue</option>
          {queues.map((q) => (
            <option key={q.queue} value={q.queue}>
              {queueLabel(q.queue)}
            </option>
          ))}
        </select>
      </label>
      <Segmented label="Rows" options={ROWS_OPTIONS} value={rows} onChange={setRows} />
      {chosen && (
        <span className="checkbox-group">
          <label className="check">
            <input type="checkbox" checked={allFiles} onChange={(e) => setAllFiles(e.target.checked)} /> All files
          </label>
          {chosen.files.map((f) => (
            <label key={f.file} className="check" title={f.file}>
              <input type="checkbox" disabled={f.assignedTo !== null || allFiles} checked={allFiles || files.includes(f.file)} onChange={() => toggle(f.file)} />{' '}
              {`${fileName(f.file)} · ${f.rows} rows · ${f.flagged} flagged${f.assignedTo !== null ? ` · ${f.assignedTo}` : ''}`}
            </label>
          ))}
        </span>
      )}
      <span className="form-actions">
        <button type="submit" className="button primary" disabled={!chosen || (!allFiles && files.length === 0)}>
          Assign
        </button>
      </span>
    </form>
  )
}

/** Split a queue between reviewers: the server proposes who gets which files; files can be moved before the
 * assignments are created. */
function SplitForm(props: FormProps) {
  const { snapshot, reviewers, act } = props
  const [queue, setQueue] = useState('')
  const [rows, setRows] = useState<'all' | 'flagged'>('all')
  const [chosen, setChosen] = useState<string[]>([])
  const [proposal, setProposal] = useState<SplitProposal[] | null>(null)

  const q: Queue | undefined = snapshot?.queues.find((x) => x.queue === queue)
  const candidates = queue ? reviewersFor(reviewers, queue) : []
  const nameOf = (email: string) => (reviewers ?? []).find((r) => r.email === email)?.name ?? email
  const flaggedOnly = rows === 'flagged'

  const pickQueue = (next: string) => {
    setQueue(next)
    setChosen([])
    setProposal(null)
  }
  const pickRows = (next: 'all' | 'flagged') => {
    setRows(next)
    setProposal(null)
  }
  const toggle = (email: string) => {
    setChosen((cs) => (cs.includes(email) ? cs.filter((c) => c !== email) : [...cs, email]))
    setProposal(null)
  }

  /** The rows a file adds to a proposal, from the snapshot's counts. */
  const rowsOf = (file: string) => {
    const f = q?.files.find((x) => x.file === file)
    return f ? (flaggedOnly ? f.flagged : f.rows) : 0
  }

  /** Moves a file to another reviewer in the proposal and recomputes both reviewers' row sums. */
  const move = (file: string, to: string) => {
    if (!proposal) return
    setProposal(
      proposal.map((p) => {
        const has = p.files.includes(file)
        if (p.reviewer === to && !has) {
          const files = [...p.files, file]
          return { ...p, files, rows: files.reduce((n, f) => n + rowsOf(f), 0) }
        }
        if (p.reviewer !== to && has) {
          const files = p.files.filter((f) => f !== file)
          return { ...p, files, rows: files.reduce((n, f) => n + rowsOf(f), 0) }
        }
        return p
      }),
    )
  }

  const propose = (e: FormEvent) => {
    e.preventDefault()
    void act(async () => {
      const r = await hostedApi.admin.split({ queue, flaggedOnly, reviewers: chosen })
      setProposal(r.proposal ?? null)
    })
  }

  const confirm = () => {
    if (!proposal) return
    void act(() => hostedApi.admin.split({ queue, flaggedOnly, reviewers: chosen, confirm: true, proposal })).then((ok) => ok && props.onDone())
  }

  return (
    <form aria-label="Split a queue" className="form" onSubmit={propose}>
      <label className="field">
        Queue
        <select value={queue} onChange={(e) => pickQueue(e.target.value)}>
          <option value="">Choose a queue</option>
          {(snapshot?.queues ?? [])
            .filter((x) => languageOf(x.queue) !== null)
            .map((x) => (
              <option key={x.queue} value={x.queue}>
                {queueLabel(x.queue)}
              </option>
            ))}
        </select>
      </label>
      <Segmented label="Rows" options={ROWS_OPTIONS} value={rows} onChange={pickRows} />
      {queue && candidates.length === 0 && <p className="note">No active reviewer has this queue’s language.</p>}
      {candidates.length > 0 && (
        <span className="checkbox-group">
          {candidates.map((r) => (
            <label key={r.email} className="check">
              <input type="checkbox" checked={chosen.includes(r.email)} onChange={() => toggle(r.email)} /> {r.name}
            </label>
          ))}
        </span>
      )}
      <span className="form-actions">
        <button type="submit" className="button" disabled={!queue || chosen.length === 0}>
          Propose
        </button>
      </span>
      {proposal && (
        <>
          <ul className="settings-rows">
            {proposal.map((p) => (
              <li key={p.reviewer} className="settings-row">
                <span className="settings-row-text">
                  <span className="settings-row-title">{`${nameOf(p.reviewer)}: ${p.files.length} ${p.files.length === 1 ? 'file' : 'files'}, ${p.rows} rows`}</span>
                  {p.files.map((f) => (
                    <span key={f} className="proposal-file" title={f}>
                      {fileName(f)}{' '}
                      <span className="field">
                        <select aria-label={`Reviewer for ${fileName(f)}`} value={p.reviewer} onChange={(e) => move(f, e.target.value)}>
                          {proposal.map((o) => (
                            <option key={o.reviewer} value={o.reviewer}>
                              {nameOf(o.reviewer)}
                            </option>
                          ))}
                        </select>
                      </span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <span className="form-actions">
            <button type="button" className="button primary" onClick={confirm}>
              Create these assignments
            </button>
          </span>
        </>
      )}
    </form>
  )
}

/** One assignment, open or closed: its plain name, who has it, how far it is. */
function AssignmentItem(props: { assignment: AssignmentView; act: Act; onReassign(): void }) {
  const { assignment: a, act } = props
  const p = a.progress
  const close = () => {
    if (!window.confirm('Close this assignment? Its unsubmitted decisions are kept for a later reassignment.')) return
    void act(() => hostedApi.admin.close(a.id))
  }
  return (
    <li className="settings-row assignment-row" title={a.queue}>
      <span className="settings-row-text">
        <span className="settings-row-title">{assignmentLabel(a)}</span>
        <span className="note">{`${a.reviewerName} · ${countsOf(a)}${a.closedAt ? ` · closed ${dateOf(a.closedAt)}` : ''}`}</span>
      </span>
      <span className="progress" aria-hidden="true">
        {p && <span className="submitted" style={{ width: share(p.submitted, p.inScope) }} />}
        {p && <span className="decided" style={{ width: share(p.decided, p.inScope) }} />}
      </span>
      <span className="row-actions">
        <button className="button small" onClick={props.onReassign}>
          Reassign…
        </button>
        {!a.closedAt && (
          <button className="button small danger" onClick={close}>
            Close
          </button>
        )}
      </span>
    </li>
  )
}

/**
 * Reassign an assignment, open or closed. A closed one can still be reassigned (spec §5.1): closing, disabling its
 * reviewer or removing their language keep its unsubmitted decisions for whoever takes it over, its own reviewer
 * included.
 */
function ReassignForm(props: { assignment: AssignmentView; reviewers: readonly ReviewerView[] | undefined; act: Act; onDone(): void }) {
  const { assignment: a } = props
  const others = reviewersFor(props.reviewers, a.queue).filter((r) => Boolean(a.closedAt) || r.email !== a.reviewer)
  const [to, setTo] = useState('')
  const [decisions, setDecisions] = useState<'move' | 'discard'>('move')
  const reassign = (e: FormEvent) => {
    e.preventDefault()
    void props.act(() => hostedApi.admin.reassign(a.id, to, decisions)).then((ok) => ok && props.onDone())
  }
  return (
    <form className="form" onSubmit={reassign}>
      <p className="note">{`${assignmentLabel(a)} · ${a.reviewerName}`}</p>
      <label className="field">
        Reassign to
        <select value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose a reviewer</option>
          {others.map((r) => (
            <option key={r.email} value={r.email}>
              {r.name}
            </option>
          ))}
        </select>
      </label>
      <Segmented
        label="Their decisions"
        options={[
          ['move', 'Move their decisions'],
          ['discard', 'Discard them'],
        ]}
        value={decisions}
        onChange={setDecisions}
      />
      <span className="form-actions">
        <button type="submit" className="button primary" disabled={!to}>
          Reassign
        </button>
        <button type="button" className="button ghost" onClick={props.onDone}>
          Cancel
        </button>
      </span>
    </form>
  )
}
