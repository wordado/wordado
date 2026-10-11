import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountFound, AccountSweep, AccountSweepView } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminAccounts, dayWithYear } from './AdminAccounts'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const CREATED = Date.parse('2026-01-05T09:00:00Z')
const SIGNED_IN = Date.parse('2026-09-30T18:00:00Z')
const sweep = (over: Partial<AccountSweep> = {}): AccountSweep => ({ months: 24, batch: 50, due: 0, undated: 0, taken: 0, lastRunAt: null, lastTaken: 0, ...over })
const found: AccountFound = { found: true, createdAt: CREATED, lastSignInAt: SIGNED_IN }

function shown(first: AccountSweepView | Error = { connected: true, sweep: sweep() }, account: AccountFound | Error = found) {
  const read = vi.spyOn(hostedApi.admin, 'accountSweep')
  if (first instanceof Error) read.mockRejectedValue(first)
  else read.mockResolvedValue(first)
  const lookUp = vi.spyOn(hostedApi.admin, 'lookUpAccount')
  if (account instanceof Error) lookUp.mockRejectedValue(account)
  else lookUp.mockResolvedValue(account)
  const del = vi.spyOn(hostedApi.admin, 'deleteAccount').mockResolvedValue({ deleted: true })
  render(<AdminAccounts />)
  return { read, lookUp, del }
}

const tiles = async () => within(await screen.findByRole('list', { name: 'The sweep of inactive accounts' })).getAllByRole('listitem').map((li) => li.textContent)
const lookUpForm = () => screen.findByRole('form', { name: 'Look an account up' })
async function lookUp(email: string) {
  const form = await lookUpForm()
  fireEvent.change(within(form).getByLabelText('Email address'), { target: { value: email } })
  fireEvent.click(within(form).getByRole('button', { name: 'Look up' }))
}
/** Looks the account up and opens the question; gives the dialog. */
async function asking(email = 'ana@example.com') {
  await lookUp(email)
  fireEvent.click(await screen.findByRole('button', { name: 'Delete this account…' }))
  return screen.getByRole('dialog', { name: 'Delete this account?' })
}

describe('AdminAccounts: the Accounts tab (#187)', () => {
  it('shows what the sweep would take next and what it took', async () => {
    shown({ connected: true, sweep: sweep({ due: 70, taken: 12, lastRunAt: SIGNED_IN, lastTaken: 2 }) })
    expect(await tiles()).toEqual(['70past 24 months now', '50the next run deletes', '2deleted by the last run', '12deleted so far'])
    expect(screen.getByText(`An account not signed in to for 24 months is deleted, at most 50 a day, with no mail first. Last run: ${dayWithYear(SIGNED_IN)}.`)).toBeTruthy()
    expect(screen.queryByText(/no date of a last sign-in/)).toBeNull()
  })

  it('says so while the sweep has not run, and counts the accounts it never takes', async () => {
    shown({ connected: true, sweep: sweep({ due: 3, undated: 1 }) })
    expect(await tiles()).toEqual(['3past 24 months now', '3the next run deletes', '0deleted by the last run', '0deleted so far'])
    expect(screen.getByText(/It has not run yet\.$/)).toBeTruthy()
    expect(screen.getByText('1 account has no date of a last sign-in: the sweep never takes it.')).toBeTruthy()
  })

  it('says it is not connected, and offers nothing to do', async () => {
    shown({ connected: false })
    expect(await screen.findByText(/Accounts are not connected/)).toBeTruthy()
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByRole('list')).toBeNull()
  })

  it('says the counts could not be read, and reads them again when asked; the lookup is there all the same', async () => {
    const { read } = shown(new Error('The app’s server could not be reached.'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The sweep’s counts could not be read. The app’s server could not be reached.')
    read.mockResolvedValue({ connected: true, sweep: sweep({ due: 1 }) })
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await tiles())[0]).toBe('1past 24 months now')
    expect(await lookUpForm()).toBeTruthy()
  })

  it('looks an account up by the whole address: when it was made and last signed in, and nothing else', async () => {
    const { lookUp: asked } = shown()
    await lookUp('  ana@example.com ')
    const account = await screen.findByRole('region', { name: 'The account' })
    expect(asked).toHaveBeenCalledWith('ana@example.com')
    expect(within(account).getByText('ana@example.com')).toBeTruthy()
    expect(within(account).getByText(`Created ${dayWithYear(CREATED)}`)).toBeTruthy()
    expect(within(account).getByText(`Last sign-in ${dayWithYear(SIGNED_IN)}`)).toBeTruthy()
    expect(within(account).getByRole('button', { name: 'Delete this account…' })).toBeTruthy()
  })

  it('says so when no account has the address, or when no sign-in was recorded', async () => {
    const { lookUp: asked } = shown(undefined, { found: false })
    await lookUp('nobody@example.com')
    expect(await screen.findByText('No account has the address nobody@example.com.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete this account…' })).toBeNull()
    asked.mockResolvedValue({ found: true, createdAt: CREATED, lastSignInAt: null })
    await lookUp('ben@example.com')
    expect(await screen.findByText('Last sign-in not recorded')).toBeTruthy()
  })

  it('forgets the account when the address in the field changes: what is deleted is what was looked up', async () => {
    shown()
    await lookUp('ana@example.com')
    await screen.findByRole('region', { name: 'The account' })
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ana@example.co' } })
    expect(screen.queryByRole('region', { name: 'The account' })).toBeNull()
  })

  it('deletes only after the question is answered with the address typed again', async () => {
    const { del, read } = shown()
    const dialog = await asking()
    expect(within(dialog).getByText(`Created ${dayWithYear(CREATED)} · last sign-in ${dayWithYear(SIGNED_IN)}`)).toBeTruthy()
    const button = within(dialog).getByRole('button', { name: 'Delete the account' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    const again = within(dialog).getByLabelText('Type the address again to delete the account')
    fireEvent.change(again, { target: { value: 'ana@example.co' } })
    expect(button.disabled).toBe(true)
    fireEvent.submit(again.closest('form')!)
    expect(del).not.toHaveBeenCalled()
    fireEvent.change(again, { target: { value: ' Ana@Example.com' } })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(del).toHaveBeenCalledWith('ana@example.com'))
    expect(await screen.findByText('The account of ana@example.com was deleted.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('region', { name: 'The account' })).toBeNull()
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe('')
    // The counts are read again.
    expect(read).toHaveBeenCalledTimes(2)
  })

  it('deletes nothing when the question is closed', async () => {
    const { del } = shown()
    const dialog = await asking()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(del).not.toHaveBeenCalled()
    expect(screen.getByRole('region', { name: 'The account' })).toBeTruthy()
  })

  it('says in the dialog what went wrong, and when the account was already gone', async () => {
    const { del } = shown()
    del.mockRejectedValueOnce(new Error('The app’s server could not be reached.'))
    const dialog = await asking()
    fireEvent.change(within(dialog).getByLabelText('Type the address again to delete the account'), { target: { value: 'ana@example.com' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the account' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The app’s server could not be reached.')
    del.mockResolvedValueOnce({ deleted: false })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the account' }))
    expect(await screen.findByText('No account had the address ana@example.com any more: nothing was deleted.')).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('says why an account could not be looked up', async () => {
    shown(undefined, new Error('The app’s server answered 404. Check that ADMIN_WRITE_TOKEN is the same in both deployments.'))
    await lookUp('ana@example.com')
    expect((await screen.findByRole('alert')).textContent).toContain('ADMIN_WRITE_TOKEN is the same in both deployments')
  })
})
