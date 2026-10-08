/**
 * One progress bar for every wait (spec §9.1, §11.1): with `value` of a
 * known `max` it says how far along; without them it only says that
 * something is happening: no value, which is how a progressbar says its
 * progress is unknown, and a travelling stripe, or still stripes for a
 * learner who asked for less motion. `label` is its accessible name.
 */
export function ProgressBar(props: { readonly label: string; readonly value?: number; readonly max?: number; readonly leaf?: boolean }) {
  const { label, value, max } = props
  const className = props.leaf ? 'bar is-leaf' : 'bar'
  if (value === undefined || max === undefined || !(max > 0)) {
    return (
      <div className={`${className} is-indeterminate`} role="progressbar" aria-label={label}>
        <span />
      </div>
    )
  }
  const now = Math.min(max, Math.max(0, value))
  return (
    <div className={className} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={now}>
      <span style={{ width: `${(100 * now) / max}%` }} />
    </div>
  )
}
