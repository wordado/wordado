import { CEFR_LEVELS } from '@wordado/core'
import { ParseError, type LlmRequest } from '../llm'
import { L1_GUIDES } from '../stages/translate'

export type QueueKind = 'translation' | 'title' | 'level'
export type AiVerdictKind = 'ok' | 'minor' | 'major'

export interface Objection {
  readonly field: string
  readonly category: string
  readonly severity: 'minor' | 'major'
  readonly reason: string
  /** The field's corrected value, as the review CSV writes it (lists separated by " | "). */
  readonly fix: string
}
export interface RowVerdict {
  readonly key: string
  readonly verdict: AiVerdictKind
  readonly objections: readonly Objection[]
}
export interface ReviewRow {
  readonly key: string
  readonly cells: Readonly<Record<string, string>>
  readonly context: Readonly<Record<string, unknown>>
}

/** Bump a kind's version when its prompt or schema changes: every row of that kind is reviewed again. */
export const AI_REVIEW_VERSION: Readonly<Record<QueueKind, number>> = { translation: 1, title: 1, level: 1 }

export const FIELDS: Readonly<Record<QueueKind, readonly string[]>> = {
  translation: ['translation', 'alternates', 'sense'],
  title: ['title_en', 'title_l1'],
  level: ['level'],
}
const CATEGORIES: Readonly<Record<QueueKind, readonly string[]>> = {
  translation: ['wrong-sense', 'form', 'aspect', 'register', 'alternate-wrong', 'alternate-missing', 'sense', 'unnatural', 'spelling', 'other'],
  title: ['inaccurate', 'unnatural', 'mismatch', 'style', 'other'],
  level: ['too-low', 'too-high', 'other'],
}

export function queueKind(queue: string): QueueKind | null {
  if (/^translation-[a-z]{2}$/.test(queue)) return 'translation'
  if (/^title-[a-z]{2}$/.test(queue)) return 'title'
  return queue === 'level' ? 'level' : null
}

const COMMON = `For each row, in the order given:
1. First list the errors you find, judged against this row's own meaning and context. For each: the field, a category, a severity, a short reason in English, and the corrected value of that field, which must differ from the current one (lists are written separated by " | ").
   - major: a learner would be taught a wrong answer, or marked wrong for a right one.
   - minor: correct, but could be better.
2. Do not flag matters of taste. "No errors" is a normal outcome.
3. Then give the verdict: ok (no errors), minor (only minor ones) or major (at least one major), and your confidence from 0 to 1.
learner_reports, when not empty, is what learners said about this row: check their complaint first.`

function systemPrompt(kind: QueueKind, l1: string): string {
  if (kind === 'translation') {
    return `You are a native-speaker lexicographer reviewing an English vocabulary course for adults whose native language is the one below.
Another model wrote each row's translation, alternates and sense following these rules:

${L1_GUIDES[l1] ?? ''}

Learners are marked correct if they type the translation or any alternate, so a wrong alternate teaches a wrong answer, and a missing common one marks a right answer wrong. Near-synonyms correct in this meaning are fine.
"sense" is two to four words telling this meaning apart from the word's other meanings. It is REQUIRED when other_live_senses is not empty, and must not repeat the translation or an alternate.

${COMMON}`
  }
  if (kind === 'title') {
    return `You review the unit titles of an English vocabulary course. Each unit has about 20 words (words) and a title in English (title_en) and in the learners' native language (title_l1).
A good title is two to four words that say what the words actually have in common; the English in sentence case; the native-language title as a textbook in that language would put it, saying the same as the English. Plain titles such as "Verbs 3" or "More words 1" are fine when the words share no theme.

${COMMON}`
  }
  return `You check the CEFR level of each meaning in an English vocabulary course for adults (A1 to C1; there is no C2 in the course: give C1 and say so in the reason).
The question for each row: at which level does a typical adult learner first need this meaning?
- A1: handles basic personal and everyday needs: greetings, family, food, the home, numbers, time.
- A2: handles routine tasks and familiar topics: shopping, directions, work routines, simple past events.
- B1: handles work, study, leisure and travel; describes experiences, plans and opinions.
- B2: handles abstract and technical topics in their field.
- C1: uses the language flexibly for social, academic and professional purposes.
Judge the meaning, not the word. band is the level by written frequency alone: a strong hint, not the answer. Judge from these descriptors only; do not reproduce published level lists.
The corrected value of level is one of A1, A2, B1, B2, C1.

${COMMON}`
}

function schema(kind: QueueKind): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string', enum: FIELDS[kind] },
                  category: { type: 'string', enum: CATEGORIES[kind] },
                  severity: { type: 'string', enum: ['minor', 'major'] },
                  reason: { type: 'string' },
                  fix: { type: 'string' },
                },
                required: ['field', 'category', 'severity', 'reason', 'fix'],
                additionalProperties: false,
              },
            },
            verdict: { type: 'string', enum: ['ok', 'minor', 'major'] },
            confidence: { type: 'number' },
          },
          required: ['key', 'errors', 'verdict', 'confidence'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  }
}

/** What remains of a raw objection: a known field and category, and a fix that changes something. */
function cleanObjection(kind: QueueKind, raw: unknown, cells: Readonly<Record<string, string>>): Objection | null {
  const o = raw as Partial<Record<keyof Objection, unknown>>
  if (typeof o.field !== 'string' || !FIELDS[kind].includes(o.field)) return null
  if (typeof o.category !== 'string' || !CATEGORIES[kind].includes(o.category)) return null
  if (o.severity !== 'minor' && o.severity !== 'major') return null
  let fix = typeof o.fix === 'string' ? o.fix.trim() : ''
  if (kind === 'level') {
    fix = fix.toUpperCase()
    if (!(CEFR_LEVELS as readonly string[]).includes(fix)) return null
  }
  if (fix === (cells[o.field] ?? '').trim()) return null
  return { field: o.field, category: o.category, severity: o.severity, reason: typeof o.reason === 'string' ? o.reason : '', fix }
}

export function reviewRequest(queue: string, rows: readonly ReviewRow[]): LlmRequest<RowVerdict[]> {
  const kind = queueKind(queue)
  if (!kind) throw new Error(`${queue} is not a queue AI review covers`)
  const l1 = queue.split('-')[1] ?? ''
  return {
    name: 'review',
    system: systemPrompt(kind, l1),
    input: { rows: rows.map((r) => ({ key: r.key, ...r.cells, ...r.context })) },
    schema: schema(kind),
    parse: (value) => {
      const items = (value as { items?: unknown }).items
      if (!Array.isArray(items) || items.length !== rows.length) throw new ParseError(`answers other rows than it was asked (${Array.isArray(items) ? items.length : 0} for ${rows.length})`)
      return items.map((raw, i) => {
        const row = rows[i]!
        const item = raw as { key?: unknown; errors?: unknown }
        if (item.key !== row.key) throw new ParseError(`answers other rows than it was asked: item ${i} is ${JSON.stringify(item.key)}, not ${row.key}`)
        const objections = (Array.isArray(item.errors) ? item.errors : []).map((e) => cleanObjection(kind, e, row.cells)).filter((o): o is Objection => o !== null)
        const verdict: AiVerdictKind = objections.length === 0 ? 'ok' : objections.some((o) => o.severity === 'major') ? 'major' : 'minor'
        return { key: row.key, verdict, objections }
      })
    },
  }
}
