import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RowView } from '../server/types'
import { RowCard } from './RowCard'
import { bank, bankClean, bankThree, bankTwoFields, objection } from './testRows'

afterEach(cleanup)

const position = { index: 0, total: 2 }
type Props = Parameters<typeof RowCard>[0]
const show = (row: RowView, over: Partial<Props> = {}) => {
  const onDecide = vi.fn()
  const onSkip = vi.fn()
  const onPrev = vi.fn()
  const props: Props = { row, position, onDecide, onSkip, onPrev, ...over }
  const view = render(<RowCard {...props} />)
  return { onDecide, onSkip, onPrev, rerender: (next: Partial<Props>) => view.rerender(<RowCard {...props} {...next} />) }
}
/** One finger across the card, down at `fromX` and up at `toX`. */
const swipe = (el: HTMLElement, fromX: number, toX: number) => {
  fireEvent.pointerDown(el, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: fromX, clientY: 260 })
  fireEvent.pointerUp(el, { pointerId: 1, isPrimary: true, pointerType: 'touch', clientX: toX, clientY: 260 })
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


  describe('in a spot check', () => {
    const ask = () => screen.queryByRole('group', { name: 'How serious was it?' })

    it('keeps a row without a question', () => {
      const { onDecide } = show(bankClean, { askSeverity: true })
      fireEvent.keyDown(window, { key: '2' })
      expect(onDecide).toHaveBeenCalledWith('keep', bankClean.cells, '')
      expect(ask()).toBeNull()
    })

    it('asks how serious it was on Drop, says what each answer means, and sends the drop with the answer', () => {
      const { onDecide } = show(bankClean, { askSeverity: true })
      fireEvent.click(button('Drop'))
      expect(onDecide).not.toHaveBeenCalled()
      const group = within(ask()!)
      expect(group.getByRole('button', { name: /Serious.*a learner would be taught something wrong, or marked wrong for a right answer/ })).toBeTruthy()
      expect(group.getByRole('button', { name: /Minor.*right, but could be better/ })).toBeTruthy()
      // the question has taken the place of the decisions
      expect(screen.queryByRole('button', { name: /Keep as it is/ })).toBeNull()
      expect(document.activeElement).toBe(ask())
      fireEvent.click(group.getByRole('button', { name: /Serious/ }))
      expect(onDecide).toHaveBeenCalledTimes(1)
      expect(onDecide).toHaveBeenCalledWith('drop', bankClean.cells, '', 'major')
    })

    it('asks on Save with what was typed, and Minor sends the edit', () => {
      const { onDecide } = show(bankClean, { askSeverity: true })
      fireEvent.click(button('Edit'))
      fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'речен бряг' } })
      fireEvent.click(button('Save'))
      expect(onDecide).not.toHaveBeenCalled()
      // what was typed stays in view, and cannot be changed under the question
      expect((screen.getByLabelText('Translation') as HTMLInputElement).value).toBe('речен бряг')
      expect((screen.getByLabelText('Translation') as HTMLInputElement).disabled).toBe(true)
      fireEvent.click(within(ask()!).getByRole('button', { name: /Minor/ }))
      expect(onDecide).toHaveBeenCalledWith('edit', { translation: 'речен бряг', alternates: '', sense: 'край на река' }, '', 'minor')
    })

    it('answers with the keys: 1 serious, 2 minor, and no other decision key does anything meanwhile', () => {
      const first = show(bankClean, { askSeverity: true })
      fireEvent.keyDown(window, { key: '4' })
      for (const key of ['3', '4']) fireEvent.keyDown(window, { key })
      expect(first.onDecide).not.toHaveBeenCalled()
      expect(ask()).toBeTruthy()
      fireEvent.keyDown(window, { key: '1' })
      expect(first.onDecide).toHaveBeenCalledWith('drop', bankClean.cells, '', 'major')
      cleanup()
      const second = show(bankClean, { askSeverity: true })
      fireEvent.keyDown(window, { key: '3' })
      fireEvent.keyDown(screen.getByLabelText('Translation'), { key: 'Enter' })
      expect(second.onDecide).not.toHaveBeenCalled()
      // 2 is Minor here, not Keep as it is
      fireEvent.keyDown(window, { key: '2' })
      expect(second.onDecide).toHaveBeenCalledTimes(1)
      expect(second.onDecide).toHaveBeenCalledWith('edit', bankClean.cells, '', 'minor')
    })

    it('cancels the question with Escape or Cancel: to the decisions after Drop, to the edit as it was after Save', () => {
      const { onDecide } = show(bankClean, { askSeverity: true })
      fireEvent.click(button('Drop'))
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(ask()).toBeNull()
      expect(button('Keep as it is')).toBeTruthy()
      fireEvent.click(button('Edit'))
      fireEvent.change(screen.getByLabelText('Translation'), { target: { value: 'x' } })
      fireEvent.keyDown(window, { key: '3' })
      fireEvent.click(within(ask()!).getByRole('button', { name: 'Cancel' }))
      expect(ask()).toBeNull()
      const field = screen.getByLabelText('Translation') as HTMLInputElement
      expect([field.value, field.disabled]).toEqual(['x', false])
      expect(document.activeElement).toBe(field)
      // one more Escape leaves the edit, as it always did
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(screen.queryByLabelText('Translation')).toBeNull()
      expect(onDecide).not.toHaveBeenCalled()
    })

    it('counts the question as part of the edit for the screen, and stops a swipe while it is open', () => {
      const onEditing = vi.fn()
      const { onSkip, onPrev } = show(bankClean, { askSeverity: true, onEditing })
      fireEvent.click(button('Drop'))
      expect(onEditing).toHaveBeenLastCalledWith(true)
      swipe(screen.getByRole('article'), 320, 120)
      swipe(screen.getByRole('article'), 80, 300)
      expect(onSkip).not.toHaveBeenCalled()
      expect(onPrev).not.toHaveBeenCalled()
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(onEditing).toHaveBeenLastCalledWith(false)
      swipe(screen.getByRole('article'), 320, 120)
      expect(onSkip).toHaveBeenCalledTimes(1)
    })

    it('asks about an accepted fix too, should a sampled row have gained an objection', () => {
      const { onDecide } = show(bank, { askSeverity: true })
      fireEvent.keyDown(window, { key: '1' })
      expect(onDecide).not.toHaveBeenCalled()
      fireEvent.keyDown(window, { key: '1' })
      expect(onDecide).toHaveBeenCalledWith('accept', { translation: 'бряг', alternates: '', sense: 'край на река' }, '', 'major')
    })

    it('sends the note with the answer, and keeps the answers off while the decision saves', () => {
      const { onDecide } = show(bankClean, { askSeverity: true })
      fireEvent.click(button('Add a note'))
      fireEvent.change(screen.getByLabelText('Note for the coordinator'), { target: { value: 'means a jar' } })
      fireEvent.click(button('Drop'))
      fireEvent.keyDown(window, { key: '2' })
      expect(onDecide).toHaveBeenCalledWith('drop', bankClean.cells, 'means a jar', 'minor')
      cleanup()
      const saving = show(bankClean, { askSeverity: true })
      fireEvent.click(button('Drop'))
      saving.rerender({ saving: true })
      expect((within(ask()!).getByRole('button', { name: /Serious/ }) as HTMLButtonElement).disabled).toBe(true)
      fireEvent.keyDown(window, { key: '1' })
      expect(saving.onDecide).not.toHaveBeenCalled()
    })

    it('shows what a decided row was rated, beside its decision', () => {
      const first = show({ ...bankClean, decided: { verdict: 'drop', note: '' } }, { askSeverity: true, rated: 'major' })
      const chip = screen.getByText('rated serious')
      expect(chip.classList.contains('major')).toBe(true)
      expect(screen.getByText('decided: drop')).toBeTruthy()
      first.rerender({ row: { ...bankClean, decided: { verdict: 'ok', note: '' } }, rated: 'minor' })
      expect(screen.getByText('rated minor').classList.contains('minor')).toBe(true)
      // a row kept as it is has no rating; nor has one whose decision no longer stands
      first.rerender({ row: { ...bankClean, decided: { verdict: 'ok', note: '' } }, rated: null })
      expect(screen.queryByText(/^rated/)).toBeNull()
      first.rerender({ row: bankClean, rated: 'major' })
      expect(screen.queryByText(/^rated/)).toBeNull()
    })

    it('asks nothing outside a spot check', () => {
      const { onDecide } = show(bankClean)
      fireEvent.click(button('Drop'))
      expect(ask()).toBeNull()
      expect(onDecide).toHaveBeenCalledWith('drop', bankClean.cells, '')
    })
  })
})
