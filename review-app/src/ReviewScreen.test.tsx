import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RowView } from '../server/types'
import { ReviewScreen } from './ReviewScreen'
import { bankClean } from './testRows'

afterEach(cleanup)

const row = (key: string, over: Partial<RowView> = {}): RowView => ({ ...bankClean, key, ...over })
const decided = (key: string) => row(key, { decided: { verdict: 'ok', note: '' } })
const never = () => Promise.resolve()

describe('ReviewScreen', () => {
  it('says it is loading, not that nothing is left, until the rows are there', () => {
    render(<ReviewScreen rows={[]} loading onDecide={() => Promise.resolve(null)} onReload={never} actions={<button>Submit 0 decisions</button>} />)
    expect(screen.getByText('Loading…')).toBeTruthy()
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
  })

  it('says nothing is left once the rows are loaded and there are none to decide', () => {
    render(<ReviewScreen rows={[decided('a-1')]} onDecide={() => Promise.resolve(null)} onReload={never} />)
    expect(screen.getByText('Nothing left to decide here.')).toBeTruthy()
  })

  it('shows a first load that failed as that, with Try again, not as nothing left', async () => {
    const onReload = vi.fn(() => Promise.resolve())
    const onBack = vi.fn()
    render(<ReviewScreen rows={[]} loadFailed notice="no database" onBack={onBack} onDecide={() => Promise.resolve(null)} onReload={onReload} actions={<button>Submit 0 decisions</button>} />)
    expect(screen.getByRole('status').textContent).toBe('no database')
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Submit/ })).toBeNull()
    // the way back stays
    expect(screen.getByRole('button', { name: 'Back to my assignments' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(onReload).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Try again' }).disabled).toBe(false))
  })

  it('keeps the rows on the screen when a later reload fails', () => {
    render(<ReviewScreen rows={[row('a-1')]} loadFailed notice="no database" onDecide={() => Promise.resolve(null)} onReload={never} />)
    expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('offers the way back as "Back to my assignments" when nothing is left', () => {
    const onBack = vi.fn()
    render(<ReviewScreen rows={[decided('a-1')]} onBack={onBack} onDecide={() => Promise.resolve(null)} onReload={never} />)
    expect(screen.queryByRole('button', { name: 'Back to assignments' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to my assignments' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('has no row list while a row is being edited: All rows is disabled and L does nothing', () => {
    render(<ReviewScreen rows={[row('a-1'), row('b-1')]} onDecide={() => Promise.resolve(null)} onReload={never} />)
    const allRows = screen.getByRole<HTMLButtonElement>('button', { name: 'All rows' })
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'речен бряг' } })
    expect(allRows.disabled).toBe(true)
    fireEvent.keyDown(window, { key: 'l' })
    fireEvent.keyDown(window, { key: 'L' })
    expect(screen.queryByRole('dialog')).toBeNull()
    // the edit is still there
    expect((screen.getByLabelText('Translation') as HTMLInputElement).value).toBe('речен бряг')
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(allRows.disabled).toBe(false)
    fireEvent.keyDown(window, { key: 'l' })
    expect(screen.getByRole('dialog', { name: 'All rows' })).toBeTruthy()
  })

  it('opens the row list again after an edit was saved', async () => {
    function Parent() {
      const [rows, setRows] = useState<readonly RowView[]>([row('a-1'), row('b-1')])
      return <ReviewScreen rows={rows} onDecide={() => Promise.resolve(null)} onReload={() => (setRows([decided('a-1'), row('b-1')]), Promise.resolve())} />
    }
    render(<Parent />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('article', { name: 'Row b-1' })).toBeTruthy()
    await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: 'All rows' }).disabled).toBe(false))
  })

  it('shows the first undecided row in its very first render', () => {
    const html = renderToStaticMarkup(<ReviewScreen rows={[decided('a-1'), row('b-1')]} onDecide={() => Promise.resolve(null)} onReload={never} />)
    expect(html).toContain('aria-label="Row b-1"')
    expect(html).not.toContain('Nothing left to decide here.')
  })

  it('falls back to the first undecided row when a reload takes the selected row away', async () => {
    // Deciding a-1 moves on to b-1; the reload that comes with the decision no longer has b-1, and shows itself
    // before the screen moves on.
    function Parent() {
      const [rows, setRows] = useState<readonly RowView[]>([row('a-1'), row('b-1'), row('c-1')])
      return (
        <ReviewScreen
          rows={rows}
          onDecide={() => Promise.resolve(null)}
          onReload={async () => {
            setRows([decided('a-1'), row('c-1')])
            await new Promise((resolve) => setTimeout(resolve, 5))
          }}
        />
      )
    }
    render(<Parent />)
    fireEvent.click(screen.getByRole('button', { name: /Keep/ }))
    expect(await screen.findByRole('article', { name: 'Row c-1' })).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: /Keep/ }) as HTMLButtonElement).disabled).toBe(false))
    expect(screen.getByRole('article', { name: 'Row c-1' })).toBeTruthy()
    expect(screen.queryByText('Nothing left to decide here.')).toBeNull()
  })

  it('keeps a decided row that was opened from the list', () => {
    render(<ReviewScreen rows={[decided('a-1'), row('b-1')]} onDecide={() => Promise.resolve(null)} onReload={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'All rows' }))
    fireEvent.click(screen.getByRole('button', { name: /a-1/ }))
    expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy()
  })

  it('moves to the next undecided row on a swipe to the left and back on one to the right', () => {
    render(<ReviewScreen rows={[row('a-1'), decided('b-1'), row('c-1')]} onDecide={() => Promise.resolve(null)} onReload={never} />)
    const swipe = (from: number, to: number) => {
      const word = screen.getByRole('heading', { name: 'bank' })
      fireEvent.pointerDown(word, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: from, clientY: 300 })
      fireEvent.pointerUp(word, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: to, clientY: 300 })
    }
    swipe(300, 180)
    expect(screen.getByRole('article', { name: 'Row c-1' })).toBeTruthy()
    swipe(100, 220)
    expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy()
  })

  it('offers the way back in the row list when there is one', () => {
    const onBack = vi.fn()
    render(<ReviewScreen rows={[row('a-1')]} title="German translations · flagged rows" onBack={onBack} onDecide={() => Promise.resolve(null)} onReload={never} />)
    fireEvent.click(screen.getByRole('button', { name: 'All rows' }))
    const dialog = screen.getByRole('dialog', { name: 'All rows' })
    expect(dialog.textContent).toContain('German translations · flagged rows')
    fireEvent.click(screen.getByRole('button', { name: 'Back to my assignments' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})
