import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FeedbackAiStatus } from '../../shared/hosted'
import { hostedApi } from '../hostedApi'
import { AdminFeedbackAi, AI_PRIVACY_NOTE } from './AdminFeedbackAi'

afterEach(() => (cleanup(), vi.restoreAllMocks()))

const status = (over: Partial<FeedbackAiStatus> = {}): FeedbackAiStatus => ({ setUp: true, needs: null, on: false, model: 'test/model', callsToday: 0, dailyCalls: 200, reads: ['en', 'bg'], ...over })

function shown(first: FeedbackAiStatus | null | 'failed') {
  const onStatus = vi.fn()
  const onForgotten = vi.fn()
  const view = render(<AdminFeedbackAi status={first} onStatus={onStatus} onForgotten={onForgotten} />)
  const panel = screen.getByRole('region', { name: 'AI help' })
  const toggle = within(panel).getByRole('switch', { name: 'AI help' }) as HTMLInputElement
  const show = (next: FeedbackAiStatus) => view.rerender(<AdminFeedbackAi status={next} onStatus={onStatus} onForgotten={onForgotten} />)
  return { panel, toggle, onStatus, onForgotten, show }
}
const line = (panel: HTMLElement) => panel.querySelector('.feedback-ai-state')!.textContent

describe('AdminFeedbackAi: the switch and what it says', () => {
  it('says what the privacy policy must name and what must cover the transfer before it is switched on, whatever the state', () => {
    expect(AI_PRIVACY_NOTE).toBe('Before this is switched on for learners’ feedback, the privacy policy must name the AI service, and the transfer of the text to it must be covered: by the EU–US Data Privacy Framework or by standard contractual clauses.')
    for (const s of [status(), status({ on: true }), status({ setUp: false, needs: 'FEEDBACK_AI_KEY' }), null, 'failed'] as const) {
      const { panel } = shown(s)
      expect(within(panel).getByText(AI_PRIVACY_NOTE)).toBeTruthy()
      cleanup()
    }
  })

  it('is not set up without the key: the switch cannot be moved, and the line names the setting', () => {
    const { panel, toggle } = shown(status({ setUp: false, needs: 'FEEDBACK_AI_KEY' }))
    expect(toggle.disabled).toBe(true)
    expect(toggle.checked).toBe(false)
    expect(line(panel)).toBe('AI help is not set up: set FEEDBACK_AI_KEY for the review app.')
    expect(panel.querySelector('.feedback-ai-state code')?.textContent).toBe('FEEDBACK_AI_KEY')
  })

  it('names the setting that is wrong, whichever it is', () => {
    for (const needs of ['FEEDBACK_AI_URL', 'FEEDBACK_AI_AUTH'] as const) {
      const { panel, toggle } = shown(status({ setUp: false, needs }))
      expect(toggle.disabled).toBe(true)
      expect(line(panel)).toBe(`AI help is not set up: set ${needs} for the review app.`)
      expect(panel.querySelector('.feedback-ai-state code')?.textContent).toBe(needs)
      cleanup()
    }
  })

  it('is off until it is switched on, and says that no message is sent', () => {
    const { panel, toggle } = shown(status())
    expect(toggle.disabled).toBe(false)
    expect(toggle.checked).toBe(false)
    expect(line(panel)).toBe('Off. No message is sent to the AI.')
  })

  it('names the model and the calls used today when it is on', () => {
    const { panel, toggle } = shown(status({ on: true, callsToday: 12 }))
    expect(toggle.checked).toBe(true)
    expect(line(panel)).toBe('On: test/model. 12 of 200 calls used today.')
  })

  it('says so when the AI help could not be reached, and waits quietly while it is not known yet', () => {
    const failed = shown('failed')
    expect(failed.toggle.disabled).toBe(true)
    expect(line(failed.panel)).toBe('AI help could not be reached.')
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    const waiting = shown(null)
    expect(waiting.toggle.disabled).toBe(true)
    expect(line(waiting.panel)).toBe('')
  })

  it('switches on and off, and hands on the status the server answers with', async () => {
    const set = vi.spyOn(hostedApi.admin, 'setFeedbackAi').mockResolvedValue(status({ on: true }))
    const { toggle, onStatus, show } = shown(status())
    fireEvent.click(toggle)
    expect(set).toHaveBeenCalledWith(true)
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(status({ on: true })))
    show(status({ on: true }))
    expect(toggle.checked).toBe(true)
    set.mockResolvedValue(status())
    fireEvent.click(toggle)
    expect(set).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(onStatus).toHaveBeenLastCalledWith(status()))
  })

  it('goes back and says why when the switch is refused', async () => {
    vi.spyOn(hostedApi.admin, 'setFeedbackAi').mockRejectedValue(new Error('AI help is not set up: set FEEDBACK_AI_KEY for the review app.'))
    const { panel, toggle, onStatus } = shown(status())
    fireEvent.click(toggle)
    expect((await within(panel).findByRole('alert')).textContent).toBe('Not switched: AI help is not set up: set FEEDBACK_AI_KEY for the review app.')
    expect(toggle.checked).toBe(false)
    expect(toggle.disabled).toBe(false)
    expect(onStatus).not.toHaveBeenCalled()
  })

  it('asks before it forgets the AI’s results, then forgets them and says how many', async () => {
    const forget = vi.spyOn(hostedApi.admin, 'forgetFeedbackAi').mockResolvedValue({ forgotten: 7 })
    const { panel, onForgotten } = shown(status({ on: true }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Forget the AI’s results' }))
    const dialog = await screen.findByRole('dialog', { name: 'Forget the AI’s results' })
    expect(within(dialog).getByText('Everything the AI wrote about the feedback is removed. Your marks and notes stay. It is made again as pages are read.')).toBeTruthy()
    expect(forget).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget them' }))
    await waitFor(() => expect(onForgotten).toHaveBeenCalledTimes(1))
    expect(forget).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await within(panel).findByText('7 results forgotten.')).toBeTruthy()
  })

  it('forgets nothing when the question is closed, and says in the dialog when forgetting fails', async () => {
    const forget = vi.spyOn(hostedApi.admin, 'forgetFeedbackAi').mockRejectedValue(new Error('internal error'))
    const { panel, onForgotten } = shown(status())
    fireEvent.click(within(panel).getByRole('button', { name: 'Forget the AI’s results' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep them' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(forget).not.toHaveBeenCalled()
    fireEvent.click(within(panel).getByRole('button', { name: 'Forget the AI’s results' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forget them' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('internal error')
    expect(onForgotten).not.toHaveBeenCalled()
  })
})
