import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { StudyRun, type RunOptions } from '@wordado/client-data'
import { Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioPort } from '../content/audio'
import { ClipSuperseded } from '../content/audio'
import { fakeAudio, renderWith, setup } from '../test/fixtures'
import { RunView } from './RunView'

afterEach(cleanup)

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
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    expect(options()).toHaveLength(4)
    await press(String(item.answerIndex + 1))
    expect(screen.getByRole('status').textContent).toContain('Correct')
    expect(document.querySelector('.is-answer')?.textContent).toContain('✓')
    expect(document.activeElement?.textContent).toBe('Continue')
    await press('Enter')
    expect(run.snapshot.phase).toBe('prompt')
    expect(run.snapshot.item?.wordId).not.toBe(item.wordId)
  })

  it('names the right answer after a wrong one', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    const wrong = (item.answerIndex + 1) % item.options.length
    await act(async () => fireEvent.click(options()[wrong]!))
    expect(screen.getByRole('status').textContent).toMatch(/^✗ Not quite\. The answer is .+\.$/)
    expect(document.querySelector('.is-wrong')?.textContent).toContain('✗')
  })

  it('records one answer for a double press', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await act(async () => {
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
      fireEvent.keyDown(document.body, { key: String(item.answerIndex + 1) })
    })
    expect(run.snapshot.answered).toBe(1)
  })

  it('moves focus to each new prompt', async () => {
    const { run } = await start('multiple_choice')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
    await press(String(item.answerIndex + 1))
    await press('Enter')
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })
})

describe('RunView: flashcards', () => {
  it('reveals with Space and passes the self-rating through', async () => {
    const { run, client } = await start('flashcard')
    const item = run.snapshot.item!
    expect(screen.queryByRole('group', { name: 'How well did you know it?' })).toBeNull()
    await press(' ')
    expect(screen.getByText(item.entry.translations[0]!)).toBeTruthy()
    expect(screen.getByRole('group', { name: 'How well did you know it?' })).toBeTruthy()
    await press('4')
    expect(client.snapshot.states.get(item.wordId)?.lastGrade).toBe(Grade.Easy)
    expect(run.snapshot.answered).toBe(1)
  })

  it('moves focus to the revealed answer, since the button that had it just unmounted', async () => {
    await start('flashcard')
    await press(' ')
    expect(document.activeElement).toBe(document.querySelector('.revealed'))
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
    const { run } = await start('listening_select', audio)
    await screen.findByText('The audio didn’t play. You can still answer.')
    const item = run.snapshot.item!
    if (item.mode === 'flashcard') throw new Error('expected a choice item')
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
    await press(String(firstItem.answerIndex + 1)) // answered without its own clip ever ending
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
    const { run } = await start('flashcard')
    await press(' ')
    await press('3')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Stop for now' })))
    expect(run.snapshot.phase).toBe('done')
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Session complete')
    expect(screen.getByText('You answered 1 word.')).toBeTruthy()
    expect(screen.getByText('Today counts toward your streak.')).toBeTruthy()
    expect(screen.getByText('New unit open: People and greetings')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Back to today' }).getAttribute('href')).toBe('/')
  })
})

describe('RunView: the above-level marker', () => {
  it('is absent when the item is at the learner’s declared level (the sample is all A1)', async () => {
    await start('flashcard')
    expect(document.querySelector('.above-level')).toBeNull()
  })
})

describe('RunView: reporting a problem', () => {
  it('files a report for the word on the card, keys do not answer while the dialog is open, and focus lands on Continue', async () => {
    const { run, client } = await start('flashcard')
    const report = vi.spyOn(client, 'report')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await press(' ')
    expect(run.snapshot.phase).toBe('prompt')
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Bad audio' })))
    fireEvent.change(screen.getByRole('textbox', { name: 'Details (optional)' }), { target: { value: 'Too quiet' } })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send report' })))
    expect(report).toHaveBeenCalledWith({ wordId: run.snapshot.item!.wordId, field: 'audio', note: 'Too quiet', packVersion: 0 })
    expect(screen.getByText('Report saved. Thank you.')).toBeTruthy()
    expect(document.activeElement?.textContent).toBe('Continue')
  })

  it('returns focus to the card when the dialog is cancelled', async () => {
    await start('flashcard')
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    expect(document.activeElement?.classList.contains('card')).toBe(true)
  })

  it('a double click on Send files exactly one report', async () => {
    const { client } = await start('flashcard')
    const report = vi.spyOn(client, 'report')
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
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Report a problem' })))
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Send report' })))
    expect(screen.getByRole('alert').textContent).toContain('offline')
    expect((screen.getByRole('button', { name: 'Send report' }) as HTMLButtonElement).disabled).toBe(false)
  })
})
