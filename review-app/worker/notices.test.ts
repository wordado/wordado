import { MAX_ANNOUNCEMENT_BODY, MAX_ANNOUNCEMENT_SUBJECT } from '@wordado/core'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { resetGitHubTokens } from './github'
import { MAX_NOTICE_TITLE, NOTICES_READ, noticeDate, noticesSource, parseNotice, preparedNotice } from './notices'
import { FakeGitHub, testAppKey } from './test/fakeGitHub'
import { noticeFile } from './test/notices'
import { testDeps } from './test/platform'

const en = { subject: 'The terms of use have changed', body: 'Hello,\n\nthe terms have changed.\n\n- One thing.\n- Another.\n\nRead them: https://example.com/en/terms' }
const bg = { subject: 'Условията за ползване са променени', body: 'Здравейте,\n\nусловията са променени.' }
const FENCE = '```'
/** One language's section, written out by hand. */
const section = (heading: string, subject: string, body: string) => `## ${heading}\n\nSubject:\n\n${FENCE}text\n${subject}\n${FENCE}\n\nBody:\n\n${FENCE}text\n${body}\n${FENCE}\n`

describe('noticesSource: where the prepared notices are', () => {
  it('is a repository and a folder in it', () => {
    expect(noticesSource({ NOTICES_REPO: 'an-owner/a-repo', NOTICES_PATH: 'docs/notices' })).toEqual({ repo: 'an-owner/a-repo', path: 'docs/notices' })
    expect(noticesSource({ NOTICES_REPO: ' an-owner/a-repo ', NOTICES_PATH: ' /notices/ ' })).toEqual({ repo: 'an-owner/a-repo', path: 'notices' })
  })

  it('is nothing unless both are set to what they name', () => {
    for (const [NOTICES_REPO, NOTICES_PATH] of [[undefined, undefined], ['', ''], ['an-owner/a-repo', ''], ['', 'notices'], ['a-repo', 'notices'], ['an-owner/a-repo/more', 'notices'], ['an-owner/a-repo', '../other'], ['an-owner/a-repo', 'a//b'], ['an-owner/a-repo', 'a b'], ['an-owner/a-repo', 'a?ref=x']]) {
      expect(noticesSource({ ...(NOTICES_REPO === undefined ? {} : { NOTICES_REPO }), ...(NOTICES_PATH === undefined ? {} : { NOTICES_PATH }) })).toBeNull()
    }
  })
})

describe('noticeDate: the day of the change in a file’s name', () => {
  it('is the day the name starts with', () => {
    expect(noticeDate('2026-10-11-new-terms.md')).toBe('2026-10-11')
    expect(noticeDate('2026-10-11.md')).toBe('2026-10-11')
    expect(noticeDate('2024-02-29-a-2nd-change.md')).toBe('2024-02-29')
  })

  it('is nothing for any other name, or for a day the calendar does not have', () => {
    for (const name of ['README.md', 'new-terms.md', '2026-10-11-new-terms.txt', '2026-10-11-New-Terms.md', '2026-10-11_new_terms.md', '2026-13-01-x.md', '2026-02-30-x.md', '26-10-11-x.md', '2026-10-11-.md', '2026-10-11-x.md.bak']) expect(noticeDate(name)).toBeNull()
  })
})

describe('parseNotice: a notice’s file, read whole or not at all', () => {
  it('reads the title and each language’s subject and body, as an announcement keeps them', () => {
    expect(parseNotice(noticeFile('New terms of use', { en, bg }))).toEqual({ title: 'New terms of use', texts: { en, bg } })
  })

  it('reads the languages in any order, by the code that ends each heading, whatever the heading calls the language', () => {
    const file = `# A title\n\n${section('Български (bg)', bg.subject, bg.body)}\n${section('The English one (en)', en.subject, en.body)}`
    expect(parseNotice(file)).toEqual({ title: 'A title', texts: { en, bg } })
  })

  it('does not read what is between the title and the first language, and takes other line ends, a byte order mark and spaces at a line’s end', () => {
    const file = `﻿\n# A title  \n\nStatus: sent on a day\n\nA note for people, with \`code\` and a list:\n- one\n\n${section('English (en)', en.subject, en.body)}\n\n`
    expect(parseNotice(file.replace(/\n/g, '\r\n'))).toEqual({ title: 'A title', texts: { en } })
  })

  it('takes a fence with no word after it, and a longer one around a body that holds a fence', () => {
    const body = `Before.\n${FENCE}\nnot the end\n${FENCE}\nAfter.`
    const file = `# A title\n\n## English (en)\nSubject:\n${FENCE}\n${en.subject}\n${FENCE}\nBody:\n\`\`\`\`text\n${body}\n\`\`\`\`\n`
    expect(parseNotice(file)).toEqual({ title: 'A title', texts: { en: { subject: en.subject, body } } })
  })

  it('keeps a line of a body that looks like a heading or a label', () => {
    const body = 'Hello,\n\n## Not a heading (de)\n\nSubject:\nBody:'
    expect(parseNotice(noticeFile('A title', { en: { subject: en.subject, body } }))?.texts.en.body).toBe(body)
  })

  const english = section('English (en)', en.subject, en.body)
  it.each<[string, string]>([
    ['is empty', ''],
    ['has no title', english],
    ['has a title of another level', `## A title\n\n${english}`],
    ['has a title longer than a title may be', `# ${'t'.repeat(MAX_NOTICE_TITLE + 1)}\n\n${english}`],
    ['has no language', '# A title\n\nStatus: ready\n'],
    ['has no English', `# A title\n\n${section('Bulgarian (bg)', bg.subject, bg.body)}`],
    ['has a language twice', `# A title\n\n${english}\n${english}`],
    ['has a heading with no code', `# A title\n\n${section('English', en.subject, en.body)}`],
    ['has a heading with a code that is no language of the app', `# A title\n\n${english}\n${section('French (fr)', 'Sujet', 'Texte.')}`],
    ['has a code in capitals', `# A title\n\n${section('English (EN)', en.subject, en.body)}`],
    ['has a heading that is not a language after the first one', `# A title\n\n${english}\n## Notes\n\nSomething.\n`],
    ['has words between the heading and the subject', `# A title\n\n## English (en)\n\nRead twice.\n\nSubject:\n\n${FENCE}\n${en.subject}\n${FENCE}\n\nBody:\n\n${FENCE}\n${en.body}\n${FENCE}\n`],
    ['has words after the last block', `# A title\n\n${english}\nSent on a day.\n`],
    ['has the body before the subject', `# A title\n\n## English (en)\n\nBody:\n\n${FENCE}\n${en.body}\n${FENCE}\n\nSubject:\n\n${FENCE}\n${en.subject}\n${FENCE}\n`],
    ['has the subject on the label’s line', `# A title\n\n## English (en)\n\nSubject: ${en.subject}\n\nBody:\n\n${FENCE}\n${en.body}\n${FENCE}\n`],
    ['has no body', `# A title\n\n## English (en)\n\nSubject:\n\n${FENCE}\n${en.subject}\n${FENCE}\n`],
    ['has a fence that is never closed', `# A title\n\n## English (en)\n\nSubject:\n\n${FENCE}\n${en.subject}\n${FENCE}\n\nBody:\n\n${FENCE}\n${en.body}\n`],
    ['has a subject of two lines', `# A title\n\n${section('English (en)', 'One\nTwo', en.body)}`],
    ['has a subject longer than an announcement’s', `# A title\n\n${section('English (en)', 's'.repeat(MAX_ANNOUNCEMENT_SUBJECT + 1), en.body)}`],
    ['has a body longer than an announcement’s', `# A title\n\n${section('English (en)', en.subject, 'b'.repeat(MAX_ANNOUNCEMENT_BODY + 1))}`],
    ['has a control character in a body', `# A title\n\n${section('English (en)', en.subject, 'Hello\u0007')}`],
    ['has a language with a heading and nothing written', `# A title\n\n${english}\n${section('German (de)', '', '')}`],
    ['has a language with a subject and no body', `# A title\n\n${english}\n${section('German (de)', 'Betreff', '')}`],
  ])('passes over a file that %s', (_what, file) => {
    expect(parseNotice(file)).toBeNull()
  })
})

describe('preparedNotice: the newest prepared notice no announcement has used (#215)', () => {
  const REPO = 'an-owner/a-repo'
  let env: Env
  let logged: string[]
  const older = { subject: 'An older change', body: 'Hello.' }
  const offered = (gh: FakeGitHub, used: readonly string[] = []) => preparedNotice(testDeps(env, { fetch: gh.fetch, log: (line) => logged.push(line) }), new Set(used))

  beforeEach(async () => {
    resetGitHubTokens()
    logged = []
    env = { GITHUB_APP_ID: '1', GITHUB_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: (await testAppKey()).pem, CONTENT_REPO: 'wordado/wordado-content', NOTICES_REPO: REPO, NOTICES_PATH: 'docs/notices' } as Env
  })

  it('is the newest by the day in its name, read in three requests after the token, from the notices’ repository', async () => {
    const gh = new FakeGitHub({ 'docs/notices/2026-09-01-older.md': noticeFile('Older', { en: older }), 'docs/notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en, bg }), 'docs/notices/README.md': '# How notices are written', 'docs/notices/drafts/2026-12-01-later.md': noticeFile('Later', { en }), 'docs/other.md': 'x' }, REPO)
    expect(await offered(gh)).toEqual({ file: '2026-10-11-new-terms.md', date: '2026-10-11', title: 'New terms of use', texts: { en, bg } })
    expect(gh.requests).toEqual(['POST /app/installations/2/access_tokens', `GET /repos/${REPO}/git/ref/heads/main`, `GET /repos/${REPO}/contents/docs/notices`, 'POST /graphql'])
    expect(logged).toEqual([])
  })

  it('passes over a notice an announcement has the English subject of, and offers the next', async () => {
    const gh = new FakeGitHub({ 'docs/notices/2026-09-01-older.md': noticeFile('Older', { en: older }), 'docs/notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en, bg }) }, REPO)
    expect((await offered(gh, [en.subject]))?.file).toBe('2026-09-01-older.md')
    expect(await offered(gh, ['Something else', en.subject, older.subject])).toBeNull()
  })

  it('passes over a file that is not in the format, whole, and says which in the log', async () => {
    const gh = new FakeGitHub({ 'docs/notices/2026-09-01-older.md': noticeFile('Older', { en: older }), 'docs/notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en, fr: { subject: 'Sujet', body: 'Texte.' } }) }, REPO)
    expect((await offered(gh))?.file).toBe('2026-09-01-older.md')
    expect(logged).toEqual(['prepared notices: 2026-10-11-new-terms.md is not in the format and was passed over'])
  })

  it(`reads the ${NOTICES_READ} newest and no more`, async () => {
    const files = Object.fromEntries(Array.from({ length: NOTICES_READ + 2 }, (_, i) => [`docs/notices/2026-0${i + 1}-01-change.md`, noticeFile(`Change ${i + 1}`, { en: { subject: `Change ${i + 1}`, body: 'Hello.' } })]))
    const gh = new FakeGitHub(files, REPO)
    const newest = Array.from({ length: NOTICES_READ }, (_, i) => `Change ${NOTICES_READ + 2 - i}`)
    expect((await offered(gh, newest.slice(0, -1)))?.title).toBe(newest.at(-1))
    expect(await offered(gh, newest)).toBeNull()
  })

  it('is nothing, and asks nobody, without the settings or the GitHub App’s key', async () => {
    const gh = new FakeGitHub({ 'docs/notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en }) }, REPO)
    for (const without of [{ NOTICES_REPO: '' }, { NOTICES_PATH: '' }, { GITHUB_APP_PRIVATE_KEY: '' }, { GITHUB_INSTALLATION_ID: '' }]) {
      env = { ...env, ...without }
      expect(await offered(gh)).toBeNull()
    }
    expect(gh.requests).toEqual([])
  })

  it('is nothing when the folder is not there, is empty of notices, or the repository cannot be read, with the call and its status in the log', async () => {
    expect(await offered(new FakeGitHub({ 'docs/other.md': 'x' }, REPO))).toBeNull()
    expect(await offered(new FakeGitHub({ 'docs/notices/README.md': 'x' }, REPO))).toBeNull()
    expect(logged).toEqual([])
    // The GitHub App is not installed on the repository: GitHub says it is not there.
    expect(await offered(new FakeGitHub({ 'docs/notices/2026-10-11-new-terms.md': noticeFile('New terms of use', { en }) }, 'an-owner/another'))).toBeNull()
    expect(logged).toEqual(['prepared notices: not read, GitHub ref: 404'])
    const down = new FakeGitHub({}, REPO)
    resetGitHubTokens()
    expect(await preparedNotice(testDeps(env, { fetch: async () => new Response('down', { status: 503 }), log: (line) => logged.push(line) }), new Set())).toBeNull()
    expect(logged.at(-1)).toBe('prepared notices: not read, GitHub installation token: 503')
    expect(down.requests).toEqual([])
  })
})
