import { readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import type { Plugin } from 'vite'

/** Where the app finds the bundled sample, with the CDN's layout (plan 3 contract). */
export const SAMPLE_PREFIX = 'content/sample/'

const TYPES: Readonly<Record<string, string>> = { '.json': 'application/json', '.pack': 'application/json', '.m4a': 'audio/mp4' }

export function contentType(file: string): string {
  return TYPES[extname(file)] ?? 'application/octet-stream'
}

/** Every file of the sample the manifest can reach, relative and with forward slashes; not the pipeline's `source.json`. */
export function sampleFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (at: string) => {
    for (const name of readdirSync(at).sort()) {
      const full = join(at, name)
      if (statSync(full).isDirectory()) walk(full)
      else out.push(relative(dir, full).split(sep).join('/'))
    }
  }
  walk(dir)
  return out.filter((file) => file !== 'source.json')
}

/**
 * Serves `dir` at /content/sample/ in development and emits it into the build
 * (spec §8.6: the demo sample ships inside the app). Files keep their names:
 * the manifest's checksums are over exactly these bytes.
 */
export function samplePack(dir: string): Plugin {
  return {
    name: 'wordado-sample-pack',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0] ?? ''
        if (!path.startsWith(`/${SAMPLE_PREFIX}`)) {
          next()
          return
        }
        const file = path.slice(SAMPLE_PREFIX.length + 1)
        if (!sampleFiles(dir).includes(file)) {
          res.statusCode = 404
          res.end()
          return
        }
        res.setHeader('content-type', contentType(file))
        res.end(readFileSync(join(dir, file)))
      })
    },
    generateBundle() {
      for (const file of sampleFiles(dir)) {
        this.emitFile({ type: 'asset', fileName: `${SAMPLE_PREFIX}${file}`, source: readFileSync(join(dir, file)) })
      }
    },
  }
}
