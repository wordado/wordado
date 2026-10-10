import { MAX_TOPIC_TITLE_LENGTH, MIN_TOPIC_TITLE_LENGTH } from '../shared/hosted'
import { maskPersonal } from './mask'

/** What a title is not written with: a line break, a tab or any other control character. */
const NOT_ONE_LINE = /[\p{Cc}\p{Zl}\p{Zp}]/u

/**
 * A topic's title as it is kept, or null when it may not be one (spec 2026-10-10 §3.2). A title is shown in the tab
 * and named in a mail, and the AI writes it from what strangers wrote: so it is one line of a few words, and it
 * holds nothing masking would change, which is to say no address for mail, no web address and no phone number.
 * The same holds for a title the coordinator types.
 */
export function topicTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const title = raw.trim()
  if (title.length < MIN_TOPIC_TITLE_LENGTH || title.length > MAX_TOPIC_TITLE_LENGTH || NOT_ONE_LINE.test(title)) return null
  return maskPersonal(title) === title ? title : null
}
