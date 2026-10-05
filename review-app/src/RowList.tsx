import type { RowView } from '../server/types'

export function RowList(props: { rows: readonly RowView[]; selected: string | null; onSelect: (key: string) => void }) {
  return (
    <ol className="list" aria-label="Rows">
      {props.rows.map((r) => (
        <li key={r.key}>
          <button className={`${r.key === props.selected ? 'selected' : ''} ${r.decided ? 'decided' : ''}`} onClick={() => props.onSelect(r.key)}>
            <span>{r.key}</span>
            <span className="muted">{r.context['level'] ?? ''}</span>
            {r.reports !== '' && <span className="badge report">report</span>}
            {r.severity && <span className={`badge ${r.severity}`}>{r.severity}</span>}
            {r.decided && <span className="badge">{r.decided.verdict}</span>}
          </button>
        </li>
      ))}
    </ol>
  )
}
