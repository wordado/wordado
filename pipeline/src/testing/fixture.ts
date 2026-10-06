import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Pack } from '@wordado/core'
import { audioQueueItems, clipsNeeded, generateClips, readAudioRecords } from '../audio'
import { readConfig } from '../config'
import type { PipelineConfig } from '../config'
import { Decisions, QUEUES } from '../decisions'
import { readDraft } from '../draft'
import { writeJson } from '../files'
import { initContent, SAMPLE_DIR } from '../init'
import { fakeLlm } from '../llm'
import { pendingItems } from '../queues'

/**
 * An invented frequency list: made up for the tests, so it needs no clearance.
 * The sample's words are pinned, so the list only has to bring new words:
 * `went` (a form of go), `bank` (three senses, two of which translate alike),
 * `the`, and `london` (a name, dropped).
 */
export const FIXTURE_TSV = 'form\tcount\nthe\t5000\nwent\t900\ngo\t800\nlondon\t400\nbank\t300\n'

const sample = JSON.parse(readFileSync(join(SAMPLE_DIR, 'corpus-v0-bg.pack'), 'utf8')) as Pack

const EXTRA_SENSES: Record<string, unknown[]> = {
  the: [{ pos: 'det', gloss: '', level: 'A1', ipa: 'ðə', variants: [], themes: [], examples: ['The door is open.'] }],
  okay: [{ pos: 'intj', gloss: '', level: 'A1', ipa: 'əʊˈkeɪ', variants: ['OK'], themes: [], examples: ['Okay, see you later.'] }],
  go: [{ pos: 'verb', gloss: '', level: 'A1', ipa: 'ɡəʊ', variants: [], themes: ['travel'], examples: ['We go home at six.'] }],
  bank: [
    { pos: 'noun', gloss: 'money', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['shopping'], examples: ['The bank opens at nine.'] },
    { pos: 'noun', gloss: 'building', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['city'], examples: ['Meet me outside the bank.'] },
    { pos: 'noun', gloss: 'river', level: 'A2', ipa: 'bæŋk', variants: [], themes: ['travel'], examples: ['We sat on the bank of the river.'] },
  ],
}
const EXTRA_BG: Record<string, { translation: string; alternates: string[]; sense: string }> = {
  'the|': { translation: '(определителен член)', alternates: [], sense: '' },
  'okay|': { translation: 'добре', alternates: ['окей'], sense: '' },
  'go|': { translation: 'отивам', alternates: ['ходя'], sense: '' },
  'bank|money': { translation: 'банка', alternates: [], sense: 'за пари' },
  'bank|building': { translation: 'банка', alternates: [], sense: 'сграда' },
  'bank|river': { translation: 'бряг', alternates: [], sense: 'на река' },
}
const EXTRA_DE: Record<string, { translation: string; alternates: string[]; sense: string }> = {
  'the|': { translation: 'der', alternates: ['die', 'das'], sense: '' },
  'okay|': { translation: 'okay', alternates: ['gut'], sense: '' },
  'go|': { translation: 'gehen', alternates: ['fahren'], sense: '' },
  'bank|money': { translation: 'Bank', alternates: [], sense: 'Geldinstitut' },
  'bank|building': { translation: 'Bankgebäude', alternates: [], sense: 'Gebäude' },
  'bank|river': { translation: 'Ufer', alternates: [], sense: 'Flussufer' },
}

/** A fake LLM that answers every stage from the sample pack and the few invented words above. */
export function sampleLlm() {
  return fakeLlm((name, input) => {
    if (name === 'lemmas') {
      const forms = (input as { forms: string[] }).forms
      // `the` comes back with an empty list, as the real stage answered its first batch (level check, 2026-10-06).
      return {
        items: forms.map((form) =>
          form === 'london' ? { form, kind: 'name', lemmas: [] } : { form, kind: 'word', lemmas: form === 'the' ? [] : [form === 'went' ? 'go' : form] },
        ),
      }
    }
    if (name === 'senses') {
      const headwords = (input as { headwords: string[] }).headwords
      return {
        items: headwords.map((lemma) => ({
          lemma,
          senses:
            EXTRA_SENSES[lemma] ??
            sample.entries
              .filter((e) => e.headword === lemma)
              .map((e) => ({ pos: e.pos, gloss: '', level: e.level, ipa: e.ipa, variants: e.variants, themes: e.themes, examples: e.examples })),
        })),
      }
    }
    if (name === 'translate') {
      const { l1, items } = input as { l1: string; items: { key: string; headword: string; gloss: string }[] }
      return {
        items: items.map((item) => {
          if (l1 === 'de') {
            const extra = EXTRA_DE[`${item.headword}|${item.gloss}`]
            return { key: item.key, ...(extra ?? { translation: `DE ${item.headword}`, alternates: [], sense: '' }) }
          }
          const extra = EXTRA_BG[`${item.headword}|${item.gloss}`]
          const e = sample.entries.find((x) => x.headword === item.headword)
          return { key: item.key, ...(extra ?? { translation: e!.translation, alternates: e!.alternates, sense: '' }) }
        }),
      }
    }
    if (name === 'themes') {
      const items = (input as { items: { key: string; headword: string; pos: string }[] }).items
      return { items: items.map((item) => ({ key: item.key, themes: sample.entries.find((e) => e.headword === item.headword && e.pos === item.pos)?.themes ?? [] })) }
    }
    if (name === 'titles') {
      const { units, l1s = ['bg'] } = input as { units: { unit: string }[]; l1s?: string[] }
      return {
        items: units.map((u) => ({
          unit: u.unit,
          en: `Unit ${u.unit}`,
          ...Object.fromEntries(l1s.map((l) => [l, l === 'bg' ? `Урок ${u.unit}` : `Lektion ${u.unit}`])),
        })),
      }
    }
    throw new Error(`the sample LLM does not answer ${name}`)
  })
}

/** A content directory as `corpus init` makes it, with a cleared invented source and small targets. */
export function makeContent(overrides: { config?: Partial<PipelineConfig> } = {}): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'content-')), 'content')
  initContent(dir)
  const config = JSON.parse(readFileSync(join(dir, 'pipeline.json'), 'utf8')) as PipelineConfig
  writeJson(join(dir, 'pipeline.json'), {
    ...config,
    levels: ['A1', 'A2'],
    targets: { A1: 62, A2: 2, B1: 1, B2: 1, C1: 1 },
    max_forms: 100,
    max_lemmas: 100,
    ...overrides.config,
  })
  writeJson(join(dir, 'sources.json'), [
    {
      id: 'invented',
      file: 'invented.tsv',
      title: 'Invented test list',
      url: '',
      licence: 'none (invented for tests)',
      commercial_use: true,
      share_alike: false,
      attribution: '',
      cleared_by: 'test fixture',
      cleared_on: '2026-09-27',
      notes: '',
    },
  ])
  mkdirSync(join(dir, 'sources'), { recursive: true })
  writeFileSync(join(dir, 'sources', 'invented.tsv'), FIXTURE_TSV)
  // The template's starting list would ask the fake LLM about words it does not know; tests add their own.
  writeFileSync(join(dir, 'essentials.txt'), '')
  return dir
}

/** A clip per live entry from a fake voice: bytes that name the clip, 0.5 s long. */
export async function recordAudio(dir: string, batch = 'b1'): Promise<void> {
  const config = readConfig(dir)
  const draft = readDraft(dir)
  const live = new Set(draft.live)
  const needs = clipsNeeded(draft.entries.filter((e) => live.has(e.entry_id)), readAudioRecords(dir), config, Decisions.read(dir))
  await generateClips(dir, needs, {
    tts: { speak: async (text) => new TextEncoder().encode(text) },
    encoder: { toM4a: async (mp3) => ({ bytes: new Uint8Array([...new TextEncoder().encode('m4a:'), ...mp3]), seconds: 0.5 }) },
    config,
    batch,
    now: () => '2026-10-01T10:00:00Z',
  })
}

/** A reviewer who says ok to everything pending, audio included. */
export function approveAll(dir: string): void {
  const config = readConfig(dir)
  const decisions = Decisions.read(dir)
  const at = '2026-10-01T11:00:00Z'
  for (const [queue, items] of pendingItems(readDraft(dir), decisions, config.l1s)) {
    decisions.append(queue, items.map((i) => ({ key: i.key, at, verdict: 'ok' as const, proposed: i.proposed, by: 'fixture' })))
  }
  decisions.append(QUEUES.audio, audioQueueItems(readAudioRecords(dir), decisions).map((i) => ({ key: i.key, at, verdict: 'ok' as const, proposed: i.key, by: 'fixture' })))
}
