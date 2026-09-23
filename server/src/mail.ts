import type { Fetch, Mailer } from './deps'

/** Local development prints the code instead of sending it (spec §4.4). scripts/smoke.ts reads this line. */
export function consoleMailer(log: (line: string) => void = (line) => console.log(line)): Mailer {
  return {
    async sendSignInCode(email, code) {
      log(`Sign-in code for ${email}: ${code}`)
    },
  }
}

export interface ResendOptions {
  readonly apiKey: string
  readonly from: string
  readonly fetch?: Fetch
}

/**
 * Sign-in codes through Resend's HTTP API. The email carries the code and
 * nothing else (spec §11), in both interface languages, since the learner's
 * choice is not known before they sign in.
 */
export function resendMailer(options: ResendOptions): Mailer {
  const send: Fetch = options.fetch ?? ((input, init) => fetch(input, init))
  return {
    async sendSignInCode(email, code) {
      const response = await send('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: options.from,
          to: [email],
          subject: `Wordado: ${code}`,
          text: `Your Wordado sign-in code is ${code}. It expires in 5 minutes.\n\nВашият код за вход в Wordado е ${code}. Валиден е 5 минути.`,
        }),
      })
      if (!response.ok) throw new Error(`Resend refused the email: ${response.status}`)
    },
  }
}
