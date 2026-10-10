import { beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import { FeedbackUnread, feedbackSource, readFeedback } from './learnerApp'
import { FakeLearnerApp, feedbackItem } from './test/fakeLearnerApp'

const TOKEN = 't'.repeat(40)
const source = { url: 'https://app.test/', token: TOKEN }

let server: FakeLearnerApp
let logged: string[]
/** What `fetch` was called with, beside what the fake records. */
let calls: { url: string; init: RequestInit }[]

beforeEach(() => {
  server = new FakeLearnerApp(TOKEN, [feedbackItem(1, { receivedAt: 1000 }), feedbackItem(2, { receivedAt: 2000, kind: 'idea' }), feedbackItem(3, { receivedAt: 3000 })])
  logged = []
  calls = []
})
const deps = () => ({
  fetch: (url: string, init: RequestInit = {}) => (calls.push({ url, init }), server.fetch(url, init)),
  log: (line: string) => void logged.push(line),
})

describe('feedbackSource', () => {
  const env = (over: Partial<Env>) => ({ env: over as Env })
  it('is null while either setting is empty', () => {
    expect(feedbackSource(env({}))).toBeNull()
    expect(feedbackSource(env({ LEARNER_APP_URL: 'https://app.test', FEEDBACK_READ_TOKEN: ' ' }))).toBeNull()
    expect(feedbackSource(env({ LEARNER_APP_URL: '', FEEDBACK_READ_TOKEN: TOKEN }))).toBeNull()
    expect(feedbackSource(env({ LEARNER_APP_URL: ' https://app.test ', FEEDBACK_READ_TOKEN: TOKEN }))).toEqual({ url: 'https://app.test', token: TOKEN })
  })
})

describe('readFeedback', () => {
  it('asks for the messages since a moment, with the token in a header and not in the address', async () => {
    await readFeedback(deps(), source, { limit: 100, since: 1234 })
    expect(server.requests).toEqual(['GET /v1/admin/feedback?limit=100&since=1234'])
    expect(calls[0]!.url).not.toContain(TOKEN)
    expect(new Headers(calls[0]!.init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(calls[0]!.init.redirect).toBe('manual')
  })

  it('puts the query in one order: limit, kind, before, since', async () => {
    await readFeedback(deps(), source, { limit: 50, kind: 'idea', before: 9 })
    await readFeedback(deps(), source, { limit: 50, kind: 'idea', before: 9, since: 5 })
    await readFeedback(deps(), source, { limit: 50, kind: null, before: null, since: null })
    expect(server.requests).toEqual(['GET /v1/admin/feedback?limit=50&kind=idea&before=9', 'GET /v1/admin/feedback?limit=50&kind=idea&before=9&since=5', 'GET /v1/admin/feedback?limit=50'])
  })

  it('gets only what was received at or after `since` (the fake filters as the server does)', async () => {
    const page = await readFeedback(deps(), source, { limit: 100, since: 2000 })
    expect(page.items.map((item) => item.id)).toEqual([3, 2])
    expect(page.nextBefore).toBeNull()
  })

  it('says the feedback was not read, and logs the status only', async () => {
    server.failure = { status: 500, body: 'a body that must not be logged' }
    await expect(readFeedback(deps(), source, { limit: 100 })).rejects.toBeInstanceOf(FeedbackUnread)
    expect(logged).toEqual(['feedback: the app\'s server answered 500'])
  })
})
