import type { Parsed } from './syncValidation'
import { isRecord, LANG } from './validation'

/** What a learner can tell us about the app itself (spec §8.12): it is broken, an idea, or anything else. */
export const FEEDBACK_KINDS = ['bug', 'idea', 'other'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

export const MAX_FEEDBACK_MESSAGE_LENGTH = 2000
/** The longest address the mail standards allow. */
export const MAX_FEEDBACK_EMAIL_LENGTH = 254
/** The app's and the corpus's version, as the client names them. */
export const MAX_FEEDBACK_VERSION_LENGTH = 40
export const MAX_FEEDBACK_SCREEN_LENGTH = 200
export const MAX_FEEDBACK_USER_AGENT_LENGTH = 400

/**
 * A field no person fills in: the form hides it, and a program that fills in every field gives itself away.
 * The server answers such a request as if it had been kept, and keeps nothing.
 */
export const FEEDBACK_TRAP_FIELD = 'website'

/** `POST /v1/feedback`: the learner's words, and the details shown to them under the form. */
export interface FeedbackInput {
  readonly kind: FeedbackKind
  readonly message: string
  /** Where to answer; empty when the learner wants none. */
  readonly email: string
  readonly appVersion: string
  /** Empty before any pack is installed. */
  readonly corpusVersion: string
  readonly language: string
  /** The path the form was opened from, without its query. */
  readonly screen: string
  readonly userAgent: string
}

/** Whether a program filled in the hidden field. */
export function isFeedbackTrap(raw: unknown): boolean {
  if (!isRecord(raw)) return false
  const value = raw[FEEDBACK_TRAP_FIELD]
  return value !== undefined && value !== null && value !== ''
}

const isShort = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max

/**
 * Checks a feedback body. The message and the address are trimmed; a field the server does not know is ignored.
 * The address is checked only loosely: it is for a person to answer, and nothing is sent to it by itself.
 */
export function parseFeedback(raw: unknown): Parsed<FeedbackInput> {
  if (!isRecord(raw)) return { ok: false, errors: ['the feedback must be an object'] }
  const errors: string[] = []
  const { kind, appVersion, corpusVersion, language, screen, userAgent } = raw
  const message = typeof raw['message'] === 'string' ? raw['message'].trim() : null
  // A client that sends no address means none.
  const email = raw['email'] === undefined ? '' : typeof raw['email'] === 'string' ? raw['email'].trim() : null
  if (!(FEEDBACK_KINDS as readonly unknown[]).includes(kind)) errors.push(`kind must be one of ${FEEDBACK_KINDS.join(', ')}`)
  if (message === null || message === '' || message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    errors.push(`message must be text of 1 to ${MAX_FEEDBACK_MESSAGE_LENGTH} characters`)
  }
  if (email === null || email.length > MAX_FEEDBACK_EMAIL_LENGTH || (email !== '' && !/^[^\s@]+@[^\s@]+$/.test(email))) {
    errors.push(`email must be an address of at most ${MAX_FEEDBACK_EMAIL_LENGTH} characters, or empty`)
  }
  if (!isShort(appVersion, MAX_FEEDBACK_VERSION_LENGTH) || appVersion === '') errors.push(`appVersion must be text of 1 to ${MAX_FEEDBACK_VERSION_LENGTH} characters`)
  if (!isShort(corpusVersion, MAX_FEEDBACK_VERSION_LENGTH)) errors.push(`corpusVersion must be text of at most ${MAX_FEEDBACK_VERSION_LENGTH} characters`)
  if (typeof language !== 'string' || !LANG.test(language)) errors.push('language must be a two-letter language code')
  if (!isShort(screen, MAX_FEEDBACK_SCREEN_LENGTH) || !/^\/[^?#\s]*$/.test(screen)) {
    errors.push(`screen must be a path of at most ${MAX_FEEDBACK_SCREEN_LENGTH} characters, without a query`)
  }
  if (!isShort(userAgent, MAX_FEEDBACK_USER_AGENT_LENGTH)) errors.push(`userAgent must be text of at most ${MAX_FEEDBACK_USER_AGENT_LENGTH} characters`)
  if (errors.length > 0) return { ok: false, errors }
  return {
    ok: true,
    value: {
      kind: kind as FeedbackKind,
      message: message as string,
      email: email as string,
      appVersion: appVersion as string,
      corpusVersion: corpusVersion as string,
      language: language as string,
      screen: screen as string,
      userAgent: userAgent as string,
    },
  }
}
