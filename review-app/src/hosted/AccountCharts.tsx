import type { AnnouncementLanguage } from '@wordado/core'
import { type CSSProperties, type PointerEvent, useLayoutEffect, useRef, useState } from 'react'
import type { AccountSeries, AccountSplits } from '../../shared/hosted'

const DAY_MS = 86_400_000

export const LANGUAGE_NAMES: Readonly<Record<AnnouncementLanguage, string>> = { bg: 'Bulgarian', de: 'German', en: 'English', es: 'Spanish' }

/** A UTC day (the epoch milliseconds it began at) as "12 Oct": the server counts by UTC days, so they are named as such. */
export const utcDay = (ms: number): string => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** One number for each step of time, oldest first, with what each step is called. */
export interface Points {
  readonly labels: readonly string[]
  readonly values: readonly number[]
}

/** The last `n` weeks of new accounts, each named by the day it began. */
export function madeByWeek(series: AccountSeries, n: number): Points {
  const values = series.madeByWeek.slice(-n)
  return { values, labels: values.map((_, i) => utcDay(series.weekStart - (values.length - 1 - i) * 7 * DAY_MS)) }
}

/** The accounts there were at the end of each week, counting only those that exist now. */
export function accountsByWeek(series: AccountSeries): Points {
  const values: number[] = []
  let total = series.accounts
  for (const made of [...series.madeByWeek].reverse()) {
    values.unshift(total)
    total -= made
  }
  return { values, labels: values.map((_, i) => utcDay(series.weekStart - (values.length - 1 - i) * 7 * DAY_MS)) }
}

/** The last `n` days of accounts that studied. */
export function studiedByDay(series: AccountSeries, n: number): Points {
  const values = series.studiedByDay.slice(-n)
  return { values, labels: values.map((_, i) => utcDay(series.dayStart - (values.length - 1 - i) * DAY_MS)) }
}

/** The top of the scale and the step between its lines: whole numbers a person would pick (1, 2 or 5 times a power
 * of ten), in at most four steps. */
export function scaleOf(most: number): { readonly top: number; readonly step: number } {
  const step = Math.min(
    ...[1, 2, 5].map((lead) => {
      let fits = lead
      while (most / fits > 4) fits *= 10
      return fits
    }),
  )
  return { top: Math.max(1, Math.ceil(most / step)) * step, step }
}

/** The width an element has on the screen, so that a chart is drawn for it and its text keeps its size on a phone. */
function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(640)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth((was) => (el.clientWidth > 0 ? el.clientWidth : was))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

const n = (value: number): string => value.toLocaleString('en')

/**
 * One series as bars (a count for each step) or as a line over a wash (a level that moves), drawn by hand: the
 * review app has no chart library. The drawing is one picture to a screen reader, named with its range; every
 * number is in the table under it, which anyone can open. Pointing at the chart, or touching it, reads one step.
 */
export function Chart(props: { kind: 'bars' | 'line'; title: string; points: Points; step: 'Week from' | 'Day' }) {
  const { kind, points } = props
  const { labels, values } = points
  const [ref, width] = useWidth()
  const [at, setAt] = useState<number | null>(null)
  const count = values.length
  const { top, step } = scaleOf(Math.max(0, ...values))
  const [W, H] = [width, width < 480 ? 190 : 230]
  // Room for the scale's numbers on the left, the last value on the right of a line, the read-out above, the dates below.
  const [L, R, T, B] = [12 + n(top).length * 7, kind === 'line' ? 14 + n(values.at(-1) ?? 0).length * 8 : 14, 26, 24]
  const [plotW, plotH] = [Math.max(1, W - L - R), H - T - B]
  const slot = kind === 'bars' ? plotW / Math.max(1, count) : plotW / Math.max(1, count - 1)
  const x = (i: number): number => (kind === 'bars' ? L + slot * (i + 0.5) : L + slot * i)
  const y = (value: number): number => T + plotH * (1 - value / top)
  const bar = Math.max(2, Math.min(24, slot - 2))
  // As many dates as have room, counted back from the last step, which is always named.
  const every = Math.max(1, Math.ceil(count / Math.max(2, Math.floor(plotW / 64))))
  const shown = at !== null && at < count ? at : null
  const last = count - 1

  const point = (e: PointerEvent<SVGSVGElement>) => {
    const box = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - box.left
    const i = kind === 'bars' ? Math.floor((px - L) / slot) : Math.round((px - L) / slot)
    setAt(Math.max(0, Math.min(last, i)))
  }

  const line = values.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).join(' ')
  const summary =
    count === 0
      ? `${props.title}: no numbers.`
      : `${props.title}, ${labels[0]} to ${labels[last]}: between ${n(Math.min(...values))} and ${n(Math.max(...values))}, ${n(values[last]!)} at the end. The numbers are in the table below.`
  return (
    <div className="chart" ref={ref}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} onPointerMove={point} onPointerDown={point} onPointerLeave={() => setAt(null)}>
        {Array.from({ length: top / step + 1 }, (_, k) => k * step).map((tick) => (
          <g key={tick}>
            <line className="chart-grid" x1={L} x2={W - R} y1={y(tick)} y2={y(tick)} />
            <text x={L - 6} y={y(tick) + 4} textAnchor="end">
              {n(tick)}
            </text>
          </g>
        ))}
        {kind === 'bars' &&
          values.map((value, i) => {
            const h = plotH * (value / top)
            // Round at the top, square on the line it stands on.
            const r = Math.min(4, bar / 2, h)
            const [x0, x1, y0, y1] = [x(i) - bar / 2, x(i) + bar / 2, y(value), y(0)]
            return h > 0 ? <path key={i} className={`chart-bar${i === last ? ' unfinished' : ''}${i === shown ? ' at' : ''}`} d={`M${x0},${y1}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x1 - r}Q${x1},${y0} ${x1},${y0 + r}V${y1}Z`} /> : null
          })}
        {kind === 'line' && count > 0 && (
          <>
            <polygon className="chart-wash" points={`${x(0)},${y(0)} ${line} ${x(last)},${y(0)}`} />
            <polyline className="chart-line" points={line} />
            <circle className="chart-dot" cx={x(last)} cy={y(values[last]!)} r={4} />
            <text className="chart-value" x={x(last) + 9} y={y(values[last]!) + 4}>
              {n(values[last]!)}
            </text>
          </>
        )}
        {labels.map((label, i) =>
          (last - i) % every === 0 ? (
            <text key={i} x={x(i)} y={H - 6} textAnchor={kind === 'line' && i === last ? 'end' : kind === 'line' && i === 0 ? 'start' : 'middle'}>
              {label}
            </text>
          ) : null,
        )}
        {shown !== null && (
          <g className="chart-at">
            {kind === 'line' && <line x1={x(shown)} x2={x(shown)} y1={T} y2={y(0)} />}
            {kind === 'line' && <circle className="chart-dot" cx={x(shown)} cy={y(values[shown]!)} r={4} />}
            <text x={x(shown) > W / 2 ? x(shown) - 6 : x(shown) + 6} y={14} textAnchor={x(shown) > W / 2 ? 'end' : 'start'}>
              {labels[shown]}: <tspan className="chart-value">{n(values[shown]!)}</tspan>
            </text>
          </g>
        )}
      </svg>
      <details className="chart-numbers">
        <summary>The numbers</summary>
        <table>
          <caption className="visually-hidden">{props.title}</caption>
          <thead>
            <tr>
              <th scope="col">{props.step}</th>
              <th scope="col">Accounts</th>
            </tr>
          </thead>
          <tbody>
            {labels.map((label, i) => (
              <tr key={i}>
                <th scope="row">{label}</th>
                <td>{n(values[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  )
}

/** A part of a split: what it counts, in words, and the colour of its piece of the bar. */
export interface SplitPart<Row> {
  readonly of: (row: Row) => number
  readonly name: string
  readonly tone: 'on' | 'stopped' | 'silent'
}

/**
 * Accounts by language: a row for each, its bar cut into the parts, and every part written out beside the colour
 * that stands for it, so nothing is told by colour alone. The bars share one scale: the longest is the language
 * with the most accounts. The largest language first, the row of accounts whose language is not known last.
 */
export function Split<Row extends { readonly language: AnnouncementLanguage | null }>(props: { label: string; rows: readonly Row[]; parts: readonly SplitPart<Row>[] }) {
  const total = (row: Row): number => props.parts.reduce((sum, part) => sum + part.of(row), 0)
  const rows = props.rows.filter((row) => total(row) > 0).sort((a, b) => Number(a.language === null) - Number(b.language === null) || total(b) - total(a))
  const most = Math.max(1, ...rows.map(total))
  if (rows.length === 0) return <p className="note">No accounts to count here yet.</p>
  return (
    <ul className="split" aria-label={props.label}>
      {rows.map((row) => (
        <li key={row.language ?? 'unknown'}>
          <span className="split-name">{row.language === null ? 'Not known' : LANGUAGE_NAMES[row.language]}</span>
          <span className="split-total">{n(total(row))}</span>
          <span className="split-track" aria-hidden="true" style={{ width: `${(total(row) / most) * 100}%` }}>
            {props.parts.map((part) => (part.of(row) > 0 ? <i key={part.name} className={part.tone} style={{ flexGrow: part.of(row) } as CSSProperties} /> : null))}
          </span>
          <span className="split-parts">
            {props.parts.map((part) => (
              <span key={part.name} className={`split-part ${part.tone}`}>
                {n(part.of(row))} {part.name}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  )
}

export const NEWS_PARTS: readonly SplitPart<AccountSplits['news'][number]>[] = [
  { of: (row) => row.given, name: 'agreed', tone: 'on' },
  { of: (row) => row.withdrawn, name: 'withdrew', tone: 'stopped' },
  { of: (row) => row.none, name: 'said nothing', tone: 'silent' },
]

export const REMINDER_PARTS: readonly SplitPart<AccountSplits['reminders'][number]>[] = [
  { of: (row) => row.sending, name: 'sending', tone: 'on' },
  { of: (row) => row.paused, name: 'paused', tone: 'stopped' },
]
