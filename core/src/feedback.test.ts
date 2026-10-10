import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_KINDS,
  isFeedbackTrap,
  MAX_FEEDBACK_EMAIL_LENGTH,
  MAX_FEEDBACK_MESSAGE_LENGTH,
  MAX_FEEDBACK_SCREEN_LENGTH,
  MAX_FEEDBACK_USER_AGENT_LENGTH,
  MAX_FEEDBACK_VERSION_LENGTH,
  parseFeedback,
} from './feedback'

const feedback = {
  kind: 'bug',
  message: 'The path does not open.',
  email: '',
  appVersion: 'B3kq9xZa',
  corpusVersion: 'bg 6',
  language: 'bg',
  screen: '/path',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
}

describe('parseFeedback', () => {
  it('accepts each kind, with or without an address', () => {
    for (const kind of FEEDBACK_KINDS) expect(parseFeedback({ ...feedback, kind })).toEqual({ ok: true, value: { ...feedback, kind } })
    expect(parseFeedback({ ...feedback, email: 'ana@example.com' })).toMatchObject({ ok: true, value: { email: 'ana@example.com' } })
    const { email: _none, ...withoutEmail } = feedback
    expect(parseFeedback(withoutEmail)).toMatchObject({ ok: true, value: { email: '' } })
  })

  it('trims the message and the address', () => {
    expect(parseFeedback({ ...feedback, message: '  Hello.\n', email: ' ana@example.com ' })).toMatchObject({
      ok: true,
      value: { message: 'Hello.', email: 'ana@example.com' },
    })
  })

  it('accepts every field at its limit, and an empty corpus version and browser', () => {
    const atLimit = {
      ...feedback,
      message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH),
      email: `${'a'.repeat(MAX_FEEDBACK_EMAIL_LENGTH - '@example.com'.length)}@example.com`,
      appVersion: 'v'.repeat(MAX_FEEDBACK_VERSION_LENGTH),
      corpusVersion: 'v'.repeat(MAX_FEEDBACK_VERSION_LENGTH),
      screen: `/${'s'.repeat(MAX_FEEDBACK_SCREEN_LENGTH - 1)}`,
      userAgent: 'u'.repeat(MAX_FEEDBACK_USER_AGENT_LENGTH),
    }
    expect(parseFeedback(atLimit)).toEqual({ ok: true, value: atLimit })
    expect(parseFeedback({ ...feedback, corpusVersion: '', userAgent: '' }).ok).toBe(true)
  })

  it('ignores a field it does not know', () => {
    expect(parseFeedback({ ...feedback, userId: 'u1', website: '' })).toEqual({ ok: true, value: feedback })
  })

  it.each([
    ['something that is not an object', 'feedback'],
    ['a list', [feedback]],
    ['an unknown kind', { ...feedback, kind: 'praise' }],
    ['no message', { ...feedback, message: undefined }],
    ['a message of spaces', { ...feedback, message: ' \n ' }],
    ['a long message', { ...feedback, message: 'x'.repeat(MAX_FEEDBACK_MESSAGE_LENGTH + 1) }],
    ['a message that is not text', { ...feedback, message: 7 }],
    ['an address without @', { ...feedback, email: 'ana.example.com' }],
    ['an address with a space', { ...feedback, email: 'ana @example.com' }],
    ['a long address', { ...feedback, email: `${'a'.repeat(MAX_FEEDBACK_EMAIL_LENGTH)}@example.com` }],
    ['an address that is not text', { ...feedback, email: null }],
    ['no app version', { ...feedback, appVersion: '' }],
    ['a long app version', { ...feedback, appVersion: 'v'.repeat(MAX_FEEDBACK_VERSION_LENGTH + 1) }],
    ['a corpus version that is a number', { ...feedback, corpusVersion: 6 }],
    ['a language that is not a code', { ...feedback, language: 'Bulgarian' }],
    ['a screen with a query', { ...feedback, screen: '/practice?unit=a1-01' }],
    ['a screen that is not a path', { ...feedback, screen: 'https://example.com/' }],
    ['a long screen', { ...feedback, screen: `/${'s'.repeat(MAX_FEEDBACK_SCREEN_LENGTH)}` }],
    ['a long browser name', { ...feedback, userAgent: 'u'.repeat(MAX_FEEDBACK_USER_AGENT_LENGTH + 1) }],
    ['no browser name', { ...feedback, userAgent: undefined }],
  ])('refuses %s', (_name, raw) => {
    expect(parseFeedback(raw).ok).toBe(false)
  })

  it('names every problem at once', () => {
    const parsed = parseFeedback({ ...feedback, kind: 'praise', message: '', language: 'x' })
    expect(parsed.ok ? [] : parsed.errors).toHaveLength(3)
  })
})

describe('isFeedbackTrap', () => {
  it('is a body whose hidden field was filled in', () => {
    expect(isFeedbackTrap({ ...feedback, website: 'https://example.com' })).toBe(true)
    expect(isFeedbackTrap({ ...feedback, website: 1 })).toBe(true)
    expect(isFeedbackTrap({ ...feedback, website: '' })).toBe(false)
    expect(isFeedbackTrap(feedback)).toBe(false)
    expect(isFeedbackTrap(null)).toBe(false)
  })
})
