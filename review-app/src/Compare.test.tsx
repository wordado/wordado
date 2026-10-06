import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Compare } from './Compare'
import { bank, bankClean, bankThree, bankTwoFields, objection } from './testRows'

afterEach(cleanup)

const now = () => within(screen.getByRole('region', { name: 'Now' }))
const suggested = () => within(screen.getByRole('region', { name: 'AI suggests' }))

describe('Compare', () => {
  it('strikes the questioned value under Now and shows the fix under AI suggests', () => {
    render(<Compare row={bank} ticked={new Set([0])} />)
    expect(now().getByText('банка').classList.contains('struck')).toBe(true)
    // struck for assistive technology too, not only by its style
    expect(now().getByText('банка').tagName).toBe('S')
    expect(now().getByText('край на река').tagName).toBe('SPAN')
    expect(suggested().getByText('бряг')).toBeTruthy()
    expect(suggested().queryByText('банка')).toBeNull()
    // the fields no objection touches read the same on both sides
    expect(now().getByText('край на река').classList.contains('struck')).toBe(false)
    expect(suggested().getByText('край на река')).toBeTruthy()
    expect(now().getByText('none')).toBeTruthy()
    expect(suggested().getByText('none')).toBeTruthy()
  })

  it('does not strike the "none" of an empty field that a fix fills', () => {
    render(<Compare row={{ ...bank, objections: [objection({ field: 'alternates', category: 'missing', severity: 'minor', fix: 'бряг' })] }} ticked={new Set([0])} />)
    expect(now().getByText('none').classList.contains('struck')).toBe(false)
    expect(now().getByText('none').tagName).toBe('SPAN')
    expect(suggested().getByText('бряг').tagName).toBe('B')
  })

  it('marks only the changed values as changed', () => {
    render(<Compare row={bank} ticked={new Set([0])} />)
    expect(suggested().getByText('бряг').tagName).toBe('B')
    expect(suggested().getByText('край на река').tagName).not.toBe('B')
  })

  it('applies exactly the ticked fixes when a field has two objections', () => {
    const first = render(<Compare row={bankThree} ticked={new Set([0, 2])} />)
    expect(suggested().getByText('бряг')).toBeTruthy()
    expect(suggested().getByText('бряг на река')).toBeTruthy()
    expect(suggested().queryByText('крайбрежие')).toBeNull()
    first.unmount()
    render(<Compare row={bankThree} ticked={new Set([1, 2])} />)
    expect(suggested().getByText('крайбрежие')).toBeTruthy()
    expect(suggested().queryByText('бряг')).toBeNull()
    expect(suggested().getByText('бряг на река')).toBeTruthy()
  })

  it('leaves a questioned value unstruck when its fix is not ticked', () => {
    render(<Compare row={bankThree} ticked={new Set([0])} />)
    expect(now().getByText('банка').classList.contains('struck')).toBe(true)
    expect(now().getByText('край на река').classList.contains('struck')).toBe(false)
    expect(suggested().getByText('край на река')).toBeTruthy()
  })

  it('with one objection on each of two fields and one unticked, suggests only the ticked fix', () => {
    render(<Compare row={bankTwoFields} ticked={new Set([0])} />)
    expect(suggested().getByText('бряг').tagName).toBe('B')
    expect(suggested().getByText('край на река').tagName).not.toBe('B')
    expect(suggested().queryByText('бряг на река')).toBeNull()
    expect(now().getByText('банка').classList.contains('struck')).toBe(true)
    expect(now().getByText('край на река').classList.contains('struck')).toBe(false)
  })

  it('shows a fix that empties a field as a muted "none"', () => {
    render(<Compare row={{ ...bank, objections: [{ ...bank.objections[0]!, fix: '' }] }} ticked={new Set([0])} />)
    const none = suggested().getAllByText('none')
    expect(none.length).toBe(2)
    for (const n of none) expect(n.classList.contains('none')).toBe(true)
  })

  it('has no AI suggests box for a row without objections', () => {
    render(<Compare row={bankClean} ticked={new Set()} />)
    expect(screen.getByRole('region', { name: 'Now' })).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'AI suggests' })).toBeNull()
    expect(screen.queryByText('AI suggests')).toBeNull()
  })
})
