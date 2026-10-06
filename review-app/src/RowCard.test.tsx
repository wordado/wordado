import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RowView } from '../server/types'
import { RowCard } from './RowCard'
import { bank, bankClean, bankThree, bankTwoFields, objection } from './testRows'

afterEach(cleanup)

const position = { index: 0, total: 2 }
const show = (row: RowView, over: Partial<Parameters<typeof RowCard>[0]> = {}) => {
  const onDecide = vi.fn()
  const onSkip = vi.fn()
  const onPrev = vi.fn()
  render(<RowCard row={row} position={position} onDecide={onDecide} onSkip={onSkip} onPrev={onPrev} {...over} />)
  return { onDecide, onSkip, onPrev }
}
const button = (name: RegExp | string) => screen.getByRole('button', { name }) as HTMLButtonElement

describe('RowCard', () => {
  it('shows the word under its eyebrow, the example, the other senses and the objection', () => {
    show(bank)
    expect(screen.getByText('noun · A2 · edge of river')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'bank' })).toBeTruthy()
    expect(screen.getByText('“We sat on the bank and watched the boats.”')).toBeTruthy()
    expect(screen.getByText(/bank-1/)).toBeTruthy()
    expect(screen.getByText('банка is the money sense')).toBeTruthy()
    expect(screen.getByText('wrong-sense')).toBeTruthy()
  })

  it('shows where the row is among the shown rows, and its chips', () => {
    show({ ...bank, reports: 'wrong word' }, { position: { index: 12, total: 624 } })
    expect(screen.getByText('13 of 624')).toBeTruthy()
    const article = screen.getByRole('article', { name: 'Row bank-2' })
    expect(within(article).getByText('major')).toBeTruthy()
    expect(within(article).getByText('report')).toBeTruthy()
    expect(within(article).getByText('wrong word')).toBeTruthy()
  })

  it('names a title row by its unit and a level row by its word', () => {
    const title: RowView = { ...bankClean, kind: 'title', queue: 'title-bg', key: 'a2-u03', fields: ['title_en', 'title_l1'], cells: { title_en: 'Money', title_l1: 'Пари' }, context: { level: 'A2', words: 'bank, coin, pay' } }
    const first = render(<RowCard row={title} position={position} onDecide={() => {}} onSkip={() => {}} onPrev={() => {}} />)
    expect(screen.getByText('A2 · unit title')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'a2-u03' })).toBeTruthy()
    expect(screen.getByText('bank, coin, pay')).toBeTruthy()
    first.unmount()
    show({ ...bankClean, kind: 'level', queue: 'level', fields: ['level'], cells: { level: 'B1' }, context: { headword: 'bank', pos: 'noun', sense_en: 'edge of river', band: '3' } })
    expect(screen.getByRole('heading', { name: 'bank' })).toBeTruthy()
    expect(screen.getByText('frequency band 3')).toBeTruthy()
  })

  it('says which meaning a level row grades: part of speech · level · English sense, without the parts that are empty', () => {
    const level: RowView = { ...bankClean, kind: 'level', queue: 'level', fields: ['level'], cells: { level: 'B1' }, context: { headword: 'bank', pos: 'noun', sense_en: 'edge of river', band: '3' } }
    const first = render(<RowCard row={level} position={position} onDecide={() => {}} onSkip={() => {}} onPrev={() => {}} />)
    expect(screen.getByText('noun · level · edge of river').classList.contains('eyebrow')).toBe(true)
    first.unmount()
    const second = render(<RowCard row={{ ...level, context: { headword: 'bank', pos: 'noun', sense_en: '', band: '3' } }} position={position} onDecide={() => {}} onSkip={() => {}} onPrev={() => {}} />)
    expect(screen.getByText('noun · level')).toBeTruthy()
    second.unmount()
    show({ ...level, context: { headword: 'bank', pos: '', sense_en: 'edge of river' } })
    expect(screen.getByText('level · edge of river')).toBeTruthy()
  })

  it('makes Accept fix the one primary button when the row has objections', () => {
    show(bank)
    expect(button('Accept fix').classList.contains('primary')).toBe(true)
    expect(button('Accept fix').disabled).toBe(false)
    for (const name of ['Keep as it is', 'Edit', 'Drop']) expect(button(name).classList.contains('primary')).toBe(false)
  })

  it('without objections disables Accept fix, ignores key 1 and makes Keep the primary', () => {
    const { onDecide } = show(bankClean)
    expect(button('Accept fix').disabled).toBe(true)
    expect(button('Accept fix').classList.contains('primary')).toBe(false)
    expect(button('Keep as it is').classList.contains('primary')).toBe(true)
    expect(screen.queryByRole('region', { name: 'AI suggests' })).toBeNull()
    fireEvent.keyDown(window, { key: '1' })
    expect(onDecide).not.toHaveBeenCalled()
  })

  it('accepts with key 1 and the button, keeps with 2, drops with 4', () => {
    const { onDecide } = show(bank)
    fireEvent.keyDown(window, { key: '1' })
    expect(onDecide).toHaveBeenLastCalledWith('accept', { translation: 'бряг', alternates: '', sense: 'край на река' }, '')
    fireEvent.click(button('Accept fix'))
    expect(onDecide).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(window, { key: '2' })
    expect(onDecide).toHaveBeenLastCalledWith('keep', bank.cells, '')
    fireEvent.keyDown(window, { key: '4' })
    expect(onDecide).toHaveBeenLastCalledWith('drop', bank.cells, '')
  })

  it('accepts exactly the ticked fixes when one field has two objections and another has one', () => {
    const { onDecide } = show(bankThree)
    const suggested = () => within(screen.getByRole('region', { name: 'AI suggests' }))
    // the row has several objections, so each has a tick; the first on each field starts ticked
    const ticks = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(ticks.map((t) => t.checked)).toEqual([true, false, true])
    expect(suggested().getByText('бряг')).toBeTruthy()
    expect(suggested().getByText('бряг на река')).toBeTruthy()
    fireEvent.keyDown(window, { key: '1' })
    expect(onDecide).toHaveBeenLastCalledWith('accept', { translation: 'бряг', alternates: '', sense: 'бряг на река' }, '')
    fireEvent.click(ticks[1]!)
    expect(ticks.map((t) => t.checked)).toEqual([false, true, true])
    expect(suggested().getByText('крайбрежие')).toBeTruthy()
    expect(suggested().queryByText('бряг')).toBeNull()
    fireEvent.click(button('Accept fix'))
    expect(onDecide).toHaveBeenLastCalledWith('accept', { translation: 'крайбрежие', alternates: '', sense: 'бряг на река' }, '')
  })

  it('with one objection on each of two fields, ticks both, names their fields, and applies only what stays ticked', () => {
    const { onDecide } = show(bankTwoFields)
    const now = () => within(screen.getByRole('region', { name: 'Now' }))
    const suggested = () => within(screen.getByRole('region', { name: 'AI suggests' }))
    const ticks = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(ticks.map((t) => t.checked)).toEqual([true, true])
    const lines = ticks.map((t) => t.closest('label')!.textContent)
    expect(lines[0]).toContain('Translation → бряг')
    expect(lines[1]).toContain('Sense → бряг на река')
    expect(now().getByText('край на река').classList.contains('struck')).toBe(true)
    fireEvent.click(ticks[1]!)
    expect(ticks.map((t) => t.checked)).toEqual([true, false])
    expect(suggested().getByText('бряг')).toBeTruthy()
    expect(suggested().getByText('край на река')).toBeTruthy()
    expect(suggested().queryByText('бряг на река')).toBeNull()
    expect(now().getByText('край на река').classList.contains('struck')).toBe(false)
    expect(now().getByText('банка').classList.contains('struck')).toBe(true)
    const only = { translation: 'бряг', alternates: '', sense: 'край на река' }
    fireEvent.click(button('Accept fix'))
    expect(onDecide).toHaveBeenLastCalledWith('accept', only, '')
    fireEvent.keyDown(window, { key: '1' })
    expect(onDecide).toHaveBeenCalledTimes(2)
    expect(onDecide).toHaveBeenLastCalledWith('accept', only, '')
    // and it can be ticked again
    fireEvent.click(ticks[1]!)
    fireEvent.keyDown(window, { key: '1' })
    expect(onDecide).toHaveBeenLastCalledWith('accept', { ...only, sense: 'бряг на река' }, '')
  })

  it('has no tick for a row with a single objection', () => {
    show(bank)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByText(/Translation →/)).toBeNull()
  })

  it('disables the ticks while editing', () => {
    show(bankTwoFields)
    fireEvent.click(button('Edit'))
    const ticks = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(ticks.map((t) => t.disabled)).toEqual([true, true])
    fireEvent.click(button('Cancel'))
    expect((screen.getAllByRole('checkbox') as HTMLInputElement[]).map((t) => t.disabled)).toEqual([false, false])
  })

  it('shows a fix that empties a field as "none", in the line and under AI suggests', () => {
    show({ ...bank, cells: { ...bank.cells, alternates: 'бряг' }, objections: [objection(), objection({ field: 'alternates', category: 'alternate-wrong', severity: 'minor', reason: 'not an alternate', fix: '' })] })
    const line = (screen.getAllByRole('checkbox')[1] as HTMLInputElement).closest('label')!
    const fix = within(line).getByText('none')
    expect(fix.classList.contains('none')).toBe(true)
    expect(line.textContent).toContain('Alternates → none')
    const cell = within(screen.getByRole('region', { name: 'AI suggests' })).getByText('none')
    expect(cell.classList.contains('none')).toBe(true)
  })

  it('says who objected only when more than one reviewer did', () => {
    const first = render(<RowCard row={bank} position={position} onDecide={() => {}} onSkip={() => {}} onPrev={() => {}} />)
    expect(screen.queryByText(/gemini/)).toBeNull()
    first.unmount()
    show(bankThree)
    expect(screen.getAllByText(/flash · google\/gemini-3.8-flash/).length).toBe(2)
    expect(screen.getByText(/bggpt · bggpt-gemma-3-27b/)).toBeTruthy()
  })

  it('sends the note, and typing in it triggers no key', () => {
    const { onDecide, onSkip } = show(bank)
    expect(screen.queryByLabelText('Note for the coordinator')).toBeNull()
    fireEvent.click(button('Add a note'))
    const note = screen.getByLabelText('Note for the coordinator')
    for (const key of ['1', '2', '3', '4', 's', 'l']) fireEvent.keyDown(note, { key })
    expect(onDecide).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    fireEvent.change(note, { target: { value: 'both are used' } })
    fireEvent.keyDown(window, { key: '2' })
    expect(onDecide).toHaveBeenLastCalledWith('keep', bank.cells, 'both are used')
  })

  it('edits: one input per field with the ticked fixes, key 3 saves what was typed', () => {
    const { onDecide } = show(bank)
    fireEvent.keyDown(window, { key: '3' })
    expect(screen.queryByRole('region', { name: 'Now' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'AI suggests' })).toBeNull()
    const inputs = ['Translation', 'Alternates', 'Sense'].map((l) => screen.getByLabelText(l) as HTMLInputElement)
    expect(inputs.map((i) => i.value)).toEqual(['бряг', '', 'край на река'])
    // typing a digit in an edit field is typing, not a decision
    for (const key of ['1', '2', '3', '4']) fireEvent.keyDown(inputs[0]!, { key })
    expect(onDecide).not.toHaveBeenCalled()
    fireEvent.change(inputs[0]!, { target: { value: 'речен бряг' } })
    fireEvent.change(inputs[1]!, { target: { value: 'бряг' } })
    expect(button('Save').classList.contains('primary')).toBe(true)
    fireEvent.keyDown(window, { key: '3' })
    expect(onDecide).toHaveBeenCalledTimes(1)
    expect(onDecide).toHaveBeenLastCalledWith('edit', { translation: 'речен бряг', alternates: 'бряг', sense: 'край на река' }, '')
  })

  it('edits with the buttons, and Enter in a field saves', () => {
    const { onDecide } = show(bank)
    fireEvent.click(button('Edit'))
    fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'речен бряг' } })
    fireEvent.keyDown(screen.getByLabelText('Translation'), { key: 'Enter' })
    expect(onDecide).toHaveBeenLastCalledWith('edit', { translation: 'речен бряг', alternates: '', sense: 'край на река' }, '')
    fireEvent.click(button('Save'))
    expect(onDecide).toHaveBeenCalledTimes(2)
  })

  it('cancels an edit with Escape, from a field or from anywhere, and with Cancel', () => {
    const { onDecide } = show(bank)
    for (const cancel of [() => fireEvent.keyDown(screen.getByLabelText('Translation'), { key: 'Escape' }), () => fireEvent.keyDown(window, { key: 'Escape' }), () => fireEvent.click(button('Cancel'))]) {
      fireEvent.click(button('Edit'))
      fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'x' } })
      cancel()
      expect(screen.queryByLabelText('Translation')).toBeNull()
      expect(screen.getByRole('region', { name: 'Now' })).toBeTruthy()
    }
    expect(onDecide).not.toHaveBeenCalled()
    // the cancelled text is gone: a new edit starts from the fixes again
    fireEvent.click(button('Edit'))
    expect((screen.getByLabelText('Translation') as HTMLInputElement).value).toBe('бряг')
  })

  it('tells the screen while an edit is open, and when it is over', () => {
    const onEditing = vi.fn()
    const view = render(<RowCard row={bank} position={position} onDecide={() => {}} onSkip={() => {}} onPrev={() => {}} onEditing={onEditing} />)
    expect(onEditing).not.toHaveBeenCalled()
    fireEvent.click(button('Edit'))
    expect(onEditing).toHaveBeenLastCalledWith(true)
    fireEvent.click(button('Cancel'))
    expect(onEditing).toHaveBeenLastCalledWith(false)
    // a row that goes away in the middle of an edit takes the edit with it
    fireEvent.click(button('Edit'))
    expect(onEditing).toHaveBeenLastCalledWith(true)
    view.unmount()
    expect(onEditing).toHaveBeenLastCalledWith(false)
  })

  it('has no Drop, and no key 4, for a title row or a level row', () => {
    const { onDecide } = show({ ...bank, kind: 'title', queue: 'title-bg', fields: ['title_l1'], cells: { title_l1: 'Пари' }, objections: [] })
    expect(screen.queryByRole('button', { name: /Drop/ })).toBeNull()
    fireEvent.keyDown(window, { key: '4' })
    expect(onDecide).not.toHaveBeenCalled()
    cleanup()
    show({ ...bank, kind: 'level', queue: 'level', fields: ['level'], cells: { level: 'B1' }, context: { headword: 'bank', pos: 'noun', sense_en: 'edge of river', band: '3' }, objections: [] })
    expect(screen.queryByRole('button', { name: /Drop/ })).toBeNull()
  })

  it('shows a decided row’s decision as a chip', () => {
    show({ ...bank, decided: { verdict: 'ok', note: '' } })
    const chip = screen.getByText('decided: ok')
    expect(chip.classList.contains('chip')).toBe(true)
  })

  it('skips and goes back with the buttons under the actions', () => {
    const { onSkip, onPrev } = show(bank)
    fireEvent.click(button(/Skip/))
    expect(onSkip).toHaveBeenCalledTimes(1)
    fireEvent.click(button(/Previous/))
    expect(onPrev).toHaveBeenCalledTimes(1)
  })

  it('shows the keys inside the buttons without changing their names', () => {
    show(bank)
    expect(button('Accept fix').textContent).toBe('Accept fix1')
    expect(button('Accept fix').querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true')
    expect(button('Keep as it is').querySelector('kbd')?.textContent).toBe('2')
  })

  it('disables the buttons and ignores the keys while a decision saves', () => {
    const { onDecide } = show(bank, { saving: true })
    for (const name of [/Accept fix/, /Keep/, /Edit/, /Drop/, /Skip/, /Previous/]) expect(button(name).disabled).toBe(true)
    for (const key of ['1', '2', '3', '4']) fireEvent.keyDown(window, { key })
    expect(onDecide).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
  })

  it('says when the file is older than the draft', () => {
    show({ ...bank, stale: true })
    expect(screen.getByText(/This file is older than the draft/)).toBeTruthy()
  })
})
