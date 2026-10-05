import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { checkPackSuccession, MANIFEST_SCHEMA_VERSION, type PackManifest, type CreditsFile } from '@wordado/core'
import { aiGate } from './aiReview/gate'
import { AiReviewStore } from './aiReview/store'
import { assemble, type Unreviewed } from './assemble'
import { audioGate, readAudioRecords } from './audio'
import { AUDIO_EXT, BuildError, buildPack, type BuildOutput } from './build'
import { readConfig, readThemes } from './config'
import { contentPaths } from './content'
import { creditsFile } from './credits'
import { Decisions, QUEUES } from './decisions'
import { readDraft } from './draft'
import { writeJson } from './files'
import { diffFixes, nextFixesFile } from './fixes'
import { readLastPublished, type Fix, type FixesFile } from './lastPublished'
import { pendingItems } from './queues'
import { readClearedSources } from './sources'

export interface ReleaseInfo {
  readonly corpus_version: number
  readonly draft: boolean
  readonly built_at: string
  readonly l1s: readonly string[]
  /** Attributions the cleared sources require; the app's about page shows them (handover). */
  readonly attributions: readonly { readonly source: string; readonly attribution: string }[]
  /** Items shipped as proposed, per review queue, because `accept_unreviewed` named the queue. Absent when none. */
  readonly unreviewed?: Readonly<Record<string, number>>
}

export interface ReleasePlan {
  readonly corpusVersion: number
  readonly outputs: readonly BuildOutput[]
  readonly clipIds: readonly string[]
  readonly manifest: PackManifest
  readonly fixes: FixesFile
  readonly credits: CreditsFile
  readonly releaseInfo: ReleaseInfo
  readonly problems: readonly string[]
  readonly pending: readonly string[]
  /** Open review items that ship anyway (`accept_unreviewed`); they block nothing. */
  readonly unreviewed: readonly Unreviewed[]
  readonly retired: readonly string[]
}

/** Everything a release would write, and what stands in its way. Writes nothing. */
export function planRelease(dir: string, opts: { draft: boolean; now: string }): ReleasePlan {
  const paths = contentPaths(dir)
  const config = readConfig(dir)
  const sources = readClearedSources(dir)
  const themes = readThemes(dir, config.l1s)
  const draft = readDraft(dir)
  const decisions = Decisions.read(dir)
  const records = readAudioRecords(dir)
  const last = readLastPublished(dir)
  const corpusVersion = last.manifest.corpus_version + 1
  const problems: string[] = [...draft.problems]
  const pending: string[] = []
  const unreviewed: Unreviewed[] = []
  const accepted = new Set(config.accept_unreviewed ?? [])
  for (const l1 of last.packs.keys()) if (!config.l1s.includes(l1)) problems.push(`${l1}: published before, so it must stay in pipeline.json's l1s`)
  const lead = config.l1s[0]
  if (last.packs.size > 0 && lead !== undefined && !last.packs.has(lead)) {
    problems.push("the lead L1 (the first in pipeline.json's l1s) must be one published before: senses merge on it; append a new L1 instead")
  }

  const hasClip = (id: string) => existsSync(paths.clip(id))
  const outputs: BuildOutput[] = []
  const clipIds = new Set<string>()
  const fixes: Fix[] = []
  const seenFix = new Set<string>()
  const retired = new Set<string>()
  const liveList = draft.entries.filter((e) => draft.live.includes(e.entry_id))
  const audio = audioGate(liveList, records, config, decisions)
  pending.push(...audio.missing)
  if (accepted.has(QUEUES.audio)) unreviewed.push(...audio.unheard.map((line) => ({ queue: QUEUES.audio, line })))
  else pending.push(...audio.unheard)
  // AI review gates every release (spec §5.4), whether or not its queue is in accept_unreviewed.
  pending.push(...aiGate(config.ai_review, pendingItems(draft, decisions, config.l1s), AiReviewStore.read(dir)))

  for (const l1 of config.l1s) {
    const previous = last.packs.get(l1) ?? null
    const previousLeadUnits = (lead !== undefined ? last.packs.get(lead)?.units : undefined) ?? []
    const a = assemble({ l1, corpusVersion, draft, decisions, themes, records, config, previous, previousLeadUnits, hasClip })
    problems.push(...a.problems.map((p) => `${l1}: ${p}`))
    pending.push(...a.pending.filter((p) => !pending.includes(p)))
    unreviewed.push(...a.unreviewed.filter((u) => !unreviewed.some((v) => v.line === u.line)))
    let out: BuildOutput
    try {
      out = buildPack(a.source, a.clipIds.map((clipId) => ({ clipId, bytes: new Uint8Array(readFileSync(paths.clip(clipId))) })))
    } catch (err) {
      if (!(err instanceof BuildError)) throw err
      problems.push(...err.errors.map((e) => `${l1}: ${e.path || '(pack)'}: ${e.message}`))
      continue
    }
    if (previous) problems.push(...checkPackSuccession(previous, out.pack).map((e) => `${l1}: ${e.path}: ${e.message}`))
    for (const e of out.pack.entries) if (e.retired && last.live.has(e.entry_id)) retired.add(e.entry_id)
    for (const f of diffFixes(previous, out.pack)) {
      const key = `${f.word_id}|${f.field}|${f.l1 ?? ''}`
      if (!seenFix.has(key)) {
        seenFix.add(key)
        fixes.push(f)
      }
    }
    for (const id of a.clipIds) clipIds.add(id)
    outputs.push(out)
  }

  const manifest: PackManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    corpus_version: corpusVersion,
    packs: outputs.flatMap((o) => o.manifest.packs).sort((a, b) => (a.l1 < b.l1 ? -1 : 1)),
  }
  const counts: Record<string, number> = {}
  for (const u of unreviewed) counts[u.queue] = (counts[u.queue] ?? 0) + 1
  const credits = creditsFile(sources, corpusVersion)
  const releaseInfo: ReleaseInfo = {
    corpus_version: corpusVersion,
    draft: opts.draft,
    built_at: opts.now,
    l1s: config.l1s,
    attributions: credits.sources,
    ...(unreviewed.length > 0 ? { unreviewed: counts } : {}),
  }
  return {
    corpusVersion,
    outputs,
    clipIds: [...clipIds].sort(),
    manifest,
    fixes: nextFixesFile(last.fixes, fixes, corpusVersion),
    credits,
    releaseInfo,
    problems,
    pending,
    unreviewed,
    retired: [...retired].sort(),
  }
}

/** The CDN directory (plan 7's layout): manifest.json, the packs, audio/, fixes.json and release.json. */
export function writeRelease(dir: string, outDir: string, plan: ReleasePlan): string[] {
  if (plan.problems.length > 0) throw new Error(`the release has ${plan.problems.length} problems:\n${plan.problems.join('\n')}`)
  if (!plan.releaseInfo.draft && plan.pending.length > 0) throw new Error(`the release awaits review (${plan.pending.length} items); release with --draft to build anyway`)
  if (existsSync(outDir) && readdirSync(outDir).length > 0) throw new Error(`${outDir} is not empty`)
  const paths = contentPaths(dir)
  mkdirSync(join(outDir, 'audio'), { recursive: true })
  const files: string[] = []
  for (const o of plan.outputs) {
    writeFileSync(join(outDir, o.packFile), o.packBytes)
    files.push(o.packFile)
  }
  for (const id of plan.clipIds) {
    cpSync(paths.clip(id), join(outDir, 'audio', `${id}.${AUDIO_EXT}`))
    files.push(`audio/${id}.${AUDIO_EXT}`)
  }
  writeJson(join(outDir, 'fixes.json'), plan.fixes)
  writeJson(join(outDir, 'credits.json'), plan.credits)
  writeJson(join(outDir, 'release.json'), plan.releaseInfo)
  writeJson(join(outDir, 'manifest.json'), plan.manifest)
  return [...files, 'fixes.json', 'credits.json', 'release.json', 'manifest.json']
}

/** After a publish: the release becomes last-published/, the predecessor of the next (Decision 14). Audio stays in audio/. */
export function adoptRelease(dir: string, outDir: string): void {
  const target = contentPaths(dir).lastPublished
  const info = JSON.parse(readFileSync(join(outDir, 'release.json'), 'utf8')) as ReleaseInfo
  if (info.draft) throw new Error('a draft release is never adopted')
  const current = readLastPublished(dir).manifest.corpus_version
  if (info.corpus_version !== current + 1) {
    throw new Error(`${outDir} is corpus version ${info.corpus_version}, but last-published/ is at ${current}; it can only adopt version ${current + 1}`)
  }
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.pack') || f === 'manifest.json' || f === 'fixes.json') cpSync(join(outDir, f), join(target, f))
  }
}
