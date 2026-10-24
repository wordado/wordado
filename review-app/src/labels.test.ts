import { describe, expect, it } from 'vitest'
import { assignmentLabel, fieldLabel, languageLabel, queueLabel, scopeLabel } from './labels'

describe('labels', () => {
  it('names queues in plain words', () => {
    expect(queueLabel('translation-de')).toBe('German translations')
    expect(queueLabel('title-bg')).toBe('Bulgarian unit titles')
    expect(queueLabel('level')).toBe('English levels')
    expect(queueLabel('something-else')).toBe('something-else')
  })
  it('names a second target’s queues by their course', () => {
    expect(queueLabel('de/level')).toBe('German levels')
    expect(queueLabel('de/grammar')).toBe('German grammar')
    expect(queueLabel('de/translation-bg')).toBe('German course: Bulgarian translations')
    expect(queueLabel('de/translation-en')).toBe('German course: English translations')
    expect(queueLabel('de/title-es')).toBe('German course: Spanish unit titles')
    expect(queueLabel('de/german')).toBe('de/german')
    expect(assignmentLabel({ queue: 'de/level', files: '*', flaggedOnly: true })).toBe('German levels · flagged rows')
  })
  it('names the overview’s rows: a language of a course', () => {
    expect(languageLabel('en', 'bg')).toBe('Bulgarian')
    expect(languageLabel('en', 'en')).toBe('English levels')
    expect(languageLabel('de', 'bg')).toBe('German course: Bulgarian')
    expect(languageLabel('de', 'en')).toBe('German course: English')
    expect(languageLabel('de', 'de')).toBe('German course')
  })
  it('names an assignment’s scope', () => {
    expect(scopeLabel({ files: '*', flaggedOnly: true })).toBe('flagged rows')
    expect(scopeLabel({ files: '*', flaggedOnly: false })).toBe('all rows')
    expect(scopeLabel({ files: ['a', 'b'], flaggedOnly: false })).toBe('2 files')
    expect(scopeLabel({ files: ['a'], flaggedOnly: true })).toBe('flagged rows in 1 file')
    expect(assignmentLabel({ queue: 'translation-es', files: '*', flaggedOnly: true })).toBe('Spanish translations · flagged rows')
    // a spot check is named for what it is, not for the files its sample came from
    expect(scopeLabel({ files: ['a', 'b'], flaggedOnly: false, spotCheck: { sample: 50, result: null } })).toBe('spot check')
    expect(scopeLabel({ files: ['a', 'b'], flaggedOnly: false, spotCheck: null })).toBe('2 files')
    expect(assignmentLabel({ queue: 'translation-de', files: ['a'], flaggedOnly: false, spotCheck: { sample: 50, result: null } })).toBe('German translations · spot check')
  })
  it('names a row’s fields in plain words', () => {
    expect(fieldLabel('translation')).toBe('Translation')
    expect(fieldLabel('title_l1')).toBe('Translated title')
    expect(fieldLabel('gender')).toBe('Gender')
    expect(fieldLabel('auxiliary')).toBe('Auxiliary')
    expect(fieldLabel('something_new')).toBe('something_new')
  })
})
