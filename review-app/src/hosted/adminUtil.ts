/** Runs an admin action: true when it succeeded; on failure the server's message lands in the page notice. Either
 * way the page reloads, so it shows what the server now holds. */
export type Act = (action: () => Promise<unknown>) => Promise<boolean>

export const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** An ISO timestamp as a local date and time; anything that is not a date comes back as it is. */
export function dateOf(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

/** The last path segment: "review/translation-de/a.csv" → "a.csv". */
export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)
