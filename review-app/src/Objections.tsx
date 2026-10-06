import type { ObjectionView } from '../server/types'
import { fieldLabel } from './labels'

/** The learner reports and the AI's objections, one line each: the category and the reason. When the row has more
 * than one objection each line has a tick and names its field and fix, so the reviewer chooses which fixes apply
 * (the caller keeps one tick per field); a single objection has none: Accept or Keep is the choice. Who objected is
 * said only when several did. */
export function Objections(props: { objections: readonly ObjectionView[]; reports: string; ticked: ReadonlySet<number>; onTick: (i: number) => void; disabled?: boolean }) {
  const { objections } = props
  const choice = objections.length > 1
  const several = new Set(objections.map((o) => o.reviewer)).size > 1
  return (
    <section className="objections" aria-label="Objections">
      {props.reports !== '' && (
        <div className="report">
          <h3 className="eyebrow">Learner reports</h3>
          <p>{props.reports}</p>
        </div>
      )}
      {objections.length === 0 && <p className="note">No AI objections.</p>}
      {objections.map((o, i) => {
        const line = (
          <>
            <span className={`chip ${o.severity}`} title={o.severity}>
              {o.category}
            </span>
            <span className="reason">{o.reason}</span>
            {choice && (
              <span className="fix">
                {fieldLabel(o.field)} → <b className={o.fix === '' ? 'none' : undefined}>{o.fix === '' ? 'none' : o.fix}</b>
              </span>
            )}
            {several && (
              <span className="note">
                {o.reviewer} · {o.model}
              </span>
            )}
          </>
        )
        return choice ? (
          <label key={i} className="objection choice">
            <input type="checkbox" checked={props.ticked.has(i)} disabled={props.disabled} onChange={() => props.onTick(i)} />
            {/* one piece beside the tick: what wraps stays in line with the category, not under the tick */}
            <span className="objection-text">{line}</span>
          </label>
        ) : (
          <p key={i} className="objection">
            {line}
          </p>
        )
      })}
    </section>
  )
}
