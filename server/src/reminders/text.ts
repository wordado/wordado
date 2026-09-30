export const REMINDER_LANGUAGES = ['bg', 'de', 'en'] as const
export type ReminderLanguage = (typeof REMINDER_LANGUAGES)[number]

export type Reminder = { readonly kind: 'due'; readonly count: number } | { readonly kind: 'streak'; readonly days: number }

export interface ReminderText {
  readonly title: string
  readonly body: string
}

function english(reminder: Reminder): string {
  if (reminder.kind === 'streak') return `Your ${reminder.days}-day streak needs today's practice.`
  if (reminder.count === 0) return 'A few minutes of new words today?'
  return reminder.count === 1 ? 'You have 1 word to review today.' : `You have ${reminder.count} words to review today.`
}

function bulgarian(reminder: Reminder): string {
  if (reminder.kind === 'streak') {
    return reminder.days === 1
      ? 'Поредицата ви от 1 ден има нужда от днешното упражнение.'
      : `Поредицата ви от ${reminder.days} дни има нужда от днешното упражнение.`
  }
  if (reminder.count === 0) return 'Няколко минути с нови думи днес?'
  return reminder.count === 1 ? 'Имате 1 дума за преговор днес.' : `Имате ${reminder.count} думи за преговор днес.`
}

function german(reminder: Reminder): string {
  if (reminder.kind === 'streak') {
    return reminder.days === 1
      ? 'Deine Serie von 1 Tag braucht die heutige Übung.'
      : `Deine Serie von ${reminder.days} Tagen braucht die heutige Übung.`
  }
  if (reminder.count === 0) return 'Ein paar Minuten mit neuen Wörtern heute?'
  return reminder.count === 1 ? 'Du hast heute 1 Wort zu wiederholen.' : `Du hast heute ${reminder.count} Wörter zu wiederholen.`
}

/** The notification a reminder shows (spec §8.11, §11.2). Plan 8's native review owns the Bulgarian copy. */
export function reminderText(language: ReminderLanguage, reminder: Reminder): ReminderText {
  const body = language === 'bg' ? bulgarian(reminder) : language === 'de' ? german(reminder) : english(reminder)
  return { title: 'Wordado', body }
}
