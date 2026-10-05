import { type FormEvent, useState } from 'react'
import { type AssignmentView, languageOf, type ReviewerView, type SnapshotStatus, type SplitProposal } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { type Act, dateOf, fileName } from './adminUtil'
import { scopeOf } from './Assignments'

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

function progressOf(a: AssignmentView): string {
  const p = a.progress
  if (!p) return 'The review data is not available yet.'
  return `${p.decided} decided · ${p.changed} changed · ${p.submitted} submitted · ${p.merged} merged · ${p.remaining} to go`
}

interface Props {
  snapshot: SnapshotStatus | null | undefined
  reviewers: readonly ReviewerView[] | undefined
  assignments: readonly AssignmentView[] | undefined
  act: Act
}

/** Assignments: the assign form, the split form and the list of open and closed assignments. */
export function AdminAssignments(props: Props) {
  const { assignments } = props
  const open = (assignments ?? []).filter((a) => !a.closedAt)
  const closed = (assignments ?? []).filter((a) => a.closedAt)
  return (
    <section className="panel" aria-label="Assignments">
      <h2 className="panel-title">Assignments</h2>
      <AssignForm {...props} />
      <SplitForm {...props} />
      {assignments === undefined && <p className="note">Loading…</p>}
      {assignments !== undefined && open.length === 0 && <p className="note">No open assignments.</p>}
      {open.length > 0 && (
        <ul className="settings-rows">
          {open.map((a) => (
            <AssignmentItem key={a.id} assignment={a} reviewers={props.reviewers} act={props.act} />
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <>
          <h3>Closed</h3>
          <ul className="settings-rows">
            {closed.map((a) => (
              <AssignmentItem key={a.id} assignment={a} reviewers={props.reviewers} act={props.act} />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function AssignForm(props: Props) {
  const { snapshot, reviewers, act } = props
  const [reviewer, setReviewer] = useState('')
  const [queue, setQueue] = useState('')
  const [rows, setRows] = useState<'all' | 'flagged'>('all')
  const [allFiles, setAllFiles] = useState(false)
  const [files, setFiles] = useState<string[]>([])

  const who = active(reviewers).find((r) => r.email === reviewer)
  const queues = (snapshot?.queues ?? []).filter((q) => {
    const l = languageOf(q.queue)
    return who !== undefined && l !== null && who.languages.includes(l)
  })
  const chosen: Queue | undefined = queues.find((q) => q.queue === queue)

  const pickReviewer = (email: string) => {
    setReviewer(email)
    setQueue('')
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
    void act(() => hostedApi.admin.assign({ reviewer, queue: chosen.queue, files: allFiles ? '*' : files, flaggedOnly: rows === 'flagged' })).then(
      (ok) => ok && (setFiles([]), setAllFiles(false)),
    )
  }

  return (
    <form aria-label="Assign" className="field" onSubmit={submit}>
      <h3>Assign</h3>
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
              {q.queue}
            </option>
          ))}
        </select>
      </label>
      <Segmented label="Rows" options={ROWS_OPTIONS} value={rows} onChange={setRows} />
      {chosen && (
        <span className="checkbox-group">
          <label>
            <input type="checkbox" checked={allFiles} onChange={(e) => setAllFiles(e.target.checked)} /> All files
          </label>
          {chosen.files.map((f) => (
            <label key={f.file} title={f.file}>
              <input type="checkbox" disabled={f.assignedTo !== null || allFiles} checked={allFiles || files.includes(f.file)} onChange={() => toggle(f.file)} />{' '}
              {`${fileName(f.file)} · ${f.rows} rows · ${f.flagged} flagged${f.assignedTo !== null ? ` · ${f.assignedTo}` : ''}`}
            </label>
          ))}
        </span>
      )}
      <span>
        <button type="submit" disabled={!chosen || (!allFiles && files.length === 0)}>
          Assign
        </button>
      </span>
    </form>
  )
}

function SplitForm(props: Props) {
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
    void act(() => hostedApi.admin.split({ queue, flaggedOnly, reviewers: chosen, confirm: true, proposal })).then(
      (ok) => ok && (setProposal(null), setChosen([])),
    )
  }

  return (
    <form aria-label="Split a queue" className="field" onSubmit={propose}>
      <h3>Split a queue</h3>
      <label className="field">
        Queue
        <select value={queue} onChange={(e) => pickQueue(e.target.value)}>
          <option value="">Choose a queue</option>
          {(snapshot?.queues ?? [])
            .filter((x) => languageOf(x.queue) !== null)
            .map((x) => (
              <option key={x.queue} value={x.queue}>
                {x.queue}
              </option>
            ))}
        </select>
      </label>
      <Segmented label="Rows" options={ROWS_OPTIONS} value={rows} onChange={pickRows} />
      {queue && candidates.length === 0 && <p className="note">No active reviewer has this queue’s language.</p>}
      {candidates.length > 0 && (
        <span className="checkbox-group">
          {candidates.map((r) => (
            <label key={r.email}>
              <input type="checkbox" checked={chosen.includes(r.email)} onChange={() => toggle(r.email)} /> {r.name}
            </label>
          ))}
        </span>
      )}
      <span>
        <button type="submit" disabled={!queue || chosen.length === 0}>
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
                      <select aria-label={`Reviewer for ${fileName(f)}`} value={p.reviewer} onChange={(e) => move(f, e.target.value)}>
                        {proposal.map((o) => (
                          <option key={o.reviewer} value={o.reviewer}>
                            {nameOf(o.reviewer)}
                          </option>
                        ))}
                      </select>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <span>
            <button type="button" onClick={confirm}>
              Create these assignments
            </button>
          </span>
        </>
      )}
    </form>
  )
}

/**
 * One assignment, open or closed. A closed one can still be reassigned (spec §5.1): closing, disabling its
 * reviewer or removing their language keep its unsubmitted decisions for whoever takes it over, its own
 * reviewer included.
 */
function AssignmentItem(props: { assignment: AssignmentView; reviewers: readonly ReviewerView[] | undefined; act: Act }) {
  const { assignment: a, act } = props
  const isClosed = Boolean(a.closedAt)
  const [reassigning, setReassigning] = useState(false)
  const others = reviewersFor(props.reviewers, a.queue).filter((r) => isClosed || r.email !== a.reviewer)
  const [to, setTo] = useState('')
  const [decisions, setDecisions] = useState<'move' | 'discard'>('move')

  const close = () => {
    if (!window.confirm('Close this assignment? Its unsubmitted decisions are kept for a later reassignment.')) return
    void act(() => hostedApi.admin.close(a.id))
  }
  const reassign = () => void act(() => hostedApi.admin.reassign(a.id, to, decisions)).then((ok) => ok && setReassigning(false))

  return (
    <li className="settings-row">
      <span className="settings-row-text">
        <span className="settings-row-title">
          {a.reviewerName} · {a.queue}
        </span>
        <span className="note">{scopeOf(a)}</span>
        <span className="note">{isClosed ? `${progressOf(a)} · closed ${dateOf(a.closedAt ?? '')}` : progressOf(a)}</span>
        {reassigning && (
          <span className="row-edit">
            <select aria-label="Reassign to" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">Choose a reviewer</option>
              {others.map((r) => (
                <option key={r.email} value={r.email}>
                  {r.name}
                </option>
              ))}
            </select>
            <Segmented
              label="Their decisions"
              options={[
                ['move', 'Move their decisions'],
                ['discard', 'Discard them'],
              ]}
              value={decisions}
              onChange={setDecisions}
            />
            <button disabled={!to} onClick={reassign}>
              Reassign
            </button>
            <button onClick={() => setReassigning(false)}>Cancel</button>
          </span>
        )}
      </span>
      <span className="row-actions">
        {!isClosed && <button onClick={close}>Close</button>}
        {!reassigning && <button onClick={() => setReassigning(true)}>Reassign…</button>}
      </span>
    </li>
  )
}
