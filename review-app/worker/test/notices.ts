import type { AnnouncementText } from '@wordado/core'

const FENCE = '```'
const NAMES: Readonly<Record<string, string>> = { en: 'English', bg: 'Bulgarian', de: 'German', es: 'Spanish' }

/** A notice's file in the format the Mail tab reads (review-app/README.md), for the tests and the hosted browser run: nothing of a real notice. */
export function noticeFile(title: string, texts: Readonly<Record<string, AnnouncementText>>): string {
  const sections = Object.entries(texts).map(([code, text]) => `## ${NAMES[code] ?? code} (${code})\n\nSubject:\n\n${FENCE}text\n${text.subject}\n${FENCE}\n\nBody:\n\n${FENCE}text\n${text.body}\n${FENCE}\n`)
  return `# ${title}\n\nStatus: ready, not sent\n\n${sections.join('\n')}`
}
