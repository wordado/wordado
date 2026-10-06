import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { RowDrawer } from './RowDrawer'
import { bank, bankClean, pressEscapeInDialog, withoutShowModal } from './testRows'

afterEach(cleanup)

const rows = [bank, { ...bankClean, key: 'the-1', context: { level: 'A1' }, decided: { verdict: 'ok', note: '' } }]
const show = (open: boolean) => {
  const on = { onSelect: vi.fn(), onClose: vi.fn(), onLevel: vi.fn(), onSeverity: vi.fn() }
  const view = render(<RowDrawer open={open} rows={rows} selected="bank-2" level="" severity="" {...on} />)
  return { ...on, view }
}

describe('RowDrawer', () => {
  it('shows nothing while closed', () => {
    show(false)
    expect(screen.queryByRole('list', { name: 'Rows' })).toBeNull()
    expect(screen.queryByLabelText('Level')).toBeNull()
  })

  it('shows the filters and the rows when open: key, level, chip, decision', () => {
    show(true)
    const dialog = screen.getByRole('dialog', { name: 'All rows' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(within(dialog).getByLabelText('Level')).toBeTruthy()
    expect(within(dialog).getByLabelText('Severity')).toBeTruthy()
    const list = within(dialog).getByRole('list', { name: 'Rows' })
    const [first, second] = within(list).getAllByRole('button')
    expect(first!.textContent).toBe('bank-2A2major')
    expect(first!.getAttribute('aria-current')).toBe('true')
    expect(second!.textContent).toBe('the-1A1ok')
    expect(within(dialog).getByText('1 of 2 decided')).toBeTruthy()
  })

  it('passes the filters on', () => {
    const { onLevel, onSeverity } = show(true)
    fireEvent.change(screen.getByLabelText('Level'), { target: { value: 'A1' } })
    expect(onLevel).toHaveBeenCalledWith('A1')
    fireEvent.change(screen.getByLabelText('Severity'), { target: { value: 'report' } })
    expect(onSeverity).toHaveBeenCalledWith('report')
  })

  it('selects the chosen row, then closes', () => {
    const { onSelect, onClose } = show(true)
    fireEvent.click(screen.getByRole('button', { name: /the-1/ }))
    expect(onSelect).toHaveBeenCalledWith('the-1')
    expect(onClose).toHaveBeenCalled()
    expect(onSelect.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!)
  })

  it('closes with the Close button, and once on Escape, which a modal dialog handles itself', () => {
    const { onClose } = show(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    pressEscapeInDialog()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape where there is no showModal', () => {
    withoutShowModal(() => {
      const { onClose } = show(true)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('gives the focus back to what opened it: after Close, after Escape and after choosing a row', () => {
    const onClose = vi.fn()
    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>All rows</button>
          <RowDrawer open={open} rows={rows} selected="bank-2" level="" severity="" onSelect={() => {}} onClose={() => (onClose(), setOpen(false))} onLevel={() => {}} onSeverity={() => {}} />
        </>
      )
    }
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'All rows' })
    const closings = [
      () => fireEvent.click(screen.getByRole('button', { name: 'Close' })),
      pressEscapeInDialog,
      () => fireEvent.click(screen.getByRole('button', { name: /the-1/ })),
    ]
    closings.forEach((close, i) => {
      opener.focus()
      fireEvent.click(opener)
      screen.getByRole<HTMLButtonElement>('button', { name: 'Close' }).focus()
      close()
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
      expect(onClose).toHaveBeenCalledTimes(i + 1)
    })
  })

  it('says so when the filters leave no row', () => {
    const on = { onSelect: vi.fn(), onClose: vi.fn(), onLevel: vi.fn(), onSeverity: vi.fn() }
    render(<RowDrawer open rows={[]} selected={null} level="C1" severity="" {...on} />)
    expect(screen.getByText('No rows match these filters.')).toBeTruthy()
  })
})
