import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ProgressBar } from './ProgressBar'

afterEach(cleanup)

describe('ProgressBar (spec §11.1)', () => {
  it('says how far along it is when the size is known', () => {
    render(<ProgressBar label="Getting your words ready" value={30} max={120} />)
    const bar = screen.getByRole('progressbar', { name: 'Getting your words ready' })
    expect(bar.getAttribute('aria-valuemin')).toBe('0')
    expect(bar.getAttribute('aria-valuemax')).toBe('120')
    expect(bar.getAttribute('aria-valuenow')).toBe('30')
    expect(bar.hasAttribute('aria-busy')).toBe(false)
    expect((bar.firstElementChild as HTMLElement).style.width).toBe('25%')
  })

  it('never says more than everything, or less than nothing', () => {
    const { rerender } = render(<ProgressBar label="x" value={150} max={120} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('120')
    rerender(<ProgressBar label="x" value={-1} max={120} />)
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
  })

  it('is busy, with no value, when the size is not known', () => {
    const unknown = () => {
      const bar = screen.getByRole('progressbar', { name: 'Updating Wordado…' })
      expect(bar.getAttribute('aria-busy')).toBe('true')
      expect(bar.hasAttribute('aria-valuenow')).toBe(false)
      expect(bar.hasAttribute('aria-valuemax')).toBe(false)
      expect(bar.classList.contains('is-indeterminate')).toBe(true)
      expect((bar.firstElementChild as HTMLElement).style.width).toBe('')
    }
    const { rerender } = render(<ProgressBar label="Updating Wordado…" />)
    unknown()
    rerender(<ProgressBar label="Updating Wordado…" value={5} max={0} />)
    unknown()
    rerender(<ProgressBar label="Updating Wordado…" value={5} />)
    unknown()
  })
})
