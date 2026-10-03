import { describe, expect, it, vi } from 'vitest'
import { forwardConsole } from './helpers'

type Listener = (message: { type(): string; text(): string }) => void

function fakeContext() {
  let listener: Listener = () => undefined
  return {
    context: { on: (_event: 'console', l: Listener) => void (listener = l) },
    say: (type: string, text: string) => listener({ type: () => type, text: () => text }),
  }
}

describe('forwardConsole (what a stalled WebKit page said, in the CI log)', () => {
  it('prints warnings and errors, and nothing else', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const { context, say } = fakeContext()
      forwardConsole(context)
      say('log', 'hello')
      say('info', 'ready')
      say('warning', 'IndexedDB: deleting wordado-demo is blocked by a connection still open, 1000 ms so far')
      say('error', 'UnknownError: An internal error was encountered in the Indexed Database server')
      expect(log.mock.calls.map((c) => c[0])).toEqual([
        '[browser warning] IndexedDB: deleting wordado-demo is blocked by a connection still open, 1000 ms so far',
        '[browser error] UnknownError: An internal error was encountered in the Indexed Database server',
      ])
    } finally {
      log.mockRestore()
    }
  })

  it('leaves out HTTP error statuses, which the demo’s country lookup gives on every visit, but not WebKit’s internal errors', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const { context, say } = fakeContext()
      forwardConsole(context)
      say('error', 'Failed to load resource: the server responded with a status of 502 (Bad Gateway)')
      say('error', 'Failed to load resource: WebKit encountered an internal error')
      expect(log.mock.calls.map((c) => c[0])).toEqual(['[browser error] Failed to load resource: WebKit encountered an internal error'])
    } finally {
      log.mockRestore()
    }
  })
})
