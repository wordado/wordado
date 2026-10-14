import { describe, expect, it } from 'vitest'
import { looksAlike } from './lookAlike'

describe('looksAlike', () => {
  it('finds an international word in each learner language', () => {
    expect(looksAlike('telephone', ['телефон'], 'bg')).toBe(true)
    expect(looksAlike('democracy', ['демокрация'], 'bg')).toBe(true)
    expect(looksAlike('university', ['Universität'], 'de')).toBe(true)
    expect(looksAlike('information', ['información'], 'es')).toBe(true)
    expect(looksAlike('philosophy', ['философия'], 'bg')).toBe(true)
  })

  it('leaves a word that does not look like its translation', () => {
    expect(looksAlike('house', ['къща'], 'bg')).toBe(false)
    expect(looksAlike('tree', ['Baum'], 'de')).toBe(false)
    expect(looksAlike('window', ['ventana'], 'es')).toBe(false)
  })

  it('looks at every translation, and at each word of one', () => {
    expect(looksAlike('television', ['цветен телевизор'], 'bg')).toBe(true)
    expect(looksAlike('problem', ['lío', 'problema'], 'es')).toBe(true)
  })

  it('never counts a short word as alike', () => {
    expect(looksAlike('bus', ['bus'], 'de')).toBe(false)
  })
})
