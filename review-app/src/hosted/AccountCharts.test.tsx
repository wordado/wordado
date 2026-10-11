import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountSeries } from '../../shared/hosted'
import { accountsByWeek, Chart, madeByWeek, scaleOf, studiedByDay, utcDay } from './AccountCharts'

afterEach(cleanup)

const DAY = 86_400_000
const MONDAY = Date.parse('2026-10-05T00:00:00Z')
const series: AccountSeries = { readAt: MONDAY + 2 * DAY, accounts: 10, weekStart: MONDAY, madeByWeek: [1, 0, 3, 2], dayStart: MONDAY + 2 * DAY, studiedByDay: [4, 0, 5] }

describe('the charts of the Accounts tab (#209)', () => {
  it('names a day by its UTC date, whatever the time zone of the screen', () => {
    expect(utcDay(MONDAY)).toBe(new Date(MONDAY).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }))
    expect(utcDay(MONDAY)).toBe(utcDay(MONDAY + DAY - 1))
    expect(utcDay(MONDAY)).not.toBe(utcDay(MONDAY - 1))
  })

  it('cuts the weeks and the days to the period asked for, each named by the day it began', () => {
    expect(madeByWeek(series, 2)).toEqual({ values: [3, 2], labels: [utcDay(MONDAY - 7 * DAY), utcDay(MONDAY)] })
    // More asked for than there is: what there is.
    expect(madeByWeek(series, 12).values).toEqual([1, 0, 3, 2])
    expect(studiedByDay(series, 2)).toEqual({ values: [0, 5], labels: [utcDay(MONDAY + DAY), utcDay(MONDAY + 2 * DAY)] })
  })

  it('adds the weeks up to the accounts there are now: before the first week there were those made earlier', () => {
    expect(accountsByWeek(series).values).toEqual([5, 5, 8, 10])
    expect(accountsByWeek({ ...series, accounts: 0, madeByWeek: [0, 0] }).values).toEqual([0, 0])
  })

  it('picks a scale of whole numbers a person would pick, in at most four steps', () => {
    expect(scaleOf(0)).toEqual({ top: 1, step: 1 })
    expect(scaleOf(1)).toEqual({ top: 1, step: 1 })
    expect(scaleOf(4)).toEqual({ top: 4, step: 1 })
    expect(scaleOf(7)).toEqual({ top: 8, step: 2 })
    expect(scaleOf(18)).toEqual({ top: 20, step: 5 })
    expect(scaleOf(43)).toEqual({ top: 60, step: 20 })
    expect(scaleOf(1204)).toEqual({ top: 1500, step: 500 })
  })

  it('draws nothing it cannot when every number is nothing, and still gives the numbers as text', () => {
    render(<Chart kind="bars" title="New accounts per week" step="Week from" points={{ labels: ['a', 'b'], values: [0, 0] }} />)
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe('New accounts per week, a to b: between 0 and 0, 0 at the end. The numbers are in the table below.')
    expect(screen.getByRole('img').querySelectorAll('.chart-bar')).toHaveLength(0)
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })

  it('reads out the step that is pointed at', () => {
    render(<Chart kind="line" title="Accounts in total" step="Week from" points={{ labels: ['a', 'b', 'c'], values: [5, 8, 10] }} />)
    const chart = screen.getByRole('img')
    expect(chart.querySelector('.chart-at')).toBeNull()
    // Far to the right of everything: the last step.
    fireEvent.pointerMove(chart, { clientX: 5000 })
    expect(chart.querySelector('.chart-at text')!.textContent).toBe('c: 10')
    fireEvent.pointerMove(chart, { clientX: 0 })
    expect(chart.querySelector('.chart-at text')!.textContent).toBe('a: 5')
    fireEvent.pointerLeave(chart)
    expect(chart.querySelector('.chart-at')).toBeNull()
  })
})
