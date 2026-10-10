import { describe, expect, it } from 'vitest'
import { maskPersonal } from './mask'

describe('maskPersonal (spec 2026-10-10 §2 rule 3)', () => {
  it('masks an email address, Latin or not, also after mailto:', () => {
    expect(maskPersonal('Write to ana.petrova+app@mail.example.com please.')).toBe('Write to [email] please.')
    expect(maskPersonal('mailto:ana@example.com')).toBe('[email]')
    expect(maskPersonal('Пишете на иван@пример.бг, моля.')).toBe('Пишете на [email], моля.')
    expect(maskPersonal('ANA_1%x@EXAMPLE.ORG')).toBe('[email]')
  })

  it('masks a web address: with a scheme, with www, or a bare host with a Latin top-level name', () => {
    expect(maskPersonal('See https://example.com/u/ana?tab=1#top now')).toBe('See [link] now')
    expect(maskPersonal('http://example.com')).toBe('[link]')
    expect(maskPersonal('at www.example.com/me today')).toBe('at [link] today')
    expect(maskPersonal('my page is ana.example.com/about and more')).toBe('my page is [link] and more')
    expect(maskPersonal('Visit Example.COM')).toBe('Visit [link]')
    // An address inside a web address goes with it.
    expect(maskPersonal('https://example.com/?to=ana@example.com')).toBe('[link]')
  })

  it('accepts that a sentence typed with no space after its full stop is masked too', () => {
    expect(maskPersonal('It is the end.Start again.')).toBe('It is the [link] again.')
  })

  it('masks a phone number: a run of at least 8 digits with spaces, brackets, dots, slashes and dashes', () => {
    expect(maskPersonal('Call +359 888 123 456 after six.')).toBe('Call [phone] after six.')
    expect(maskPersonal('0888123456')).toBe('[phone]')
    expect(maskPersonal('Tel. (02) 987-65-43/21.')).toBe('Tel. [phone].')
    expect(maskPersonal('+49 (0) 30 1234.5678')).toBe('[phone]')
    // A date written with dashes has eight digits: masked, and accepted.
    expect(maskPersonal('since 2026-10-05 it fails')).toBe('since [phone] it fails')
  })

  it('leaves short numbers, versions and numbers inside words alone', () => {
    for (const text of ['I learned 10 000 words.', 'version v1.2.3 is slow', 'word 1234567 of the list', 'order A123456789B', 'step 3 of 12, 45 % done', 'e.g. the path, i.e. the first screen']) {
      expect(maskPersonal(text)).toBe(text)
    }
  })

  it('masks several in one text and leaves the words around them, Cyrillic or not, untouched', () => {
    expect(maskPersonal('Звукът се чува два пъти. Пишете ми на ivan@example.com или на 0888 123 456, вижте и https://example.com/video.\nБлагодаря!')).toBe(
      'Звукът се чува два пъти. Пишете ми на [email] или на [phone], вижте и [link]\nБлагодаря!',
    )
    expect(maskPersonal('a@example.com b@example.com')).toBe('[email] [email]')
  })

  it('gives back a text with none of them as it is', () => {
    for (const text of ['', 'The path does not open.\nIt stays white.', 'Благодаря за приложението!', 'Der Ton wird zweimal abgespielt.']) expect(maskPersonal(text)).toBe(text)
  })

  it('changes nothing the second time', () => {
    for (const text of ['Write to ana@example.com or +359 888 123 456, see www.example.com/x and the end.Start.', 'mailto:a@example.com https://example.com/?to=b@example.com 2026-10-05', '[email] [link] [phone]']) {
      const once = maskPersonal(text)
      expect(maskPersonal(once)).toBe(once)
    }
  })
})
