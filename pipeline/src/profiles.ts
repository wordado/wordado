import { ENTRY_ID_PREFIX, GRAMMAR_SCHEMAS, type GrammarField, type Target } from '@wordado/core'
import type { PipelineConfig } from './config'

export interface LanguageProfile {
  readonly code: Target
  /** The language's English name: "English", "German". */
  readonly name: string
  /** As prompts say it: "an English vocabulary course". */
  readonly course: string
  readonly idPrefix: string
  /** Applied after lower-casing, before diacritics are stripped. */
  readonly transliterate: Readonly<Record<string, string>>
  /** The accents its voices may have; the first is required. */
  readonly accents: readonly string[]
  /** The queue for headword-side fields (IPA, variants, examples): "english", "german". */
  readonly reviewQueue: string
  readonly grammar: Readonly<Record<string, GrammarField>> | null
  readonly lemmaKindLine: string
  readonly lemmaLemmasLine: string
  readonly senseIpaLine: string
  readonly senseVariantsLine: string
  /** Empty when grammar is null. */
  readonly senseGrammarLine: string
  readonly senseHeadwordRule: string
}

const EN: LanguageProfile = {
  code: 'en',
  name: 'English',
  course: 'an English vocabulary course',
  idPrefix: ENTRY_ID_PREFIX.en,
  transliterate: {},
  accents: ['uk', 'us'],
  reviewQueue: 'english',
  grammar: null,
  lemmaKindLine: `- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").`,
  lemmaLemmasLine: `- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.`,
  senseIpaLine: `- "ipa": the standard British pronunciation in IPA, without slashes.`,
  senseVariantsLine: `- "variants": other accepted spellings (colour → color); usually empty.`,
  senseGrammarLine: '',
  senseHeadwordRule: `Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: with its capital letters where it has them (I, Monday, English, TV), otherwise the same as "lemma".`,
}

const DE: LanguageProfile = {
  code: 'de',
  name: 'German',
  course: 'a German vocabulary course',
  idPrefix: ENTRY_ID_PREFIX.de,
  transliterate: { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' },
  accents: ['de'],
  reviewQueue: 'german',
  grammar: GRAMMAR_SCHEMAS.de!,
  lemmaKindLine: `- "kind": "word" for an ordinary German word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not German; "offensive" for a slur, profanity or vulgar word; "fragment" for a tokenisation fragment or the detached particle of a separable verb (e.g. "auf" in "steht auf" when it is not the preposition).`,
  lemmaLemmasLine: `- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase: nouns in the nominative singular, verbs in the infinitive, adjectives uninflected (ging → gehen; häuser → haus; größere → groß). A compound is its own headword (haustür → haustür, not haus or tür). A separable verb's finite form gives the separable infinitive only when the particle is part of the form (aufstehen → aufstehen). Otherwise an empty list.`,
  senseIpaLine: `- "ipa": the standard German pronunciation (as spoken in Germany) in IPA, without slashes.`,
  senseVariantsLine: `- "variants": other accepted spellings (Swiss "ss" for "ß": Straße → Strasse; a reformed or older spelling still in use); usually empty.`,
  senseGrammarLine: `- "grammar": for a noun, "gender" (m, f or n) and "plural" (the nominative plural without the article; empty if the noun has none); for a verb, "separable" (true or false), "irregular" (true for a strong or mixed verb) and "auxiliary" (haben or sein, for the perfect). For any other part of speech give gender "", plural "", separable false, irregular false, auxiliary "".`,
  senseHeadwordRule: `Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: nouns capitalised (Haus, Montag), reflexive verbs with "sich" (sich freuen), otherwise the same as "lemma".`,
}

export const PROFILES: Readonly<Record<Target, LanguageProfile>> = { en: EN, de: DE }

export function profileOf(config: Pick<PipelineConfig, 'target'>): LanguageProfile {
  return PROFILES[config.target ?? 'en']
}
