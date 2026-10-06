import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Action, RowView } from '../server/types'
import { HeaderSlot } from './AppHeader'
import { RowCard } from './RowCard'
import { RowDrawer } from './RowDrawer'
import { useKeys } from './useKeys'

/** The review screen both modes share: one row at a time in a centred column, the row list with the level and
 * severity filters in a drawer (All rows, key L), and its own part of the app header (what is reviewed, the
 * parent's controls and actions). The parent owns the rows and how a decision is stored; `onDecide` resolves to a
 * notice to show (null when the decision went through, and the screen then moves on to the next undecided row). */
export function ReviewScreen(props: {
  rows: readonly RowView[]
  onDecide(row: RowView, action: Action, cells: Record<string, string>, note: string): Promise<string | null>
  onReload(): Promise<void>
  /** what is being reviewed, for the header */
  title?: string
  controls?: ReactNode
  /** the screen's main action (Submit, Import decisions): in the header, and in the done state instead */
  actions?: ReactNode
  notice?: string
  /** the way back to the list this was opened from, offered when nothing is left */
  onBack?: () => void
}) {
  const { rows } = props
  const [selected, setSelected] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [level, setLevel] = useState('')
  const [severity, setSeverity] = useState('')
  const [saving, setSaving] = useState(false)
  const [listOpen, setListOpen] = useState(false)

  const shown = useMemo(
    () => rows.filter((r) => (level === '' || r.context['level'] === level) && (severity === '' || (severity === 'report' ? r.reports !== '' : r.severity === severity))),
    [rows, level, severity],
  )
  // Selection keeps the current row while it is still shown, else falls to the first undecided one.
  useEffect(() => setSelected((cur) => (cur && shown.some((x) => x.key === cur) ? cur : (shown.find((x) => !x.decided)?.key ?? null))), [shown])

  const index = shown.findIndex((r) => r.key === selected)
  const row = index === -1 ? null : shown[index]!
  /** The next (dir 1) or previous (dir -1) undecided row from the selected one, wrapping around the list. After a
   * decision the selected row itself no longer counts (`shown` is from before the reload and still has it open). */
  const move = useCallback(
    (dir: 1 | -1, afterDecision = false) => {
      if (shown.length === 0) return setSelected(null)
      const i = shown.findIndex((r) => r.key === selected)
      for (let step = 1; step <= shown.length - (afterDecision ? 1 : 0); step += 1) {
        const r = shown[(((i + dir * step) % shown.length) + shown.length) % shown.length]!
        if (!r.decided) return setSelected(r.key)
      }
      setSelected(null)
    },
    [shown, selected],
  )
  const next = useCallback(() => move(1), [move])
  const prev = useCallback(() => move(-1), [move])
  const decide = useCallback(
    async (action: Action, cells: Record<string, string>, note: string) => {
      if (!row || saving) return
      setSaving(true)
      try {
        const message = await props.onDecide(row, action, cells, note)
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
  const keys = useMemo(() => ({ l: openList, ...(saving ? {} : { s: next, ArrowDown: next, ArrowUp: prev }) }), [openList, next, prev, saving])
  useKeys(keys)
  const handleDecide = useCallback((action: Action, cells: Record<string, string>, note: string) => void decide(action, cells, note), [decide])

  const shownNotice = notice || props.notice || ''
  return (
    <>
      <HeaderSlot>
        {props.title && <span className="crumb">{props.title}</span>}
        {props.controls}
        <span className="header-actions">
          <button className="button" onClick={openList}>
            <span aria-hidden="true">☰</span> All rows
          </button>
          {row && props.actions}
        </span>
      </HeaderSlot>
      <main className="review page">
        {shownNotice && (
          <p role="status" className="notice">
            {shownNotice}
          </p>
        )}
        {row ? (
          <RowCard key={`${row.key}:${row.version}`} row={row} position={{ index, total: shown.length }} onDecide={handleDecide} onSkip={next} onPrev={prev} saving={saving} />
        ) : (
          <section className="panel done">
            <p>Nothing left to decide here.</p>
            <div className="actions">
              {props.actions}
              {props.onBack && (
                <button className="button" onClick={props.onBack}>
                  Back to assignments
                </button>
              )}
            </div>
          </section>
        )}
      </main>
      <RowDrawer open={listOpen} rows={shown} selected={selected} onSelect={setSelected} onClose={closeList} level={level} severity={severity} onLevel={setLevel} onSeverity={setSeverity} />
    </>
  )
}
