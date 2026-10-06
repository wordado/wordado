import type { RowView } from '../server/types'
import { RowList } from './RowList'
import { useModal } from './useModal'

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']

/** The row list, behind "All rows": a drawer from the left with the level and severity filters and the shown
 * rows. It is a modal dialog, so the focus stays in it and Escape closes it; choosing a row closes it too, and the
 * focus goes back to what opened it. */
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
  /** what is being reviewed and the way back to where it was opened from: shown on a phone, where the header has
   * no room for them */
  title?: string
  onBack?: () => void
}) {
  const { open } = props
  // The dialog exists only while the drawer is open.
  const { ref, close } = useModal(open, props.onClose)

  if (!open) return null
  const decided = props.rows.filter((r) => r.decided).length
  return (
    // A click on the dialog itself is a click on the backdrop: everything visible is inside drawer-body.
    <dialog ref={ref} className="drawer" aria-label="All rows" onClose={close} onClick={(e) => e.target === e.currentTarget && close()}>
      <div className="drawer-body">
        <div className="drawer-head">
          <h2>All rows</h2>
          <span className="note">
            {decided} of {props.rows.length} decided
          </span>
          <button className="button small ghost" onClick={close}>
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
        {(props.title || props.onBack) && (
          <div className="drawer-where">
            {props.title && <span className="note">{props.title}</span>}
            {props.onBack && (
              <button className="button small" onClick={props.onBack}>
                Back to my assignments
              </button>
            )}
          </div>
        )}
        {props.rows.length === 0 ? (
          <p className="note drawer-empty">No rows match these filters.</p>
        ) : (
          <RowList
            rows={props.rows}
            selected={props.selected}
            onSelect={(key) => {
              props.onSelect(key)
              close()
            }}
          />
        )}
      </div>
    </dialog>
  )
}
