import type { ObjectionView } from '../server/types'

export function Objections(props: { objections: readonly ObjectionView[]; reports: string; ticked: ReadonlySet<number>; onTick: (i: number) => void }) {
  return (
    <section className="objections" aria-label="Objections">
      {props.reports !== '' && (
        <div className="report">
          <h3>Learner reports</h3>
          <p>{props.reports}</p>
        </div>
      )}
      {props.objections.length === 0 && <p className="muted">No AI objections.</p>}
      {props.objections.map((o, i) => (
        <label key={i} className={`objection ${o.severity}`}>
          <input type="checkbox" checked={props.ticked.has(i)} onChange={() => props.onTick(i)} />
          <span className="badge">{o.reviewer} · {o.severity} · {o.category}</span>
          <span className="reason">{o.reason}</span>
          <span className="fix">
            {o.field} → <b>{o.fix === '' ? '(empty)' : o.fix}</b>
          </span>
        </label>
      ))}
    </section>
  )
}
