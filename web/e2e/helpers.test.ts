import { describe, expect, it, vi } from 'vitest'
import { forwardConsole } from './helpers'

type Listener = (message: { type(): string; text(): string }) => void

function fakeContext(engine = 'webkit') {
  let listener: Listener = () => undefined
  return {
    context: {
      browser: () => ({ browserType: () => ({ name: () => engine }) }),
      on: (_event: 'console', l: Listener) => void (listener = l),
    },
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

  it('stays quiet outside WebKit, whose stalls it is for: Firefox cannot play the clips there, and the offline tests cut the network', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      for (const engine of ['chromium', 'firefox']) {
        const { context, say } = fakeContext(engine)
        forwardConsole(context)
        say('warning', 'Media resource blob:http://localhost:4173/x could not be decoded.')
        say('error', 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED')
      }
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('leaves out Playwright’s own notice that it blocked the service worker', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      const { context, say } = fakeContext()
      forwardConsole(context)
      say('warning', 'Service Worker registration blocked by Playwright')
      expect(log).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })
})
