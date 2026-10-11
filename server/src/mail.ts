import type { Fetch, Mailer } from './deps'

/**
 * The provider answered that it did not send an announcement mail (#185). `refused`: it will not take this mail,
 * whenever it is asked (the address is none). `busy`: it takes nothing now (too many requests, a fault of its
 * own, a key or a domain it does not accept), which says nothing of the recipient. `quota`: the day's or the
 * month's allowance is used up. `message` holds the status and nothing of the mail.
 */
export class MailNotSent extends Error {
  constructor(
    readonly reason: 'refused' | 'busy' | 'quota',
    message: string,
  ) {
    super(message)
  }
}

/**
 * Local development prints the code instead of sending it (spec §4.4). scripts/smoke.ts reads this line.
 */
export function consoleMailer(log: (line: string) => void = (line) => console.log(line)): Mailer {
  return {
    async sendSignInCode(email, code) {
      log(`Sign-in code for ${email}: ${code}`)
    },
    // Without the address: a log has no learner's address in it for a mail that needs no reading there (#185).
    async sendAnnouncement(mail) {
      log(`Announcement mail: ${mail.subject}`)
    },
  }
}

export interface ResendOptions {
  readonly apiKey: string
  readonly from: string
  readonly fetch?: Fetch
}

/**
 * Mail through Resend's HTTP API. A sign-in email carries the code and
 * nothing else (spec §11), in each interface language, since the learner's
 * choice is not known before they sign in. The feedback mail goes to the
 * coordinator alone, in plain text (spec §8.12). An announcement (#185) goes
 * as plain text too, with the headers and the key it was given.
 */
export function resendMailer(options: ResendOptions): Mailer {
  const fetchFn: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  const send = async (to: string, subject: string, text: string): Promise<void> => {
    const response = await fetchFn('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: options.from, to: [to], subject, text }),
    })
    if (!response.ok) throw new Error(`Resend refused the email: ${response.status}`)
  }
  /** Resend's own names for an allowance used up, in the body of a 429 (resend.com/docs/api-reference/rate-limit). */
  const QUOTA_ERRORS = ['daily_quota_exceeded', 'monthly_quota_exceeded']
  return {
    async sendAnnouncement(mail) {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json', 'idempotency-key': mail.idempotencyKey },
        body: JSON.stringify({ from: options.from, to: [mail.to], reply_to: mail.replyTo, subject: mail.subject, text: mail.text, headers: mail.headers }),
      })
      if (response.ok) return
      const status = `Resend did not send the announcement mail: ${response.status}`
      // 409: the key is in use by a request still running, or was used for another mail. Whether one went is not known.
      if (response.status === 409) throw new Error(status)
      // 422: Resend's answer to a mail it cannot make, which for a text that passed the test send is the address.
      if (response.status === 422) throw new MailNotSent('refused', status)
      const name = response.status === 429 ? ((await response.json().catch(() => null)) as { name?: unknown } | null)?.name : null
      throw new MailNotSent(typeof name === 'string' && QUOTA_ERRORS.includes(name) ? 'quota' : 'busy', status)
    },
    sendSignInCode: (email, code) =>
      send(
        email,
        `Wordado: ${code}`,
        `Your Wordado sign-in code is ${code}. It expires in 5 minutes.\n\nВашият код за вход в Wordado е ${code}. Валиден е 5 минути.\n\nDein Wordado-Anmeldecode ist ${code}. Er ist 5 Minuten gültig.\n\nTu código de inicio de sesión en Wordado es ${code}. Caduca en 5 minutos.`,
      ),
  }
}
