import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { norm } from '@wordado/core'
import { StageCache } from './cache'
import { readConfig, readThemes } from './config'
import { readDraft, type DraftEntry } from './draft'
import type { Llm } from './llm'
import type { StageRun } from './stages/lemmas'
import { describeLemmas, SENSES_THEME_IDS } from './stages/senses'
import { themeSenses } from './stages/themes'
import { translateSenses, type TranslationFields } from './stages/translate'

export const COMPARE_STAGES = ['senses', 'translate', 'themes'] as const
export type CompareStage = (typeof COMPARE_STAGES)[number]

export interface CompareRow {
  readonly stage: string
  readonly key: string
  /** What the draft holds now, from the content caches. */
  readonly cached: string
  /** What the model under test answers. */
  readonly fresh: string
  readonly same: boolean
}

/** `count` live entries spread evenly over the draft, so every level is in the sample. */
export function sampleEntries(entries: readonly DraftEntry[], count: number): DraftEntry[] {
  if (entries.length <= count) return [...entries]
  const step = entries.length / count
  return Array.from({ length: count }, (_, i) => entries[Math.floor(i * step)]!)
}

const translationText = (t: TranslationFields) => [t.translation, ...t.alternates].join(' | ') + (t.sense ? ` (${t.sense})` : '')

/**
 * Asks `llm` the draft's questions for a sample of live entries, in a throwaway cache, beside what the content
 * caches hold: a way to judge another model or provider before it answers for real. Needs `corpus draft` first.
 * Levels differ by design: the cached one is after banding, the fresh one is the model's own.
 */
export async function compareStages(dir: string, llm: Llm, opts: { readonly sample: number; readonly stages: readonly CompareStage[] }): Promise<CompareRow[]> {
  const config = readConfig(dir)
  const draft = readDraft(dir)
  const live = new Set(draft.live)
  const picked = sampleEntries(draft.entries.filter((e) => live.has(e.entry_id)), opts.sample)
  const scratch = mkdtempSync(join(tmpdir(), 'corpus-compare-'))
  const run = (stage: string): StageRun => ({ llm, cache: StageCache.open(join(scratch, `${stage}.jsonl`)), concurrency: config.llm.concurrency, offline: false })
  const items = picked.map((e) => ({ headword: e.headword, pos: e.pos, gloss: e.sense_en, example: e.english.examples[0] ?? '' }))
  const rows: CompareRow[] = []
  const push = (stage: string, key: string, cached: string, fresh: string) => rows.push({ stage, key, cached, fresh, same: cached === fresh })

  if (opts.stages.includes('senses')) {
    const lemmas = [...new Set(picked.map((e) => norm(e.headword)))]
    const fresh = await describeLemmas(lemmas.map((lemma, i) => ({ lemma, perMillion: 0, rank: i + 1, pinned: false })), SENSES_THEME_IDS, run('senses'))
    lemmas.forEach((lemma, i) => {
      const cached = draft.entries.filter((e) => norm(e.headword) === lemma).map((e) => `${e.pos} ${e.sense_en || '–'} ${e.level} /${e.english.ipa}/`)
      const answered = fresh[i]!.map((s) => `${s.pos} ${s.gloss || '–'} ${s.level} /${s.ipa}/`)
      push('senses', lemma, cached.join('; '), answered.join('; '))
    })
  }
  if (opts.stages.includes('translate')) {
    for (const l1 of config.l1s) {
      const fresh = await translateSenses(l1, items, run(`translate-${l1}`))
      picked.forEach((e, i) => push(`translate-${l1}`, e.entry_id, translationText(e.l1[l1]!), translationText(fresh[i]!)))
    }
  }
  if (opts.stages.includes('themes')) {
    const fresh = await themeSenses(items, readThemes(dir, config.l1s), run('themes'))
    picked.forEach((e, i) => push('themes', e.entry_id, e.themes.join(', '), fresh[i]!.join(', ')))
  }
  return rows
}

const cell = (s: string) => s.replaceAll('|', '\\|') || '–'

/** A Markdown report: a summary per stage, then every row, differences first. */
export function compareReport(rows: readonly CompareRow[], model: string, now: string): string {
  const stages = [...new Set(rows.map((r) => r.stage))]
  const lines = [
    `# corpus compare: ${model}`,
    '',
    `${now}. Cached answers are what the draft holds now. Cached senses are only those the draft kept (in the shipped`,
    'levels, after banding); the fresh ones are every sense the model proposes, at its own level. Even the same model',
    'rewords glosses and reorders alternates when asked again, so read the differences, not the count.',
    '',
  ]
  for (const stage of stages) {
    const rs = rows.filter((r) => r.stage === stage)
    lines.push(`- **${stage}**: ${rs.filter((r) => r.same).length} of ${rs.length} the same`)
  }
  for (const stage of stages) {
    lines.push('', `## ${stage}`, '', '| key | cached | fresh |', '|---|---|---|')
    for (const r of rows.filter((r) => r.stage === stage).sort((a, b) => Number(a.same) - Number(b.same))) {
      lines.push(`| ${r.same ? '' : '≠ '}${r.key} | ${cell(r.cached)} | ${cell(r.fresh)} |`)
    }
  }
  return lines.join('\n') + '\n'
}
