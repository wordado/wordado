import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ITEM_SETTLE_MS, StudyRun, type RunOptions } from '@wordado/client-data'
import { Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUTO_CONTINUE_KEY, AUTO_CONTINUE_MS } from './autoContinue'
import type { AudioPort } from '../content/audio'
import { ClipSuperseded } from '../content/audio'
import { fakeAudio, renderWith, setup } from '../test/fixtures'
import { RunView } from './RunView'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.localStorage.clear()
})

async function start(mode: RunOptions['mode'], audio: AudioPort = fakeAudio()) {
  const ctx = await setup({ audio })
  const run = await StudyRun.start(ctx.client, ctx.env, {
    kind: 'session',
    mode,
    cachedClips: () => audio.cachedClips(),
    online: () => audio.streamable(),
  })
  renderWith(<RunView run={run} kind="session" />, ctx)
  return { ...ctx, run }
}

const press = (key: string) => act(async () => void fireEvent.keyDown(document.body, { key }))

/** Opens the card's ⋯ menu, where setting aside and reporting live. */
const more = () => fireEvent.click(screen.getByRole('button', { name: 'More' }))

/** The option buttons. Their digit hints are aria-hidden, so a screen reader hears only the option itself. */
const options = () => [...document.querySelectorAll<HTMLButtonElement>('button.option')]

/** A promise this test can settle from outside, for deterministic synchronization without timers. */
function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('RunView: multiple choice', () => {
  it('answers with a digit, marks the answer by icon and words, and continues with Enter', async () => {
    const { run, env } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    expect(options()).toHaveLength(4)
    env.advance(ITEM_SETTLE_MS)
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('status').textContent).toContain('Correct')
    expect(document.querySelector('.is-answer')?.textContent).toContain('✓')
    // No Continue after a right answer: the feedback itself takes focus, so Enter still reaches the page.
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(document.activeElement?.classList.contains('feedback-sheet')).toBe(true)
    env.advance(ITEM_SETTLE_MS)
    await press('Enter')
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('names the right answer after a wrong one', async () => {
    const { run, env } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const wrong = (item.answerIndex + 1) % item.options.length
    env.advance(ITEM_SETTLE_MS)
    await act(async () => fireEvent.click(options()[wrong]!))
    expect(screen.getByRole('status').textContent).toMatch(/^✗ Not quite\. The answer is .+\.$/)
    expect(document.querySelector('.is-wrong')?.textContent).toContain('✗')
    expect(document.activeElement?.textContent).toBe('Continue')
  })

  it('records one answer for a double press', async () => {
    const { run, env } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await act(async () => {
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
    })
    expect(run.snapshot.answered).toBe(1)
  })

  it('ignores a held key (a synthetic repeat), even for a fresh item', async () => {
    const { run, env } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await act(async () => void fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1), repeat: true }))
    expect(run.snapshot.answered).toBe(0)
    expect(run.snapshot.phase).toBe('prompt')
  })

  it('moves focus to each new prompt', async () => {
    const { run, env } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await press(String(item.answerIndex + 1))
    env.advance(ITEM_SETTLE_MS)
    await press('Enter')
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })
})

/** Answers and moves on, by the run itself, until the question on screen has the wanted direction. */
async function reach(run: StudyRun, env: { advance(ms: number): void }, direction: 'en_to_l1' | 'l1_to_en') {
  for (let i = 0; i < 30; i += 1) {
    const item = run.snapshot.item
    if (!item || item.mode === 'flashcard') throw new Error('expected a choice item')
    if (item.direction === direction) return item
    env.advance(ITEM_SETTLE_MS)
    await act(async () => run.choose(item.answerIndex))
    env.advance(ITEM_SETTLE_MS)
    await act(async () => run.next())
  }
  throw new Error(`no ${direction} question came`)
}

describe('RunView: a right answer moves on by itself (spec §8.1)', () => {
  /** A question on screen, the clock past its settle time, and the timers in the test's hands. */
  async function question(mode: RunOptions['mode'] = 'multiple_choice', audio?: AudioPort) {
    const ctx = await start(mode, audio)
    const item = ctx.run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    ctx.env.advance(ITEM_SETTLE_MS)
    return { ...ctx, item, next: vi.spyOn(ctx.run, 'next') }
  }
  const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

  it('shows the green line with no Continue, then the next question, having recorded the answer once', async () => {
    const { run, env, item, next } = await question()
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('status').textContent).toBe('✓ Correct')
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    expect(run.snapshot.answered).toBe(1)
    env.advance(AUTO_CONTINUE_MS)
    await wait(AUTO_CONTINUE_MS - 1)
    expect(run.snapshot.phase).toBe('feedback')
    await wait(1)
    expect(next).toHaveBeenCalledTimes(1)
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
    expect(run.snapshot.answered).toBe(1)
    // The new prompt takes focus, as it does after Continue.
    expect(document.activeElement?.classList.contains('card')).toBe(true)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('moves on once when Enter comes before the timer', async () => {
    const { run, env, item, next } = await question()
    await press(String(item.answerIndex + 1))
    env.advance(ITEM_SETTLE_MS)
    await press('Enter')
    const second = run.snapshot.item
    expect(second?.wordId).not.toBe(item.wordId)
    env.advance(AUTO_CONTINUE_MS)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).toHaveBeenCalledTimes(1)
    expect(run.snapshot.item).toBe(second)
    expect(run.snapshot.phase).toBe('prompt')
  })

  it('moves on at once at a tap on the feedback', async () => {
    const { run, env, item, next } = await question()
    await press(String(item.answerIndex + 1))
    env.advance(ITEM_SETTLE_MS)
    await act(async () => fireEvent.click(screen.getByRole('status')))
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).toHaveBeenCalledTimes(1)
  })

  it('does not move on after the learner has left the screen', async () => {
    const { item, next } = await question()
    await press(String(item.answerIndex + 1))
    cleanup()
    vi.advanceTimersByTime(10 * AUTO_CONTINUE_MS)
    expect(next).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps Continue after a wrong answer, however long the learner reads', async () => {
    const { run, env, item, next } = await question()
    await press(String(((item.answerIndex + 1) % item.options.length) + 1))
    expect(document.activeElement?.textContent).toBe('Continue')
    env.advance(10 * AUTO_CONTINUE_MS)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).not.toHaveBeenCalled()
    expect(run.snapshot.phase).toBe('feedback')
    // A tap on the feedback is not Continue there.
    await act(async () => fireEvent.click(screen.getByRole('status')))
    expect(run.snapshot.phase).toBe('feedback')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(run.snapshot.phase).toBe('prompt')
  })

  it('moves on after a right answer to a listening question too', async () => {
    const { run, env, item } = await question('listening_select', fakeAudio({ streamable: () => true }))
    await press(String(item.answerIndex + 1))
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull()
    env.advance(AUTO_CONTINUE_MS)
    await wait(AUTO_CONTINUE_MS)
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('waits for Continue once the learner opens the ⋯ menu, so a report is about the word they answered', async () => {
    const { run, env, item, next } = await question()
    await press(String(item.answerIndex + 1))
    more()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeTruthy()
    env.advance(10 * AUTO_CONTINUE_MS)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).not.toHaveBeenCalled()
    expect(run.snapshot.item?.wordId).toBe(item.wordId)
  })

  it('switched off on this device, waits for Continue as before', async () => {
    window.localStorage.setItem(AUTO_CONTINUE_KEY, 'off')
    const { run, env, item, next } = await question()
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('status').textContent).toBe('✓ Correct')
    expect(document.activeElement?.textContent).toBe('Continue')
    env.advance(10 * AUTO_CONTINUE_MS)
    await wait(10 * AUTO_CONTINUE_MS)
    expect(next).not.toHaveBeenCalled()
    await act(async () => fireEvent.click(screen.getByRole('status')))
    expect(run.snapshot.phase).toBe('feedback')
    await press('Enter')
    expect(run.snapshot.phase).toBe('prompt')
  })
})

describe('RunView: the multiple-choice listen button', () => {
  it('plays the English word beside the headword, without answering; the translations are stacked', async () => {
    const audio = fakeAudio({ streamable: () => true })
    const { run, env } = await start('multiple_choice', audio)
    const item = await reach(run, env, 'en_to_l1')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play the word' })))
    expect(audio.played).toHaveLength(1)
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item).toBe(item)
    expect(document.querySelectorAll('button.option .translation.is-stacked')).toHaveLength(4)
  })

  it('is not offered when the audio cannot play', async () => {
    const { run, env } = await start('multiple_choice')
    await reach(run, env, 'en_to_l1')
    expect(screen.queryByRole('button', { name: 'Play the word' })).toBeNull()
  })

  it('is never offered, and nothing is played, when the translation is shown: before the answer or after it', async () => {
    const audio = fakeAudio({ streamable: () => true })
    const { run, env } = await start('multiple_choice', audio)
    const item = await reach(run, env, 'l1_to_en')
    expect(document.querySelector('.prompt-text .translation.is-stacked')).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Play the word' })).toBeNull()
    env.advance(ITEM_SETTLE_MS)
    await press(String(((item.answerIndex + 1) % item.options.length) + 1))
    expect(run.snapshot.phase).toBe('feedback')
    expect(screen.queryByRole('button', { name: 'Play the word' })).toBeNull()
    expect(audio.played).toHaveLength(0)
  })
})

describe('RunView: flashcards', () => {
  it('reveals with Space and passes the self-rating through', async () => {
    const { run, client, env } = await start('flashcard')
    const item = run.snapshot.item!
    expect(screen.queryByRole('group', { name: 'How well did you know it?' })).toBeNull()
    env.advance(ITEM_SETTLE_MS)
    await press(' ')
    expect(screen.getByText(item.entry.translations[0]!)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'How well did you know it?' })).toBeTruthy()
    env.advance(ITEM_SETTLE_MS)
    await press('4')
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Easy)
    expect(run.snapshot.answered).toBe(1)
  })

  it('moves focus to the revealed answer, since the button that had it just unmounted', async () => {
    const { run, env } = await start('flashcard')
    const item = run.snapshot.item!
    env.advance(ITEM_SETTLE_MS)
    await press(' ')
    const region = screen.getByRole('region', { name: item.entry.translations[0]! })
    expect(document.activeElement).toBe(region)
  })
})

describe('RunView: the flashcard play button', () => {
  it('plays the word on the card when its audio can play', async () => {
    const audio = fakeAudio({ streamable: () => true })
    const { run } = await start('flashcard', audio)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play the word' })))
    expect(audio.played.map((clip) => clip.clipId)).toHaveLength(1)
    expect(run.snapshot.phase).toBe('prompt')
  })

  it('is not offered when the audio cannot play', async () => {
    await start('flashcard')
    expect(screen.queryByRole('button', { name: 'Play the word' })).toBeNull()
  })
})

describe('RunView: the top bar', () => {
  it('shows progress as a bar and a count, and names it for a screen reader', async () => {
    const { env } = await start('flashcard')
    const bar = screen.getByRole('progressbar', { name: 'Session progress' })
    expect(bar.getAttribute('aria-valuenow')).toBe('0')
    expect(bar.getAttribute('aria-valuetext')).toBe('0 done, 10 to go')
    env.advance(ITEM_SETTLE_MS)
    await press(' ')
    env.advance(ITEM_SETTLE_MS)
    await press('3')
    expect(bar.getAttribute('aria-valuenow')).toBe('1')
    expect(document.querySelector('.study-count')?.textContent).toBe('1 / 10')
  })

  it('keeps setting aside and reporting in the ⋯ menu', async () => {
    await start('flashcard')
    expect(screen.queryByRole('button', { name: 'Report a problem' })).toBeNull()
    more()
    expect(screen.getByRole('button', { name: 'I know this word' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Not now' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Report a problem' })).toBeTruthy()
  })
})

describe('RunView: listening', () => {
  it('plays the word and offers to play it again', async () => {
    const audio = fakeAudio({ streamable: () => true })
    const { run } = await start('listening_select', audio)
    expect(run.snapshot.item?.mode).toBe('listening_select')
    await waitFor(() => expect(audio.played).toHaveLength(1))
    expect(screen.getByText('Which word did you hear?')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play again' })).toBeTruthy()
  })

  it('still lets the learner answer when the audio fails', async () => {
    const audio = fakeAudio({
      streamable: () => true,
      play: async () => {
        throw new Error('no decoder')
      },
    })
    const { run, env } = await start('listening_select', audio)
    await screen.findByText('The audio didn’t play. You can still answer.')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await press(String(item.answerIndex + 1))
    expect(run.snapshot.answered).toBe(1)
  })

  it('counts latency from when the clip ends, not from the prompt (spec §7.3)', async () => {
    const clipEnd = deferred<void>()
    const played: unknown[] = []
    const audio = fakeAudio({
      streamable: () => true,
      play: async (clip) => {
        played.push(clip)
        await clipEnd.promise
      },
    })
    const { run, env, client } = await start('listening_select', audio)
    await waitFor(() => expect(played).toHaveLength(1))
    env.advance(3_000) // the clip is still "playing"; this time must not count as thinking time
    await act(async () => clipEnd.resolve())
    env.advance(1_500) // the learner's actual latency, counted from the clip's end
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const answer = vi.spyOn(client, 'answer')
    await press(String(item.answerIndex + 1))
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ latencyMs: 1_500 }))
  })

  it('shows no failure when a mid-clip "Play again" supersedes the first play', async () => {
    const first = deferred<void>()
    let calls = 0
    const audio = fakeAudio({
      streamable: () => true,
      play: async () => {
        calls += 1
        return calls === 1 ? first.promise : undefined
      },
    })
    await start('listening_select', audio)
    await waitFor(() => expect(calls).toBe(1))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Play again' })))
    await waitFor(() => expect(calls).toBe(2))
    // The real AudioStore rejects an old, still-pending play like this once a new one starts.
    await act(async () => first.reject(new ClipSuperseded()))
    expect(screen.queryByText('The audio didn’t play. You can still answer.')).toBeNull()
  })

  it('ignores a stale play that ends after the learner has moved to the next item', async () => {
    const firstEnd = deferred<void>()
    const secondEnd = deferred<void>()
    let calls = 0
    const audio = fakeAudio({
      streamable: () => true,
      play: async () => {
        calls += 1
        return calls === 1 ? firstEnd.promise : secondEnd.promise
      },
    })
    const { run, env, client } = await start('listening_select', audio)
    const firstItem = run.snapshot.item!
    if (firstItem.mode === 'flashcard') throw new Error('expected a choice item')
    env.advance(ITEM_SETTLE_MS)
    await press(String(firstItem.answerIndex + 1)) // answered without its own clip ever ending
    env.advance(ITEM_SETTLE_MS)
    await press('Enter')
    const secondItem = run.snapshot.item!
    if (secondItem.mode === 'flashcard') throw new Error('expected a choice item')
    await waitFor(() => expect(calls).toBe(2))
    env.advance(5_000) // the second item's own clip is still "playing"
    await act(async () => firstEnd.resolve()) // the stale first clip finally ends; must not present the second item
    const answer = vi.spyOn(client, 'answer')
    await press(String(secondItem.answerIndex + 1))
    expect(answer).toHaveBeenCalledWith(expect.objectContaining({ wordId: secondItem.wordId, latencyMs: 5_000 }))
  })
})

describe('RunView: the end of a run', () => {
  it('stops on request and says what was done', async () => {
    const { run, env } = await start('flashcard')
    env.advance(ITEM_SETTLE_MS)
    await press(' ')
    env.advance(ITEM_SETTLE_MS)
    await press('3')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(run.snapshot.phase).toBe('done')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Session complete')
    expect(screen.getByText('You answered 1 word.')).toBeTruthy()
    expect(screen.getByText('Today counts toward your streak.')).toBeTruthy()
    expect(screen.getByText('New unit open: People and greetings')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to today' }).getAttribute('href')).toBe('/')
    // Back to today is the main action, Practise more the second.
    const links = [...document.querySelectorAll('.done-actions a')].map((a) => [a.textContent, a.classList.contains('primary')])
    expect(links).toEqual([
      ['Back to today', true],
      ['Practise more', false],
    ])
  })
})

describe('RunView: the above-level marker', () => {
  it('is absent when the item is at the learner’s declared level (the sample is all A1)', async () => {
    await start('flashcard')
    expect(document.querySelector('.above-level')).toBeNull()
    expect(document.querySelector('.card-labels')).toBeNull()
  })
})

describe('RunView: "New to you" (spec §7.4)', () => {
  const practise = async (ctx: Awaited<ReturnType<typeof setup>>, scope?: { kind: 'unit' | 'theme'; id: string }) => {
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'practice', mode: 'flashcard', ...(scope && { scope }), cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="practice" />, ctx)
    return run
  }

  it('labels a practised word that was never started, in a theme and in a unit of a skipped level, before and after the answer', async () => {
    const ctx = await setup()
    await practise(ctx, { kind: 'theme', id: 'daily-life' })
    const label = screen.getByText('New to you')
    expect(label.className).toBe('note new-to-you')
    // On the card, before the word.
    expect(label.closest('.card')).toBeTruthy()
    expect(label.compareDocumentPosition(document.querySelector('.card [lang="en"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    ctx.env.advance(ITEM_SETTLE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.getByText('New to you')).toBeTruthy()
    cleanup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    await practise(ctx, { kind: 'unit', id: ctx.client.snapshot.corpus!.units[0]!.unitId })
    expect(screen.getByText('New to you')).toBeTruthy()
  })

  it('shows beside "Above your level" when the word is both', async () => {
    const ctx = await setup()
    // The theme's words as a later pack might level them: above the learner's A1.
    // One widened snapshot per snapshot: the store must answer the same object until it changes.
    const get = ctx.client.store.get
    const levelled = new WeakMap<object, ReturnType<typeof get>>()
    ctx.client.store.get = () => {
      const snapshot = get()
      const corpus = snapshot.corpus!
      if (!levelled.has(snapshot)) {
        const entries = new Map([...corpus.entries].map(([id, e]) => [id, e.themes.includes('daily-life') ? { ...e, level: 'B1' as const } : e]))
        levelled.set(snapshot, { ...snapshot, corpus: { ...corpus, entries } })
      }
      return levelled.get(snapshot)!
    }
    await practise(ctx, { kind: 'theme', id: 'daily-life' })
    const labels = document.querySelector('.card-labels')!
    expect([...labels.children].map((el) => el.textContent)).toEqual(['New to you', 'Above your level (B1)'])
  })

  it('is absent on a started word in practice, and on a new word in a session', async () => {
    const ctx = await setup()
    await ctx.client.answer({ wordId: ctx.client.snapshot.plan!.newWords[0]!, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    ctx.env.advance(3_600_000)
    await practise(ctx)
    expect(screen.getByRole('button', { name: 'Show answer' })).toBeTruthy()
    expect(screen.queryByText('New to you')).toBeNull()
    cleanup()
    // A session's new word is new too, but that is what a session is for.
    await start('flashcard')
    expect(screen.queryByText('New to you')).toBeNull()
  })

  it('speaks every interface language', async () => {
    for (const [locale, text] of [['bg', 'Нова за вас'], ['de', 'Neu für dich'], ['es', 'Nueva para ti']] as const) {
      const ctx = await setup()
      const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'practice', mode: 'flashcard', scope: { kind: 'theme', id: 'daily-life' }, cachedClips: () => new Set(), online: () => false })
      renderWith(<RunView run={run} kind="practice" />, { ...ctx, locale })
      expect(screen.getByText(text)).toBeTruthy()
      cleanup()
    }
  })
})

describe('RunView: reporting a problem', () => {
  it('files a report for the word on the card, keys do not answer while the dialog is open, and focus lands on Continue', async () => {
    const { run, client } = await start('flashcard')
    const report = vi.spyOn(client, 'report')
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await press(' ')
    expect(run.snapshot.phase).toBe('prompt')
    // The dialog says what checked the translations (spec §8.10), until the report is sent.
    expect(screen.getByText('Translations are checked by AI. Tell us what looks wrong.')).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Bad audio' })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Details (optional)' }), { target: { value: 'Too quiet' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send report' })))
    expect(report).toHaveBeenCalledWith({ wordId: run.snapshot.item!.wordId, field: 'audio', note: 'Too quiet', packVersion: 0 })
    expect(screen.getByText('Report saved. Thank you.')).toBeTruthy()
    expect(screen.queryByText('Translations are checked by AI. Tell us what looks wrong.')).toBeNull()
    expect(document.activeElement?.textContent).toBe('Continue')
  })

  it('returns focus to the card when the dialog is cancelled', async () => {
    await start('flashcard')
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    const cancel = screen.getByRole('button', { name: 'Cancel' })
    cancel.focus()
    expect(document.activeElement).toBe(cancel)
    await act(async () => fireEvent.click(cancel))
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })

  it('a double click on Send files exactly one report', async () => {
    const { client } = await start('flashcard')
    const report = vi.spyOn(client, 'report')
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
      fireEvent.click(screen.getByRole('button', { name: 'Send report' }))
    })
    expect(report).toHaveBeenCalledTimes(1)
  })

  it('shows the error, and lets the learner try again, when the report fails to save', async () => {
    const { client } = await start('flashcard')
    vi.spyOn(client, 'report').mockRejectedValueOnce(new Error('offline'))
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send report' })))
    expect(screen.getByRole('alert').textContent).toBe('Your answer wasn’t saved: Something went wrong. Try again.')
    expect((screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement).disabled).toBe(false)
  })
})

describe('setting a word aside (spec §7.4)', () => {
  it('flags the word on the card, records no answer, and shows the next word', async () => {
    const ctx = await setup()
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'session', mode: 'flashcard', cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="session" />, ctx)
    const first = run.snapshot.item!.entry.headword
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'I know this word' })))
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('0')
    expect(document.querySelector('.hw-word')?.textContent).not.toBe(first)
    expect([...ctx.client.snapshot.flags.values()]).toEqual(['known'])
  })

  it('says how many words were set aside when the run ends', async () => {
    const ctx = await setup()
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'session', mode: 'flashcard', cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="session" />, ctx)
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(screen.getByText('1 word set aside. You can bring it back in settings.')).toBeTruthy()
  })
})

describe('Learn this word (spec §7.4)', () => {
  async function practiseSkipped(mode: RunOptions['mode']) {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    const unit = ctx.client.snapshot.corpus!.units[0]!
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'practice', mode, scope: { kind: 'unit', id: unit.unitId }, cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="practice" />, ctx)
    return { ...ctx, run }
  }

  it('offers it on the feedback after an answer, named with the word; pressed it reads Will be learned, and can be switched off', async () => {
    const { run, env, client } = await practiseSkipped('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const word = item.entry.headword
    // Not before the answer: the prompt is for answering.
    expect(screen.queryByRole('button', { name: `Learn this word: ${word}` })).toBeNull()
    env.advance(ITEM_SETTLE_MS)
    await press(String(((item.answerIndex + 1) % 4) + 1))
    const off = screen.getByRole('button', { name: `Learn this word: ${word}` })
    expect(off.textContent).toBe('Learn this word')
    // The state is said by the name alone: not by aria-pressed as well.
    expect(off.hasAttribute('aria-pressed')).toBe(false)
    expect(document.activeElement?.textContent).toBe('Continue')
    await act(async () => fireEvent.click(off))
    const on = screen.getByRole('button', { name: `Will be learned: ${word}` })
    expect(on.textContent).toBe('Will be learned')
    expect(on.hasAttribute('aria-pressed')).toBe(false)
    expect(screen.queryByRole('button', { name: `Learn this word: ${word}` })).toBeNull()
    expect(client.snapshot.toLearn).toEqual([item.wordId])
    expect(client.snapshot.plan!.newWords).toEqual([item.wordId])
    expect(client.snapshot.states.size).toBe(0)
    await act(async () => fireEvent.click(on))
    expect(screen.getByRole('button', { name: `Learn this word: ${word}` })).toBeTruthy()
    expect(client.snapshot.toLearn).toEqual([])
    // The run goes on as it was.
    env.advance(ITEM_SETTLE_MS)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Continue' })))
    expect(run.snapshot.phase).toBe('prompt')
    expect(screen.queryByRole('button', { name: /^Learn this word/ })).toBeNull()
  })

  it('keeps Continue after a right answer too, while the word is offered: there is something to press', async () => {
    const { run, env } = await practiseSkipped('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    env.advance(ITEM_SETTLE_MS)
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('button', { name: `Learn this word: ${item.entry.headword}` })).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Continue')
    env.advance(10 * AUTO_CONTINUE_MS)
    await act(async () => void vi.advanceTimersByTime(10 * AUTO_CONTINUE_MS))
    expect(run.snapshot.item?.wordId).toBe(item.wordId)
  })

  it('offers it on a flashcard once the answer is shown, and the done screen says how many words were added', async () => {
    const { run, env, client } = await practiseSkipped('flashcard')
    const chosen: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const item = run.snapshot.item!
      expect(screen.queryByRole('button', { name: /^Learn this word/ })).toBeNull()
      env.advance(ITEM_SETTLE_MS)
      fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
      if (i < 2) {
        env.advance(1_000)
        await act(async () => fireEvent.click(screen.getByRole('button', { name: `Learn this word: ${item.entry.headword}` })))
        expect(screen.getByRole('button', { name: `Will be learned: ${item.entry.headword}` })).toBeTruthy()
        chosen.push(item.wordId)
      }
      env.advance(ITEM_SETTLE_MS)
      await act(async () => fireEvent.click(screen.getByRole('button', { name: /Hard/ })))
    }
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Practice complete')
    expect(screen.getByText('2 words will come up in your next sessions.')).toBeTruthy()
    expect(client.snapshot.toLearn).toEqual(chosen)
    expect(client.snapshot.plan!.newWords).toEqual(chosen)
  })

  it('counts a word marked before the run among the run’s words to learn, and not once it is set aside', async () => {
    const ctx = await setup()
    await ctx.client.updateSettings({ declaredLevel: 'A2' })
    const unit = ctx.client.snapshot.corpus!.units[0]!
    for (const wordId of unit.wordIds) await ctx.client.setToLearn(wordId, true)
    const run = await StudyRun.start(ctx.client, ctx.env, { kind: 'practice', mode: 'flashcard', scope: { kind: 'unit', id: unit.unitId }, cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={run} kind="practice" />, ctx)
    more()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Not now' })))
    ctx.env.advance(ITEM_SETTLE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.getByRole('button', { name: /^Will be learned: / })).toBeTruthy()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(screen.getByText('1 word will come up in your next sessions.')).toBeTruthy()
    expect(ctx.client.snapshot.toLearn).toHaveLength(19)
  })

  it('says one word in the singular, and nothing when none was added', async () => {
    const { run, env } = await practiseSkipped('flashcard')
    env.advance(ITEM_SETTLE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /^Learn this word/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(screen.getByText('1 word will come up in your next sessions.')).toBeTruthy()
    cleanup()
    const again = await practiseSkipped('flashcard')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(again.run.snapshot.toLearn).toBe(0)
    expect(screen.queryByText(/will come up in your next sessions/)).toBeNull()
    expect(run.snapshot.toLearn).toBe(1)
  })

  it('is not offered in a session, or in practice of a word that is already started', async () => {
    const { run, env } = await start('flashcard')
    env.advance(ITEM_SETTLE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.queryByRole('button', { name: /^Learn this word/ })).toBeNull()
    env.advance(ITEM_SETTLE_MS)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: /Good/ })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    cleanup()
    const ctx = await setup()
    await ctx.client.answer({ wordId: ctx.client.snapshot.plan!.newWords[0]!, mode: 'flashcard', direction: 'en_to_l1', grade: Grade.Good, latencyMs: 2_000, practice: false })
    ctx.env.advance(3_600_000)
    const practice = await StudyRun.start(ctx.client, ctx.env, { kind: 'practice', mode: 'flashcard', cachedClips: () => new Set(), online: () => false })
    renderWith(<RunView run={practice} kind="practice" />, ctx)
    ctx.env.advance(ITEM_SETTLE_MS)
    fireEvent.click(screen.getByRole('button', { name: 'Show answer' }))
    expect(screen.getByRole('group', { name: /./ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Learn this word/ })).toBeNull()
    expect(run.snapshot.toLearn).toBe(0)
  })
})
