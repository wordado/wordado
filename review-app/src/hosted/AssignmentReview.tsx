import { useCallback, useEffect, useState } from 'react'
import type { Action, RowView } from '../../server/types'
import type { AssignmentView, HostedRow, SubmitResult } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { ReviewScreen } from '../ReviewScreen'
import { scopeOf } from './Assignments'

/** One assignment on the shared review screen: decisions go to the Worker with the row hash they were made on,
 * and Submit sends the open ones as one pull request. */
export function AssignmentReview(props: { assignment: AssignmentView }) {
  const a = props.assignment
  const [rows, setRows] = useState<readonly HostedRow[]>([])
  const [notice, setNotice] = useState('')
  const [sent, setSent] = useState<SubmitResult | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await hostedApi.rows(a.id)
      setRows(r.rows)
      if (r.discarded.length > 0) setNotice(`Removed decisions on rows that are gone: ${r.discarded.join(', ')}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    }
  }, [a.id])
  useEffect(() => void load(), [load])

  const onDecide = useCallback(
    async (row: RowView, action: Action, cells: Record<string, string>, note: string) => {
      const res = await hostedApi.decide({ assignment: a.id, queue: row.queue, file: row.file, key: row.key, rowHash: row.rowHash, action, cells, note })
      if (res.ok) return null
      if (res.reason === 'changed') return 'This row changed; reloaded.'
      if (res.reason === 'gone') return 'This row is gone; reloaded.'
      return res.message
    },
    [a.id],
  )

  const changed = rows.filter((r) => r.decision?.changed).map((r) => r.key)
  const open = rows.filter((r) => r.decision && !r.decision.changed && r.decision.submission === null).length
  const submitNow = async () => {
    if (submitting) return
    setSubmitting(true)
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
      {changed.length > 0 && <p className="stale-notice">Changed since you decided it: {changed.join(', ')}</p>}
      <ReviewScreen
        rows={rows}
        onDecide={onDecide}
        onReload={load}
        notice={notice}
        controls={
          <>
            <strong>{a.queue}</strong>
            <span className="muted">{scopeOf(a)}</span>
          </>
        }
        actions={
          <button onClick={() => void submitNow()} disabled={open === 0 || submitting}>
            Submit {open} {open === 1 ? 'decision' : 'decisions'}
          </button>
        }
      />
    </>
  )
}
