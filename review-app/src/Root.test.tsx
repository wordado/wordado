import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Root } from './Root'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
const respond = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status })))

describe('Root, for an address without an invitation', () => {
  it('names the signed-in address and offers a sign-in with another one', async () => {
    respond(403, { message: 'This address has no invitation. Ask the coordinator for one.', email: 'stranger@example.com' })
    render(<Root />)
    expect(await screen.findByText('stranger@example.com')).toBeTruthy()
    expect(screen.getByText('This address has no invitation. Ask the coordinator for one.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Sign in with another address' }).getAttribute('href')).toBe('/cdn-cgi/access/logout')
  })
  it('still offers the way out when the answer names no address', async () => {
    respond(403, { message: 'No invitation.' })
    render(<Root />)
    expect((await screen.findByRole('link', { name: 'Sign in with another address' })).getAttribute('href')).toBe('/cdn-cgi/access/logout')
    expect(screen.queryByText(/You are signed in as/)).toBeNull()
  })
})
