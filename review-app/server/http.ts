import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { runImport, saveDecision } from './decisions'
import { listQueues, listRows } from './model'
import { readReviewer, writeReviewer } from './settings'
import type { DecisionRequest } from './types'

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }
const STATUS = { changed: 409, gone: 410, invalid: 400 } as const

/** Thrown by body() for a request the client got wrong (bad JSON); the route catch-all answers 400 for this, 500 for anything else. */
class BadBody extends Error {}

async function body(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  const text = Buffer.concat(chunks).toString('utf8')
  if (text === '') return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BadBody('the request body is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new BadBody('the request body is not valid JSON')
  return parsed
}

/** The file to serve for a request path: the one inside staticDir it names, or staticDir/index.html when it names none, escapes staticDir, or the path cannot be decoded. */
function staticFile(staticDir: string, pathname: string): string {
  const indexFile = join(staticDir, 'index.html')
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return indexFile
  }
  const file = resolve(staticDir, '.' + decoded)
  const rel = relative(staticDir, file)
  if (rel.startsWith('..') || isAbsolute(rel)) return indexFile
  if (!existsSync(file) || statSync(file).isDirectory()) return indexFile
  return file
}

/** The Host header a request to this server, once listening on `server`, must carry. Returns null before `listen` resolves a port. */
function expectedHosts(server: Server): readonly string[] | null {
  const addr = server.address()
  if (addr === null || typeof addr === 'string') return null
  const a = addr as AddressInfo
  return [`127.0.0.1:${a.port}`, `localhost:${a.port}`]
}

export function createReviewServer(opts: { dir: string; staticDir: string | null; settings: string; now: () => string }): Server {
  const send = (res: ServerResponse, status: number, value: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(value))
  }
  let server: Server
  server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        // Local-only: a page from elsewhere cannot reach this API through the browser's same-origin rules, but a
        // malicious page can still have a visitor's browser POST or navigate here, so Host is checked explicitly.
        const hosts = expectedHosts(server)
        if (hosts === null || !hosts.includes(req.headers.host ?? '')) return send(res, 403, { message: 'bad Host header' })
        if (req.method === 'POST' && !(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
          return send(res, 415, { message: 'a POST needs content-type: application/json' })
        }
        if (url.pathname === '/api/queues' && req.method === 'GET') return send(res, 200, listQueues(opts.dir))
        if (url.pathname === '/api/rows' && req.method === 'GET') return send(res, 200, listRows(opts.dir, url.searchParams.get('queue') ?? '', { withUnflagged: url.searchParams.get('all') === '1' }))
        if (url.pathname === '/api/decision' && req.method === 'POST') {
          const result = saveDecision(opts.dir, (await body(req)) as DecisionRequest)
          return send(res, result.ok ? 200 : STATUS[result.reason], result)
        }
        if (url.pathname === '/api/reviewer') {
          if (req.method === 'POST') {
            const name = String(((await body(req)) as { reviewer?: unknown }).reviewer ?? '').trim()
            if (name === '') return send(res, 400, { message: 'a name is needed' })
            writeReviewer(opts.settings, name)
          }
          return send(res, 200, { reviewer: readReviewer(opts.settings) })
        }
        if (url.pathname === '/api/import' && req.method === 'POST') {
          const by = readReviewer(opts.settings)
          if (!by) return send(res, 400, { message: 'set your name first' })
          return send(res, 200, runImport(opts.dir, by, opts.now()))
        }
        if (url.pathname.startsWith('/api/')) return send(res, 404, { message: 'no such API' })
        if (!opts.staticDir) return send(res, 404, { message: 'no UI built' })
        const file = staticFile(opts.staticDir, url.pathname)
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
        res.end(readFileSync(file))
      } catch (err) {
        if (err instanceof BadBody) return send(res, 400, { message: err.message })
        send(res, 500, { message: err instanceof Error ? err.message : String(err) })
      }
    })()
  })
  return server
}
