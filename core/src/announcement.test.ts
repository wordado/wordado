import { describe, expect, it } from 'vitest'
import {
  ANNOUNCEMENT_KINDS,
  ANNOUNCEMENT_LANGUAGES,
  announcementTextFor,
  isAnnouncementKind,
  isAnnouncementLanguage,
  MAX_ANNOUNCEMENT_BODY,
  MAX_ANNOUNCEMENT_SUBJECT,
  validateAnnouncementTexts,
} from './announcement'

const en = { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.\nRead them: https://wordado.com/en/terms/' }

describe('announcements (#185)', () => {
  it('has two kinds, kept apart, and the interface languages', () => {
    expect(ANNOUNCEMENT_KINDS).toEqual(['service', 'news'])
    expect(ANNOUNCEMENT_LANGUAGES).toEqual(['bg', 'de', 'en', 'es'])
    expect(isAnnouncementKind('news')).toBe(true)
    expect(isAnnouncementKind('marketing')).toBe(false)
    expect(isAnnouncementLanguage('de')).toBe(true)
    expect(isAnnouncementLanguage('fr')).toBe(false)
  })

  it('takes texts with English and any of the other languages', () => {
    expect(validateAnnouncementTexts({ en })).toEqual({ ok: true, texts: { en } })
    const bg = { subject: 'Условията се променят', body: 'Здравейте.' }
    expect(validateAnnouncementTexts({ en, bg })).toEqual({ ok: true, texts: { en, bg } })
  })

  it('trims, makes every line end the same, and leaves out a language with nothing written', () => {
    const result = validateAnnouncementTexts({ en: { subject: '  Hello  ', body: '\r\nOne\r\nTwo\rThree  \n\n' }, de: { subject: '', body: '  \n' } })
    expect(result).toEqual({ ok: true, texts: { en: { subject: 'Hello', body: 'One\nTwo\nThree' } } })
  })

  it('needs English, since it is what an account with no text in its language gets', () => {
    const result = validateAnnouncementTexts({ bg: { subject: 'Здравейте', body: 'Текст' } })
    expect(result).toEqual({ ok: false, errors: ['en: a subject and a body are needed'] })
  })

  it('refuses half a language, an unknown one, and what is not text', () => {
    expect(validateAnnouncementTexts({ en, de: { subject: 'Hallo', body: '' } })).toEqual({ ok: false, errors: ['de: a subject and a body are needed'] })
    expect(validateAnnouncementTexts({ en, fr: { subject: 'Bonjour', body: 'Texte' } })).toEqual({ ok: false, errors: ['fr: not a language of the app'] })
    expect(validateAnnouncementTexts({ en: { subject: 7, body: 'x' } })).toEqual({ ok: false, errors: ['en: a subject and a body are needed'] })
    for (const input of [null, 'text', [en], 7]) expect(validateAnnouncementTexts(input).ok).toBe(false)
  })

  it('holds the subject and the body to their lengths', () => {
    expect(validateAnnouncementTexts({ en: { subject: 's'.repeat(MAX_ANNOUNCEMENT_SUBJECT), body: 'b'.repeat(MAX_ANNOUNCEMENT_BODY) } }).ok).toBe(true)
    expect(validateAnnouncementTexts({ en: { subject: 's'.repeat(MAX_ANNOUNCEMENT_SUBJECT + 1), body: 'b' } })).toEqual({
      ok: false,
      errors: [`en: the subject is longer than ${MAX_ANNOUNCEMENT_SUBJECT} characters`],
    })
    expect(validateAnnouncementTexts({ en: { subject: 's', body: 'b'.repeat(MAX_ANNOUNCEMENT_BODY + 1) } })).toEqual({
      ok: false,
      errors: [`en: the body is longer than ${MAX_ANNOUNCEMENT_BODY} characters`],
    })
  })

  it('refuses a subject that could start a new header line, and control characters anywhere', () => {
    for (const subject of ['Hello\nBcc: all@example.com', 'Hello\r\nX: y', 'Hello\u2028there', 'Hello\u0085there', 'Tab\there', 'Nul\u0000l', 'Esc\u001b[0m']) {
      expect(validateAnnouncementTexts({ en: { subject, body: 'b' } })).toEqual({ ok: false, errors: ['en: the subject must be one line of plain text'] })
    }
    for (const body of ['Bell\u0007', 'Nul\u0000l', 'Esc\u001b[0m', 'Del\u007f']) {
      expect(validateAnnouncementTexts({ en: { subject: 's', body } })).toEqual({ ok: false, errors: ['en: the body must be plain text'] })
    }
  })

  it('gives each language its own text, and English where there is none', () => {
    const bg = { subject: 'Здравейте', body: 'Текст' }
    expect(announcementTextFor({ en, bg }, 'bg')).toEqual({ language: 'bg', text: bg })
    expect(announcementTextFor({ en, bg }, 'de')).toEqual({ language: 'en', text: en })
    expect(announcementTextFor({ en, bg }, 'en')).toEqual({ language: 'en', text: en })
  })
})
