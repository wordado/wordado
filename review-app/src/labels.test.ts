import { describe, expect, it } from 'vitest'
import { assignmentLabel, fieldLabel, queueLabel, scopeLabel } from './labels'

describe('labels', () => {
  it('names queues in plain words', () => {
    expect(queueLabel('translation-de')).toBe('German translations')
    expect(queueLabel('title-bg')).toBe('Bulgarian unit titles')
    expect(queueLabel('level')).toBe('English levels')
    expect(queueLabel('something-else')).toBe('something-else')
  })
  it('names an assignment’s scope', () => {
    expect(scopeLabel({ files: '*', flaggedOnly: true })).toBe('flagged rows')
    expect(scopeLabel({ files: '*', flaggedOnly: false })).toBe('all rows')
    expect(scopeLabel({ files: ['a', 'b'], flaggedOnly: false })).toBe('2 files')
    expect(scopeLabel({ files: ['a'], flaggedOnly: true })).toBe('flagged rows in 1 file')
    expect(assignmentLabel({ queue: 'translation-es', files: '*', flaggedOnly: true })).toBe('Spanish translations · flagged rows')
  })
  it('names a row’s fields in plain words', () => {
    expect(fieldLabel('translation')).toBe('Translation')
    expect(fieldLabel('title_l1')).toBe('Translated title')
    expect(fieldLabel('something_new')).toBe('something_new')
  })
})
