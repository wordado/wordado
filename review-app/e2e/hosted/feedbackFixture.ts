import type { FeedbackItem } from '@wordado/core'
import type { FeedbackAi } from '../../shared/hosted'
import { feedbackItem } from '../../worker/test/fakeLearnerApp'

/* The feedback the hosted browser run and the screenshots read, and what the stand-in model says of each message.
 * Nothing here asks a model: the answers are written down. */

/** What the fake learner app server holds. The bugs are the desktop run's and the ideas the phone run's, so the two
 * browser projects can mark theirs side by side; the messages of kind Other are for the AI help, and nobody marks them. */
export const FEEDBACK: readonly FeedbackItem[] = [
  feedbackItem(6, { kind: 'other', language: 'en', message: 'Cheap watches and fast loans!!! Visit https://example.com/offer today', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' }),
  feedbackItem(7, { kind: 'other', language: 'bg', message: 'Благодаря за приложението, уча с него всеки ден!' }),
  feedbackItem(8, { kind: 'other', language: 'es', message: 'Me gustaría elegir cuántas palabras nuevas aprendo cada día.' }),
  feedbackItem(9, { kind: 'other', language: 'de', message: 'Der Ton eines Wortes wird auf meinem Handy zweimal abgespielt.\nSchreibt mir bitte: lerner@example.com', contactEmail: 'answer-me@example.com' }),
  feedbackItem(11, { kind: 'idea', message: 'A dark theme would be easier in the evening.', contactEmail: 'ideas@example.com', signedIn: true }),
  feedbackItem(12, { message: 'The path does not open after I finish a unit.\nI see a white screen until I reload.', contactEmail: 'learner@example.com', signedIn: true }),
  feedbackItem(13, { kind: 'idea', message: 'Let me choose how many new words a day.', corpusVersion: '' }),
  feedbackItem(14, { message: 'The sound of a word plays twice on my phone.' }),
  feedbackItem(15, { kind: 'other', message: 'Thank you for the app. A-very-long-word-without-any-spaces-in-it-that-has-to-break-somewhere-on-a-narrow-screen-' + 'x'.repeat(60) }),
]

/** The stand-in model's reading of each message, by id: a German and a Spanish one translated, a Bulgarian one that
 * needs no translation, an advertisement read as junk, and the five English ones read plainly. */
export const AI_ANSWERS: Readonly<Record<number, FeedbackAi>> = {
  6: { language: 'en', translation: '', category: 'junk', severity: null, summary: 'An advertisement for watches and loans, with a link.' },
  7: { language: 'bg', translation: '', category: 'praise', severity: null, summary: 'Thanks for the app; studies with it every day.' },
  8: { language: 'es', translation: 'I would like to choose how many new words I learn each day.', category: 'idea', severity: null, summary: 'Wants to set the number of new words a day.' },
  9: { language: 'de', translation: 'The sound of a word is played twice on my phone.\nPlease write to me: [email]', category: 'bug', severity: 'annoys', summary: 'The sound of a word plays twice on a phone.' },
  11: { language: 'en', translation: '', category: 'idea', severity: null, summary: 'Asks for a dark theme for the evening.' },
  12: { language: 'en', translation: '', category: 'bug', severity: 'blocks', summary: 'The path stays white after a unit until the page is reloaded.' },
  13: { language: 'en', translation: '', category: 'idea', severity: null, summary: 'Wants to choose the number of new words a day.' },
  14: { language: 'en', translation: '', category: 'bug', severity: 'annoys', summary: 'The sound of a word plays twice on a phone.' },
  15: { language: 'en', translation: '', category: 'praise', severity: null, summary: 'Thanks for the app.' },
}

/** The stand-in model's answer to a request: the reading written down for each message it was given, in the answer's own words ("none" for no severity). */
export function standInAnswer(_name: string, input: unknown): unknown {
  const messages = (input as { messages?: { id: number }[] }).messages ?? []
  return { results: messages.flatMap((m) => (AI_ANSWERS[m.id] ? [{ id: m.id, ...AI_ANSWERS[m.id], severity: AI_ANSWERS[m.id]!.severity ?? 'none' }] : [])) }
}
