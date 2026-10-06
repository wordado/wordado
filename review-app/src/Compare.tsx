import type { RowView } from '../server/types'
import { fieldLabel } from './labels'
import { applyFixes } from './RowView'

/** The row as it is now and, when the AI objects, as it would be with the ticked fixes: a value a ticked fix
 * replaces is struck through under "Now" and bold under "AI suggests". An empty field a fix fills has nothing to
 * strike: its "none" stays as it is. */
export function Compare(props: { row: RowView; ticked: ReadonlySet<number> }) {
  const { row, ticked } = props
  const hasObjections = row.objections.length > 0
  const suggested = applyFixes(row.cells, row.objections, ticked)
  const changed = (f: string) => (suggested[f] ?? '') !== (row.cells[f] ?? '')
  return (
    <div className={hasObjections ? 'compare' : 'compare single'}>
      <section className="compare-col" aria-label="Now">
        <p className="eyebrow">Now</p>
        <dl>
          {row.fields.map((f) => (
            <div key={f}>
              <dt>{fieldLabel(f)}</dt>
              {/* <s>, not a styled span: assistive technology says that it is struck */}
              <dd>{hasObjections && row.cells[f] && changed(f) ? <s className="struck">{row.cells[f]}</s> : <span className={row.cells[f] ? undefined : 'none'}>{row.cells[f] || 'none'}</span>}</dd>
            </div>
          ))}
        </dl>
      </section>
      {hasObjections && (
        <section className="compare-col suggested" aria-label="AI suggests">
          <p className="eyebrow">AI suggests</p>
          <dl>
            {row.fields.map((f) => {
              const value = suggested[f] || 'none'
              return (
                <div key={f}>
                  <dt>{fieldLabel(f)}</dt>
                  <dd>{changed(f) ? <b className={suggested[f] ? undefined : 'none'}>{value}</b> : <span className={suggested[f] ? undefined : 'none'}>{value}</span>}</dd>
                </div>
              )
            })}
          </dl>
        </section>
      )}
    </div>
  )
}
