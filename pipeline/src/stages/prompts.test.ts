import { describe, expect, it } from 'vitest'
import { PROFILES } from '../profiles'
import { lemmaSystem } from './lemmas'
import { senseSystem } from './senses'
import { translateSystem, L1_GUIDES } from './translate'
import { titleSystem, L1_NAMES } from './titles'
import { themeSystem } from './themes'

// Today's prompts, copied verbatim from the source before this task.
const LEMMAS_EN = `You prepare an English vocabulary course for adult learners.
For each English word form you are given, in the order given, return:
- "form": the form exactly as given.
- "kind": "word" for an ordinary English word; "name" for a proper noun (person, place, brand); "abbreviation" for an abbreviation or acronym; "foreign" for a word that is not English; "offensive" for a slur, profanity or vulgar word; "fragment" for a contraction piece or tokenisation fragment (e.g. "ll", "don").
- "lemmas": for a "word", the dictionary headword(s) the form can be an inflection of, in lowercase (went → go; saw → see, saw; better → good, well, better). Otherwise an empty list.
Return one item per form, in the same order, and nothing else.`

const SENSES_EN = `You prepare an English vocabulary course for adult learners.
For each headword you are given, in the order given, list the senses a learner up to CEFR C1 would need, most common first, at most four. For each sense:
- "pos": one of noun, verb, adj, adv, pron, prep, det, num, conj, intj, phrase ("det" is a determiner, "intj" an interjection, "phrase" a fixed multi-word expression).
- "gloss": two to four plain English words that tell this sense apart from the headword's other senses with the same part of speech ("money" and "river" for bank). Empty only when the headword has a single sense for that part of speech.
- "level": the CEFR level at which a typical learner first needs this sense, judged from the CEFR descriptors (A1: basic personal and everyday needs; A2: routine tasks and familiar topics; B1: work, school, leisure and travel; B2: abstract and technical topics in one's field; C1: flexible use for social, academic and professional purposes). Use C2 for a sense beyond that.
- "ipa": the standard British pronunciation in IPA, without slashes.
- "variants": other accepted spellings (colour → color); usually empty.
- "themes": up to three theme ids from the list given, most relevant first; empty if none fits.
- "examples": three short, natural English sentences using the headword in this sense, suitable for adults, at or below the sense's level. No names of real people or brands.
Do not invent senses to reach four. Return one item per headword, in the same order, with "lemma" exactly as given, and "headword" as a dictionary prints it: with its capital letters where it has them (I, Monday, English, TV), otherwise the same as "lemma".`

const TRANSLATE_BG_EN = `You translate an English vocabulary course for adult learners.
For each item, in the order given, translate the English headword in the sense its gloss and example show.
Translate into Bulgarian, in Cyrillic, as a bilingual dictionary would.
- Nouns: the indefinite singular (вода, not водата).
- Verbs: the first person singular present, the Bulgarian dictionary form (пиша). When both aspects are common, give the imperfective as the translation and the perfective among the alternates (пиша; напиша).
- Adjectives: the masculine singular (голям).
- Interjections and phrases: what a Bulgarian speaker would actually say.
- Alternates: other translations a learner might give that are also correct for this sense, most common first, at most four. No near-synonyms that would be wrong in the example sentence.
- Sense: two to four Bulgarian words that tell this sense apart from the headword's other senses (for bank: "за пари", "на река"). Empty when the gloss is empty.
Use standard literary Bulgarian. No transliteration, no English words, no explanations in brackets.
Return one item per input item, with "key" exactly as given, and nothing else.`

const TITLES_EN = `You name the units of an English vocabulary course for adult learners.
For each unit, in the order given, write a title of two to four words that says what its words have in common ("Food and drink", "At home"), in English ("en", title words in sentence case) and in each of these languages, as a native speaker would title a textbook unit: bg (Bulgarian), de (German, as written in Germany), es (Spanish, as written in Spain).
Return one item per unit with "unit" exactly as given.`

const THEMES_EN = `You sort the words of an English vocabulary course for adult learners into themes.
For each item, in the order given, choose up to three theme ids from the list given whose description the word, in the sense its gloss and example show, clearly fits; most relevant first; empty if none fits.
Choose a topic theme only when the word is mainly used when talking about that topic. A general word that is used in every topic (make, case, increase, therefore) goes to the theme for what it does, such as thinking, comparing, changing or linking ideas, when the list has one.
Return one item per input item, with "key" exactly as given, and nothing else.`

describe('English prompts are unchanged', () => {
  it('lemmas', () => expect(lemmaSystem(PROFILES.en)).toBe(LEMMAS_EN))
  it('senses', () => expect(senseSystem(PROFILES.en)).toBe(SENSES_EN))
  it('translate', () => expect(translateSystem(L1_GUIDES.bg!, PROFILES.en)).toBe(TRANSLATE_BG_EN))
  it('titles', () => expect(titleSystem(['bg', 'de', 'es'], PROFILES.en)).toBe(TITLES_EN))
  it('themes', () => expect(themeSystem(PROFILES.en)).toBe(THEMES_EN))
})

describe('German prompts', () => {
  it('name the course and the language', () => {
    expect(lemmaSystem(PROFILES.de)).toContain('You prepare a German vocabulary course for adult learners.\nFor each German word form')
    expect(senseSystem(PROFILES.de)).toContain('- "grammar": for a noun, "gender"')
    expect(senseSystem(PROFILES.de)).toContain('three short, natural German sentences')
    expect(senseSystem(PROFILES.de)).toContain('two to four plain English words') // glosses stay English
    expect(translateSystem(L1_GUIDES.en!, PROFILES.de)).toContain('translate the German headword')
    expect(themeSystem(PROFILES.de)).toContain('the words of a German vocabulary course')
  })
  it('have an English L1', () => {
    expect(L1_GUIDES.en).toContain('Translate into English')
    expect(L1_NAMES.en).toBe('English, as written in Britain')
  })
})
