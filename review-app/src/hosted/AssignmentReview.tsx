import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Action, RowView } from '../../server/types'
import type { AssignmentView, HostedRow, Severity, SubmitResult } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { assignmentLabel } from '../labels'
import { ReviewScreen } from '../ReviewScreen'
import { SPOT_CHECK_PURPOSE } from './spotCheck'

/** One assignment on the shared review screen: decisions go to the Worker with the row hash they were made on,
 * and Submit sends the open ones as one pull request. A spot check also asks how serious each fault was. */
export function AssignmentReview(props: { assignment: AssignmentView; onBack(): void }) {
  const a = props.assignment
  const [rows, setRows] = useState<readonly HostedRow[]>([])
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  /** why the last load of the rows failed; empty when it worked */
  const [loadError, setLoadError] = useState('')
  const [sent, setSent] = useState<SubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await hostedApi.rows(a.id)
      setRows(r.rows)
      setLoadError('')
      if (r.discarded.length > 0) setNotice(`Removed decisions on rows that are gone: ${r.discarded.join(', ')}`)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [a.id])
  useEffect(() => void load(), [load])

  const onDecide = useCallback(
    async (row: RowView, action: Action, cells: Record<string, string>, note: string, severity?: Severity) => {
      const res = await hostedApi.decide({ assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action, cells, note, ...(severity ? { severity } : {}) })
      if (res.ok) return null
      if (res.reason === 'changed') return 'This row changed; reloaded.'
      if (res.reason === 'gone') return 'This row is gone; reloaded.'
      return res.message
    },
    [a.id],
  )

  const spotCheck = a.spotCheck !== null
  const ratings = useMemo(() => new Map(rows.flatMap((r) => (r.decision?.severity && !r.decision.changed ? [[r.key, r.decision.severity] as const] : []))), [rows])
  const changed = rows.filter((r) => r.decision?.changed).map((r) => r.key)
  const open = rows.filter((r) => r.decision && !r.decision.changed && r.decision.submission === null).length
  const submitNow = async () => {
    if (submitting) return
    setSubmitting(true)
    // What an earlier try said no longer holds while this one runs.
    setNotice('')
    setSent(null)
    try {
      setSent(await hostedApi.submit(a.id))
      await load()
    } catch (err) {
      // Reload first (it sets its own notice): after a refused or failed submit the rows show what is really pending.
      await load()
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      {sent && (
        <p role="status" className="notice">
          Sent as{' '}
          <a href={sent.url} target="_blank" rel="noreferrer">
            pull request {sent.pr}
          </a>{' '}
          ({sent.count} decisions)
          {sent.leftOut.length > 0 && <> · Left out because they changed or are gone: {sent.leftOut.map((l) => `${l.key} (${l.reason})`).join(', ')}</>}
        </p>
      )}
      {/* until the answer is there; the rows are loaded again after it, under the answer */}
      {submitting && !sent && (
        <div role="status" className="notice sending">
          <p>
            Sending {open} {open === 1 ? 'decision' : 'decisions'}…
          </p>
          <div className="busy-bar" role="progressbar" aria-label="Sending">
            <span />
          </div>
        </div>
      )}
      {changed.length > 0 && <p className="stale-notice">Changed since you decided it: {changed.join(', ')}</p>}
      <ReviewScreen
        rows={rows}
        loading={loading}
        onDecide={onDecide}
        onReload={load}
        notice={loadError || notice}
        loadFailed={loadError !== ''}
        title={assignmentLabel(a)}
        onBack={props.onBack}
        {...(spotCheck ? { lead: `Spot check. ${SPOT_CHECK_PURPOSE}`, askSeverity: true, ratings } : {})}
        actions={
          <button className={open > 0 ? 'button primary' : 'button'} onClick={() => void submitNow()} disabled={open === 0 || submitting}>
            {/* one piece, so the button's gap does not come between the words; a phone shows "Submit 2" */}
            <span>
              Submit {open}
              <span className="wide-label"> {open === 1 ? 'decision' : 'decisions'}</span>
            </span>
          </button>
        }
      />
    </>
  )
}
