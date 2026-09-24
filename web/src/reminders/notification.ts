export interface ReminderText {
  readonly title: string
  readonly body: string
}

/** Shown when the server cannot be asked: a push must always show something (spec §8.11). */
const FALLBACK: Readonly<Record<'bg' | 'en', ReminderText>> = {
  bg: { title: 'Wordado', body: 'Време е за думите ви.' },
  en: { title: 'Wordado', body: 'Time for your words.' },
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * What a woken service worker shows (plan 5 contract): `GET /v1/reminder`
 * with the device's offset now and the interface language, with the session
 * cookie; a fixed text if that fails.
 */
export async function reminderNotification(fetchFn: Fetch, lang: 'bg' | 'en', tzOffsetMin: number): Promise<ReminderText> {
  try {
    const response = await fetchFn(`/v1/reminder?tz=${tzOffsetMin}&lang=${lang}`, { credentials: 'include' })
    if (!response.ok) return FALLBACK[lang]
    const body = (await response.json()) as Partial<ReminderText>
    return typeof body.title === 'string' && typeof body.body === 'string' ? { title: body.title, body: body.body } : FALLBACK[lang]
  } catch {
    return FALLBACK[lang]
  }
}
