/** Runs an admin action: true when it succeeded; on failure the server's message lands in the page notice. Either
 * way the page reloads, so it shows what the server now holds. */
export type Act = (action: () => Promise<unknown>) => Promise<boolean>

/** What a tab's dialogs need of the page: its notice, to say inside the dialog what went wrong with what was done
 * there (the page's own line is behind the dialog), and a fresh start when a dialog opens, so it does not show an
 * older error. */
export interface PageNotice {
  readonly notice: string
  clearNotice(): void
}

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** An ISO timestamp as a local date and time; anything that is not a date comes back as it is. */
export function dateOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** An ISO timestamp as a local day, "2 Oct"; anything that is not a date comes back as it is. */
export function dayOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** The last path segment: "review/translation-de/a.csv" → "a.csv". */
export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** A part of a whole as a CSS width, never more than all of it: the parts of a progress bar. */
export const share = (part: number, whole: number): string => `${whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : 0}%`

/** "1 row", "2 rows". */
export const count = (n: number, one: string, many = `${one}s`): string => `${n.toLocaleString('en')} ${n === 1 ? one : many}`
