import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type { Action, RowView } from '../server/types'
import type { Severity } from '../shared/hosted'
import { HeaderSlot } from './AppHeader'
import { RowCard } from './RowCard'
import { RowDrawer } from './RowDrawer'
import { useKeys } from './useKeys'

/** The review screen both modes share: one row at a time in a centred column, the row list with the level and
 * severity filters in a drawer (All rows, key L), and its own part of the app header (what is reviewed, the
 * parent's actions); the parent's controls are a toolbar above the card. The parent owns the rows and how a decision is stored; `onDecide` resolves to a
 * notice to show (null when the decision went through, and the screen then moves on to the next undecided row). */
export function ReviewScreen(props: {
  rows: readonly RowView[]
  /** the rows are not there yet: an empty list then means "loading", not "nothing left" */
  loading?: boolean
  /** the last load failed (`notice` says why): an empty list then means "could not load", with Try again */
  loadFailed?: boolean
  onDecide(row: RowView, action: Action, cells: Record<string, string>, note: string, severity?: Severity): Promise<string | null>
  onReload(): Promise<void>
  /** what is being reviewed, for the header */
  title?: string
  /** what chooses the rows (the local mode's queue picker and "show unflagged"): a slim toolbar above the card */
  controls?: ReactNode
  /** the screen's main action (Submit, Import decisions): in the header, and in the done state instead */
  actions?: ReactNode
  notice?: string
  /** the way back to the list this was opened from, offered when nothing is left (and, on a phone, in the row list) */
  onBack?: () => void
  /** one line above the row about the work as a whole (a spot check says what it is for) */
  lead?: string
  /** a spot check: a decision that changes a row is asked how serious the fault was */
  askSeverity?: boolean
  /** a spot check: what was answered for the rows decided so far, by key */
  ratings?: ReadonlyMap<string, Severity>
}) {
  const { rows, loading = false, loadFailed = false } = props
  /** the row the reviewer (or the move after a decision) chose; null: none, the first undecided row is shown */
  const [picked, setPicked] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [severity, setSeverity] = useState('')
  const [saving, setSaving] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  /** the shown row is being edited: the row list is off, choosing another row there would silently drop the edit */
  const [editing, setEditing] = useState(false)
  const [retrying, setRetrying] = useState(false)

  const shown = useMemo(
    () => rows.filter((r) => (level === '' || r.context['level'] === level) && (severity === '' || (severity === 'report' ? r.reports !== '' : r.severity === severity))),
    [rows, level, severity],
  )
  // The selection is worked out from the rows of this very render: the chosen row while it is still shown, else the
  // first undecided one. So a row that a reload or a filter took away never leaves the screen saying "nothing left"
  // while rows are open, and there is no render in between without a row.
  const selected = picked !== null && shown.some((r) => r.key === picked) ? picked : (shown.find((r) => !r.decided)?.key ?? null)

  const index = shown.findIndex((r) => r.key === selected)
  const row = index === -1 ? null : shown[index]!
  /** The next (dir 1) or previous (dir -1) undecided row from the selected one, wrapping around the list. After a
   * decision the selected row itself no longer counts (`shown` is from before the reload and still has it open). */
  const move = useCallback(
    (dir: 1 | -1, afterDecision = false) => {
      if (shown.length === 0) return setPicked(null)
      const i = shown.findIndex((r) => r.key === selected)
      for (let step = 1; step <= shown.length - (afterDecision ? 1 : 0); step += 1) {
        const r = shown[(((i + dir * step) % shown.length) + shown.length) % shown.length]!
        if (!r.decided) return setPicked(r.key)
      }
      setPicked(null)
    },
    [shown, selected],
  )
  const next = useCallback(() => move(1), [move])
  const prev = useCallback(() => move(-1), [move])
  const decide = useCallback(
    async (action: Action, cells: Record<string, string>, note: string, severity?: Severity) => {
      if (!row || saving) return
      setSaving(true)
      try {
        const message = await props.onDecide(row, action, cells, note, severity)
        setNotice(message ?? '')
        await props.onReload()
        if (message === null) move(1, true)
      } catch (err) {
        setNotice(err instanceof Error ? err.message : String(err))
      } finally {
        setSaving(false)
      }
    },
    [row, saving, props, move],
  )
  const openList = useCallback(() => setListOpen(true), [])
  const closeList = useCallback(() => setListOpen(false), [])
  // The keys that leave the row are off while it is being edited (or asked about), as the row list is: the edit would be lost.
  const keys = useMemo(() => ({ ...(editing ? {} : { l: openList }), ...(saving || editing ? {} : { s: next, ArrowDown: next, ArrowUp: prev }) }), [editing, openList, next, prev, saving])
  useKeys(keys)
  const handleDecide = useCallback((action: Action, cells: Record<string, string>, note: string, severity?: Severity) => void decide(action, cells, note, severity), [decide])
  const retry = async () => {
    setRetrying(true)
    try {
      await props.onReload()
    } finally {
      setRetrying(false)
    }
  }

  const shownNotice = notice || props.notice || ''
  return (
    <>
      <HeaderSlot>
        {props.title && <span className="crumb">{props.title}</span>}
        <span className="header-actions">
          <button className="button list-button" onClick={openList} disabled={editing}>
            <span aria-hidden="true">☰</span> <span className="wide-label">All rows</span>
          </button>
          {row && props.actions}
        </span>
      </HeaderSlot>
      <main className="review page">
        {props.controls && (
          <div className="review-toolbar" role="group" aria-label="Queue and rows shown">
            {props.controls}
          </div>
        )}
        {shownNotice && (
          <p role="status" className="notice">
            {shownNotice}
          </p>
        )}
        {props.lead && row && <p className="note review-lead">{props.lead}</p>}
        {row ? (
          <RowCard
            key={`${row.key}:${row.version}`}
            row={row}
            position={{ index, total: shown.length }}
            onDecide={handleDecide}
            onSkip={next}
            onPrev={prev}
            saving={saving}
            onEditing={setEditing}
            askSeverity={props.askSeverity === true}
            rated={props.ratings?.get(row.key) ?? null}
          />
        ) : loading && rows.length === 0 ? (
          <p className="note loading">Loading…</p>
        ) : loadFailed && rows.length === 0 ? (
          // The notice above says what went wrong. No Submit or Import here: there is nothing to send.
          <section className="panel done">
            <p>The rows could not be loaded.</p>
            <div className="actions">
              <button className="button primary" onClick={() => void retry()} disabled={retrying}>
                Try again
              </button>
              {props.onBack && (
                <button className="button" onClick={props.onBack}>
                  Back to my assignments
                </button>
              )}
            </div>
          </section>
        ) : (
          <section className="panel done">
            <p>Nothing left to decide here.</p>
            <div className="actions">
              {props.actions}
              {props.onBack && (
                <button className="button" onClick={props.onBack}>
                  Back to my assignments
                </button>
              )}
            </div>
          </section>
        )}
      </main>
      <RowDrawer
        open={listOpen}
        rows={shown}
        selected={selected}
        onSelect={setPicked}
        onClose={closeList}
        level={level}
        severity={severity}
        onLevel={setLevel}
        onSeverity={setSeverity}
        {...(props.title ? { title: props.title } : {})}
        {...(props.onBack ? { onBack: props.onBack } : {})}
      />
    </>
  )
}
