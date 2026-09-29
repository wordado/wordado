import { norm, type CefrLevel, type Pack, type PartOfSpeech } from '@wordado/core'

/** An entry ID and the English sense it stands for (spec §5.2's identity). Never removed (spec §5.1). */
export interface RegistryEntry {
  readonly entry_id: string
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
  /** A sample entry: must stay live (plan 7's contract, Decision 9). */
  readonly pinned: boolean
}

export interface RegistryUnit {
  readonly unit_id: string
  readonly level: CefrLevel
  readonly entry_ids: readonly string[]
  /** A unit of words that share no theme: `pos:<tag>` or `mixed`. Such a unit gets a plain title (`groupTitles`). */
  readonly group?: string
}

export interface Registry {
  readonly entries: readonly RegistryEntry[]
  readonly units: readonly RegistryUnit[]
}

export interface SenseKey {
  readonly headword: string
  readonly pos: PartOfSpeech
  readonly sense_en: string
}

/** The sample's ID style: `thank_you`, `oclock`, `cafe` (Decision 10). */
export function slugOf(headword: string): string {
  const slug = norm(headword)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
  return slug === '' ? 'w' : slug
}

const identity = (k: SenseKey) => `${norm(k.headword)}|${k.pos}|${norm(k.sense_en)}`
const headPos = (k: { headword: string; pos: string }) => `${norm(k.headword)}|${k.pos}`

/**
 * An ID for each sense (Decision 10). An exact (headword, POS, gloss) match
 * keeps its ID. Failing that, an unlabelled entry (a sample entry, seeded with
 * no gloss) takes the first unmatched sense of its headword and POS, because
 * the senses stage lists the most common sense first, and that is the sense
 * the sample taught. A labelled entry with one sense on each side keeps its
 * ID too, because the gloss of a lone sense is only a label. Either way the
 * new gloss is recorded. Anything else gets the next number for its slug.
 */
export function assignIds(registry: Registry, keys: readonly SenseKey[]): { registry: Registry; ids: string[] } {
  const seen = new Set<string>()
  for (const k of keys) {
    if (seen.has(identity(k))) throw new Error(`${k.headword} (${k.pos}, "${k.sense_en}") appears twice`)
    seen.add(identity(k))
  }
  const entries = [...registry.entries]
  const byIdentity = new Map(entries.map((e, i) => [identity(e), i]))
  const ids: (string | null)[] = keys.map((k) => {
    const i = byIdentity.get(identity(k))
    return i === undefined ? null : entries[i]!.entry_id
  })
  const used = new Set(ids.filter((id): id is string => id !== null))

  const keysByHead = new Map<string, number[]>()
  keys.forEach((k, i) => keysByHead.set(headPos(k), [...(keysByHead.get(headPos(k)) ?? []), i]))
  const entriesByHead = new Map<string, number[]>()
  entries.forEach((e, i) => entriesByHead.set(headPos(e), [...(entriesByHead.get(headPos(e)) ?? []), i]))
  const bind = (k: number, e: number) => {
    ids[k] = entries[e]!.entry_id
    used.add(entries[e]!.entry_id)
    entries[e] = { ...entries[e]!, sense_en: keys[k]!.sense_en }
  }
  for (const [head, ks] of keysByHead) {
    for (const e of entriesByHead.get(head) ?? []) {
      if (entries[e]!.sense_en !== '' || used.has(entries[e]!.entry_id)) continue
      const k = ks.find((k) => ids[k] === null)
      if (k !== undefined) bind(k, e)
    }
  }
  for (const [head, ks] of keysByHead) {
    const es = entriesByHead.get(head) ?? []
    if (ks.length !== 1 || es.length !== 1) continue
    const k = ks[0]!
    const e = es[0]!
    if (ids[k] !== null || used.has(entries[e]!.entry_id)) continue
    bind(k, e)
  }

  const highest = new Map<string, number>()
  for (const e of entries) {
    const m = /^(.*)-(\d+)$/.exec(e.entry_id)
    if (m) highest.set(m[1]!, Math.max(highest.get(m[1]!) ?? 0, Number(m[2])))
  }
  const out = ids.map((id, i) => {
    if (id !== null) return id
    const k = keys[i]!
    const slug = slugOf(k.headword)
    const n = (highest.get(slug) ?? 0) + 1
    highest.set(slug, n)
    const entryId = `${slug}-${n}`
    entries.push({ entry_id: entryId, headword: norm(k.headword), pos: k.pos, sense_en: k.sense_en, pinned: false })
    return entryId
  })
  return { registry: { entries, units: registry.units }, ids: out }
}

/** The registry a new content repository starts from: the sample's IDs, pinned, and its units (Decision 9). */
export function registryFromSample(pack: Pack): Registry {
  return {
    entries: pack.entries.map((e) => ({ entry_id: e.entry_id, headword: e.headword, pos: e.pos, sense_en: '', pinned: true })),
    units: pack.units.map((u) => ({ unit_id: u.unit_id, level: u.level, entry_ids: [...u.entry_ids] })),
  }
}
