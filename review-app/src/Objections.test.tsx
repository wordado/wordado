import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Objections } from './Objections'
import { bankThree } from './testRows'

afterEach(cleanup)

describe('Objections', () => {
  it('says the severity in words inside the chip, not only by its colour', () => {
    render(<Objections objections={bankThree.objections} reports="" ticked={new Set([0, 2])} onTick={() => {}} />)
    const major = screen.getAllByText('wrong-sense')[0]!
    expect(major.classList.contains('chip')).toBe(true)
    expect(major.querySelector('.visually-hidden')?.textContent).toBe('major: ')
    expect(major.textContent).toBe('major: wrong-sense')
    const minor = screen.getByText('sense-unclear')
    expect(minor.querySelector('.visually-hidden')?.textContent).toBe('minor: ')
  })
})
