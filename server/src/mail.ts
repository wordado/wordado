import type { Fetch, Mailer } from './deps'

/**
 * Local development prints the code instead of sending it (spec §4.4). scripts/smoke.ts reads this line.
 */
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
 * Mail through Resend's HTTP API. A sign-in email carries the code and
 * nothing else (spec §11), in each interface language, since the learner's
 * choice is not known before they sign in. The feedback mail goes to the
 * coordinator alone, in plain text (spec §8.12).
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
  return {
    sendSignInCode: (email, code) =>
      send(
        email,
        `Wordado: ${code}`,
        `Your Wordado sign-in code is ${code}. It expires in 5 minutes.\n\nВашият код за вход в Wordado е ${code}. Валиден е 5 минути.\n\nDein Wordado-Anmeldecode ist ${code}. Er ist 5 Minuten gültig.\n\nTu código de inicio de sesión en Wordado es ${code}. Caduca en 5 minutos.`,
      ),
  }
}
