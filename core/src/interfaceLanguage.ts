/**
 * The languages the app's interface speaks (#199). The learner's choice of one is kept on the device; the app also
 * tells the server which it is, so that what the server writes to the account (announcement.ts) is in it.
 */
export const INTERFACE_LANGUAGES = ['bg', 'de', 'en', 'es'] as const
export type InterfaceLanguage = (typeof INTERFACE_LANGUAGES)[number]
export const isInterfaceLanguage = (v: unknown): v is InterfaceLanguage => typeof v === 'string' && (INTERFACE_LANGUAGES as readonly string[]).includes(v)
