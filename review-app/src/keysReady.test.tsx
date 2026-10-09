// The keys of a row work from the moment the row is on screen (issue #101). React runs an ordinary effect a
// moment after it has drawn, on its scheduler; a key pressed in between found no listener, which failed a test
// about once in a few dozen runs on a busy machine. Here the scheduler is made late on purpose, so the gap is
// wide every time: this test fails if the listener goes back into an ordinary effect.
import { afterEach, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  // React's scheduler uses setImmediate where there is one (Node, and so these tests).
  ;(globalThis as unknown as { setImmediate: unknown }).setImmediate = (fn: () => void) => setTimeout(fn, 30)
})

const { cleanup, fireEvent, render, screen, waitFor } = await import('@testing-library/react')
const { App } = await import('./App')
const { api } = await import('./api')

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const base = { queue: 'translation-bg', file: 'f', version: 'v', kind: 'translation' as const, cells: {}, fields: [], otherSenses: [], ai: 'flagged' as const, objections: [], decided: null, stale: false, rowHash: 'h' }
const a1 = { ...base, key: 'a-1', context: { level: 'A1' }, reports: '', severity: 'major' as const }
const b1 = { ...base, key: 'b-1', context: { level: 'B2' }, reports: '', severity: 'minor' as const }

it('decides with a key pressed the moment the row appears', async () => {
  vi.spyOn(api, 'reviewer').mockResolvedValue('Tester')
  vi.spyOn(api, 'queues').mockResolvedValue([{ queue: 'translation-bg', open: 2, flagged: 2, reported: 0, decided: 0 }])
  const rows = vi.spyOn(api, 'rows').mockResolvedValue([a1, b1])
  const decide = vi.spyOn(api, 'decide').mockResolvedValue({ ok: true, version: 'v' })
  render(<App />)
  await waitFor(() => expect(screen.getByRole('article', { name: 'Row a-1' })).toBeTruthy())
  rows.mockResolvedValue([{ ...a1, decided: { verdict: 'ok', note: '' } }, b1])
  fireEvent.keyDown(window, { key: '2' })
  await waitFor(() => expect(screen.getByRole('article', { name: 'Row b-1' })).toBeTruthy())
  expect(decide).toHaveBeenCalledWith(expect.objectContaining({ key: 'a-1', action: 'keep' }))
})
