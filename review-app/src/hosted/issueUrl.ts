/** The longest address the page makes for GitHub's new-issue page: GitHub refuses one that is much longer. */
export const ISSUE_URL_MAX = 6000
/** The highest number an issue is taken to have, as the server takes it. */
const MAX_ISSUE_NUMBER = 2_147_483_647

/**
 * GitHub's new-issue page of `repo` (owner/name) with the title and the body filled in (spec 2026-10-10 §3.5): the
 * coordinator's own browser opens it, signed in as they are, and they file the issue themselves. A body that would
 * make the address too long is left out of it: `bodyInUrl` is then false, and the page offers the text to copy.
 * The length is measured on the finished address, where a letter that is not Latin is six characters or more.
 */
export function issueUrl(repo: string, title: string, body: string): { readonly url: string; readonly bodyInUrl: boolean } {
  const page = `https://github.com/${repo}/issues/new?`
  const whole = `${page}${new URLSearchParams({ title, body }).toString()}`
  if (whole.length <= ISSUE_URL_MAX) return { url: whole, bodyInUrl: true }
  return { url: `${page}${new URLSearchParams({ title }).toString()}`, bodyInUrl: false }
}

/** An issue's number from what was typed or pasted: "94", "#94", or the address of an issue of `repo`. Anything else, another repository's issue among it, is null. */
export function issueNumber(repo: string, typed: string): number | null {
  const said = typed.trim()
  let digits = /^#?([1-9]\d{0,9})$/.exec(said)?.[1]
  if (digits === undefined && /^[\w.-]+\/[\w.-]+$/.test(repo)) {
    const address = new RegExp(`^(?:https?://)?github\\.com/${repo.replace(/[.]/g, '\\.')}/issues/([1-9]\\d{0,9})(?:[/?#].*)?$`, 'i')
    digits = address.exec(said)?.[1]
  }
  if (digits === undefined) return null
  const number = Number(digits)
  return number <= MAX_ISSUE_NUMBER ? number : null
}
