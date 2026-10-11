import { announcementTextFor, type AnnouncementKind, type AnnouncementLanguage, type AnnouncementTexts } from '@wordado/core'

/** The public website, which holds the terms and the privacy policy (web/src/app/site.ts). */
export const SITE_URL = 'https://wordado.com'
/** The provider's public contact address, the one on the website's legal pages (docs/deploy.md). An answer to an announcement goes there. */
export const CONTACT_ADDRESS = 'privacy@wordado.com'

interface Footer {
  /** Why a service notice came: it goes to every account holder, and there is nothing to unsubscribe from. */
  readonly service: string
  /** Why news came, ending where the link follows. */
  readonly news: string
}

const FOOTERS: Record<AnnouncementLanguage, Footer> = {
  bg: {
    service: 'Получавате това съобщение, защото имате профил в Wordado. Съобщенията за самата услуга се изпращат до всички с профил.',
    news: 'Получавате този имейл, защото се съгласихте да получавате новини за Wordado по имейл. За да ги спрете, отворете:',
  },
  de: {
    service: 'Du erhältst diese Mitteilung, weil du ein Wordado-Konto hast. Mitteilungen zum Dienst selbst gehen an alle, die ein Konto haben.',
    news: 'Du erhältst diese E-Mail, weil du Neuigkeiten über Wordado per E-Mail zugestimmt hast. Zum Abbestellen öffne:',
  },
  en: {
    service: 'You are receiving this notice because you have a Wordado account. Notices about the service itself go to every account holder.',
    news: 'You are receiving this because you agreed to news about Wordado by email. To stop it, open:',
  },
  es: {
    service: 'Recibes este aviso porque tienes una cuenta de Wordado. Los avisos sobre el propio servicio se envían a todas las personas con cuenta.',
    news: 'Recibes este correo porque aceptaste recibir novedades sobre Wordado por correo electrónico. Para dejar de recibirlas, abre:',
  },
}

export interface ComposedMail {
  /** The language the mail is written in: the account's, or English where the announcement has no text in it. */
  readonly language: AnnouncementLanguage
  readonly subject: string
  readonly text: string
  /** The unsubscribe pair of a news mail (RFC 2369, RFC 8058); none on a service notice. */
  readonly headers: Readonly<Record<string, string>>
}

/**
 * One announcement as one account gets it (#185): plain text and nothing else, so no part of what was written
 * is markup to a mail program. Under the text, after the signature line, why the mail came and who sent it. News
 * carries the link that withdraws the consent, in the text and as the headers a mail program's own unsubscribe
 * button uses; a service notice carries neither, and says that it goes to every account holder. The footer is
 * in the language of the text above it.
 */
export function composeAnnouncementMail(kind: AnnouncementKind, texts: AnnouncementTexts, wanted: AnnouncementLanguage, unsubscribeUrl: string | null): ComposedMail {
  const { language, text } = announcementTextFor(texts, wanted)
  const footer = FOOTERS[language]
  let reason: string
  let headers: Record<string, string> = {}
  if (kind === 'news') {
    if (unsubscribeUrl === null) throw new Error('a news mail needs its unsubscribe link')
    reason = `${footer.news} ${unsubscribeUrl}`
    headers = { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  } else {
    reason = footer.service
  }
  return { language, subject: text.subject, text: `${text.body}\n\n-- \n${reason}\nWordado · ${SITE_URL} · ${CONTACT_ADDRESS}`, headers }
}

interface PageText {
  readonly title: string
  readonly ask: string
  /** What stays: said before the button, so nobody thinks the notices stop too. */
  readonly note: string
  readonly button: string
  readonly done: string
  readonly invalid: string
}

const PAGES: Record<AnnouncementLanguage, PageText> = {
  bg: {
    title: 'Новини по имейл',
    ask: 'Да спрем ли новините за Wordado по имейл?',
    note: 'Съобщенията за самата услуга, например при промяна на условията, ще продължат да идват.',
    button: 'Спиране на новините',
    done: 'Няма да получавате повече новини по имейл. Можете да ги включите отново в приложението, в Настройки › Профил.',
    invalid: 'Тази връзка не работи. Новините по имейл се изключват в приложението, в Настройки › Профил.',
  },
  de: {
    title: 'Neuigkeiten per E-Mail',
    ask: 'Neuigkeiten über Wordado per E-Mail abbestellen?',
    note: 'Mitteilungen zum Dienst selbst, etwa bei geänderten Bedingungen, kommen weiterhin.',
    button: 'Abbestellen',
    done: 'Du bekommst keine Neuigkeiten mehr per E-Mail. In der App kannst du sie unter Einstellungen › Konto wieder einschalten.',
    invalid: 'Dieser Link funktioniert nicht. Neuigkeiten per E-Mail schaltest du in der App unter Einstellungen › Konto aus.',
  },
  en: {
    title: 'News by email',
    ask: 'Stop news about Wordado by email?',
    note: 'Notices about the service itself, such as a change of the terms, are still sent.',
    button: 'Stop the news',
    done: 'You will get no more news by email. You can switch it on again in the app, under Settings › Account.',
    invalid: 'This link does not work. News by email is switched off in the app, under Settings › Account.',
  },
  es: {
    title: 'Novedades por correo',
    ask: '¿Dejar de recibir novedades sobre Wordado por correo electrónico?',
    note: 'Los avisos sobre el propio servicio, como un cambio de las condiciones, se siguen enviando.',
    button: 'Dejar de recibirlas',
    done: 'Ya no recibirás novedades por correo electrónico. Puedes volver a activarlas en la aplicación, en Ajustes › Cuenta.',
    invalid: 'Este enlace no funciona. Las novedades por correo se desactivan en la aplicación, en Ajustes › Cuenta.',
  },
}

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`)

/**
 * The page a news mail's link opens: a question first (`ask`), since a mail scanner opens every link and must
 * not withdraw anyone's consent by doing so; then that it is done, or that the link does not work. Whole in
 * itself: no script, no file of the app, and every word of it from the table above.
 */
export function unsubscribePage(state: 'ask' | 'done' | 'invalid', language: AnnouncementLanguage): string {
  const t = PAGES[language]
  const body =
    state === 'ask'
      ? `<p>${escapeHtml(t.ask)}</p><p class="note">${escapeHtml(t.note)}</p><form method="post"><button type="submit">${escapeHtml(t.button)}</button></form>`
      : `<p>${escapeHtml(state === 'done' ? t.done : t.invalid)}</p>`
  return `<!doctype html>
<html lang="${language}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(t.title)} · Wordado</title>
<style>
body{font:1.0625rem/1.5 system-ui,sans-serif;max-width:32rem;margin:15vh auto 0;padding:0 1.25rem;color:#1c1b19;background:#faf8f4}
h1{font-size:1.375rem}
.note{color:#5a564e}
button{font:inherit;padding:.625rem 1.125rem;border:0;border-radius:.5rem;background:#1c1b19;color:#fff;cursor:pointer}
@media (prefers-color-scheme:dark){body{color:#eeeae2;background:#171614}.note{color:#b3ada1}button{background:#eeeae2;color:#171614}}
</style>
</head>
<body>
<h1>${escapeHtml(t.title)}</h1>
${body}
</body>
</html>
`
}
