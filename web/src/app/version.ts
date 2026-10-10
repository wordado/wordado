/**
 * The app's version, for feedback (spec §8.12): the name the build gave the entry script from its contents
 * (`/assets/index-<hash>.js`), read from the page that loaded it. It changes only when the app's code does, so
 * a deploy that changes nothing in the app gives no learner an update to fetch, as a commit or a date built
 * into the code would. `dev` when the page was not built (the Vite dev server).
 */
export function appVersion(doc: Pick<Document, 'querySelector'> = document): string {
  const src = doc.querySelector('script[type="module"][src]')?.getAttribute('src') ?? ''
  return /\/index-([A-Za-z0-9_-]+)\.js$/.exec(src)?.[1] ?? 'dev'
}
