import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'
import { pressEscapeInDialog, withoutShowModal } from './testRows'

afterEach(cleanup)

const show = (open: boolean, error?: string) => {
  const onClose = vi.fn()
  render(
    <Dialog open={open} title="Invite a reviewer" onClose={onClose} {...(error ? { error } : {})}>
      <label>
        Email <input />
      </label>
    </Dialog>,
  )
  return onClose
}

describe('Dialog', () => {
  it('shows nothing while closed', () => {
    show(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('is a dialog named by its title, with its content', () => {
    show(true)
    const dialog = screen.getByRole('dialog', { name: 'Invite a reviewer' }) as HTMLDialogElement
    expect(dialog.open).toBe(true)
    expect(within(dialog).getByRole('heading', { name: 'Invite a reviewer' })).toBeTruthy()
    expect(within(dialog).getByLabelText('Email')).toBeTruthy()
    expect(within(dialog).queryByRole('alert')).toBeNull()
  })

  it('closes with the Close button, and once on Escape, which a modal dialog handles itself', () => {
    const onClose = show(true)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    pressEscapeInDialog()
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on Escape where there is no showModal', () => {
    withoutShowModal(() => {
      const onClose = show(true)
      expect((screen.getByRole('dialog') as HTMLDialogElement).open).toBe(true)
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })

  it('gives the focus back to what opened it, however it closes', () => {
    const onClose = vi.fn()
    function Page() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button onClick={() => setOpen(true)}>Invite a reviewer</button>
          <Dialog open={open} title="Invite" onClose={() => (onClose(), setOpen(false))}>
            <label>
              Email <input />
            </label>
            <button onClick={() => setOpen(false)}>Send</button>
          </Dialog>
        </>
      )
    }
    render(<Page />)
    const opener = screen.getByRole('button', { name: 'Invite a reviewer' })
    const open = () => {
      opener.focus()
      fireEvent.click(opener)
      expect(document.activeElement).toBe(screen.getByLabelText('Email'))
    }
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(onClose).toHaveBeenCalledTimes(1)
    // an action in it that went through
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(onClose).toHaveBeenCalledTimes(1)
    // Escape
    open()
    pressEscapeInDialog()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('leaves the focus alone when what opened it is gone', () => {
    function Page() {
      const [state, setState] = useState<'closed' | 'open' | 'done'>('closed')
      return (
        <>
          {state !== 'done' && <button onClick={() => setState('open')}>Disable Rita</button>}
          <Dialog open={state === 'open'} title="Disable" onClose={() => setState('closed')}>
            <button onClick={() => setState('done')}>Yes</button>
          </Dialog>
        </>
      )
    }
    render(<Page />)
    screen.getByRole('button', { name: 'Disable Rita' }).focus()
    fireEvent.click(screen.getByRole('button', { name: 'Disable Rita' }))
    expect(() => fireEvent.click(screen.getByRole('button', { name: 'Yes' }))).not.toThrow()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows an error inside it, where the page behind cannot', () => {
    show(true, 'That file is already assigned.')
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('That file is already assigned.')
  })
})
