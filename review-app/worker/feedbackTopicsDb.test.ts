import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Env } from './bindings'
import {
  claimIssuesRead,
  dropFeedbackAi,
  feedbackAiRows,
  feedbackMarks,
  forgetFeedbackAi,
  getTopic,
  insertReviewer,
  insertTopicsIfAbsent,
  listTopics,
  markTopicMessagesDone,
  mergeTopics,
  moveFeedbackToTopic,
  openIssues,
  proposeTopicIssues,
  putFeedbackAi,
  putFeedbackMark,
  putTopic,
  replaceOpenIssues,
  setTopicIssue,
  settleIssuesRead,
  topicFeedbackIds,
  topicTitles,
  type FeedbackAiRow,
} from './db'
import { resetDb, startPlatform } from './test/platform'

const ADMIN = 'admin@example.com'
const AT = '2026-10-05T12:00:00.000Z'
const LATER = '2026-10-06T12:00:00.000Z'

let base: Env
let dispose: () => Promise<void>

beforeAll(async () => {
  const p = await startPlatform()
  base = p.env
  dispose = p.dispose
})
afterAll(() => dispose())
beforeEach(async () => {
  await resetDb(base.DB)
  await insertReviewer(base.DB, { email: ADMIN, name: 'Coordinator', languages: ['bg'], role: 'admin', invitedAt: 't', inviteSentAt: null, disabledAt: null })
})

const row = (over: Partial<FeedbackAiRow> = {}): FeedbackAiRow => ({ receivedAt: 1000, language: 'en', translation: '', category: 'bug', severity: 'annoys', summary: 'In short.', model: 'test/model', promptVersion: 2, createdAt: AT, ...over })
/** Makes the topics of these titles and gives their ids, in the order asked. */
async function topics(...titles: string[]): Promise<number[]> {
  const made = await insertTopicsIfAbsent(base.DB, titles, AT)
  return titles.map((title) => made.get(title)!)
}
const topicOf = async (feedbackId: number) => (await feedbackAiRows(base.DB, [feedbackId])).get(feedbackId)
const raw = async (id: number) => base.DB.prepare('SELECT * FROM feedback_topics WHERE id = ?').bind(id).first<Record<string, unknown>>()

describe('topics (spec 2026-10-10 §3.2)', () => {
  it('makes a topic for a new title, and none for a title that differs only in case', async () => {
    const made = await insertTopicsIfAbsent(base.DB, ['Sound plays twice on phones', 'sound plays TWICE on phones', 'Choose the number of new words'], AT)
    expect(made.get('Sound plays twice on phones')).toBe(made.get('sound plays TWICE on phones'))
    expect(made.get('Choose the number of new words')).not.toBe(made.get('Sound plays twice on phones'))
    const again = await insertTopicsIfAbsent(base.DB, ['SOUND PLAYS TWICE ON PHONES'], LATER)
    expect(again.get('SOUND PLAYS TWICE ON PHONES')).toBe(made.get('Sound plays twice on phones'))
    expect((await base.DB.prepare('SELECT title, state, note, issue, issue_state, renamed, created_at, updated_by FROM feedback_topics ORDER BY id').all()).results).toEqual([
      { title: 'Sound plays twice on phones', state: 'new', note: '', issue: null, issue_state: 'none', renamed: 0, created_at: AT, updated_by: null },
      { title: 'Choose the number of new words', state: 'new', note: '', issue: null, issue_state: 'none', renamed: 0, created_at: AT, updated_by: null },
    ])
    expect((await insertTopicsIfAbsent(base.DB, [], AT)).size).toBe(0)
  })

  it('keeps a message’s topic with its reading, and gives its title back', async () => {
    const [sound] = await topics('Sound plays twice')
    await putFeedbackAi(base.DB, new Map([[7, row({ topicId: sound! })], [8, row()]]))
    expect(await topicOf(7)).toMatchObject({ topicId: sound, topicBy: 'ai', topicTitle: 'Sound plays twice', summary: 'In short.' })
    expect(await topicOf(8)).toMatchObject({ topicId: null, topicBy: 'ai', topicTitle: null })
    // A topic that is gone by the time the reading is kept leaves the message with none.
    await putFeedbackAi(base.DB, new Map([[9, row({ topicId: 9999 })]]))
    expect(await topicOf(9)).toMatchObject({ topicId: null, topicTitle: null })
  })

  it('never lets a later reading move a message the coordinator moved', async () => {
    const [sound, words] = await topics('Sound plays twice', 'Number of new words')
    await putFeedbackAi(base.DB, new Map([[7, row({ topicId: sound!, promptVersion: 1 })], [8, row({ topicId: sound! })]]))
    expect(await moveFeedbackToTopic(base.DB, 7, words!)).toBe('ok')
    expect(await topicOf(7)).toMatchObject({ topicId: words, topicBy: 'coordinator' })
    await putFeedbackAi(base.DB, new Map([[7, row({ topicId: sound!, summary: 'Read again.' })], [8, row({ topicId: words!, summary: 'Read again.' })]]))
    // Its other fields are new; its topic is the coordinator's. A message nobody moved follows the new reading.
    expect(await topicOf(7)).toMatchObject({ topicId: words, topicBy: 'coordinator', summary: 'Read again.', promptVersion: 2 })
    expect(await topicOf(8)).toMatchObject({ topicId: words, topicBy: 'ai' })
    await putFeedbackAi(base.DB, new Map([[7, row()]]))
    expect(await topicOf(7)).toMatchObject({ topicId: words, topicBy: 'coordinator' })
  })

  it('moves a message only when it has a reading and the topic exists', async () => {
    const [sound] = await topics('Sound plays twice')
    await putFeedbackAi(base.DB, new Map([[7, row()]]))
    expect(await moveFeedbackToTopic(base.DB, 8, sound!)).toBe('missing')
    expect(await moveFeedbackToTopic(base.DB, 7, 9999)).toBe('missing')
    expect(await topicOf(7)).toMatchObject({ topicId: null, topicBy: 'ai' })
    expect(await moveFeedbackToTopic(base.DB, 7, sound!)).toBe('ok')
  })

  it('lists one line a topic: its count, its newest message and its worst severity, the newest first', async () => {
    const [sound, words, empty] = await topics('Sound plays twice', 'Number of new words', 'Nothing in it')
    await putFeedbackAi(base.DB, new Map([
      [1, row({ topicId: sound!, receivedAt: 1000, severity: 'cosmetic' })],
      [2, row({ topicId: sound!, receivedAt: 3000, severity: 'blocks' })],
      [3, row({ topicId: sound!, receivedAt: 2000, severity: 'annoys' })],
      [4, row({ topicId: words!, receivedAt: 5000, category: 'idea', severity: null })],
      [5, row({ receivedAt: 9000 })],
    ]))
    expect(await listTopics(base.DB)).toEqual([
      { id: words, title: 'Number of new words', state: 'new', note: '', issue: null, issueState: 'none', issueTitle: null, count: 1, newestAt: 5000, worst: null },
      { id: sound, title: 'Sound plays twice', state: 'new', note: '', issue: null, issueState: 'none', issueTitle: null, count: 3, newestAt: 3000, worst: 'blocks' },
    ])
    // A topic with no message is listed once the coordinator has worked on it, last.
    expect(await putTopic(base.DB, empty!, { title: 'Nothing in it', state: 'seen', note: 'Mine.' }, ADMIN, LATER)).toBe('ok')
    expect((await listTopics(base.DB)).map((t) => [t.id, t.count, t.newestAt, t.worst])).toEqual([[words, 1, 5000, null], [sound, 3, 3000, 'blocks'], [empty, 0, null, null]])
    expect(await getTopic(base.DB, sound!)).toMatchObject({ id: sound, count: 3, worst: 'blocks' })
    expect(await getTopic(base.DB, 9999)).toBeNull()
  })

  it('gives the model the titles of the topics used most recently', async () => {
    const [sound, words, empty] = await topics('Sound plays twice', 'Number of new words', 'Nothing in it')
    await putFeedbackAi(base.DB, new Map([[1, row({ topicId: sound!, receivedAt: 3000 })], [4, row({ topicId: words!, receivedAt: 5000 })]]))
    expect(await topicTitles(base.DB, 10)).toEqual([{ id: words, title: 'Number of new words' }, { id: sound, title: 'Sound plays twice' }, { id: empty, title: 'Nothing in it' }])
    expect(await topicTitles(base.DB, 2)).toEqual([{ id: words, title: 'Number of new words' }, { id: sound, title: 'Sound plays twice' }])
  })

  it('renames a topic and keeps its state and note, with who and when; a title another topic has is refused', async () => {
    const [sound, words] = await topics('Sound plays twice', 'Number of new words')
    expect(await putTopic(base.DB, sound!, { title: 'Sound plays twice', state: 'seen', note: 'Asked the developer.' }, ADMIN, LATER)).toBe('ok')
    expect(await raw(sound!)).toMatchObject({ title: 'Sound plays twice', state: 'seen', note: 'Asked the developer.', renamed: 0, updated_at: LATER, updated_by: ADMIN })
    expect(await putTopic(base.DB, sound!, { title: 'The sound is played twice', state: 'seen', note: 'Asked the developer.' }, ADMIN, LATER)).toBe('ok')
    expect(await raw(sound!)).toMatchObject({ title: 'The sound is played twice', renamed: 1 })
    expect(await putTopic(base.DB, sound!, { title: 'number of NEW words', state: 'seen', note: '' }, ADMIN, LATER)).toBe('title-taken')
    expect(await raw(sound!)).toMatchObject({ title: 'The sound is played twice', note: 'Asked the developer.' })
    // Its own title in other letters is a rename, not a clash.
    expect(await putTopic(base.DB, words!, { title: 'Number of New Words', state: 'new', note: '' }, ADMIN, LATER)).toBe('ok')
    expect(await raw(words!)).toMatchObject({ title: 'Number of New Words', renamed: 1 })
    expect(await putTopic(base.DB, 9999, { title: 'No such topic', state: 'new', note: '' }, ADMIN, LATER)).toBe('missing')
  })

  it('merges a topic into another: its messages, its note and its match go over, and it is gone', async () => {
    const [sound, twice, words] = await topics('Sound plays twice', 'Audio repeats', 'Number of new words')
    await putFeedbackAi(base.DB, new Map([[1, row({ topicId: sound! })], [2, row({ topicId: twice! })], [3, row({ topicId: twice! })], [4, row({ topicId: words! })]]))
    await moveFeedbackToTopic(base.DB, 3, twice!)
    await putTopic(base.DB, twice!, { title: 'Audio repeats', state: 'seen', note: 'From the source.' }, ADMIN, AT)
    await setTopicIssue(base.DB, twice!, 94, 'confirmed', ADMIN, AT)
    expect(await mergeTopics(base.DB, twice!, sound!, ADMIN, LATER)).toBe('ok')
    expect(await getTopic(base.DB, twice!)).toBeNull()
    expect(await getTopic(base.DB, sound!)).toMatchObject({ count: 3, note: 'From the source.', issue: 94, issueState: 'confirmed', state: 'new' })
    expect(await raw(sound!)).toMatchObject({ updated_at: LATER, updated_by: ADMIN })
    // Each message keeps who put it in its topic.
    expect(await topicOf(2)).toMatchObject({ topicId: sound, topicBy: 'ai' })
    expect(await topicOf(3)).toMatchObject({ topicId: sound, topicBy: 'coordinator' })
    expect(await topicOf(4)).toMatchObject({ topicId: words })
    // A target with a note and a match of its own keeps its match, and gets the note under its own.
    await putTopic(base.DB, words!, { title: 'Number of new words', state: 'new', note: 'Second note.' }, ADMIN, AT)
    await setTopicIssue(base.DB, words!, 12, 'proposed', null, AT)
    expect(await mergeTopics(base.DB, words!, sound!, ADMIN, LATER)).toBe('ok')
    expect(await getTopic(base.DB, sound!)).toMatchObject({ count: 4, note: 'From the source.\nSecond note.', issue: 94, issueState: 'confirmed' })
    expect(await mergeTopics(base.DB, 9999, sound!, ADMIN, LATER)).toBe('missing')
    expect(await mergeTopics(base.DB, sound!, 9999, ADMIN, LATER)).toBe('missing')
    expect(await mergeTopics(base.DB, sound!, sound!, ADMIN, LATER)).toBe('missing')
    expect(await getTopic(base.DB, sound!)).toMatchObject({ count: 4 })
  })

  it('gives a topic’s messages newest first, a page of them, and how many there are', async () => {
    const [sound] = await topics('Sound plays twice')
    await putFeedbackAi(base.DB, new Map([3, 9, 5, 7].map((id) => [id, row({ topicId: sound! })])))
    await putFeedbackAi(base.DB, new Map([[8, row()]]))
    expect(await topicFeedbackIds(base.DB, sound!, 3)).toEqual({ ids: [9, 7, 5], total: 4 })
    expect(await topicFeedbackIds(base.DB, sound!, 50)).toEqual({ ids: [9, 7, 5, 3], total: 4 })
    expect(await topicFeedbackIds(base.DB, 9999, 50)).toEqual({ ids: [], total: 0 })
  })

  it('marks a topic’s messages done, keeping the note a message has, and no other message', async () => {
    const [sound, words] = await topics('Sound plays twice', 'Number of new words')
    await putFeedbackAi(base.DB, new Map([[1, row({ topicId: sound! })], [2, row({ topicId: sound! })], [3, row({ topicId: words! })]]))
    await putFeedbackMark(base.DB, 2, { state: 'seen', note: 'Mine.', updatedAt: AT, updatedBy: ADMIN })
    await putFeedbackMark(base.DB, 3, { state: 'seen', note: 'Another topic.', updatedAt: AT, updatedBy: ADMIN })
    expect(await markTopicMessagesDone(base.DB, sound!, ADMIN, LATER)).toBe(2)
    const marks = await feedbackMarks(base.DB, [1, 2, 3])
    expect(marks.get(1)).toEqual({ state: 'done', note: '', updatedAt: LATER, updatedBy: ADMIN })
    expect(marks.get(2)).toEqual({ state: 'done', note: 'Mine.', updatedAt: LATER, updatedBy: ADMIN })
    expect(marks.get(3)).toEqual({ state: 'seen', note: 'Another topic.', updatedAt: AT, updatedBy: ADMIN })
  })

  it('drops the readings of some messages by id', async () => {
    await putFeedbackAi(base.DB, new Map([1, 2, 3].map((id) => [id, row()])))
    expect(await dropFeedbackAi(base.DB, [1, 3, 99])).toBe(2)
    expect(await dropFeedbackAi(base.DB, [])).toBe(0)
    expect([...(await feedbackAiRows(base.DB, [1, 2, 3])).keys()]).toEqual([2])
  })

  it('forgets, with the readings, the topics nobody worked on, and keeps the coordinator’s', async () => {
    const [sound, words, typed] = await topics('Sound plays twice', 'Number of new words', 'Typed a number')
    await putFeedbackAi(base.DB, new Map([[1, row({ topicId: sound! })], [2, row({ topicId: words! })], [3, row({ topicId: typed! })]]))
    await putTopic(base.DB, words!, { title: 'Number of new words', state: 'seen', note: '' }, ADMIN, AT)
    await setTopicIssue(base.DB, typed!, 5, 'confirmed', ADMIN, AT)
    await proposeTopicIssues(base.DB, [{ topic: sound!, issue: 94 }])
    expect(await forgetFeedbackAi(base.DB)).toBe(3)
    expect((await base.DB.prepare('SELECT id FROM feedback_topics ORDER BY id').all<{ id: number }>()).results.map((r) => r.id)).toEqual([words, typed])
    expect(await getTopic(base.DB, words!)).toMatchObject({ count: 0, state: 'seen' })
  })
})

describe('a topic’s match with a known issue (spec 2026-10-10 §3.3)', () => {
  it('is proposed by the AI only while the topic has none, and never over the coordinator’s answer', async () => {
    const [none, confirmed, removed] = await topics('No match yet', 'Confirmed by hand', 'Removed by hand')
    await setTopicIssue(base.DB, confirmed!, 7, 'confirmed', ADMIN, AT)
    await setTopicIssue(base.DB, removed!, null, 'removed', ADMIN, AT)
    await proposeTopicIssues(base.DB, [{ topic: none!, issue: 94 }, { topic: confirmed!, issue: 94 }, { topic: removed!, issue: 94 }, { topic: 9999, issue: 94 }])
    expect(await getTopic(base.DB, none!)).toMatchObject({ issue: 94, issueState: 'proposed' })
    expect(await getTopic(base.DB, confirmed!)).toMatchObject({ issue: 7, issueState: 'confirmed' })
    expect(await getTopic(base.DB, removed!)).toMatchObject({ issue: null, issueState: 'removed' })
    // A second proposal does not replace the first, and a proposal is not the coordinator's work.
    await proposeTopicIssues(base.DB, [{ topic: none!, issue: 95 }])
    expect(await getTopic(base.DB, none!)).toMatchObject({ issue: 94, issueState: 'proposed' })
    expect(await raw(none!)).toMatchObject({ updated_by: null })
    await proposeTopicIssues(base.DB, [])
  })

  it('is set by the coordinator, with who and when, and shows the issue’s title while it is known', async () => {
    const [sound] = await topics('Sound plays twice')
    await replaceOpenIssues(base.DB, [{ number: 94, title: 'The sound of a word plays twice on a phone' }], AT)
    expect(await setTopicIssue(base.DB, sound!, 94, 'confirmed', ADMIN, LATER)).toBe(true)
    expect(await getTopic(base.DB, sound!)).toMatchObject({ issue: 94, issueState: 'confirmed', issueTitle: 'The sound of a word plays twice on a phone' })
    expect(await raw(sound!)).toMatchObject({ updated_at: LATER, updated_by: ADMIN })
    expect(await setTopicIssue(base.DB, sound!, 5, 'confirmed', ADMIN, LATER)).toBe(true)
    expect(await getTopic(base.DB, sound!)).toMatchObject({ issue: 5, issueTitle: null })
    expect(await setTopicIssue(base.DB, 9999, 5, 'confirmed', ADMIN, LATER)).toBe(false)
  })
})

describe('the open issues of the app’s repository (spec 2026-10-10 §3.3)', () => {
  it('are replaced by each read, not added to, and given only while the read is not older than asked', async () => {
    await replaceOpenIssues(base.DB, [{ number: 94, title: 'Sound plays twice' }, { number: 12, title: 'Dark theme' }], AT)
    expect(await openIssues(base.DB, AT, 100)).toEqual([{ number: 94, title: 'Sound plays twice' }, { number: 12, title: 'Dark theme' }])
    expect(await openIssues(base.DB, AT, 1)).toEqual([{ number: 94, title: 'Sound plays twice' }])
    expect(await openIssues(base.DB, LATER, 100)).toEqual([])
    // Issue 12 was closed in the meantime.
    await replaceOpenIssues(base.DB, [{ number: 94, title: 'Sound plays twice on phones' }], LATER)
    expect(await openIssues(base.DB, AT, 100)).toEqual([{ number: 94, title: 'Sound plays twice on phones' }])
    await replaceOpenIssues(base.DB, [], LATER)
    expect(await openIssues(base.DB, AT, 100)).toEqual([])
  })

  it('are read once a UTC day at most: the day is taken before the read, whatever comes of it', async () => {
    const noon = new Date('2026-10-05T12:00:00Z')
    expect(await claimIssuesRead(base.DB, noon)).toBe(true)
    expect(await claimIssuesRead(base.DB, new Date('2026-10-05T23:59:00Z'))).toBe(false)
    await settleIssuesRead(base.DB, noon, 'failed')
    expect(await claimIssuesRead(base.DB, new Date('2026-10-05T13:00:00Z'))).toBe(false)
    expect(await claimIssuesRead(base.DB, new Date('2026-10-06T00:00:01Z'))).toBe(true)
    expect((await base.DB.prepare('SELECT day, at, outcome FROM open_issues_reads ORDER BY day').all()).results).toEqual([
      { day: '2026-10-05', at: '2026-10-05T12:00:00.000Z', outcome: 'failed' },
      { day: '2026-10-06', at: '2026-10-06T00:00:01.000Z', outcome: null },
    ])
  })
})
