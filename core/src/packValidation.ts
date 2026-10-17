import {
  PACK_SCHEMA_VERSION, type Pack,
  type PackAudioClip,
  type PackCourseSize,
  type PackEntry,
  type PackProbe,
  type PackTheme,
  type PackTrial,
  type PackUnit,
} from './pack'
import { CEFR_LEVELS, PARTS_OF_SPEECH, levelIndex, type Accent, type CefrLevel } from './types'
import {
  at,
  bool,
  checkUnique,
  id,
  integer,
  isRecord,
  LANG,
  localized,
  norm,
  oneOf,
  records,
  relativeUrl,
  Report,
  sha256,
  text,
  texts,
  type PackError,
  type Raw,
} from './validation'
import { isWordId } from './wordId'

export type { PackError } from './validation'

export type PackValidation =
  | { readonly status: 'ok'; readonly pack: Pack }
  /** A schema this build cannot read: keep the current pack and ask the learner to update the app (spec §5.1). */
  | { readonly status: 'unsupported_schema'; readonly schemaVersion: number }
  | { readonly status: 'invalid'; readonly errors: readonly PackError[] }

export interface ValidatePackOptions {
  /** Defaults to `[PACK_SCHEMA_VERSION]`. */
  readonly supportedSchemaVersions?: readonly number[]
}

function parseEntry(r: Report, raw: Raw, path: string): PackEntry {
  const entryId = text(r, raw, 'entry_id', path)
  if (entryId !== '' && !isWordId(`c:${entryId}`)) r.add(at(path, 'entry_id'), 'must be a valid word_id key')
  const retired = bool(r, raw, 'retired', path)
  // Absent means taught; read only when present, so the entry keeps the shape it was shipped in.
  const taught = raw['taught'] === undefined ? undefined : bool(r, raw, 'taught', path)
  const examples = texts(r, raw, 'examples', path)
  if (!retired && examples.length === 0) r.add(at(path, 'examples'), 'a live entry needs at least one example sentence')
  const audio: Partial<Record<Accent, string>> = {}
  const rawAudio = raw['audio']
  if (!isRecord(rawAudio)) r.add(at(path, 'audio'), 'must be an object of clip ids by accent')
  else {
    for (const [accent, clip] of Object.entries(rawAudio)) {
      if ((accent !== 'uk' && accent !== 'us') || typeof clip !== 'string' || clip === '') {
        r.add(`${at(path, 'audio')}.${accent}`, 'must be a clip id under "uk" or "us"')
      } else audio[accent] = clip
    }
  }
  return {
    entry_id: entryId,
    headword: text(r, raw, 'headword', path),
    variants: texts(r, raw, 'variants', path),
    pos: oneOf(r, raw, 'pos', path, PARTS_OF_SPEECH),
    sense: text(r, raw, 'sense', path, false),
    ipa: text(r, raw, 'ipa', path, !retired),
    level: oneOf(r, raw, 'level', path, CEFR_LEVELS),
    unit_id: id(r, raw, 'unit_id', path),
    themes: texts(r, raw, 'themes', path),
    translation: text(r, raw, 'translation', path),
    alternates: texts(r, raw, 'alternates', path),
    examples,
    audio,
    retired,
    ...(taught === undefined ? {} : { taught }),
  }
}

function parseUnit(r: Report, raw: Raw, path: string): PackUnit {
  return {
    unit_id: id(r, raw, 'unit_id', path),
    level: oneOf(r, raw, 'level', path, CEFR_LEVELS),
    order: integer(r, raw, 'order', path, 1),
    title: localized(r, raw, 'title', path),
    entry_ids: texts(r, raw, 'entry_ids', path),
  }
}

function parseTheme(r: Report, raw: Raw, path: string): PackTheme {
  return {
    theme_id: id(r, raw, 'theme_id', path),
    name: localized(r, raw, 'name', path),
    description: localized(r, raw, 'description', path),
  }
}

function parseClip(r: Report, raw: Raw, path: string): PackAudioClip {
  return {
    clip_id: id(r, raw, 'clip_id', path),
    url: relativeUrl(r, raw, 'url', path),
    sha256: sha256(r, raw, 'sha256', path),
    bytes: integer(r, raw, 'bytes', path, 1),
    mime: text(r, raw, 'mime', path),
  }
}

function parseProbe(r: Report, raw: Raw, path: string): PackProbe {
  const entryId = text(r, raw, 'entry_id', path)
  if (entryId !== '' && !isWordId(`c:${entryId}`)) r.add(at(path, 'entry_id'), 'must be a valid word_id key')
  return {
    entry_id: entryId,
    headword: text(r, raw, 'headword', path),
    pos: oneOf(r, raw, 'pos', path, PARTS_OF_SPEECH),
    sense: text(r, raw, 'sense', path, false),
    level: oneOf(r, raw, 'level', path, CEFR_LEVELS),
    translation: text(r, raw, 'translation', path),
  }
}

function parseTrial(r: Report, raw: unknown, path: string): PackTrial {
  const probes: PackProbe[] = []
  const course: Partial<Record<CefrLevel, PackCourseSize>> = {}
  if (!isRecord(raw)) {
    r.add(path, 'must be an object with "probes" and "course"')
    return { probes, course }
  }
  records(r, raw, 'probes', path).forEach((p, i) => probes.push(parseProbe(r, p, `${at(path, 'probes')}[${i}]`)))
  checkUnique(r, probes.map((p) => p.entry_id), (i) => `${at(path, 'probes')}[${i}].entry_id`, 'entry_id')
  const rawCourse = raw['course']
  if (!isRecord(rawCourse)) r.add(at(path, 'course'), 'must be an object of course sizes by level')
  else {
    for (const [level, size] of Object.entries(rawCourse)) {
      const sizePath = `${at(path, 'course')}.${level}`
      if (!(CEFR_LEVELS as readonly string[]).includes(level)) r.add(sizePath, `must be one of ${CEFR_LEVELS.join(', ')}`)
      else if (!isRecord(size)) r.add(sizePath, 'must be an object with "units" and "words"')
      else course[level as CefrLevel] = { units: integer(r, size, 'units', sizePath, 1), words: integer(r, size, 'words', sizePath, 1) }
    }
  }
  const rawThemes = raw['themes']
  if (rawThemes === undefined) return { probes, course }
  const themes: Record<string, number> = {}
  if (!isRecord(rawThemes)) r.add(at(path, 'themes'), 'must be an object of word counts by theme')
  else for (const themeId of Object.keys(rawThemes)) themes[themeId] = integer(r, rawThemes, themeId, at(path, 'themes'), 1)
  return { probes, course, themes }
}

/** Referential integrity and the stability rules that hold inside one pack (spec §5.1, §13). */
function crossCheck(r: Report, pack: Pack): void {
  checkUnique(r, pack.entries.map((e) => e.entry_id), (i) => `entries[${i}].entry_id`, 'entry_id')
  checkUnique(
    r,
    pack.entries.map((e) => `${norm(e.headword)}|${e.pos}|${norm(e.sense)}`),
    (i) => `entries[${i}]`,
    'headword, part of speech and sense',
  )
  checkUnique(r, pack.units.map((u) => u.unit_id), (i) => `units[${i}].unit_id`, 'unit_id')
  checkUnique(r, pack.units.map((u) => String(u.order)), (i) => `units[${i}].order`, 'order')
  checkUnique(r, pack.themes.map((t) => t.theme_id), (i) => `themes[${i}].theme_id`, 'theme_id')
  checkUnique(r, pack.audio.map((c) => c.clip_id), (i) => `audio[${i}].clip_id`, 'clip_id')

  const units = new Map(pack.units.map((u) => [u.unit_id, u]))
  const entries = new Map(pack.entries.map((e) => [e.entry_id, e]))
  const themes = new Set(pack.themes.map((t) => t.theme_id))
  const clips = new Set(pack.audio.map((c) => c.clip_id))
  const referencedBy = new Map<string, string>()

  pack.entries.forEach((e, i) => {
    const path = `entries[${i}]`
    const unit = units.get(e.unit_id)
    if (!unit) r.add(`${path}.unit_id`, `unknown unit ${JSON.stringify(e.unit_id)}`)
    else {
      if (unit.level !== e.level) r.add(`${path}.level`, `differs from the level of unit ${e.unit_id}`)
      if (!unit.entry_ids.includes(e.entry_id)) r.add(`${path}.unit_id`, `unit ${e.unit_id} does not list this entry`)
    }
    checkUnique(r, e.themes, (j) => `${path}.themes[${j}]`, 'theme')
    e.themes.forEach((t, j) => {
      if (!themes.has(t)) r.add(`${path}.themes[${j}]`, `unknown theme ${JSON.stringify(t)}`)
    })
    checkUnique(r, e.variants.map(norm), (j) => `${path}.variants[${j}]`, 'variant')
    checkUnique(r, [e.translation, ...e.alternates].map(norm), (j) => `${path}.alternates[${j - 1}]`, 'translation')
    for (const [accent, clip] of Object.entries(e.audio)) {
      if (!clips.has(clip)) r.add(`${path}.audio.${accent}`, `unknown clip ${JSON.stringify(clip)}`)
      const owner = referencedBy.get(clip)
      if (owner !== undefined) r.add(`${path}.audio.${accent}`, `clip ${clip} is already the audio of ${owner}`)
      else referencedBy.set(clip, e.entry_id)
    }
  })

  for (const themeId of Object.keys(pack.trial?.themes ?? {})) {
    if (!themes.has(themeId)) r.add(`trial.themes.${themeId}`, `unknown theme ${JSON.stringify(themeId)}`)
  }
  // A probe may be a unit entry (the trial draws from the first unit too), but then it is the same word.
  pack.trial?.probes.forEach((p, i) => {
    const e = entries.get(p.entry_id)
    if (e && (e.headword !== p.headword || e.pos !== p.pos || e.sense !== p.sense || e.level !== p.level || e.translation !== p.translation)) {
      r.add(`trial.probes[${i}]`, 'differs from the entry of the same id')
    }
  })

  pack.units.forEach((u, i) => {
    const path = `units[${i}]`
    if (u.entry_ids.length === 0) r.add(`${path}.entry_ids`, 'must list at least one entry')
    checkUnique(r, u.entry_ids, (j) => `${path}.entry_ids[${j}]`, 'entry')
    u.entry_ids.forEach((entryId, j) => {
      const e = entries.get(entryId)
      if (!e) r.add(`${path}.entry_ids[${j}]`, `unknown entry ${JSON.stringify(entryId)}`)
      else if (e.unit_id !== u.unit_id) r.add(`${path}.entry_ids[${j}]`, `entry ${entryId} belongs to unit ${e.unit_id}`)
    })
  })

  const ordered = [...pack.units].sort((a, b) => a.order - b.order)
  ordered.forEach((u, i) => {
    const prev = ordered[i - 1]
    if (prev && levelIndex(u.level) < levelIndex(prev.level)) {
      r.add(`units[${pack.units.indexOf(u)}].order`, `a ${u.level} unit cannot follow the ${prev.level} unit ${prev.unit_id} in path order`)
    }
  })

  pack.audio.forEach((c, i) => {
    if (!referencedBy.has(c.clip_id)) r.add(`audio[${i}].clip_id`, 'no entry references this clip')
  })
}

/**
 * Checks a parsed pack document (spec §5.1, §13): every field, every ID
 * reference, no duplicate sense, units and entries consistent both ways, path
 * order monotone in level, and an audio manifest that is well-formed with
 * every clip the audio of exactly one entry. Structural errors are all collected; cross checks run only
 * on a structurally sound pack.
 */
export function validatePack(value: unknown, options: ValidatePackOptions = {}): PackValidation {
  const supported = options.supportedSchemaVersions ?? [PACK_SCHEMA_VERSION]
  if (!isRecord(value)) return { status: 'invalid', errors: [{ path: '', message: 'must be an object' }] }
  const schema = value['schema_version']
  if (typeof schema !== 'number' || !Number.isInteger(schema) || schema < 1) {
    return { status: 'invalid', errors: [{ path: 'schema_version', message: 'must be a positive integer' }] }
  }
  if (!supported.includes(schema)) return { status: 'unsupported_schema', schemaVersion: schema }

  const r = new Report()
  const l1 = text(r, value, 'l1', '')
  if (l1 !== '' && !LANG.test(l1)) r.add('l1', 'must be a two-letter lowercase language code')
  const target = text(r, value, 'target', '')
  if (target !== '' && !LANG.test(target)) r.add('target', 'must be a two-letter lowercase language code')
  const trial = value['trial'] === undefined ? undefined : parseTrial(r, value['trial'], 'trial')
  const pack: Pack = {
    schema_version: schema,
    pack_id: id(r, value, 'pack_id', ''),
    corpus_version: integer(r, value, 'corpus_version', '', 0),
    l1,
    target,
    entries: records(r, value, 'entries', '').map((e, i) => parseEntry(r, e, `entries[${i}]`)),
    units: records(r, value, 'units', '').map((u, i) => parseUnit(r, u, `units[${i}]`)),
    themes: records(r, value, 'themes', '').map((t, i) => parseTheme(r, t, `themes[${i}]`)),
    audio: records(r, value, 'audio', '').map((c, i) => parseClip(r, c, `audio[${i}]`)),
    ...(trial ? { trial } : {}),
  }
  if (r.errors.length === 0) crossCheck(r, pack)
  return r.errors.length > 0 ? { status: 'invalid', errors: r.errors } : { status: 'ok', pack }
}
