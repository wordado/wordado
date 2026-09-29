import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackSuccession, loadCorpus, offeredThemes, themeEntries, validatePack, type Pack, type PackError } from '@wordado/core'
import { audioQueueItems, clipsNeeded, generateClips, readAudioRecords } from './audio'
import { BuildError, buildPack, type BuildOutput, type ClipFile } from './build'
import { claudeCodeLlm } from './claudeCode'
import { COMPARE_STAGES, compareReport, compareStages, type CompareStage } from './compare'
import { readConfig, reviewQueues, type PipelineConfig } from './config'
import { Decisions, QUEUES } from './decisions'
import { readDraft, runDraft } from './draft'
import { ffmpegEncoder } from './encoder'
import { readSourceDir, writeArtifacts } from './fs'
import { initContent } from './init'
import { readLastPublished } from './lastPublished'
import { liveProblems } from './live'
import { openRouterLlm, type Llm } from './llm'
import { countParquet, sumGoogleBooks, writeCounts } from './prepare'
import { publishProblems } from './publishable'
import { reopenReviewed } from './reopen'
import { exportQueues, importQueues, pendingItems, queueSpecs } from './queues'
import { adoptRelease, planRelease, writeRelease } from './release'
import { pgQuery, pullReports, triage } from './reports'
import { openRouterTts } from './tts'

const USAGE = `usage: corpus <command>
  content (a content directory, e.g. an absolute path to your clone of wordado-content):
    init <dir>                     a new content directory, seeded with the sample
    draft <dir> [--offline] [--regroup]
                                   every LLM stage; --offline uses the cache only; --regroup rebuilds unpublished units
    audio <dir> [--batch <id>]     TTS clips for live entries that need one
    queues <dir>                   write pending review items to review/
    import <dir> --by <name>       apply reviewed rows as decisions
    compare <dir> [--sample <n>] [--stage senses|translate|themes]
                                   ask the chosen LLM a sample of the draft's questions; writes work/compare.md
    reopen <dir> <queue> --by <name> (--all | --keys <file>) [--note <text>]
                                   send reviewed items back for a second review
    triage <dir>                   read content reports (REPORTS_DATABASE_URL) and reopen what they cross
    status <dir>                   what stands between the content and a release
    release <dir> <out> [--draft]  build the next corpus version into <out>
    published <dir> <out>          after a publish: <out> becomes last-published/
    live <dir> <manifest-url>      does the CDN serve last-published/?
  frequency lists (run on a workstation; the output goes into the content repository's sources/):
    count-text <out.tsv> <parquet file or URL...>      word forms in Parquet text shards (FineWeb); URLs are streamed, not saved
    sum-gbooks <out.tsv> <gz...> [--from Y] [--to Y]   Google Books 1-grams, years 2000-2019 by default
  the LLM (draft, compare): OpenRouter by default; CORPUS_LLM=claude-code answers on your Claude plan
    through Claude Code (claude -p), for local runs; CORPUS_LLM_MODEL overrides the model, and
    CORPUS_LLM_CONCURRENCY the calls at a time (llm.concurrency).
  packs:
    build <source-dir> | validate <pack-file> | check <previous-pack> <next-pack> | publishable <dir>`

const argv = process.argv.slice(2)
const VALUED = new Set(['--by', '--batch', '--from', '--to', '--keys', '--note', '--sample', '--stage'])
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

/** The LLM for draft and compare: CORPUS_LLM picks OpenRouter (the default, and CI's) or the user's Claude plan. */
function chosenLlm(config: PipelineConfig): Llm {
  const kind = process.env['CORPUS_LLM'] ?? 'openrouter'
  const model = process.env['CORPUS_LLM_MODEL']
  if (kind === 'claude-code') return claudeCodeLlm({ model: model ?? config.llm.model.replace(/^anthropic\//, '') })
  if (kind !== 'openrouter') {
    console.error(`CORPUS_LLM must be openrouter or claude-code, not ${kind}`)
    process.exit(2)
  }
  return openRouterLlm({ apiKey: apiKey(), model: model ?? config.llm.model, maxUsd: config.llm.max_usd_per_run })
}

/** CORPUS_LLM_CONCURRENCY: LLM calls at a time, over pipeline.json's llm.concurrency (try more on a Claude plan). */
function llmConcurrency(): number | undefined {
  const raw = process.env['CORPUS_LLM_CONCURRENCY']
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 32) {
    console.error(`CORPUS_LLM_CONCURRENCY must be a whole number from 1 to 32, not ${raw}`)
    process.exit(2)
  }
  return n
}

const spendNote = (llm: Llm) =>
  llm.model.startsWith('claude-code:') ? `$${llm.spentUsd().toFixed(2)} API-equivalent, on your Claude plan` : `$${llm.spentUsd().toFixed(2)}`

async function draft(dir: string): Promise<void> {
  const config = readConfig(dir)
  const offline = flag('--offline')
  const llm = offline ? offlineLlm : chosenLlm(config)
  const d = await runDraft({ dir, llm, offline, regroup: flag('--regroup'), concurrency: llmConcurrency() })
  const live = new Set(d.live)
  const perLevel = config.levels.map((level) => `${level} ${d.entries.filter((e) => live.has(e.entry_id) && e.level === level).length}`).join(', ')
  const units = d.units.filter((u) => u.entry_ids.some((id) => live.has(id))).length
  console.log(`draft: ${d.live.length} live entries (${perLevel}) in ${units} units; LLM spend this run ${spendNote(llm)}`)
  for (const p of d.problems) console.error(p)
}

async function compare(dir: string): Promise<void> {
  const config = readConfig(dir)
  const stage = option('--stage')
  if (stage !== undefined && !(COMPARE_STAGES as readonly string[]).includes(stage)) usage()
  const sample = Number(option('--sample') ?? 20)
  if (!Number.isInteger(sample) || sample < 1) usage()
  const llm = chosenLlm(config)
  const rows = await compareStages(dir, llm, { sample, stages: stage ? [stage as CompareStage] : COMPARE_STAGES, concurrency: llmConcurrency() })
  const file = join(dir, 'work', 'compare.md')
  writeFileSync(file, compareReport(rows, llm.model, now()))
  for (const s of new Set(rows.map((r) => r.stage))) {
    const rs = rows.filter((r) => r.stage === s)
    console.log(`${s}: ${rs.filter((r) => r.same).length} of ${rs.length} the same`)
  }
  console.log(`wrote ${file}; LLM spend ${spendNote(llm)}`)
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

function reopen(dir: string, queue: string): void {
  const config = readConfig(dir)
  const queues = reviewQueues(config.l1s)
  if (!queues.includes(queue)) {
    console.error(`${queue} is not a review queue; one of ${queues.join(', ')}`)
    process.exit(2)
  }
  const by = option('--by')
  const file = option('--keys')
  if (!by || flag('--all') === (file !== undefined)) usage()
  const keys = file === undefined ? 'all' : readFileSync(file, 'utf8').split('\n').map((l) => l.replace(/#.*/, '').trim()).filter((l) => l !== '')
  const out = reopenReviewed(Decisions.read(dir), queue, { keys, by, note: option('--note') ?? 'second review', now: now() })
  console.log(`${out.reopened.length} ${queue} items reopened; ${out.skipped.length} skipped. Next: corpus queues`)
  for (const s of out.skipped) console.log(`  ${s}`)
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
  if (plan.unreviewed.length > 0) {
    console.log(`ships unreviewed (accept_unreviewed): ${plan.unreviewed.length} items`)
    for (const s of summarise(plan.unreviewed.map((u) => u.line))) console.log(s)
  }
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
  const unreviewed = Object.entries(plan.releaseInfo.unreviewed ?? {})
  if (unreviewed.length > 0) console.log(`shipped unreviewed: ${unreviewed.map(([q, n]) => `${n} ${q}`).join(', ')}`)
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
    case 'compare':
      await compare(arg(first))
      break
    case 'reopen':
      reopen(arg(first), arg(second))
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
    case 'count-text': {
      const [out, ...files] = positional.slice(1)
      if (!out || files.length === 0) usage()
      const counts = await countParquet(files, (file, texts) => console.error(`  ${file}: ${texts.toLocaleString('en')} texts`))
      const tokens = [...counts.values()].reduce((a, b) => a + b, 0)
      const written = writeCounts(out, counts, { comment: `corpus count-text over ${files.length} Parquet shards, ${tokens} tokens, ${now()}` })
      console.log(`wrote ${out}: ${written} forms, ${tokens.toLocaleString('en')} tokens`)
      break
    }
    case 'sum-gbooks': {
      const [out, ...files] = positional.slice(1)
      if (!out || files.length === 0) usage()
      const from = Number(option('--from') ?? 2000)
      const to = Number(option('--to') ?? 2019)
      if (!Number.isInteger(from) || !Number.isInteger(to) || from > to) usage()
      const counts = await sumGoogleBooks(files, from, to)
      const written = writeCounts(out, counts, { comment: `corpus sum-gbooks, Google Books Ngram v3 1-grams, ${from}-${to}, ${now()}` })
      console.log(`wrote ${out}: ${written} forms`)
      break
    }
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
