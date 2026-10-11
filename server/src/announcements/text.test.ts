import { ANNOUNCEMENT_LANGUAGES, type AnnouncementTexts } from '@wordado/core'
import { describe, expect, it } from 'vitest'
import { CONTACT_ADDRESS, composeAnnouncementMail, SITE_URL, unsubscribePage } from './text'

const texts: AnnouncementTexts = {
  en: { subject: 'The terms change on 1 December', body: 'Hello,\n\nthe terms change.\nRead them: https://wordado.com/en/terms/' },
  bg: { subject: 'Условията се променят', body: 'Здравейте.' },
}
const link = 'https://app.wordado.com/v1/news/unsubscribe?t=abc.def&l=en'

describe('the mail of an announcement (#185)', () => {
  it('a service notice: the text, why it came, who sent it, and no way to unsubscribe', () => {
    const mail = composeAnnouncementMail('service', texts, 'en', null)
    expect(mail.subject).toBe('The terms change on 1 December')
    expect(mail.text).toBe(
      'Hello,\n\nthe terms change.\nRead them: https://wordado.com/en/terms/\n\n-- \n' +
        'You are receiving this notice because you have a Wordado account. Notices about the service itself go to every account holder.\n' +
        `Wordado · ${SITE_URL} · ${CONTACT_ADDRESS}`,
    )
    expect(mail.headers).toEqual({})
    expect(mail.text).not.toContain('unsubscribe')
  })

  it('news: the link that withdraws the consent, in the text and as the one-click headers (RFC 8058)', () => {
    const mail = composeAnnouncementMail('news', texts, 'en', link)
    expect(mail.text).toContain(`You are receiving this because you agreed to news about Wordado by email. To stop it, open: ${link}\n`)
    expect(mail.text.endsWith(`Wordado · ${SITE_URL} · ${CONTACT_ADDRESS}`)).toBe(true)
    expect(mail.headers).toEqual({ 'List-Unsubscribe': `<${link}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' })
  })

  it('never makes a news mail without its link', () => {
    expect(() => composeAnnouncementMail('news', texts, 'en', null)).toThrow()
  })

  it('writes in the account’s language where the announcement has it, in English otherwise, footer and all', () => {
    const bg = composeAnnouncementMail('service', texts, 'bg', null)
    expect(bg.language).toBe('bg')
    expect(bg.subject).toBe('Условията се променят')
    expect(bg.text).toContain('Получавате това съобщение, защото имате профил в Wordado.')
    const de = composeAnnouncementMail('service', texts, 'de', null)
    expect(de.language).toBe('en')
    expect(de.subject).toBe('The terms change on 1 December')
    expect(de.text).toContain('You are receiving this notice')
  })

  it('says why in every language, with the link in the news of each', () => {
    const all: AnnouncementTexts = { en: texts.en, bg: texts.bg!, de: { subject: 'Hallo', body: 'Text' }, es: { subject: 'Hola', body: 'Texto' } }
    const reasons = new Set<string>()
    for (const language of ANNOUNCEMENT_LANGUAGES) {
      const service = composeAnnouncementMail('service', all, language, null).text.split('\n-- \n')[1]!
      const news = composeAnnouncementMail('news', all, language, link).text.split('\n-- \n')[1]!
      expect(service).not.toContain(link)
      expect(news).toContain(link)
      reasons.add(service)
      reasons.add(news)
    }
    expect(reasons.size).toBe(8)
  })
})

describe('the page behind the unsubscribe link (#185)', () => {
  it('asks before it withdraws, with a form that posts to the same address', () => {
    const page = unsubscribePage('ask', 'en')
    expect(page).toContain('<html lang="en">')
    expect(page).toContain('<form method="post">')
    expect(page).toContain('Stop news about Wordado by email?')
    expect(page).toContain('still sent')
  })

  it('says it is done, or that the link does not work, without a form', () => {
    for (const state of ['done', 'invalid'] as const) expect(unsubscribePage(state, 'en')).not.toContain('<form')
    expect(unsubscribePage('done', 'en')).toContain('no more news')
  })

  it('speaks each interface language', () => {
    const pages = new Set(ANNOUNCEMENT_LANGUAGES.map((language) => unsubscribePage('ask', language)))
    expect(pages.size).toBe(ANNOUNCEMENT_LANGUAGES.length)
    expect(unsubscribePage('ask', 'de')).toContain('<html lang="de">')
  })
})
