import { describe, expect, it } from 'vitest'
import { reminderNotification } from './notification'

describe('reminderNotification (plan 5 contract)', () => {
  it('shows what the server says, asking with the device’s offset and language', async () => {
    const asked: string[] = []
    const got = await reminderNotification(
      async (url, init) => {
        asked.push(`${url} ${init?.credentials}`)
        return new Response(JSON.stringify({ title: 'Wordado', body: 'Имате 3 думи за преговор днес.' }), { status: 200 })
      },
      'bg',
      120,
    )
    expect(asked).toEqual(['/v1/reminder?tz=120&lang=bg include'])
    expect(got).toEqual({ title: 'Wordado', body: 'Имате 3 думи за преговор днес.' })
  })

  it('still shows a reminder when the server cannot be asked', async () => {
    const offline = await reminderNotification(async () => Promise.reject(new TypeError('Failed to fetch')), 'en', 0)
    expect(offline).toEqual({ title: 'Wordado', body: 'Time for your words.' })
    const refused = await reminderNotification(async () => new Response('{}', { status: 401 }), 'bg', 0)
    expect(refused.body).toBe('Време е за думите ви.')
  })
})
