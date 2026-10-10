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

/** The topics the stand-in model makes (spec 2026-10-10 §3.2). The desktop run works on the first, the phone run on the second, and nobody on the third. */
export const SOUND_TOPIC = 'Sound plays twice on phones'
export const WORDS_TOPIC = 'Choose the number of new words'
export const PATH_TOPIC = 'Path stays white after a unit'

/** The open issues of the app's repository, as the fake GitHub lists them and as the review app has them kept. */
export const KNOWN_ISSUES: readonly { readonly number: number; readonly title: string }[] = [
  { number: 94, title: 'The sound of a word plays twice on a phone' },
  { number: 95, title: 'Let learners choose how many new words a day' },
]

/** The topic the stand-in model puts a message in, by the message's id, and the known issue it names with it: the
 * German and the English message about the sound share one, the Spanish and the English one about the number of
 * words another. A message that is not here is put in none. */
export const AI_TOPICS: Readonly<Record<number, { readonly title: string; readonly issue?: number }>> = {
  8: { title: WORDS_TOPIC, issue: 95 },
  9: { title: SOUND_TOPIC, issue: 94 },
  12: { title: PATH_TOPIC },
  13: { title: WORDS_TOPIC, issue: 95 },
  14: { title: SOUND_TOPIC, issue: 94 },
}

/** The stand-in model's answer to a request: the reading written down for each message it was given, in the answer's
 * own words ("none" for no severity, 0 for no topic and no issue). As a model is asked to, it names a topic it was
 * given by its id, and gives a title only for one it was not given; it names an issue only when it was given it. */
export function standInAnswer(_name: string, input: unknown): unknown {
  const { messages = [], topics = [], issues = [] } = input as { messages?: { id: number }[]; topics?: { id: number; title: string }[]; issues?: { number: number }[] }
  return {
    results: messages.flatMap((m) => {
      const reading = AI_ANSWERS[m.id]
      if (!reading) return []
      const topic = AI_TOPICS[m.id]
      const given = topic ? topics.find((t) => t.title === topic.title) : undefined
      const issue = topic?.issue !== undefined && issues.some((i) => i.number === topic.issue) ? topic.issue : 0
      return [{ id: m.id, ...reading, severity: reading.severity ?? 'none', topic_id: given?.id ?? 0, topic_new: topic && !given ? topic.title : '', issue }]
    }),
  }
}
