/** An address for mail, in any script, with `mailto:` before it when it has one. */
const EMAIL = /(?:mailto:)?[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/giu
/** From `http://`, `https://` or `www.` to the next white space. */
const LINK = /(?:https?:\/\/|www\.)\S+/gi
/** A bare host with a Latin top-level name, and its path. "end.Start", typed with no space, is one too: accepted. */
const HOST = /(?<![\p{L}\p{N}])(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?/giu
/** A run of digits with what a phone number is written with, standing by itself: no letter or digit beside it. */
const NUMBER = /(?<![\p{L}\p{N}])\+?\(?\d[\d ()./-]*\d(?![\p{L}\p{N}])/gu
/** The digits a run needs to be read as a phone number: "10 000" is not one, a date with dashes is (accepted). */
const PHONE_DIGITS = 8

/** A learner's text with email addresses, web addresses and phone numbers replaced by [email], [link] and [phone]
 * (spec 2026-10-10 §2 rule 3). It finds addresses and numbers, not names. It errs on the side of masking. */
export function maskPersonal(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(LINK, '[link]')
    .replace(HOST, '[link]')
    .replace(NUMBER, (run) => (run.replace(/\D/g, '').length >= PHONE_DIGITS ? '[phone]' : run))
}
