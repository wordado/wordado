import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Dialog } from './Dialog'

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

  it('closes on Escape and with the Close button', () => {
    const onClose = show(true)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('shows an error inside it, where the page behind cannot', () => {
    show(true, 'That file is already assigned.')
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toBe('That file is already assigned.')
  })
})
