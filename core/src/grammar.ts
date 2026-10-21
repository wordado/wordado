import type { PartOfSpeech } from './types'
import type { Target } from './target'

export type GrammarValue = string | boolean
/** An entry's grammar block (spec §5.2): the fields its target's schema declares for its part of speech. */
export type Grammar = Readonly<Record<string, GrammarValue>>

export interface GrammarField {
  readonly kind: 'enum' | 'text' | 'flag'
  readonly values?: readonly string[]
  /** The parts of speech that carry this field. */
  readonly pos: readonly PartOfSpeech[]
}

/** Per target (spec §5.5). English declares none. */
export const GRAMMAR_SCHEMAS: Readonly<Partial<Record<Target, Readonly<Record<string, GrammarField>>>>> = {
  de: {
    gender: { kind: 'enum', values: ['m', 'f', 'n'], pos: ['noun'] },
    plural: { kind: 'text', pos: ['noun'] },
    separable: { kind: 'flag', pos: ['verb'] },
    irregular: { kind: 'flag', pos: ['verb'] },
    auxiliary: { kind: 'enum', values: ['haben', 'sein'], pos: ['verb'] },
  },
}

/** What is wrong with an entry's grammar block. A field the schema does not know is ignored (§5.2). */
export function grammarProblems(target: string, pos: PartOfSpeech, grammar: unknown): string[] {
  const schema = Object.hasOwn(GRAMMAR_SCHEMAS, target) ? GRAMMAR_SCHEMAS[target as Target] : undefined
  if (!schema) return [`${target} has no grammar block`]
  if (typeof grammar !== 'object' || grammar === null || Array.isArray(grammar)) return ['must be an object']
  const problems: string[] = []
  for (const [name, value] of Object.entries(grammar)) {
    // Own keys only: JSON from outside may name `constructor` or `toString`.
    if (!Object.hasOwn(schema, name)) continue
    const field = schema[name]!
    if (!field.pos.includes(pos)) problems.push(`${name} is not a field of a ${pos}`)
    else if (field.kind === 'text' && typeof value !== 'string') problems.push(`${name} must be text`)
    else if (field.kind === 'flag' && typeof value !== 'boolean') problems.push(`${name} must be true or false`)
    else if (field.kind === 'enum' && !field.values!.includes(value as string)) problems.push(`${name} must be one of ${field.values!.join(', ')}`)
  }
  return problems
}
