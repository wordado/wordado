import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackSuccession, loadCorpus, offeredThemes, themeEntries, validatePack, type Pack, type PackError } from '@wordado/core'
import { audioQueueItems, clipsNeeded, generateClips, readAudioRecords } from './audio'
import { BuildError, buildPack, type BuildOutput, type ClipFile } from './build'
import { readConfig } from './config'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { ffmpegEncoder } from './encoder'
import { readSourceDir, writeArtifacts } from './fs'
import { initContent } from './init'
import { readLastPublished } from './lastPublished'
import { liveProblems } from './live'
import { openRouterLlm, type Llm } from './llm'
import { publishProblems } from './publishable'
import { exportQueues, importQueues, pendingItems, queueSpecs } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { pgQuery, pullReports, triage } from './reports'
import { openRouterTts } from './tts'

const USAGE = `usage: corpus <command>
  content (a content directory, e.g. an absolute path to your clone of wordado-content):
    init <dir>                     a new content directory, seeded with the sample
    draft <dir> [--offline]        every LLM stage; --offline uses the cache only
    audio <dir> [--batch <id>]     TTS clips for live entries that need one
    queues <dir>                   write pending review items to review/
    import <dir> --by <name>       apply reviewed rows as decisions
    triage <dir>                   read content reports (REPORTS_DATABASE_URL) and reopen what they cross
    status <dir>                   what stands between the content and a release
    release <dir> <out> [--draft]  build the next corpus version into <out>
    published <dir> <out>          after a publish: <out> becomes last-published/
    live <dir> <manifest-url>      does the CDN serve last-published/?
  packs:
    build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack> | publishable <dir>`

const argv = process.argv.slice(2)
const VALUED = new Set(['--by', '--batch'])
const option = (name: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : undefined
}
const flag = (name: string) => argv.includes(name)
const positional = argv.filter((a, i) => !a.startsWith('--') && !VALUED.has(argv[i - 1] ?? ''))
const now = () => new Date().toISOString()

function usage(): never {
  console.error(USAGE)
  process.exit(2)
}

function fail(errors: readonly PackError[]): never {
  for (const e of errors) console.error(`${e.path || '(pack)'}: ${e.message}`)
  process.exit(1)
}

function arg(value: string | undefined): string {
  if (!value) usage()
  return value
}

function apiKey(): string {
  const key = process.env['OPENROUTER_API_KEY']
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set (the LLM and TTS go through OpenRouter)')
    process.exit(2)
  }
  return key
}

/** For --offline: any call means an item was not cached, which runDraft reports first. */
const offlineLlm: Llm = {
  model: 'offline',
  spentUsd: () => 0,
  json: () => Promise.reject(new Error('offline')),
}

function readPack(file: string): Pack {
  const result = validatePack(JSON.parse(readFileSync(file, 'utf8')))
  if (result.status === 'unsupported_schema') fail([{ path: 'schema_version', message: `schema ${result.schemaVersion} is not supported by this build` }])
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
  console.log(`wrote ${out.packFile}: ${out.pack.entries.length} entries, ${out.pack.units.length} units, ${clips.length} clips, ${out.packBytes.byteLength} bytes`)
  for (const t of corpus.themes) {
    const size = themeEntries(corpus, t.themeId).length
    console.log(`  ${t.themeId}: ${size} entries${offered.has(t.themeId) ? '' : ' (below the minimum, not offered)'}`)
  }
}

async function draft(dir: string): Promise<void> {
  const config = readConfig(dir)
  const offline = flag('--offline')
  const llm = offline ? offlineLlm : openRouterLlm({ apiKey: apiKey(), model: config.llm.model, maxUsd: config.llm.max_usd_per_run })
  const d = await runDraft({ dir, llm, offline })
  const live = new Set(d.live)
  const perLevel = config.levels.map((level) => `${level} ${d.entries.filter((e) => live.has(e.entry_id) && e.level === level).length}`).join(', ')
  const units = d.units.filter((u) => u.entry_ids.some((id) => live.has(id))).length
  console.log(`draft: ${d.live.length} live entries (${perLevel}) in ${units} units; LLM spend this run $${llm.spentUsd().toFixed(2)}`)
  for (const p of d.problems) console.error(p)
}

async function audio(dir: string): Promise<void> {
  const config = readConfig(dir)
  const d = readDraft(dir)
  const live = new Set(d.live)
  const needs = clipsNeeded(d.entries.filter((e) => live.has(e.entry_id)), readAudioRecords(dir), config, Decisions.read(dir))
  const batch = option('--batch') ?? now().slice(0, 16).replace(/[-:]/g, '')
  const out = await generateClips(dir, needs, { tts: openRouterTts({ apiKey: apiKey(), model: config.tts.model }), encoder: ffmpegEncoder(), config, batch, now })
  console.log(`audio batch ${batch}: ${out.made.length} clips made, ${out.failed.length} failed, ${out.skipped} left for the next run`)
  for (const f of out.failed) console.error(f)
}

function queues(dir: string): void {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const items = pendingItems(readDraft(dir), decisions, config.l1s)
  items.set(QUEUES.audio, audioQueueItems(readAudioRecords(dir), decisions))
  const files = exportQueues(dir, items, queueSpecs(config.l1s), { stamp: now().slice(0, 10) })
  console.log(files.length > 0 ? files.join('\n') : 'no new review items')
}

function importReviewed(dir: string): void {
  const by = option('--by')
  if (!by) usage()
  const out = importQueues(dir, queueSpecs(readConfig(dir).l1s), { by, now: now() })
  console.log(`${out.applied} decisions applied; ${out.pending} rows still open`)
  for (const e of out.errors) console.error(e)
  if (out.errors.length > 0) process.exit(1)
}

async function triageReports(dir: string): Promise<void> {
  const url = process.env['REPORTS_DATABASE_URL']
  if (!url) {
    console.error('REPORTS_DATABASE_URL is not set (a read-only role on content_report; see pipeline/README.md)')
    process.exit(2)
  }
  const config = readConfig(dir)
  const db = await pgQuery(url)
  let reports
  try {
    reports = await pullReports(db.query)
  } finally {
    await db.close()
  }
  const decisions = Decisions.read(dir)
  const out = triage({
    reports,
    decisions,
    records: readAudioRecords(dir),
    fixes: readLastPublished(dir).fixes.fixes,
    live: new Set(readDraft(dir).live),
    l1s: config.l1s,
    threshold: config.report_threshold,
    now: now(),
  })
  for (const { queue, event } of out.events) decisions.append(queue, [event])
  console.log(`${reports.length} reports read; ${out.events.length} items sent back`)
  for (const s of out.summary) console.log(`  ${s}`)
}

/** "hello-1: english not reviewed" and 63 like it print as one line with a count. */
function summarise(lines: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const l of lines) {
    const kind = l.replace(/^[^:]+: /, '')
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return [...counts].map(([kind, n]) => `  ${n} × ${kind}`)
}

function status(dir: string): void {
  const plan = planRelease(dir, { draft: false, now: now() })
  console.log(`corpus v${plan.corpusVersion}: ${plan.problems.length} problems, ${plan.pending.length} items awaiting review`)
  for (const p of plan.problems) console.log(`  ${p}`)
  for (const s of summarise(plan.pending)) console.log(s)
  if (plan.retired.length > 0) console.log(`  retires: ${plan.retired.join(', ')}`)
}

function release(dir: string, outDir: string): void {
  const plan = planRelease(dir, { draft: flag('--draft'), now: now() })
  if (plan.problems.length > 0 || (!flag('--draft') && plan.pending.length > 0)) {
    for (const p of plan.problems) console.error(p)
    for (const s of summarise(plan.pending)) console.error(s)
    process.exit(1)
  }
  const files = writeRelease(dir, outDir, plan)
  console.log(`wrote corpus v${plan.corpusVersion}${flag('--draft') ? ' (draft)' : ''} to ${outDir}: ${plan.outputs.length} packs, ${plan.clipIds.length} clips, ${files.length} files`)
  if (plan.retired.length > 0) console.log(`retired: ${plan.retired.join(', ')}`)
}

async function live(dir: string, url: string): Promise<void> {
  const problems = await liveProblems(dir, url)
  for (const p of problems) console.error(p)
  if (problems.length > 0) process.exit(1)
  console.log('ok')
}

async function main(): Promise<void> {
  const [command, first, second] = positional
  switch (command) {
    case 'init':
      initContent(arg(first))
      console.log(`initialised ${first}; next: fill in sources.json once the legal review clears a source`)
      break
    case 'draft':
      await draft(arg(first))
      break
    case 'audio':
      await audio(arg(first))
      break
    case 'queues':
      queues(arg(first))
      break
    case 'import':
      importReviewed(arg(first))
      break
    case 'triage':
      await triageReports(arg(first))
      break
    case 'status':
      status(arg(first))
      break
    case 'release':
      release(arg(first), arg(second))
      break
    case 'published':
      adoptRelease(arg(first), arg(second))
      console.log(`last-published/ is now ${second}`)
      break
    case 'live':
      await live(arg(first), arg(second))
      break
    case 'build':
      build(arg(first))
      break
    case 'validate':
      readPack(arg(first))
      console.log('ok')
      break
    case 'check': {
      const errors = checkPackSuccession(readPack(arg(first)), readPack(arg(second)))
      if (errors.length > 0) fail(errors)
      console.log('ok')
      break
    }
    case 'publishable': {
      const dir = arg(first)
      const problems = publishProblems((path) => {
        const full = join(dir, path)
        return existsSync(full) ? new Uint8Array(readFileSync(full)) : null
      })
      for (const problem of problems) console.error(problem)
      if (problems.length > 0) process.exit(1)
      console.log('ok')
      break
    }
    default:
      usage()
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
