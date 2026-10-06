import { useEffect, useLayoutEffect, useRef } from 'react'
import type { RowView } from '../server/types'
import { RowList } from './RowList'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']

/** The row list, behind "All rows": a drawer from the left with the level and severity filters and the shown
 * rows. It is a modal dialog, so the focus stays in it and Escape closes it; choosing a row closes it too. */
export function RowDrawer(props: {
  open: boolean
  rows: readonly RowView[]
  selected: string | null
  onSelect(key: string): void
  onClose(): void
  level: string
  severity: string
  onLevel(level: string): void
  onSeverity(severity: string): void
}) {
  const { open, onClose } = props
  const ref = useRef<HTMLDialogElement>(null)

  // The dialog exists only while the drawer is open: shown as a modal when it appears, closed before it goes, so
  // the browser gives the focus back to where it was.
  useLayoutEffect(() => {
    const dialog = ref.current
    if (!open || !dialog) return
    if (!dialog.open) {
      // happy-dom and old browsers: no showModal, the open attribute shows it.
      if (typeof dialog.showModal === 'function') dialog.showModal()
      else dialog.setAttribute('open', '')
    }
    return () => {
      if (dialog.open && typeof dialog.close === 'function') dialog.close()
    }
  }, [open])

  // A modal dialog closes itself on Escape (onClose below hears it); this covers a dialog that is not modal.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  const decided = props.rows.filter((r) => r.decided).length
  return (
    // A click on the dialog itself is a click on the backdrop: everything visible is inside drawer-body.
    <dialog ref={ref} className="drawer" aria-label="All rows" onClose={onClose} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="drawer-body">
        <div className="drawer-head">
          <h2>All rows</h2>
          <span className="note">
            {decided} of {props.rows.length} decided
          </span>
          <button className="button small ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-filters">
          <span className="field">
            <select value={props.level} onChange={(e) => props.onLevel(e.target.value)} aria-label="Level">
              <option value="">all levels</option>
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </span>
          <span className="field">
            <select value={props.severity} onChange={(e) => props.onSeverity(e.target.value)} aria-label="Severity">
              <option value="">all objections</option>
              <option value="report">learner reports</option>
              <option value="major">major</option>
              <option value="minor">minor</option>
            </select>
          </span>
        </div>
        {props.rows.length === 0 ? (
          <p className="note drawer-empty">No rows match these filters.</p>
        ) : (
          <RowList
            rows={props.rows}
            selected={props.selected}
            onSelect={(key) => {
              props.onSelect(key)
              onClose()
            }}
          />
        )}
      </div>
    </dialog>
  )
}
