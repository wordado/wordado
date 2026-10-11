import { describe, expect, it } from 'vitest'
import { ISSUE_URL_MAX, issueNumber, issueUrl } from './issueUrl'

const REPO = 'wordado/wordado'
const NEW = 'https://github.com/wordado/wordado/issues/new?'

describe('issueUrl: GitHub’s new-issue page, filled in (spec 2026-10-10 §3.5)', () => {
  it('carries a short draft whole, and gives it back as it was written', () => {
    const title = 'Sound & vision: #1 thing = 50% off?'
    const body = '## What happens\nA word’s audio repeats.\n\n## Where\nstudy & review, “bg” + de'
    const { url, bodyInUrl } = issueUrl(REPO, title, body)
    expect(bodyInUrl).toBe(true)
    expect(url.startsWith(`${NEW}title=`)).toBe(true)
    // Nothing of the title or the text ends the query or starts a fragment.
    expect(url.slice(NEW.length)).not.toMatch(/[#\n ]/)
    expect(url.split('&')).toHaveLength(2)
    const read = new URL(url)
    expect(read.origin + read.pathname).toBe('https://github.com/wordado/wordado/issues/new')
    expect(read.searchParams.get('title')).toBe(title)
    expect(read.searchParams.get('body')).toBe(body)
    expect(read.hash).toBe('')
  })

  it('carries the text up to the longest address, measured on the finished address, and leaves it out beyond', () => {
    const title = 'A title'
    const room = ISSUE_URL_MAX - issueUrl(REPO, title, '').url.length
    const fits = issueUrl(REPO, title, 'x'.repeat(room))
    expect(fits.url).toHaveLength(ISSUE_URL_MAX)
    expect(fits.bodyInUrl).toBe(true)
    const over = issueUrl(REPO, title, 'x'.repeat(room + 1))
    expect(over.bodyInUrl).toBe(false)
    expect(over.url).toBe(`${NEW}title=A+title`)
    expect(new URL(over.url).searchParams.get('body')).toBeNull()
  })

  it('counts a letter that is not Latin as the six characters it is in an address', () => {
    expect(issueUrl(REPO, 'Звук', 'я'.repeat(900)).bodyInUrl).toBe(true)
    expect(issueUrl(REPO, 'Звук', 'я'.repeat(1000)).bodyInUrl).toBe(false)
    // As plain text both would have fitted many times over.
    expect('я'.repeat(1000).length).toBeLessThan(ISSUE_URL_MAX / 2)
  })
})

describe('issueNumber: what the coordinator pastes when the issue is filed', () => {
  it('reads a number, with or without #, and with space around it', () => {
    expect(issueNumber(REPO, '94')).toBe(94)
    expect(issueNumber(REPO, '#94')).toBe(94)
    expect(issueNumber(REPO, '  #1203 \n')).toBe(1203)
  })

  it('reads the address of an issue of this repository, whatever follows the number', () => {
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado/issues/94')).toBe(94)
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado/issues/94#issuecomment-123')).toBe(94)
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado/issues/94?notification_referrer_id=x')).toBe(94)
    expect(issueNumber(REPO, 'https://github.com/Wordado/Wordado/issues/94/')).toBe(94)
    expect(issueNumber(REPO, 'github.com/wordado/wordado/issues/94')).toBe(94)
  })

  it('reads nothing else: another repository, another site, a pull request, a number that is none', () => {
    expect(issueNumber(REPO, 'https://github.com/someone/else/issues/94')).toBeNull()
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado-content/issues/94')).toBeNull()
    expect(issueNumber(REPO, 'https://example.com/wordado/wordado/issues/94')).toBeNull()
    expect(issueNumber(REPO, 'https://github.com.example.com/wordado/wordado/issues/94')).toBeNull()
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado/pull/94')).toBeNull()
    expect(issueNumber(REPO, 'https://github.com/wordado/wordado/issues/new')).toBeNull()
    for (const typed of ['', '0', '#0', '-4', '9.5', '94 95', 'issue 94', '99999999999', '#'] as const) expect(issueNumber(REPO, typed)).toBeNull()
    // With no repository set, only a bare number can be read.
    expect(issueNumber('', '94')).toBe(94)
    expect(issueNumber('', 'https://github.com//issues/94')).toBeNull()
  })
})
