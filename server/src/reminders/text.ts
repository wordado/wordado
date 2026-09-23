export const REMINDER_LANGUAGES = ['bg', 'en'] as const
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

/** The notification a reminder shows (spec §8.11, §11.2). Plan 8's native review owns the Bulgarian copy. */
export function reminderText(language: ReminderLanguage, reminder: Reminder): ReminderText {
  return { title: 'Wordado', body: language === 'bg' ? bulgarian(reminder) : english(reminder) }
}
