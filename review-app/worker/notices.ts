import { isAnnouncementLanguage, validateAnnouncementTexts, type AnnouncementLanguage, type AnnouncementText, type AnnouncementTexts } from '@wordado/core'
import type { PreparedNotice } from '../shared/hosted'
import type { Deps } from './app'
import type { Env } from './bindings'
import { GitHubError, githubFor } from './github'
import { repoOf } from './openIssues'

/** The newest files of the folder that are read: one request for all of them, and a notice older than these is not news to anyone. */
export const NOTICES_READ = 5
/** The longest title a notice may have. */
export const MAX_NOTICE_TITLE = 200

/** Where the prepared notices are: the repository and the folder in it, or null when either setting is not one. */
export function noticesSource(env: Pick<Env, 'NOTICES_REPO' | 'NOTICES_PATH'>): { readonly repo: string; readonly path: string } | null {
  const repo = repoOf(env.NOTICES_REPO)
  const parts = (env.NOTICES_PATH ?? '').trim().replace(/^\/+|\/+$/g, '').split('/')
  return repo !== null && parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && !/^\.+$/.test(part)) ? { repo, path: parts.join('/') } : null
}

/** The day of the change a notice's file is named after, `2026-10-11` of `2026-10-11-new-terms.md`; null for any other name. */
export function noticeDate(name: string): string | null {
  const date = /^(\d{4}-\d{2}-\d{2})(?:-[a-z0-9]+)*\.md$/.exec(name)?.[1]
  const day = date === undefined ? Number.NaN : Date.parse(`${date}T00:00:00Z`)
  // A day the calendar has: 30 February is read as a day of March, and is not one.
  return date !== undefined && !Number.isNaN(day) && new Date(day).toISOString().startsWith(date) ? date : null
}

const TITLE = /^# (\S.*)$/
const LANGUAGE = /^## \S.* \(([a-z]{2})\)$/
const FENCE = /^(`{3,})[A-Za-z]*$/

/**
 * A notice's file, read whole or not at all (review-app/README.md has the format in words):
 *
 *     # The title, one line
 *
 *     Anything here is for people and is not read.
 *
 *     ## English (en)
 *
 *     Subject:
 *
 *     ```text
 *     The subject, one line
 *     ```
 *
 *     Body:
 *
 *     ```text
 *     The body, as it is mailed
 *     ```
 *
 * and so on for each language it has, each once, under a heading that ends with its code. From the first such
 * heading on, nothing else is in the file but blank lines. English is needed, and every text has to be one an
 * announcement may hold (validateAnnouncementTexts). Null for a file that is anything else.
 */
export function parseNotice(file: string): { readonly title: string; readonly texts: AnnouncementTexts } | null {
  const lines = file.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n').map((line) => line.trimEnd())
  let at = 0
  const blank = () => {
    while (at < lines.length && lines[at] === '') at += 1
  }
  /** `label` on a line of its own, then a fenced block: what is between its fences. */
  const block = (label: string): string | null => {
    blank()
    if (lines[at] !== label) return null
    at += 1
    blank()
    const fence = FENCE.exec(lines[at] ?? '')?.[1]
    if (fence === undefined) return null
    const from = (at += 1)
    while (at < lines.length && lines[at] !== fence) at += 1
    if (at === lines.length) return null
    at += 1
    return lines.slice(from, at - 1).join('\n')
  }
  blank()
  const title = TITLE.exec(lines[at] ?? '')?.[1]
  if (title === undefined || title.length > MAX_NOTICE_TITLE) return null
  while (at < lines.length && !lines[at]!.startsWith('## ')) at += 1
  const texts: { [L in AnnouncementLanguage]?: AnnouncementText } = {}
  while (at < lines.length) {
    const language = LANGUAGE.exec(lines[at]!)?.[1]
    if (!isAnnouncementLanguage(language) || texts[language]) return null
    at += 1
    const subject = block('Subject:')
    const body = subject === null ? null : block('Body:')
    if (subject === null || body === null) return null
    texts[language] = { subject, body }
    blank()
  }
  const checked = validateAnnouncementTexts(texts)
  // A language with a heading and nothing written under it is a mistake in the file, not a language left out.
  if (!checked.ok || Object.keys(checked.texts).length !== Object.keys(texts).length) return null
  return { title, texts: checked.texts }
}

/**
 * The newest prepared notice that no announcement has used (#215), or null: nothing is set up, the GitHub App has
 * no access, the folder is not there, or every notice of the NOTICES_READ newest is used or not in the format.
 * `used` are the English subjects of the announcements there are: a notice is used when one of them has its
 * English subject, so nothing is kept here to know it. Three requests to GitHub with a token in hand: the head of
 * `main`, the folder's list and the files, all at that commit. Never throws for what GitHub answers: what is
 * logged of a failure is the call and its status, and of a file passed over its name.
 */
export async function preparedNotice(deps: Pick<Deps, 'env' | 'fetch' | 'log' | 'now'>, used: ReadonlySet<string>): Promise<PreparedNotice | null> {
  const source = noticesSource(deps.env)
  const gh = source && githubFor(deps, source.repo)
  if (!source || !gh) return null
  try {
    const head = await gh.headSha()
    const names = ((await gh.listFiles(source.path, head)) ?? []).filter((name) => noticeDate(name) !== null).sort().reverse().slice(0, NOTICES_READ)
    if (names.length === 0) return null
    const files = await gh.readTexts(names.map((name) => `${source.path}/${name}`), head)
    for (const name of names) {
      const notice = parseNotice(files.get(`${source.path}/${name}`) ?? '')
      if (notice === null) deps.log(`prepared notices: ${name} is not in the format and was passed over`)
      else if (!used.has(notice.texts.en.subject)) return { file: name, date: noticeDate(name)!, ...notice }
    }
    return null
  } catch (err) {
    if (!(err instanceof GitHubError)) throw err
    deps.log(`prepared notices: not read, GitHub ${err.what}: ${err.status}`)
    return null
  }
}
