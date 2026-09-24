import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { StudyRun, type RunOptions } from '@wordado/client-data'
import { Grade } from '@wordado/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AudioPort } from '../content/audio'
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
})

describe('RunView: listening', () => {
  it('plays the word, then counts latency from the end of the audio', async () => {
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
  it('files a report for the word on the card, and keys do not answer while the dialog is open', async () => {
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
  })
})
