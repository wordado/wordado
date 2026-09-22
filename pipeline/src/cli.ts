import { readFileSync } from 'node:fs'
import {
  checkPackSuccession,
  loadCorpus,
  offeredThemes,
  themeEntries,
  validatePack,
  type Pack,
  type PackError,
} from '@wordado/core'
import { BuildError, buildPack, type BuildOutput, type ClipFile } from './build'
import { readSourceDir, writeArtifacts } from './fs'

function fail(errors: readonly PackError[]): never {
  for (const e of errors) console.error(`${e.path || '(pack)'}: ${e.message}`)
  process.exit(1)
}

function usage(): never {
  console.error('usage: corpus build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack>')
  process.exit(2)
}

function readPack(file: string): Pack {
  const result = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (result.status === 'unsupported_schema') {
    fail([{ path: 'schema_version', message: `schema ${result.schemaVersion} is not supported by this build` }])
  }
  if (result.status === 'invalid') fail(result.errors)
  return result.pack
}

function tryBuild(source: unknown, clips: readonly ClipFile[]): BuildOutput {
  try {
    return buildPack(source, clips)
  } catch (err) {
    if (err instanceof BuildError) fail(err.errors)
    throw err
  }
}

function build(dir: string): void {
  const { source, clips } = readSourceDir(dir)
  const out = tryBuild(source, clips)
  writeArtifacts(dir, out)
  const corpus = loadCorpus([out.pack])
  const offered = new Set(offeredThemes(corpus).map((t) => t.themeId))
  console.log(
    `wrote ${out.packFile}: ${out.pack.entries.length} entries, ${out.pack.units.length} units, ${clips.length} clips, ${out.packBytes.byteLength} bytes`,
  )
  for (const t of corpus.themes) {
    const size = themeEntries(corpus, t.themeId).length
    console.log(`  ${t.themeId}: ${size} entries${offered.has(t.themeId) ? '' : ' (below the minimum, not offered)'}`)
  }
}

const [command, first, second] = process.argv.slice(2)
switch (command) {
  case 'build':
    if (!first) usage()
    build(first)
    break
  case 'validate':
    if (!first) usage()
    readPack(first)
    console.log('ok')
    break
  case 'check': {
    if (!first || !second) usage()
    const errors = checkPackSuccession(readPack(first), readPack(second))
    if (errors.length > 0) fail(errors)
    console.log('ok')
    break
  }
  default:
    usage()
}
