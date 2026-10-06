import type { ObjectionView } from '../server/types'
import { fieldLabel } from './labels'

/** The learner reports and the AI's objections, one line each: the category, the reason and, where a field has
 * more than one objection, a tick to choose which fix applies. Who objected is said only when several did. */
export function Objections(props: { objections: readonly ObjectionView[]; reports: string; ticked: ReadonlySet<number>; onTick: (i: number) => void }) {
  const { objections } = props
  const perField = new Map<string, number>()
  for (const o of objections) perField.set(o.field, (perField.get(o.field) ?? 0) + 1)
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
        const choice = (perField.get(o.field) ?? 0) > 1
        const line = (
          <>
            <span className={`chip ${o.severity}`} title={o.severity}>
              {o.category}
            </span>
            <span className="reason">{o.reason}</span>
            {choice && (
              <span className="fix">
                {fieldLabel(o.field)} → <b>{o.fix === '' ? '(empty)' : o.fix}</b>
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
            <input type="checkbox" checked={props.ticked.has(i)} onChange={() => props.onTick(i)} />
            {line}
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
