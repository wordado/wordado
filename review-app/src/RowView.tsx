import type { ObjectionView } from '../server/types'

/** The cells after applying the ticked objections' fixes. Ticks are exclusive per field (RowCard enforces at
 * most one tick per field), but this stays defensive and takes the first ticked fix if more than one ever is. */
export function applyFixes(cells: Record<string, string>, objections: readonly ObjectionView[], ticked: ReadonlySet<number>): Record<string, string> {
  const out = { ...cells }
  const done = new Set<string>()
  objections.forEach((o, i) => {
    if (ticked.has(i) && !done.has(o.field)) {
      out[o.field] = o.fix
      done.add(o.field)
    }
  })
  return out
}

/** The first objection's index for each field: what starts ticked. */
export function firstPerField(objections: readonly ObjectionView[]): Set<number> {
  const seen = new Set<string>()
  const out = new Set<number>()
  objections.forEach((o, i) => {
    if (!seen.has(o.field)) {
      seen.add(o.field)
      out.add(i)
    }
  })
  return out
}

/** The ticks after ticking or unticking objection `i`: at most one tick per field, so ticking one objection unticks
 * any other on the same field. */
export function toggleTick(objections: readonly ObjectionView[], ticked: ReadonlySet<number>, i: number): Set<number> {
  if (ticked.has(i)) return new Set([...ticked].filter((x) => x !== i))
  const field = objections[i]!.field
  return new Set([...[...ticked].filter((x) => objections[x]!.field !== field), i])
}
